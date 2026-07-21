export const RUSD_BASE_UNITS = 100000000n

export const RUSD_INVOICE_UDT_SCRIPT = '0x550000001000000030000000310000001142755a044bf2ee358cba9f2da187ce928c91cd4dc8692ded0337efa677d21a0120000000878fcc6f1f08d48e87bb1c3b3d5083f23f8a39c5d5c764f253b55b998526439b'

const MICROS = 1000000n
const BPS_DENOMINATOR = 10000n

const TRANSITIONS = {
  deposit: {
    created: ['invoice_ready', 'quote_expired'],
    invoice_ready: ['mpesa_initiating', 'quote_expired'],
    mpesa_initiating: ['mpesa_pending', 'mpesa_failed', 'mpesa_unknown'],
    mpesa_pending: ['mpesa_confirmed', 'mpesa_failed', 'mpesa_unknown'],
    mpesa_confirmed: ['fiber_sending', 'delivery_pending'],
    fiber_sending: ['completed', 'delivery_pending'],
    delivery_pending: ['fiber_sending'],
    mpesa_failed: [],
    mpesa_unknown: ['mpesa_pending', 'mpesa_confirmed', 'mpesa_failed'],
    quote_expired: [],
    completed: [],
  },
  withdrawal: {
    awaiting_rusd: ['rusd_received', 'invoice_expired'],
    rusd_received: ['b2c_submitting'],
    b2c_submitting: ['b2c_pending', 'completed', 'payout_unknown', 'payout_failed'],
    b2c_pending: ['completed', 'payout_unknown', 'payout_failed'],
    payout_failed: ['refund_pending'],
    refund_pending: ['refund_sending'],
    refund_sending: ['refunded', 'refund_pending'],
    invoice_expired: [],
    payout_unknown: ['b2c_pending', 'completed', 'payout_failed'],
    completed: [],
    refunded: [],
  },
}

const PUBLIC_ORDER_FIELDS = [
  ['id', ['id']],
  ['kind', ['kind']],
  ['state', ['status', 'state']],
  ['status', ['status']],
  ['phone', ['phone']],
  ['kesAmount', ['kes_amount', 'kesAmount'], 'integer'],
  ['rateKesPerRUsdMicros', ['rate_kes_per_rusd_micros', 'rateKesPerRUsdMicros'], 'integer'],
  ['grossRUsdBaseUnits', ['gross_rusd_base_units', 'grossRUsdBaseUnits'], 'integer'],
  ['feeRUsdBaseUnits', ['fee_rusd_base_units', 'feeRUsdBaseUnits'], 'integer'],
  ['rusdAmountBaseUnits', ['rusd_amount_base_units', 'rusdAmountBaseUnits', 'amount_base_units', 'amountBaseUnits'], 'integer'],
  ['feeBps', ['fee_bps', 'feeBps'], 'number'],
  ['rateSource', ['rate_source', 'rateSource']],
  ['browserInvoice', ['browser_invoice', 'browserInvoice']],
  ['operatorInvoice', ['operator_invoice', 'operatorInvoice']],
  ['fiberInvoice', ['fiber_invoice', 'fiberInvoice']],
  ['invoicePaymentHash', ['invoice_payment_hash', 'invoicePaymentHash']],
  ['fiberPaymentHash', ['fiber_payment_hash', 'fiberPaymentHash']],
  ['fiberStatus', ['fiber_status', 'fiberStatus']],
  ['payeePubkey', ['payee_pubkey', 'payeePubkey']],
  ['checkoutRequestId', ['checkout_request_id', 'checkoutRequestId']],
  ['merchantRequestId', ['merchant_request_id', 'merchantRequestId']],
  ['conversationId', ['conversation_id', 'conversationId']],
  ['originatorConversationId', ['originator_conversation_id', 'originatorConversationId']],
  ['receiptNumber', ['receipt_number', 'receiptNumber', 'mpesa_receipt_number', 'mpesaReceiptNumber']],
  ['failureCode', ['failure_code', 'failureCode']],
  ['failureMessage', ['failure_message', 'failureMessage']],
  ['errorMessage', ['failure_message', 'errorMessage']],
  ['refundPaymentHash', ['refund_payment_hash', 'refundPaymentHash']],
  ['refundInvoice', ['refund_invoice', 'refundInvoice']],
  ['refundInvoiceExpiresAt', ['refund_invoice_expires_at', 'refundInvoiceExpiresAt'], 'date'],
  ['quotedAt', ['quoted_at', 'quotedAt'], 'date'],
  ['expiresAt', ['quote_expires_at', 'quoteExpiresAt', 'expires_at', 'expiresAt'], 'date'],
  ['invoiceExpiresAt', ['invoice_expires_at', 'invoiceExpiresAt'], 'date'],
  ['mpesaConfirmedAt', ['mpesa_confirmed_at', 'mpesaConfirmedAt'], 'date'],
  ['rusdReceivedAt', ['rusd_received_at', 'rusdReceivedAt'], 'date'],
  ['completedAt', ['completed_at', 'completedAt'], 'date'],
  ['refundedAt', ['refunded_at', 'refundedAt'], 'date'],
  ['createdAt', ['created_at', 'createdAt'], 'date'],
  ['updatedAt', ['updated_at', 'updatedAt'], 'date'],
]

