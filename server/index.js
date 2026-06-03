import express from 'express'
import cors from 'cors'
import { config } from './config.js'
import { query, withTransaction } from './db.js'
import { requireAuth } from './auth.js'
import { sendOtpSms } from './services/africasTalking.js'
import { initiateB2c, initiateStkPush, queryStkPushStatus } from './services/daraja.js'
import { createReceiverInvoice, getNodePubkey, getReceiverNodeInfo } from './services/fiber.js'
import { credit, debit, ensureLedgerAccount } from './services/ledger.js'
import { createFiberBackedDepositSettlement } from './services/settlement.js'
import {
  asyncHandler,
  createOtp,
  createToken,
  hashOtp,
  hashValue,
  normalizePhone,
  parseBaseUnits,
  publicUser,
  toRUsdBaseUnits,
} from './utils.js'

const app = express()

app.use(cors())
app.use(express.json({ limit: '1mb' }))

function readStkReceipt(payload) {
  const items = payload?.Body?.stkCallback?.CallbackMetadata?.Item
    || payload?.stkCallback?.CallbackMetadata?.Item
    || payload?.CallbackMetadata?.Item
    || []
  return items.find((item) => item.Name === 'MpesaReceiptNumber')?.Value || payload?.MpesaReceiptNumber || null
}

function readResultCode(payload) {
  if (payload?.ResultCode === undefined || payload?.ResultCode === null) return null
  const resultCode = Number(payload.ResultCode)
  return Number.isFinite(resultCode) ? resultCode : null
}

function mergePayload(key, payload) {
  return JSON.stringify({
    [key]: payload,
    [`${key}At`]: new Date().toISOString(),
  })
}

