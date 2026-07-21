import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  expiredRefundInvoiceAction,
  isRefundLeaseStale,
  refundWorkerAction,
} from './rampRefundPolicy.js'

describe('ramp refund recovery policy', () => {
  it('completes success, sends absent or failed, and never resends pending payments', () => {
    assert.equal(refundWorkerAction({ status: 'Success' }), 'complete')
    assert.equal(refundWorkerAction(null), 'send')
    assert.equal(refundWorkerAction({ status: 'Failed' }), 'send')
    assert.equal(refundWorkerAction({ status: 'Inflight' }), 'wait')
    assert.equal(refundWorkerAction({ status: 'Unknown' }), 'wait')
  })

  it('finalizes successful expired invoices and replaces only absent or failed ones', () => {
    assert.equal(expiredRefundInvoiceAction({ status: 'Success' }), 'finalize')
    assert.equal(expiredRefundInvoiceAction(null), 'replace')
    assert.equal(expiredRefundInvoiceAction({ status: 'Timeout' }), 'replace')
    assert.equal(expiredRefundInvoiceAction({ status: 'Inflight' }), 'wait')
  })

  it('takes over only refund_sending leases at or beyond the stale boundary', () => {
    const now = Date.parse('2026-07-21T12:10:00.000Z')
    assert.equal(isRefundLeaseStale({ status: 'refund_sending', updated_at: '2026-07-21T12:00:00.000Z' }, now), true)
    assert.equal(isRefundLeaseStale({ status: 'refund_sending', updated_at: '2026-07-21T12:00:00.001Z' }, now), false)
    assert.equal(isRefundLeaseStale({ status: 'refund_pending', updated_at: '2026-07-21T12:00:00.000Z' }, now), false)
  })
})
