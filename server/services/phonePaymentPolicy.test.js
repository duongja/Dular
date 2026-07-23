import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { RUSD_TYPE_SCRIPT } from './fiber.js'
import { evaluatePhonePaymentRoute } from './phonePaymentPolicy.js'

const AMOUNT = 100_000_000n

function channel(overrides = {}) {
  return {
    state: { state_name: 'ChannelReady' },
    enabled: true,
    is_public: true,
    local_balance: `0x${AMOUNT.toString(16)}`,
    tlc_fee_proportional_millionths: '0x0',
    funding_udt_type_script: RUSD_TYPE_SCRIPT,
    ...overrides,
  }
}

function evaluate(channels, overrides = {}) {
  return evaluatePhonePaymentRoute({
    amountBaseUnits: AMOUNT,
    connected: true,
    channels,
    udtTypeScript: RUSD_TYPE_SCRIPT,
    ...overrides,
  })
}

describe('phone Fiber payment routing', () => {
  it('uses a ready public zero-fee RUSD channel with enough liquidity', () => {
    const result = evaluate([channel()])
    assert.equal(result.routeReady, true)
    assert.equal(result.outboundLiquidity, AMOUNT)
    assert.equal(result.routeChannel.local_balance, `0x${AMOUNT.toString(16)}`)
  })

  it('rejects an offline recipient even when a channel exists', () => {
    const result = evaluate([channel()], { connected: false })
    assert.equal(result.routeReady, false)
    assert.match(result.reason, /offline/)
  })

  it('rejects insufficient recipient inbound liquidity', () => {
    const result = evaluate([channel({ local_balance: `0x${(AMOUNT - 1n).toString(16)}` })])
    assert.equal(result.routeReady, false)
    assert.match(result.reason, /enough inbound/)
  })

  it('ignores private, disabled, nonzero-fee, non-ready, and wrong-asset channels', () => {
    const wrongAsset = { ...RUSD_TYPE_SCRIPT, args: `0x${'00'.repeat(32)}` }
    const result = evaluate([
      channel({ is_public: false }),
      channel({ enabled: false }),
      channel({ tlc_fee_proportional_millionths: '0x1' }),
      channel({ state: { state_name: 'AwaitingChannelReady' } }),
      channel({ funding_udt_type_script: wrongAsset }),
    ])
    assert.equal(result.routeReady, false)
    assert.equal(result.readyChannels.length, 0)
  })
})
