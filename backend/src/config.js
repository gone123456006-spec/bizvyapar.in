/**
 * Shared runtime config helpers for local + Render production.
 */

const DEFAULT_ORIGINS = [
  'https://www.bizvyapar.in',
  'https://bizvyapar.in',
  'https://bizvyapar-in-frontend.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
]

export function getPort() {
  return Number(process.env.PORT || 5000)
}

export function getHost() {
  // Render (and most PaaS) require binding on 0.0.0.0
  return String(process.env.HOST || '0.0.0.0').trim() || '0.0.0.0'
}

export function getAllowedOrigins() {
  const fromEnv = String(process.env.CORS_ORIGIN || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  return [...new Set([...DEFAULT_ORIGINS, ...fromEnv])]
}

export function getRuntimeStatus() {
  const razorpay = Boolean(
    process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET,
  )
  const email = Boolean(
    (process.env.SMTP_USER || process.env.BREVO_SMTP_LOGIN || process.env.GMAIL_USER) &&
      (process.env.SMTP_PASS ||
        process.env.SMTP_PASSWORD ||
        process.env.BREVO_SMTP_KEY ||
        process.env.GMAIL_APP_PASSWORD) &&
      (process.env.SMTP_FROM || process.env.SMTP_FROM_EMAIL || process.env.EMAIL_FROM),
  )
  const firebase = Boolean(process.env.FIREBASE_PROJECT_ID)
  const webinarLink = Boolean(String(process.env.WEBINAR_LINK || '').trim())
  const cors = getAllowedOrigins().length > 0
  const database = Boolean(String(process.env.DATABASE_URL || '').trim())
  const authJwt = Boolean(String(process.env.AUTH_JWT_SECRET || '').trim())

  const missing = []
  if (!razorpay) missing.push('RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET')
  if (!email) missing.push('SMTP_USER/SMTP_PASS')
  if (!webinarLink) missing.push('WEBINAR_LINK')
  if (!cors) missing.push('CORS_ORIGIN')
  if (!database) missing.push('DATABASE_URL')
  if (!authJwt) missing.push('AUTH_JWT_SECRET')

  return {
    razorpay,
    email,
    firebase,
    webinarLink,
    cors,
    database,
    authJwt,
    ready: razorpay && email && webinarLink && cors && database && authJwt,
    missing,
  }
}
