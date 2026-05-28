import express from 'express'
import cors from 'cors'
import { config } from './config.js'
import { query, withTransaction } from './db.js'
import { requireAuth } from './auth.js'
import { sendOtpSms } from './services/africasTalking.js'
import { initiateB2c, initiateStkPush } from './services/daraja.js'
import { getNodePubkey } from './services/fiber.js'
import { credit, debit, ensureLedgerAccount } from './services/ledger.js'
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

app.get('/api/transactions', requireAuth, asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT * FROM mpesa_transactions
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 25`,
    [req.user.id],
  )
  res.json({ transactions: result.rows })
}))

app.post('/api/mpesa/deposit', requireAuth, asyncHandler(async (req, res) => {
  const amountKes = Number(req.body.amountKes)
  const rusdBaseUnits = toRUsdBaseUnits(amountKes)
  const mpesa = await initiateStkPush({
    phone: req.user.phone,
    amountKes,
    accountReference: `DULAR-${req.user.phone}`,
  })
  const tx = await query(
    `INSERT INTO mpesa_transactions
       (user_id, kind, phone, kes_amount, rusd_base_units, status, checkout_request_id, merchant_request_id, provider_payload)
     VALUES ($1, 'deposit', $2, $3, $4, 'pending', $5, $6, $7)
     RETURNING *`,
    [
      req.user.id,
      req.user.phone,
      amountKes,
      rusdBaseUnits.toString(),
      mpesa.CheckoutRequestID,
      mpesa.MerchantRequestID,
      mpesa,
    ],
  )
  res.json({ transaction: tx.rows[0], provider: mpesa })
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
  const resultCode = Number(callback.ResultCode)
  const receipt = callback.CallbackMetadata?.Item?.find((item) => item.Name === 'MpesaReceiptNumber')?.Value

  if (!checkoutRequestId) return res.json({ ok: true })

  await withTransaction(async (client) => {
    const tx = await client.query(
      `SELECT * FROM mpesa_transactions WHERE checkout_request_id = $1 FOR UPDATE`,
      [checkoutRequestId],
    )
    if (!tx.rows[0] || tx.rows[0].status !== 'pending') return

    if (resultCode === 0) {
      await client.query(
        `UPDATE mpesa_transactions
         SET status = 'completed', receipt_number = $2, provider_payload = $3, updated_at = now()
         WHERE id = $1`,
        [tx.rows[0].id, receipt || null, req.body],
      )
      await credit(client, {
        userId: tx.rows[0].user_id,
        amount: BigInt(tx.rows[0].rusd_base_units),
        sourceType: 'mpesa_deposit',
        sourceId: tx.rows[0].id,
        metadata: { checkoutRequestId, receipt },
      })
    } else {
      await client.query(
        `UPDATE mpesa_transactions
         SET status = 'failed', provider_payload = $2, updated_at = now()
         WHERE id = $1`,
        [tx.rows[0].id, req.body],
      )
    }
  })

  res.json({ ok: true })
}))

app.post('/api/mpesa/callback/b2c', asyncHandler(async (req, res) => {
  const result = req.body?.Result || req.body
  const conversationId = result.ConversationID
  const originatorConversationId = result.OriginatorConversationID
  const resultCode = Number(result.ResultCode)
  const receipt = result.ResultParameters?.ResultParameter?.find((item) => item.Key === 'TransactionReceipt')?.Value

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
  res.json({ ok: true })
}))

app.use((error, _req, res, next) => {
  void next
  console.error(error)
  res.status(400).json({ error: error.message || 'Request failed' })
})

app.listen(config.port, () => {
  console.log(`Dular API listening on http://localhost:${config.port}`)
})
