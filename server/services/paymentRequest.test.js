import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  createPaymentLink,
  extractPaymentRequest,
  paymentRequestFromHash,
  removePaymentRequestFromUrl,
} from '../../src/lib/paymentRequest.js'

const INVOICE = `fibt1${'q'.repeat(530)}`
const TWO_RUSD_INVOICE = `fibt2${'p'.repeat(530)}`

describe('Fiber payment request formats', () => {
  it('keeps a raw Fiber invoice canonical', () => {
    assert.equal(extractPaymentRequest(`  ${INVOICE}  `), INVOICE)
    assert.equal(extractPaymentRequest(TWO_RUSD_INVOICE), TWO_RUSD_INVOICE)
  })

  it('creates and extracts an invoice from a Dular fragment link', () => {
    const link = createPaymentLink(INVOICE, 'https://wallet.dular.test/current/path')
    assert.equal(link.startsWith('https://wallet.dular.test/#pay='), true)
    assert.equal(extractPaymentRequest(link), INVOICE)
    assert.equal(paymentRequestFromHash(new URL(link).hash), INVOICE)
  })

  it('removes only the payment request from a consumed link', () => {
    const url = new URL(createPaymentLink(INVOICE, 'https://wallet.dular.test'))
    url.hash += '&view=compact'
    assert.equal(removePaymentRequestFromUrl(url.toString()), 'https://wallet.dular.test/#view=compact')
  })

  it('rejects malformed requests, missing link payloads, and oversized input', () => {
    assert.throws(() => extractPaymentRequest('not-an-invoice'), /valid Fiber/)
    assert.throws(() => extractPaymentRequest('https://wallet.dular.test/#view=send'), /does not contain/)
    assert.throws(() => extractPaymentRequest(`fibt1${'q'.repeat(9000)}`), /too long/)
    assert.throws(() => extractPaymentRequest('javascript:alert(1)'), /valid Fiber/)
  })
})
