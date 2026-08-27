import { apiUrl } from '../../lib/api.js'

const TOKEN_KEY = 'tredsdash_token'

export function getAdminToken() {
  return localStorage.getItem(TOKEN_KEY) || ''
}

export function setAdminToken(token) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearAdminToken() {
  localStorage.removeItem(TOKEN_KEY)
}

export async function adminFetch(path, { token, method = 'GET', body, raw = false } = {}) {
  const headers = { Accept: raw ? '*/*' : 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const res = await fetch(apiUrl(path), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  })

  if (raw) {
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      const error = new Error(data.message || 'Request failed')
      error.status = res.status
      throw error
    }
    return res
  }

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const error = new Error(data.message || 'Request failed')
    error.status = res.status
    throw error
  }
  return data
}

export function formatDate(value) {
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

export function formatDay(value) {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
    })
  } catch {
    return String(value)
  }
}

export async function downloadUsersExport(token, { preset, from, to } = {}) {
  const params = new URLSearchParams()
  if (preset) params.set('preset', preset)
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  const res = await adminFetch(`/api/admin/export/users.xlsx?${params}`, {
    token,
    raw: true,
  })
  const blob = await res.blob()
  const disposition = res.headers.get('Content-Disposition') || ''
  const match = disposition.match(/filename="([^"]+)"/)
  const filename = match?.[1] || `tredsdash-users-${preset || 'export'}.xlsx`
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
