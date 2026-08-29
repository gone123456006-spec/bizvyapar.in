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
      max: Number(process.env.PG_POOL_MAX || 10),
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

  // Admin-editable runtime settings (webinar link + price)
  await db.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
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

  // Secure auth: users (UUID identity), refresh tokens, subscriptions by user_id
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      name TEXT NOT NULL,
      phone TEXT,
      email_verified BOOLEAN NOT NULL DEFAULT FALSE,
      provider TEXT NOT NULL DEFAULT 'local',
      status TEXT NOT NULL DEFAULT 'active',
      failed_login_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until TIMESTAMPTZ,
      last_login_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS users_email_lower_idx ON users (LOWER(email));

    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      user_agent TEXT,
      ip TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS refresh_tokens_user_idx ON refresh_tokens(user_id);
    CREATE INDEX IF NOT EXISTS refresh_tokens_hash_idx ON refresh_tokens(token_hash);

    CREATE TABLE IF NOT EXISTS subscriptions (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      plan TEXT,
      status TEXT NOT NULL DEFAULT 'none',
      expires_at TIMESTAMPTZ,
      activated_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS subscriptions_user_idx ON subscriptions(user_id);
    CREATE INDEX IF NOT EXISTS subscriptions_status_idx ON subscriptions(status);
  `)

  await db
    .query(
      `CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique_idx
       ON users (phone)
       WHERE phone IS NOT NULL AND phone <> ''`,
    )
    .catch((error) => {
      console.warn(
        '[postgres] users phone unique index skipped:',
        error.message,
      )
    })

  // Passwordless accounts — never require password_hash
  await db.query(`
    ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL
  `).catch(() => undefined)
  await db.query(`
    ALTER TABLE users ALTER COLUMN password_hash SET DEFAULT ''
  `).catch(() => undefined)
  await db.query(`
    UPDATE users SET password_hash = '' WHERE password_hash IS NULL
  `).catch(() => undefined)

  // Backfill lifetime subscriptions from paid profiles (uid matches users.id)
  await db.query(`
    INSERT INTO subscriptions (id, user_id, plan, status, expires_at, activated_at, created_at, updated_at)
    SELECT gen_random_uuid(), u.id, 'lifetime', 'active', NULL,
           COALESCE(p.subscription_activated_at, p.updated_at, NOW()), NOW(), NOW()
    FROM users u
    INNER JOIN profiles p ON p.uid = u.id::text
    WHERE (
        p.subscription_status = 'active'
        OR p.status = 'paid'
      )
      AND COALESCE(p.subscription_status, 'none') <> 'revoked'
    ON CONFLICT (user_id) DO UPDATE SET
      plan = 'lifetime',
      status = 'active',
      expires_at = NULL,
      activated_at = COALESCE(subscriptions.activated_at, EXCLUDED.activated_at),
      updated_at = NOW()
    WHERE COALESCE(subscriptions.status, 'none') <> 'revoked'
  `).catch((error) => {
    console.warn('[db] subscription backfill skipped:', error.message)
  })

  console.log('[db] Postgres schema ready')
  return { enabled: true }
}

export async function closePostgres() {
  if (pool) {
    await pool.end()
    pool = null
  }
}
