import { verifyFirebaseIdToken } from '../firebaseAdmin.js'
import { findTenantIdByEmail, findTenantIdByUid } from './userDb.js'

export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || ''
    const idToken = header.startsWith('Bearer ') ? header.slice(7).trim() : ''

    if (!idToken) {
      return res.status(401).json({
        message: 'Please sign in with Google before continuing.',
      })
    }

    const decoded = await verifyFirebaseIdToken(idToken)
    if (!decoded?.uid) {
      return res.status(401).json({ message: 'Invalid Google session.' })
    }

    const tenantId =
      (await findTenantIdByUid(decoded.uid)) ||
      (decoded.email ? await findTenantIdByEmail(decoded.email) : null)

    req.auth = {
      uid: decoded.uid,
      email: decoded.email || null,
      name: decoded.name || null,
      picture: decoded.picture || null,
      emailVerified: Boolean(decoded.email_verified),
      provider: decoded.firebase?.sign_in_provider || 'google.com',
      tenantId,
    }

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

    const decoded = await verifyFirebaseIdToken(idToken)
    req.auth = {
      uid: decoded.uid,
      email: decoded.email || null,
      name: decoded.name || null,
      picture: decoded.picture || null,
      emailVerified: Boolean(decoded.email_verified),
      provider: decoded.firebase?.sign_in_provider || 'google.com',
    }
  } catch {
    req.auth = null
  }

  return next()
}
