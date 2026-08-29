/**
 * Simple in-memory rate limiter for auth endpoints (per IP + optional email key).
 * For multi-instance production, prefer Redis; this still blocks brute force on a single dyno.
 */
const buckets = new Map()

function keyFor(parts) {
  return parts.filter(Boolean).join('|')
}

function getBucket(key) {
  const now = Date.now()
  let b = buckets.get(key)
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + 15 * 60 * 1000 }
    buckets.set(key, b)
  }
  return b
}

/** Max attempts per 15 minutes per IP (and per email when provided). */
export function authRateLimit({ maxPerIp = 30, maxPerEmail = 10 } = {}) {
  return (req, res, next) => {
    const ip =
      String(req.headers['x-forwarded-for'] || '')
        .split(',')[0]
        .trim() ||
      req.ip ||
      'unknown'
    const email = String(req.body?.email || '')
      .trim()
      .toLowerCase()

    const ipBucket = getBucket(keyFor(['ip', ip]))
    ipBucket.count += 1
    if (ipBucket.count > maxPerIp) {
      return res.status(429).json({
        message: 'Too many attempts. Please try again later.',
      })
    }

    if (email) {
      const emailBucket = getBucket(keyFor(['email', email]))
      emailBucket.count += 1
      if (emailBucket.count > maxPerEmail) {
        return res.status(429).json({
          message: 'Too many attempts. Please try again later.',
        })
      }
    }

    return next()
  }
}

/** Clear counters periodically to avoid unbounded memory. */
setInterval(() => {
  const now = Date.now()
  for (const [k, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(k)
  }
}, 60_000).unref?.()
