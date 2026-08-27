import { useCallback, useEffect, useState } from 'react'
import { adminFetch, downloadUsersExport, formatAmount, formatDate } from './adminApi.js'
import { Pagination, SparkBars, StatCards } from './ui.jsx'

export function OverviewSection({ token, onAuthError }) {
  const [overview, setOverview] = useState(null)
  const [charts, setCharts] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const [ov, ch] = await Promise.all([
        adminFetch('/api/admin/overview', { token }),
        adminFetch('/api/admin/analytics/charts', { token }),
      ])
      setOverview(ov.overview)
      setCharts(ch.charts)
      setError('')
    } catch (err) {
      if (err.status === 401) onAuthError?.()
      else setError(err.message || 'Failed to load overview')
    }
  }, [token, onAuthError])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 20_000)
    return () => window.clearInterval(timer)
  }, [load])

  const cards = [
    { label: 'Total Registered Users', value: overview?.totalRegisteredUsers ?? '—' },
    { label: 'Active Users', value: overview?.activeUsers ?? '—', hint: 'Last 72 hours' },
    { label: 'New Users Today', value: overview?.newUsersToday ?? '—' },
    { label: 'Website Visitors Today', value: overview?.visitorsToday ?? '—' },
    { label: 'Visitors This Week', value: overview?.visitorsThisWeek ?? '—' },
    { label: 'Visitors This Month', value: overview?.visitorsThisMonth ?? '—' },
    {
      label: 'Visitor → User Conversion',
      value: overview ? `${overview.conversionRate}%` : '—',
      hint: 'This month',
    },
  ]

  return (
    <div className="td-section">
      <div className="td-section-head">
        <div>
          <h2>Overview</h2>
          <p className="td-muted">Live summary — auto-refreshes every 20 seconds.</p>
        </div>
        <button type="button" className="td-btn td-btn--ghost" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      {error ? <p className="td-error">{error}</p> : null}
      {overview?.postgresRequired ? (
        <p className="td-error">Postgres is required for analytics. Set DATABASE_URL on the API.</p>
      ) : null}
      <StatCards items={cards} />
      <div className="td-grid-2">
        <div className="td-card">
          <h3>Visitors over time</h3>
          <SparkBars
            series={charts?.visitorsOverTime || []}
            keys={['uniqueVisitors', 'sessions']}
            labels={{ uniqueVisitors: 'Unique', sessions: 'Sessions' }}
          />
        </div>
        <div className="td-card">
          <h3>Registered users over time</h3>
          <SparkBars
            series={charts?.registeredUsersOverTime || []}
            keys={['newUsers']}
            labels={{ newUsers: 'New users' }}
          />
        </div>
        <div className="td-card">
          <h3>Visitor → registration conversion</h3>
          <SparkBars
            series={charts?.conversionOverTime || []}
            keys={['rate']}
            labels={{ rate: 'Conversion %' }}
          />
        </div>
        <div className="td-card">
          <h3>New vs returning visitors</h3>
          <SparkBars
            series={charts?.newVsReturning || []}
            keys={['newVisitors', 'returningVisitors']}
            labels={{ newVisitors: 'New', returningVisitors: 'Returning' }}
          />
        </div>
      </div>
    </div>
  )
}

