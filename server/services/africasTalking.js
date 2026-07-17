import { config } from '../config.js'

export async function sendOtpSms(phone, code) {
  if (config.otpDemoMode) {
    return { provider: 'demo', messageId: `demo-${Date.now()}`, code }
  }

  if (!config.africasTalking.username || !config.africasTalking.apiKey) {
    throw new Error('Africa’s Talking SMS is not configured. Set AT_USERNAME and AT_API_KEY, or set OTP_DEMO_MODE=true for reviewer testing.')
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

  const text = await response.text()
  let payload
  try {
    payload = text ? JSON.parse(text) : {}
  } catch {
    payload = { raw: text }
  }

  if (!response.ok) {
    const providerMessage = payload.errorMessage || payload.message || payload.raw
    throw new Error(
      providerMessage
        ? `Africa’s Talking SMS request failed: ${providerMessage}`
        : `Africa’s Talking SMS request failed with HTTP ${response.status}`,
    )
  }
  const rejected = payload.SMSMessageData?.Recipients?.find((recipient) => Number(recipient.statusCode) >= 400)
  if (rejected) {
    throw new Error(`Africa’s Talking rejected SMS to ${rejected.number}: ${rejected.status}`)
  }
  return payload
}
