import 'dotenv/config'

export const RUSD_TYPE_SCRIPT = {
  code_hash: '0x1142755a044bf2ee358cba9f2da187ce928c91cd4dc8692ded0337efa677d21a',
  hash_type: 'type',
  args: '0x878fcc6f1f08d48e87bb1c3b3d5083f23f8a39c5d5c764f253b55b998526439b',
}

export const payerRpcUrl = process.env.FIBER_RPC_URL || 'http://127.0.0.1:8227'
export const receiverRpcUrl = process.env.FIBER_RECEIVER_RPC_URL || 'http://127.0.0.1:8247'

export async function rpc(rpcUrl, method, params = []) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${method} failed: ${response.status} ${response.statusText}`)
  const payload = JSON.parse(text)
  if (payload.error) throw new Error(payload.error.message || JSON.stringify(payload.error))
  return payload.result
}

export function hex(value) {
  return `0x${BigInt(value).toString(16)}`
}

export function fromHex(value) {
  if (typeof value === 'string' && value.startsWith('0x')) return BigInt(value)
  return BigInt(value || 0)
}

export function formatUnits(value, decimals = 8) {
  const amount = fromHex(value)
  const base = 10n ** BigInt(decimals)
  const whole = amount / base
  const fraction = (amount % base).toString().padStart(decimals, '0').replace(/0+$/, '')
  return `${whole}${fraction ? `.${fraction}` : ''}`
}

