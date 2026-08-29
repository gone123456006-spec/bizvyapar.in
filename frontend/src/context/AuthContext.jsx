import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { apiUrl } from '../lib/api.js'
import { getTrackingIds } from '../lib/visitorTracking.js'

const AuthContext = createContext(null)
const ACCESS_KEY = 'bv_access_token'
const REFRESH_KEY = 'bv_refresh_token'
const USER_KEY = 'bv_auth_user'

function readStored(key) {
  try {
    return localStorage.getItem(key) || null
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

function persistSession({ accessToken, refreshToken, user }) {
  try {
    if (accessToken) localStorage.setItem(ACCESS_KEY, accessToken)
    else if (accessToken === null) localStorage.removeItem(ACCESS_KEY)

    if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken)
    else if (refreshToken === null) localStorage.removeItem(REFRESH_KEY)

    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user))
    else if (user === null) localStorage.removeItem(USER_KEY)
  } catch {
    // ignore quota / private mode
  }
}

function mapUserPayload(data) {
  const u = data.user || {}
  const userId = u.userId || u.id || u.uid || null
  return {
    userId,
    uid: userId,
    email: u.email || null,
    name: u.name || null,
    phone: u.phone || null,
    picture: null,
    emailVerified: Boolean(u.emailVerified),
    provider: u.provider || 'local',
    tenantId: u.tenantId || null,
    subscription: data.subscription || u.subscription || null,
  }
}

export async function getAccessToken() {
  return readStored(ACCESS_KEY)
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => readStoredUser())
  const [loading, setLoading] = useState(true)
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState('')
  const refreshTimerRef = useRef(null)
  const refreshAccessTokenRef = useRef(null)

  const clearSession = useCallback(() => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = null
    }
    persistSession({ accessToken: null, refreshToken: null, user: null })
    setUser(null)
  }, [])

  const applySession = useCallback((accessToken, refreshToken, nextUser) => {
    persistSession({
      accessToken,
      refreshToken,
      user: nextUser,
    })
    setUser(nextUser)
  }, [])

  const scheduleRefresh = useCallback((expiresInSeconds) => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
    const ms = Math.max(
      30_000,
      (Number(expiresInSeconds) || 900) * 1000 - 60_000,
    )
    refreshTimerRef.current = setTimeout(() => {
      void refreshAccessTokenRef.current?.().catch(() => undefined)
    }, ms)
  }, [])

  const refreshAccessToken = useCallback(async () => {
    const refreshToken = readStored(REFRESH_KEY)
    if (!refreshToken) {
      clearSession()
      return null
    }

    const res = await fetch(apiUrl('/api/auth/refresh'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
    })

    if (!res.ok) {
      clearSession()
      return null
    }

    const data = await res.json()
    if (!data.accessToken || !data.refreshToken) {
      clearSession()
      return null
    }

    const nextUser = mapUserPayload(data)
    applySession(data.accessToken, data.refreshToken, nextUser)
    scheduleRefresh(data.expiresIn)
    return nextUser
  }, [applySession, clearSession, scheduleRefresh])

  refreshAccessTokenRef.current = refreshAccessToken

  const refreshProfile = useCallback(async () => {
    let token = readStored(ACCESS_KEY)
    if (!token && readStored(REFRESH_KEY)) {
      const refreshed = await refreshAccessToken()
      if (!refreshed) return null
      token = readStored(ACCESS_KEY)
    }
    if (!token) {
      setUser(null)
      return null
    }

    let res = await fetch(apiUrl('/api/auth/me'), {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })

    if (res.status === 401) {
      const refreshed = await refreshAccessToken()
      if (!refreshed) return null
      token = readStored(ACCESS_KEY)
      res = await fetch(apiUrl('/api/auth/me'), {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
    }

    if (!res.ok) {
      clearSession()
      return null
    }

    const data = await res.json()
    const nextUser = mapUserPayload(data)
    applySession(token, readStored(REFRESH_KEY), nextUser)
    return nextUser
  }, [applySession, clearSession, refreshAccessToken])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        if (readStored(ACCESS_KEY) || readStored(REFRESH_KEY)) {
          await refreshProfile()
        }
      } catch {
        if (!cancelled) clearSession()
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
    }
  }, [refreshProfile, clearSession])

  async function authRequest(path, body) {
    setSigningIn(true)
    setError('')
    try {
      const ids = getTrackingIds()
      let res
      try {
        res = await fetch(apiUrl(path), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...body,
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
              ? 'Auth service is updating. Please try again in a minute.'
              : `Could not continue (${res.status}). Please try again.`),
        )
      }

      const userId = data.user?.userId || data.user?.uid || data.user?.id
      if (!data.accessToken || !data.refreshToken || !userId) {
        throw new Error('Auth response was incomplete. Please try again.')
      }

      const nextUser = mapUserPayload(data)
      applySession(data.accessToken, data.refreshToken, nextUser)
      scheduleRefresh(data.expiresIn)
      return nextUser
    } catch (err) {
      const message = err.message || 'Authentication failed.'
      setError(message)
      throw err
    } finally {
      setSigningIn(false)
    }
  }

  async function register({ name, email, password, phone }) {
    return authRequest('/api/auth/register', { name, email, password, phone })
  }

  async function login({ email, password }) {
    return authRequest('/api/auth/login', { email, password })
  }

  async function signOut() {
    try {
      const token = readStored(ACCESS_KEY)
      const refreshToken = readStored(REFRESH_KEY)
      const ids = getTrackingIds()
      if (token || refreshToken) {
        void fetch(apiUrl('/api/auth/logout'), {
          method: 'POST',
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            refreshToken,
            sessionId: ids.sessionId,
          }),
          keepalive: true,
        }).catch(() => null)
      }
    } finally {
      clearSession()
      setError('')
    }
  }

  const value = useMemo(
    () => ({
      user,
      loading,
      signingIn,
      error,
      register,
      login,
      signOut,
      refreshProfile,
      refreshAccessToken,
      isConfigured: true,
    }),
    [user, loading, signingIn, error, refreshProfile, refreshAccessToken],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
