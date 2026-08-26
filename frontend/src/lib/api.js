/**
 * API base URL helper.
 * - Local / same-origin: leave VITE_API_BASE_URL empty → uses /api via Vite proxy or Vercel rewrite
 * - Render backend + separate frontend: set VITE_API_BASE_URL=https://your-api.onrender.com
 */
const RAW_BASE = String(import.meta.env.VITE_API_BASE_URL || '').trim()

export function getApiBaseUrl() {
  return RAW_BASE.replace(/\/$/, '')
}

export function apiUrl(path) {
  const normalized = path.startsWith('/') ? path : `/${path}`
  const base = getApiBaseUrl()
  return base ? `${base}${normalized}` : normalized
}
