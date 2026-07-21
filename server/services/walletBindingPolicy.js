function normalize(value) {
  return String(value || '').trim().toLowerCase()
}

export function evaluateWalletBinding({
  currentFiberPubkey,
  currentFundingLockArg,
  requestedFiberPubkey,
  requestedFundingLockArg,
  hasActiveRampOrder = false,
  operatorChannelCount = null,
}) {
  const currentPubkey = normalize(currentFiberPubkey)
  const currentLockArg = normalize(currentFundingLockArg)
  const requestedPubkey = normalize(requestedFiberPubkey)
  const requestedLockArg = normalize(requestedFundingLockArg)

  if (currentLockArg) {
    const allowed = currentPubkey === requestedPubkey && currentLockArg === requestedLockArg
    return {
      allowed,
      legacyMigration: false,
      error: allowed ? '' : 'This account is already bound to a different browser wallet',
    }
  }

  if (!currentPubkey || currentPubkey === requestedPubkey) {
    return { allowed: true, legacyMigration: false, error: '' }
  }

  if (hasActiveRampOrder) {
    return {
      allowed: false,
      legacyMigration: false,
      error: 'Finish or reconcile the active ramp order before replacing this legacy wallet identity',
    }
  }

  if (operatorChannelCount === null) {
    return {
      allowed: false,
      legacyMigration: false,
      error: 'The previous Fiber wallet state must be verified before replacing it',
    }
  }

  if (operatorChannelCount > 0) {
    return {
      allowed: false,
      legacyMigration: false,
      error: 'The previous Fiber wallet still has an operator channel and cannot be replaced',
    }
  }

  return {
    allowed: true,
    legacyMigration: true,
    migrationReason: 'empty_legacy_wallet',
    error: '',
  }
}
