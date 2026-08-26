import admin from 'firebase-admin'
import { createRemoteJWKSet, jwtVerify } from 'jose'

let initialized = false
let jwks = null

function getCredentials() {
  const projectId = process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')

  if (!projectId || !clientEmail || !privateKey) {
    return null
  }

  return { projectId, clientEmail, privateKey }
}

export function getProjectId() {
  return process.env.FIREBASE_PROJECT_ID || null
}

export function isFirebaseConfigured() {
  return Boolean(getProjectId())
}

export function getFirebaseAdmin() {
  const credentials = getCredentials()
  if (!credentials) {
    return null
  }

  if (!initialized) {
    admin.initializeApp({
      credential: admin.credential.cert(credentials),
    })
    initialized = true
  }

  return admin
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

  const firebaseAdmin = getFirebaseAdmin()
  if (firebaseAdmin) {
    return firebaseAdmin.auth().verifyIdToken(idToken)
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
