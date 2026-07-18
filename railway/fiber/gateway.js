import http from 'node:http'
import net from 'node:net'
import { WebSocketServer } from 'ws'

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

const wss = new WebSocketServer({ noServer: true })

wss.on('connection', (socket) => {
  const upstream = net.connect({ host: p2pHost, port: p2pPort })

  socket.on('message', (data, isBinary) => {
    upstream.write(isBinary ? data : Buffer.from(data))
  })

  upstream.on('data', (chunk) => {
    if (socket.readyState === socket.OPEN) {
      socket.send(chunk, { binary: true })
    }
  })

  const closeBoth = () => {
    try {
      socket.close()
    } catch {
      // Ignore close races between websocket and TCP sides.
    }
    try {
      upstream.destroy()
    } catch {
      // Ignore close races between websocket and TCP sides.
    }
  }

  socket.on('close', closeBoth)
  socket.on('error', closeBoth)
  upstream.on('close', closeBoth)
  upstream.on('error', closeBoth)
})

server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req)
  })
})

server.listen(port, () => {
  console.log(`Dular Fiber gateway listening on ${port}`)
})
