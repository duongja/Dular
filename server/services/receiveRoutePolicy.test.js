import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { evaluateReceiveRouteAuthorization } from './receiveRoutePolicy.js'

const PUBKEY = `02${'ab'.repeat(32)}`
const LOCK_ARG = `0x${'cd'.repeat(20)}`

function evaluate(overrides = {}) {
  return evaluateReceiveRouteAuthorization({
    enabled: true,
    sessionFiberPubkey: PUBKEY,
    currentFiberPubkey: PUBKEY,
    currentFundingLockArg: LOCK_ARG,
    ...overrides,
  })
}

describe('receive route authorization', () => {
  it('allows a fully bound authenticated wallet', () => {
    assert.equal(evaluate().allowed, true)
  })

  it('rejects disabled operator receive routes', () => {
    const result = evaluate({ enabled: false })
    assert.equal(result.allowed, false)
    assert.match(result.error, /disabled/)
  })

  it('rejects a wallet without a CKB ownership binding', () => {
    const result = evaluate({ currentFundingLockArg: null })
    assert.equal(result.allowed, false)
    assert.match(result.error, /Register this browser wallet/)
  })

  it('rejects a stale authenticated Fiber identity', () => {
    const result = evaluate({ currentFiberPubkey: `03${'ef'.repeat(32)}` })
    assert.equal(result.allowed, false)
    assert.match(result.error, /identity changed/)
  })

  it('rejects a browser node from another authenticated tab', () => {
    const result = evaluate({ browserFiberPubkey: `03${'ef'.repeat(32)}` })
    assert.equal(result.allowed, false)
    assert.match(result.error, /does not match the authenticated account/)
  })
})
