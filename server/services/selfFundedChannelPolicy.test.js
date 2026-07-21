import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  channelOpeningFailure,
  findChannelOpeningRecord,
} from '../../src/lib/selfFundedChannelPolicy.js'

const PEER = `02${'ab'.repeat(32)}`
const OPENED_AT = Date.parse('2026-07-21T17:29:24.000Z')

describe('self-funded channel opening policy', () => {
  it('matches the original temporary channel id when it remains visible', () => {
    const record = { channel_id: '0xtemporary', pubkey: PEER, created_at: String(OPENED_AT) }
    assert.equal(findChannelOpeningRecord([record], {
      temporaryChannelId: '0xTemporary',
      peerPubkey: PEER,
      openedAt: OPENED_AT,
    }), record)
  })

  it('correlates a re-keyed accepted channel by peer and opening time', () => {
    const record = {
      channel_id: '0xfinal',
      pubkey: PEER,
      created_at: `0x${BigInt(OPENED_AT + 1_000).toString(16)}`,
      state: { state_name: 'Closed', state_flags: 'FUNDING_ABORTED' },
      failure_detail: 'Funding transaction aborted',
    }
    assert.equal(findChannelOpeningRecord([record], {
      temporaryChannelId: '0xtemporary',
      peerPubkey: PEER,
      openedAt: OPENED_AT,
    }), record)
    assert.equal(channelOpeningFailure(record), 'Funding transaction aborted')
  })

  it('does not correlate an old failure from the same peer', () => {
    const oldRecord = {
      channel_id: '0xold',
      pubkey: PEER,
      created_at: String(OPENED_AT - 60_000),
      state: { state_name: 'Closed', state_flags: 'FUNDING_ABORTED' },
    }
    assert.equal(findChannelOpeningRecord([oldRecord], {
      temporaryChannelId: '0xtemporary',
      peerPubkey: PEER,
      openedAt: OPENED_AT,
    }), null)
  })

  it('does not treat an active opening record as failed', () => {
    const record = {
      channel_id: '0xfinal',
      pubkey: PEER,
      created_at: String(OPENED_AT + 1_000),
      state: { state_name: 'NegotiatingFunding', state_flags: 'OUR_INIT_SENT' },
    }
    assert.equal(findChannelOpeningRecord([record], {
      temporaryChannelId: '0xtemporary',
      peerPubkey: PEER,
      openedAt: OPENED_AT,
    }), record)
    assert.equal(channelOpeningFailure(record), '')
  })
})
