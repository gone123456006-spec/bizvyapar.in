import 'dotenv/config'
import app from './app.js'
import { getEmailConfigStatus } from './email.js'
import { getHost, getPort, getRuntimeStatus } from './config.js'
import { migrateLegacySharedData } from './db/migrate.js'
import { ensureDataLayout } from './db/paths.js'
import { closePostgres, initPostgres, isPostgresEnabled } from './db/postgres.js'
import { startReminderScheduler } from './db/reminders.js'

const PORT = getPort()
const HOST = getHost()
const isRender = Boolean(process.env.RENDER)
const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production'
const allowFileTenants =
  String(process.env.ALLOW_FILE_TENANTS || '').toLowerCase() === 'true'

await ensureDataLayout()

if (!isPostgresEnabled() && (isRender || isProduction) && !allowFileTenants) {
  console.error(
    '[db] FATAL: DATABASE_URL is required on Render/production for permanent subscriptions.',
  )
  console.error(
    '[db] File storage is wiped when the free service restarts — that is why subscriptions disappear after a few hours.',
  )
  console.error(
    '[db] Fix: Render → your API service → Environment → add DATABASE_URL from a Postgres database.',
  )
  console.error(
    '[db] Temporary escape hatch (not durable): ALLOW_FILE_TENANTS=true',
  )
  process.exit(1)
}

if (isPostgresEnabled()) {
  await initPostgres()
} else {
  console.warn(
    '[db] DATABASE_URL not set — using isolated file tenants (NOT durable on Render)',
  )
  await migrateLegacySharedData().catch((error) => {
    console.error('[db] legacy migration failed', error)
  })
}

const reminderTimer = startReminderScheduler()

const server = app.listen(PORT, HOST, () => {
  const runtime = getRuntimeStatus()
  console.log(`BizVyapar API listening on http://${HOST}:${PORT}`)
  console.log('[email]', getEmailConfigStatus())
  console.log('[runtime]', {
    ready: runtime.ready,
    database: isPostgresEnabled() ? 'postgres' : 'file-tenants',
    razorpay: runtime.razorpay,
    email: runtime.email,
    firebase: runtime.firebase,
    webinarLink: runtime.webinarLink,
    cors: runtime.cors,
    missing: runtime.missing,
    isolation: 'per-user-tenant',
  })

  if (!isPostgresEnabled()) {
    console.warn(
      '[runtime] WARNING: subscriptions will NOT survive restarts without DATABASE_URL',
    )
  }

  if (!runtime.ready) {
    console.warn(
      '[runtime] Server started, but some production env vars are missing:',
      runtime.missing.join(', '),
    )
  }
})

function shutdown(signal) {
  console.log(`[shutdown] ${signal} received, closing server...`)
  if (reminderTimer) clearInterval(reminderTimer)
  server.close(async () => {
    await closePostgres().catch(() => undefined)
    process.exit(0)
  })

  setTimeout(() => {
    console.error('[shutdown] Forced exit after timeout')
    process.exit(1)
  }, 10_000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

process.on('uncaughtException', (error) => {
  console.error('[fatal] uncaughtException', error)
})

process.on('unhandledRejection', (reason) => {
  console.error('[fatal] unhandledRejection', reason)
})
