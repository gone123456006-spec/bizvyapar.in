import { Router } from 'express'
import crypto from 'node:crypto'
import Razorpay from 'razorpay'
import { requireAuth } from '../db/authMiddleware.js'
import {
  findPaymentAnywhere,
  getOwnProfile,
  recordPayment,
  touchLogin,
} from '../db/userDb.js'
import {
  getEmailConfigStatus,
  isEmailConfigured,
  sendWebinarPaymentEmail,
} from '../email.js'
import { buildSubscription, isLifetimeActive } from '../subscription.js'

export const paymentsRouter = Router()

const WORKSHOP_AMOUNT_PAISE = Number(process.env.WORKSHOP_AMOUNT_PAISE || 100)

function getWebinarLink() {
  return String(process.env.WEBINAR_LINK || '').trim()
}

function getRazorpay() {
  const keyId = process.env.RAZORPAY_KEY_ID
  const keySecret = process.env.RAZORPAY_KEY_SECRET

  if (!keyId || !keySecret) {
    const error = new Error('Razorpay is not configured on the server.')
    error.status = 500
    throw error
  }

  return {
    keyId,
    keySecret,
    client: new Razorpay({ key_id: keyId, key_secret: keySecret }),
  }
}

function validateLead(body) {
  const name = String(body?.name || '').trim()
  const email = String(body?.email || '').trim().toLowerCase()
  const phone = String(body?.phone || '').trim()

  if (!name || name.length < 2) {
    return { error: 'Please enter your full name.' }
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: 'Please enter a valid email.' }
  }

  const digits = phone.replace(/\D/g, '')
  if (digits.length !== 10) {
    return { error: 'Please enter a valid 10-digit mobile number.' }
  }

  return { name, email, phone: digits }
}

function assertAuthEmail(auth, email) {
  const authEmail = String(auth?.email || '').trim().toLowerCase()
  if (!authEmail) {
    const error = new Error('Google account email is required for payment.')
    error.status = 401
    throw error
  }
  if (authEmail !== email) {
    const error = new Error('Payment email must match your signed-in Google account.')
    error.status = 403
    throw error
  }
}

async function finalizePaidSeat({
  auth,
  lead,
  orderId,
  paymentId,
  sendEmail = true,
}) {
  const webinarLink = getWebinarLink()

  // Always bind to Firebase uid tenant (no guest split DB).
  await touchLogin({
    uid: auth.uid,
    email: auth.email,
    name: auth.name || lead.name,
    picture: auth.picture || null,
    provider: auth.provider || 'google.com',
    emailVerified: auth.emailVerified,
    phone: lead.phone,
  })

  const saved = await recordPayment(
    {
      uid: auth.uid,
      email: auth.email,
      name: lead.name || auth.name,
      phone: lead.phone,
      provider: auth.provider || 'google.com',
      emailVerified: auth.emailVerified,
    },
    {
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      paymentId,
      orderId,
      amount: WORKSHOP_AMOUNT_PAISE,
      webinarLink: webinarLink || null,
    },
  )

  let emailError = null

  if (saved.alreadyRecorded) {
    return {
      saved,
      webinarLink: saved.payment?.webinarLink || webinarLink || null,
      emailSent: false,
      emailError: null,
      alreadyRecorded: true,
    }
  }

  if (sendEmail && isEmailConfigured()) {
    // Fire-and-forget — never delay the payment success response.
    void sendWebinarPaymentEmail({
      to: lead.email,
      name: lead.name,
      paymentId,
      webinarLink,
      amountLabel: '₹1',
    }).catch((error) => {
      console.error('Failed to send webinar email:', error)
    })
  } else if (sendEmail) {
    emailError = 'Email is not configured on the server.'
  }

  return {
    saved,
    webinarLink: webinarLink || null,
    emailSent: false,
    emailError,
    alreadyRecorded: false,
  }
}

paymentsRouter.post('/create-order', requireAuth, async (req, res, next) => {
  try {
    const lead = validateLead(req.body)
    if (lead.error) {
      return res.status(400).json({ message: lead.error })
    }

    assertAuthEmail(req.auth, lead.email)

    const login = await touchLogin({
      uid: req.auth.uid,
      email: req.auth.email,
      name: req.auth.name || lead.name,
      picture: req.auth.picture,
      provider: req.auth.provider,
      emailVerified: req.auth.emailVerified,
      phone: lead.phone,
    })

    const own = await getOwnProfile(login.tenantId)
    const subscription = buildSubscription(own.profile, own.paymentCount)
    if (isLifetimeActive(own.profile, own.paymentCount)) {
      return res.status(409).json({
        message:
          'You already have a permanent lifetime subscription on this account.',
        subscription,
        alreadySubscribed: true,
      })
    }

    const { keyId, client } = getRazorpay()
    const receipt = `ev_${Date.now().toString(36)}`

    const order = await client.orders.create({
      amount: WORKSHOP_AMOUNT_PAISE,
      currency: 'INR',
      receipt,
      notes: {
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        uid: req.auth.uid,
        tenantId: login.tenantId,
        product: 'Live 30-Min Workshop',
        subscriptionType: 'lifetime',
      },
    })

    return res.status(201).json({
      keyId,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      tenantId: login.tenantId,
      subscriptionType: 'lifetime',
    })
  } catch (error) {
    next(error)
  }
})