export function RegisteredUsersSection({
  token,
  onAuthError,
  onOpenUser,
  initialStatus = 'all',
  title = 'Registered Users',
  subtitle = null,
}) {
  const [data, setData] = useState({ users: [], page: 1, totalPages: 1, total: 0 })
  const [q, setQ] = useState('')
  const [status, setStatus] = useState(initialStatus)
  const [sort, setSort] = useState(initialStatus === 'subscribed' ? 'paid' : 'newest')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setStatus(initialStatus)
    setSort(initialStatus === 'subscribed' ? 'paid' : 'newest')
    setPage(1)
  }, [initialStatus])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        q,
        status,
        sort,
        page: String(page),
        pageSize: '20',
      })
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      const res = await adminFetch(`/api/admin/registered-users?${params}`, { token })
      setData(res)
      setError('')
    } catch (err) {
      if (err.status === 401) onAuthError?.()
      else setError(err.message || 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }, [token, q, status, sort, from, to, page, onAuthError])

  useEffect(() => {
    void load()
  }, [load])

  const showPayments = initialStatus === 'subscribed' || status === 'subscribed'

  return (
    <div className="td-section">
      <div className="td-section-head">
        <div>
          <h2>{title}</h2>
          <p className="td-muted">
            {subtitle || `${data.total || 0} signed-in accounts`}
          </p>
        </div>
        <button type="button" className="td-btn td-btn--ghost" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      <div className="td-filters">
        <input
          className="td-input"
          type="search"
          placeholder="Search name, email, phone…"
          value={q}
          onChange={(e) => {
            setPage(1)
            setQ(e.target.value)
          }}
        />
        {initialStatus !== 'subscribed' ? (
          <select
            className="td-input"
            value={status}
            onChange={(e) => {
              setPage(1)
              setStatus(e.target.value)
            }}
          >
            <option value="all">All activity</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="subscribed">Subscribed / Paid</option>
          </select>
        ) : null}
        <select
          className="td-input"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="last_login">Last login</option>
          <option value="paid">Latest payment</option>
        </select>
        <input
          className="td-input"
          type="date"
          value={from}
          onChange={(e) => {
            setPage(1)
            setFrom(e.target.value)
          }}
        />
        <input
          className="td-input"
          type="date"
          value={to}
          onChange={(e) => {
            setPage(1)
            setTo(e.target.value)
          }}
        />
      </div>

      {error ? <p className="td-error">{error}</p> : null}

      <div className="td-card-list">
        {loading && !data.users?.length ? <p className="td-muted">Loading…</p> : null}
        {!loading && !data.users?.length ? <p className="td-muted">No users found.</p> : null}
        {(data.users || []).map((user) => (
          <button
            type="button"
            className="td-user-card"
            key={user.tenantId}
            onClick={() => onOpenUser?.(user.tenantId)}
          >
            <div>
              <strong>{user.name || '—'}</strong>
              <span>{user.email || '—'}</span>
              <span>{user.phone || 'No phone'}</span>
              <span
                className={
                  user.subscriptionStatus === 'active'
                    ? 'td-badge td-badge--active'
                    : 'td-badge'
                }
              >
                {user.subscriptionStatus === 'active'
                  ? `Subscription: Active${user.subscriptionType ? ` (${user.subscriptionType})` : ''}`
                  : 'No active subscription'}
              </span>
            </div>
            <div>
              <span
                className={
                  user.activityStatus === 'active' ? 'td-badge td-badge--active' : 'td-badge'
                }
              >
                {user.activityStatus}
              </span>
              {showPayments || user.payment ? (
                <div className="td-payment-block">
                  <strong>{formatAmount(user.payment?.amount)}</strong>
                  <span className="td-meta">
                    Paid {formatDate(user.payment?.paidAt || user.subscriptionActivatedAt)}
                  </span>
                  <span className="td-mono">{user.payment?.paymentId || 'No payment id'}</span>
                  {user.payment?.orderId ? (
                    <span className="td-meta">Order {user.payment.orderId}</span>
                  ) : null}
                  <span className="td-meta">
                    {user.paymentCount || 0} payment{(user.paymentCount || 0) === 1 ? '' : 's'}
                  </span>
                </div>
              ) : (
                <>
                  <span className="td-meta">Joined {formatDate(user.createdAt)}</span>
                  <span className="td-meta">Last login {formatDate(user.lastLoginAt)}</span>
                  <span className="td-meta">
                    {user.loginCount || 0} logins · {user.lastDevice || '—'} /{' '}
                    {user.lastBrowser || '—'}
                  </span>
                </>
              )}
            </div>
          </button>
        ))}
      </div>

      <Pagination page={data.page || page} totalPages={data.totalPages || 1} onChange={setPage} />
    </div>
  )
}

