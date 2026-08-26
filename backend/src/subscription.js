/**
 * One-time permanent (lifetime) subscription helpers.
 * No expiry / renewal — entitlement is account-bound until admin revoke.
 */

export function buildSubscription(profile = {}, paymentCount = 0) {
  const revoked = profile.subscriptionStatus === 'revoked'
  const explicitLifetime =
    profile.subscriptionStatus === 'active' &&
    profile.subscriptionType === 'lifetime'

  // Back-compat for accounts paid before lifetime fields existed
  const legacyPaid =
    profile.status === 'paid' || Number(paymentCount || 0) > 0

  const active = !revoked && (explicitLifetime || legacyPaid)

  return {
    status: revoked ? 'revoked' : active ? 'active' : 'none',
    type: active ? 'lifetime' : null,
    activatedAt: active
      ? profile.subscriptionActivatedAt || profile.updatedAt || null
      : null,
    expiresAt: null,
    label: active ? 'Subscription: Active' : 'No active subscription',
  }
}

export function applyLifetimeEntitlement(profile = {}, now = new Date().toISOString()) {
  return {
    ...profile,
    status: 'paid',
    subscriptionStatus: 'active',
    subscriptionType: 'lifetime',
    subscriptionActivatedAt: profile.subscriptionActivatedAt || now,
    updatedAt: now,
  }
}

export function isLifetimeActive(profile = {}, paymentCount = 0) {
  return buildSubscription(profile, paymentCount).status === 'active'
}
