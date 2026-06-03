import { hex, payerRpcUrl, receiverRpcUrl, rpc, RUSD_TYPE_SCRIPT } from './fiber-rpc.js'

const amount = process.argv[2] ? BigInt(process.argv[2]) : 2_000_000_000n
const receiver = await rpc(receiverRpcUrl, 'node_info')

await rpc(payerRpcUrl, 'connect_peer', [{ pubkey: receiver.pubkey }])

const result = await rpc(payerRpcUrl, 'open_channel', [{
  pubkey: receiver.pubkey,
  funding_amount: hex(amount),
  public: true,
  funding_udt_type_script: RUSD_TYPE_SCRIPT,
}])

console.log(JSON.stringify({
  ok: true,
  receiverPubkey: receiver.pubkey,
  requestedFundingBaseUnits: amount.toString(),
  temporaryChannelId: result.temporary_channel_id,
  next: 'Run npm run fiber:status until the channel is ChannelReady. If it closes with balance capacity error, fund the receiver CKB address shown by npm run fiber:status.',
}, null, 2))

