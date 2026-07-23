import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { auditActivity, fiberPaymentActivity, mergeActivity, rampActivity } from './activity.js'

const NOW = '2026-07-23T10:00:00.000Z'

describe('unified wallet activity', () => {
  it('normalizes M-Pesa and Fiber payment rows', () => {
    const deposit = rampActivity({ id: 'r1', kind: 'deposit', status: 'completed', rusd_amount_base_units: '100', kes_amount: '1', created_at: NOW })
    const payment = fiberPaymentActivity({ id: 'f1', direction: 'sent', status: 'Success', source_type: 'phone_keysend', amount_base_units: '50', fee_base_units: '0', payment_hash: '0x1', activity_metadata: { recipientPhone: '+254700000001' }, created_at: NOW })
    assert.equal(deposit.kind, 'mpesa_deposit')
    assert.equal(deposit.direction, 'in')
    assert.equal(payment.kind, 'phone_send')
    assert.equal(payment.phone, '+254700000001')
  })

  it('shows recipient-side phone and invoice payments only to the recipient', () => {
    const phone = auditActivity({ id: 'a1', event_type: 'phone_fiber_keysend_completed', metadata: { recipientUserId: 'recipient', amountBaseUnits: '10', paymentHash: '0x2' }, created_at: NOW }, 'recipient')
    const hidden = auditActivity({ id: 'a1', event_type: 'phone_fiber_keysend_completed', metadata: { recipientUserId: 'recipient' }, created_at: NOW }, 'sender')
    assert.equal(phone.kind, 'phone_receive')
    assert.equal(hidden, null)
  })

  it('deduplicates recipient evidence by payment hash and sorts newest first', () => {
    const rows = mergeActivity({
      userId: 'recipient',
      audits: [
        { id: 'a1', event_type: 'fiber_invoice_payment_completed', metadata: { recipientUserId: 'recipient', amountBaseUnits: '10', paymentHash: '0x3' }, created_at: '2026-07-23T09:00:00.000Z' },
        { id: 'a2', event_type: 'fiber_invoice_payment_received', metadata: { amountBaseUnits: '10', paymentHash: '0x3' }, created_at: '2026-07-23T09:01:00.000Z' },
      ],
      rampOrders: [{ id: 'r1', kind: 'withdrawal', status: 'completed', rusd_amount_base_units: '20', kes_amount: '2', created_at: NOW }],
    })
    assert.equal(rows.length, 2)
    assert.equal(rows[0].kind, 'mpesa_withdrawal')
    assert.equal(rows[1].kind, 'invoice_receive')
  })

  it('marks a recorded payment request received when matching incoming evidence exists', () => {
    const rows = mergeActivity({
      userId: 'recipient',
      audits: [
        { id: 'request', event_type: 'fiber_payment_request_created', metadata: { amountBaseUnits: '10', paymentHash: '0x4', status: 'Open' }, created_at: '2026-07-23T09:00:00.000Z' },
        { id: 'received', event_type: 'fiber_invoice_payment_received', metadata: { amountBaseUnits: '10', paymentHash: '0x4', status: 'Received' }, created_at: '2026-07-23T09:01:00.000Z' },
      ],
    })
    assert.equal(rows.find((row) => row.kind === 'payment_request').status, 'Received')
  })
})
