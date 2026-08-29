import { Router } from 'express'
import { requireAuth } from '../db/authMiddleware.js'
import { getOwnProfile, getOwnDatabaseSnapshot } from '../db/userDb.js'
import {
  getSubscriptionByUserId,
  updateUserProfile,
} from '../auth/userStore.js'

export const profileRouter = Router()

profileRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const tenantId = req.auth.tenantId
    const own = await getOwnProfile(tenantId)
    const subscription = await getSubscriptionByUserId(req.auth.userId)

    return res.json({
      profile: {
        ...(own.profile || {}),
        uid: req.auth.userId,
        email: req.auth.email,
        name: req.auth.name,
        phone: req.auth.phone,
        subscriptionStatus: subscription.status,
        subscriptionType: subscription.plan,
        subscriptionActivatedAt: subscription.activatedAt,
      },
      subscription: {
        status: subscription.status,
        type: subscription.plan,
        plan: subscription.plan,
        activatedAt: subscription.activatedAt,
        expiresAt: subscription.expiresAt,
        label: subscription.label,
      },
      summary: {
        paymentCount: own.paymentCount,
        registrationCount: own.registrationCount,
        latestPayment: own.latestPayment,
        latestRegistration: own.latestRegistration,
      },
      isolation: {
        mode: 'per-user-database',
        tenantId,
        userId: req.auth.userId,
      },
    })
  } catch (error) {
    next(error)
  }
})

profileRouter.patch('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await updateUserProfile(req.auth.userId, {
      name: req.body?.name,
      phone: req.body?.phone,
    })
    const subscription = await getSubscriptionByUserId(req.auth.userId)
    return res.json({
      profile: user,
      subscription,
    })
  } catch (error) {
    next(error)
  }
})

profileRouter.get('/me/database', requireAuth, async (req, res, next) => {
  try {
    const tenantId = req.auth.tenantId
    const database = await getOwnDatabaseSnapshot(tenantId)
    return res.json({ tenantId, userId: req.auth.userId, database })
  } catch (error) {
    next(error)
  }
})
