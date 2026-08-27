import { Router } from 'express'
import { createRateLimiter } from '../analyticsUtils.js'
import {
  linkVisitorToTenant,
  trackVisitorEvent,
} from '../db/analyticsStore.js'
import { optionalAuth } from '../db/authMiddleware.js'

export const trackRouter = Router()

const allowTrack = createRateLimiter({ windowMs: 60_000, max: 90 })

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim()
  return forwarded || req.ip || req.socket?.remoteAddress || ''
}

trackRouter.post('/pageview', optionalAuth, async (req, res) => {
  try {
    const ip = clientIp(req)
    const key = `${ip}:${String(req.body?.visitorId || '').slice(0, 16)}`
    if (!allowTrack(key)) {
      return res.status(429).json({ message: 'Too many tracking events.' })
    }

    const result = await trackVisitorEvent({
      visitorId: req.body?.visitorId,
      sessionId: req.body?.sessionId,
      path: req.body?.path,
      title: req.body?.title,
      referrer: req.body?.referrer,
      engaged: Boolean(req.body?.engaged),
      userAgent: req.headers['user-agent'],
      ip,
      tenantId: req.auth?.tenantId || null,
    })

    // If signed-in user provided visitor id, associate anonymously.
    if (req.auth?.tenantId && req.body?.visitorId) {
      void linkVisitorToTenant(req.body.visitorId, req.auth.tenantId).catch(() => undefined)
    }

    res.status(202).json({ ok: true, ...result })
  } catch (error) {
    const status = error.status || 500
    res.status(status).json({ message: error.message || 'Tracking failed' })
  }
})

trackRouter.post('/engage', optionalAuth, async (req, res) => {
  try {
    const ip = clientIp(req)
    if (!allowTrack(`${ip}:engage`)) {
      return res.status(429).json({ message: 'Too many tracking events.' })
    }

    const result = await trackVisitorEvent({
      visitorId: req.body?.visitorId,
      sessionId: req.body?.sessionId,
      path: req.body?.path || '/',
      title: req.body?.title,
      referrer: req.body?.referrer,
      engaged: true,
      userAgent: req.headers['user-agent'],
      ip,
      tenantId: req.auth?.tenantId || null,
    })

    res.status(202).json({ ok: true, ...result })
  } catch (error) {
    const status = error.status || 500
    res.status(status).json({ message: error.message || 'Tracking failed' })
  }
})
