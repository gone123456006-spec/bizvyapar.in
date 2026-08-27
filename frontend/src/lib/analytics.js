import { app } from './firebase.js'

const MEASUREMENT_ID = String(
  import.meta.env.VITE_GA_MEASUREMENT_ID ||
    import.meta.env.VITE_FIREBASE_MEASUREMENT_ID ||
    '',
).trim()

let analyticsInstance = null
let initPromise = null

export function getMeasurementId() {
  return MEASUREMENT_ID
}

export function isAnalyticsConfigured() {
  return Boolean(MEASUREMENT_ID)
}

export async function initAnalytics() {
  if (typeof window === 'undefined' || !isAnalyticsConfigured() || !app) {
    return null
  }
  if (analyticsInstance) return analyticsInstance
  if (initPromise) return initPromise

  initPromise = import('firebase/analytics')
    .then(({ getAnalytics, isSupported }) =>
      isSupported().then((supported) => {
        if (!supported) return null
        analyticsInstance = getAnalytics(app)
        return analyticsInstance
      }),
    )
    .catch(() => null)
    .finally(() => {
      initPromise = null
    })

  return initPromise
}

export async function trackPageView(path, title = document.title) {
  const analytics = await initAnalytics()
  if (!analytics) return

  const pagePath = path || `${window.location.pathname}${window.location.search}`
  const { logEvent } = await import('firebase/analytics')
  logEvent(analytics, 'page_view', {
    page_title: title,
    page_location: `${window.location.origin}${pagePath}`,
    page_path: pagePath,
  })
}

export async function trackEvent(name, params = {}) {
  const analytics = await initAnalytics()
  if (!analytics || !name) return

  const { logEvent } = await import('firebase/analytics')
  logEvent(analytics, name, params)
}

/** Meta Pixel PageView for SPA route changes */
export function trackMetaPageView() {
  if (typeof window === 'undefined') return
  if (typeof window.fbq !== 'function') return
  window.fbq('track', 'PageView')
}

/** Meta Pixel custom/standard event helper */
export function trackMetaEvent(name, params) {
  if (typeof window === 'undefined' || !name) return
  if (typeof window.fbq !== 'function') return
  if (params) window.fbq('track', name, params)
  else window.fbq('track', name)
}
