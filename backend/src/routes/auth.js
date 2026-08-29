import { Router } from 'express'
import { requireAuth } from '../db/authMiddleware.js'
import { authRateLimit } from '../auth/rateLimit.js'
import {
  getSubscriptionByUserId,
  issueTokenPair,
  loginWithEmailPhone,
  registerUser,
  revokeAllRefreshTokensForUser,
  revokeRefreshToken,
  rotateRefreshToken,
  signInWithDetails,
  updateUserProfile,
} from '../auth/userStore.js'
import {
  endUserSession,
  linkVisitorToTenant,
  recordUserLoginSession,
} from '../db/analyticsStore.js'

export const authRouter = Router()

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim()
  return forwarded || req.ip || req.socket?.remoteAddress || ''
}

/** Never leak SQL / infra wording to clients. */
function userFacingAuthError(error, fallback = 'Something went wrong. Please try again.') {
  const raw = String(error?.message || '')
  const code = error?.code

  // Keep intentional auth guidance messages
  if (
    /No account found|already (exists|registered)|Please Sign (In|Up)|valid email|valid 10-digit|full name|Mobile number|Gmail and mobile|do not match/i.test(
      raw,
    )
  ) {
    return {
      status: error?.status && error.status >= 400 ? error.status : 400,
      message: raw,
    }
  }

  // Legacy password column / wording — treat as soft infra issue, not user fault
  if (/password/i.test(raw)) {
    return {
      status: 503,
      message: 'Account service is updating. Please try again in a moment.',
    }
  }

  if (
    code === '23505' ||
    /duplicate key|unique constraint|tenants_email|users_email|users_phone/i.test(
      raw,
    )
  ) {
    return {
      status: 409,
      message: /phone/i.test(raw)
        ? 'This mobile number is already registered. Please Sign In.'
        : 'This Gmail is already registered. Please Sign In.',
    }
  }
  if (error?.status && error.status >= 400 && error.status < 500) {
    if (/constraint|duplicate key|ECONN|postgres|SQLSTATE|violates/i.test(raw)) {
      return { status: error.status, message: fallback }
    }
    return { status: error.status, message: raw || fallback }
  }
  return { status: 500, message: fallback }
}

function publicUser(user, tenantId, subscription) {
  return {
    id: user.id,
    userId: user.id,
    uid: user.id,
    tenantId,
    email: user.email,
    name: user.name,
    phone: user.phone,
    emailVerified: Boolean(user.emailVerified),
    provider: user.provider || 'local',
    status: user.status || 'active',
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt,
    subscription,
  }
}

authRouter.get('/status', (_req, res) => {
  res.json({
    configured: true,
    provider: 'name-email-phone',
    passwordRequired: false,
    passwordAuth: false,
    database: process.env.MONGODB_URI
      ? 'mongodb'
      : process.env.DATABASE_URL
        ? 'postgres'
        : 'none',
    modes: {
      signUp: 'name + gmail + mobile (create account)',
      signIn: 'gmail + mobile (existing account)',
    },
    accessTokenTtl: process.env.ACCESS_TOKEN_TTL || '15m',
    isolation: 'per-user-database',
  })
})

async function completeAuth(req, res, authFn) {
  try {
    const { user, tenantId, created, subscription: authSub } = await authFn({
      name: req.body?.name,
      email: req.body?.email,
      phone: req.body?.phone,
    })

    const [tokens, subscription] = await Promise.all([
      issueTokenPair(user, {
        userAgent: req.headers['user-agent'],
        ip: clientIp(req),
      }),
      authSub
        ? Promise.resolve(authSub)
        : getSubscriptionByUserId(user.id),
    ])

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

    return res.status(created ? 201 : 200).json({
      message: created ? 'Account created.' : 'Signed in.',
      user: publicUser(user, tenantId, subscription),
      subscription,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
    })
  } catch (error) {
    console.error('Auth failed:', error.message)
    const facing = userFacingAuthError(
      error,
      'Could not continue. Please check your details.',
    )
    return res.status(facing.status).json({ message: facing.message })
  }
}

/** POST /api/auth/register — Sign Up (Name + Gmail + mobile) */
authRouter.post('/register', authRateLimit(), (req, res) =>
  completeAuth(req, res, registerUser),
)

/** POST /api/auth/login — Sign In (Gmail + mobile only) */
authRouter.post('/login', authRateLimit(), (req, res) =>
  completeAuth(req, res, loginWithEmailPhone),
)

