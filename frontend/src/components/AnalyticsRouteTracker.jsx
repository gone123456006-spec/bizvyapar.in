import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { initAnalytics, trackPageView } from '../lib/analytics.js'
import { trackSiteEngage, trackSitePageView } from '../lib/visitorTracking.js'

const PAGE_TITLES = {
  '/': 'BizVyapar — Join the free webinar waitlist',
  '/terms': 'Terms & Conditions — BizVyapar',
  '/terms-and-conditions': 'Terms & Conditions — BizVyapar',
  '/tredsdash': 'TredsDash — BizVyapar Admin',
  '/admin': 'TredsDash — BizVyapar Admin',
}

export default function AnalyticsRouteTracker() {
  const location = useLocation()
  const engagedRef = useRef(false)

  useEffect(() => {
    void initAnalytics()
  }, [])

  useEffect(() => {
    if (location.pathname.startsWith('/tredsdash') || location.pathname.startsWith('/admin')) {
      return undefined
    }

    const path = `${location.pathname}${location.search}`
    const title = PAGE_TITLES[location.pathname] || document.title
    void trackPageView(path, title)
    void trackSitePageView({ path, title })

    engagedRef.current = false
    const onScroll = () => {
      if (engagedRef.current) return
      const scrolled = window.scrollY || document.documentElement.scrollTop || 0
      const height = document.documentElement.scrollHeight - window.innerHeight
      if (height > 0 && scrolled / height >= 0.25) {
        engagedRef.current = true
        void trackSiteEngage({ path, title })
      }
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    const timer = window.setTimeout(() => {
      if (!engagedRef.current) {
        engagedRef.current = true
        void trackSiteEngage({ path, title })
      }
    }, 12_000)

    return () => {
      window.removeEventListener('scroll', onScroll)
      window.clearTimeout(timer)
    }
  }, [location.pathname, location.search])

  return null
}
