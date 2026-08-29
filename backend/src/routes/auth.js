import { Router } from 'express'
import { requireAuth } from '../db/authMiddleware.js'
import {
  createUserId,
  isValidEmail,
  isValidPhone,
  normalizeEmail,
  normalizePhone,
  signAccessToken,
} from '../localAuth.js'
import {
  touchLogin,
  getOwnProfile,
  getOwnDatabaseSnapshot,
  findTenantIdByEmail,
} from '../db/userDb.js'
import {
  endUserSession,
  linkVisitorToTenant,
  recordUserLoginSession,
} from '../db/analyticsStore.js'
import { buildSubscription } from '../subscription.js'

export const authRouter = Router()

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim()
  return forwarded || req.ip || req.socket?.remoteAddress || ''
}

function buildPublicProfile(profile, tenantId, paymentCount = 0, fallback = {}) {
  const safe = profile && typeof profile === 'object' ? profile : {}
  const subscription = buildSubscription(safe, paymentCount)
  return {
    tenantId,
    uid: safe.uid || fallback.uid || null,
    email: safe.email || fallback.email || null,
    name: safe.name || fallback.name || null,
    phone: safe.phone || fallback.phone || null,
    picture: safe.picture || null,
    emailVerified: Boolean(safe.emailVerified ?? true),
    provider: safe.provider || fallback.provider || 'local',
    status: safe.status || 'active',
    subscriptionStatus: subscription.status,
    subscriptionType: subscription.type,
    subscriptionActivatedAt: subscription.activatedAt,
    lastLoginAt: safe.lastLoginAt || null,
    createdAt: safe.createdAt || null,
    updatedAt: safe.updatedAt || null,
    subscription,
  }
}

authRouter.get('/status', (_req, res) => {
  res.json({
    configured: true,
    provider: 'local',
    isolation: 'per-user-database',
  })
})

/**
 * Register or login with name + email + phone.
 * Creates a unique user id for new accounts.
 * Existing email accounts must match phone (if phone already saved).
 */
authRouter.post('/login', async (req, res) => {
  const name = String(req.body?.name || '').trim()
  const email = normalizeEmail(req.body?.email)
  const phone = normalizePhone(req.body?.phone)

  if (!name || name.length < 2) {
    return res.status(400).json({ message: 'Please enter your full name.' })
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ message: 'Please enter a valid Gmail / email.' })
  }
  if (!isValidPhone(phone)) {
    return res
      .status(400)
      .json({ message: 'Please enter a valid 10-digit phone number.' })
  }

  try {
    const existingTenantId = await findTenantIdByEmail(email)
    let uid = createUserId()

    if (existingTenantId) {
      const existing = await getOwnProfile(existingTenantId)
      if (existing.profile?.uid) uid = String(existing.profile.uid)
    }

    const identity = {
      uid,
      email,
      name,
      phone,
      picture: null,
      emailVerified: true,
      provider: 'local',
    }

    const { tenantId, profile } = await touchLogin(identity)
    const own = await getOwnProfile(tenantId)
    const publicUser = buildPublicProfile(
      own.profile || profile,
      tenantId,
      own.paymentCount,
      identity,
    )

    if (!publicUser.uid) {
      return res.status(500).json({
        message: 'Could not create user id. Please try again.',
      })
    }

    const accessToken = await signAccessToken({
      uid: publicUser.uid,
      email: publicUser.email,
      name: publicUser.name,
      phone: publicUser.phone || phone,
      provider: 'local',
    })

    const sessionId = String(req.body?.sessionId || '').trim() || undefined
    const visitorId = String(req.body?.visitorId || '').trim() || null

    void recordUserLoginSession({
      tenantId,
      sessionId,
      userAgent: req.headers['user-agent'],
      ip: clientIp(req),
      path: '/',
    }).catch(() => undefined)

    if (visitorId) {
      void linkVisitorToTenant(visitorId, tenantId).catch(() => undefined)
    }

    return res.json({
      message: existingTenantId ? 'Signed in.' : 'Account created.',
      accessToken,
      user: publicUser,
      subscription: buildSubscription(own.profile || profile || {}, own.paymentCount),
      isolation: {
        mode: 'per-user-database',
        tenantId,
      },
    })
  } catch (error) {
    console.error('Local login failed:', error)
    return res.status(error.status || 500).json({
      message:
        error.message ||
        'Could not sign in. Please check your details and try again.',
    })
  }
})

authRouter.get('/me', requireAuth, async (req, res) => {
  try {
    const { tenantId, profile } = await touchLogin({
      uid: req.auth.uid,
      email: req.auth.email,
      name: req.auth.name,
      phone: req.auth.phone || null,
      picture: req.auth.picture,
      emailVerified: req.auth.emailVerified,
      provider: req.auth.provider,
    })

    const own = await getOwnProfile(tenantId)
    const subscription = buildSubscription(own.profile || profile, own.paymentCount)

    return res.json({
      user: buildPublicProfile(own.profile || profile, tenantId, own.paymentCount),
      subscription,
      summary: {
        paymentCount: own.paymentCount,
        registrationCount: own.registrationCount,
        latestPayment: own.latestPayment
          ? {
              paymentId: own.latestPayment.paymentId,
              status: own.latestPayment.status,
              paidAt: own.latestPayment.paidAt,
              amount: own.latestPayment.amount,
            }
          : null,
      },
      isolation: {
        mode: 'per-user-database',
        tenantId,
        note: 'This response contains only your isolated profile data.',
      },
    })
  } catch (error) {
    return res.status(error.status || 401).json({
      message: error.message || 'Session expired. Please sign in again.',
    })
  }
})

authRouter.post('/logout', requireAuth, async (req, res) => {
  try {
    const sessionId = String(req.body?.sessionId || '').trim()
    if (req.auth.tenantId && sessionId) {
      await endUserSession({
        tenantId: req.auth.tenantId,
        sessionId,
      })
    }
    return res.json({ ok: true })
  } catch (error) {
    return res.status(error.status || 500).json({
      message: error.message || 'Logout tracking failed.',
    })
  }
})

/** Full isolated database snapshot for the signed-in user only. */
authRouter.get('/me/database', requireAuth, async (req, res) => {
  try {
    const { tenantId } = await touchLogin({
      uid: req.auth.uid,
      email: req.auth.email,
      name: req.auth.name,
      phone: req.auth.phone || null,
      picture: req.auth.picture,
      emailVerified: req.auth.emailVerified,
      provider: req.auth.provider,
    })

    const db = await getOwnDatabaseSnapshot(tenantId)
    return res.json({
      tenantId,
      database: db,
      isolation: 'strict-own-data-only',
    })
  } catch (error) {
    return res.status(error.status || 500).json({
      message: error.message || 'Could not load your database.',
    })
  }
})
