import { config } from '../config.js'
import { parseRateMicros } from './ramp.js'

const RATE_MICROS = 1_000_000
const CACHE_MS = 5 * 60 * 1000
const MIN_USD_KES_RATE_MICROS = 50 * RATE_MICROS
const MAX_USD_KES_RATE_MICROS = 500 * RATE_MICROS

let cachedRate = null
let cachedUntil = 0

function decimalRateToMicros(value, label) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) throw new Error(`${label} must be a positive number`)
  const micros = Math.round(numeric * RATE_MICROS)
  if (!Number.isSafeInteger(micros) || micros <= 0) throw new Error(`${label} is outside the supported range`)
  if (micros < MIN_USD_KES_RATE_MICROS || micros > MAX_USD_KES_RATE_MICROS) {
    throw new Error(`${label} failed the supported USD/KES sanity range`)
  }
  return parseRateMicros(String(micros))
}

function extractKesRate(payload) {
  return payload?.rates?.KES
    ?? payload?.conversion_rates?.KES
    ?? payload?.data?.KES
    ?? payload?.kes
}

export async function getUsdKesRate() {
  if (config.ramp.configuredRate) {
    return {
      rateKesPerRUsdMicros: decimalRateToMicros(config.ramp.configuredRate, 'Configured USD/KES rate').toString(),
      source: 'configured-market-rate',
    }
  }

  if (cachedRate && Date.now() < cachedUntil) return cachedRate

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(config.ramp.fxUrl, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`FX provider returned HTTP ${response.status}`)
    const payload = await response.json()
    const rate = decimalRateToMicros(extractKesRate(payload), 'USD/KES market rate')
    cachedRate = {
      rateKesPerRUsdMicros: rate.toString(),
      source: new URL(config.ramp.fxUrl).hostname,
    }
    cachedUntil = Date.now() + CACHE_MS
    return cachedRate
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('USD/KES quote provider timed out', { cause: error })
    throw new Error(`Could not load the USD/KES market rate: ${error.message}`, { cause: error })
  } finally {
    clearTimeout(timeout)
  }
}
