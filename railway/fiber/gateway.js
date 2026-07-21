import http from 'node:http'
import net from 'node:net'
import { createHash, timingSafeEqual } from 'node:crypto'

const port = Number(process.env.PORT || 3000)
const rpcUrl = process.env.FIBER_RPC_URL || 'http://127.0.0.1:8227'
const rpcToken = process.env.FIBER_GATEWAY_RPC_TOKEN || ''
const rpcOrigin = process.env.FIBER_GATEWAY_RPC_ORIGIN || ''
const p2pHost = process.env.FIBER_P2P_HOST || '127.0.0.1'
const p2pPort = Number(process.env.FIBER_P2P_PORT || 8228)
const maxRpcBodyBytes = 1024 * 1024
const upstreamTimeoutMs = 30_000
const rpcAuthorizationHash = rpcToken
  ? createHash('sha256').update(`Bearer ${rpcToken}`).digest()
  : null

function isRpcPath(url) {
  return url === '/' || url === '/rpc'
}

function isRpcAuthorized(req) {
  if (!rpcAuthorizationHash) return false

  const authorizationHeaders = []
  for (let index = 0; index < req.rawHeaders.length; index += 2) {
    if (req.rawHeaders[index].toLowerCase() === 'authorization') {
      authorizationHeaders.push(req.rawHeaders[index + 1])
    }
  }
  if (authorizationHeaders.length !== 1) return false

  const authorizationHash = createHash('sha256').update(authorizationHeaders[0]).digest()
  return timingSafeEqual(authorizationHash, rpcAuthorizationHash)
}

function rpcCorsHeaders() {
  return rpcOrigin ? { 'access-control-allow-origin': rpcOrigin } : {}
}

function sendJson(res, status, payload, headers = {}, callback) {
  if (res.headersSent || res.writableEnded || res.destroyed) return false

  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(JSON.stringify(payload), callback)
  return true
}

function stopRequest(req, res, status, payload, headers = {}) {
  req.pause()
  req.once('error', () => {})
  res.shouldKeepAlive = false
  const sent = sendJson(res, status, payload, { ...headers, connection: 'close' }, () => req.destroy())
  if (!sent) req.destroy()
}

function declaredBodyTooLarge(req) {
  const contentLength = req.headers['content-length']
  if (typeof contentLength !== 'string') return false
  return Number(contentLength) > maxRpcBodyBytes
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0

    const cleanup = () => {
      req.off('data', onData)
      req.off('end', onEnd)
      req.off('aborted', onAborted)
      req.off('error', onError)
    }

    const onData = (chunk) => {
      size += chunk.length
      if (size > maxRpcBodyBytes) {
        cleanup()
        req.pause()
        resolve(null)
        return
      }
      chunks.push(chunk)
    }

    const onEnd = () => {
      cleanup()
      resolve(Buffer.concat(chunks, size))
    }

    const onAborted = () => {
      cleanup()
      reject(new Error('Request aborted'))
    }

    const onError = (error) => {
      cleanup()
      reject(error)
    }

    req.on('data', onData)
    req.once('end', onEnd)
    req.once('aborted', onAborted)
    req.once('error', onError)
  })
}

async function callRpc(body, contentType = 'application/json') {
  const controller = new AbortController()
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, upstreamTimeoutMs)
  timeout.unref()

  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': contentType },
      body,
      signal: controller.signal,
    })
    const payload = Buffer.from(await response.arrayBuffer())
    return {
      status: response.status,
      contentType: response.headers.get('content-type') || 'application/json',
      payload,
    }
  } catch (error) {
    if (timedOut) {
      const timeoutError = new Error('Fiber RPC upstream timed out')
      timeoutError.code = 'UPSTREAM_TIMEOUT'
      throw timeoutError
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

async function proxyRpc(req, res) {
  const corsHeaders = rpcCorsHeaders()
  if (declaredBodyTooLarge(req)) {
    stopRequest(req, res, 413, { error: 'Request body too large' }, corsHeaders)
    return
  }

  const body = await readRequestBody(req)
  if (body === null) {
    stopRequest(req, res, 413, { error: 'Request body too large' }, corsHeaders)
    return
  }

  const contentType = typeof req.headers['content-type'] === 'string'
    ? req.headers['content-type']
    : 'application/json'
  const response = await callRpc(body, contentType)
  res.writeHead(response.status, {
    'content-type': response.contentType,
    ...corsHeaders,
  })
  res.end(response.payload)
}

async function readNodeInfo() {
  const response = await callRpc(
    JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'node_info',
      params: [],
    }),
  )
  const payload = JSON.parse(response.payload.toString('utf8'))
  if (!payload || typeof payload !== 'object' || payload.error || !payload.result) {
    throw new Error('Fiber node info unavailable')
  }
  return payload.result
}

const server = http.createServer(async (req, res) => {
  try {
    if (
      req.method === 'OPTIONS'
      && isRpcPath(req.url)
      && rpcToken
      && rpcOrigin
      && req.headers.origin === rpcOrigin
    ) {
      res.writeHead(204, {
        'access-control-allow-origin': rpcOrigin,
        'access-control-allow-methods': 'POST',
        'access-control-allow-headers': 'authorization, content-type',
      })
      res.end()
      return
    }

    if (req.method === 'POST' && isRpcPath(req.url)) {
      if (!rpcToken) {
        stopRequest(req, res, 404, { error: 'Not found' })
        return
      }

      if (!isRpcAuthorized(req)) {
        stopRequest(req, res, 401, { error: 'Unauthorized' }, {
          ...rpcCorsHeaders(),
          'www-authenticate': 'Bearer',
        })
        return
      }

      await proxyRpc(req, res)
      return
    }

    if (req.method === 'GET' && req.url === '/health') {
      try {
        const nodeInfo = await readNodeInfo()
        sendJson(res, 200, { ok: true, gateway: 'online', fiber: 'online', pubkey: nodeInfo.pubkey })
      } catch {
        sendJson(res, 200, { ok: true, gateway: 'online', fiber: 'starting' })
      }
      return
    }

    sendJson(res, 404, { error: 'Not found' })
  } catch (error) {
    const status = error?.code === 'UPSTREAM_TIMEOUT' ? 504 : 502
    const message = status === 504 ? 'Fiber RPC upstream timed out' : 'Fiber gateway request failed'
    const headers = req.method === 'POST' && isRpcPath(req.url) && rpcToken
      ? rpcCorsHeaders()
      : {}
    if (!sendJson(res, status, { error: message }, headers)) res.destroy()
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
