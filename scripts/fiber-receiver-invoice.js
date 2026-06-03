import { hex, receiverRpcUrl, rpc, RUSD_TYPE_SCRIPT } from './fiber-rpc.js'

const amount = process.argv[2] ? BigInt(process.argv[2]) : 100_000_000n
const description = process.argv.slice(3).join(' ') || 'Dular receiver test invoice'

const result = await rpc(receiverRpcUrl, 'new_invoice', [{
  amount: hex(amount),
  currency: 'Fibt',
  description,
  expiry: '0xe10',
  udt_type_script: RUSD_TYPE_SCRIPT,
}])

console.log(JSON.stringify({
  ok: true,
  amountBaseUnits: amount.toString(),
  invoice: result.invoice_address,
  paymentHash: result.payment_hash,
}, null, 2))

