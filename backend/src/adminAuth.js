/**
 * TredsDash admin session auth (password + signed bearer token).
 */

import crypto from 'node:crypto'

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000
const DASHBOARD_NAME = 'TredsDash'

export function getAdminDashboardName() {
  return String(process.env.ADMIN_DASHBOARD_NAME || DASHBOARD_NAME).trim() || DASHBOARD_NAME
}

export function getAdminPassword() {
  return String(process.env.ADMIN_PASSWORD || '').trim()
}

function getSessionSecret() {
  const explicit = String(process.env.ADMIN_SESSION_SECRET || '').trim()
  if (explicit) return explicit
  const password = getAdminPassword()
  if (!password) return ''
  // Derive a stable secret when ADMIN_SESSION_SECRET is not set.
  return crypto.createHash('sha256').update(`tredsdash:${password}`).digest('hex')
}

export function isAdminConfigured() {
  return Boolean(getAdminPassword() && getSessionSecret())
}

function b64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function fromB64url(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4))
  return Buffer.from(padded + pad, 'base64').toString('utf8')
}

function sign(payloadB64) {
  return crypto
    .createHmac('sha256', getSessionSecret())
    .update(payloadB64)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a))
  const right = Buffer.from(String(b))
  if (left.length !== right.length) return false
  return crypto.timingSafeEqual(left, right)
}

export function verifyAdminPassword(password) {
  const expected = getAdminPassword()
  if (!expected) return false
  return safeEqual(password, expected)
}

export function createAdminToken() {
  if (!isAdminConfigured()) {
    const error = new Error('TredsDash admin password is not configured on the server.')
    error.status = 503
    throw error
  }

  const payload = {
    role: 'admin',
    dash: getAdminDashboardName(),
    iat: Date.now(),
    exp: Date.now() + TOKEN_TTL_MS,
  }
  const payloadB64 = b64url(JSON.stringify(payload))
  return `${payloadB64}.${sign(payloadB64)}`
}

export function verifyAdminToken(token) {
  if (!token || !isAdminConfigured()) return null
  const parts = String(token).split('.')
  if (parts.length !== 2) return null
  const [payloadB64, signature] = parts
  if (!safeEqual(sign(payloadB64), signature)) return null

  try {
    const payload = JSON.parse(fromB64url(payloadB64))
    if (!payload || payload.role !== 'admin') return null
    if (!payload.exp || Date.now() > Number(payload.exp)) return null
    return payload
  } catch {
    return null
  }
}

export function requireAdmin(req, res, next) {
  try {
    if (!isAdminConfigured()) {
      return res.status(503).json({
        message: 'TredsDash is not configured. Set ADMIN_PASSWORD on the server.',
      })
    }

    const header = String(req.headers.authorization || '')
    const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
    const headerToken = String(req.headers['x-admin-token'] || '').trim()
    const token = bearer || headerToken
    const session = verifyAdminToken(token)

    if (!session) {
      return res.status(401).json({ message: 'Admin session expired. Please sign in again.' })
    }

    req.admin = session
    next()
  } catch (error) {
    next(error)
  }
}
