import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'

import { requireAuth } from './auth.js'
import { config } from './config.js'
import { query, withTransaction } from './db.js'
import {
  initiateB2c,
  initiateStkPush,
  isDefinitiveDarajaError,
  queryStkPushStatus,
} from './services/daraja.js'
import {
  RUSD_TYPE_SCRIPT,
  createOperatorInvoice,
  getFiberInvoice,
  getFiberPayment,
  getFiberPaymentDirect,
  getNodeInfo,
  listChannelsByPeer,
  parseFiberInvoice,
  sendFiberPayment,
} from './services/fiber.js'
import { getUsdKesRate } from './services/fx.js'
import {
  expiredRefundInvoiceAction,
  isRefundLeaseStale,
  refundWorkerAction,
} from './services/rampRefundPolicy.js'
import {
  assertRampTransition,
  calculateRampQuote,
  publicRampOrder,
  validateRampInvoice,
} from './services/ramp.js'
import { asyncHandler, normalizePhone } from './utils.js'

const ACTIVE_DEPOSIT_STATES = new Set([
  'created',
  'invoice_ready',
  'mpesa_initiating',
  'mpesa_pending',
  'mpesa_unknown',
  'mpesa_confirmed',
  'fiber_sending',
  'delivery_pending',
])
const PAID_INVOICE_STATES = new Set(['Paid'])
const SUCCESS_PAYMENT_STATES = new Set(['Success'])
const FAILED_PAYMENT_STATES = new Set(['Failed', 'Cancelled', 'Canceled', 'Timeout'])

const ORDER_UPDATE_COLUMNS = new Map([
  ['browserInvoice', 'browser_invoice'],
  ['operatorInvoice', 'operator_invoice'],
  ['invoicePaymentHash', 'invoice_payment_hash'],
  ['invoiceExpiresAt', 'invoice_expires_at'],
  ['fiberPaymentHash', 'fiber_payment_hash'],
  ['fiberStatus', 'fiber_status'],
  ['fiberFeeBaseUnits', 'fiber_fee_base_units'],
  ['checkoutRequestId', 'checkout_request_id'],
  ['merchantRequestId', 'merchant_request_id'],
  ['conversationId', 'conversation_id'],
  ['originatorConversationId', 'originator_conversation_id'],
  ['receiptNumber', 'receipt_number'],
  ['failureCode', 'failure_code'],
  ['failureMessage', 'failure_message'],
  ['refundInvoice', 'refund_invoice'],
  ['refundPaymentHash', 'refund_payment_hash'],
  ['refundInvoiceExpiresAt', 'refund_invoice_expires_at'],
  ['refundLeaseToken', 'refund_lease_token'],
  ['providerPayload', 'provider_payload'],
  ['mpesaConfirmedAt', 'mpesa_confirmed_at'],
  ['rusdReceivedAt', 'rusd_received_at'],
  ['completedAt', 'completed_at'],
  ['refundedAt', 'refunded_at'],
])

function callbackUrl(pathname) {
  const url = new URL(pathname, `${config.publicBaseUrl.replace(/\/+$/, '')}/`)
  if (config.ramp.callbackToken) url.searchParams.set('token', config.ramp.callbackToken)
  return url.toString()
}

function callbackTokenMatches(value) {
  if (config.demoMode && !config.ramp.callbackToken) return true
  if (!config.ramp.callbackToken || typeof value !== 'string') return false
  const expected = createHash('sha256').update(config.ramp.callbackToken).digest()
  const actual = createHash('sha256').update(value).digest()
  return timingSafeEqual(actual, expected)
}

function requireRampCallback(req, res, next) {
  if (!callbackTokenMatches(req.query.token)) return res.status(404).json({ error: 'Not found' })
  next()
}

function requireRampOperator(req, res, next) {
  const authorization = String(req.get('authorization') || '')
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
  if (!config.ramp.operatorToken || !token) return res.status(404).json({ error: 'Not found' })
  const expected = createHash('sha256').update(config.ramp.operatorToken).digest()
  const actual = createHash('sha256').update(token).digest()
  if (!timingSafeEqual(actual, expected)) return res.status(404).json({ error: 'Not found' })
  next()
}

function depositsEnabled() {
  return config.ramp.depositsEnabled && (config.demoMode || Boolean(
    config.ramp.callbackToken && config.ramp.operatorToken,
  ))
}

function withdrawalsEnabled() {
  const nonProductionPayout = config.demoMode || config.mpesa.environment === 'sandbox'
  const credentialsReady = config.demoMode || Boolean(
    config.mpesa.b2cShortcode
      && config.mpesa.initiatorName
      && config.mpesa.securityCredential,
  )
  return config.ramp.withdrawalsEnabled
    && nonProductionPayout
    && credentialsReady
    && (config.demoMode || Boolean(config.ramp.callbackToken && config.ramp.operatorToken))
}

function providerResultCode(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim())
  return null
}

function requireIdempotencyKey(req) {
  const key = String(req.get('idempotency-key') || '').trim()
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/.test(key)) {
    throw new Error('A valid Idempotency-Key header is required')
  }
  return key
}

function publicQuote(row) {
  return {
    id: row.id,
    direction: row.direction,
    kesAmount: String(row.kes_amount),
    rateKesPerRUsdMicros: String(row.rate_kes_per_rusd_micros),
    grossRUsdBaseUnits: String(row.gross_rusd_base_units),
    feeRUsdBaseUnits: String(row.fee_rusd_base_units),
    rusdAmountBaseUnits: String(row.rusd_amount_base_units),
    feeBps: Number(row.fee_bps),
    rateSource: row.rate_source,
    quotedAt: new Date(row.quoted_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
  }
}

function serializeOrder(row) {
  const order = publicRampOrder(row)
  order.state = row.status
  order.browserInvoice = row.browser_invoice || null
  order.operatorInvoice = row.operator_invoice || null
  order.fiberPaymentHash = row.fiber_payment_hash || null
  order.invoicePaymentHash = row.invoice_payment_hash || null
  order.fiberStatus = row.fiber_status || null
  order.errorMessage = row.failure_message || null
  return order
}

async function recordEvent(client, orderId, status, metadata = {}) {
  await client.query(
    `INSERT INTO ramp_order_events (order_id, status, metadata)
     VALUES ($1, $2, $3)`,
    [orderId, status, metadata],
  )
}

async function transitionOrder(client, order, nextStatus, updates = {}, metadata = {}) {
  assertRampTransition(order.kind, order.status, nextStatus)
  const assignments = ['status = $2', 'updated_at = now()']
  const values = [order.id, nextStatus]

  for (const [field, value] of Object.entries(updates)) {
    const column = ORDER_UPDATE_COLUMNS.get(field)
    if (!column) throw new Error(`Unsupported ramp order update: ${field}`)
    values.push(value)
    assignments.push(`${column} = $${values.length}`)
  }

  values.push(order.status)
  const result = await client.query(
    `UPDATE ramp_orders SET ${assignments.join(', ')} WHERE id = $1 AND status = $${values.length} RETURNING *`,
    values,
  )
  if (!result.rows[0]) {
    const error = new Error('Ramp order state changed while it was being processed')
    error.code = 'RAMP_STATE_CHANGED'
    throw error
  }
  await recordEvent(client, order.id, nextStatus, metadata)
  return result.rows[0]
}

function mergeProviderPayload(current, key, payload) {
  return {
    ...(current || {}),
    [key]: payload,
    [`${key}At`]: new Date().toISOString(),
  }
}

function channelState(channel) {
  return channel?.state?.state_name || channel?.state_name || ''
}

function scriptMatches(left, right) {
  if (!left || !right) return false
  return String(left.code_hash || '').toLowerCase() === String(right.code_hash || '').toLowerCase()
    && String(left.hash_type || '').toLowerCase() === String(right.hash_type || '').toLowerCase()
    && String(left.args || '').toLowerCase() === String(right.args || '').toLowerCase()
}

function isRoutableRUsdChannel(channel) {
  return channelState(channel) === 'ChannelReady'
    && channel.enabled !== false
    && channel.is_public === true
    && scriptMatches(channel.funding_udt_type_script, RUSD_TYPE_SCRIPT)
}

async function requireDepositRoute(pubkey, amountBaseUnits) {
  const result = await listChannelsByPeer(pubkey)
  const required = BigInt(amountBaseUnits)
  const channel = (result.channels || [])
    .filter(isRoutableRUsdChannel)
    .find((candidate) => BigInt(candidate.local_balance || '0x0') >= required)
  if (!channel) {
    throw new Error('The browser wallet does not have a ready operator RUSD route for this exact deposit amount')
  }
  return channel
}

function stkMetadata(callback) {
  const items = callback?.CallbackMetadata?.Item || callback?.callbackMetadata?.item || []
  const values = Object.fromEntries(items.map((item) => [item.Name || item.name, item.Value ?? item.value]))
  return {
    amount: values.Amount === undefined ? null : Number(values.Amount),
    phone: values.PhoneNumber === undefined ? null : String(values.PhoneNumber),
    receipt: values.MpesaReceiptNumber ? String(values.MpesaReceiptNumber) : null,
  }
}

function normalizeCallbackPhone(value) {
  if (!value) return null
  try {
    return normalizePhone(value)
  } catch {
    return null
  }
}

function paymentState(payment) {
  return payment?.status || payment?.state || 'Unknown'
}

async function waitForFiberPayment(paymentHash, attempts = 20, beforeAttempt = null) {
  let payment = null
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1000))
    await beforeAttempt?.()
    payment = await getFiberPayment(paymentHash)
    const status = paymentState(payment)
    if (SUCCESS_PAYMENT_STATES.has(status) || FAILED_PAYMENT_STATES.has(status)) return payment
  }
  return payment
}

