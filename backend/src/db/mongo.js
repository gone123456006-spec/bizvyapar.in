/**
 * MongoDB Atlas connection for BizVyapar durable data.
 * Uses Atlas Stable API (same options as Atlas “Connect” sample).
 * Set MONGODB_URI in env (never commit the real URI).
 */
import { MongoClient, ServerApiVersion } from 'mongodb'

let client = null
let db = null
let connecting = null
let mongoReady = false

export function getMongoUri() {
  return String(
    process.env.MONGODB_URI || process.env.MONGO_URI || '',
  ).trim()
}

/** URI present in env (may still fail to connect). */
export function isMongoConfigured() {
  return Boolean(getMongoUri())
}

/** True only after a successful connection. */
export function isMongoEnabled() {
  return mongoReady && Boolean(db)
}

export function isMongoReady() {
  return isMongoEnabled()
}

export function getMongoDbName() {
  const fromEnv = String(process.env.MONGODB_DB || '').trim()
  if (fromEnv) return fromEnv
  try {
    const uri = getMongoUri()
    if (!uri) return 'bizvyapar'
    const path = new URL(uri).pathname.replace(/^\//, '')
    return path && path !== '' ? path.split('/')[0] : 'bizvyapar'
  } catch {
    return 'bizvyapar'
  }
}

export async function initMongo() {
  if (!isMongoConfigured()) return { enabled: false }
  if (db && mongoReady) return { enabled: true, db }

  if (!connecting) {
    connecting = (async () => {
      const uri = getMongoUri()
      // Atlas Connect sample options + Stable API
      client = new MongoClient(uri, {
        serverApi: {
          version: ServerApiVersion.v1,
          strict: true,
          deprecationErrors: true,
        },
        maxPoolSize: Number(process.env.MONGO_POOL_MAX || 10),
        serverSelectionTimeoutMS: 15_000,
      })
      await client.connect()
      // Ping admin (Atlas sample), then use app database
      await client.db('admin').command({ ping: 1 })
      db = client.db(getMongoDbName())
      await ensureMongoIndexes(db)
      mongoReady = true
      console.log(
        `[db] MongoDB Atlas connected — ping ok (${getMongoDbName()})`,
      )
      return db
    })().catch((error) => {
      mongoReady = false
      db = null
      connecting = null
      if (client) {
        void client.close().catch(() => undefined)
        client = null
      }
      throw error
    })
  }

  await connecting
  return { enabled: true, db }
}

export function getDb() {
  if (!db || !mongoReady) {
    const error = new Error('MongoDB is not connected.')
    error.status = 503
    throw error
  }
  return db
}

export function col(name) {
  return getDb().collection(name)
}

async function ensureMongoIndexes(database) {
  try {
    await database.collection('users').dropIndex('users_phone')
  } catch {
    // old non-unique index may not exist
  }
  try {
    await database.collection('users').createIndexes([
      { key: { email: 1 }, unique: true, name: 'users_email_unique' },
      {
        key: { phone: 1 },
        unique: true,
        sparse: true,
        name: 'users_phone_unique',
      },
    ])
  } catch (error) {
    console.warn('[mongo] users phone unique index skipped:', error.message)
    await database
      .collection('users')
      .createIndexes([
        { key: { email: 1 }, unique: true, name: 'users_email_unique' },
        { key: { phone: 1 }, name: 'users_phone' },
      ])
      .catch(() => undefined)
  }
  await Promise.all([
    database.collection('refresh_tokens').createIndexes([
      { key: { tokenHash: 1 }, unique: true, name: 'refresh_token_hash_unique' },
      { key: { userId: 1 }, name: 'refresh_tokens_user' },
      { key: { expiresAt: 1 }, name: 'refresh_tokens_expires' },
    ]),
    database.collection('subscriptions').createIndexes([
      { key: { userId: 1 }, unique: true, name: 'subscriptions_user_unique' },
      { key: { status: 1 }, name: 'subscriptions_status' },
    ]),
    database.collection('profiles').createIndexes([
      { key: { tenantId: 1 }, unique: true, name: 'profiles_tenant_unique' },
      { key: { email: 1 }, name: 'profiles_email' },
      { key: { uid: 1 }, name: 'profiles_uid' },
    ]),
    database.collection('payments').createIndexes([
      { key: { paymentId: 1 }, unique: true, name: 'payments_payment_id_unique' },
      { key: { tenantId: 1 }, name: 'payments_tenant' },
      { key: { userId: 1 }, name: 'payments_user' },
      { key: { email: 1 }, name: 'payments_email' },
    ]),
    database.collection('registrations').createIndexes([
      {
        key: { tenantId: 1, email: 1 },
        unique: true,
        name: 'registrations_tenant_email',
      },
      { key: { email: 1 }, name: 'registrations_email' },
    ]),
    database.collection('settings').createIndexes([
      { key: { key: 1 }, unique: true, name: 'settings_key_unique' },
    ]),
    database.collection('activity').createIndexes([
      { key: { tenantId: 1, at: -1 }, name: 'activity_tenant_at' },
    ]),
    database.collection('analytics_sessions').createIndexes([
      { key: { sessionId: 1 }, name: 'analytics_session_id' },
      { key: { tenantId: 1 }, name: 'analytics_tenant' },
      { key: { visitorId: 1 }, name: 'analytics_visitor' },
    ]),
  ])
}

export async function closeMongo() {
  connecting = null
  mongoReady = false
  db = null
  if (client) {
    await client.close().catch(() => undefined)
    client = null
  }
}
