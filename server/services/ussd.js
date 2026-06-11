import { config } from '../config.js'
import { withTransaction } from '../db.js'
import { initiateStkPush } from './daraja.js'
import { getNodePubkey } from './fiber.js'
import { credit, debit, ensureLedgerAccount } from './ledger.js'
import { hashValue, normalizePhone, toRUsdBaseUnits } from '../utils.js'

const RUSD_BASE_UNITS = 100_000_000n

function con(body) {
  return { prefix: 'CON', body, text: `CON ${body}` }
}

function end(body) {
  return { prefix: 'END', body, text: `END ${body}` }
}

function mainMenu() {
  return con(`Welcome to Dular
1. Check balance
2. Send RUSD
3. Receive RUSD
4. Deposit from M-Pesa
5. Withdraw to M-Pesa
6. Set or change PIN`)
}

function formatRUsd(baseUnits) {
  const value = BigInt(String(baseUnits || '0'))
  const whole = value / RUSD_BASE_UNITS
  const fraction = value % RUSD_BASE_UNITS
  const decimal = fraction.toString().padStart(8, '0').replace(/0+$/, '')
  return decimal ? `${whole}.${decimal}` : whole.toString()
}

function parseRUsdAmount(value) {
  const numeric = Number(String(value || '').trim())
  if (!Number.isFinite(numeric) || numeric <= 0) throw new Error('Enter an amount greater than 0.')
  return BigInt(Math.round(numeric * Number(RUSD_BASE_UNITS)))
}

function parseKesAmount(value) {
  const numeric = Number(String(value || '').trim())
  if (!Number.isFinite(numeric) || numeric <= 0) throw new Error('Enter a KES amount greater than 0.')
  return numeric
}

function validatePin(value) {
  const pin = String(value || '').trim()
  if (!/^\d{4}$/.test(pin)) throw new Error('Use a 4 digit PIN.')
  return pin
}

function pinHash(phone, pin) {
  return hashValue(`${config.sessionSecret}:${phone}:ussd:${pin}`)
}

function splitText(text) {
  return String(text || '')
    .split('*')
    .map((part) => part.trim())
    .filter(Boolean)
}

function requestBaseUrl(req) {
  const host = req?.get?.('x-forwarded-host') || req?.get?.('host')
  if (!host) return config.publicBaseUrl.replace(/\/+$/, '')
  const proto = req?.get?.('x-forwarded-proto') || req?.protocol || 'https'
  return `${proto}://${host}`.replace(/\/+$/, '')
}

async function findVerifiedUser(client, phone, lock = false) {
  const result = await client.query(
    `SELECT u.*, la.balance_base_units
     FROM users u
     LEFT JOIN ledger_accounts la ON la.user_id = u.id
     WHERE u.phone = $1 AND u.verified_at IS NOT NULL
     ${lock ? 'FOR UPDATE OF u' : ''}`,
    [phone],
  )
  return result.rows[0] || null
}

function requireRegistered(user) {
  if (!user) {
    return end('This phone is not registered on Dular yet. Open the Dular web app, verify your phone with OTP, then try USSD again.')
  }
  return null
}

async function hasPin(client, phone) {
  const result = await client.query('SELECT 1 FROM ussd_pins WHERE phone = $1', [phone])
  return Boolean(result.rows[0])
}

async function verifyPin(client, phone, pin) {
  const result = await client.query('SELECT pin_hash FROM ussd_pins WHERE phone = $1', [phone])
  if (!result.rows[0]) throw new Error('Set your Dular USSD PIN first from option 6.')
  if (result.rows[0].pin_hash !== pinHash(phone, pin)) throw new Error('Incorrect PIN.')
}

async function handleBalance(client, phone) {
  const user = await findVerifiedUser(client, phone)
  const blocked = requireRegistered(user)
  if (blocked) return blocked
  await ensureLedgerAccount(client, user.id)
  return end(`Your Dular balance is ${formatRUsd(user.balance_base_units)} RUSD.`)
}