async function settleDeposit(orderId) {
  const claimed = await query(
    `UPDATE ramp_orders
     SET status = 'fiber_sending', updated_at = now(), failure_code = NULL, failure_message = NULL
     WHERE id = $1
       AND kind = 'deposit'
       AND (
         status IN ('mpesa_confirmed', 'delivery_pending')
         OR (status = 'fiber_sending' AND updated_at < now() - interval '45 seconds')
       )
     RETURNING *`,
    [orderId],
  )
  if (!claimed.rows[0]) {
    const current = await query('SELECT * FROM ramp_orders WHERE id = $1', [orderId])
    return current.rows[0] || null
  }

  let order = claimed.rows[0]
  await query(
    `INSERT INTO ramp_order_events (order_id, status, metadata) VALUES ($1, 'fiber_sending', $2)`,
    [order.id, { source: 'settlement' }],
  )

  try {
    let payment = await getFiberPayment(order.invoice_payment_hash)
    if (!payment || !SUCCESS_PAYMENT_STATES.has(paymentState(payment))) {
      payment = await sendFiberPayment(order.browser_invoice)
      const paymentHash = payment?.payment_hash || order.invoice_payment_hash
      payment = await waitForFiberPayment(paymentHash)
    }

    const status = paymentState(payment)
    const paymentHash = payment?.payment_hash || order.invoice_payment_hash
    if (!SUCCESS_PAYMENT_STATES.has(status)) {
      throw new Error(
        FAILED_PAYMENT_STATES.has(status)
          ? payment?.failed_error || `Fiber payment failed with status ${status}`
          : `Fiber payment is still ${status}`,
      )
    }

    order = await withTransaction(async (client) => transitionOrder(client, order, 'completed', {
      fiberPaymentHash: paymentHash,
      fiberStatus: status,
      fiberFeeBaseUnits: String(payment?.fee ? BigInt(payment.fee) : 0n),
      completedAt: new Date(),
      failureCode: null,
      failureMessage: null,
    }, { source: 'fiber', paymentHash }))
  } catch (error) {
    if (error.code === 'RAMP_STATE_CHANGED') {
      const current = await query('SELECT * FROM ramp_orders WHERE id = $1', [order.id])
      return current.rows[0] || null
    }
    order = await withTransaction(async (client) => transitionOrder(client, order, 'delivery_pending', {
      fiberStatus: 'Pending',
      failureCode: 'FIBER_DELIVERY_PENDING',
      failureMessage: error.message,
    }, { source: 'fiber', error: error.message }))
  }
  return order
}

async function confirmDepositMpesa(order, providerResult, callback = null) {
  const callbackData = stkMetadata(callback)
  const callbackPhone = normalizeCallbackPhone(callbackData.phone)
  if (callbackData.amount !== null && callbackData.amount !== Number(order.kes_amount)) {
    throw new Error('M-Pesa callback amount does not match the deposit order')
  }
  if (callbackPhone && callbackPhone !== order.phone) {
    throw new Error('M-Pesa callback phone does not match the deposit order')
  }

  const confirmed = await withTransaction(async (client) => {
    const locked = await client.query('SELECT * FROM ramp_orders WHERE id = $1 FOR UPDATE', [order.id])
    const current = locked.rows[0]
    if (!current || current.status === 'completed') return current
    if (!['mpesa_pending', 'mpesa_unknown'].includes(current.status)) return current
    return transitionOrder(client, current, 'mpesa_confirmed', {
      receiptNumber: callbackData.receipt || current.receipt_number,
      mpesaConfirmedAt: new Date(),
      failureCode: null,
      failureMessage: null,
      providerPayload: mergeProviderPayload(current.provider_payload, 'stkQuery', providerResult),
    }, { source: 'daraja_query', resultCode: String(providerResult.ResultCode ?? '') })
  })

  if (confirmed?.status === 'mpesa_confirmed') return settleDeposit(confirmed.id)
  return confirmed
}

async function reconcileDeposit(order, callback = null) {
  if (!order || order.kind !== 'deposit') return order
  if (
    order.status === 'mpesa_initiating'
    && new Date(order.updated_at).getTime() <= Date.now() - 120_000
  ) {
    return withTransaction(async (client) => {
      const current = (await client.query('SELECT * FROM ramp_orders WHERE id = $1 FOR UPDATE', [order.id])).rows[0]
      if (current.status !== 'mpesa_initiating') return current
      return transitionOrder(client, current, 'mpesa_unknown', {
        failureCode: 'STK_STATUS_UNKNOWN',
        failureMessage: 'M-Pesa prompt submission was interrupted before its provider reference was saved; manual reconciliation is required',
      }, { source: 'stale_submission_reconcile' })
    })
  }
  if (['mpesa_confirmed', 'delivery_pending'].includes(order.status)) return settleDeposit(order.id)
  if (order.status === 'fiber_sending') return settleDeposit(order.id)
  if (!['mpesa_pending', 'mpesa_unknown'].includes(order.status) || !order.checkout_request_id) return order

  let provider
  try {
    provider = await queryStkPushStatus({ checkoutRequestId: order.checkout_request_id })
  } catch (error) {
    await query(
      `UPDATE ramp_orders
       SET provider_payload = provider_payload || $2::jsonb,
           failure_message = $3,
           updated_at = now()
       WHERE id = $1`,
      [order.id, JSON.stringify({ stkQueryError: error.message, stkQueryErrorAt: new Date().toISOString() }), error.message],
    )
    const current = await query('SELECT * FROM ramp_orders WHERE id = $1', [order.id])
    return current.rows[0]
  }

  const resultCode = providerResultCode(provider.ResultCode)
  if (resultCode === 0) {
    return confirmDepositMpesa(order, provider, callback)
  }
  if (resultCode !== null) {
    return withTransaction(async (client) => {
      const locked = await client.query('SELECT * FROM ramp_orders WHERE id = $1 FOR UPDATE', [order.id])
      const current = locked.rows[0]
      if (!['mpesa_pending', 'mpesa_unknown'].includes(current.status)) return current
      return transitionOrder(client, current, 'mpesa_failed', {
        failureCode: String(provider.ResultCode),
        failureMessage: provider.ResultDesc || 'M-Pesa payment did not complete',
        providerPayload: mergeProviderPayload(current.provider_payload, 'stkQuery', provider),
      }, { source: 'daraja_query', resultCode: String(provider.ResultCode) })
    })
  }
  return order
}

