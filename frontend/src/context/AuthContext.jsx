import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { apiUrl } from '../lib/api.js'
import { getTrackingIds } from '../lib/visitorTracking.js'

const AuthContext = createContext(null)
const TOKEN_KEY = 'bv_access_token'
const USER_KEY = 'bv_auth_user'

function readStoredToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || null
  } catch {
    return null
  }
}

function readStoredUser() {
  try {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function persistSession(token, user) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user))
    else localStorage.removeItem(USER_KEY)
  } catch {
    // ignore quota / private mode
  }
}

export async function getAccessToken() {
  return readStoredToken()
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => readStoredUser())
  const [loading, setLoading] = useState(true)
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState('')

  const applySession = useCallback((token, nextUser) => {
    persistSession(token, nextUser)
    setUser(nextUser)
  }, [])

  const refreshProfile = useCallback(async () => {
    const token = readStoredToken()
    if (!token) {
      setUser(null)
      return null
    }

    const res = await fetch(apiUrl('/api/auth/me'), {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })

    if (!res.ok) {
      persistSession(null, null)
      setUser(null)
      return null
    }

    const data = await res.json()
    const nextUser = {
      uid: data.user?.uid,
      email: data.user?.email || null,
      name: data.user?.name || null,
      phone: data.user?.phone || null,
      picture: data.user?.picture || null,
      emailVerified: Boolean(data.user?.emailVerified),
      provider: data.user?.provider || 'local',
      tenantId: data.user?.tenantId || null,
      subscription: data.subscription || data.user?.subscription || null,
    }
    applySession(token, nextUser)
    return nextUser
  }, [applySession])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        if (readStoredToken()) {
          await refreshProfile()
        }
      } catch {
        if (!cancelled) {
          persistSession(null, null)
          setUser(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refreshProfile])

  /**
   * Create or restore account with name + email + phone.
   * Returns the signed-in user object.
   */
  async function signInWithDetails({ name, email, phone }) {
    setSigningIn(true)
    setError('')
    try {
      const ids = getTrackingIds()
      let res
      try {
        res = await fetch(apiUrl('/api/auth/login'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            email,
            phone,
            sessionId: ids.sessionId,
            visitorId: ids.visitorId,
          }),
        })
      } catch {
        throw new Error(
          'Could not reach the server. Check your internet connection and try again.',
        )
      }

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(
          data.message ||
            (res.status === 404
              ? 'Sign-in service is updating. Please try again in a minute.'
              : `Could not sign in (${res.status}). Please try again.`),
        )
      }

      if (!data.accessToken || !data.user?.uid) {
        throw new Error('Sign-in response was incomplete. Please try again.')
      }

      const nextUser = {
        uid: data.user.uid,
        email: data.user.email || null,
        name: data.user.name || null,
        phone: data.user.phone || null,
        picture: null,
        emailVerified: true,
        provider: 'local',
        tenantId: data.user.tenantId || null,
        subscription: data.subscription || data.user.subscription || null,
      }
      applySession(data.accessToken, nextUser)
      return nextUser
    } catch (err) {
      const message = err.message || 'Sign in failed.'
      setError(message)
      throw err
    } finally {
      setSigningIn(false)
    }
  }

  async function signOut() {
    try {
      const token = readStoredToken()
      const ids = getTrackingIds()
      if (token) {
        void fetch(apiUrl('/api/auth/logout'), {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ sessionId: ids.sessionId }),
          keepalive: true,
        }).catch(() => null)
      }
    } finally {
      persistSession(null, null)
      setUser(null)
      setError('')
    }
  }

  const value = useMemo(
    () => ({
      user,
      loading,
      signingIn,
      error,
      signInWithDetails,
      signOut,
      refreshProfile,
      isConfigured: true,
    }),
    [user, loading, signingIn, error, refreshProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
