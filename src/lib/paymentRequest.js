const MAX_PAYMENT_REQUEST_LENGTH = 8192
const MAX_PAYMENT_INPUT_LENGTH = 12000
const PAYMENT_REQUEST_HASH_KEY = 'pay'

function normalizeFiberInvoice(value) {
  const invoice = String(value || '').trim()
  if (!invoice) throw new Error('A Fiber payment request is required')
  if (invoice.length > MAX_PAYMENT_REQUEST_LENGTH) throw new Error('The Fiber payment request is too long')
  if (!/^fibt[0-9a-z]{32,}$/i.test(invoice)) throw new Error('This is not a valid Fiber testnet payment request')
  return invoice
}

function paymentRequestFromUrl(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('This payment link is not valid')
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('This payment link uses an unsupported protocol')
  const params = new URLSearchParams(url.hash.replace(/^#/, ''))
  const invoice = params.get(PAYMENT_REQUEST_HASH_KEY)
  if (!invoice) throw new Error('This link does not contain a Fiber payment request')
  return normalizeFiberInvoice(invoice)
}

export function extractPaymentRequest(value) {
  const input = String(value || '').trim()
  if (!input) throw new Error('A payment request or link is required')
  if (input.length > MAX_PAYMENT_INPUT_LENGTH) throw new Error('The payment request input is too long')
  if (/^https?:/i.test(input)) return paymentRequestFromUrl(input)
  return normalizeFiberInvoice(input)
}

export function createPaymentLink(invoice, origin) {
  const request = normalizeFiberInvoice(invoice)
  const url = new URL('/', origin)
  url.hash = new URLSearchParams({ [PAYMENT_REQUEST_HASH_KEY]: request }).toString()
  return url.toString()
}

export function paymentRequestFromHash(hash) {
  const params = new URLSearchParams(String(hash || '').replace(/^#/, ''))
  if (!params.has(PAYMENT_REQUEST_HASH_KEY)) return ''
  return normalizeFiberInvoice(params.get(PAYMENT_REQUEST_HASH_KEY))
}

export function removePaymentRequestFromUrl(value) {
  const url = new URL(value)
  const params = new URLSearchParams(url.hash.replace(/^#/, ''))
  params.delete(PAYMENT_REQUEST_HASH_KEY)
  const nextHash = params.toString()
  url.hash = nextHash ? `#${nextHash}` : ''
  return url.toString()
}