async function settlePaidDeposit(client, tx, { receipt, checkoutRequestId, providerPayload, providerKey = 'stkResult' }) {
  const updated = await client.query(
    `UPDATE mpesa_transactions
     SET status = 'mpesa_paid_fiber_pending',
         receipt_number = COALESCE($2, receipt_number),
         provider_payload = COALESCE(provider_payload, '{}'::jsonb) || $3::jsonb,
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [tx.id, receipt || null, mergePayload(providerKey, providerPayload)],
  )

  try {
    await createFiberBackedDepositSettlement(client, updated.rows[0], {
      receipt: receipt || updated.rows[0].receipt_number,
      checkoutRequestId,
    })
  } catch (error) {
    console.error('Fiber deposit settlement failed', error)
    await client.query(
      `UPDATE mpesa_transactions
       SET status = 'mpesa_paid_fiber_pending',
           fiber_status = 'ActionRequired',
           provider_payload = COALESCE(provider_payload, '{}'::jsonb) || $2::jsonb,
           updated_at = now()
       WHERE id = $1`,
      [tx.id, mergePayload('fiberSettlementError', { message: error.message })],
    )
  }

  const latest = await client.query('SELECT * FROM mpesa_transactions WHERE id = $1', [tx.id])
  return latest.rows[0]
}

async function applyStkResult(client, tx, payload, providerKey) {
  const resultCode = readResultCode(payload)
  const receipt = readStkReceipt(payload)
  if (resultCode === 0) {
    return settlePaidDeposit(client, tx, {
      receipt,
      checkoutRequestId: tx.checkout_request_id || payload?.CheckoutRequestID,
      providerPayload: payload,
      providerKey,
    })
  }

  if (resultCode === null) {
    const updated = await client.query(
      `UPDATE mpesa_transactions
       SET provider_payload = COALESCE(provider_payload, '{}'::jsonb) || $2::jsonb,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [tx.id, mergePayload(providerKey, payload)],
    )
    return updated.rows[0]
  }

  const updated = await client.query(
    `UPDATE mpesa_transactions
     SET status = 'failed',
         provider_payload = COALESCE(provider_payload, '{}'::jsonb) || $2::jsonb,
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [tx.id, mergePayload(providerKey, payload)],
  )
  return updated.rows[0]
}

app.get('/api/health', asyncHandler(async (_req, res) => {
  const db = await query('SELECT now() AS now')
  res.json({ ok: true, mode: config.demoMode ? 'demo' : 'production', dbTime: db.rows[0].now })
}))

app.post('/api/auth/request-otp', asyncHandler(async (req, res) => {
  const phone = normalizePhone(req.body.phone)
  const code = createOtp()
  const codeHash = hashOtp(phone, code)
  await query(
    `INSERT INTO otp_requests (phone, code_hash, expires_at)
     VALUES ($1, $2, now() + interval '10 minutes')`,
    [phone, codeHash],
  )
  const sms = await sendOtpSms(phone, code)
  res.json({
    ok: true,
    phone,
    expiresInSeconds: 600,
    demoCode: config.demoMode ? sms.code : undefined,
  })
}))

app.post('/api/auth/verify-otp', asyncHandler(async (req, res) => {
  const phone = normalizePhone(req.body.phone)
  const code = String(req.body.code || '').trim()
  if (!/^\d{6}$/.test(code)) throw new Error('Enter the 6 digit verification code')

  const result = await withTransaction(async (client) => {
    const otp = await client.query(
      `SELECT * FROM otp_requests
       WHERE phone = $1 AND consumed_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC
       LIMIT 1
       FOR UPDATE`,
      [phone],
    )
    const row = otp.rows[0]
    if (!row) throw new Error('No active OTP. Request a new code.')
    if (row.attempts >= 5) throw new Error('Too many OTP attempts. Request a new code.')

    await client.query('UPDATE otp_requests SET attempts = attempts + 1 WHERE id = $1', [row.id])
    if (row.code_hash !== hashOtp(phone, code)) throw new Error('Invalid verification code')
    await client.query('UPDATE otp_requests SET consumed_at = now() WHERE id = $1', [row.id])

    let fiberPubkey
    try {
      fiberPubkey = await getNodePubkey()
    } catch {
      fiberPubkey = null
    }

    const user = await client.query(
      `INSERT INTO users (phone, fiber_pubkey, verified_at)
       VALUES ($1, $2, now())
       ON CONFLICT (phone) DO UPDATE
       SET verified_at = now(),
           fiber_pubkey = COALESCE(EXCLUDED.fiber_pubkey, users.fiber_pubkey),
           updated_at = now()
       RETURNING *`,
      [phone, fiberPubkey],
    )
    await ensureLedgerAccount(client, user.rows[0].id)

    const token = createToken()
    await client.query(
      `INSERT INTO sessions (token_hash, user_id, expires_at)
       VALUES ($1, $2, now() + interval '14 days')`,
      [hashValue(token), user.rows[0].id],
    )

    const account = await client.query(
      'SELECT balance_base_units FROM ledger_accounts WHERE user_id = $1',
      [user.rows[0].id],
    )
    return { token, user: publicUser(user.rows[0], account.rows[0]?.balance_base_units || '0') }
  })

  res.json(result)
}))

app.get('/api/me', requireAuth, asyncHandler(async (req, res) => {
  res.json({ user: publicUser(req.user, req.user.balance_base_units || '0') })
}))

app.get('/api/registry/lookup', asyncHandler(async (req, res) => {
  const phone = normalizePhone(req.query.phone)
  const result = await query(
    `SELECT phone, fiber_pubkey, verified_at FROM users
     WHERE phone = $1 AND verified_at IS NOT NULL`,
    [phone],
  )
  if (!result.rows[0]) return res.status(404).json({ error: 'Phone number is not registered' })
  res.json({
    phone: result.rows[0].phone,
    fiberPubkey: result.rows[0].fiber_pubkey,
    verifiedAt: result.rows[0].verified_at,
  })
}))

app.get('/api/fiber/receiver', asyncHandler(async (_req, res) => {
  const info = await getReceiverNodeInfo()
  res.json({
    receiver: {
      rpcUrl: config.fiberReceiverRpcUrl,
      ckbAddress: config.fiberReceiverCkbAddress,
      pubkey: info.pubkey,
      peersCount: info.peers_count,
      channelCount: info.channel_count,
      pendingChannelCount: info.pending_channel_count,
      defaultFundingLockScript: info.default_funding_lock_script,
    },
  })
}))

app.post('/api/fiber/receiver/invoice', requireAuth, asyncHandler(async (req, res) => {
  const amountKes = Number(req.body.amountKes)
  const amountBaseUnits = toRUsdBaseUnits(amountKes)
  const invoice = await createReceiverInvoice({
    amountBaseUnits,
    description: `Dular M-Pesa deposit for ${req.user.phone}`,
  })
  const paymentHash = invoice.payment_hash || invoice.invoice?.data?.payment_hash
  if (!paymentHash) throw new Error('Receiver Fiber invoice did not include a payment hash')
  res.json({
    invoice: invoice.invoice_address,
    paymentHash,
    amountBaseUnits: amountBaseUnits.toString(),
    receiverRpcUrl: config.fiberReceiverRpcUrl,
  })
}))

app.get('/api/transactions', requireAuth, asyncHandler(async (req, res) => {
  const result = await query(
    `(SELECT
        id::text,
        kind,
        status,
        phone,
        kes_amount,
        rusd_base_units,
        checkout_request_id,
        merchant_request_id,
        conversation_id,
        originator_conversation_id,
        receipt_number,
        fiber_invoice,
        fiber_payment_hash,
        fiber_status,
        fiber_fee_base_units,
        fiber_route,
        credited_at,
        provider_payload,
        created_at,
        updated_at
      FROM mpesa_transactions
      WHERE user_id = $1)
     UNION ALL
     (SELECT
        id::text,
        CASE WHEN direction = 'debit' THEN 'phone_send' ELSE 'phone_receive' END AS kind,
        status,
        COALESCE(metadata->>'recipientPhone', metadata->>'senderPhone') AS phone,
        NULL::numeric AS kes_amount,
        amount_base_units AS rusd_base_units,
        NULL::text AS checkout_request_id,
        NULL::text AS merchant_request_id,
        NULL::text AS conversation_id,
        NULL::text AS originator_conversation_id,
        NULL::text AS receipt_number,
        NULL::text AS fiber_invoice,
        NULL::text AS fiber_payment_hash,
        NULL::text AS fiber_status,
        NULL::numeric AS fiber_fee_base_units,
        '[]'::jsonb AS fiber_route,
        CASE WHEN status = 'posted' THEN created_at ELSE NULL END AS credited_at,
        jsonb_build_object(
          'sourceId', source_id,
          'direction', direction,
          'counterpartyPhone', COALESCE(metadata->>'recipientPhone', metadata->>'senderPhone')
        ) AS provider_payload,
        created_at,
        created_at AS updated_at
      FROM ledger_entries
      WHERE user_id = $1 AND source_type = 'phone_payment')
     ORDER BY created_at DESC
     LIMIT 25`,
    [req.user.id],
  )
  res.json({ transactions: result.rows })
}))

app.get('/api/verification/deposit/:checkoutRequestId', asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT
       m.id,
       m.kind,
       m.phone,
       m.kes_amount,
       m.rusd_base_units,
       m.status,
       m.checkout_request_id,
       m.merchant_request_id,
       m.receipt_number,
       m.fiber_invoice,
       m.fiber_payment_hash,
       m.fiber_status,
       m.fiber_fee_base_units,
       m.fiber_route,
       m.credited_at,
       m.created_at,
       f.route AS payment_route,
       f.status AS payment_status
     FROM mpesa_transactions m
     LEFT JOIN fiber_payments f ON f.payment_hash = m.fiber_payment_hash
     WHERE m.checkout_request_id = $1`,
    [req.params.checkoutRequestId],
  )
  if (!result.rows[0]) return res.status(404).json({ error: 'Deposit not found' })
  res.json({ deposit: result.rows[0] })
}))

