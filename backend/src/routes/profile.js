import { Router } from 'express'
import { requireAuth } from '../db/authMiddleware.js'
import { getOwnProfile, getOwnDatabaseSnapshot, touchLogin } from '../db/userDb.js'

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

    return res.json({
      profile,
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
