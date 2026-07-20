import http from 'node:http'
import net from 'node:net'

const port = Number(process.env.PORT || 3000)
const rpcUrl = process.env.FIBER_RPC_URL || 'http://127.0.0.1:8227'
const p2pHost = process.env.FIBER_P2P_HOST || '127.0.0.1'
const p2pPort = Number(process.env.FIBER_P2P_PORT || 8228)

async function proxyRpc(req, res) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const body = Buffer.concat(chunks)

  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': req.headers['content-type'] || 'application/json' },
    body,
  })

  const payload = Buffer.from(await response.arrayBuffer())
  res.writeHead(response.status, {
    'content-type': response.headers.get('content-type') || 'application/json',
    'access-control-allow-origin': '*',
  })
  res.end(payload)
}

async function readNodeInfo() {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'node_info',
      params: [],
    }),
  })
  const payload = await response.json()
  if (payload.error) throw new Error(payload.error.message || JSON.stringify(payload.error))
  return payload.result
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'content-type',
      })
      res.end()
      return
    }

    if (req.method === 'POST' && (req.url === '/' || req.url === '/rpc')) {
      await proxyRpc(req, res)
      return
    }

    if (req.method === 'GET' && req.url === '/health') {
      try {
        const nodeInfo = await readNodeInfo()
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, gateway: 'online', fiber: 'online', pubkey: nodeInfo.pubkey }))
      } catch (error) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, gateway: 'online', fiber: 'starting', error: error.message }))
      }
      return
    }

    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not found' }))
  } catch (error) {
    res.writeHead(502, {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
    })
    res.end(JSON.stringify({ error: error.message || 'Fiber gateway request failed' }))
  }
})

function serializeUpgradeRequest(req) {
  const lines = [`${req.method} ${req.url || '/'} HTTP/${req.httpVersion}`]
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) lines.push(`${name}: ${item}`)
    } else if (value !== undefined) {
      lines.push(`${name}: ${value}`)
    }
  }
  return `${lines.join('\r\n')}\r\n\r\n`
}

server.on('upgrade', (req, socket, head) => {
  const upstream = net.connect({ host: p2pHost, port: p2pPort }, () => {
    upstream.write(serializeUpgradeRequest(req))
    if (head.length) upstream.write(head)
    socket.pipe(upstream)
    upstream.pipe(socket)
  })

  const closeBoth = () => {
    socket.destroy()
    upstream.destroy()
  }

  socket.on('error', closeBoth)
  socket.on('close', closeBoth)
  upstream.on('error', closeBoth)
  upstream.on('close', closeBoth)
})

server.listen(port, () => {
  console.log(`Dular Fiber gateway listening on ${port}`)
})