app.post('/api/mpesa/deposits/:id/settle-fiber', requireAuth, asyncHandler(async (req, res) => {
  const result = await withTransaction(async (client) => {
    const tx = await client.query(
      `SELECT * FROM mpesa_transactions
       WHERE id = $1 AND user_id = $2 AND kind = 'deposit'
       FOR UPDATE`,
      [req.params.id, req.user.id],
    )
    if (!tx.rows[0]) throw new Error('Deposit transaction not found')
    if (tx.rows[0].status !== 'mpesa_paid_fiber_pending') {
      throw new Error(`Deposit is not pending Fiber settlement: ${tx.rows[0].status}`)
    }
    return createFiberBackedDepositSettlement(client, tx.rows[0], {
      receipt: tx.rows[0].receipt_number,
      checkoutRequestId: tx.rows[0].checkout_request_id,
    })
  })
  res.json({ ok: true, settlement: result })
}))

app.post('/api/mpesa/deposits/:id/reconcile', requireAuth, asyncHandler(async (req, res) => {
  const current = await query(
    `SELECT * FROM mpesa_transactions
     WHERE id = $1 AND user_id = $2 AND kind = 'deposit'`,
    [req.params.id, req.user.id],
  )
  const currentTx = current.rows[0]
  if (!currentTx) return res.status(404).json({ error: 'Deposit transaction not found' })

  let stkQuery = null
  if (['initiating', 'pending'].includes(currentTx.status) && currentTx.checkout_request_id) {
    stkQuery = await queryStkPushStatus({ checkoutRequestId: currentTx.checkout_request_id })
  }

  const transaction = await withTransaction(async (client) => {
    const locked = await client.query(
      `SELECT * FROM mpesa_transactions
       WHERE id = $1 AND user_id = $2 AND kind = 'deposit'
       FOR UPDATE`,
      [req.params.id, req.user.id],
    )
    const tx = locked.rows[0]
    if (!tx) throw new Error('Deposit transaction not found')
    if (['completed', 'failed'].includes(tx.status)) return tx

    if (tx.status === 'mpesa_paid_fiber_pending') {
      return settlePaidDeposit(client, tx, {
        receipt: tx.receipt_number,
        checkoutRequestId: tx.checkout_request_id,
        providerPayload: { source: 'reconcile', message: 'Retrying pending Fiber settlement' },
        providerKey: 'fiberReconcile',
      })
    }

    if (!stkQuery) {
      return tx
    }

    return applyStkResult(client, tx, stkQuery, 'stkQuery')
  })

  res.json({ transaction, provider: stkQuery })
}))

