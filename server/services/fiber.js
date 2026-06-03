import { config } from '../config.js'

export const RUSD_TYPE_SCRIPT = {
  code_hash: '0x1142755a044bf2ee358cba9f2da187ce928c91cd4dc8692ded0337efa677d21a',
  hash_type: 'type',
  args: '0x878fcc6f1f08d48e87bb1c3b3d5083f23f8a39c5d5c764f253b55b998526439b',
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
  const response = await withTimeout(fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

export async function getReceiverNodeInfo() {
  return fiberRpc('node_info', [], config.fiberReceiverRpcUrl)
}

export async function createReceiverInvoice({ amountBaseUnits, description }) {
  const result = await fiberRpc('new_invoice', [{
    amount: `0x${BigInt(amountBaseUnits).toString(16)}`,
    currency: 'Fibt',
    description,
    expiry: '0xe10',
    udt_type_script: RUSD_TYPE_SCRIPT,
  }], config.fiberReceiverRpcUrl)
  return result
}
