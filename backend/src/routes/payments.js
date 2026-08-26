import { Router } from 'express'
import crypto from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Razorpay from 'razorpay'
import { getEmailConfigStatus, isEmailConfigured, sendWebinarPaymentEmail } from '../email.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.resolve(__dirname, '../../data')
const dataFile = path.join(dataDir, 'waitlist.json')

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
    client: new Razorpay({ key_id: keyId, key_secret: keySecret }),
  }
}

async function loadEntries() {
  try {
    const raw = await readFile(dataFile, 'utf8')
    return JSON.parse(raw)
  } catch {
    return []
  }
}

async function saveEntries(entries) {
  await mkdir(dataDir, { recursive: true })
  await writeFile(dataFile, JSON.stringify(entries, null, 2), 'utf8')
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

paymentsRouter.post('/create-order', async (req, res, next) => {
  try {
    const lead = validateLead(req.body)
    if (lead.error) {
      return res.status(400).json({ message: lead.error })
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
        product: 'Live 30-Min Workshop',
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
    })
  } catch (error) {
    next(error)
  }
})

paymentsRouter.post('/verify', async (req, res, next) => {
  try {
    const lead = validateLead(req.body)
    if (lead.error) {
      return res.status(400).json({ message: lead.error })
    }

    const orderId = String(req.body?.razorpay_order_id || '')
    const paymentId = String(req.body?.razorpay_payment_id || '')
    const signature = String(req.body?.razorpay_signature || '')

    if (!orderId || !paymentId || !signature) {
      return res.status(400).json({ message: 'Missing payment confirmation details.' })
    }

    const keySecret = process.env.RAZORPAY_KEY_SECRET
    if (!keySecret) {
      return res.status(500).json({ message: 'Razorpay is not configured on the server.' })
    }

    const expected = crypto
      .createHmac('sha256', keySecret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex')

    if (expected !== signature) {
      return res.status(400).json({ message: 'Payment verification failed.' })
    }

    const webinarLink = getWebinarLink()
    const entries = await loadEntries()
    const existing = entries.find((entry) => entry.email === lead.email)

    if (existing) {
      existing.name = lead.name
      existing.phone = lead.phone
      existing.paymentId = paymentId
      existing.orderId = orderId
      existing.amount = WORKSHOP_AMOUNT_PAISE
      existing.paidAt = new Date().toISOString()
      existing.status = 'paid'
      existing.webinarLink = webinarLink || existing.webinarLink || null
    } else {
      entries.push({
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        paymentId,
        orderId,
        amount: WORKSHOP_AMOUNT_PAISE,
        paidAt: new Date().toISOString(),
        status: 'paid',
        webinarLink: webinarLink || null,
        joinedAt: new Date().toISOString(),
      })
    }

    await saveEntries(entries)

    let emailSent = false
    let emailError = null

    console.log('[payments] email config', getEmailConfigStatus())

    if (isEmailConfigured()) {
      try {
        await sendWebinarPaymentEmail({
          to: lead.email,
          name: lead.name,
          paymentId,
          webinarLink,
        })
        emailSent = true
      } catch (error) {
        console.error('Failed to send webinar email:', error)
        emailError = error.message || 'Could not send email.'
      }
    } else {
      emailError = 'Email is not configured on the server.'
      console.warn(emailError)
    }

    return res.status(200).json({
      message: emailSent
        ? 'Your payment is done. Now you are in for the Webinar. Check your Gmail for the join link.'
        : 'Your payment is done. Now you are in for the Webinar. Email could not be sent automatically.',
      paymentId,
      webinarLink: webinarLink || null,
      emailSent,
      emailError,
    })
  } catch (error) {
    next(error)
  }
})
