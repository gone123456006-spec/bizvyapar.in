import { useCallback, useEffect, useState } from 'react'
import { apiUrl } from '../lib/api.js'

const DEFAULT_SETTINGS = {
  webinarLink: null,
  amountPaise: 100,
  amountLabel: '₹1',
  updatedAt: null,
}

/**
 * Polls public site settings so webinar link + price stay in sync with TredsDash.
 */
export function usePublicSettings(intervalMs = 4000) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/api/public/settings'), {
        cache: 'no-store',
      })
      if (!res.ok) return
      const data = await res.json()
      setSettings({
        webinarLink: data.webinarLink || null,
        amountPaise: Number(data.amountPaise) || 100,
        amountLabel: data.amountLabel || '₹1',
        updatedAt: data.updatedAt || null,
      })
    } catch {
      // Keep last known settings if API is briefly unavailable.
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => {
      void refresh()
    }, intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs, refresh])

  return settings
}
