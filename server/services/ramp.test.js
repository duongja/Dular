import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  RUSD_BASE_UNITS,
  RUSD_INVOICE_UDT_SCRIPT,
  assertRampTransition,
  calculateRampQuote,
  invoiceAttribute,
  invoiceDescription,
  invoicePayeePubkey,
  invoicePaymentHash,
  invoiceUdtScript,
  parseKesAmount,
  parseRateMicros,
  publicRampOrder,
  validateRampInvoice,
} from './ramp.js'

const NOW = new Date('2026-07-21T10:00:00.000Z')
const PAYEE = `02${'ab'.repeat(32)}`
const PAYMENT_HASH = `0x${'cd'.repeat(32)}`
const DESCRIPTION = 'Dular withdrawal order order-123'

function parsedInvoice(overrides = {}) {
  const invoice = {
    currency: 'Fibt',
    amount: '0x5f5e100',
    signature: `0x${'ef'.repeat(64)}`,
    data: {
      timestamp: `0x${NOW.getTime().toString(16)}`,
      payment_hash: PAYMENT_HASH,
      attrs: [
        { payee_pubkey: PAYEE },
        { description: DESCRIPTION },
        { udtScript: RUSD_INVOICE_UDT_SCRIPT },
        { expiry_time: '0x12c' },
      ],
    },
  }

  return { invoice: { ...invoice, ...overrides } }
}

describe('amount and rate parsing', () => {
  test('accepts whole KES at inclusive bounds', () => {
    assert.equal(parseKesAmount('10', { minKes: 10, maxKes: 5000 }), 10n)
    assert.equal(parseKesAmount(5000n, { minKes: '10', maxKes: '5000' }), 5000n)
    assert.equal(parseRateMicros('129500000'), 129500000n)
  })

  test('rejects fractional, unsafe, non-positive, and out-of-range amounts', () => {
    assert.throws(
      () => parseKesAmount('10.50', { minKes: 1, maxKes: 100 }),
      /whole integer/,
    )
    assert.throws(
      () => parseKesAmount(0, { minKes: 1, maxKes: 100 }),
      /greater than zero/,
    )
    assert.throws(
      () => parseKesAmount(101, { minKes: 1, maxKes: 100 }),
      /at most 100 KES/,
    )
    assert.throws(() => parseRateMicros('-1'), /whole integer/)
  })
})

describe('quote calculation', () => {
  const common = {
    kesAmount: 1,
    rateKesPerRUsdMicros: 3000000,
    feeBps: 0,
    minKes: 1,
    maxKes: 1000,
    now: NOW,
    expiresInSeconds: 300,
    rateSource: 'central-bank-mid',
  }

  test('floors deposit gross amounts and ceils withdrawal gross amounts', () => {
    const deposit = calculateRampQuote({ ...common, direction: 'deposit' })
    const withdrawal = calculateRampQuote({ ...common, direction: 'withdrawal' })

    assert.equal(RUSD_BASE_UNITS, 100000000n)
    assert.equal(deposit.grossRUsdBaseUnits, '33333333')
    assert.equal(deposit.rusdAmountBaseUnits, '33333333')
    assert.equal(withdrawal.grossRUsdBaseUnits, '33333334')
    assert.equal(withdrawal.rusdAmountBaseUnits, '33333334')
    assert.equal(deposit.quotedAt, '2026-07-21T10:00:00.000Z')
    assert.equal(deposit.expiresAt, '2026-07-21T10:05:00.000Z')
  })

  test('ceil-rounds fees and subtracts or adds the exact settlement fee', () => {
    const deposit = calculateRampQuote({ ...common, direction: 'deposit', feeBps: 1 })
    const withdrawal = calculateRampQuote({ ...common, direction: 'withdrawal', feeBps: 1 })

    assert.deepEqual(
      [deposit.grossRUsdBaseUnits, deposit.feeRUsdBaseUnits, deposit.rusdAmountBaseUnits],
      ['33333333', '3334', '33329999'],
    )
    assert.deepEqual(
      [withdrawal.grossRUsdBaseUnits, withdrawal.feeRUsdBaseUnits, withdrawal.rusdAmountBaseUnits],
      ['33333334', '3334', '33336668'],
    )
  })

  test('rejects invalid direction, fee, bounds, and a zero deposit settlement', () => {
    assert.throws(() => calculateRampQuote({ ...common, direction: 'send' }), /direction/)
    assert.throws(
      () => calculateRampQuote({ ...common, direction: 'deposit', feeBps: 10001 }),
      /must not exceed 10000/,
    )
    assert.throws(
      () => calculateRampQuote({ ...common, direction: 'deposit', kesAmount: 1001 }),
      /at most 1000 KES/,
    )
    assert.throws(
      () => calculateRampQuote({ ...common, direction: 'deposit', feeBps: 10000 }),
      /zero RUSD settlement/,
    )
  })
})

