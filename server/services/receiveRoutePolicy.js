function normalize(value) {
  return String(value || '').trim().toLowerCase()
}

export function evaluateReceiveRouteAuthorization({
  enabled,
  sessionFiberPubkey,
  currentFiberPubkey,
  currentFundingLockArg,
  browserFiberPubkey = sessionFiberPubkey,
}) {
  if (!enabled) {
    return { allowed: false, error: 'Operator-funded receive routes are disabled' }
  }
  if (!currentFundingLockArg) {
    return { allowed: false, error: 'Register this browser wallet before preparing a receive route' }
  }
  if (normalize(sessionFiberPubkey) !== normalize(currentFiberPubkey)) {
    return { allowed: false, error: 'The browser wallet identity changed. Refresh before preparing this receive route.' }
  }
  if (normalize(browserFiberPubkey) !== normalize(sessionFiberPubkey)) {
    return { allowed: false, error: 'This browser wallet does not match the authenticated account. Sign in again in this tab.' }
  }
  return { allowed: true, error: '' }
}
