import { verifyAccessToken } from '../auth/tokens.js'
import {
  ensureTenantForUser,
  findUserById,
  getSubscriptionByUserId,
  mapUser,
} from '../auth/userStore.js'

export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || ''
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
    if (!token) {
      return res.status(401).json({ message: 'Please sign in to continue.' })
    }

    const decoded = await verifyAccessToken(token)
    const row = await findUserById(decoded.userId)
    if (!row || row.status === 'disabled') {
      return res.status(401).json({ message: 'Please sign in to continue.' })
    }

    const user = mapUser(row)
    const [tenantId, subscription] = await Promise.all([
      ensureTenantForUser(user),
      getSubscriptionByUserId(user.id),
    ])

    req.auth = {
      userId: user.id,
      uid: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      picture: null,
      emailVerified: user.emailVerified,
      provider: user.provider,
      tenantId,
      subscription,
    }
    return next()
  } catch (error) {
    return res.status(error.status || 401).json({
      message: error.message || 'Session expired. Please sign in again.',
    })
  }
}

export async function optionalAuth(req, _res, next) {
  try {
    const header = req.headers.authorization || ''
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
    if (!token) {
      req.auth = null
      return next()
    }
    const decoded = await verifyAccessToken(token)
    const row = await findUserById(decoded.userId)
    if (!row || row.status === 'disabled') {
      req.auth = null
      return next()
    }
    const user = mapUser(row)
    const [tenantId, subscription] = await Promise.all([
      ensureTenantForUser(user),
      getSubscriptionByUserId(user.id),
    ])
    req.auth = {
      userId: user.id,
      uid: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      picture: null,
      emailVerified: user.emailVerified,
      provider: user.provider,
      tenantId,
      subscription,
    }
  } catch {
    req.auth = null
  }
  return next()
}

/** Backend-only subscription gate — never trust frontend flags. */
export async function requireActiveLifetime(req, res, next) {
  try {
    if (!req.auth?.userId) {
      return res.status(401).json({ message: 'Please sign in to continue.' })
    }
    const subscription = await getSubscriptionByUserId(req.auth.userId)
    req.auth.subscription = subscription
    if (!(subscription.status === 'active' && subscription.plan === 'lifetime')) {
      return res.status(403).json({
        message: 'An active lifetime subscription is required.',
        subscription,
      })
    }
    return next()
  } catch (error) {
    return res.status(error.status || 500).json({
      message: error.message || 'Could not verify subscription.',
    })
  }
}
