/**
 * Visitor / session / page-view tracking + admin analytics queries.
 */

import { randomUUID } from 'node:crypto'
import { getPool, isPostgresEnabled } from './postgres.js'
import { ensureAnalyticsSchema } from './analyticsSchema.js'
import {
  endOfDay,
  hashIp,
  isActiveRecently,
  parseDateInput,
  parseUserAgent,
  startOfDay,
  startOfMonth,
  startOfWeek,
  toDateOnly,
} from '../analyticsUtils.js'

let schemaReady = false

async function dbReady() {
  if (!isPostgresEnabled()) return null
  if (!schemaReady) {
    await ensureAnalyticsSchema()
    schemaReady = true
  }
  return getPool()
}

function cleanPath(path) {
  const value = String(path || '/').trim() || '/'
  return value.slice(0, 500)
}

/**
 * Record anonymous visitor page view / engagement.
 * Dedupes rapid refreshes of same path within same session (30s).
 */
export async function trackVisitorEvent({
  visitorId,
  sessionId,
  path,
  title,
  referrer,
  engaged = false,
  userAgent,
  ip,
  tenantId = null,
}) {
  const db = await dbReady()
  if (!db) {
    return { ok: false, reason: 'postgres_required' }
  }

  const vid = String(visitorId || '').trim().slice(0, 64)
  const sid = String(sessionId || '').trim().slice(0, 64)
  if (!vid || !sid) {
    const error = new Error('visitorId and sessionId are required')
    error.status = 400
    throw error
  }

  const ua = parseUserAgent(userAgent)
  if (ua.isBot) {
    return { ok: true, ignored: 'bot' }
  }

  const pagePath = cleanPath(path)
  const ref = String(referrer || '').trim().slice(0, 500) || null
  const pageTitle = String(title || '').trim().slice(0, 300) || null
  const ipHash = hashIp(ip)
  const now = new Date().toISOString()

  const client = await db.connect()
  try {
    await client.query('BEGIN')

    const existingVisitor = await client.query(
      `SELECT visitor_id, visit_count, page_view_count, linked_tenant_id
       FROM visitors WHERE visitor_id = $1`,
      [vid],
    )

    let isNewVisitor = false
    if (!existingVisitor.rows[0]) {
      isNewVisitor = true
      await client.query(
        `INSERT INTO visitors (
           visitor_id, first_seen_at, last_seen_at, linked_tenant_id,
           visit_count, page_view_count, is_bot
         ) VALUES ($1, $2::timestamptz, $2::timestamptz, $3, 1, 0, FALSE)`,
        [vid, now, tenantId || null],
      )
    } else {
      await client.query(
        `UPDATE visitors
         SET last_seen_at = $2::timestamptz,
             linked_tenant_id = COALESCE($3, linked_tenant_id)
         WHERE visitor_id = $1`,
        [vid, now, tenantId || null],
      )
    }

    const sessionRow = await client.query(
      `SELECT id, page_count FROM visitor_sessions WHERE session_id = $1`,
      [sid],
    )

    let isNewSession = false
    if (!sessionRow.rows[0]) {
      isNewSession = true
      await client.query(
        `INSERT INTO visitor_sessions (
           id, session_id, visitor_id, started_at, last_seen_at,
           user_agent, device, browser, ip_hash, page_count, engaged,
           landing_path, referrer
         ) VALUES ($1,$2,$3,$4::timestamptz,$4::timestamptz,$5,$6,$7,$8,0,$9,$10,$11)`,
        [
          randomUUID(),
          sid,
          vid,
          now,
          ua.userAgent,
          ua.device,
          ua.browser,
          ipHash,
          Boolean(engaged),
          pagePath,
          ref,
        ],
      )
      if (!isNewVisitor) {
        await client.query(
          `UPDATE visitors SET visit_count = visit_count + 1 WHERE visitor_id = $1`,
          [vid],
        )
      }
    } else {
      await client.query(
        `UPDATE visitor_sessions
         SET last_seen_at = $2::timestamptz,
             engaged = engaged OR $3,
             user_agent = COALESCE($4, user_agent),
             device = COALESCE($5, device),
             browser = COALESCE($6, browser)
         WHERE session_id = $1`,
        [sid, now, Boolean(engaged), ua.userAgent, ua.device, ua.browser],
      )
    }

    // Dedupe identical path within 30 seconds for same session
    const recent = await client.query(
      `SELECT id FROM page_views
       WHERE session_id = $1 AND path = $2
         AND created_at > NOW() - INTERVAL '30 seconds'
       LIMIT 1`,
      [sid, pagePath],
    )

    let recordedView = false
    if (!recent.rows[0]) {
      recordedView = true
      await client.query(
        `INSERT INTO page_views (
           id, visitor_id, session_id, tenant_id, path, title, referrer, engaged, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz)`,
        [
          randomUUID(),
          vid,
          sid,
          tenantId || null,
          pagePath,
          pageTitle,
          ref,
          Boolean(engaged),
          now,
        ],
      )
      await client.query(
        `UPDATE visitor_sessions SET page_count = page_count + 1 WHERE session_id = $1`,
        [sid],
      )
      await client.query(
        `UPDATE visitors SET page_view_count = page_view_count + 1 WHERE visitor_id = $1`,
        [vid],
      )
    } else if (engaged) {
      await client.query(
        `UPDATE page_views SET engaged = TRUE
         WHERE session_id = $1 AND path = $2
           AND created_at > NOW() - INTERVAL '30 seconds'`,
        [sid, pagePath],
      )
      await client.query(
        `UPDATE visitor_sessions SET engaged = TRUE WHERE session_id = $1`,
        [sid],
      )
    }

    await client.query('COMMIT')
    return {
      ok: true,
      isNewVisitor,
      isNewSession,
      recordedView,
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

/**
 * Record authenticated user login/session.
 */
export async function recordUserLoginSession({
  tenantId,
  sessionId,
  userAgent,
  ip,
  path = '/',
}) {
  const db = await dbReady()
  if (!db || !tenantId) return { ok: false }

  const ua = parseUserAgent(userAgent)
  const sid = String(sessionId || randomUUID()).slice(0, 64)
  const ipHash = hashIp(ip)
  const now = new Date().toISOString()

  const insert = await db.query(
    `INSERT INTO user_sessions (
       id, tenant_id, session_id, started_at, last_seen_at,
       user_agent, device, browser, ip_hash, path
     ) VALUES ($1,$2,$3,$4::timestamptz,$4::timestamptz,$5,$6,$7,$8,$9)
     ON CONFLICT (tenant_id, session_id) DO UPDATE SET
       last_seen_at = EXCLUDED.last_seen_at,
       user_agent = COALESCE(EXCLUDED.user_agent, user_sessions.user_agent),
       device = COALESCE(EXCLUDED.device, user_sessions.device),
       browser = COALESCE(EXCLUDED.browser, user_sessions.browser),
       path = COALESCE(EXCLUDED.path, user_sessions.path)
     RETURNING (xmax = 0) AS inserted`,
    [
      randomUUID(),
      tenantId,
      sid,
      now,
      ua.userAgent,
      ua.device,
      ua.browser,
      ipHash,
      cleanPath(path),
    ],
  )

  const isNew = Boolean(insert.rows[0]?.inserted)
  if (isNew) {
    await db.query(
      `UPDATE profiles
       SET login_count = GREATEST(COALESCE(login_count, 0), 0) + 1,
           last_user_agent = $2,
           last_device = $3,
           last_browser = $4,
           activity_status = 'active',
           last_login_at = $5::timestamptz,
           updated_at = $5::timestamptz
       WHERE tenant_id = $1`,
      [tenantId, ua.userAgent, ua.device, ua.browser, now],
    )
  } else {
    await db.query(
      `UPDATE profiles
       SET last_user_agent = COALESCE($2, last_user_agent),
           last_device = COALESCE($3, last_device),
           last_browser = COALESCE($4, last_browser),
           activity_status = 'active',
           updated_at = $5::timestamptz
       WHERE tenant_id = $1`,
      [tenantId, ua.userAgent, ua.device, ua.browser, now],
    )
  }

  return { ok: true, sessionId: sid, isNew }
}

export async function endUserSession({ tenantId, sessionId }) {
  const db = await dbReady()
  if (!db || !tenantId || !sessionId) return { ok: false }

  await db.query(
    `UPDATE user_sessions
     SET ended_at = NOW(), last_seen_at = NOW()
     WHERE tenant_id = $1 AND session_id = $2 AND ended_at IS NULL`,
    [tenantId, sessionId],
  )
  return { ok: true }
}

export async function linkVisitorToTenant(visitorId, tenantId) {
  const db = await dbReady()
  if (!db || !visitorId || !tenantId) return { ok: false }

  await db.query(
    `UPDATE visitors SET linked_tenant_id = $2, last_seen_at = NOW()
     WHERE visitor_id = $1`,
    [visitorId, tenantId],
  )
  await db.query(
    `UPDATE page_views SET tenant_id = COALESCE(tenant_id, $2)
     WHERE visitor_id = $1 AND tenant_id IS NULL`,
    [visitorId, tenantId],
  )
  return { ok: true }
}

async function countDistinctVisitors(db, from, to) {
  const result = await db.query(
    `SELECT COUNT(DISTINCT visitor_id)::int AS c
     FROM visitor_sessions
     WHERE started_at >= $1::timestamptz AND started_at <= $2::timestamptz`,
    [from.toISOString(), to.toISOString()],
  )
  return result.rows[0]?.c || 0
}

async function countSessions(db, from, to) {
  const result = await db.query(
    `SELECT COUNT(*)::int AS c
     FROM visitor_sessions
     WHERE started_at >= $1::timestamptz AND started_at <= $2::timestamptz`,
    [from.toISOString(), to.toISOString()],
  )
  return result.rows[0]?.c || 0
}

async function countPageViews(db, from, to) {
  const result = await db.query(
    `SELECT COUNT(*)::int AS c
     FROM page_views
     WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz`,
    [from.toISOString(), to.toISOString()],
  )
  return result.rows[0]?.c || 0
}

async function countNewVisitors(db, from, to) {
  const result = await db.query(
    `SELECT COUNT(*)::int AS c
     FROM visitors
     WHERE first_seen_at >= $1::timestamptz AND first_seen_at <= $2::timestamptz`,
    [from.toISOString(), to.toISOString()],
  )
  return result.rows[0]?.c || 0
}

async function countNewUsers(db, from, to) {
  const result = await db.query(
    `SELECT COUNT(*)::int AS c
     FROM profiles
     WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz`,
    [from.toISOString(), to.toISOString()],
  )
  return result.rows[0]?.c || 0
}

async function countActiveUsers(db, from, to) {
  const result = await db.query(
    `SELECT COUNT(*)::int AS c
     FROM profiles
     WHERE last_login_at >= $1::timestamptz AND last_login_at <= $2::timestamptz`,
    [from.toISOString(), to.toISOString()],
  )
  return result.rows[0]?.c || 0
}

async function countLogins(db, from, to) {
  const result = await db.query(
    `SELECT COUNT(*)::int AS c
     FROM user_sessions
     WHERE started_at >= $1::timestamptz AND started_at <= $2::timestamptz`,
    [from.toISOString(), to.toISOString()],
  )
  return result.rows[0]?.c || 0
}

async function countTotalUsers(db) {
  const result = await db.query(`SELECT COUNT(*)::int AS c FROM profiles`)
  return result.rows[0]?.c || 0
}

export async function getOverviewStats() {
  const db = await dbReady()
  if (!db) {
    return {
      totalRegisteredUsers: 0,
      activeUsers: 0,
      newUsersToday: 0,
      visitorsToday: 0,
      visitorsThisWeek: 0,
      visitorsThisMonth: 0,
      conversionRate: 0,
      sessionsToday: 0,
      pageViewsToday: 0,
      postgresRequired: true,
    }
  }

  const now = new Date()
  const todayStart = startOfDay(now)
  const todayEnd = endOfDay(now)
  const weekStart = startOfWeek(now)
  const monthStart = startOfMonth(now)

  const [
    totalRegisteredUsers,
    activeUsers,
    newUsersToday,
    visitorsToday,
    visitorsThisWeek,
    visitorsThisMonth,
    sessionsToday,
    pageViewsToday,
    newVisitorsToday,
  ] = await Promise.all([
    countTotalUsers(db),
    countActiveUsers(db, new Date(Date.now() - 72 * 3600_000), now),
    countNewUsers(db, todayStart, todayEnd),
    countDistinctVisitors(db, todayStart, todayEnd),
    countDistinctVisitors(db, weekStart, todayEnd),
    countDistinctVisitors(db, monthStart, todayEnd),
    countSessions(db, todayStart, todayEnd),
    countPageViews(db, todayStart, todayEnd),
    countNewVisitors(db, todayStart, todayEnd),
  ])

  const conversionRate =
    visitorsThisMonth > 0
      ? Number(((await countNewUsers(db, monthStart, todayEnd)) / visitorsThisMonth * 100).toFixed(2))
      : 0

  return {
    totalRegisteredUsers,
    activeUsers,
    newUsersToday,
    visitorsToday,
    visitorsThisWeek,
    visitorsThisMonth,
    conversionRate,
    sessionsToday,
    pageViewsToday,
    newVisitorsToday,
    returningVisitorsToday: Math.max(0, visitorsToday - newVisitorsToday),
    postgresRequired: false,
    generatedAt: now.toISOString(),
  }
}

export async function getVisitorPeriodStats(period = 'today') {
  const db = await dbReady()
  if (!db) {
    return { period, uniqueVisitors: 0, sessions: 0, pageViews: 0, newVisitors: 0, returningVisitors: 0, series: [] }
  }

  const now = new Date()
  let from = startOfDay(now)
  let to = endOfDay(now)
  let seriesDays = 1

  if (period === 'week') {
    from = startOfWeek(now)
    seriesDays = 7
  } else if (period === 'month') {
    from = startOfMonth(now)
    seriesDays = Math.ceil((to - from) / 86400000) + 1
  }

  const [uniqueVisitors, sessions, pageViews, newVisitors] = await Promise.all([
    countDistinctVisitors(db, from, to),
    countSessions(db, from, to),
    countPageViews(db, from, to),
    countNewVisitors(db, from, to),
  ])

  const seriesResult = await db.query(
    `SELECT DATE(started_at) AS day,
            COUNT(DISTINCT visitor_id)::int AS unique_visitors,
            COUNT(*)::int AS sessions
     FROM visitor_sessions
     WHERE started_at >= $1::timestamptz AND started_at <= $2::timestamptz
     GROUP BY DATE(started_at)
     ORDER BY day ASC`,
    [from.toISOString(), to.toISOString()],
  )

  const pageSeries = await db.query(
    `SELECT DATE(created_at) AS day, COUNT(*)::int AS page_views
     FROM page_views
     WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz
     GROUP BY DATE(created_at)
     ORDER BY day ASC`,
    [from.toISOString(), to.toISOString()],
  )

  const pageMap = Object.fromEntries(
    pageSeries.rows.map((r) => [toDateOnly(r.day), r.page_views]),
  )
  const visitMap = Object.fromEntries(
    seriesResult.rows.map((r) => [
      toDateOnly(r.day),
      { uniqueVisitors: r.unique_visitors, sessions: r.sessions },
    ]),
  )

  const series = []
  for (let i = 0; i < seriesDays; i += 1) {
    const d = new Date(from)
    d.setDate(from.getDate() + i)
    if (d > to) break
    const key = toDateOnly(d)
    series.push({
      day: key,
      uniqueVisitors: visitMap[key]?.uniqueVisitors || 0,
      sessions: visitMap[key]?.sessions || 0,
      pageViews: pageMap[key] || 0,
    })
  }

  return {
    period,
    from: from.toISOString(),
    to: to.toISOString(),
    uniqueVisitors,
    sessions,
    pageViews,
    newVisitors,
    returningVisitors: Math.max(0, uniqueVisitors - newVisitors),
    series,
  }
}

export async function getChartsData() {
  const db = await dbReady()
  if (!db) {
    return {
      visitorsOverTime: [],
      registeredUsersOverTime: [],
      conversionOverTime: [],
      newVsReturning: [],
    }
  }

  const from = startOfDay(new Date())
  from.setDate(from.getDate() - 29)
  const to = endOfDay(new Date())

  const visitors = await getVisitorPeriodStats('month')
  // Rebuild last 30 days explicitly
  const visitorSeries = await db.query(
    `SELECT DATE(started_at) AS day,
            COUNT(DISTINCT visitor_id)::int AS unique_visitors,
            COUNT(*)::int AS sessions
     FROM visitor_sessions
     WHERE started_at >= $1::timestamptz
     GROUP BY DATE(started_at)
     ORDER BY day ASC`,
    [from.toISOString()],
  )

  const usersSeries = await db.query(
    `SELECT DATE(created_at) AS day, COUNT(*)::int AS new_users
     FROM profiles
     WHERE created_at >= $1::timestamptz
     GROUP BY DATE(created_at)
     ORDER BY day ASC`,
    [from.toISOString()],
  )

  const newVisitorsSeries = await db.query(
    `SELECT DATE(first_seen_at) AS day, COUNT(*)::int AS new_visitors
     FROM visitors
     WHERE first_seen_at >= $1::timestamptz
     GROUP BY DATE(first_seen_at)
     ORDER BY day ASC`,
    [from.toISOString()],
  )

  const visitMap = Object.fromEntries(
    visitorSeries.rows.map((r) => [toDateOnly(r.day), r]),
  )
  const userMap = Object.fromEntries(
    usersSeries.rows.map((r) => [toDateOnly(r.day), r.new_users]),
  )
  const newMap = Object.fromEntries(
    newVisitorsSeries.rows.map((r) => [toDateOnly(r.day), r.new_visitors]),
  )

  const visitorsOverTime = []
  const registeredUsersOverTime = []
  const conversionOverTime = []
  const newVsReturning = []

  for (let i = 0; i < 30; i += 1) {
    const d = new Date(from)
    d.setDate(from.getDate() + i)
    const key = toDateOnly(d)
    const unique = visitMap[key]?.unique_visitors || 0
    const sessions = visitMap[key]?.sessions || 0
    const newUsers = userMap[key] || 0
    const newVisitors = newMap[key] || 0
    visitorsOverTime.push({ day: key, uniqueVisitors: unique, sessions })
    registeredUsersOverTime.push({ day: key, newUsers })
    conversionOverTime.push({
      day: key,
      rate: unique > 0 ? Number(((newUsers / unique) * 100).toFixed(2)) : 0,
      newUsers,
      uniqueVisitors: unique,
    })
    newVsReturning.push({
      day: key,
      newVisitors,
      returningVisitors: Math.max(0, unique - newVisitors),
    })
  }

  return {
    visitorsOverTime,
    registeredUsersOverTime,
    conversionOverTime,
    newVsReturning,
    today: visitors.period === 'today' ? null : undefined,
  }
}

export async function listRegisteredUsersAdmin({
  q = '',
  status = 'all',
  sort = 'newest',
  from = null,
  to = null,
  page = 1,
  pageSize = 20,
} = {}) {
  const db = await dbReady()
  if (!db) {
    return { users: [], total: 0, page: 1, pageSize, totalPages: 0 }
  }

  const limit = Math.min(Math.max(Number(pageSize) || 20, 1), 100)
  const currentPage = Math.max(Number(page) || 1, 1)
  const offset = (currentPage - 1) * limit

  const params = []
  const where = []

  if (q) {
    params.push(`%${String(q).trim().toLowerCase()}%`)
    where.push(
      `(LOWER(COALESCE(p.email,'')) LIKE $${params.length}
        OR LOWER(COALESCE(p.name,'')) LIKE $${params.length}
        OR COALESCE(p.phone,'') LIKE $${params.length})`,
    )
  }

  const fromDate = parseDateInput(from)
  const toDate = parseDateInput(to)
  if (fromDate) {
    params.push(startOfDay(fromDate).toISOString())
    where.push(`p.created_at >= $${params.length}::timestamptz`)
  }
  if (toDate) {
    params.push(endOfDay(toDate).toISOString())
    where.push(`p.created_at <= $${params.length}::timestamptz`)
  }

  if (status === 'active') {
    where.push(`p.last_login_at >= NOW() - INTERVAL '72 hours'`)
  } else if (status === 'inactive') {
    where.push(`(p.last_login_at IS NULL OR p.last_login_at < NOW() - INTERVAL '72 hours')`)
  } else if (status === 'subscribed') {
    where.push(`(
      p.subscription_status = 'active'
      OR p.status = 'paid'
      OR EXISTS (
        SELECT 1 FROM payments pay
        WHERE pay.tenant_id = p.tenant_id AND pay.status = 'paid'
      )
    )`)
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const orderSql =
    sort === 'oldest'
      ? 'ORDER BY p.created_at ASC NULLS LAST'
      : sort === 'last_login'
        ? 'ORDER BY p.last_login_at DESC NULLS LAST'
        : sort === 'paid'
          ? 'ORDER BY latest_paid_at DESC NULLS LAST'
          : 'ORDER BY p.created_at DESC NULLS LAST'

  const countResult = await db.query(
    `SELECT COUNT(*)::int AS c FROM profiles p ${whereSql}`,
    params,
  )
  const total = countResult.rows[0]?.c || 0

  params.push(limit, offset)
  const result = await db.query(
    `SELECT p.*,
            (SELECT COUNT(*)::int FROM user_sessions us WHERE us.tenant_id = p.tenant_id) AS session_count,
            (SELECT COUNT(*)::int FROM payments pay WHERE pay.tenant_id = p.tenant_id AND pay.status = 'paid') AS payment_count,
            lp.payment_id AS latest_payment_id,
            lp.order_id AS latest_order_id,
            lp.amount AS latest_amount,
            lp.currency AS latest_currency,
            lp.status AS latest_payment_status,
            lp.paid_at AS latest_paid_at,
            lp.webinar_link AS latest_webinar_link
     FROM profiles p
     LEFT JOIN LATERAL (
       SELECT payment_id, order_id, amount, currency, status, paid_at, webinar_link
       FROM payments
       WHERE tenant_id = p.tenant_id AND status = 'paid'
       ORDER BY paid_at DESC
       LIMIT 1
     ) lp ON TRUE
     ${whereSql}
     ${orderSql}
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  )

  const users = result.rows.map((row) => {
    const active = isActiveRecently(row.last_login_at, 72)
    const subscribed =
      row.subscription_status === 'active' ||
      row.status === 'paid' ||
      Number(row.payment_count || 0) > 0
    return {
      tenantId: row.tenant_id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      uid: row.uid,
      provider: row.provider,
      emailVerified: row.email_verified,
      picture: row.picture,
      status: row.status,
      activityStatus: active ? 'active' : 'inactive',
      subscriptionStatus: subscribed ? 'active' : row.subscription_status || 'none',
      subscriptionType: row.subscription_type || (subscribed ? 'lifetime' : null),
      subscriptionActivatedAt: row.subscription_activated_at || row.latest_paid_at || null,
      createdAt: row.created_at,
      lastLoginAt: row.last_login_at,
      loginCount: row.login_count || row.session_count || 0,
      sessionCount: row.session_count || 0,
      paymentCount: row.payment_count || 0,
      lastDevice: row.last_device || null,
      lastBrowser: row.last_browser || null,
      lastUserAgent: row.last_user_agent || null,
      payment: row.latest_payment_id
        ? {
            paymentId: row.latest_payment_id,
            orderId: row.latest_order_id,
            amount: row.latest_amount,
            currency: row.latest_currency || 'INR',
            status: row.latest_payment_status,
            paidAt: row.latest_paid_at,
            webinarLink: row.latest_webinar_link,
          }
        : null,
    }
  })

  return {
    users,
    total,
    page: currentPage,
    pageSize: limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  }
}

export async function getRegisteredUserDetail(tenantId) {
  const db = await dbReady()
  if (!db || !tenantId) return null

  const profile = await db.query(`SELECT * FROM profiles WHERE tenant_id = $1`, [tenantId])
  const row = profile.rows[0]
  if (!row) return null

  const sessions = await db.query(
    `SELECT * FROM user_sessions
     WHERE tenant_id = $1
     ORDER BY started_at DESC
     LIMIT 50`,
    [tenantId],
  )
  const payments = await db.query(
    `SELECT * FROM payments WHERE tenant_id = $1 ORDER BY paid_at DESC LIMIT 20`,
    [tenantId],
  )

  const active = isActiveRecently(row.last_login_at, 72)
  return {
    tenantId: row.tenant_id,
    user: {
      name: row.name,
      email: row.email,
      phone: row.phone,
      uid: row.uid,
      provider: row.provider,
      emailVerified: row.email_verified,
      picture: row.picture,
      status: row.status,
      activityStatus: active ? 'active' : 'inactive',
      createdAt: row.created_at,
      lastLoginAt: row.last_login_at,
      loginCount: row.login_count || 0,
      lastDevice: row.last_device,
      lastBrowser: row.last_browser,
      lastUserAgent: row.last_user_agent,
      subscriptionStatus: row.subscription_status,
      subscriptionType: row.subscription_type,
      subscriptionActivatedAt: row.subscription_activated_at,
    },
    sessions: sessions.rows.map((s) => ({
      sessionId: s.session_id,
      startedAt: s.started_at,
      endedAt: s.ended_at,
      lastSeenAt: s.last_seen_at,
      device: s.device,
      browser: s.browser,
      path: s.path,
    })),
    payments: payments.rows.map((p) => ({
      paymentId: p.payment_id,
      orderId: p.order_id,
      amount: p.amount,
      currency: p.currency || 'INR',
      status: p.status,
      paidAt: p.paid_at,
      webinarLink: p.webinar_link,
    })),
  }
}

export async function listVisitorsAdmin({
  q = '',
  sort = 'newest',
  page = 1,
  pageSize = 20,
  from = null,
  to = null,
} = {}) {
  const db = await dbReady()
  if (!db) {
    return { visitors: [], total: 0, page: 1, pageSize, totalPages: 0 }
  }

  const limit = Math.min(Math.max(Number(pageSize) || 20, 1), 100)
  const currentPage = Math.max(Number(page) || 1, 1)
  const offset = (currentPage - 1) * limit
  const params = []
  const where = [`is_bot = FALSE`]

  if (q) {
    params.push(`%${String(q).trim()}%`)
    where.push(`visitor_id LIKE $${params.length}`)
  }
  const fromDate = parseDateInput(from)
  const toDate = parseDateInput(to)
  if (fromDate) {
    params.push(startOfDay(fromDate).toISOString())
    where.push(`first_seen_at >= $${params.length}::timestamptz`)
  }
  if (toDate) {
    params.push(endOfDay(toDate).toISOString())
    where.push(`first_seen_at <= $${params.length}::timestamptz`)
  }

  const whereSql = `WHERE ${where.join(' AND ')}`
  const orderSql =
    sort === 'oldest'
      ? 'ORDER BY first_seen_at ASC'
      : 'ORDER BY last_seen_at DESC'

  const countResult = await db.query(
    `SELECT COUNT(*)::int AS c FROM visitors ${whereSql}`,
    params,
  )
  const total = countResult.rows[0]?.c || 0

  params.push(limit, offset)
  const result = await db.query(
    `SELECT v.*,
            (SELECT COUNT(*)::int FROM visitor_sessions vs WHERE vs.visitor_id = v.visitor_id) AS session_count
     FROM visitors v
     ${whereSql}
     ${orderSql}
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  )

  return {
    visitors: result.rows.map((row) => ({
      visitorId: row.visitor_id,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      visitCount: row.visit_count,
      pageViewCount: row.page_view_count,
      sessionCount: row.session_count || 0,
      linkedTenantId: row.linked_tenant_id,
      isReturning: Number(row.visit_count || 0) > 1,
    })),
    total,
    page: currentPage,
    pageSize: limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  }
}

export async function listVisitorSessionsAdmin({ page = 1, pageSize = 20 } = {}) {
  const db = await dbReady()
  if (!db) {
    return { sessions: [], total: 0, page: 1, pageSize, totalPages: 0 }
  }

  const limit = Math.min(Math.max(Number(pageSize) || 20, 1), 100)
  const currentPage = Math.max(Number(page) || 1, 1)
  const offset = (currentPage - 1) * limit

  const countResult = await db.query(`SELECT COUNT(*)::int AS c FROM visitor_sessions`)
  const total = countResult.rows[0]?.c || 0
  const result = await db.query(
    `SELECT * FROM visitor_sessions
     ORDER BY started_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset],
  )

  return {
    sessions: result.rows.map((row) => ({
      sessionId: row.session_id,
      visitorId: row.visitor_id,
      startedAt: row.started_at,
      lastSeenAt: row.last_seen_at,
      endedAt: row.ended_at,
      device: row.device,
      browser: row.browser,
      pageCount: row.page_count,
      engaged: row.engaged,
      landingPath: row.landing_path,
      referrer: row.referrer,
    })),
    total,
    page: currentPage,
    pageSize: limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  }
}

export async function exportUsersRows({ from = null, to = null } = {}) {
  const db = await dbReady()
  if (!db) return []

  const params = []
  const where = []
  const fromDate = parseDateInput(from)
  const toDate = parseDateInput(to)
  if (fromDate) {
    params.push(startOfDay(fromDate).toISOString())
    where.push(`p.created_at >= $${params.length}::timestamptz`)
  }
  if (toDate) {
    params.push(endOfDay(toDate).toISOString())
    where.push(`p.created_at <= $${params.length}::timestamptz`)
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const result = await db.query(
    `SELECT p.*,
            (SELECT COUNT(*)::int FROM user_sessions us WHERE us.tenant_id = p.tenant_id) AS session_count
     FROM profiles p
     ${whereSql}
     ORDER BY p.created_at DESC`,
    params,
  )

  return result.rows.map((row) => ({
    name: row.name || '',
    email: row.email || '',
    phone: row.phone || '',
    registrationDate: row.created_at ? new Date(row.created_at).toISOString() : '',
    lastLogin: row.last_login_at ? new Date(row.last_login_at).toISOString() : '',
    accountStatus: row.status || '',
    activityStatus: isActiveRecently(row.last_login_at, 72) ? 'active' : 'inactive',
    loginCount: row.login_count || 0,
    sessionCount: row.session_count || 0,
    device: row.last_device || '',
    browser: row.last_browser || '',
    subscriptionStatus: row.subscription_status || '',
    subscriptionType: row.subscription_type || '',
  }))
}

/**
 * Upsert daily/weekly/monthly aggregate snapshots (best-effort).
 */
export async function refreshAnalyticsAggregates() {
  const db = await dbReady()
  if (!db) return { ok: false }

  const now = new Date()
  const day = toDateOnly(startOfDay(now))
  const week = toDateOnly(startOfWeek(now))
  const month = toDateOnly(startOfMonth(now))

  const today = await getVisitorPeriodStats('today')
  const weekStats = await getVisitorPeriodStats('week')
  const monthStats = await getVisitorPeriodStats('month')
  const newUsersToday = await countNewUsers(db, startOfDay(now), endOfDay(now))
  const activeToday = await countActiveUsers(db, startOfDay(now), endOfDay(now))
  const loginsToday = await countLogins(db, startOfDay(now), endOfDay(now))
  const newUsersWeek = await countNewUsers(db, startOfWeek(now), endOfDay(now))
  const newUsersMonth = await countNewUsers(db, startOfMonth(now), endOfDay(now))

  await db.query(
    `INSERT INTO analytics_daily (
       day, unique_visitors, sessions, page_views, new_visitors, returning_visitors,
       new_users, active_users, logins, updated_at
     ) VALUES ($1::date,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
     ON CONFLICT (day) DO UPDATE SET
       unique_visitors = EXCLUDED.unique_visitors,
       sessions = EXCLUDED.sessions,
       page_views = EXCLUDED.page_views,
       new_visitors = EXCLUDED.new_visitors,
       returning_visitors = EXCLUDED.returning_visitors,
       new_users = EXCLUDED.new_users,
       active_users = EXCLUDED.active_users,
       logins = EXCLUDED.logins,
       updated_at = NOW()`,
    [
      day,
      today.uniqueVisitors,
      today.sessions,
      today.pageViews,
      today.newVisitors,
      today.returningVisitors,
      newUsersToday,
      activeToday,
      loginsToday,
    ],
  )

  await db.query(
    `INSERT INTO analytics_weekly (
       week_start, unique_visitors, sessions, page_views, new_visitors, returning_visitors, new_users, updated_at
     ) VALUES ($1::date,$2,$3,$4,$5,$6,$7,NOW())
     ON CONFLICT (week_start) DO UPDATE SET
       unique_visitors = EXCLUDED.unique_visitors,
       sessions = EXCLUDED.sessions,
       page_views = EXCLUDED.page_views,
       new_visitors = EXCLUDED.new_visitors,
       returning_visitors = EXCLUDED.returning_visitors,
       new_users = EXCLUDED.new_users,
       updated_at = NOW()`,
    [
      week,
      weekStats.uniqueVisitors,
      weekStats.sessions,
      weekStats.pageViews,
      weekStats.newVisitors,
      weekStats.returningVisitors,
      newUsersWeek,
    ],
  )

  await db.query(
    `INSERT INTO analytics_monthly (
       month_start, unique_visitors, sessions, page_views, new_visitors, returning_visitors, new_users, updated_at
     ) VALUES ($1::date,$2,$3,$4,$5,$6,$7,NOW())
     ON CONFLICT (month_start) DO UPDATE SET
       unique_visitors = EXCLUDED.unique_visitors,
       sessions = EXCLUDED.sessions,
       page_views = EXCLUDED.page_views,
       new_visitors = EXCLUDED.new_visitors,
       returning_visitors = EXCLUDED.returning_visitors,
       new_users = EXCLUDED.new_users,
       updated_at = NOW()`,
    [
      month,
      monthStats.uniqueVisitors,
      monthStats.sessions,
      monthStats.pageViews,
      monthStats.newVisitors,
      monthStats.returningVisitors,
      newUsersMonth,
    ],
  )

  return { ok: true }
}
