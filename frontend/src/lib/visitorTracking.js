/**
 * Anonymous visitor + session tracking for the public website.
 * Uses localStorage visitorId + sessionStorage sessionId (no PII).
 */

import { apiUrl } from './api.js'

const VISITOR_KEY = 'bv_vid'
const SESSION_KEY = 'bv_sid'
const SESSION_STARTED_KEY = 'bv_sid_at'
const SESSION_TTL_MS = 30 * 60 * 1000

function randomId(prefix) {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export function getVisitorId() {
  try {
    let id = localStorage.getItem(VISITOR_KEY)
    if (!id) {
      id = randomId('v')
      localStorage.setItem(VISITOR_KEY, id)
    }
    return id
  } catch {
    return randomId('v')
  }
}

export function getSessionId() {
  try {
    const now = Date.now()
    let id = sessionStorage.getItem(SESSION_KEY)
    const started = Number(sessionStorage.getItem(SESSION_STARTED_KEY) || 0)
    if (!id || !started || now - started > SESSION_TTL_MS) {
      id = randomId('s')
      sessionStorage.setItem(SESSION_KEY, id)
      sessionStorage.setItem(SESSION_STARTED_KEY, String(now))
    } else {
      sessionStorage.setItem(SESSION_STARTED_KEY, String(now))
    }
    return id
  } catch {
    return randomId('s')
  }
}

async function postTrack(path, body) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' }
  try {
    const { getAccessToken } = await import('../context/AuthContext.jsx')
    const token = await getAccessToken()
    if (token) headers.Authorization = `Bearer ${token}`
  } catch {
    // anonymous ok
  }

  return fetch(apiUrl(path), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => null)
}

export async function trackSitePageView({ path, title, engaged = false } = {}) {
  const visitorId = getVisitorId()
  const sessionId = getSessionId()
  return postTrack('/api/track/pageview', {
    visitorId,
    sessionId,
    path: path || window.location.pathname,
    title: title || document.title,
    referrer: document.referrer || null,
    engaged,
  })
}

export async function trackSiteEngage({ path, title } = {}) {
  return postTrack('/api/track/engage', {
    visitorId: getVisitorId(),
    sessionId: getSessionId(),
    path: path || window.location.pathname,
    title: title || document.title,
    referrer: document.referrer || null,
  })
}

export function getTrackingIds() {
  return {
    visitorId: getVisitorId(),
    sessionId: getSessionId(),
  }
}