paymentsRouter.post('/verify', requireAuth, async (req, res, next) => {
  try {
    const lead = validateLead(req.body)
    if (lead.error) {
      return res.status(400).json({ message: lead.error })
    }

    assertAuthEmail(req.auth, lead.email)

    const orderId = String(req.body?.razorpay_order_id || '')
    const paymentId = String(req.body?.razorpay_payment_id || '')
    const signature = String(req.body?.razorpay_signature || '')

    if (!orderId || !paymentId || !signature) {
      return res.status(400).json({ message: 'Missing payment confirmation details.' })
    }

    const { keySecret } = getRazorpay()
    const expected = crypto
      .createHmac('sha256', keySecret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex')

    if (expected !== signature) {
      return res.status(400).json({ message: 'Payment verification failed.' })
    }

    // Idempotent short-circuit before rewrite/email.
    const existing = await findPaymentAnywhere(paymentId)
    if (existing) {
      return res.status(200).json({
        message:
          'Your payment is already confirmed. Now you are in for the Webinar.',
        paymentId,
        webinarLink: existing.webinarLink || getWebinarLink() || null,
        emailSent: false,
        emailError: null,
        alreadyRecorded: true,
        tenantId: existing.tenantId || null,
      })
    }

    console.log('[payments] email config', getEmailConfigStatus())

    const result = await finalizePaidSeat({
      auth: req.auth,
      lead,
      orderId,
      paymentId,
      sendEmail: true,
    })

    const subscription = buildSubscription(
      result.saved.profile,
      result.alreadyRecorded ? 1 : 1,
    )

    return res.status(200).json({
      message: result.alreadyRecorded
        ? 'Your payment is already confirmed. Now you are in for the Webinar.'
        : result.emailSent
          ? 'Your payment is done. Now you are in for the Webinar. Check your Gmail for the join link.'
          : 'Your payment is done. Now you are in for the Webinar. Email could not be sent automatically.',
      paymentId,
      webinarLink: result.webinarLink,
      emailSent: result.emailSent,
      emailError: result.emailError,
      alreadyRecorded: result.alreadyRecorded,
      tenantId: result.saved.tenantId,
      profileStatus: result.saved.profile?.status || 'paid',
      subscription,
      subscriptionType: 'lifetime',
    })
  } catch (error) {
    next(error)
  }
})

/**
 * Razorpay webhook — captures payment even if browser closes.
 * Configure webhook URL: https://YOUR-API/api/payments/webhook
 * Secret: RAZORPAY_WEBHOOK_SECRET
 */
paymentsRouter.post('/webhook', async (req, res) => {
  try {
    const webhookSecret = String(process.env.RAZORPAY_WEBHOOK_SECRET || '').trim()
    if (!webhookSecret) {
      return res.status(503).json({ message: 'Webhook secret not configured.' })
    }

    const signature = String(req.headers['x-razorpay-signature'] || '')
    const rawBody = req.rawBody || JSON.stringify(req.body || {})
    const expected = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex')

    if (expected !== signature) {
      return res.status(400).json({ message: 'Invalid webhook signature.' })
    }

    const event = req.body?.event
    const entity = req.body?.payload?.payment?.entity
    if (event !== 'payment.captured' || !entity) {
      return res.status(200).json({ ok: true, ignored: true })
    }

    const paymentId = String(entity.id || '')
    const orderId = String(entity.order_id || '')
    if (!paymentId) {
      return res.status(200).json({ ok: true, ignored: true })
    }

    const existing = await findPaymentAnywhere(paymentId)
    if (existing) {
      return res.status(200).json({ ok: true, alreadyRecorded: true })
    }

    const notes = entity.notes || {}
    const uid = String(notes.uid || '').trim()
    const email = String(notes.email || entity.email || '')
      .trim()
      .toLowerCase()
    const name = String(notes.name || 'Participant').trim()
    const phone = String(notes.phone || '').replace(/\D/g, '')

    if (!uid || !email) {
      console.warn('[payments/webhook] missing uid/email notes', {
        paymentId,
        orderId,
      })
      return res.status(200).json({ ok: true, pendingManual: true })
    }

    const result = await finalizePaidSeat({
      auth: {
        uid,
        email,
        name,
        picture: null,
        provider: 'google.com',
        emailVerified: true,
      },
      lead: {
        name,
        email,
        phone: phone.length === 10 ? phone : '0000000000',
      },
      orderId,
      paymentId,
      sendEmail: true,
    })

    return res.status(200).json({
      ok: true,
      alreadyRecorded: result.alreadyRecorded,
      tenantId: result.saved.tenantId,
    })
  } catch (error) {
    console.error('[payments/webhook]', error)
    return res.status(500).json({ message: 'Webhook handling failed.' })
  }
})
