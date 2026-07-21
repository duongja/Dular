const SUCCESS_STATES = new Set(['Success'])
const FAILED_STATES = new Set(['Failed', 'Cancelled', 'Canceled', 'Timeout'])

export function refundPaymentState(payment) {
  return payment?.status || payment?.state || 'Unknown'
}

export function refundWorkerAction(payment) {
  if (!payment) return 'send'
  const state = refundPaymentState(payment)
  if (SUCCESS_STATES.has(state)) return 'complete'
  if (FAILED_STATES.has(state)) return 'send'
  return 'wait'
}

export function expiredRefundInvoiceAction(payment) {
  if (!payment) return 'replace'
  const state = refundPaymentState(payment)
  if (SUCCESS_STATES.has(state)) return 'finalize'
  if (FAILED_STATES.has(state)) return 'replace'
  return 'wait'
}

export function isRefundLeaseStale(order, nowMs = Date.now(), leaseMs = 600_000) {
  if (order?.status !== 'refund_sending') return false
  const updatedAt = new Date(order.updated_at || order.updatedAt).getTime()
  return Number.isFinite(updatedAt) && updatedAt <= nowMs - leaseMs
}
