import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
}

export function isFirebaseConfigured() {
  return Boolean(
    firebaseConfig.apiKey &&
      firebaseConfig.authDomain &&
      firebaseConfig.projectId &&
      firebaseConfig.appId,
  )
}

let app = null
let auth = null

if (isFirebaseConfigured()) {
  app = initializeApp(firebaseConfig)
  auth = getAuth(app)

  // Defer Analytics so it never competes with Sign In.
  if (firebaseConfig.measurementId && typeof window !== 'undefined') {
    const loadAnalytics = () => {
      void import('firebase/analytics')
        .then(({ getAnalytics, isSupported }) =>
          isSupported().then((supported) => {
            if (supported) getAnalytics(app)
          }),
        )
        .catch(() => {})
    }

    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(loadAnalytics, { timeout: 4000 })
    } else {
      window.setTimeout(loadAnalytics, 2500)
    }
  }
}

export { app, auth }
