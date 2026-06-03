import 'dotenv/config'
import https from 'node:https'

const environment = process.env.MPESA_ENVIRONMENT || 'production'
const baseUrl = environment === 'sandbox'
  ? 'https://sandbox.safaricom.co.ke'
  : 'https://api.safaricom.co.ke'

const key = process.env.MPESA_CONSUMER_KEY
const secret = process.env.MPESA_CONSUMER_SECRET

if (!key || !secret) {
  throw new Error('MPESA_CONSUMER_KEY and MPESA_CONSUMER_SECRET are required')
}

const credentials = Buffer.from(`${key}:${secret}`).toString('base64')
const payload = await new Promise((resolve, reject) => {
  const request = https.request(
    `${baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
    {
      method: 'GET',
      headers: { Authorization: `Basic ${credentials}` },
      timeout: 45000,
    },
    (response) => {
      let body = ''
      response.on('data', (chunk) => {
        body += chunk
      })
      response.on('end', () => {
        const parsed = body ? JSON.parse(body) : {}
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(JSON.stringify(parsed)))
          return
        }
        resolve(parsed)
      })
    },
  )
  request.on('timeout', () => request.destroy(new Error('Daraja token request timed out')))
  request.on('error', reject)
  request.end()
})

console.log(JSON.stringify({
  ok: true,
  environment,
  tokenType: payload.access_token ? 'received' : 'missing',
  expiresIn: payload.expires_in,
}, null, 2))
