import { createHash, randomUUID } from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'

const TOKEN_TTL = '30d'
const ISSUER = 'bizvyapar'

function getJwtSecret() {
  const secret = String(
    process.env.AUTH_JWT_SECRET ||
      process.env.ADMIN_SESSION_SECRET ||
      '',
  ).trim()
  if (secret) return new TextEncoder().encode(secret)
  // Dev fallback — set AUTH_JWT_SECRET in production
  return new TextEncoder().encode('bizvyapar-dev-auth-secret-change-me')
}

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

export function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2)
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1)
  return digits.slice(-10)
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email))
}

export function isValidPhone(phone) {
  return /^[6-9]\d{9}$/.test(normalizePhone(phone))
}

export function createUserId() {
  return randomUUID()
}

export async function signAccessToken(payload) {
  return new SignJWT({
    email: payload.email || null,
    name: payload.name || null,
    phone: payload.phone || null,
    provider: payload.provider || 'local',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(payload.uid))
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .sign(getJwtSecret())
}

export async function verifyAccessToken(token) {
  const { payload } = await jwtVerify(token, getJwtSecret(), {
    issuer: ISSUER,
  })
  const uid = String(payload.sub || '').trim()
  if (!uid) {
    const error = new Error('Invalid session.')
    error.status = 401
    throw error
  }
  return {
    uid,
    email: payload.email || null,
    name: payload.name || null,
    phone: payload.phone || null,
    emailVerified: true,
    provider: payload.provider || 'local',
  }
}

export function fingerprintLead({ email, phone }) {
  return createHash('sha256')
    .update(`${normalizeEmail(email)}:${normalizePhone(phone)}`)
    .digest('hex')
    .slice(0, 16)
}
