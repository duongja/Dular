import 'dotenv/config'
import { getDarajaAccessToken, requestDarajaJson } from './services/daraja.js'

const checkoutRequestId = process.argv[2]
if (!checkoutRequestId) {
  throw new Error('Usage: node server/check-stk-status.js <CheckoutRequestID>')
}

const environment = process.env.MPESA_ENVIRONMENT || 'production'
const baseUrl = environment === 'sandbox'
  ? 'https://sandbox.safaricom.co.ke'
  : 'https://api.safaricom.co.ke'

const shortcode = process.env.MPESA_SHORTCODE
const passkey = process.env.MPESA_PASSKEY
const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64')
const token = await getDarajaAccessToken()

const result = await requestDarajaJson(`${baseUrl}/mpesa/stkpushquery/v1/query`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    BusinessShortCode: shortcode,
    Password: password,
    Timestamp: timestamp,
    CheckoutRequestID: checkoutRequestId,
  }),
})

console.log(JSON.stringify(result, null, 2))