app.post('/api/mpesa/deposit', requireAuth, asyncHandler(async (req, res) => {
  const amountKes = Number(req.body.amountKes)
  const fiberInvoice = String(req.body.fiberInvoice || '').trim()
  const fiberInvoicePaymentHash = String(req.body.fiberInvoicePaymentHash || '').trim()
  if (!fiberInvoice) throw new Error('A receiver Fiber invoice is required for testnet-backed deposits')
  if (!fiberInvoicePaymentHash) throw new Error('Receiver Fiber invoice payment hash is required')
  const rusdBaseUnits = toRUsdBaseUnits(amountKes)
  const tx = await query(
    `INSERT INTO mpesa_transactions
       (user_id, kind, phone, kes_amount, rusd_base_units, status, fiber_invoice, provider_payload)
     VALUES ($1, 'deposit', $2, $3, $4, 'initiating', $5, $6)
     RETURNING *`,
    [
      req.user.id,
      req.user.phone,
      amountKes,
      rusdBaseUnits.toString(),
      fiberInvoice,
      { requestedAt: new Date().toISOString(), fiberInvoicePaymentHash },
    ],
  )

  try {
    const mpesa = await initiateStkPush({
      phone: req.user.phone,
      amountKes,
      accountReference: `DULAR-${req.user.phone}`,
    })
    const updated = await query(
      `UPDATE mpesa_transactions
       SET status = 'pending',
           checkout_request_id = $2,
           merchant_request_id = $3,
           provider_payload = COALESCE(provider_payload, '{}'::jsonb) || $4::jsonb,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [tx.rows[0].id, mpesa.CheckoutRequestID, mpesa.MerchantRequestID, mergePayload('stkPush', mpesa)],
    )
    res.json({ transaction: updated.rows[0], provider: mpesa })
  } catch (error) {
    await query(
      `UPDATE mpesa_transactions
       SET status = 'failed',
           provider_payload = COALESCE(provider_payload, '{}'::jsonb) || $2::jsonb,
           updated_at = now()
       WHERE id = $1`,
      [tx.rows[0].id, JSON.stringify({ stkError: error.message })],
    )
    throw error
  }
}))

app.post('/api/mpesa/withdraw', requireAuth, asyncHandler(async (req, res) => {
  const amountKes = Number(req.body.amountKes)
  const rusdBaseUnits = toRUsdBaseUnits(amountKes)
  const provider = await initiateB2c({
    phone: req.user.phone,
    amountKes,
    remarks: 'Dular RUSD withdrawal',
  })

  const tx = await withTransaction(async (client) => {
    const created = await client.query(
      `INSERT INTO mpesa_transactions
         (user_id, kind, phone, kes_amount, rusd_base_units, status, conversation_id, originator_conversation_id, provider_payload)
       VALUES ($1, 'withdrawal', $2, $3, $4, 'pending', $5, $6, $7)
       RETURNING *`,
      [
        req.user.id,
        req.user.phone,
        amountKes,
        rusdBaseUnits.toString(),
        provider.ConversationID,
        provider.OriginatorConversationID,
        provider,
      ],
    )
    await debit(client, {
      userId: req.user.id,
      amount: rusdBaseUnits,
      sourceType: 'mpesa_withdrawal',
      sourceId: created.rows[0].id,
      metadata: { phone: req.user.phone, amountKes },
    })
    return created.rows[0]
  })

  res.json({ transaction: tx, provider })
}))

app.post('/api/payments/send-phone', requireAuth, asyncHandler(async (req, res) => {
  const recipientPhone = normalizePhone(req.body.phone)
  const amount = parseBaseUnits(req.body.amountBaseUnits)
  if (recipientPhone === req.user.phone) throw new Error('Cannot send to your own phone number')

  const result = await withTransaction(async (client) => {
    const recipient = await client.query(
      `SELECT * FROM users WHERE phone = $1 AND verified_at IS NOT NULL FOR UPDATE`,
      [recipientPhone],
    )
    if (!recipient.rows[0]) throw new Error('Recipient phone number is not registered')

    const paymentId = `phone-${Date.now()}-${req.user.id}-${recipient.rows[0].id}`
    await debit(client, {
      userId: req.user.id,
      amount,
      sourceType: 'phone_payment',
      sourceId: paymentId,
      metadata: { recipientPhone },
    })
    await credit(client, {
      userId: recipient.rows[0].id,
      amount,
      sourceType: 'phone_payment',
      sourceId: paymentId,
      metadata: { senderPhone: req.user.phone },
    })
    await client.query(
      `INSERT INTO audit_logs (actor_user_id, event_type, entity_type, entity_id, metadata)
       VALUES ($1, 'send_phone', 'phone_payment', $2, $3)`,
      [req.user.id, paymentId, { recipientPhone, amountBaseUnits: amount.toString() }],
    )
    return { paymentId, recipient: recipient.rows[0] }
  })

  res.json({
    ok: true,
    paymentId: result.paymentId,
    recipient: {
      phone: result.recipient.phone,
      fiberPubkey: result.recipient.fiber_pubkey,
    },
  })
}))

app.post('/api/mpesa/callback/stk', asyncHandler(async (req, res) => {
  const callback = req.body?.Body?.stkCallback || req.body?.stkCallback || req.body
  const checkoutRequestId = callback.CheckoutRequestID
  const receipt = readStkReceipt(callback)

  await query(
    `INSERT INTO mpesa_callbacks (kind, conversation_id, result_code, receipt_number, payload)
     VALUES ('stk', $1, $2, $3, $4)`,
    [checkoutRequestId || null, String(callback.ResultCode ?? ''), receipt || null, req.body],
  )

  if (!checkoutRequestId) return res.json({ ok: true })

  await withTransaction(async (client) => {
    const tx = await client.query(
      `SELECT * FROM mpesa_transactions WHERE checkout_request_id = $1 FOR UPDATE`,
      [checkoutRequestId],
    )
    if (!tx.rows[0] || ['completed', 'failed'].includes(tx.rows[0].status)) return
    await applyStkResult(client, tx.rows[0], callback, 'stkCallback')
  })

  res.json({ ok: true })
}))

app.post('/api/mpesa/callback/b2c', asyncHandler(async (req, res) => {
  const result = req.body?.Result || req.body
  const conversationId = result.ConversationID
  const originatorConversationId = result.OriginatorConversationID
  const resultCode = Number(result.ResultCode)
  const receipt = result.ResultParameters?.ResultParameter?.find((item) => item.Key === 'TransactionReceipt')?.Value

  console.log('M-Pesa B2C callback', JSON.stringify({
    conversationId,
    originatorConversationId,
    resultCode,
    receipt,
  }))

  await query(
    `INSERT INTO mpesa_callbacks
       (kind, conversation_id, originator_conversation_id, result_code, receipt_number, payload)
     VALUES ('b2c', $1, $2, $3, $4, $5)`,
    [conversationId || null, originatorConversationId || null, String(result.ResultCode ?? ''), receipt || null, req.body],
  )

  await query(
    `UPDATE mpesa_transactions
     SET status = CASE WHEN $3 = 0 THEN 'completed' ELSE 'failed' END,
         receipt_number = COALESCE($4, receipt_number),
         provider_payload = $5,
         updated_at = now()
     WHERE conversation_id = $1 OR originator_conversation_id = $2`,
    [conversationId, originatorConversationId, resultCode, receipt || null, req.body],
  )

  res.json({ ok: true })
}))

app.post('/api/mpesa/callback/b2c-timeout', asyncHandler(async (req, res) => {
  console.log('M-Pesa B2C timeout callback', JSON.stringify(req.body))
  await query(
    `INSERT INTO mpesa_callbacks (kind, payload)
     VALUES ('b2c-timeout', $1)`,
    [req.body],
  )
  res.json({ ok: true })
}))

app.get('/api/mpesa/callbacks', asyncHandler(async (_req, res) => {
  const result = await query(
    `SELECT * FROM mpesa_callbacks ORDER BY created_at DESC LIMIT 25`,
  )
  res.json({ callbacks: result.rows })
}))

app.use((error, _req, res, next) => {
  void next
  console.error(error)
  res.status(400).json({ error: error.message || 'Request failed' })
})

app.listen(config.port, () => {
  console.log(`Dular API listening on http://localhost:${config.port}`)
})
