import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { isDefinitiveDarajaError } from './daraja.js'

describe('Daraja failure classification', () => {
  it('classifies an explicit provider rejection as definitive', () => {
    assert.equal(isDefinitiveDarajaError({ code: 'DARAJA_REJECTED' }), true)
  })

  it('keeps transport failures ambiguous', () => {
    assert.equal(isDefinitiveDarajaError(new Error('request timed out')), false)
    assert.equal(isDefinitiveDarajaError({ code: 'ECONNRESET' }), false)
  })
})
