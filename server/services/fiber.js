import { config } from '../config.js'

export async function fiberRpc(method, params = []) {
  const response = await fetch(config.fiberRpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  })
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
