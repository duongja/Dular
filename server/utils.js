import crypto from 'node:crypto'
import { config } from './config.js'

export const RUSD_BASE_UNITS = 100_000_000n

export function normalizePhone(phone) {
  const value = String(phone || '').trim().replace(/[\s()-]/g, '')
  if (value.startsWith('+254') && value.length === 13) return value
  if (value.startsWith('254') && value.length === 12) return `+${value}`
  if (value.startsWith('07') && value.length === 10) return `+254${value.slice(1)}`
  if (value.startsWith('01') && value.length === 10) return `+254${value.slice(1)}`
  throw new Error('Use a valid Kenyan phone number, e.g. +254712345678')
}

export function toRUsdBaseUnits(kesAmount) {
  const numeric = Number(kesAmount)
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error('Amount must be greater than zero')
  }
  return BigInt(Math.round(numeric * Number(RUSD_BASE_UNITS)))
}

export function parseBaseUnits(amount) {
  const value = BigInt(String(amount || '0'))
  if (value <= 0n) throw new Error('Amount must be greater than zero')
  return value
}

export function hashValue(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

export function hashOtp(phone, code) {
  return hashValue(`${config.sessionSecret}:${phone}:${code}`)
}

export function createToken() {
  return crypto.randomBytes(32).toString('hex')
}

export function createOtp() {
  if (config.demoMode) return '123456'
  return String(crypto.randomInt(100000, 1000000))
}

export function publicUser(row, balance = '0') {
  return {
    id: row.id,
    phone: row.phone,
    displayName: row.display_name,
    fiberPubkey: row.fiber_pubkey,
    verifiedAt: row.verified_at,
    balanceBaseUnits: String(balance),
  }
}

export function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
}
