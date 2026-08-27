/**
 * UA parsing, IP hashing, rate limit helpers for analytics.
 */

import crypto from 'node:crypto'

export function hashIp(ip) {
  const value = String(ip || '').trim()
  if (!value) return null
  const salt = String(process.env.ANALYTICS_IP_SALT || process.env.ADMIN_SESSION_SECRET || 'bizvyapar')
  return crypto.createHash('sha256').update(`${salt}:${value}`).digest('hex').slice(0, 32)
}

export function parseUserAgent(uaRaw) {
  const ua = String(uaRaw || '')
  let device = 'Desktop'
  if (/iPad|Tablet/i.test(ua)) device = 'Tablet'
  else if (/Mobile|Android|iPhone|iPod/i.test(ua)) device = 'Mobile'

  let browser = 'Other'
  if (/Edg\//i.test(ua)) browser = 'Edge'
  else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera'
  else if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) browser = 'Chrome'
  else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser = 'Safari'
  else if (/Firefox\//i.test(ua)) browser = 'Firefox'

  const isBot = /bot|crawl|spider|slurp|facebookexternalhit|preview/i.test(ua)
  return { device, browser, isBot, userAgent: ua.slice(0, 500) || null }
}

export function startOfDay(date = new Date()) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

export function endOfDay(date = new Date()) {
  const d = new Date(date)
  d.setHours(23, 59, 59, 999)
  return d
}

export function startOfWeek(date = new Date()) {
  const d = startOfDay(date)
  const day = d.getDay() // 0 Sun
  const diff = day === 0 ? -6 : 1 - day // Monday start
  d.setDate(d.getDate() + diff)
  return d
}

export function startOfMonth(date = new Date()) {
  const d = startOfDay(date)
  d.setDate(1)
  return d
}

export function toDateOnly(date) {
  const d = new Date(date)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function parseDateInput(value, fallback = null) {
  if (!value) return fallback
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return fallback
  return d
}

/** Simple in-memory sliding window rate limiter. */
export function createRateLimiter({ windowMs = 60_000, max = 120 } = {}) {
  const hits = new Map()

  return function rateLimit(key) {
    const now = Date.now()
    const bucket = hits.get(key) || []
    const recent = bucket.filter((ts) => now - ts < windowMs)
    recent.push(now)
    hits.set(key, recent)

    if (hits.size > 5000) {
      for (const [k, list] of hits) {
        const kept = list.filter((ts) => now - ts < windowMs)
        if (!kept.length) hits.delete(k)
        else hits.set(k, kept)
      }
    }

    return recent.length <= max
  }
}

export function isActiveRecently(lastSeenAt, hours = 72) {
  if (!lastSeenAt) return false
  const ts = new Date(lastSeenAt).getTime()
  if (!Number.isFinite(ts)) return false
  return Date.now() - ts <= hours * 60 * 60 * 1000
}