function parseDecimalInteger(value, label, { allowZero = false } = {}) {
  let parsed

  if (typeof value === 'bigint') {
    parsed = value
  } else if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`${label} must be a whole integer`)
    }
    parsed = BigInt(value)
  } else if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    parsed = BigInt(value.trim())
  } else {
    throw new Error(`${label} must be a whole integer`)
  }

  if (allowZero ? parsed < 0n : parsed <= 0n) {
    throw new Error(`${label} must be ${allowZero ? 'zero or greater' : 'greater than zero'}`)
  }

  return parsed
}

function parseEncodedInteger(value, label, { allowZero = false } = {}) {
  if (typeof value === 'string' && /^0x[0-9a-f]+$/i.test(value.trim())) {
    const parsed = BigInt(value.trim())
    if (allowZero ? parsed < 0n : parsed <= 0n) {
      throw new Error(`${label} must be ${allowZero ? 'zero or greater' : 'greater than zero'}`)
    }
    return parsed
  }

  return parseDecimalInteger(value, label, { allowZero })
}

function parseSafeInteger(value, label, { allowZero = false, maximum } = {}) {
  const parsed = parseDecimalInteger(value, label, { allowZero })
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} is too large`)
  }
  if (maximum !== undefined && parsed > BigInt(maximum)) {
    throw new Error(`${label} must not exceed ${maximum}`)
  }
  return Number(parsed)
}

function validDate(value, label) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} must be a valid date`)
  return date
}

function ceilDivide(numerator, denominator) {
  return numerator === 0n ? 0n : ((numerator - 1n) / denominator) + 1n
}

export function parseKesAmount(value, { minKes, maxKes } = {}) {
  const amount = parseDecimalInteger(value, 'KES amount')
  const minimum = parseDecimalInteger(minKes, 'Minimum KES cap', { allowZero: true })
  const maximum = parseDecimalInteger(maxKes, 'Maximum KES cap')

  if (minimum > maximum) throw new Error('Minimum KES cap must not exceed maximum KES cap')
  if (amount < minimum) throw new Error(`KES amount must be at least ${minimum} KES`)
  if (amount > maximum) throw new Error(`KES amount must be at most ${maximum} KES`)

  return amount
}

export function parseRateMicros(value) {
  return parseDecimalInteger(value, 'Rate in micros')
}