/** POST /api/auth/continue — simple create-or-sign-in (name optional if account exists) */
authRouter.post('/continue', authRateLimit(), (req, res) =>
  completeAuth(req, res, async ({ name, email, phone }) => {
    try {
      return await signInWithDetails({ name, email, phone })
    } catch (error) {
      if (/full name/i.test(error.message || '')) {
        try {
          return await loginWithEmailPhone({ email, phone })
        } catch {
          throw error
        }
      }
      throw error
    }
  }),
)

/** POST /api/auth/refresh — rotate refresh token, issue new access token */
authRouter.post('/refresh', authRateLimit({ maxPerIp: 60 }), async (req, res) => {
  try {
    const refreshToken = String(req.body?.refreshToken || '').trim()
    if (!refreshToken) {
      return res.status(400).json({ message: 'Missing refresh token.' })
    }
    const rotated = await rotateRefreshToken(refreshToken, {
      userAgent: req.headers['user-agent'],
      ip: clientIp(req),
    })
    const tenantId = `uid_${rotated.user.id}`
    const subscription = await getSubscriptionByUserId(rotated.user.id)
    return res.json({
      user: publicUser(rotated.user, tenantId, subscription),
      subscription,
      accessToken: rotated.accessToken,
      refreshToken: rotated.refreshToken,
      expiresIn: rotated.expiresIn,
    })
  } catch (error) {
    return res.status(error.status || 401).json({
      message: error.message || 'Session expired. Please sign in again.',
    })
  }
})

/** POST /api/auth/logout — revoke refresh token (and optional all sessions) */
authRouter.post('/logout', async (req, res) => {
  try {
    const refreshToken = String(req.body?.refreshToken || '').trim()
    if (refreshToken) await revokeRefreshToken(refreshToken)

    // If access token present, optionally revoke all sessions
    const header = req.headers.authorization || ''
    const access = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
    if (access && req.body?.allDevices) {
      try {
        const { verifyAccessToken } = await import('../auth/tokens.js')
        const decoded = await verifyAccessToken(access)
        await revokeAllRefreshTokensForUser(decoded.userId)
      } catch {
        // ignore invalid access on logout
      }
    }

    const sessionId = String(req.body?.sessionId || '').trim()
    // Best-effort analytics end — need auth for tenant; skip if anonymous logout
    if (req.auth?.tenantId && sessionId) {
      await endUserSession({
        tenantId: req.auth.tenantId,
        sessionId,
      }).catch(() => undefined)
    }

    return res.json({ ok: true })
  } catch (error) {
    return res.status(error.status || 500).json({
      message: error.message || 'Logout failed.',
    })
  }
})

/** GET /api/auth/me — current user (backend-loaded subscription) */
authRouter.get('/me', requireAuth, async (req, res) => {
  try {
    const subscription = await getSubscriptionByUserId(req.auth.userId)
    return res.json({
      user: publicUser(
        {
          id: req.auth.userId,
          email: req.auth.email,
          name: req.auth.name,
          phone: req.auth.phone,
          emailVerified: req.auth.emailVerified,
          provider: req.auth.provider,
          status: 'active',
        },
        req.auth.tenantId,
        subscription,
      ),
      subscription,
      isolation: {
        mode: 'per-user-database',
        tenantId: req.auth.tenantId,
        userId: req.auth.userId,
      },
    })
  } catch (error) {
    return res.status(error.status || 401).json({
      message: error.message || 'Session expired. Please sign in again.',
    })
  }
})

/** PATCH /api/auth/me — update name/phone without changing userId */
authRouter.patch('/me', requireAuth, async (req, res) => {
  try {
    const user = await updateUserProfile(req.auth.userId, {
      name: req.body?.name,
      phone: req.body?.phone,
    })
    const subscription = await getSubscriptionByUserId(req.auth.userId)
    return res.json({
      user: publicUser(user, req.auth.tenantId, subscription),
      subscription,
    })
  } catch (error) {
    return res.status(error.status || 500).json({
      message: error.message || 'Could not update profile.',
    })
  }
})

/** GET /api/auth/subscription — authoritative subscription status */
authRouter.get('/subscription', requireAuth, async (req, res) => {
  try {
    const subscription = await getSubscriptionByUserId(req.auth.userId)
    return res.json({
      userId: req.auth.userId,
      subscription,
    })
  } catch (error) {
    return res.status(error.status || 500).json({
      message: error.message || 'Could not load subscription.',
    })
  }
})
