import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiUrl } from '../lib/api.js'
import './TredsDash.css'

const TOKEN_KEY = 'tredsdash_token'

function formatDate(value) {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return '—'
  }
}

function formatAmount(paise) {
  const value = Number(paise) / 100
  if (!Number.isFinite(value)) return '—'
  if (Number.isInteger(value)) return `₹${value}`
  return `₹${value.toFixed(2)}`
}

async function adminFetch(path, { token, method = 'GET', body } = {}) {
  const headers = {
    Accept: 'application/json',
  }
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const res = await fetch(apiUrl(path), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const error = new Error(data.message || 'Request failed')
    error.status = res.status
    throw error
  }
  return data
}

export default function TredsDash() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || '')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [booting, setBooting] = useState(Boolean(token))
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [saving, setSaving] = useState(false)
  const [users, setUsers] = useState([])
  const [query, setQuery] = useState('')
  const [message, setMessage] = useState('')
  const [webinarLink, setWebinarLink] = useState('')
  const [amountRupees, setAmountRupees] = useState('1')
  const [settingsMeta, setSettingsMeta] = useState(null)

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
    setToken('')
    setUsers([])
    setMessage('')
    setAuthError('')
  }, [])

  const loadDashboard = useCallback(
    async (activeToken) => {
      setLoadingUsers(true)
      setMessage('')
      try {
        const [usersRes, settingsRes] = await Promise.all([
          adminFetch('/api/admin/users', { token: activeToken }),
          adminFetch('/api/admin/settings', { token: activeToken }),
        ])
        setUsers(Array.isArray(usersRes.users) ? usersRes.users : [])
        setWebinarLink(settingsRes.settings?.webinarLink || '')
        setAmountRupees(String(settingsRes.settings?.amountRupees ?? 1))
        setSettingsMeta(settingsRes.settings || null)
      } catch (error) {
        if (error.status === 401) {
          logout()
          setAuthError('Session expired. Sign in again.')
          return
        }
        setMessage(error.message || 'Failed to load dashboard.')
      } finally {
        setLoadingUsers(false)
        setBooting(false)
      }
    },
    [logout],
  )

  useEffect(() => {
    if (!token) {
      setBooting(false)
      return
    }
    void (async () => {
      try {
        await adminFetch('/api/admin/session', { token })
        await loadDashboard(token)
      } catch {
        logout()
        setBooting(false)
      }
    })()
  }, [token, loadDashboard, logout])

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return users
    return users.filter((row) => {
      const hay = [
        row.user?.name,
        row.user?.email,
        row.user?.phone,
        row.payment?.paymentId,
        row.subscription?.status,
        row.subscription?.type,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [users, query])

  const stats = useMemo(() => {
    const active = users.filter((row) => row.subscription?.status === 'active').length
    const paid = users.filter((row) => row.payment).length
    return { total: users.length, active, paid }
  }, [users])

  async function handleLogin(event) {
    event.preventDefault()
    setAuthError('')
    try {
      const data = await adminFetch('/api/admin/login', {
        method: 'POST',
        body: { password },
      })
      localStorage.setItem(TOKEN_KEY, data.token)
      setToken(data.token)
      setPassword('')
    } catch (error) {
      setAuthError(error.message || 'Login failed.')
    }
  }

  async function handleSaveSettings(event) {
    event.preventDefault()
    setSaving(true)
    setMessage('')
    try {
      const data = await adminFetch('/api/admin/settings', {
        token,
        method: 'PUT',
        body: {
          webinarLink,
          amountRupees: Number(amountRupees),
        },
      })
      setSettingsMeta(data.settings || null)
      setMessage(data.message || 'Settings saved.')
      setWebinarLink(data.settings?.webinarLink || webinarLink)
      setAmountRupees(String(data.settings?.amountRupees ?? amountRupees))
    } catch (error) {
      if (error.status === 401) {
        logout()
        setAuthError('Session expired. Sign in again.')
      } else {
        setMessage(error.message || 'Could not save settings.')
      }
    } finally {
      setSaving(false)
    }
  }

  if (booting) {
    return (
      <div className="td-shell">
        <div className="td-card td-login-card">
          <p className="td-muted">Loading TredsDash…</p>
        </div>
      </div>
    )
  }

  if (!token) {
    return (
      <div className="td-shell td-shell--login">
        <form className="td-card td-login-card" onSubmit={handleLogin}>
          <p className="td-kicker">BizVyapar Admin</p>
          <h1>TredsDash</h1>
          <p className="td-muted">
            Sign in to manage users, payments, subscription status, webinar link,
            and price.
          </p>
          <label className="td-label" htmlFor="td-password">
            Password
          </label>
          <input
            id="td-password"
            className="td-input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          {authError ? (
            <p className="td-error" role="alert">
              {authError}
            </p>
          ) : null}
          <button className="td-btn td-btn--primary" type="submit">
            Enter TredsDash
          </button>
        </form>
      </div>
    )
  }

  return (
    <div className="td-shell">
      <header className="td-top">
        <div>
          <p className="td-kicker">BizVyapar</p>
          <h1>TredsDash</h1>
        </div>
        <div className="td-top-actions">
          <a className="td-link" href="/">
            View website
          </a>
          <button className="td-btn td-btn--ghost" type="button" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>

      <section className="td-stats">
        <article className="td-stat">
          <span>Users</span>
          <strong>{stats.total}</strong>
        </article>
        <article className="td-stat">
          <span>Active subscriptions</span>
          <strong>{stats.active}</strong>
        </article>
        <article className="td-stat">
          <span>Paid users</span>
          <strong>{stats.paid}</strong>
        </article>
      </section>

      <section className="td-grid">
        <form className="td-card" onSubmit={handleSaveSettings}>
          <div className="td-card-head">
            <h2>Live settings</h2>
            <p className="td-muted">
              Changes appear on the website within a few seconds.
            </p>
          </div>

          <label className="td-label" htmlFor="td-webinar">
            Webinar link
          </label>
          <input
            id="td-webinar"
            className="td-input"
            type="url"
            placeholder="https://meet.google.com/..."
            value={webinarLink}
            onChange={(event) => setWebinarLink(event.target.value)}
          />

          <label className="td-label" htmlFor="td-price">
            Subscription price (₹)
          </label>
          <input
            id="td-price"
            className="td-input"
            type="number"
            min="1"
            step="0.01"
            value={amountRupees}
            onChange={(event) => setAmountRupees(event.target.value)}
            required
          />

          {settingsMeta?.updatedAt ? (
            <p className="td-meta">Last updated {formatDate(settingsMeta.updatedAt)}</p>
          ) : (
            <p className="td-meta">Using server defaults until you save.</p>
          )}

          {message ? <p className="td-success">{message}</p> : null}

          <button className="td-btn td-btn--primary" type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        </form>

        <div className="td-card">
          <div className="td-card-head td-card-head--row">
            <div>
              <h2>Users, payments & subscriptions</h2>
              <p className="td-muted">Only operational details — no website redesign tools.</p>
            </div>
            <button
              className="td-btn td-btn--ghost"
              type="button"
              onClick={() => loadDashboard(token)}
              disabled={loadingUsers}
            >
              {loadingUsers ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          <input
            className="td-input"
            type="search"
            placeholder="Search name, email, phone, payment id…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />

          <div className="td-table-wrap">
            <table className="td-table">
              <thead>
                <tr>
                  <th>User details</th>
                  <th>Payment</th>
                  <th>Subscription</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="td-empty">
                      {loadingUsers ? 'Loading users…' : 'No users found.'}
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((row) => (
                    <tr key={row.tenantId || row.user?.email || row.user?.uid}>
                      <td>
                        <div className="td-user">
                          <strong>{row.user?.name || '—'}</strong>
                          <span>{row.user?.email || '—'}</span>
                          <span>{row.user?.phone || 'No phone'}</span>
                          <span className="td-meta">
                            Last login {formatDate(row.user?.lastLoginAt)}
                          </span>
                        </div>
                      </td>
                      <td>
                        {row.payment ? (
                          <div className="td-user">
                            <strong>{formatAmount(row.payment.amount)}</strong>
                            <span>{row.payment.status || 'paid'}</span>
                            <span className="td-mono">{row.payment.paymentId}</span>
                            <span className="td-meta">
                              Paid {formatDate(row.payment.paidAt)}
                            </span>
                          </div>
                        ) : (
                          <span className="td-muted">No payment</span>
                        )}
                      </td>
                      <td>
                        <div className="td-user">
                          <span
                            className={
                              row.subscription?.status === 'active'
                                ? 'td-badge td-badge--active'
                                : 'td-badge'
                            }
                          >
                            {row.subscription?.label || 'No active subscription'}
                          </span>
                          <span className="td-meta">
                            {row.subscription?.type
                              ? `${row.subscription.type} · activated ${formatDate(row.subscription.activatedAt)}`
                              : 'Not subscribed'}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  )
}
