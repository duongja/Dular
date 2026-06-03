import { payerRpcUrl, rpc } from './fiber-rpc.js'

const invoice = process.argv[2]
if (!invoice) {
  console.error('Usage: npm run fiber:pay -- <fibt invoice>')
  process.exit(1)
}

const result = await rpc(payerRpcUrl, 'send_payment', [{ invoice }])
console.log(JSON.stringify({ ok: true, payment: result }, null, 2))

