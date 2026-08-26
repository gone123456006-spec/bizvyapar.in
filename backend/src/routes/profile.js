import { Router } from 'express'
import { requireAuth } from '../db/authMiddleware.js'
import { getOwnProfile, getOwnDatabaseSnapshot, touchLogin } from '../db/userDb.js'
import { buildSubscription } from '../subscription.js'

export const profileRouter = Router()

profileRouter.get('/me', requireAuth, async (req, res, next) => {
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
    const subscription = buildSubscription(
      own.profile || profile,
      own.paymentCount,
    )

    return res.json({
      profile: {
        ...profile,
        ...(own.profile || {}),
        subscriptionStatus: subscription.status,
        subscriptionType: subscription.type,
        subscriptionActivatedAt: subscription.activatedAt,
      },
      subscription,
      summary: {
        paymentCount: own.paymentCount,
        registrationCount: own.registrationCount,
        latestPayment: own.latestPayment,
        latestRegistration: own.latestRegistration,
      },
      isolation: {
        mode: 'per-user-database',
        tenantId,
      },
    })
  } catch (error) {
    next(error)
  }
})

profileRouter.get('/me/database', requireAuth, async (req, res, next) => {
  try {
    const { tenantId } = await touchLogin({
      uid: req.auth.uid,
      email: req.auth.email,
      name: req.auth.name,
      picture: req.auth.picture,
      emailVerified: req.auth.emailVerified,
      provider: req.auth.provider,
    })

    const database = await getOwnDatabaseSnapshot(tenantId)
    return res.json({ tenantId, database })
  } catch (error) {
    next(error)
  }
})
