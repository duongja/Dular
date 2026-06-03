import { config } from '../config.js'

export async function sendOtpSms(phone, code) {
  if (config.demoMode) {
    return { provider: 'demo', messageId: `demo-${Date.now()}`, code }
  }

  const body = new URLSearchParams({
    username: config.africasTalking.username,
    to: phone,
    message: `Your Dular verification code is ${code}. It expires in 10 minutes.`,
  })

  if (config.africasTalking.senderId) {
    body.set('from', config.africasTalking.senderId)
  }

  const response = await fetch('https://api.africastalking.com/version1/messaging', {
    method: 'POST',
    headers: {
      apiKey: config.africasTalking.apiKey,
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload.errorMessage || 'Africa’s Talking SMS request failed')
  }
  const rejected = payload.SMSMessageData?.Recipients?.find((recipient) => Number(recipient.statusCode) >= 400)
  if (rejected) {
    throw new Error(`Africa’s Talking rejected SMS to ${rejected.number}: ${rejected.status}`)
  }
  return payload
}