describe('Fiber invoice validation', () => {
  test('reads snake, camel, and tagged invoice attributes', () => {
    const parsed = parsedInvoice()
    parsed.invoice.data.attrs.push({ type: 'Feature', value: '0x01' })

    assert.equal(invoicePayeePubkey(parsed), PAYEE)
    assert.equal(invoiceDescription(parsed), DESCRIPTION)
    assert.equal(invoiceUdtScript(parsed), RUSD_INVOICE_UDT_SCRIPT)
    assert.equal(invoicePaymentHash(parsed), PAYMENT_HASH)
    assert.equal(invoiceAttribute(parsed, 'feature'), '0x01')
  })

  test('validates and normalizes a matching testnet RUSD invoice', () => {
    const result = validateRampInvoice({
      parsed: parsedInvoice(),
      expectedPubkey: `0x${PAYEE.toUpperCase()}`,
      expectedAmountBaseUnits: '100000000',
      expectedDescription: DESCRIPTION,
      now: NOW,
      minimumRemainingSeconds: 60,
    })

    assert.deepEqual(result, {
      paymentHash: PAYMENT_HASH,
      payeePubkey: PAYEE,
      amountBaseUnits: '100000000',
      expiresAt: '2026-07-21T10:05:00.000Z',
    })
  })

  test('rejects mismatched invoice identity and settlement fields', () => {
    assert.throws(
      () => validateRampInvoice({
        parsed: parsedInvoice({ currency: 'Fibb' }),
        expectedPubkey: PAYEE,
        expectedAmountBaseUnits: RUSD_BASE_UNITS,
        expectedDescription: DESCRIPTION,
        now: NOW,
      }),
      /currency must be Fibt/,
    )

    assert.throws(
      () => validateRampInvoice({
        parsed: parsedInvoice({ amount: '0x5f5e101' }),
        expectedPubkey: PAYEE,
        expectedAmountBaseUnits: RUSD_BASE_UNITS,
        expectedDescription: DESCRIPTION,
        now: NOW,
      }),
      /amount does not match/,
    )

    const wrongScript = parsedInvoice()
    wrongScript.invoice.data.attrs[2].udtScript = '0x00'
    assert.throws(
      () => validateRampInvoice({
        parsed: wrongScript,
        expectedPubkey: PAYEE,
        expectedAmountBaseUnits: RUSD_BASE_UNITS,
        expectedDescription: DESCRIPTION,
        now: NOW,
      }),
      /RUSD UDT script/,
    )

    const unsigned = parsedInvoice({ signature: '' })
    assert.throws(
      () => validateRampInvoice({
        parsed: unsigned,
        expectedPubkey: PAYEE,
        expectedAmountBaseUnits: RUSD_BASE_UNITS,
        expectedDescription: DESCRIPTION,
        now: NOW,
      }),
      /signature is required/,
    )
  })

  test('rejects expired invoices and accepts the minimum remaining boundary', () => {
    const options = {
      parsed: parsedInvoice(),
      expectedPubkey: PAYEE,
      expectedAmountBaseUnits: RUSD_BASE_UNITS,
      expectedDescription: DESCRIPTION,
      minimumRemainingSeconds: 60,
    }

    assert.doesNotThrow(() => validateRampInvoice({
      ...options,
      now: new Date('2026-07-21T10:04:00.000Z'),
    }))
    assert.throws(
      () => validateRampInvoice({
        ...options,
        now: new Date('2026-07-21T10:04:00.001Z'),
      }),
      /remain valid for at least 60 seconds/,
    )
  })
})

