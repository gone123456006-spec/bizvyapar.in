import { verifyAccessToken } from '../localAuth.js'
import { findTenantIdByEmail, findTenantIdByUid } from './userDb.js'

async function resolveAuthFromToken(idToken) {
  const local = await verifyAccessToken(idToken)
  const tenantId =
    (await findTenantIdByUid(local.uid)) ||
    (local.email ? await findTenantIdByEmail(local.email) : null)

  return {
    uid: local.uid,
    email: local.email,
    name: local.name,
    phone: local.phone || null,
    picture: null,
    emailVerified: Boolean(local.emailVerified),
    provider: local.provider || 'local',
    tenantId,
  }
}

export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || ''
    const idToken = header.startsWith('Bearer ') ? header.slice(7).trim() : ''

    if (!idToken) {
      return res.status(401).json({
        message: 'Please enter your name, email, and phone to continue.',
      })
    }

    req.auth = await resolveAuthFromToken(idToken)
    return next()
  } catch (error) {
    return res.status(error.status || 401).json({
      message: error.message || 'Session expired. Please sign in again.',
    })
  }
}

export async function optionalAuth(req, _res, next) {
  try {
    const header = req.headers.authorization || ''
    const idToken = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
    if (!idToken) {
      req.auth = null
      return next()
    }

    req.auth = await resolveAuthFromToken(idToken)
  } catch {
    req.auth = null
  }

  return next()
}