async function startB2c(orderId) {
  const stableOriginatorConversationId = `dular-${orderId}`
  const submission = await withTransaction(async (client) => {
    const locked = await client.query('SELECT * FROM ramp_orders WHERE id = $1 FOR UPDATE', [orderId])
    const order = locked.rows[0]
    if (!order || order.status !== 'rusd_received') return { order, claimed: false }
    const claimed = await transitionOrder(client, order, 'b2c_submitting', {
      originatorConversationId: stableOriginatorConversationId,
    }, { source: 'server' })
    return { order: claimed, claimed: true }
  })
  const claimed = submission.order
  if (!submission.claimed) return claimed

  try {
    const provider = await initiateB2c({
      phone: claimed.phone,
      amountKes: Number(claimed.kes_amount),
      originatorConversationId: stableOriginatorConversationId,
      remarks: `Dular cash-out ${claimed.id}`,
      occasion: 'Dular cash-out',
      resultUrl: callbackUrl('/api/ramp/callback/b2c'),
      timeoutUrl: callbackUrl('/api/ramp/callback/b2c-timeout'),
    })

    return withTransaction(async (client) => {
      const current = (await client.query('SELECT * FROM ramp_orders WHERE id = $1 FOR UPDATE', [claimed.id])).rows[0]
      if (current.status !== 'b2c_submitting') return current
      if (config.demoMode) {
        const pending = await transitionOrder(client, current, 'b2c_pending', {
          conversationId: provider.ConversationID,
          originatorConversationId: provider.OriginatorConversationID || stableOriginatorConversationId,
          providerPayload: mergeProviderPayload(current.provider_payload, 'b2cSubmit', provider),
        }, { source: 'demo_b2c_submit' })
        return transitionOrder(client, pending, 'completed', {
          receiptNumber: `demo-${claimed.id.slice(0, 8)}`,
          completedAt: new Date(),
        }, { source: 'demo_b2c' })
      }
      return transitionOrder(client, current, 'b2c_pending', {
        conversationId: provider.ConversationID,
        originatorConversationId: provider.OriginatorConversationID || stableOriginatorConversationId,
        providerPayload: mergeProviderPayload(current.provider_payload, 'b2cSubmit', provider),
      }, { source: 'daraja_b2c_submit' })
    })
  } catch (error) {
    return withTransaction(async (client) => {
      const current = (await client.query('SELECT * FROM ramp_orders WHERE id = $1 FOR UPDATE', [claimed.id])).rows[0]
      if (current.status !== 'b2c_submitting') return current
      return transitionOrder(client, current, 'payout_unknown', {
        failureCode: 'B2C_STATUS_UNKNOWN',
        failureMessage: `M-Pesa payout submission is ambiguous and requires reconciliation: ${error.message}`,
      }, { source: 'daraja_b2c_submit', error: error.message })
    })
  }
}

async function acceptPaidWithdrawal(order, invoice) {
  if (!order || order.status !== 'awaiting_rusd') return order
  if (!PAID_INVOICE_STATES.has(invoice?.status)) return order
  let updated = await withTransaction(async (client) => {
    const locked = (await client.query('SELECT * FROM ramp_orders WHERE id = $1 FOR UPDATE', [order.id])).rows[0]
    if (locked.status !== 'awaiting_rusd') return locked
    return transitionOrder(client, locked, 'rusd_received', {
      fiberPaymentHash: order.invoice_payment_hash,
      fiberStatus: invoice.status,
      rusdReceivedAt: new Date(),
    }, { source: 'operator_invoice' })
  })
  if (updated.status === 'rusd_received') updated = await startB2c(updated.id)
  return updated
}

async function reconcileWithdrawal(order) {
  if (!order || order.kind !== 'withdrawal') return order
  if (order.status === 'rusd_received') return startB2c(order.id)
  if (
    order.status === 'b2c_submitting'
    && new Date(order.updated_at).getTime() <= Date.now() - 120_000
  ) {
    return withTransaction(async (client) => {
      const locked = (await client.query('SELECT * FROM ramp_orders WHERE id = $1 FOR UPDATE', [order.id])).rows[0]
      if (locked.status !== 'b2c_submitting') return locked
      return transitionOrder(client, locked, 'payout_unknown', {
        failureCode: 'B2C_STATUS_UNKNOWN',
        failureMessage: 'M-Pesa payout submission was interrupted and requires independent reconciliation',
      }, { source: 'stale_submission_reconcile' })
    })
  }
  if (order.status !== 'awaiting_rusd') return order

  const invoice = await getFiberInvoice(order.invoice_payment_hash)
  let updated = await acceptPaidWithdrawal(order, invoice)
  if (updated.status === 'awaiting_rusd' && new Date(updated.invoice_expires_at).getTime() <= Date.now() - 120_000) {
    updated = await withTransaction(async (client) => {
      const locked = (await client.query('SELECT * FROM ramp_orders WHERE id = $1 FOR UPDATE', [updated.id])).rows[0]
      if (locked.status !== 'awaiting_rusd') return locked
      const latestInvoice = await getFiberInvoice(locked.invoice_payment_hash)
      if (PAID_INVOICE_STATES.has(latestInvoice?.status)) {
        return transitionOrder(client, locked, 'rusd_received', {
          fiberPaymentHash: locked.invoice_payment_hash,
          fiberStatus: latestInvoice.status,
          rusdReceivedAt: new Date(),
        }, { source: 'operator_invoice_expiry_recheck' })
      }
      return transitionOrder(client, locked, 'invoice_expired', {
        failureCode: 'INVOICE_EXPIRED',
        failureMessage: 'The cash-out invoice expired before payment was confirmed',
      }, { source: 'reconcile' })
    })
    if (updated.status === 'rusd_received') updated = await startB2c(updated.id)
  }
  return updated
}

async function recordCallback({ kind, orderId, conversationId, originatorConversationId, resultCode, receipt, body }) {
  const payloadHash = createHash('sha256').update(JSON.stringify(body)).digest('hex')
  await query(
    `INSERT INTO mpesa_callbacks
       (kind, ramp_order_id, conversation_id, originator_conversation_id, result_code, receipt_number, payload, payload_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (kind, payload_hash) WHERE payload_hash IS NOT NULL DO NOTHING`,
    [kind, orderId || null, conversationId || null, originatorConversationId || null, resultCode, receipt || null, body, payloadHash],
  )
}

async function withdrawalForCallback(conversationId, originatorConversationId) {
  if (!conversationId && !originatorConversationId) return null
  const result = await query(
    `SELECT * FROM ramp_orders
     WHERE kind = 'withdrawal'
       AND (
         ($1::text IS NOT NULL AND conversation_id = $1)
         OR ($2::text IS NOT NULL AND originator_conversation_id = $2)
       )
     LIMIT 2`,
    [conversationId || null, originatorConversationId || null],
  )
  return result.rows.length === 1 ? result.rows[0] : null
}

