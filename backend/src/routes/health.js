import { Router } from 'express'
import { getRuntimeStatus } from '../config.js'
import { getEmailConfigStatus } from '../email.js'

export const healthRouter = Router()

healthRouter.get('/', (_req, res) => {
  const runtime = getRuntimeStatus()
  const email = getEmailConfigStatus()

  res.json({
    status: 'ok',
    service: 'bizvyapar-backend',
    timestamp: new Date().toISOString(),
    platform: process.env.RENDER ? 'render' : process.env.VERCEL ? 'vercel' : 'local',
    ready: runtime.ready,
    isolation: 'per-user-tenant',
    database: process.env.DATABASE_URL ? 'postgres' : 'file-tenants',
    checks: {
      razorpay: runtime.razorpay,
      email: runtime.email,
      firebase: runtime.firebase,
      webinarLink: runtime.webinarLink,
      cors: runtime.cors,
    },
    missing: runtime.missing,
    emailMode: email.mode || null,
  })
})
