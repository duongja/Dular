import { payerRpcUrl, receiverRpcUrl, rpc } from './fiber-rpc.js'

const payer = await rpc(payerRpcUrl, 'node_info')
const receiver = await rpc(receiverRpcUrl, 'node_info')

await rpc(payerRpcUrl, 'connect_peer', [{ pubkey: receiver.pubkey }])
await rpc(receiverRpcUrl, 'connect_peer', [{ pubkey: payer.pubkey }])

console.log(JSON.stringify({
  ok: true,
  payer: { rpcUrl: payerRpcUrl, pubkey: payer.pubkey },
  receiver: { rpcUrl: receiverRpcUrl, pubkey: receiver.pubkey },
}, null, 2))

