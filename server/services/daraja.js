import { config } from '../config.js'
import https from 'node:https'

const BASE_URLS = {
  production: 'https://api.safaricom.co.ke',
  sandbox: 'https://sandbox.safaricom.co.ke',
}

let cachedToken = null
let cachedTokenExpiry = 0

function baseUrl() {
  return BASE_URLS[config.mpesa.environment] || BASE_URLS.production
}

function darajaRejection(message, statusCode = null) {
  const error = new Error(message)
  error.code = 'DARAJA_REJECTED'
  error.statusCode = statusCode
  return error
}

export function isDefinitiveDarajaError(error) {
  return error?.code === 'DARAJA_REJECTED'
}

export async function requestDarajaJson(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, { method, headers, timeout: 45000 }, (response) => {
      let responseBody = ''
      response.on('data', (chunk) => {
        responseBody += chunk
      })
      response.on('end', () => {
        let payload
        try {
          payload = responseBody ? JSON.parse(responseBody) : {}
        } catch {
          payload = { raw: responseBody }
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(darajaRejection(
            payload.errorMessage || payload.ResponseDescription || JSON.stringify(payload),
            response.statusCode,
          ))
          return
        }
        resolve(payload)
      })
    })
    request.on('timeout', () => request.destroy(new Error('Daraja request timed out')))
    request.on('error', reject)
    if (body) request.write(body)
    request.end()
  })
}

async function getAccessToken() {
  if (config.demoMode) return 'demo-token'
  if (cachedToken && Date.now() < cachedTokenExpiry) return cachedToken

  const credentials = Buffer.from(`${config.mpesa.consumerKey}:${config.mpesa.consumerSecret}`).toString('base64')
  const payload = await requestDarajaJson(`${baseUrl()}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${credentials}` },
  })

  cachedToken = payload.access_token
  cachedTokenExpiry = Date.now() + Math.max(0, Number(payload.expires_in || 3000) - 60) * 1000
  return cachedToken
}

export async function getDarajaAccessToken() {
  return getAccessToken()
}

function darajaTimestamp() {
  return new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
}

function mpesaPhone(phone) {
  return phone.replace('+', '')
}

export async function initiateStkPush({ phone, amountKes, accountReference, callbackUrl }) {
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
  const payload = await requestDarajaJson(`${baseUrl()}/mpesa/stkpush/v1/processrequest`, {
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
      CallBackURL: callbackUrl || `${config.publicBaseUrl}/api/mpesa/callback/stk`,
      AccountReference: accountReference,
      TransactionDesc: 'Dular RUSD deposit',
    }),
  })
  if (payload.ResponseCode !== '0') {
    throw darajaRejection(payload.errorMessage || payload.ResponseDescription || 'STK Push request failed')
  }
  return payload
}

export async function queryStkPushStatus({ checkoutRequestId }) {
  if (!checkoutRequestId) throw new Error('Checkout request id is required')

  if (config.demoMode) {
    return {
      ResponseCode: '0',
      ResponseDescription: 'Demo STK query accepted',
      MerchantRequestID: `demo-merchant-${Date.now()}`,
      CheckoutRequestID: checkoutRequestId,
      ResultCode: '0',
      ResultDesc: 'Demo STK payment processed successfully.',
    }
  }

  const token = await getAccessToken()
  const timestamp = darajaTimestamp()
  const password = Buffer.from(`${config.mpesa.shortcode}${config.mpesa.passkey}${timestamp}`).toString('base64')
  return requestDarajaJson(`${baseUrl()}/mpesa/stkpushquery/v1/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      BusinessShortCode: config.mpesa.shortcode,
      Password: password,
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    }),
  })
}

export async function initiateB2c({ phone, amountKes, remarks, occasion, originatorConversationId, resultUrl, timeoutUrl }) {
  if (config.demoMode) {
    return {
      ConversationID: `demo-b2c-${Date.now()}`,
      OriginatorConversationID: `demo-originator-${Date.now()}`,
      ResponseCode: '0',
      ResponseDescription: 'Demo B2C request accepted',
    }
  }

  const token = await getAccessToken()
  const payload = await requestDarajaJson(`${baseUrl()}/mpesa/b2c/v3/paymentrequest`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      OriginatorConversationID: originatorConversationId || `dular-${Date.now()}`,
      InitiatorName: config.mpesa.initiatorName,
      SecurityCredential: config.mpesa.securityCredential,
      CommandID: 'BusinessPayment',
      Amount: Math.round(Number(amountKes)),
      PartyA: config.mpesa.b2cShortcode,
      PartyB: mpesaPhone(phone),
      Remarks: remarks || 'Dular withdrawal',
      QueueTimeOutURL: timeoutUrl || config.mpesa.timeoutUrl || `${config.publicBaseUrl}/api/mpesa/callback/b2c-timeout`,
      ResultURL: resultUrl || `${config.publicBaseUrl}/api/mpesa/callback/b2c`,
      Occasion: occasion || 'Dular',
    }),
  })
  if (payload.ResponseCode !== '0') {
    throw new Error(payload.errorMessage || payload.ResponseDescription || 'B2C request failed')
  }
  return payload
}
