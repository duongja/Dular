import { RUSD_TYPE_SCRIPT } from './fiber.js'

function channelState(channel) {
  return channel?.state?.state_name || channel?.state_name || ''
}

function localBalance(channel) {
  return BigInt(channel?.local_balance || channel?.localBalance || '0x0')
}

function scriptMatches(left, right) {
  if (!left || !right) return false
  return String(left.code_hash || '').toLowerCase() === String(right.code_hash || '').toLowerCase()
    && String(left.hash_type || '').toLowerCase() === String(right.hash_type || '').toLowerCase()
    && String(left.args || '').toLowerCase() === String(right.args || '').toLowerCase()
}

function isRUsdChannel(channel) {
  return scriptMatches(channel?.funding_udt_type_script, RUSD_TYPE_SCRIPT)
}

function isReadyRoute(channel) {
  return channelState(channel) === 'ChannelReady'
    && channel.enabled !== false
    && channel.is_public === true
    && BigInt(channel?.tlc_fee_proportional_millionths || '0x0') === 0n
    && isRUsdChannel(channel)
}

function createdAtMs(channel) {
  const raw = channel?.created_at || channel?.createdAt
  if (!raw) return 0
  try {
    return Number(BigInt(raw))
  } catch {
    return 0
  }
}

function isCommittedPending(channel) {
  const state = channelState(channel)
  const flags = channel?.state?.state_flags || channel?.state_flags || ''
  return Boolean(channel?.channel_outpoint)
    || state === 'AwaitingTxSignatures'
    || state === 'AwaitingChannelReady'
    || String(flags).includes('TX_SIGNATURES_SENT')
}

function isReplaceablePending(channel, nowMs, stalePendingMs) {
  const state = channelState(channel)
  const createdAt = createdAtMs(channel)
  return Boolean(state)
    && state !== 'ChannelReady'
    && !isCommittedPending(channel)
    && createdAt > 0
    && nowMs - createdAt > stalePendingMs
}

export function evaluateRampRouteFunding({
  currentChannels = [],
  allChannels = [],
  requiredAmountBaseUnits,
  maxExposureBaseUnits,
  attemptedAt = null,
  nowMs = Date.now(),
  retryAfterMs = 120_000,
  stalePendingMs = 90_000,
}) {
  const required = BigInt(requiredAmountBaseUnits)
  const maxExposure = BigInt(maxExposureBaseUnits)
  const liveRUsdChannels = allChannels.filter((channel) => (
    isRUsdChannel(channel) && !/closed/i.test(channelState(channel))
  ))
  const currentRUsdChannels = currentChannels.filter((channel) => (
    isRUsdChannel(channel) && !/closed/i.test(channelState(channel))
  ))
  const hasSufficientReadyRoute = currentRUsdChannels
    .filter(isReadyRoute)
    .some((channel) => localBalance(channel) >= required)
  const pendingChannels = currentRUsdChannels
    .filter((channel) => channelState(channel) !== 'ChannelReady')
  const pendingChannelsAreReplaceable = pendingChannels.length > 0
    && pendingChannels.every((channel) => isReplaceablePending(channel, nowMs, stalePendingMs))
  const attemptedAtMs = attemptedAt ? new Date(attemptedAt).getTime() : 0
  const attemptIsStale = !Number.isFinite(attemptedAtMs)
    || attemptedAtMs === 0
    || attemptedAtMs <= nowMs - retryAfterMs
  const operatorExposureBaseUnits = liveRUsdChannels.reduce(
    (total, channel) => total + localBalance(channel),
    0n,
  )
  const eligibleToOpen = !hasSufficientReadyRoute
    && (pendingChannels.length === 0 || pendingChannelsAreReplaceable)
    && attemptIsStale
  const blockedByExposure = eligibleToOpen
    && operatorExposureBaseUnits + required > maxExposure

  return {
    allowOpen: eligibleToOpen && !blockedByExposure,
    replacePending: eligibleToOpen && !blockedByExposure && pendingChannelsAreReplaceable,
    blockedByExposure,
    hasSufficientReadyRoute,
    pendingChannelCount: pendingChannels.length,
    pendingChannelsAreReplaceable,
    attemptIsStale,
    operatorExposureBaseUnits,
  }
}
