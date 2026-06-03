import 'dotenv/config'
import { requestDarajaJson, getDarajaAccessToken } from './services/daraja.js'

const conversationId = process.argv[2]
if (!conversationId) {
  throw new Error('Usage: node server/check-mpesa-status.js <ConversationID>')
}

const environment = process.env.MPESA_ENVIRONMENT || 'production'
const baseUrl = environment === 'sandbox'
  ? 'https://sandbox.safaricom.co.ke'
  : 'https://api.safaricom.co.ke'

const token = await getDarajaAccessToken()
const result = await requestDarajaJson(`${baseUrl}/mpesa/transactionstatus/v1/query`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    Initiator: process.env.MPESA_INITIATOR_NAME,
    SecurityCredential: process.env.MPESA_SECURITY_CREDENTIAL || process.env.MPESA_PROD_SECURITY_CREDENTIAL,
    CommandID: 'TransactionStatusQuery',
    TransactionID: conversationId,
    PartyA: process.env.MPESA_B2C_SHORTCODE || process.env.MPESA_SHORTCODE,
    IdentifierType: '4',
    ResultURL: `${process.env.PUBLIC_BASE_URL}/api/mpesa/callback/b2c`,
    QueueTimeOutURL: `${process.env.PUBLIC_BASE_URL}/api/mpesa/callback/b2c-timeout`,
    Remarks: 'Dular transaction status query',
    Occasion: 'DularStatus',
  }),
})

console.log(JSON.stringify(result, null, 2))
