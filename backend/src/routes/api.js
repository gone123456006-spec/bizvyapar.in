import { Router } from 'express'
import { waitlistRouter } from './waitlist.js'
import { authRouter } from './auth.js'
import { paymentsRouter } from './payments.js'

export const apiRouter = Router()

apiRouter.get('/', (_req, res) => {
  res.json({
    name: 'Easy Vyapar API',
    version: '0.0.0',
    message: 'Backend is ready.',
  })
})

apiRouter.use('/auth', authRouter)
apiRouter.use('/waitlist', waitlistRouter)
apiRouter.use('/payments', paymentsRouter)