export function UserDetailSection({ token, tenantId, onBack, onAuthError }) {
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    void (async () => {
      try {
        const res = await adminFetch(`/api/admin/registered-users/${tenantId}`, { token })
        setDetail(res.user)
      } catch (err) {
        if (err.status === 401) onAuthError?.()
        else setError(err.message || 'Failed to load user')
      }
    })()
  }, [token, tenantId, onAuthError])

  if (error) {
    return (
      <div className="td-section">
        <button type="button" className="td-btn td-btn--ghost" onClick={onBack}>
          Back
        </button>
        <p className="td-error">{error}</p>
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="td-section">
        <p className="td-muted">Loading user…</p>
      </div>
    )
  }

  const u = detail.user
  return (
    <div className="td-section">
      <div className="td-section-head">
        <div>
          <button type="button" className="td-btn td-btn--ghost" onClick={onBack}>
            ← Back
          </button>
          <h2>{u.name || 'User details'}</h2>
          <p className="td-muted">{u.email}</p>
        </div>
      </div>
      <div className="td-grid-2">
        <div className="td-card">
          <h3>Profile</h3>
          <dl className="td-dl">
            <div><dt>Phone</dt><dd>{u.phone || '—'}</dd></div>
            <div><dt>Status</dt><dd>{u.status || '—'}</dd></div>
            <div><dt>Activity</dt><dd>{u.activityStatus}</dd></div>
            <div><dt>Registered</dt><dd>{formatDate(u.createdAt)}</dd></div>
            <div><dt>Last login</dt><dd>{formatDate(u.lastLoginAt)}</dd></div>
            <div><dt>Logins</dt><dd>{u.loginCount || 0}</dd></div>
            <div><dt>Device</dt><dd>{u.lastDevice || '—'}</dd></div>
            <div><dt>Browser</dt><dd>{u.lastBrowser || '—'}</dd></div>
            <div>
              <dt>Subscription</dt>
              <dd>
                {u.subscriptionStatus || 'none'}
                {u.subscriptionType ? ` / ${u.subscriptionType}` : ''}
              </dd>
            </div>
            <div>
              <dt>Activated</dt>
              <dd>{formatDate(u.subscriptionActivatedAt)}</dd>
            </div>
          </dl>
        </div>
        <div className="td-card">
          <h3>Payment details</h3>
          <div className="td-card-list td-card-list--compact">
            {(detail.payments || []).map((p) => (
              <div className="td-mini-row" key={p.paymentId}>
                <strong>{formatAmount(p.amount)}</strong>
                <span className="td-badge td-badge--active">{p.status || 'paid'}</span>
                <span className="td-mono">{p.paymentId}</span>
                {p.orderId ? <span className="td-meta">Order {p.orderId}</span> : null}
                <span className="td-meta">Paid {formatDate(p.paidAt)}</span>
              </div>
            ))}
            {!detail.payments?.length ? (
              <p className="td-muted">No payments on this account.</p>
            ) : null}
          </div>
        </div>
        <div className="td-card">
          <h3>Sessions</h3>
          <div className="td-card-list td-card-list--compact">
            {(detail.sessions || []).map((s) => (
              <div className="td-mini-row" key={s.sessionId}>
                <strong>{formatDate(s.startedAt)}</strong>
                <span>{s.device || '—'} / {s.browser || '—'}</span>
                <span className="td-meta">{s.path || '/'}</span>
              </div>
            ))}
            {!detail.sessions?.length ? <p className="td-muted">No sessions yet.</p> : null}
          </div>
        </div>
      </div>
    </div>
  )
}