describe('ramp order transitions', () => {
  test('allows the happy paths, recovery paths, and idempotent updates', () => {
    assert.equal(assertRampTransition('deposit', 'created', 'invoice_ready'), 'invoice_ready')
    assert.equal(assertRampTransition('deposit', 'mpesa_pending', 'mpesa_unknown'), 'mpesa_unknown')
    assert.equal(assertRampTransition('deposit', 'mpesa_unknown', 'mpesa_confirmed'), 'mpesa_confirmed')
    assert.equal(assertRampTransition('deposit', 'created', 'quote_expired'), 'quote_expired')
    assert.equal(assertRampTransition('deposit', 'fiber_sending', 'delivery_pending'), 'delivery_pending')
    assert.equal(assertRampTransition('deposit', 'delivery_pending', 'fiber_sending'), 'fiber_sending')
    assert.equal(assertRampTransition('withdrawal', 'awaiting_rusd', 'invoice_expired'), 'invoice_expired')
    assert.equal(assertRampTransition('withdrawal', 'b2c_pending', 'payout_failed'), 'payout_failed')
    assert.equal(assertRampTransition('withdrawal', 'payout_unknown', 'completed'), 'completed')
    assert.equal(assertRampTransition('withdrawal', 'payout_failed', 'refund_pending'), 'refund_pending')
    assert.equal(assertRampTransition('withdrawal', 'refund_pending', 'refund_sending'), 'refund_sending')
    assert.equal(assertRampTransition('withdrawal', 'refund_sending', 'refunded'), 'refunded')
    assert.equal(assertRampTransition('withdrawal', 'b2c_pending', 'b2c_pending'), 'b2c_pending')
  })

  test('rejects skipped, cross-machine, and unknown transitions', () => {
    assert.throws(
      () => assertRampTransition('deposit', 'created', 'completed'),
      /Invalid deposit ramp transition/,
    )
    assert.throws(
      () => assertRampTransition('withdrawal', 'awaiting_rusd', 'mpesa_pending'),
      /Unknown withdrawal ramp state/,
    )
    assert.throws(() => assertRampTransition('transfer', 'created', 'created'), /Unknown ramp order kind/)
  })
})

test('publicRampOrder returns a camelCase JSON-safe allowlisted representation', () => {
  const result = publicRampOrder({
    id: 'order-123',
    user_id: 'private-user-id',
    kind: 'deposit',
    status: 'mpesa_pending',
    phone: '+254712345678',
    kes_amount: 1000n,
    rate_kes_per_rusd_micros: '129500000',
    gross_rusd_base_units: 772200772n,
    fee_rusd_base_units: '1930502',
    rusd_amount_base_units: 770270270n,
    fee_bps: '25',
    rate_source: 'central-bank-mid',
    checkout_request_id: 'checkout-1',
    quoted_at: new Date('2026-07-21T10:00:00.000Z'),
    quote_expires_at: new Date('2026-07-21T10:05:00.000Z'),
    created_at: new Date('2026-07-21T10:00:00.000Z'),
    updated_at: new Date('2026-07-21T10:01:00.000Z'),
    provider_payload: { accessToken: 'private' },
    callback_payload: { raw: 'private' },
    private_callback_data: { raw: 'private' },
  })

  assert.deepEqual(result, {
    id: 'order-123',
    kind: 'deposit',
    state: 'mpesa_pending',
    status: 'mpesa_pending',
    phone: '+254712345678',
    kesAmount: '1000',
    rateKesPerRUsdMicros: '129500000',
    grossRUsdBaseUnits: '772200772',
    feeRUsdBaseUnits: '1930502',
    rusdAmountBaseUnits: '770270270',
    feeBps: 25,
    rateSource: 'central-bank-mid',
    checkoutRequestId: 'checkout-1',
    quotedAt: '2026-07-21T10:00:00.000Z',
    expiresAt: '2026-07-21T10:05:00.000Z',
    createdAt: '2026-07-21T10:00:00.000Z',
    updatedAt: '2026-07-21T10:01:00.000Z',
  })
  assert.doesNotThrow(() => JSON.stringify(result))
  assert.equal('providerPayload' in result, false)
  assert.equal('callbackPayload' in result, false)
})
