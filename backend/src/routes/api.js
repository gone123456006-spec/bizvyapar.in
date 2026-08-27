import { Router } from 'express'
import { waitlistRouter } from './waitlist.js'
import { authRouter } from './auth.js'
import { paymentsRouter } from './payments.js'
import { profileRouter } from './profile.js'
import { adminRouter } from './admin.js'
import { publicSettingsRouter } from './publicSettings.js'
import { trackRouter } from './track.js'

export const apiRouter = Router()

apiRouter.get('/', (_req, res) => {
  res.json({
    name: 'BizVyapar API',
    version: '0.0.0',
    message: 'Backend is ready.',
    isolation: 'per-user-database',
  })
})

apiRouter.use('/auth', authRouter)
apiRouter.use('/profile', profileRouter)
apiRouter.use('/waitlist', waitlistRouter)
apiRouter.use('/payments', paymentsRouter)
apiRouter.use('/admin', adminRouter)
apiRouter.use('/public/settings', publicSettingsRouter)
apiRouter.use('/track', trackRouter)