export function VisitorsSection({ token, onAuthError }) {
  const [period, setPeriod] = useState('today')
  const [stats, setStats] = useState(null)
  const [visitors, setVisitors] = useState({ visitors: [], page: 1, totalPages: 1 })
  const [sessions, setSessions] = useState({ sessions: [], page: 1, totalPages: 1 })
  const [tab, setTab] = useState('overview')
  const [page, setPage] = useState(1)

  const load = useCallback(async () => {
    try {
      const [st, vis, sess] = await Promise.all([
        adminFetch(`/api/admin/analytics/visitors?period=${period}`, { token }),
        adminFetch(`/api/admin/visitors?page=${page}&pageSize=20`, { token }),
        adminFetch(`/api/admin/visitor-sessions?page=${page}&pageSize=20`, { token }),
      ])
      setStats(st)
      setVisitors(vis)
      setSessions(sess)
    } catch (err) {
      if (err.status === 401) onAuthError?.()
    }
  }, [token, period, page, onAuthError])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 25_000)
    return () => window.clearInterval(timer)
  }, [load])

  return (
    <div className="td-section">
      <div className="td-section-head">
        <div>
          <h2>Visitors</h2>
          <p className="td-muted">Anonymous website visitors (not signed in).</p>
        </div>
        <div className="td-segment">
          {['today', 'week', 'month'].map((p) => (
            <button
              key={p}
              type="button"
              className={period === p ? 'is-active' : ''}
              onClick={() => setPeriod(p)}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <StatCards
        items={[
          { label: 'Unique visitors', value: stats?.uniqueVisitors ?? '—' },
          { label: 'Sessions', value: stats?.sessions ?? '—' },
          { label: 'Page views', value: stats?.pageViews ?? '—' },
          { label: 'New visitors', value: stats?.newVisitors ?? '—' },
          { label: 'Returning', value: stats?.returningVisitors ?? '—' },
        ]}
      />

      <div className="td-card">
        <h3>Visitor activity</h3>
        <SparkBars
          series={stats?.series || []}
          keys={['uniqueVisitors', 'sessions', 'pageViews']}
          labels={{
            uniqueVisitors: 'Unique',
            sessions: 'Sessions',
            pageViews: 'Page views',
          }}
        />
      </div>

      <div className="td-segment td-segment--block">
        <button type="button" className={tab === 'overview' ? 'is-active' : ''} onClick={() => setTab('overview')}>
          Visitors
        </button>
        <button type="button" className={tab === 'sessions' ? 'is-active' : ''} onClick={() => setTab('sessions')}>
          Sessions
        </button>
      </div>

      {tab === 'overview' ? (
        <div className="td-card-list">
          {(visitors.visitors || []).map((v) => (
            <div className="td-user-card td-user-card--static" key={v.visitorId}>
              <div>
                <strong className="td-mono">{v.visitorId.slice(0, 18)}…</strong>
                <span>{v.isReturning ? 'Returning' : 'New'} visitor</span>
              </div>
              <div>
                <span className="td-meta">First {formatDate(v.firstSeenAt)}</span>
                <span className="td-meta">Last {formatDate(v.lastSeenAt)}</span>
                <span className="td-meta">
                  {v.sessionCount} sessions · {v.pageViewCount} views
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="td-card-list">
          {(sessions.sessions || []).map((s) => (
            <div className="td-user-card td-user-card--static" key={s.sessionId}>
              <div>
                <strong>{s.landingPath || '/'}</strong>
                <span>{s.device || '—'} / {s.browser || '—'}</span>
              </div>
              <div>
                <span className="td-meta">{formatDate(s.startedAt)}</span>
                <span className="td-meta">{s.pageCount} pages · {s.engaged ? 'Engaged' : 'Browse'}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <Pagination
        page={tab === 'overview' ? visitors.page || page : sessions.page || page}
        totalPages={tab === 'overview' ? visitors.totalPages || 1 : sessions.totalPages || 1}
        onChange={setPage}
      />
    </div>
  )
}

export function ReportsSection({ token, onAuthError }) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState('')

  async function runExport(preset) {
    setBusy(preset)
    setMessage('')
    try {
      await downloadUsersExport(token, {
        preset,
        from: preset === 'custom' ? from : undefined,
        to: preset === 'custom' ? to : undefined,
      })
      setMessage('Excel download started.')
    } catch (err) {
      if (err.status === 401) onAuthError?.()
      else setMessage(err.message || 'Export failed')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="td-section">
      <div className="td-section-head">
        <div>
          <h2>Reports</h2>
          <p className="td-muted">Export registered users to Excel (.xlsx).</p>
        </div>
      </div>

      <div className="td-export-grid">
        <button type="button" className="td-btn td-btn--primary" disabled={!!busy} onClick={() => void runExport('today')}>
          {busy === 'today' ? 'Exporting…' : 'Export Today'}
        </button>
        <button type="button" className="td-btn td-btn--primary" disabled={!!busy} onClick={() => void runExport('week')}>
          {busy === 'week' ? 'Exporting…' : 'Export This Week'}
        </button>
        <button type="button" className="td-btn td-btn--primary" disabled={!!busy} onClick={() => void runExport('month')}>
          {busy === 'month' ? 'Exporting…' : 'Export This Month'}
        </button>
      </div>

      <div className="td-card">
        <h3>Custom Export</h3>
        <div className="td-filters">
          <input className="td-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <input className="td-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <button
            type="button"
            className="td-btn td-btn--ghost"
            disabled={!!busy || !from || !to}
            onClick={() => void runExport('custom')}
          >
            {busy === 'custom' ? 'Exporting…' : 'Custom Export'}
          </button>
        </div>
        {message ? <p className="td-success">{message}</p> : null}
      </div>
    </div>
  )
}

export function SettingsSection({ token, onAuthError }) {
  const [webinarLink, setWebinarLink] = useState('')
  const [amountRupees, setAmountRupees] = useState('1')
  const [meta, setMeta] = useState(null)
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const res = await adminFetch('/api/admin/settings', { token })
        setWebinarLink(res.settings?.webinarLink || '')
        setAmountRupees(String(res.settings?.amountRupees ?? 1))
        setMeta(res.settings || null)
      } catch (err) {
        if (err.status === 401) onAuthError?.()
      }
    })()
  }, [token, onAuthError])

  async function onSave(event) {
    event.preventDefault()
    setSaving(true)
    setMessage('')
    try {
      const res = await adminFetch('/api/admin/settings', {
        token,
        method: 'PUT',
        body: { webinarLink, amountRupees: Number(amountRupees) },
      })
      setMeta(res.settings)
      setMessage(res.message || 'Saved.')
    } catch (err) {
      if (err.status === 401) onAuthError?.()
      else setMessage(err.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="td-section">
      <div className="td-section-head">
        <div>
          <h2>Settings</h2>
          <p className="td-muted">Webinar link and subscription price update the live site in seconds.</p>
        </div>
      </div>
      <form className="td-card" onSubmit={onSave}>
        <label className="td-label" htmlFor="td-webinar">Webinar link</label>
        <input
          id="td-webinar"
          className="td-input"
          type="url"
          value={webinarLink}
          onChange={(e) => setWebinarLink(e.target.value)}
          placeholder="https://meet.google.com/..."
        />
        <label className="td-label" htmlFor="td-price">Subscription price (₹)</label>
        <input
          id="td-price"
          className="td-input"
          type="number"
          min="1"
          step="0.01"
          value={amountRupees}
          onChange={(e) => setAmountRupees(e.target.value)}
          required
        />
        {meta?.updatedAt ? <p className="td-meta">Last updated {formatDate(meta.updatedAt)}</p> : null}
        {message ? <p className="td-success">{message}</p> : null}
        <button className="td-btn td-btn--primary" type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      </form>
    </div>
  )
}
