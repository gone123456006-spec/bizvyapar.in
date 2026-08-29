import 'dotenv/config'
import app from './app.js'
import { getEmailConfigStatus } from './email.js'
import { getHost, getPort, getRuntimeStatus } from './config.js'
import { migrateLegacySharedData } from './db/migrate.js'
import { ensureDataLayout } from './db/paths.js'
import { closePostgres, initPostgres, isPostgresEnabled } from './db/postgres.js'
import { closeMongo, initMongo, isMongoEnabled } from './db/mongo.js'
import { ensureAnalyticsSchema } from './db/analyticsSchema.js'
import { startReminderScheduler } from './db/reminders.js'

const PORT = getPort()
const HOST = getHost()
const isRender = Boolean(process.env.RENDER)
const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production'
const allowFileTenants =
  String(process.env.ALLOW_FILE_TENANTS || '').toLowerCase() === 'true'

await ensureDataLayout()

const hasDurableDb = isMongoEnabled() || isPostgresEnabled()

if (!hasDurableDb && (isRender || isProduction) && !allowFileTenants) {
  console.error(
    '[db] FATAL: MONGODB_URI (preferred) or DATABASE_URL is required on Render/production.',
  )
  console.error(
    '[db] File storage is wiped when the free service restarts — subscriptions would disappear.',
  )
  console.error(
    '[db] Fix: add MONGODB_URI from MongoDB Atlas (or DATABASE_URL from Postgres).',
  )
  process.exit(1)
}

if (isMongoEnabled()) {
  await initMongo()
} else if (isPostgresEnabled()) {
  await initPostgres()
  await ensureAnalyticsSchema().catch((error) => {
    console.error('[db] analytics schema failed', error.message)
  })
} else {
  console.warn(
    '[db] No MONGODB_URI / DATABASE_URL — using isolated file tenants (NOT durable on Render)',
  )
  await migrateLegacySharedData().catch((error) => {
    console.error('[db] legacy migration failed', error)
  })
}

const reminderTimer = startReminderScheduler()

const server = app.listen(PORT, HOST, () => {
  const runtime = getRuntimeStatus()
  const database = isMongoEnabled()
    ? 'mongodb'
    : isPostgresEnabled()
      ? 'postgres'
      : 'file-tenants'
  console.log(`BizVyapar API listening on http://${HOST}:${PORT}`)
  console.log('[email]', getEmailConfigStatus())
  console.log('[runtime]', {
    ready: runtime.ready,
    database,
    razorpay: runtime.razorpay,
    email: runtime.email,
    firebase: runtime.firebase,
    webinarLink: runtime.webinarLink,
    cors: runtime.cors,
    missing: runtime.missing,
    isolation: 'per-user-tenant',
  })

  if (!hasDurableDb) {
    console.warn(
      '[runtime] WARNING: subscriptions will NOT survive restarts without MONGODB_URI or DATABASE_URL',
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
    await closeMongo().catch(() => undefined)
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
