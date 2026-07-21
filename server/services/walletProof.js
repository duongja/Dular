import { secp256k1 } from '@noble/curves/secp256k1.js'
import { blake2b } from '@noble/hashes/blake2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

const CKB_HASH_PERSONALIZATION = utf8ToBytes('ckb-default-hash')

export function ckbRegistrationMessage(userId, fiberPubkey, fundingLockArg) {
  return `Dular CKB wallet registration ${userId} ${fiberPubkey} ${fundingLockArg}`
}

export function ckbLockArgForPublicKey(publicKey) {
  return `0x${bytesToHex(blake2b(publicKey, {
    dkLen: 32,
    personalization: CKB_HASH_PERSONALIZATION,
  })).slice(0, 40)}`
}

export function verifyCkbRegistrationProof({
  userId,
  fiberPubkey,
  fundingLockArg,
  publicKeyHex,
  signatureHex,
}) {
  const normalizedPublicKey = String(publicKeyHex || '').trim().toLowerCase().replace(/^0x/, '')
  const normalizedSignature = String(signatureHex || '').trim().toLowerCase().replace(/^0x/, '')
  if (!/^(02|03)[0-9a-f]{64}$/.test(normalizedPublicKey) || !/^[0-9a-f]{128}$/.test(normalizedSignature)) {
    throw new Error('A valid CKB wallet ownership proof is required')
  }
  const publicKey = hexToBytes(normalizedPublicKey)
  if (ckbLockArgForPublicKey(publicKey) !== fundingLockArg) {
    throw new Error('The CKB wallet proof does not match the submitted funding lock')
  }
  return secp256k1.verify(
    hexToBytes(normalizedSignature),
    utf8ToBytes(ckbRegistrationMessage(userId, fiberPubkey, fundingLockArg)),
    publicKey,
  )
}
