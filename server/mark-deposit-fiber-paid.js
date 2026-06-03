import { query, withTransaction } from './db.js'
import { credit } from './services/ledger.js'
import { fiberRpc } from './services/fiber.js'

const depositId = process.argv[2]
const paymentHash = process.argv[3]

if (!depositId || !paymentHash) {
  console.error('Usage: node server/mark-deposit-fiber-paid.js <mpesa_transaction_id> <fiber_payment_hash>')
  process.exit(1)
}

const payments = await fiberRpc('list_payments', [{ limit: '0x64' }])
const payment = payments.payments?.find((item) => item.payment_hash === paymentHash)
if (!payment) {
  console.error(`Fiber payment not found in recent history: ${paymentHash}`)
  process.exit(1)
}
if (payment.status !== 'Success') {
  console.error(`Fiber payment is not successful: ${payment.status}`)
  process.exit(1)
}

const route = payment.routers || payment.route || []
const fee = payment.fee ? BigInt(payment.fee).toString() : '0'

const transaction = await withTransaction(async (client) => {
  const locked = await client.query(
    `SELECT * FROM mpesa_transactions
     WHERE id = $1
     FOR UPDATE`,
    [depositId],
  )
  const tx = locked.rows[0]
  if (!tx) throw new Error(`Deposit not found: ${depositId}`)

  await client.query(
    `INSERT INTO fiber_payments
       (user_id, payment_hash, direction, amount_base_units, fee_base_units, status, route, source_type, source_id)
     VALUES ($1, $2, 'received', $3, $4, 'Success', $5, 'mpesa_deposit', $6)
     ON CONFLICT (payment_hash) DO UPDATE
     SET status = 'Success',
         route = EXCLUDED.route,
         fee_base_units = EXCLUDED.fee_base_units`,
    [tx.user_id, paymentHash, tx.rusd_base_units, fee, JSON.stringify(route), tx.id],
  )

  await client.query(
    `UPDATE mpesa_transactions
     SET status = 'completed',
         fiber_payment_hash = $2,
         fiber_status = 'Success',
         fiber_fee_base_units = $3,
         fiber_route = $4,
         credited_at = COALESCE(credited_at, now()),
         updated_at = now()
     WHERE id = $1`,
    [tx.id, paymentHash, fee, JSON.stringify(route)],
  )

  await credit(client, {
    userId: tx.user_id,
    amount: BigInt(tx.rusd_base_units),
    sourceType: 'mpesa_deposit',
    sourceId: tx.id,
    metadata: {
      checkoutRequestId: tx.checkout_request_id,
      fiberPaymentHash: paymentHash,
      recoveredFromFiberHistory: true,
    },
  })

  return (await client.query(
    `SELECT id, status, checkout_request_id, fiber_payment_hash, fiber_status, credited_at, user_id
     FROM mpesa_transactions
     WHERE id = $1`,
    [depositId],
  )).rows[0]
})

const ledger = await query(
  `SELECT balance_base_units
   FROM ledger_accounts
   WHERE user_id = $1`,
  [transaction.user_id],
)

console.log(JSON.stringify({
  transaction,
  ledger: ledger.rows[0],
}, null, 2))

process.exit(0)
