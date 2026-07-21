import { config } from '../config.js'

export const RUSD_TYPE_SCRIPT = {
  code_hash: '0x1142755a044bf2ee358cba9f2da187ce928c91cd4dc8692ded0337efa677d21a',
  hash_type: 'type',
  args: '0x878fcc6f1f08d48e87bb1c3b3d5083f23f8a39c5d5c764f253b55b998526439b',
}

function hex(value) {
  return `0x${BigInt(value).toString(16)}`
}

async function withTimeout(promise, ms, label) {
  let timeout
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
      }),
    ])
  } finally {
    clearTimeout(timeout)
  }
}

export async function fiberRpc(method, params = [], rpcUrl = config.fiberRpcUrl) {
  const authorization = config.fiberRpcToken && rpcUrl === config.fiberRpcUrl
    ? { Authorization: `Bearer ${config.fiberRpcToken}` }
    : {}
  const response = await withTimeout(fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authorization },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  }), 30000, `Fiber RPC ${method}`)
  const text = await response.text()
  if (!response.ok) throw new Error(`Fiber RPC failed: ${response.status} ${response.statusText}`)
  if (!text) throw new Error('Empty Fiber RPC response')
  const payload = JSON.parse(text)
  if (payload.error) throw new Error(payload.error.message || JSON.stringify(payload.error))
  return payload.result
}

export async function getNodePubkey() {
  const info = await fiberRpc('node_info')
  return info.pubkey
}

export async function getNodeInfo(rpcUrl = config.fiberRpcUrl) {
  return fiberRpc('node_info', [], rpcUrl)
}

export async function getReceiverNodeInfo() {
  return fiberRpc('node_info', [], config.fiberReceiverRpcUrl)
}

export async function parseFiberInvoice(invoice, rpcUrl = config.fiberRpcUrl) {
  return fiberRpc('parse_invoice', [{ invoice }], rpcUrl)
}

export async function createReceiverInvoice({ amountBaseUnits, description }) {
  const result = await fiberRpc('new_invoice', [{
    amount: hex(amountBaseUnits),
    currency: 'Fibt',
    description,
    expiry: '0xe10',
    udt_type_script: RUSD_TYPE_SCRIPT,
  }], config.fiberReceiverRpcUrl)
  return result
}

export async function createOperatorInvoice({ amountBaseUnits, description, expiry = '0xe10' }) {
  return fiberRpc('new_invoice', [{
    amount: hex(amountBaseUnits),
    currency: 'Fibt',
    description,
    expiry,
    udt_type_script: RUSD_TYPE_SCRIPT,
  }])
}

export async function getFiberInvoice(paymentHash) {
  return fiberRpc('get_invoice', [{ payment_hash: paymentHash }])
}

export async function getFiberPayment(paymentHash) {
  try {
    return await getFiberPaymentDirect(paymentHash)
  } catch {
    const result = await fiberRpc('list_payments', [{ limit: '0x64' }])
    return result.payments?.find((payment) => payment.payment_hash === paymentHash) || null
  }
}

export async function getFiberPaymentDirect(paymentHash) {
  return fiberRpc('get_payment', [{ payment_hash: paymentHash }])
}

export async function listChannelsByPeer(pubkey, options = {}, rpcUrl = config.fiberRpcUrl) {
  if (typeof options === 'string') {
    rpcUrl = options
    options = {}
  }
  const params = pubkey ? { pubkey } : {}
  if (options.includeClosed) params.include_closed = true
  if (options.onlyPending) params.only_pending = true
  return fiberRpc('list_channels', [params], rpcUrl)
}

export async function listFiberPeers(rpcUrl = config.fiberRpcUrl) {
  return fiberRpc('list_peers', [], rpcUrl)
}

export async function connectFiberPeer({ pubkey, address, addrType = 'wss' }, rpcUrl = config.fiberRpcUrl) {
  const payload = {}
  if (pubkey) payload.pubkey = pubkey
  if (address) payload.address = address
  if (address && addrType) payload.addr_type = addrType
  return fiberRpc('connect_peer', [payload], rpcUrl)
}

export async function openFundedRUsdChannel({ pubkey, fundingAmountBaseUnits, isPublic = false }, rpcUrl = config.fiberRpcUrl) {
  return fiberRpc('open_channel', [{
    pubkey,
    funding_amount: hex(fundingAmountBaseUnits),
    public: isPublic,
    funding_udt_type_script: RUSD_TYPE_SCRIPT,
    tlc_fee_proportional_millionths: '0x0',
  }], rpcUrl)
}

export async function abandonFiberChannel(channelId, rpcUrl = config.fiberRpcUrl) {
  return fiberRpc('abandon_channel', [{ channel_id: channelId }], rpcUrl)
}

export async function updateFiberChannel({ channelId, tlcFeeProportionalMillionths = '0x0' }, rpcUrl = config.fiberRpcUrl) {
  return fiberRpc('update_channel', [{
    channel_id: channelId,
    tlc_fee_proportional_millionths: tlcFeeProportionalMillionths,
  }], rpcUrl)
}

export async function waitForReadyChannel(pubkey, { timeoutMs = 30000, pollMs = 2000 } = {}, rpcUrl = config.fiberRpcUrl) {
  const start = Date.now()
  let latest = null
  while (Date.now() - start < timeoutMs) {
    latest = await listChannelsByPeer(pubkey, rpcUrl)
    const ready = latest.channels?.find((channel) => (channel.state?.state_name || channel.state_name) === 'ChannelReady')
    if (ready) return { ready, channels: latest.channels || [] }
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
  return { ready: null, channels: latest?.channels || [] }
}

export async function sendFiberPayment(invoice, rpcUrl = config.fiberRpcUrl) {
  return fiberRpc('send_payment', [{ invoice }], rpcUrl)
}
