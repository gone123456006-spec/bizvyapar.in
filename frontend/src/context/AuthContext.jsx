import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
} from 'firebase/auth'
import { auth, isFirebaseConfigured } from '../lib/firebase.js'
import { apiUrl } from '../lib/api.js'

const AuthContext = createContext(null)
const googleProvider = new GoogleAuthProvider()

function mapFirebaseUser(firebaseUser) {
  return {
    uid: firebaseUser.uid,
    email: firebaseUser.email || null,
    name: firebaseUser.displayName || null,
    picture: firebaseUser.photoURL || null,
    emailVerified: Boolean(firebaseUser.emailVerified),
    provider: 'google.com',
  }
}

function syncUserWithBackend(idToken) {
  return fetch(apiUrl('/api/auth/google'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
    keepalive: true,
  }).catch(() => null)
}

export async function getAccessToken() {
  if (!auth?.currentUser) return null
  return auth.currentUser.getIdToken(false)
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState('')
  const syncingUid = useRef(null)

  const syncBackendInBackground = useCallback((firebaseUser) => {
    if (!firebaseUser || syncingUid.current === firebaseUser.uid) return
    syncingUid.current = firebaseUser.uid

    const run = () => {
      void firebaseUser
        .getIdToken(false)
        .then((idToken) => syncUserWithBackend(idToken))
        .finally(() => {
          if (syncingUid.current === firebaseUser.uid) {
            syncingUid.current = null
          }
        })
    }

    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      window.requestIdleCallback(run, { timeout: 1500 })
    } else {
      window.setTimeout(run, 0)
    }
  }, [])

  useEffect(() => {
    if (!isFirebaseConfigured() || !auth) {
      setLoading(false)
      return undefined
    }

    let active = true

    // Restore cached session ASAP (IndexedDB), then attach listener.
    void auth.authStateReady().then(() => {
      if (!active) return
      const current = auth.currentUser
      if (current) {
        setUser(mapFirebaseUser(current))
        syncBackendInBackground(current)
      }
      setLoading(false)
    })

    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (!firebaseUser) {
        setUser(null)
        setLoading(false)
        return
      }

      setUser(mapFirebaseUser(firebaseUser))
      setLoading(false)
      syncBackendInBackground(firebaseUser)
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [syncBackendInBackground])

  async function signInWithGoogle() {
    if (!auth) {
      setError('Firebase is not configured. Add your Firebase keys to frontend/.env')
      return null
    }

    setError('')

    try {
      setSigningIn(true)
      const result = await signInWithPopup(auth, googleProvider)
      const mapped = mapFirebaseUser(result.user)
      setUser(mapped)
      syncBackendInBackground(result.user)
      return mapped
    } catch (err) {
      if (err.code === 'auth/popup-closed-by-user') {
        return null
      }
      if (err.code === 'auth/popup-blocked') {
        setError('Popup blocked. Allow popups for this site and try again.')
        return null
      }
      if (err.code === 'auth/unauthorized-domain') {
        setError(
          'This domain is not allowed in Firebase. Add localhost in Authentication → Settings → Authorized domains.',
        )
        return null
      }
      if (err.code === 'auth/operation-not-allowed') {
        setError(
          'Google sign-in is disabled. Enable Google in Firebase Authentication → Sign-in method.',
        )
        return null
      }
      setError(err.message || 'Google sign in failed.')
      return null
    } finally {
      setSigningIn(false)
    }
  }

  async function signOut() {
    setError('')
    syncingUid.current = null
    if (auth) {
      await firebaseSignOut(auth)
    }
    setUser(null)
  }

  const value = useMemo(
    () => ({
      user,
      loading,
      signingIn,
      error,
      isConfigured: isFirebaseConfigured(),
      signInWithGoogle,
      signOut,
      getAccessToken,
    }),
    [user, loading, signingIn, error],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }

  return context
}
