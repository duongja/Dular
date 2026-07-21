import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { secp256k1 } from '@noble/curves/secp256k1.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

import {
  ckbLockArgForPublicKey,
  ckbRegistrationMessage,
  verifyCkbRegistrationProof,
} from './walletProof.js'

describe('CKB wallet registration proof', () => {
  const userId = '01234567-89ab-cdef-0123-456789abcdef'
  const fiberPubkey = `02${'ab'.repeat(32)}`
  const secretKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1)
  const publicKey = secp256k1.getPublicKey(secretKey, true)
  const fundingLockArg = ckbLockArgForPublicKey(publicKey)
  const message = utf8ToBytes(ckbRegistrationMessage(userId, fiberPubkey, fundingLockArg))
  const signature = secp256k1.sign(message, secretKey, { format: 'compact' })

  it('verifies a signature whose public key hashes to the funding lock', () => {
    assert.equal(verifyCkbRegistrationProof({
      userId,
      fiberPubkey,
      fundingLockArg,
      publicKeyHex: `0x${bytesToHex(publicKey)}`,
      signatureHex: `0x${bytesToHex(signature)}`,
    }), true)
  })

  it('rejects a different lock, message identity, or malformed signature', () => {
    const proof = {
      userId,
      fiberPubkey,
      fundingLockArg,
      publicKeyHex: bytesToHex(publicKey),
      signatureHex: bytesToHex(signature),
    }
    assert.throws(
      () => verifyCkbRegistrationProof({ ...proof, fundingLockArg: `0x${'00'.repeat(20)}` }),
      /does not match/,
    )
    assert.equal(verifyCkbRegistrationProof({ ...proof, userId: 'different-user' }), false)
    assert.throws(
      () => verifyCkbRegistrationProof({ ...proof, signatureHex: 'bad' }),
      /valid CKB wallet ownership proof/,
    )
  })
})
