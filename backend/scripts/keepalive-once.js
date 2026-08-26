/**
 * Single keep-alive ping (for Render Cron / GitHub Actions).
 * Usage: KEEPALIVE_URL=https://your-api.onrender.com/health node scripts/keepalive-once.js
 */
const url = String(
  process.env.KEEPALIVE_URL ||
    (process.env.RENDER_EXTERNAL_URL
      ? `${process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '')}/health`
      : '') ||
    '',
).trim()

if (!url) {
  console.error(
    `[keepalive] ${new Date().toISOString()} missing KEEPALIVE_URL`,
  )
  process.exit(1)
}

const started = Date.now()

try {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'user-agent': 'bizvyapar-keepalive/1.0' },
    signal: controller.signal,
  })
  clearTimeout(timer)
  const ms = Date.now() - started
  console.log(
    `[keepalive] ${new Date().toISOString()} status=${response.status} ms=${ms} url=${url}`,
  )
  process.exit(response.ok ? 0 : 1)
} catch (error) {
  console.error(
    `[keepalive] ${new Date().toISOString()} FAILED url=${url} error=${error.message}`,
  )
  // Exit 0 so external cron keeps scheduling; next minute retries.
  process.exit(0)
}
