import pg from 'pg'

const { Pool } = pg

let pool = null

export function isPostgresEnabled() {
  return Boolean(String(process.env.DATABASE_URL || '').trim())
}

export function getPool() {
  if (!isPostgresEnabled()) return null
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl:
        String(process.env.PGSSL || 'true').toLowerCase() === 'true'
          ? { rejectUnauthorized: false }
          : undefined,
      max: Number(process.env.PG_POOL_MAX || 5),
    })
  }
  return pool
}

export async function initPostgres() {
  const db = getPool()
  if (!db) return { enabled: false }

  await db.query(`
    CREATE TABLE IF NOT EXISTS tenants (
      tenant_id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      uid TEXT UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS profiles (
      tenant_id TEXT PRIMARY KEY REFERENCES tenants(tenant_id) ON DELETE CASCADE,
      email TEXT,
      uid TEXT,
      name TEXT,
      phone TEXT,
      picture TEXT,
      provider TEXT,
      email_verified BOOLEAN NOT NULL DEFAULT FALSE,
      status TEXT NOT NULL DEFAULT 'active',
      last_login_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
      payment_id TEXT NOT NULL UNIQUE,
      order_id TEXT,
      amount INTEGER,
      currency TEXT DEFAULT 'INR',
      status TEXT NOT NULL DEFAULT 'paid',
      webinar_link TEXT,
      email TEXT,
      name TEXT,
      phone TEXT,
      paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS payments_tenant_idx ON payments(tenant_id);

    CREATE TABLE IF NOT EXISTS registrations (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      name TEXT,
      phone TEXT,
      status TEXT NOT NULL DEFAULT 'joined',
      payment_id TEXT,
      order_id TEXT,
      amount INTEGER,
      webinar_link TEXT,
      paid_at TIMESTAMPTZ,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (tenant_id, email)
    );

    CREATE TABLE IF NOT EXISTS activity (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS activity_tenant_idx ON activity(tenant_id, at DESC);

    CREATE TABLE IF NOT EXISTS reminder_log (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
      payment_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      workshop_at TIMESTAMPTZ NOT NULL,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (tenant_id, payment_id, kind, workshop_at)
    );
  `)

  // Lifetime subscription columns (safe to re-run)
  await db.query(`
    ALTER TABLE profiles
      ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'none',
      ADD COLUMN IF NOT EXISTS subscription_type TEXT,
      ADD COLUMN IF NOT EXISTS subscription_activated_at TIMESTAMPTZ
  `)

  // Backfill existing paid profiles to lifetime (one-time permanent)
  await db.query(`
    UPDATE profiles
    SET subscription_status = 'active',
        subscription_type = 'lifetime',
        subscription_activated_at = COALESCE(subscription_activated_at, updated_at, NOW())
    WHERE status = 'paid'
      AND COALESCE(subscription_status, 'none') <> 'revoked'
      AND (
        subscription_status IS DISTINCT FROM 'active'
        OR subscription_type IS DISTINCT FROM 'lifetime'
      )
  `)

  console.log('[db] Postgres schema ready')
  return { enabled: true }
}

export async function closePostgres() {
  if (pool) {
    await pool.end()
    pool = null
  }
}
