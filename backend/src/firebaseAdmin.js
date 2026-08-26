import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { createRemoteJWKSet, jwtVerify } from 'jose'

let initialized = false
let jwks = null

function getCredentials() {
  const projectId = String(process.env.FIREBASE_PROJECT_ID || '').trim()
  const clientEmail = String(process.env.FIREBASE_CLIENT_EMAIL || '').trim()
  let privateKey = String(process.env.FIREBASE_PRIVATE_KEY || '').trim()

  // Render / dotenv often store the key with literal \n sequences
  privateKey = privateKey.replace(/^"|"$/g, '').replace(/\\n/g, '\n')

  if (!projectId || !clientEmail || !privateKey.includes('BEGIN')) {
    return null
  }

  return { projectId, clientEmail, privateKey }
}

export function getProjectId() {
  return String(process.env.FIREBASE_PROJECT_ID || '').trim() || null
}

export function isFirebaseConfigured() {
  return Boolean(getProjectId())
}

/**
 * Initialize Admin SDK only when a full service-account is present.
 * Returns Auth helper or null (caller should fall back to JWKS).
 */
export function getFirebaseAuth() {
  const credentials = getCredentials()
  if (!credentials) {
    return null
  }

  try {
    if (!initialized) {
      if (getApps().length === 0) {
        initializeApp({
          credential: cert(credentials),
          projectId: credentials.projectId,
        })
      }
      initialized = true
    }
    return getAuth()
  } catch (error) {
    console.error('[firebase-admin] init failed, using JWKS fallback:', error.message)
    return null
  }
}

function getJwks() {
  if (!jwks) {
    jwks = createRemoteJWKSet(
      new URL(
        'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com',
      ),
    )
  }
  return jwks
}

/**
 * Verify a Firebase ID token.
 * Prefers Admin SDK when service-account keys exist; otherwise verifies
 * with Google's public JWKS using FIREBASE_PROJECT_ID only.
 */
export async function verifyFirebaseIdToken(idToken) {
  const projectId = getProjectId()
  if (!projectId) {
    const error = new Error('Firebase is not configured on the server.')
    error.status = 503
    throw error
  }

  const auth = getFirebaseAuth()
  if (auth) {
    return auth.verifyIdToken(idToken)
  }

  const { payload } = await jwtVerify(idToken, getJwks(), {
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId,
  })

  return {
    uid: payload.user_id || payload.sub,
    email: payload.email || null,
    name: payload.name || null,
    picture: payload.picture || null,
    email_verified: Boolean(payload.email_verified),
    firebase: payload.firebase || { sign_in_provider: 'google.com' },
  }
}