export function calculateRampQuote({
  direction,
  kesAmount,
  rateKesPerRUsdMicros,
  feeBps,
  minKes,
  maxKes,
  now = new Date(),
  expiresInSeconds = 300,
  rateSource,
}) {
  if (!['deposit', 'withdrawal'].includes(direction)) {
    throw new Error('Ramp direction must be either deposit or withdrawal')
  }

  const kes = parseKesAmount(kesAmount, { minKes, maxKes })
  const rate = parseRateMicros(rateKesPerRUsdMicros)
  const feeRate = parseSafeInteger(feeBps, 'Fee basis points', { allowZero: true, maximum: 10000 })
  const lifetimeSeconds = parseSafeInteger(expiresInSeconds, 'Quote expiry seconds')
  const quotedAt = validDate(now, 'Quote time')

  if (typeof rateSource !== 'string' || !rateSource.trim()) {
    throw new Error('Rate source is required')
  }

  const numerator = kes * RUSD_BASE_UNITS * MICROS
  const gross = direction === 'deposit'
    ? numerator / rate
    : ceilDivide(numerator, rate)
  const fee = ceilDivide(gross * BigInt(feeRate), BPS_DENOMINATOR)
  const settlementAmount = direction === 'deposit' ? gross - fee : gross + fee

  if (gross <= 0n || settlementAmount <= 0n) {
    throw new Error('Quote produces a zero RUSD settlement amount')
  }

  const expiresAt = new Date(quotedAt.getTime() + (lifetimeSeconds * 1000))
  if (!Number.isFinite(expiresAt.getTime())) throw new Error('Quote expiry is outside the supported date range')

  return {
    direction,
    kesAmount: kes.toString(),
    rateKesPerRUsdMicros: rate.toString(),
    grossRUsdBaseUnits: gross.toString(),
    feeRUsdBaseUnits: fee.toString(),
    rusdAmountBaseUnits: settlementAmount.toString(),
    feeBps: feeRate,
    rateSource: rateSource.trim(),
    quotedAt: quotedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  }
}

function invoiceObject(parsed) {
  return parsed?.invoice ?? parsed
}

function invoiceData(parsed) {
  const invoice = invoiceObject(parsed)
  return invoice?.data ?? invoice?.invoice_data ?? invoice?.invoiceData ?? parsed?.data
}

function canonicalAttributeName(name) {
  return String(name)
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase()
    .replace('publickey', 'pubkey')
    .replace('typescript', 'script')
}

export function invoiceAttribute(parsed, ...requestedNames) {
  const names = requestedNames.flat().map(canonicalAttributeName)
  if (names.length === 0) return null

  const data = invoiceData(parsed)
  const attrs = data?.attrs ?? data?.attributes ?? invoiceObject(parsed)?.attrs ?? parsed?.attrs
  const entries = Array.isArray(attrs) ? attrs : attrs && typeof attrs === 'object' ? [attrs] : []

  for (const attribute of entries) {
    if (!attribute || typeof attribute !== 'object') continue

    const taggedName = attribute.name ?? attribute.type ?? attribute.kind
    if (taggedName !== undefined && names.includes(canonicalAttributeName(taggedName))) {
      return attribute.value ?? attribute.data ?? null
    }

    for (const [key, value] of Object.entries(attribute)) {
      if (names.includes(canonicalAttributeName(key))) return value
    }
  }

  return null
}

export function invoicePayeePubkey(parsed) {
  return invoiceAttribute(parsed, 'payee_pubkey', 'payee_public_key', 'payeePubkey', 'PayeePublicKey')
}

export function invoiceDescription(parsed) {
  return invoiceAttribute(parsed, 'description', 'Description')
}

export function invoiceUdtScript(parsed) {
  return invoiceAttribute(parsed, 'udt_script', 'udt_type_script', 'udtScript', 'UdtScript')
}

export function invoicePaymentHash(parsed) {
  const invoice = invoiceObject(parsed)
  const data = invoiceData(parsed)
  return data?.payment_hash
    ?? data?.paymentHash
    ?? invoice?.payment_hash
    ?? invoice?.paymentHash
    ?? parsed?.payment_hash
    ?? parsed?.paymentHash
    ?? null
}