async function handleReceive(client, phone, context = {}) {
  let user = await findVerifiedUser(client, phone)
  const blocked = requireRegistered(user)
  if (blocked) return blocked
  if (!user.fiber_pubkey && config.fiberRpcConfigured) {
    try {
      const pubkey = await getNodePubkey()
      const updated = await client.query(
        `UPDATE users
         SET fiber_pubkey = $2,
             updated_at = now()
         WHERE id = $1 AND fiber_pubkey IS NULL
         RETURNING *`,
        [user.id, pubkey],
      )
      user = { ...user, ...(updated.rows[0] || {}), fiber_pubkey: pubkey }
    } catch {
      // Keep USSD responsive even if the local Fiber node is not running.
    }
  }
  const pubkey = user.fiber_pubkey || 'pending Fiber pubkey sync'
  const baseUrl = context.requestBaseUrl || config.publicBaseUrl.replace(/\/+$/, '')
  const lookupUrl = `${baseUrl}/api/registry/lookup?phone=${encodeURIComponent(phone)}`
  return end(`Receive RUSD with ${phone}.
Fiber pubkey: ${pubkey}
Registry proof: ${lookupUrl}`)
}

async function handlePinSetup(client, phone, parts) {
  const user = await findVerifiedUser(client, phone)
  const blocked = requireRegistered(user)
  if (blocked) return blocked
  if (parts.length === 1) return con('Enter a new 4 digit Dular PIN:')
  if (parts.length === 2) {
    validatePin(parts[1])
    return con('Confirm the new 4 digit PIN:')
  }

  const pin = validatePin(parts[1])
  const confirmPin = validatePin(parts[2])
  if (pin !== confirmPin) return end('PINs did not match. Start again and choose option 6.')

  await client.query(
    `INSERT INTO ussd_pins (phone, pin_hash)
     VALUES ($1, $2)
     ON CONFLICT (phone) DO UPDATE
     SET pin_hash = EXCLUDED.pin_hash,
         updated_at = now()`,
    [phone, pinHash(phone, pin)],
  )
  return end('Your Dular USSD PIN has been set. You can now send RUSD from USSD.')
}

async function handleSend(client, phone, parts) {
  const user = await findVerifiedUser(client, phone, true)
  const blocked = requireRegistered(user)
  if (blocked) return blocked
  if (!(await hasPin(client, phone))) return end('Set your Dular USSD PIN first from option 6 before sending RUSD.')
  if (parts.length === 1) return con('Enter recipient phone number:')
  if (parts.length === 2) {
    normalizePhone(parts[1])
    return con('Enter amount in RUSD:')
  }
  if (parts.length === 3) {
    parseRUsdAmount(parts[2])
    return con('Enter your 4 digit Dular PIN to confirm:')
  }

  const recipientPhone = normalizePhone(parts[1])
  const amount = parseRUsdAmount(parts[2])
  const pin = validatePin(parts[3])
  if (recipientPhone === phone) throw new Error('You cannot send to your own phone.')
  await verifyPin(client, phone, pin)

  const recipient = await findVerifiedUser(client, recipientPhone, true)
  if (!recipient) return end('Recipient is not registered on Dular yet.')

  const paymentId = `ussd-phone-${Date.now()}-${user.id}-${recipient.id}`
  await debit(client, {
    userId: user.id,
    amount,
    sourceType: 'phone_payment',
    sourceId: paymentId,
    metadata: { recipientPhone, channel: 'ussd' },
  })
  await credit(client, {
    userId: recipient.id,
    amount,
    sourceType: 'phone_payment',
    sourceId: paymentId,
    metadata: { senderPhone: phone, channel: 'ussd' },
  })
  await client.query(
    `INSERT INTO audit_logs (actor_user_id, event_type, entity_type, entity_id, metadata)
     VALUES ($1, 'ussd_send_phone', 'phone_payment', $2, $3)`,
    [user.id, paymentId, { recipientPhone, amountBaseUnits: amount.toString() }],
  )

  return end(`Sent ${formatRUsd(amount)} RUSD to ${recipientPhone}. Ref: ${paymentId.slice(0, 24)}`)
}

