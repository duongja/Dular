import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { formatUnits, payerRpcUrl, receiverRpcUrl, rpc } from './fiber-rpc.js'

const execFileAsync = promisify(execFile)

async function ckbCapacity(lockArg) {
  try {
    const { stdout } = await execFileAsync('ckb-cli', [
      '--url',
      'https://testnet.ckbapp.dev/',
      'wallet',
      'get-capacity',
      '--lock-arg',
      lockArg,
      '--output-format',
      'json',
    ], { timeout: 30_000 })
    return JSON.parse(stdout).total
  } catch (error) {
    return `unavailable: ${error.message}`
  }
}

async function addressFromLockArg(lockArg) {
  try {
    const { stdout } = await execFileAsync('ckb-cli', [
      '--url',
      'https://testnet.ckbapp.dev/',
      'util',
      'key-info',
      '--lock-arg',
      lockArg,
      '--output-format',
      'json',
    ], { timeout: 30_000 })
    return JSON.parse(stdout).address.testnet
  } catch {
    return null
  }
}

async function nodeSummary(label, rpcUrl) {
  const info = await rpc(rpcUrl, 'node_info')
  const ready = await rpc(rpcUrl, 'list_channels', [{}])
  const pending = await rpc(rpcUrl, 'list_channels', [{ only_pending: true }])
  const lockArg = info.default_funding_lock_script?.args
  const address = lockArg ? await addressFromLockArg(lockArg) : null
  const capacity = lockArg ? await ckbCapacity(lockArg) : 'unknown'

  return {
    label,
    rpcUrl,
    pubkey: info.pubkey,
    address,
    capacity,
    lockArg,
    peers: Number.parseInt(info.peers_count || '0x0', 16),
    readyChannels: ready.channels?.map((channel) => ({
      channelId: channel.channel_id,
      peer: channel.pubkey,
      state: channel.state?.state_name || channel.state_name,
      localRUsd: formatUnits(channel.local_balance || '0x0'),
      remoteRUsd: formatUnits(channel.remote_balance || '0x0'),
      outpoint: channel.channel_outpoint,
    })) || [],
    pendingChannels: pending.channels?.map((channel) => ({
      channelId: channel.channel_id,
      peer: channel.pubkey,
      state: channel.state?.state_name || channel.state_name,
      failure: channel.failure_detail,
    })) || [],
  }
}

const summaries = await Promise.all([
  nodeSummary('payer', payerRpcUrl),
  nodeSummary('receiver', receiverRpcUrl),
])

console.log(JSON.stringify({ ok: true, nodes: summaries }, null, 2))