function normalizePubkey(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`)
  const normalized = value.trim().replace(/^0x/i, '').toLowerCase()
  if (!/^[0-9a-f]+$/.test(normalized)) throw new Error(`${label} must be hexadecimal`)
  return normalized
}

export function validateRampInvoice({
  parsed,
  expectedPubkey,
  expectedAmountBaseUnits,
  expectedDescription,
  now = new Date(),
  minimumRemainingSeconds = 60,
}) {
  const invoice = invoiceObject(parsed)
  const data = invoiceData(parsed)
  if (!invoice || typeof invoice !== 'object' || !data || typeof data !== 'object') {
    throw new Error('Parsed Fiber invoice data is required')
  }

  if (invoice.currency !== 'Fibt') throw new Error('Fiber invoice currency must be Fibt')

  const actualAmount = parseEncodedInteger(invoice.amount, 'Fiber invoice amount')
  const expectedAmount = parseEncodedInteger(expectedAmountBaseUnits, 'Expected invoice amount')
  if (actualAmount !== expectedAmount) throw new Error('Fiber invoice amount does not match the quote')

  const actualPayee = normalizePubkey(invoicePayeePubkey(parsed), 'Fiber invoice payee pubkey')
  const expectedPayee = normalizePubkey(expectedPubkey, 'Expected payee pubkey')
  if (actualPayee !== expectedPayee) throw new Error('Fiber invoice payee pubkey does not match')

  if (invoiceUdtScript(parsed) !== RUSD_INVOICE_UDT_SCRIPT) {
    throw new Error('Fiber invoice does not use the testnet RUSD UDT script')
  }

  if (typeof expectedDescription !== 'string') throw new Error('Expected invoice description is required')
  if (invoiceDescription(parsed) !== expectedDescription) {
    throw new Error('Fiber invoice description does not match')
  }

  const paymentHash = invoicePaymentHash(parsed)
  if (typeof paymentHash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(paymentHash)) {
    throw new Error('Fiber invoice payment hash must be 0x-prefixed and 32 bytes')
  }

  if (typeof invoice.signature !== 'string' || !invoice.signature.trim()) {
    throw new Error('Fiber invoice signature is required')
  }

  const timestamp = parseEncodedInteger(data.timestamp, 'Fiber invoice timestamp', { allowZero: true })
  const expirySeconds = parseEncodedInteger(
    invoiceAttribute(parsed, 'expiry_time', 'expiryTime', 'ExpiryTime'),
    'Fiber invoice expiry',
  )
  const minimumRemaining = parseSafeInteger(
    minimumRemainingSeconds,
    'Minimum invoice remaining seconds',
    { allowZero: true },
  )
  const currentTime = validDate(now, 'Invoice validation time')
  const expiresAtMilliseconds = timestamp + (expirySeconds * 1000n)
  const minimumExpiryMilliseconds = BigInt(currentTime.getTime()) + (BigInt(minimumRemaining) * 1000n)

  if (expiresAtMilliseconds < minimumExpiryMilliseconds) {
    throw new Error(`Fiber invoice must remain valid for at least ${minimumRemaining} seconds`)
  }
  if (expiresAtMilliseconds > 8640000000000000n) {
    throw new Error('Fiber invoice expiry is outside the supported date range')
  }

  return {
    paymentHash: paymentHash.toLowerCase(),
    payeePubkey: actualPayee,
    amountBaseUnits: actualAmount.toString(),
    expiresAt: new Date(Number(expiresAtMilliseconds)).toISOString(),
  }
}

export function assertRampTransition(kind, from, to) {
  const machine = TRANSITIONS[kind]
  if (!machine) throw new Error(`Unknown ramp order kind: ${kind}`)
  if (!Object.hasOwn(machine, from)) throw new Error(`Unknown ${kind} ramp state: ${from}`)
  if (!Object.hasOwn(machine, to)) throw new Error(`Unknown ${kind} ramp state: ${to}`)
  if (from === to) return to
  if (!machine[from].includes(to)) {
    throw new Error(`Invalid ${kind} ramp transition from ${from} to ${to}`)
  }
  return to
}

function firstOwnValue(row, aliases) {
  for (const key of aliases) {
    if (Object.hasOwn(row, key) && row[key] !== undefined) return row[key]
  }
  return undefined
}

function publicInteger(value, field) {
  if (value === null) return null
  return parseDecimalInteger(value, field, { allowZero: true }).toString()
}

function publicNumber(value, field) {
  if (value === null) return null
  return parseSafeInteger(value, field, { allowZero: true })
}

function publicDate(value, field) {
  if (value === null) return null
  return validDate(value, field).toISOString()
}

export function publicRampOrder(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error('Ramp order row is required')
  }

  const result = {}
  for (const [publicName, aliases, type] of PUBLIC_ORDER_FIELDS) {
    const value = firstOwnValue(row, aliases)
    if (value === undefined) continue

    if (type === 'integer') result[publicName] = publicInteger(value, publicName)
    else if (type === 'number') result[publicName] = publicNumber(value, publicName)
    else if (type === 'date') result[publicName] = publicDate(value, publicName)
    else if (typeof value === 'bigint') result[publicName] = value.toString()
    else result[publicName] = value
  }

  return result
}
