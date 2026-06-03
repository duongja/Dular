import { query, withTransaction } from './db.js'
import { queryStkPushStatus } from './services/daraja.js'
import { createFiberBackedDepositSettlement } from './services/settlement.js'

const depositId = process.argv[2]

if (!depositId) {
  console.error('Usage: node server/reconcile-deposit.js <mpesa_transaction_id>')
  process.exit(1)
}

function mergePayload(key, payload) {
  return JSON.stringify({
    [key]: payload,
    [`${key}At`]: new Date().toISOString(),
  })
}

function summarize(tx) {
  return {
    id: tx.id,
    status: tx.status,
    checkoutRequestId: tx.checkout_request_id,
    receiptNumber: tx.receipt_number,
    fiberPaymentHash: tx.fiber_payment_hash,
    fiberStatus: tx.fiber_status,
    creditedAt: tx.credited_at,
  }
}

const current = await query('SELECT * FROM mpesa_transactions WHERE id = $1', [depositId])
if (!current.rows[0]) {
  console.error(`Deposit not found: ${depositId}`)
  process.exit(1)
}

console.log(JSON.stringify({ before: summarize(current.rows[0]) }, null, 2))

let stkQuery = null
if (['initiating', 'pending'].includes(current.rows[0].status) && current.rows[0].checkout_request_id) {
  stkQuery = await queryStkPushStatus({ checkoutRequestId: current.rows[0].checkout_request_id })
  console.log(JSON.stringify({ stkQuery }, null, 2))
}

const transaction = await withTransaction(async (client) => {
  const locked = await client.query(
    `SELECT * FROM mpesa_transactions
     WHERE id = $1 AND kind = 'deposit'
     FOR UPDATE`,
    [depositId],
  )
  const tx = locked.rows[0]
  if (!tx) throw new Error(`Deposit not found: ${depositId}`)
  if (['completed', 'failed'].includes(tx.status)) return tx

  if (tx.status === 'mpesa_paid_fiber_pending') {
    await createFiberBackedDepositSettlement(client, tx, {
      receipt: tx.receipt_number,
      checkoutRequestId: tx.checkout_request_id,
    })
    return (await client.query('SELECT * FROM mpesa_transactions WHERE id = $1', [depositId])).rows[0]
  }

  if (stkQuery && Number(stkQuery.ResultCode) === 0) {
    const paid = await client.query(
      `UPDATE mpesa_transactions
       SET status = 'mpesa_paid_fiber_pending',
           provider_payload = COALESCE(provider_payload, '{}'::jsonb) || $2::jsonb,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [depositId, mergePayload('manualStkQuery', stkQuery)],
    )
    await createFiberBackedDepositSettlement(client, paid.rows[0], {
      receipt: paid.rows[0].receipt_number,
      checkoutRequestId: paid.rows[0].checkout_request_id,
    })
    return (await client.query('SELECT * FROM mpesa_transactions WHERE id = $1', [depositId])).rows[0]
  }

  if (stkQuery && stkQuery.ResultCode !== undefined) {
    return (await client.query(
      `UPDATE mpesa_transactions
       SET status = 'failed',
           provider_payload = COALESCE(provider_payload, '{}'::jsonb) || $2::jsonb,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [depositId, mergePayload('manualStkQuery', stkQuery)],
    )).rows[0]
  }

  return tx
})

const ledger = await query(
  `SELECT balance_base_units
   FROM ledger_accounts
   WHERE user_id = $1`,
  [transaction.user_id],
)

console.log(JSON.stringify({
  after: summarize(transaction),
  ledgerBalanceBaseUnits: ledger.rows[0]?.balance_base_units || '0',
}, null, 2))

process.exit(0)
