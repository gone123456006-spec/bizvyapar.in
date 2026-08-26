/**
 * Continuous keep-alive loop (every 60s).
 * Run on any always-on machine / second free service:
 *   KEEPALIVE_URL=https://your-api.onrender.com/health node scripts/keepalive.js
 *
 * If a ping fails, it logs and retries on the next interval.
 */
const url = String(
  process.env.KEEPALIVE_URL ||
    (process.env.RENDER_EXTERNAL_URL
      ? `${process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '')}/health`
      : '') ||
    '',
).trim()
const intervalMs = Number(process.env.KEEPALIVE_INTERVAL_MS || 60_000)

if (!url) {
  console.error('KEEPALIVE_URL is required, e.g. https://api.onrender.com/health')
  process.exit(1)
}

console.log(
  `[keepalive] starting interval=${intervalMs}ms url=${url} at ${new Date().toISOString()}`,
)

async function ping() {
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
    console.log(
      `[keepalive] ${new Date().toISOString()} status=${response.status} ms=${Date.now() - started}`,
    )
  } catch (error) {
    console.error(
      `[keepalive] ${new Date().toISOString()} FAILED (will retry next interval) error=${error.message}`,
    )
  }
}

await ping()
setInterval(() => {
  void ping()
}, intervalMs)
