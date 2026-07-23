function isoDate(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function stringAmount(value) {
  return value === null || value === undefined ? null : String(value)
}

function baseActivity({ id, kind, category, direction, status, title, detail, createdAt, updatedAt, ...rest }) {
  return {
    id,
    kind,
    category,
    direction,
    status,
    title,
    detail,
    createdAt: isoDate(createdAt),
    updatedAt: isoDate(updatedAt || createdAt),
    ...rest,
  }
}

export function rampActivity(row, source = 'ramp_order') {
  const deposit = row.kind === 'deposit'
  return baseActivity({
    id: `${source}:${row.id}`,
    kind: deposit ? 'mpesa_deposit' : 'mpesa_withdrawal',
    category: 'mpesa',
    direction: deposit ? 'in' : 'out',
    status: row.status,
    title: deposit ? 'M-Pesa deposit' : 'M-Pesa cash-out',
    detail: row.receipt_number ? `Receipt ${row.receipt_number}` : deposit ? 'KES to Fiber RUSD' : 'Fiber RUSD to KES',
    amountBaseUnits: stringAmount(row.rusd_amount_base_units ?? row.rusd_base_units),
    kesAmount: stringAmount(row.kes_amount),
    paymentHash: row.fiber_payment_hash || null,
    reference: row.receipt_number || row.checkout_request_id || row.conversation_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
}

export function fiberPaymentActivity(row) {
  if (row.source_type === 'mpesa_deposit') return null
  const sent = row.direction === 'sent'
  const phonePayment = row.source_type === 'phone_keysend'
  return baseActivity({
    id: `fiber_payment:${row.id}`,
    kind: phonePayment ? 'phone_send' : sent ? 'invoice_send' : 'invoice_receive',
    category: 'fiber',
    direction: sent ? 'out' : 'in',
    status: row.status,
    title: phonePayment ? 'Sent to Dular number' : sent ? 'Fiber payment sent' : 'Fiber payment received',
    detail: row.activity_metadata?.recipientPhone || row.activity_metadata?.senderPhone || 'Fiber RUSD payment',
    amountBaseUnits: stringAmount(row.amount_base_units),
    feeBaseUnits: stringAmount(row.fee_base_units),
    paymentHash: row.payment_hash || null,
    phone: row.activity_metadata?.recipientPhone || row.activity_metadata?.senderPhone || null,
    createdAt: row.created_at,
    updatedAt: row.created_at,
  })
}

export function auditActivity(row, userId) {
  const metadata = row.metadata || {}
  const recipient = String(metadata.recipientUserId || '') === String(userId)
  if (row.event_type === 'phone_fiber_keysend_completed') {
    if (!recipient) return null
    return baseActivity({
      id: `audit:${row.id}`,
      kind: 'phone_receive',
      category: 'fiber',
      direction: 'in',
      status: 'Success',
      title: 'Received by Dular number',
      detail: metadata.senderPhone || 'Fiber RUSD payment',
      amountBaseUnits: stringAmount(metadata.amountBaseUnits),
      paymentHash: metadata.paymentHash || null,
      phone: metadata.senderPhone || null,
      createdAt: row.created_at,
    })
  }
  if (row.event_type === 'fiber_invoice_payment_completed') {
    if (!recipient) return null
    return baseActivity({
      id: `audit:${row.id}`,
      kind: 'invoice_receive',
      category: 'fiber',
      direction: 'in',
      status: 'Success',
      title: 'Fiber payment received',
      detail: metadata.senderPhone || 'Invoice paid by another wallet',
      amountBaseUnits: stringAmount(metadata.amountBaseUnits),
      paymentHash: metadata.paymentHash || null,
      phone: metadata.senderPhone || null,
      createdAt: row.created_at,
    })
  }
  if (row.event_type === 'fiber_invoice_payment_received') {
    return baseActivity({
      id: `audit:${row.id}`,
      kind: 'invoice_receive',
      category: 'fiber',
      direction: 'in',
      status: metadata.status || 'Received',
      title: 'Fiber payment received',
      detail: 'Payment request completed',
      amountBaseUnits: stringAmount(metadata.amountBaseUnits),
      paymentHash: metadata.paymentHash || null,
      createdAt: row.created_at,
    })
  }
  if (row.event_type === 'fiber_payment_request_created') {
    return baseActivity({
      id: `audit:${row.id}`,
      kind: 'payment_request',
      category: 'request',
      direction: 'neutral',
      status: metadata.status || 'Open',
      title: 'Payment request created',
      detail: metadata.description || 'Fiber invoice',
      amountBaseUnits: stringAmount(metadata.amountBaseUnits),
      paymentHash: metadata.paymentHash || null,
      createdAt: row.created_at,
    })
  }
  if (row.event_type === 'wallet_channel_activated') {
    return baseActivity({
      id: `audit:${row.id}`,
      kind: 'channel_activated',
      category: 'wallet',
      direction: 'neutral',
      status: 'Success',
      title: 'RUSD made spendable',
      detail: 'Self-funded Fiber channel activated',
      amountBaseUnits: stringAmount(metadata.amountBaseUnits),
      reference: metadata.channelOutpoint || metadata.channelId || row.entity_id || null,
      createdAt: row.created_at,
    })
  }
  if (row.event_type === 'receive_route_funding_reserved') {
    return baseActivity({
      id: `audit:${row.id}`,
      kind: 'receive_route',
      category: 'wallet',
      direction: 'neutral',
      status: 'Success',
      title: 'Receive route prepared',
      detail: 'Inbound Fiber liquidity reserved',
      amountBaseUnits: stringAmount(metadata.requestedAmountBaseUnits),
      createdAt: row.created_at,
    })
  }
  if (row.event_type === 'legacy_wallet_identity_migrated') {
    return baseActivity({
      id: `audit:${row.id}`,
      kind: 'wallet_migrated',
      category: 'wallet',
      direction: 'neutral',
      status: 'Success',
      title: 'Wallet identity migrated',
      detail: 'Self-custody identity updated',
      reference: metadata.fiberPubkey || null,
      createdAt: row.created_at,
    })
  }
  if (row.event_type === 'wallet_identity_bound') {
    return baseActivity({
      id: `audit:${row.id}`,
      kind: 'wallet_created',
      category: 'wallet',
      direction: 'neutral',
      status: 'Success',
      title: 'Self-custody wallet created',
      detail: 'Fiber identity registered to this number',
      reference: metadata.fiberPubkey || null,
      createdAt: row.created_at,
    })
  }
  return null
}

export function mergeActivity({ rampOrders = [], legacyMpesa = [], fiberPayments = [], audits = [], userId, limit = 100 }) {
  const rows = [
    ...rampOrders.map((row) => rampActivity(row)),
    ...legacyMpesa.map((row) => rampActivity(row, 'mpesa_transaction')),
    ...fiberPayments.map(fiberPaymentActivity),
    ...audits.map((row) => auditActivity(row, userId)),
  ].filter(Boolean)

  const receivedHashes = new Set(rows
    .filter((row) => row.kind === 'invoice_receive' && row.paymentHash)
    .map((row) => row.paymentHash))
  for (const row of rows) {
    if (row.kind === 'payment_request' && receivedHashes.has(row.paymentHash)) {
      row.status = 'Received'
      row.detail = 'Fiber payment request completed'
    }
  }

  const seen = new Set()
  return rows
    .sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0))
    .filter((row) => {
      const dedupeKey = row.paymentHash && row.direction === 'in'
        ? `incoming:${row.paymentHash}`
        : row.id
      if (seen.has(dedupeKey)) return false
      seen.add(dedupeKey)
      return true
    })
    .slice(0, limit)
}