async function handleDeposit(client, phone, parts) {
  const user = await findVerifiedUser(client, phone)
  const blocked = requireRegistered(user)
  if (blocked) return blocked
  if (parts.length === 1) return con('Enter amount to deposit from M-Pesa in KES:')

  const amountKes = parseKesAmount(parts[1])
  const rusdBaseUnits = toRUsdBaseUnits(amountKes)
  const created = await client.query(
    `INSERT INTO mpesa_transactions
       (user_id, kind, phone, kes_amount, rusd_base_units, status, provider_payload)
     VALUES ($1, 'deposit', $2, $3, $4, 'initiating', $5)
     RETURNING *`,
    [
      user.id,
      phone,
      amountKes,
      rusdBaseUnits.toString(),
      {
        channel: 'ussd',
        requestedAt: new Date().toISOString(),
        note: 'USSD simulator deposit request. Fiber-backed settlement is handled by the normal deposit pipeline when invoice/liquidity is available.',
      },
    ],
  )

  try {
    const mpesa = await initiateStkPush({
      phone,
      amountKes,
      accountReference: `DULAR-${phone}`,
    })
    await client.query(
      `UPDATE mpesa_transactions
       SET status = 'pending',
           checkout_request_id = $2,
           merchant_request_id = $3,
           provider_payload = COALESCE(provider_payload, '{}'::jsonb) || $4::jsonb,
           updated_at = now()
       WHERE id = $1`,
      [
        created.rows[0].id,
        mpesa.CheckoutRequestID,
        mpesa.MerchantRequestID,
        JSON.stringify({ stkPush: mpesa, stkPushAt: new Date().toISOString() }),
      ],
    )
    return end(`M-Pesa prompt sent for KES ${amountKes}. Approve it on your phone. Checkout: ${mpesa.CheckoutRequestID}`)
  } catch (error) {
    await client.query(
      `UPDATE mpesa_transactions
       SET status = 'failed',
           provider_payload = COALESCE(provider_payload, '{}'::jsonb) || $2::jsonb,
           updated_at = now()
       WHERE id = $1`,
      [created.rows[0].id, JSON.stringify({ stkError: error.message })],
    )
    throw error
  }
}

async function handleWithdraw(client, phone) {
  const user = await findVerifiedUser(client, phone)
  const blocked = requireRegistered(user)
  if (blocked) return blocked
  if (!config.ussd.withdrawalsEnabled) {
    return end('Withdrawals are temporarily pending Safaricom B2C credential activation. Deposits, balance, and sends are available.')
  }
  return end('Withdrawals are not active in the USSD simulator yet. Use the Dular app when B2C is enabled.')
}

async function routeUssd(client, phone, parts, context) {
  if (!config.ussd.enabled) return end('Dular USSD is temporarily offline.')
  if (parts.length === 0) return mainMenu()

  const userContext = { requestBaseUrl: context.requestBaseUrl }
  switch (parts[0]) {
    case '1':
      return handleBalance(client, phone)
    case '2':
      return handleSend(client, phone, parts)
    case '3':
      return handleReceive(client, phone, userContext)
    case '4':
      return handleDeposit(client, phone, parts)
    case '5':
      return handleWithdraw(client, phone)
    case '6':
      return handlePinSetup(client, phone, parts)
    default:
      return end('Invalid option. Dial again and choose a number from the Dular menu.')
  }
}

async function persistSessionAndLog(client, request, response) {
  await client.query(
    `INSERT INTO ussd_sessions
       (session_id, phone, service_code, network_code, latest_text, state, ended_at)
     VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $7 = 'END' THEN now() ELSE NULL END)
     ON CONFLICT (session_id) DO UPDATE
     SET phone = EXCLUDED.phone,
         service_code = EXCLUDED.service_code,
         network_code = EXCLUDED.network_code,
         latest_text = EXCLUDED.latest_text,
         state = EXCLUDED.state,
         ended_at = CASE WHEN $7 = 'END' THEN now() ELSE ussd_sessions.ended_at END,
         updated_at = now()`,
    [
      request.sessionId,
      request.phone,
      request.serviceCode,
      request.networkCode,
      request.text,
      { parts: splitText(request.text), simulator: true },
      response.prefix,
    ],
  )
  await client.query(
    `INSERT INTO ussd_logs
       (session_id, phone, service_code, network_code, input_text, response_prefix, response_body)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      request.sessionId,
      request.phone,
      request.serviceCode,
      request.networkCode,
      request.text,
      response.prefix,
      response.body,
    ],
  )
}

export async function handleUssdRequest(payload, req = null) {
  const request = {
    sessionId: String(payload.sessionId || payload.session_id || '').trim(),
    serviceCode: String(payload.serviceCode || payload.service_code || config.ussd.serviceCode).trim(),
    phone: normalizePhone(payload.phoneNumber || payload.phone || ''),
    text: String(payload.text || '').trim(),
    networkCode: String(payload.networkCode || payload.network_code || '').trim(),
  }
  if (!request.sessionId) throw new Error('USSD sessionId is required')
  const context = { requestBaseUrl: requestBaseUrl(req) }

  return withTransaction(async (client) => {
    let response
    try {
      response = await routeUssd(client, request.phone, splitText(request.text), context)
    } catch (error) {
      response = end(error.message || 'USSD request failed. Please try again.')
    }
    await persistSessionAndLog(client, request, response)
    return response.text
  })
}
