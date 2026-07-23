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

function isRoutableChannel(channel, udtTypeScript) {
  return channelState(channel) === 'ChannelReady'
    && channel.enabled !== false
    && channel.is_public === true
    && BigInt(channel.tlc_fee_proportional_millionths || '0x0') === 0n
    && scriptMatches(channel.funding_udt_type_script, udtTypeScript)
}

export function evaluatePhonePaymentRoute({
  amountBaseUnits,
  connected,
  channels = [],
  udtTypeScript,
}) {
  const amount = BigInt(amountBaseUnits)
  const readyChannels = channels.filter((channel) => isRoutableChannel(channel, udtTypeScript))
  const outboundLiquidity = readyChannels.reduce((total, channel) => total + localBalance(channel), 0n)
  const routeChannel = readyChannels.find((channel) => localBalance(channel) >= amount) || null
  const routeReady = Boolean(connected && routeChannel)

  let reason = null
  if (!connected) {
    reason = 'The recipient wallet is offline. Ask them to unlock Dular and keep it open.'
  } else if (!routeChannel) {
    reason = 'The recipient has no ready Fiber route with enough inbound RUSD.'
  }

  return {
    routeReady,
    reason,
    routeChannel,
    readyChannels,
    outboundLiquidity,
  }
}
