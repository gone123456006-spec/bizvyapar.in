import { useCallback, useEffect, useState } from 'react'
import {
  adminFetch,
  clearAdminToken,
  getAdminToken,
  setAdminToken,
} from './tredsdash/adminApi.js'
import {
  OverviewSection,
  RegisteredUsersSection,
  ReportsSection,
  SettingsSection,
  UserDetailSection,
  VisitorsSection,
} from './tredsdash/sections.jsx'
import './TredsDash.css'

const NAV = [
  { id: 'overview', label: 'Overview', group: 'Dashboard' },
  { id: 'users', label: 'Registered Users', group: 'Users' },
  { id: 'active-users', label: 'Active Users', group: 'Users' },
  { id: 'visitors', label: 'Visitor Overview', group: 'Visitors' },
  { id: 'reports', label: 'Exports', group: 'Reports' },
  { id: 'settings', label: 'Settings', group: 'Settings' },
]

const BOTTOM = [
  { id: 'overview', label: 'Home' },
  { id: 'users', label: 'Users' },
  { id: 'visitors', label: 'Visitors' },
  { id: 'reports', label: 'Reports' },
  { id: 'settings', label: 'Settings' },
]

export default function TredsDash() {
  const [token, setToken] = useState(() => getAdminToken())
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [booting, setBooting] = useState(Boolean(token))
  const [navOpen, setNavOpen] = useState(false)
  const [section, setSection] = useState('overview')
  const [selectedUserId, setSelectedUserId] = useState(null)

  const logout = useCallback(() => {
    clearAdminToken()
    setToken('')
    setAuthError('')
    setSelectedUserId(null)
  }, [])

  const onAuthError = useCallback(() => {
    logout()
    setAuthError('Session expired. Sign in again.')
  }, [logout])

  useEffect(() => {
    if (!token) {
      setBooting(false)
      return
    }
    void (async () => {
      try {
        await adminFetch('/api/admin/session', { token })
        setBooting(false)
      } catch {
        logout()
        setBooting(false)
      }
    })()
  }, [token, logout])

  async function handleLogin(event) {
    event.preventDefault()
    setAuthError('')
    try {
      const data = await adminFetch('/api/admin/login', {
        method: 'POST',
        body: { password },
      })
      setAdminToken(data.token)
      setToken(data.token)
      setPassword('')
    } catch (error) {
      setAuthError(error.message || 'Login failed.')
    }
  }

  function go(id) {
    setSection(id)
    setSelectedUserId(null)
    setNavOpen(false)
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
            Manage users, visitors, analytics, webinar link, and subscription price.
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
    <div className={`td-app ${navOpen ? 'td-app--nav-open' : ''}`}>
      <aside className="td-sidebar" aria-label="TredsDash navigation">
        <div className="td-sidebar-brand">
          <p className="td-kicker">BizVyapar</p>
          <h1>TredsDash</h1>
        </div>
        <nav className="td-nav">
          {NAV.map((item, index) => {
            const prev = NAV[index - 1]
            const showGroup = !prev || prev.group !== item.group
            return (
              <div key={item.id}>
                {showGroup ? <p className="td-nav-group">{item.group}</p> : null}
                <button
                  type="button"
                  className={`td-nav-item ${section === item.id ? 'is-active' : ''}`}
                  onClick={() => go(item.id)}
                >
                  {item.label}
                </button>
              </div>
            )
          })}
        </nav>
        <div className="td-sidebar-foot">
          <a className="td-link" href="/">
            View website
          </a>
          <button type="button" className="td-btn td-btn--ghost" onClick={logout}>
            Sign out
          </button>
        </div>
      </aside>

      {navOpen ? (
        <button
          type="button"
          className="td-backdrop"
          aria-label="Close menu"
          onClick={() => setNavOpen(false)}
        />
      ) : null}

      <div className="td-main">
        <header className="td-mobile-bar">
          <button
            type="button"
            className="td-icon-btn"
            aria-label="Open menu"
            onClick={() => setNavOpen(true)}
          >
            ☰
          </button>
          <strong>TredsDash</strong>
          <button type="button" className="td-icon-btn" onClick={logout} aria-label="Sign out">
            ⎋
          </button>
        </header>

        <main className="td-content">
          {selectedUserId ? (
            <UserDetailSection
              token={token}
              tenantId={selectedUserId}
              onBack={() => setSelectedUserId(null)}
              onAuthError={onAuthError}
            />
          ) : null}

          {!selectedUserId && section === 'overview' ? (
            <OverviewSection token={token} onAuthError={onAuthError} />
          ) : null}

          {!selectedUserId && (section === 'users' || section === 'active-users') ? (
            <RegisteredUsersSection
              token={token}
              onAuthError={onAuthError}
              onOpenUser={setSelectedUserId}
              initialStatus={section === 'active-users' ? 'active' : 'all'}
            />
          ) : null}

          {!selectedUserId && section === 'visitors' ? (
            <VisitorsSection token={token} onAuthError={onAuthError} />
          ) : null}

          {!selectedUserId && section === 'reports' ? (
            <ReportsSection token={token} onAuthError={onAuthError} />
          ) : null}

          {!selectedUserId && section === 'settings' ? (
            <SettingsSection token={token} onAuthError={onAuthError} />
          ) : null}
        </main>
      </div>

      <nav className="td-bottom-nav" aria-label="Mobile navigation">
        {BOTTOM.map((item) => (
          <button
            key={item.id}
            type="button"
            className={section === item.id ? 'is-active' : ''}
            onClick={() => go(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
    </div>
  )
}
