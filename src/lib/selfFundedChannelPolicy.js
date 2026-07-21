function normalizePubkey(value) {
  return String(value || '').trim().toLowerCase().replace(/^0x/, '')
}

export function channelRecordId(channel) {
  return String(
    channel?.channel_id
      || channel?.temporary_channel_id
      || channel?.channelId
      || channel?.temporaryChannelId
      || '',
  ).toLowerCase()
}

export function channelRecordCreatedAtMs(channel) {
  const raw = channel?.created_at ?? channel?.createdAt
  if (raw === null || raw === undefined || raw === '') return 0
  try {
    return Number(BigInt(raw))
  } catch {
    const parsed = new Date(raw).getTime()
    return Number.isFinite(parsed) ? parsed : 0
  }
}

export function channelOpeningFailure(channel) {
  if (!channel) return ''
  const state = channel?.state?.state_name || channel?.state_name || channel?.state || ''
  const flags = channel?.state?.state_flags || channel?.state_flags || channel?.flags || ''
  const detail = channel?.failure_detail || channel?.failureDetail || ''
  if (detail) return String(detail)
  if (state === 'Closed' || String(flags).includes('FUNDING_ABORTED')) {
    return `${state || 'Closed'} ${flags || 'FUNDING_ABORTED'}`
  }
  return ''
}

export function findChannelOpeningRecord(records, {
  temporaryChannelId,
  peerPubkey,
  openedAt,
  toleranceMs = 10_000,
} = {}) {
  const list = records || []
  const exactId = String(temporaryChannelId || '').toLowerCase()
  const exact = exactId ? list.find((channel) => channelRecordId(channel) === exactId) : null
  if (exact) return exact

  const peer = normalizePubkey(peerPubkey)
  if (!peer || !openedAt) return null
  const recent = list
    .filter((channel) => normalizePubkey(channel?.pubkey) === peer)
    .filter((channel) => channelRecordCreatedAtMs(channel) >= openedAt - toleranceMs)
    .sort((left, right) => channelRecordCreatedAtMs(right) - channelRecordCreatedAtMs(left))
  return recent[0] || null
}
