import { Router } from 'express'
import { optionalAuth } from '../db/authMiddleware.js'
import { upsertRegistration } from '../db/userDb.js'

export const waitlistRouter = Router()

waitlistRouter.post('/', optionalAuth, async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim()
    const email = String(req.body?.email || '').trim().toLowerCase()
    const phone = String(req.body?.phone || '').trim()

    if (!name || name.length < 2) {
      return res.status(400).json({ message: 'Please enter your full name.' })
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: 'Please enter a valid email.' })
    }

    if (phone && !/^[0-9+\-\s]{7,15}$/.test(phone)) {
      return res.status(400).json({ message: 'Please enter a valid phone number.' })
    }

    // Isolation: if signed in, force registration into that user's DB only.
    // If guest, create/use email-scoped private database.
    if (req.auth?.email && req.auth.email.toLowerCase() !== email) {
      return res.status(403).json({
        message: 'You can only register with your signed-in email.',
      })
    }

    const result = await upsertRegistration(
      {
        uid: req.auth?.uid || null,
        email,
        name,
        phone: phone || null,
        provider: req.auth?.provider || 'waitlist',
        emailVerified: req.auth?.emailVerified || false,
      },
      {
        name,
        email,
        phone: phone || null,
        status: 'joined',
      },
    )

    if (result.alreadyJoined) {
      return res.status(200).json({
        message: 'You are already on the waitlist. We will email the webinar link.',
        alreadyJoined: true,
        tenantId: result.tenantId,
      })
    }

    return res.status(201).json({
      message: 'You are on the waitlist. Check your email for the webinar link.',
      tenantId: result.tenantId,
    })
  } catch (error) {
    next(error)
  }
})
