import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { evaluateWalletBinding } from './walletBindingPolicy.js'

const OLD_FIBER_PUBKEY = `02${'ab'.repeat(32)}`
const NEW_FIBER_PUBKEY = `03${'cd'.repeat(32)}`
const OLD_LOCK_ARG = `0x${'12'.repeat(20)}`
const NEW_LOCK_ARG = `0x${'34'.repeat(20)}`

function evaluate(overrides = {}) {
  return evaluateWalletBinding({
    currentFiberPubkey: OLD_FIBER_PUBKEY,
    currentFundingLockArg: null,
    requestedFiberPubkey: NEW_FIBER_PUBKEY,
    requestedFundingLockArg: NEW_LOCK_ARG,
    hasActiveRampOrder: false,
    operatorChannelCount: 0,
    ...overrides,
  })
}

describe('wallet binding policy', () => {
  it('allows a new wallet binding', () => {
    const result = evaluate({ currentFiberPubkey: null })
    assert.equal(result.allowed, true)
    assert.equal(result.legacyMigration, false)
  })

  it('allows a legacy account to complete the same Fiber identity binding', () => {
    const result = evaluate({ requestedFiberPubkey: OLD_FIBER_PUBKEY })
    assert.equal(result.allowed, true)
    assert.equal(result.legacyMigration, false)
  })

  it('allows an empty legacy identity migration', () => {
    const result = evaluate()
    assert.equal(result.allowed, true)
    assert.equal(result.legacyMigration, true)
    assert.equal(result.migrationReason, 'empty_legacy_wallet')
  })

  it('blocks a legacy migration while a ramp order is active', () => {
    const result = evaluate({ hasActiveRampOrder: true })
    assert.equal(result.allowed, false)
    assert.match(result.error, /active ramp order/)
  })

  it('blocks a legacy migration with active or pending operator channels', () => {
    const result = evaluate({ operatorChannelCount: 1 })
    assert.equal(result.allowed, false)
    assert.match(result.error, /operator channel/)
  })

  it('fails closed when legacy operator channels were not checked', () => {
    const result = evaluate({ operatorChannelCount: null })
    assert.equal(result.allowed, false)
    assert.match(result.error, /must be verified/)
  })

  it('keeps a fully bound wallet immutable', () => {
    const changedFiber = evaluate({
      currentFundingLockArg: OLD_LOCK_ARG,
      requestedFundingLockArg: OLD_LOCK_ARG,
    })
    const changedLock = evaluate({
      currentFundingLockArg: OLD_LOCK_ARG,
      requestedFiberPubkey: OLD_FIBER_PUBKEY,
    })
    assert.equal(changedFiber.allowed, false)
    assert.equal(changedLock.allowed, false)
    assert.match(changedFiber.error, /already bound/)
  })

  it('allows an idempotent registration for a fully bound wallet', () => {
    const result = evaluate({
      currentFundingLockArg: OLD_LOCK_ARG,
      requestedFiberPubkey: OLD_FIBER_PUBKEY,
      requestedFundingLockArg: OLD_LOCK_ARG,
    })
    assert.equal(result.allowed, true)
    assert.equal(result.legacyMigration, false)
  })
})
