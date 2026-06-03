import { fiberRpc } from './fiber.js'
import { credit } from './ledger.js'

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function paymentStatus(payment) {
  return payment?.status || payment?.state || 'unknown'
}

async function getPayment(paymentHash) {
  const payment = await findPaymentInHistory(paymentHash)
  if (!payment) throw new Error(`Fiber payment ${paymentHash} not found in recent payment history`)
  return payment
}

async function findPaymentInHistory(paymentHash) {
  const result = await fiberRpc('list_payments', [{ limit: '0x32' }])
  return result.payments?.find((item) => item.payment_hash === paymentHash) || null
}

async function waitForPaymentInHistory(paymentHash) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const payment = await findPaymentInHistory(paymentHash)
    if (payment) return payment
    await sleep(1000)
  }

  throw new Error(`Fiber payment ${paymentHash} was not found after send timeout`)
}

function invoicePaymentHash(tx) {
  return tx.fiber_payment_hash
    || tx.provider_payload?.fiberInvoicePaymentHash
    || tx.provider_payload?.fiber_invoice_payment_hash
    || tx.provider_payload?.fiberInvoice?.paymentHash
    || null
}

async function waitForFinalPayment(initialPayment, paymentHash) {
  let payment = initialPayment
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const status = paymentStatus(payment)
    if (status === 'Success') return payment
    if (['Failed', 'Cancelled', 'Canceled', 'Timeout'].includes(status)) {
      throw new Error(`Fiber payment failed with status ${status}`)
    }
    await sleep(1000)
    payment = await getPayment(paymentHash)
  }

  throw new Error(`Fiber payment did not reach Success before timeout. Last status: ${paymentStatus(payment)}`)
}

export async function createFiberBackedDepositSettlement(client, tx, { receipt, checkoutRequestId }) {
  const invoiceAddress = tx.fiber_invoice
  if (!invoiceAddress) {
    throw new Error('Deposit is missing a receiver Fiber invoice')
  }

  if (tx.status === 'completed' && tx.fiber_payment_hash) {
    return { invoiceAddress, payment: { payment_hash: tx.fiber_payment_hash, status: tx.fiber_status || 'Success' } }
  }

  const expectedPaymentHash = invoicePaymentHash(tx)

  if (expectedPaymentHash && !tx.fiber_payment_hash) {
    await client.query(
      `UPDATE mpesa_transactions
       SET fiber_payment_hash = $2,
           fiber_status = COALESCE(fiber_status, 'InvoiceCreated'),
           updated_at = now()
       WHERE id = $1`,
      [tx.id, expectedPaymentHash],
    )
  }

  let initialPayment = expectedPaymentHash ? await findPaymentInHistory(expectedPaymentHash) : null

  if (!initialPayment) {
    await client.query(
      `UPDATE mpesa_transactions
       SET fiber_payment_hash = COALESCE($2, fiber_payment_hash),
           fiber_status = 'Sending',
           updated_at = now()
       WHERE id = $1`,
      [tx.id, expectedPaymentHash],
    )

    try {
      initialPayment = await fiberRpc('send_payment', [{ invoice: invoiceAddress }])
    } catch (error) {
      if (!expectedPaymentHash) throw error
      initialPayment = await waitForPaymentInHistory(expectedPaymentHash)
    }
  }

  const paymentHash = initialPayment.payment_hash || expectedPaymentHash

  if (!paymentHash) {
    throw new Error('Fiber node did not return a payment hash')
  }

  await client.query(
    `UPDATE mpesa_transactions
     SET fiber_payment_hash = $2,
         fiber_status = $3,
         updated_at = now()
     WHERE id = $1`,
    [tx.id, paymentHash, paymentStatus(initialPayment)],
  )

  const payment = await waitForFinalPayment(initialPayment, paymentHash)
  const status = paymentStatus(payment)
  const route = payment.routers || payment.route || []
  const fee = payment.fee ? BigInt(payment.fee).toString() : '0'

  await client.query(
    `INSERT INTO fiber_payments
       (user_id, payment_hash, direction, amount_base_units, fee_base_units, status, route, source_type, source_id)
     VALUES ($1, $2, 'received', $3, $4, $5, $6, 'mpesa_deposit', $7)
     ON CONFLICT (payment_hash) DO UPDATE
     SET status = EXCLUDED.status,
         route = EXCLUDED.route,
         fee_base_units = EXCLUDED.fee_base_units
     RETURNING *`,
    [tx.user_id, paymentHash, tx.rusd_base_units, fee, status, route, tx.id],
  )

  await client.query(
    `UPDATE mpesa_transactions
     SET status = 'completed',
         receipt_number = $2,
         fiber_invoice = $3,
         fiber_payment_hash = $4,
         fiber_status = $5,
         fiber_fee_base_units = $6,
         fiber_route = $7,
         credited_at = now(),
         updated_at = now()
     WHERE id = $1`,
    [tx.id, receipt || null, invoiceAddress, paymentHash, status, fee, route],
  )

  await credit(client, {
    userId: tx.user_id,
    amount: BigInt(tx.rusd_base_units),
    sourceType: 'mpesa_deposit',
    sourceId: tx.id,
    metadata: { checkoutRequestId, receipt, fiberPaymentHash: paymentHash },
  })

  return { invoiceAddress, payment }
}
