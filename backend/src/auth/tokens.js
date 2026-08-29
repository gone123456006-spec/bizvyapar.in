/**
 * Access JWT (short-lived) + opaque refresh tokens (hashed in DB).
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'

const ACCESS_TTL = process.env.ACCESS_TOKEN_TTL || '15m'
const REFRESH_TTL_DAYS = Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30)
const ISSUER = 'bizvyapar'

function getJwtSecret() {
  const secret = String(
    process.env.AUTH_JWT_SECRET || process.env.ADMIN_SESSION_SECRET || '',
  ).trim()
  if (!secret) {
    if (process.env.NODE_ENV === 'production' || process.env.RENDER) {
      throw new Error('AUTH_JWT_SECRET is required in production.')
    }
    return new TextEncoder().encode('bizvyapar-dev-auth-secret-change-me')
  }
  return new TextEncoder().encode(secret)
}

export function hashToken(raw) {
  return createHash('sha256').update(String(raw)).digest('hex')
}

export function createRefreshTokenRaw() {
  return randomBytes(48).toString('base64url')
}

export function refreshExpiryDate() {
  const d = new Date()
  d.setDate(d.getDate() + REFRESH_TTL_DAYS)
  return d
}

/**
 * Access token — short lived. sub = userId (UUID).
 * Never put password or subscription trust flags that clients can forge for authz
 * beyond claims we re-check server-side.
 */
export async function signAccessToken(user) {
  return new SignJWT({
    email: user.email || null,
    name: user.name || null,
    typ: 'access',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(user.id || user.userId || user.uid))
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TTL)
    .sign(getJwtSecret())
}

export async function verifyAccessToken(token) {
  const { payload } = await jwtVerify(token, getJwtSecret(), {
    issuer: ISSUER,
  })
  if (payload.typ && payload.typ !== 'access') {
    const error = new Error('Invalid access token.')
    error.status = 401
    throw error
  }
  const userId = String(payload.sub || '').trim()
  if (!userId) {
    const error = new Error('Invalid session.')
    error.status = 401
    throw error
  }
  return {
    userId,
    uid: userId,
    email: payload.email || null,
    name: payload.name || null,
  }
}

export function newUserId() {
  return randomUUID()
}
