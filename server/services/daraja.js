import { config } from '../config.js'

const BASE_URLS = {
  production: 'https://api.safaricom.co.ke',
  sandbox: 'https://sandbox.safaricom.co.ke',
}

let cachedToken = null
let cachedTokenExpiry = 0

function baseUrl() {
  return BASE_URLS[config.mpesa.environment] || BASE_URLS.production
}

async function getAccessToken() {
  if (config.demoMode) return 'demo-token'
  if (cachedToken && Date.now() < cachedTokenExpiry) return cachedToken

  const credentials = Buffer.from(`${config.mpesa.consumerKey}:${config.mpesa.consumerSecret}`).toString('base64')
  const response = await fetch(`${baseUrl()}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${credentials}` },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.errorMessage || 'Daraja token request failed')

  cachedToken = payload.access_token
  cachedTokenExpiry = Date.now() + Math.max(0, Number(payload.expires_in || 3000) - 60) * 1000
  return cachedToken
}

function darajaTimestamp() {
  return new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
}

function mpesaPhone(phone) {
  return phone.replace('+', '')
}

export async function initiateStkPush({ phone, amountKes, accountReference }) {
  if (config.demoMode) {
    const id = `demo-stk-${Date.now()}`
    return {
      MerchantRequestID: `demo-merchant-${Date.now()}`,
      CheckoutRequestID: id,
      ResponseCode: '0',
      ResponseDescription: 'Demo STK Push accepted',
      CustomerMessage: `Demo mode: use callback fixture for ${id}`,
    }
  }

  const token = await getAccessToken()
  const timestamp = darajaTimestamp()
  const password = Buffer.from(`${config.mpesa.shortcode}${config.mpesa.passkey}${timestamp}`).toString('base64')
  const response = await fetch(`${baseUrl()}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      BusinessShortCode: config.mpesa.shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(Number(amountKes)),
      PartyA: mpesaPhone(phone),
      PartyB: config.mpesa.shortcode,
      PhoneNumber: mpesaPhone(phone),
      CallBackURL: `${config.publicBaseUrl}/api/mpesa/callback/stk`,
      AccountReference: accountReference,
      TransactionDesc: 'Dular RUSD deposit',
    }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload.ResponseCode !== '0') {
    throw new Error(payload.errorMessage || payload.ResponseDescription || 'STK Push request failed')
  }
  return payload
}

export async function initiateB2c({ phone, amountKes, remarks, occasion }) {
  if (config.demoMode) {
    return {
      ConversationID: `demo-b2c-${Date.now()}`,
      OriginatorConversationID: `demo-originator-${Date.now()}`,
      ResponseCode: '0',
      ResponseDescription: 'Demo B2C request accepted',
    }
  }

  const token = await getAccessToken()
  const response = await fetch(`${baseUrl()}/mpesa/b2c/v3/paymentrequest`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      OriginatorConversationID: `dular-${Date.now()}`,
      InitiatorName: config.mpesa.initiatorName,
      SecurityCredential: config.mpesa.securityCredential,
      CommandID: 'BusinessPayment',
      Amount: Math.round(Number(amountKes)),
      PartyA: config.mpesa.b2cShortcode,
      PartyB: mpesaPhone(phone),
      Remarks: remarks || 'Dular withdrawal',
      QueueTimeOutURL: config.mpesa.timeoutUrl || `${config.publicBaseUrl}/api/mpesa/callback/b2c-timeout`,
      ResultURL: `${config.publicBaseUrl}/api/mpesa/callback/b2c`,
      Occasion: occasion || 'Dular',
    }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload.ResponseCode !== '0') {
    throw new Error(payload.errorMessage || payload.ResponseDescription || 'B2C request failed')
  }
  return payload
}