export function registerRampRoutes(app) {
  app.get('/api/ramp/config', requireAuth, asyncHandler(async (_req, res) => {
    res.json({
      depositsEnabled: depositsEnabled(),
      withdrawalsEnabled: withdrawalsEnabled(),
      minKes: config.ramp.minKes,
      maxKes: config.ramp.maxKes,
      feeBps: config.ramp.feeBps,
      quoteExpiresInSeconds: config.ramp.quoteExpiresInSeconds,
      environment: config.demoMode ? 'demo' : 'pilot',
      asset: 'RUSD',
      network: 'testnet',
    })
  }))

  app.post('/api/ramp/quotes', requireAuth, asyncHandler(async (req, res) => {
    const direction = String(req.body.direction || '').trim().toLowerCase()
    if (direction === 'deposit' && !depositsEnabled()) throw new Error('M-Pesa deposits are not enabled')
    if (direction === 'withdrawal' && !withdrawalsEnabled()) throw new Error('M-Pesa cash-out is not enabled')
    const rate = await getUsdKesRate()
    const quote = calculateRampQuote({
      direction,
      kesAmount: req.body.kesAmount,
      rateKesPerRUsdMicros: rate.rateKesPerRUsdMicros,
      feeBps: config.ramp.feeBps,
      minKes: config.ramp.minKes,
      maxKes: config.ramp.maxKes,
      expiresInSeconds: config.ramp.quoteExpiresInSeconds,
      rateSource: rate.source,
    })
    const result = await query(
      `INSERT INTO ramp_quotes
         (user_id, direction, kes_amount, rate_kes_per_rusd_micros, gross_rusd_base_units,
          fee_rusd_base_units, rusd_amount_base_units, fee_bps, rate_source, quoted_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        req.user.id,
        quote.direction,
        quote.kesAmount,
        quote.rateKesPerRUsdMicros,
        quote.grossRUsdBaseUnits,
        quote.feeRUsdBaseUnits,
        quote.rusdAmountBaseUnits,
        quote.feeBps,
        quote.rateSource,
        quote.quotedAt,
        quote.expiresAt,
      ],
    )
    res.json({ quote: publicQuote(result.rows[0]) })
  }))

  app.get('/api/ramp/orders', requireAuth, asyncHandler(async (req, res) => {
    const result = await query(
      `SELECT * FROM (
         SELECT * FROM ramp_orders
         WHERE user_id = $1
         ORDER BY CASE
           WHEN kind = 'deposit' AND status NOT IN ('completed', 'mpesa_failed', 'quote_expired') THEN 0
           WHEN kind = 'withdrawal' AND status NOT IN ('completed', 'refunded', 'invoice_expired') THEN 0
           ELSE 1
         END, created_at DESC
         LIMIT 30
       ) orders_with_active_priority
       ORDER BY created_at DESC`,
      [req.user.id],
    )
    res.json({ orders: result.rows.map(serializeOrder) })
  }))

  app.post('/api/ramp/deposits', requireAuth, asyncHandler(async (req, res) => {
    if (!depositsEnabled()) throw new Error('M-Pesa deposits are not enabled')
    const idempotencyKey = requireIdempotencyKey(req)
    const quoteId = String(req.body.quoteId || '').trim()
    if (!/^[0-9a-f-]{36}$/i.test(quoteId)) throw new Error('A valid deposit quote is required')
    const pubkey = String(req.user.fiber_pubkey || '').trim().toLowerCase().replace(/^0x/, '')
    if (!/^[0-9a-f]{66}$/.test(pubkey)) throw new Error('Register and unlock this browser wallet before depositing')

    const order = await withTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`wallet-binding-${req.user.id}`])
      const currentWallet = (await client.query(
        'SELECT fiber_pubkey FROM users WHERE id = $1',
        [req.user.id],
      )).rows[0]
      if (String(currentWallet?.fiber_pubkey || '').trim().toLowerCase() !== pubkey) {
        throw new Error('The browser wallet identity changed. Refresh before creating this deposit.')
      }
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`ramp-deposit-${req.user.id}`])
      const existing = await client.query(
        `SELECT * FROM ramp_orders WHERE user_id = $1 AND kind = 'deposit' AND idempotency_key = $2`,
        [req.user.id, idempotencyKey],
      )
      if (existing.rows[0]) {
        if (existing.rows[0].quote_id !== quoteId) throw new Error('This idempotency key belongs to a different quote')
        return existing.rows[0]
      }
      const expired = await client.query(
        `UPDATE ramp_orders
         SET status = 'quote_expired', failure_code = 'QUOTE_EXPIRED',
             failure_message = 'The market quote expired before the M-Pesa prompt started', updated_at = now()
         WHERE user_id = $1 AND kind = 'deposit' AND status IN ('created', 'invoice_ready')
           AND quote_expires_at <= now()
         RETURNING id`,
        [req.user.id],
      )
      for (const expiredOrder of expired.rows) {
        await recordEvent(client, expiredOrder.id, 'quote_expired', { source: 'new_order_preflight' })
      }
      const active = await client.query(
        `SELECT id FROM ramp_orders
         WHERE user_id = $1 AND kind = 'deposit'
           AND status NOT IN ('completed', 'mpesa_failed', 'quote_expired')
         LIMIT 1`,
        [req.user.id],
      )
      if (active.rows[0]) throw new Error('Finish or reconcile the active deposit before creating another')
      const quoteResult = await client.query(
        `SELECT * FROM ramp_quotes
         WHERE id = $1 AND user_id = $2 AND direction = 'deposit' AND expires_at > now()
         FOR UPDATE`,
        [quoteId, req.user.id],
      )
      const quote = quoteResult.rows[0]
      if (!quote) throw new Error('This deposit quote is invalid or expired')
      const created = await client.query(
        `INSERT INTO ramp_orders
           (user_id, quote_id, kind, phone, status, idempotency_key, kes_amount,
            rate_kes_per_rusd_micros, gross_rusd_base_units, fee_rusd_base_units,
            rusd_amount_base_units, fee_bps, rate_source, quoted_at, quote_expires_at, browser_pubkey)
         VALUES ($1,$2,'deposit',$3,'created',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING *`,
        [
          req.user.id, quote.id, req.user.phone, idempotencyKey, quote.kes_amount,
          quote.rate_kes_per_rusd_micros, quote.gross_rusd_base_units, quote.fee_rusd_base_units,
          quote.rusd_amount_base_units, quote.fee_bps, quote.rate_source, quote.quoted_at,
          quote.expires_at, pubkey,
        ],
      )
      await recordEvent(client, created.rows[0].id, 'created', { quoteId })
      return created.rows[0]
    })
    res.json({ order: serializeOrder(order) })
  }))

  app.put('/api/ramp/deposits/:id/invoice', requireAuth, asyncHandler(async (req, res) => {
    const invoiceAddress = String(req.body.invoice || '').trim()
    if (!invoiceAddress) throw new Error('A browser Fiber invoice is required')
    const current = await query(
      `SELECT * FROM ramp_orders WHERE id = $1 AND user_id = $2 AND kind = 'deposit'`,
      [req.params.id, req.user.id],
    )
    const order = current.rows[0]
    if (!order) throw new Error('Deposit order not found')
    if (order.status === 'invoice_ready' && order.browser_invoice === invoiceAddress) {
      return res.json({ order: serializeOrder(order) })
    }
    if (order.status !== 'created') throw new Error(`Deposit invoice cannot be changed while order is ${order.status}`)
    if (new Date(order.quote_expires_at).getTime() <= Date.now()) {
      const expired = await withTransaction(async (client) => {
        const locked = (await client.query('SELECT * FROM ramp_orders WHERE id = $1 FOR UPDATE', [order.id])).rows[0]
        return transitionOrder(client, locked, 'quote_expired', {
          failureCode: 'QUOTE_EXPIRED',
          failureMessage: 'The market quote expired before the receive invoice was attached',
        }, { source: 'invoice_validation' })
      })
      return res.status(409).json({ error: expired.failure_message, order: serializeOrder(expired) })
    }

    await requireDepositRoute(order.browser_pubkey, order.rusd_amount_base_units)
    const parsed = await parseFiberInvoice(invoiceAddress)
    const validated = validateRampInvoice({
      parsed,
      expectedPubkey: order.browser_pubkey,
      expectedAmountBaseUnits: order.rusd_amount_base_units,
      expectedDescription: `Dular deposit ${order.id}`,
      minimumRemainingSeconds: 900,
    })
    const updated = await withTransaction(async (client) => {
      const locked = (await client.query('SELECT * FROM ramp_orders WHERE id = $1 FOR UPDATE', [order.id])).rows[0]
      if (locked.status === 'invoice_ready' && locked.invoice_payment_hash === validated.paymentHash) return locked
      return transitionOrder(client, locked, 'invoice_ready', {
        browserInvoice: invoiceAddress,
        invoicePaymentHash: validated.paymentHash,
        invoiceExpiresAt: validated.expiresAt,
      }, { payeePubkey: validated.payeePubkey })
    })
    res.json({ order: serializeOrder(updated) })
  }))

  app.post('/api/ramp/deposits/:id/stk', requireAuth, asyncHandler(async (req, res) => {
    let order = (await query(
      `SELECT * FROM ramp_orders WHERE id = $1 AND user_id = $2 AND kind = 'deposit'`,
      [req.params.id, req.user.id],
    )).rows[0]
    if (!order) throw new Error('Deposit order not found')
    if (order.checkout_request_id || order.status !== 'invoice_ready') {
      return res.json({ order: serializeOrder(order) })
    }
    const quoteExpired = new Date(order.quote_expires_at).getTime() <= Date.now()
    const invoiceExpired = new Date(order.invoice_expires_at).getTime() <= Date.now() + 60_000
    if (quoteExpired || invoiceExpired) {
      order = await withTransaction(async (client) => {
        const locked = (await client.query('SELECT * FROM ramp_orders WHERE id = $1 FOR UPDATE', [order.id])).rows[0]
        return transitionOrder(client, locked, 'quote_expired', {
          failureCode: quoteExpired ? 'QUOTE_EXPIRED' : 'INVOICE_EXPIRED',
          failureMessage: quoteExpired
            ? 'The market quote expired before the M-Pesa prompt started'
            : 'The browser invoice expired before the M-Pesa prompt started',
        }, { source: 'stk_preflight' })
      })
      return res.status(409).json({ error: order.failure_message, order: serializeOrder(order) })
    }
    await requireDepositRoute(order.browser_pubkey, order.rusd_amount_base_units)
    const submission = await withTransaction(async (client) => {
      const locked = (await client.query('SELECT * FROM ramp_orders WHERE id = $1 FOR UPDATE', [order.id])).rows[0]
      if (locked.status !== 'invoice_ready') return { order: locked, claimed: false }
      const claimed = await transitionOrder(client, locked, 'mpesa_initiating', {}, { source: 'web' })
      return { order: claimed, claimed: true }
    })
    order = submission.order
    if (!submission.claimed) return res.json({ order: serializeOrder(order) })

    try {
      const provider = await initiateStkPush({
        phone: order.phone,
        amountKes: Number(order.kes_amount),
        accountReference: `DLR${order.id.replaceAll('-', '').slice(0, 9)}`,
        callbackUrl: callbackUrl('/api/ramp/callback/stk'),
      })
      order = await withTransaction(async (client) => {
        const currentOrder = (await client.query('SELECT * FROM ramp_orders WHERE id = $1 FOR UPDATE', [order.id])).rows[0]
        return transitionOrder(client, currentOrder, 'mpesa_pending', {
          checkoutRequestId: provider.CheckoutRequestID,
          merchantRequestId: provider.MerchantRequestID,
          providerPayload: mergeProviderPayload(currentOrder.provider_payload, 'stkSubmit', provider),
        }, { source: 'daraja_stk_submit' })
      })
    } catch (error) {
      const definitiveRejection = isDefinitiveDarajaError(error)
      order = await withTransaction(async (client) => {
        const currentOrder = (await client.query('SELECT * FROM ramp_orders WHERE id = $1 FOR UPDATE', [order.id])).rows[0]
        return transitionOrder(client, currentOrder, definitiveRejection ? 'mpesa_failed' : 'mpesa_unknown', {
          failureCode: definitiveRejection ? 'STK_REJECTED' : 'STK_STATUS_UNKNOWN',
          failureMessage: error.message,
        }, {
          source: 'daraja_stk_submit',
          error: error.message,
          definitiveRejection,
        })
      })
    }
    res.json({ order: serializeOrder(order) })
  }))

  app.post('/api/ramp/withdrawals', requireAuth, asyncHandler(async (req, res) => {
    if (!withdrawalsEnabled()) throw new Error('Cash-out is temporarily unavailable while M-Pesa payout credentials are being completed')
    const idempotencyKey = requireIdempotencyKey(req)
    const quoteId = String(req.body.quoteId || '').trim()
    const pubkey = String(req.user.fiber_pubkey || '').trim().toLowerCase().replace(/^0x/, '')
    if (!/^[0-9a-f]{66}$/.test(pubkey)) throw new Error('Register and unlock this browser wallet before cashing out')
    const existing = await query(
      `SELECT * FROM ramp_orders WHERE user_id = $1 AND kind = 'withdrawal' AND idempotency_key = $2`,
      [req.user.id, idempotencyKey],
    )
    if (existing.rows[0]) {
      if (existing.rows[0].quote_id !== quoteId) throw new Error('This idempotency key belongs to a different quote')
      return res.json({ order: serializeOrder(existing.rows[0]) })
    }
    const active = await query(
      `SELECT * FROM ramp_orders
       WHERE user_id = $1 AND kind = 'withdrawal'
         AND status NOT IN ('completed', 'refunded', 'invoice_expired')
       LIMIT 1`,
      [req.user.id],
    )
    if (active.rows[0]) {
      const reconciled = await reconcileWithdrawal(active.rows[0])
      if (!['completed', 'refunded', 'invoice_expired'].includes(reconciled.status)) {
        throw new Error('Finish or reconcile the active cash-out before creating another')
      }
    }
    const quote = (await query(
      `SELECT * FROM ramp_quotes
       WHERE id = $1 AND user_id = $2 AND direction = 'withdrawal' AND expires_at > now()`,
      [quoteId, req.user.id],
    )).rows[0]
    if (!quote) throw new Error('This cash-out quote is invalid or expired')

    const id = randomUUID()
    const operator = await getNodeInfo()
    const invoiceLifetimeSeconds = Math.floor((new Date(quote.expires_at).getTime() - Date.now()) / 1000)
    if (invoiceLifetimeSeconds < 60) throw new Error('This cash-out quote expired before its Fiber invoice could be created')
    const createdInvoice = await createOperatorInvoice({
      amountBaseUnits: quote.rusd_amount_base_units,
      description: `Dular withdrawal ${id}`,
      expiry: `0x${invoiceLifetimeSeconds.toString(16)}`,
    })
    const invoiceAddress = createdInvoice.invoice_address
    const parsed = await parseFiberInvoice(invoiceAddress)
    const validated = validateRampInvoice({
      parsed,
      expectedPubkey: operator.pubkey,
      expectedAmountBaseUnits: quote.rusd_amount_base_units,
      expectedDescription: `Dular withdrawal ${id}`,
    })

    const order = await withTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`wallet-binding-${req.user.id}`])
      const currentWallet = (await client.query(
        'SELECT fiber_pubkey FROM users WHERE id = $1',
        [req.user.id],
      )).rows[0]
      if (String(currentWallet?.fiber_pubkey || '').trim().toLowerCase() !== pubkey) {
        throw new Error('The browser wallet identity changed. Refresh before creating this cash-out.')
      }
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`ramp-withdrawal-${req.user.id}`])
      const replay = (await client.query(
        `SELECT * FROM ramp_orders
         WHERE user_id = $1 AND kind = 'withdrawal' AND idempotency_key = $2`,
        [req.user.id, idempotencyKey],
      )).rows[0]
      if (replay) {
        if (replay.quote_id !== quoteId) throw new Error('This idempotency key belongs to a different quote')
        return replay
      }
      const currentQuote = (await client.query(
        `SELECT * FROM ramp_quotes
         WHERE id = $1 AND user_id = $2 AND direction = 'withdrawal' AND expires_at > now()
         FOR UPDATE`,
        [quoteId, req.user.id],
      )).rows[0]
      if (!currentQuote) throw new Error('This cash-out quote expired before the order was committed')
      if (new Date(validated.expiresAt).getTime() > new Date(currentQuote.expires_at).getTime() + 1000) {
        throw new Error('The cash-out invoice outlives its market quote')
      }
      const concurrentActive = (await client.query(
        `SELECT id FROM ramp_orders
         WHERE user_id = $1 AND kind = 'withdrawal'
           AND status NOT IN ('completed', 'refunded', 'invoice_expired')
         LIMIT 1`,
        [req.user.id],
      )).rows[0]
      if (concurrentActive) throw new Error('Finish or reconcile the active cash-out before creating another')
      const created = await client.query(
        `INSERT INTO ramp_orders
           (id, user_id, quote_id, kind, phone, status, idempotency_key, kes_amount,
            rate_kes_per_rusd_micros, gross_rusd_base_units, fee_rusd_base_units,
            rusd_amount_base_units, fee_bps, rate_source, quoted_at, quote_expires_at,
            browser_pubkey, operator_invoice, invoice_payment_hash, invoice_expires_at)
         VALUES ($1,$2,$3,'withdrawal',$4,'awaiting_rusd',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         RETURNING *`,
        [
          id, req.user.id, currentQuote.id, req.user.phone, idempotencyKey, currentQuote.kes_amount,
          currentQuote.rate_kes_per_rusd_micros, currentQuote.gross_rusd_base_units, currentQuote.fee_rusd_base_units,
          currentQuote.rusd_amount_base_units, currentQuote.fee_bps, currentQuote.rate_source, currentQuote.quoted_at,
          currentQuote.expires_at, pubkey, invoiceAddress, validated.paymentHash, validated.expiresAt,
        ],
      )
      await recordEvent(client, id, 'awaiting_rusd', { invoicePaymentHash: validated.paymentHash })
      return created.rows[0]
    })
    res.json({ order: serializeOrder(order) })
  }))

  app.post('/api/ramp/withdrawals/:id/confirm-fiber', requireAuth, asyncHandler(async (req, res) => {
    const suppliedHash = String(req.body.paymentHash || '').trim().toLowerCase()
    let order = (await query(
      `SELECT * FROM ramp_orders WHERE id = $1 AND user_id = $2 AND kind = 'withdrawal'`,
      [req.params.id, req.user.id],
    )).rows[0]
    if (!order) throw new Error('Cash-out order not found')
    if (order.status !== 'awaiting_rusd') return res.json({ order: serializeOrder(order) })
    if (suppliedHash !== order.invoice_payment_hash) throw new Error('Fiber payment hash does not match the cash-out invoice')
    const invoice = await getFiberInvoice(order.invoice_payment_hash)
    if (!PAID_INVOICE_STATES.has(invoice?.status)) {
      throw new Error(`Cash-out invoice is not paid yet. Current Fiber status: ${invoice?.status || 'Unknown'}`)
    }

    order = await acceptPaidWithdrawal(order, invoice)
    res.json({ order: serializeOrder(order) })
  }))

  app.put('/api/ramp/withdrawals/:id/refund-invoice', requireAuth, asyncHandler(async (req, res) => {
    const invoiceAddress = String(req.body.invoice || '').trim()
    let order = (await query(
      `SELECT * FROM ramp_orders WHERE id = $1 AND user_id = $2 AND kind = 'withdrawal'`,
      [req.params.id, req.user.id],
    )).rows[0]
    if (!order) throw new Error('Cash-out order not found')
    const staleRefundSend = isRefundLeaseStale(order)
    if (!['payout_failed', 'refund_pending'].includes(order.status) && !staleRefundSend) {
      throw new Error('This cash-out is not awaiting a refund invoice')
    }
    let replacingExpiredInvoice = false
    if (['refund_pending', 'refund_sending'].includes(order.status) && order.refund_invoice && order.refund_invoice !== invoiceAddress) {
      if (
        !['refund_pending', 'refund_sending'].includes(order.status)
        || (order.status === 'refund_sending' && !staleRefundSend)
        || !order.refund_invoice_expires_at
        || new Date(order.refund_invoice_expires_at).getTime() > Date.now()
      ) {
        throw new Error('This cash-out already has a different refund invoice')
      }
      let previousPayment
      try {
        previousPayment = await getFiberPaymentDirect(order.refund_payment_hash)
      } catch (error) {
        if (!/not found|no payment|unknown payment/i.test(error.message || '')) {
          throw new Error('Could not authoritatively verify the expired refund invoice', { cause: error })
        }
        previousPayment = null
      }
      const expiredInvoiceAction = expiredRefundInvoiceAction(previousPayment)
      if (expiredInvoiceAction === 'finalize') {
        order = await withTransaction(async (client) => {
          let locked = (await client.query('SELECT * FROM ramp_orders WHERE id = $1 FOR UPDATE', [order.id])).rows[0]
          if (locked.refund_payment_hash !== order.refund_payment_hash) return locked
          if (locked.status === 'refund_pending') {
            locked = await transitionOrder(client, locked, 'refund_sending', {
              refundLeaseToken: null,
            }, { source: 'expired_invoice_reconcile' })
          } else if (!isRefundLeaseStale(locked)) {
            return locked
          }
          return transitionOrder(client, locked, 'refunded', {
            refundPaymentHash: previousPayment.payment_hash || locked.refund_payment_hash,
            refundLeaseToken: null,
            refundedAt: new Date(),
            failureMessage: null,
          }, { source: 'expired_invoice_reconcile' })
        })
        return res.json({ order: serializeOrder(order) })
      }
      if (expiredInvoiceAction === 'wait') {
        throw new Error('The existing refund payment is still pending and cannot be replaced')
      }
      replacingExpiredInvoice = true
    }
    await requireDepositRoute(order.browser_pubkey, order.rusd_amount_base_units)
    const parsed = await parseFiberInvoice(invoiceAddress)
    const validated = validateRampInvoice({
      parsed,
      expectedPubkey: order.browser_pubkey,
      expectedAmountBaseUnits: order.rusd_amount_base_units,
      expectedDescription: `Dular refund ${order.id}`,
    })
    const leaseToken = randomUUID()
    const refundClaim = await withTransaction(async (client) => {
      let locked = (await client.query('SELECT * FROM ramp_orders WHERE id = $1 FOR UPDATE', [order.id])).rows[0]
      const staleLease = isRefundLeaseStale(locked)
      if (locked.refund_invoice && locked.refund_invoice !== invoiceAddress) {
        const replaceable = replacingExpiredInvoice
          && (locked.status === 'refund_pending' || staleLease)
          && locked.refund_invoice_expires_at
          && new Date(locked.refund_invoice_expires_at).getTime() <= Date.now()
        if (!replaceable) throw new Error('This cash-out already has a different refund invoice')
        if (staleLease) {
          locked = await transitionOrder(client, locked, 'refund_pending', {
            refundLeaseToken: null,
          }, { source: 'stale_refund_worker_recovered' })
        }
        locked = await transitionOrder(client, locked, 'refund_pending', {
          refundInvoice: invoiceAddress,
          refundPaymentHash: validated.paymentHash,
          refundInvoiceExpiresAt: validated.expiresAt,
          refundLeaseToken: null,
        }, { source: 'expired_refund_invoice_replaced' })
      }
      if (locked.status === 'payout_failed') {
        locked = await transitionOrder(client, locked, 'refund_pending', {
          refundInvoice: invoiceAddress,
          refundPaymentHash: validated.paymentHash,
          refundInvoiceExpiresAt: validated.expiresAt,
          refundLeaseToken: null,
        }, { source: 'browser_refund_invoice' })
      }
      if (locked.status !== 'refund_pending' && !staleLease) return { order: locked, claimed: false }
      const claimed = await transitionOrder(client, locked, 'refund_sending', {
        refundLeaseToken: leaseToken,
      }, { source: 'refund_worker', leaseToken })
      return { order: claimed, claimed: true }
    })
    order = refundClaim.order
    if (!refundClaim.claimed) throw new Error('This cash-out refund is already being processed')
    const persistedInvoice = order.refund_invoice
    const persistedPaymentHash = order.refund_payment_hash
    const renewRefundLease = async () => {
      const renewed = await query(
        `UPDATE ramp_orders SET updated_at = now()
         WHERE id = $1 AND status = 'refund_sending' AND refund_lease_token = $2
         RETURNING id`,
        [order.id, leaseToken],
      )
      if (!renewed.rows[0]) {
        const error = new Error('Refund worker no longer owns the payment lease')
        error.code = 'RAMP_STATE_CHANGED'
        throw error
      }
    }

    try {
      await renewRefundLease()
      let payment = await getFiberPayment(persistedPaymentHash)
      let workerAction = refundWorkerAction(payment)
      if (workerAction === 'wait') {
        payment = await waitForFiberPayment(persistedPaymentHash, 20, renewRefundLease)
        workerAction = refundWorkerAction(payment)
      }
      if (workerAction === 'wait') {
        throw new Error(`Refund payment is still ${paymentState(payment)} and will not be resent`)
      }
      if (workerAction === 'send') {
        await renewRefundLease()
        payment = await sendFiberPayment(persistedInvoice)
      }
      const finalPayment = SUCCESS_PAYMENT_STATES.has(paymentState(payment))
        ? payment
        : await waitForFiberPayment(payment?.payment_hash || persistedPaymentHash, 20, renewRefundLease)
      if (!SUCCESS_PAYMENT_STATES.has(paymentState(finalPayment))) {
        throw new Error(`Refund payment is ${paymentState(finalPayment)}`)
      }
      order = await withTransaction(async (client) => {
        const locked = (await client.query('SELECT * FROM ramp_orders WHERE id = $1 FOR UPDATE', [order.id])).rows[0]
        if (locked.status !== 'refund_sending' || locked.refund_lease_token !== leaseToken) return locked
        return transitionOrder(client, locked, 'refunded', {
          refundPaymentHash: finalPayment.payment_hash || persistedPaymentHash,
          refundLeaseToken: null,
          refundedAt: new Date(),
          failureMessage: null,
        }, { source: 'fiber_refund' })
      })
    } catch (error) {
      if (error.code === 'RAMP_STATE_CHANGED') {
        order = (await query('SELECT * FROM ramp_orders WHERE id = $1', [order.id])).rows[0]
      } else {
        order = await withTransaction(async (client) => {
          const locked = (await client.query('SELECT * FROM ramp_orders WHERE id = $1 FOR UPDATE', [order.id])).rows[0]
          if (locked.status !== 'refund_sending' || locked.refund_lease_token !== leaseToken) return locked
          return transitionOrder(client, locked, 'refund_pending', {
            refundLeaseToken: null,
            failureMessage: error.message,
          }, { source: 'fiber_refund', error: error.message })
        })
      }
    }
    res.json({ order: serializeOrder(order) })
  }))

  app.post('/api/ramp/orders/:id/reconcile', requireAuth, asyncHandler(async (req, res) => {
    let order = (await query(
      `SELECT * FROM ramp_orders WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id],
    )).rows[0]
    if (!order) throw new Error('M-Pesa order not found')
    if (
      order.kind === 'deposit'
      && ['created', 'invoice_ready'].includes(order.status)
      && (
        new Date(order.quote_expires_at).getTime() <= Date.now()
        || (order.invoice_expires_at && new Date(order.invoice_expires_at).getTime() <= Date.now() + 60_000)
      )
    ) {
      order = await withTransaction(async (client) => {
        const locked = (await client.query('SELECT * FROM ramp_orders WHERE id = $1 FOR UPDATE', [order.id])).rows[0]
        const invoiceExpired = Boolean(order.invoice_expires_at)
          && new Date(order.invoice_expires_at).getTime() <= Date.now() + 60_000
        return transitionOrder(client, locked, 'quote_expired', {
          failureCode: invoiceExpired ? 'INVOICE_EXPIRED' : 'QUOTE_EXPIRED',
          failureMessage: invoiceExpired
            ? 'The browser invoice expired before the M-Pesa prompt started'
            : 'The market quote expired before the deposit was prepared',
        }, { source: 'reconcile' })
      })
    } else if (order.kind === 'deposit' && ACTIVE_DEPOSIT_STATES.has(order.status)) {
      order = await reconcileDeposit(order)
    } else if (order.kind === 'withdrawal') {
      order = await reconcileWithdrawal(order)
    }
    res.json({ order: serializeOrder(order) })
  }))

  app.post('/api/ramp/operator/orders/:id/adjudicate', requireRampOperator, asyncHandler(async (req, res) => {
    const decision = String(req.body.decision || '').trim()
    const evidenceReference = String(req.body.evidenceReference || '').trim()
    if (evidenceReference.length < 8 || evidenceReference.length > 256) {
      throw new Error('An audited provider evidence reference is required')
    }

    let order = (await query('SELECT * FROM ramp_orders WHERE id = $1', [req.params.id])).rows[0]
    if (!order) throw new Error('M-Pesa order not found')

    if (decision === 'attach_stk_reference') {
      if (order.kind !== 'deposit') throw new Error('STK references apply only to deposit orders')
      const checkoutRequestId = String(req.body.checkoutRequestId || '').trim()
      const merchantRequestId = String(req.body.merchantRequestId || '').trim()
      if (checkoutRequestId.length < 8 || checkoutRequestId.length > 128) {
        throw new Error('A valid CheckoutRequestID is required')
      }
      order = await withTransaction(async (client) => {
        const locked = (await client.query('SELECT * FROM ramp_orders WHERE id = $1 FOR UPDATE', [order.id])).rows[0]
        if (!['mpesa_initiating', 'mpesa_unknown', 'mpesa_pending'].includes(locked.status)) {
          throw new Error(`STK evidence cannot be attached while the order is ${locked.status}`)
        }
        if (locked.checkout_request_id && locked.checkout_request_id !== checkoutRequestId) {
          throw new Error('This order already has a different CheckoutRequestID')
        }
        return transitionOrder(client, locked, 'mpesa_pending', {
          checkoutRequestId,
          merchantRequestId: merchantRequestId || locked.merchant_request_id,
          failureCode: null,
          failureMessage: null,
          providerPayload: mergeProviderPayload(locked.provider_payload, 'operatorAdjudication', {
            decision,
            evidenceReference,
            checkoutRequestId,
            merchantRequestId: merchantRequestId || null,
          }),
        }, { source: 'operator_adjudication', evidenceReference })
      })
      order = await reconcileDeposit(order)
      return res.json({ order: serializeOrder(order) })
    }

    if (!['payout_failed', 'payout_completed'].includes(decision) || order.kind !== 'withdrawal') {
      throw new Error('A valid withdrawal adjudication decision is required')
    }
    const resultCode = providerResultCode(req.body.resultCode)
    const receiptNumber = String(req.body.receiptNumber || '').trim()
    if (decision === 'payout_failed' && (resultCode === null || resultCode === 0)) {
      throw new Error('A nonzero provider result code is required for a failed payout decision')
    }
    if (decision === 'payout_completed' && !receiptNumber) {
      throw new Error('A provider receipt is required for a completed payout decision')
    }

    order = await withTransaction(async (client) => {
      const locked = (await client.query('SELECT * FROM ramp_orders WHERE id = $1 FOR UPDATE', [order.id])).rows[0]
      if (!['b2c_submitting', 'b2c_pending', 'payout_unknown'].includes(locked.status)) {
        throw new Error(`Payout evidence cannot be applied while the order is ${locked.status}`)
      }
      const completed = decision === 'payout_completed'
      return transitionOrder(client, locked, completed ? 'completed' : 'payout_failed', {
        receiptNumber: completed ? receiptNumber : locked.receipt_number,
        completedAt: completed ? new Date() : null,
        failureCode: completed ? null : String(resultCode),
        failureMessage: completed ? null : `M-Pesa payout failure was independently verified with result code ${resultCode}`,
        providerPayload: mergeProviderPayload(locked.provider_payload, 'operatorAdjudication', {
          decision,
          evidenceReference,
          resultCode,
          receiptNumber: receiptNumber || null,
        }),
      }, { source: 'operator_adjudication', evidenceReference, resultCode })
    })
    res.json({ order: serializeOrder(order) })
  }))

  app.post('/api/ramp/callback/stk', requireRampCallback, asyncHandler(async (req, res) => {
    const callback = req.body?.Body?.stkCallback || req.body?.stkCallback || req.body
    const checkoutRequestId = callback?.CheckoutRequestID
    const order = checkoutRequestId
      ? (await query(`SELECT * FROM ramp_orders WHERE checkout_request_id = $1 AND kind = 'deposit'`, [checkoutRequestId])).rows[0]
      : null
    const metadata = stkMetadata(callback)
    await recordCallback({
      kind: 'ramp-stk',
      orderId: order?.id,
      conversationId: checkoutRequestId,
      resultCode: String(callback?.ResultCode ?? ''),
      receipt: metadata.receipt,
      body: req.body,
    })
    if (order && ACTIVE_DEPOSIT_STATES.has(order.status)) {
      await query(
        `UPDATE ramp_orders
         SET provider_payload = provider_payload || $2::jsonb, updated_at = now()
         WHERE id = $1`,
        [order.id, JSON.stringify({ stkCallback: callback, stkCallbackAt: new Date().toISOString() })],
      )
      const refreshed = (await query('SELECT * FROM ramp_orders WHERE id = $1', [order.id])).rows[0]
      await reconcileDeposit(refreshed, callback)
    } else if (order?.status === 'completed' && metadata.receipt && !order.receipt_number) {
      const callbackPhone = normalizeCallbackPhone(metadata.phone)
      const amountMatches = metadata.amount === null || metadata.amount === Number(order.kes_amount)
      const phoneMatches = !callbackPhone || callbackPhone === order.phone
      if (amountMatches && phoneMatches) {
        await query('UPDATE ramp_orders SET receipt_number = $2, updated_at = now() WHERE id = $1', [order.id, metadata.receipt])
      }
    }
    res.json({ ok: true })
  }))

  app.post('/api/ramp/callback/b2c', requireRampCallback, asyncHandler(async (req, res) => {
    const result = req.body?.Result || req.body
    const conversationId = result?.ConversationID
    const originatorConversationId = result?.OriginatorConversationID
    const order = await withdrawalForCallback(conversationId, originatorConversationId)
    const receipt = result?.ResultParameters?.ResultParameter
      ?.find((item) => item.Key === 'TransactionReceipt')?.Value
    await recordCallback({
      kind: 'ramp-b2c',
      orderId: order?.id,
      conversationId,
      originatorConversationId,
      resultCode: String(result?.ResultCode ?? ''),
      receipt,
      body: req.body,
    })
    if (order && ['b2c_submitting', 'b2c_pending', 'payout_unknown'].includes(order.status)) {
      await withTransaction(async (client) => {
        const locked = (await client.query('SELECT * FROM ramp_orders WHERE id = $1 FOR UPDATE', [order.id])).rows[0]
        const resultCode = providerResultCode(result.ResultCode)
        const success = resultCode === 0
        return transitionOrder(client, locked, success ? 'completed' : 'payout_unknown', {
          receiptNumber: receipt || locked.receipt_number,
          completedAt: success ? new Date() : null,
          failureCode: success ? null : 'B2C_STATUS_UNKNOWN',
          failureMessage: success
            ? null
            : resultCode === null
              ? 'M-Pesa callback did not include a valid result code'
              : `M-Pesa reported payout code ${resultCode}; independent reconciliation is required`,
          providerPayload: mergeProviderPayload(locked.provider_payload, 'b2cCallback', result),
        }, { source: 'daraja_b2c_callback', resultCode: String(result.ResultCode) })
      })
    }
    res.json({ ok: true })
  }))

  app.post('/api/ramp/callback/b2c-timeout', requireRampCallback, asyncHandler(async (req, res) => {
    const result = req.body?.Result || req.body
    const conversationId = result?.ConversationID
    const originatorConversationId = result?.OriginatorConversationID
    const order = await withdrawalForCallback(conversationId, originatorConversationId)
    await recordCallback({
      kind: 'ramp-b2c-timeout',
      orderId: order?.id,
      conversationId,
      originatorConversationId,
      resultCode: 'timeout',
      body: req.body,
    })
    if (order && ['b2c_submitting', 'b2c_pending'].includes(order.status)) {
      await withTransaction(async (client) => {
        const locked = (await client.query('SELECT * FROM ramp_orders WHERE id = $1 FOR UPDATE', [order.id])).rows[0]
        return transitionOrder(client, locked, 'payout_unknown', {
          failureCode: 'B2C_STATUS_UNKNOWN',
          failureMessage: 'M-Pesa payout status is unknown and requires reconciliation',
        }, { source: 'daraja_b2c_timeout' })
      })
    }
    res.json({ ok: true })
  }))

  app.get('/api/verification/ramp/:id', asyncHandler(async (req, res) => {
    const order = (await query(
      `SELECT * FROM ramp_orders WHERE id = $1 AND status IN ('completed', 'refunded')`,
      [req.params.id],
    )).rows[0]
    if (!order) return res.status(404).json({ error: 'Completed ramp order not found' })
    const events = await query(
      `SELECT status, metadata, created_at FROM ramp_order_events WHERE order_id = $1 ORDER BY created_at`,
      [order.id],
    )
    const proof = serializeOrder(order)
    proof.phone = `${order.phone.slice(0, 5)}***${order.phone.slice(-3)}`
    res.json({ order: proof, events: events.rows })
  }))
}
