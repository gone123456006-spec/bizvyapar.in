import { Router } from 'express'
import { requireAuth } from '../db/authMiddleware.js'
import { isFirebaseConfigured, verifyFirebaseIdToken } from '../firebaseAdmin.js'
import { touchLogin, getOwnProfile, getOwnDatabaseSnapshot } from '../db/userDb.js'

export const authRouter = Router()

function buildPublicProfile(profile, tenantId) {
  return {
    tenantId,
    uid: profile.uid,
    email: profile.email,
    name: profile.name,
    phone: profile.phone,
    picture: profile.picture,
    emailVerified: Boolean(profile.emailVerified),
    provider: profile.provider || 'google.com',
    status: profile.status || 'active',
    lastLoginAt: profile.lastLoginAt,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  }
}

authRouter.get('/status', (_req, res) => {
  res.json({
    configured: isFirebaseConfigured(),
    provider: 'google',
    isolation: 'per-user-database',
  })
})

authRouter.post('/google', async (req, res) => {
  const idToken = String(req.body?.idToken || '').trim()

  if (!idToken) {
    return res.status(400).json({ message: 'Missing Google ID token.' })
  }

  try {
    const decoded = await verifyFirebaseIdToken(idToken)
    const identity = {
      uid: decoded.uid,
      email: decoded.email || null,
      name: decoded.name || null,
      picture: decoded.picture || null,
      emailVerified: Boolean(decoded.email_verified),
      provider: decoded.firebase?.sign_in_provider || 'google.com',
    }

    const { tenantId, profile } = await touchLogin(identity)

    return res.json({
      message: 'Signed in with Google.',
      user: buildPublicProfile(profile, tenantId),
      isolation: {
        mode: 'per-user-database',
        tenantId,
      },
    })
  } catch (error) {
    console.error('Google sign-in failed:', error.message)
    return res.status(error.status || 401).json({
      message: error.message || 'Google sign in failed.',
    })
  }
})

authRouter.get('/me', requireAuth, async (req, res) => {
  try {
    const { tenantId, profile } = await touchLogin({
      uid: req.auth.uid,
      email: req.auth.email,
      name: req.auth.name,
      picture: req.auth.picture,
      emailVerified: req.auth.emailVerified,
      provider: req.auth.provider,
    })

    const own = await getOwnProfile(tenantId)

    return res.json({
      user: buildPublicProfile(profile, tenantId),
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

/** Full isolated database snapshot for the signed-in user only. */
authRouter.get('/me/database', requireAuth, async (req, res) => {
  try {
    const { tenantId } = await touchLogin({
      uid: req.auth.uid,
      email: req.auth.email,
      name: req.auth.name,
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
