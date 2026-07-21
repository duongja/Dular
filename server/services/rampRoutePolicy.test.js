import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { RUSD_TYPE_SCRIPT } from './fiber.js'
import { evaluateRampRouteFunding } from './rampRoutePolicy.js'

const NOW = Date.parse('2026-07-21T12:00:00.000Z')
const REQUIRED = 100_000_000n
const MAX_EXPOSURE = 10_000_000_000n

function channel({
  state = 'ChannelReady',
  localBalance = REQUIRED,
  createdAt = NOW - 10_000,
  outpoint = null,
  isPublic = true,
  fee = '0x0',
} = {}) {
  return {
    state: { state_name: state },
    local_balance: `0x${BigInt(localBalance).toString(16)}`,
    created_at: String(createdAt),
    channel_outpoint: outpoint,
    is_public: isPublic,
    enabled: true,
    tlc_fee_proportional_millionths: fee,
    funding_udt_type_script: RUSD_TYPE_SCRIPT,
  }
}

function evaluate(currentChannels, overrides = {}) {
  return evaluateRampRouteFunding({
    currentChannels,
    allChannels: currentChannels,
    requiredAmountBaseUnits: REQUIRED,
    maxExposureBaseUnits: MAX_EXPOSURE,
    nowMs: NOW,
    ...overrides,
  })
}

describe('ramp route funding policy', () => {
  it('opens for an empty or depleted route and reuses sufficient liquidity', () => {
    assert.equal(evaluate([]).allowOpen, true)
    assert.equal(evaluate([channel({ localBalance: REQUIRED - 1n })]).allowOpen, true)
    assert.equal(evaluate([channel()]).allowOpen, false)
  })

  it('waits for committed or recent pending channels', () => {
    const committed = channel({ state: 'AwaitingChannelReady', outpoint: '0xabc' })
    const recent = channel({ state: 'NegotiatingFunding', createdAt: NOW - 30_000 })
    assert.equal(evaluate([committed]).allowOpen, false)
    assert.equal(evaluate([recent]).allowOpen, false)
  })

  it('replaces only stale uncommitted pending channels', () => {
    const stale = channel({ state: 'NegotiatingFunding', createdAt: NOW - 100_000 })
    const result = evaluate([stale])
    assert.equal(result.allowOpen, true)
    assert.equal(result.replacePending, true)
  })

  it('waits out a recent ambiguous open attempt', () => {
    const result = evaluate([], { attemptedAt: new Date(NOW - 30_000) })
    assert.equal(result.attemptIsStale, false)
    assert.equal(result.allowOpen, false)
  })

  it('caps actual live operator channel exposure', () => {
    const exposure = channel({ localBalance: MAX_EXPOSURE })
    const result = evaluate([], { allChannels: [exposure] })
    assert.equal(result.blockedByExposure, true)
    assert.equal(result.allowOpen, false)
    assert.equal(result.operatorExposureBaseUnits, MAX_EXPOSURE)
  })
})
