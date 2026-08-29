/**
 * Users + subscriptions + refresh tokens (Postgres).
 * userId (UUID) is the permanent identity — never derived from name/email/phone.
 */
import { randomUUID } from 'node:crypto'
import { getPool, isPostgresEnabled } from '../db/postgres.js'
import {
  createRefreshTokenRaw,
  hashToken,
  newUserId,
  refreshExpiryDate,
  signAccessToken,
} from './tokens.js'

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

function normalizePhone(phone) {
  if (phone == null || phone === '') return null
  const digits = String(phone).replace(/\D/g, '')
  if (!digits) return null
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2)
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1)
  const ten = digits.slice(-10)
  return ten.length === 10 ? ten : null
}

function sanitizeName(name) {
  return String(name || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 120)
}

function namesMatch(a, b) {
  return sanitizeName(a).toLowerCase() === sanitizeName(b).toLowerCase()
}

function validateEmailPhone({ email, phone }) {
  const cleanEmail = normalizeEmail(email)
  const cleanPhone = normalizePhone(phone)

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    const error = new Error('Please enter a valid email address.')
    error.status = 400
    throw error
  }
  if (!cleanPhone || cleanPhone.length !== 10) {
    const error = new Error('Please enter a valid 10-digit mobile number.')
    error.status = 400
    throw error
  }

  return { cleanEmail, cleanPhone }
}

function validateIdentity({ name, email, phone }) {
  const cleanName = sanitizeName(name)
  const { cleanEmail, cleanPhone } = validateEmailPhone({ email, phone })

  if (!cleanName || cleanName.length < 2) {
    const error = new Error('Please enter your full name.')
    error.status = 400
    throw error
  }

  return { cleanName, cleanEmail, cleanPhone }
}

function mapUser(row) {
  if (!row) return null
  return {
    id: row.id,
    userId: row.id,
    uid: row.id,
    email: row.email,
    name: row.name,
    phone: row.phone,
    emailVerified: Boolean(row.email_verified),
    provider: row.provider || 'local',
    status: row.status || 'active',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
  }
}

function mapSubscription(row) {
  if (!row) {
    return {
      plan: null,
      status: 'none',
      expiresAt: null,
      activatedAt: null,
      label: 'No active subscription',
    }
  }
  const active = row.status === 'active' && row.plan === 'lifetime'
  return {
    plan: row.plan,
    status: row.status,
    expiresAt: row.expires_at,
    activatedAt: row.activated_at,
    label: active ? 'Subscription: Active' : 'No active subscription',
  }
}

export function assertPostgres() {
  if (!isPostgresEnabled()) {
    const error = new Error(
      'Auth requires DATABASE_URL (Postgres) for permanent accounts.',
    )
    error.status = 503
    throw error
  }
}

export async function findUserByEmail(email) {
  assertPostgres()
  const db = getPool()
  const res = await db.query(`SELECT * FROM users WHERE email = $1 LIMIT 1`, [
    normalizeEmail(email),
  ])
  return res.rows[0] || null
}

export async function findUserById(userId) {
  assertPostgres()
  const db = getPool()
  const res = await db.query(`SELECT * FROM users WHERE id = $1 LIMIT 1`, [
    userId,
  ])
  return res.rows[0] || null
}

export async function getSubscriptionByUserId(userId) {
  assertPostgres()
  const db = getPool()
  const res = await db.query(
    `SELECT * FROM subscriptions WHERE user_id = $1 LIMIT 1`,
    [userId],
  )
  return mapSubscription(res.rows[0])
}

export async function isLifetimeActiveForUser(userId) {
  const sub = await getSubscriptionByUserId(userId)
  return sub.status === 'active' && sub.plan === 'lifetime'
}

/**
 * Ensure tenant/profile rows exist for payment isolation.
 * Fast path: upsert by deterministic tenant_id = uid_<userId> (2 queries).
 * Never fails auth — recovers from email/uid unique conflicts.
 */
export async function ensureTenantForUser(user) {
  assertPostgres()
  const db = getPool()
  const userId = String(user.id || user.userId || '').trim()
  const email = normalizeEmail(user.email)
  const now = new Date().toISOString()
  const name = sanitizeName(user.name) || null
  const phone = normalizePhone(user.phone)

  if (!userId && !email) {
    const error = new Error('Could not set up your account. Please try again.')
    error.status = 400
    throw error
  }

  const preferredId = userId ? `uid_${userId}` : null

  try {
    if (preferredId) {
      try {
        await db.query(
          `INSERT INTO tenants (tenant_id, email, uid, created_at, updated_at)
           VALUES ($1, $2, $3, $4::timestamptz, $4::timestamptz)
           ON CONFLICT (tenant_id) DO UPDATE SET
             email = COALESCE(EXCLUDED.email, tenants.email),
             uid = COALESCE(EXCLUDED.uid, tenants.uid),
             updated_at = EXCLUDED.updated_at`,
          [preferredId, email || null, userId, now],
        )
        await upsertProfileForTenant(db, preferredId, {
          email,
          userId,
          name,
          phone,
          now,
        })
        return preferredId
      } catch (error) {
        if (error?.code !== '23505') throw error
        // Email/uid owned by another tenant — fall through and claim
      }
    }

    const existing = await db.query(
      `SELECT tenant_id FROM tenants
       WHERE ($1::text IS NOT NULL AND uid = $1)
          OR ($2::text IS NOT NULL AND email = $2)
       LIMIT 1`,
      [userId || null, email || null],
    )
    const tenantId = existing.rows[0]?.tenant_id || preferredId
    if (!tenantId) return preferredId || `tmp_${randomUUID()}`

    await db.query(
      `UPDATE tenants
       SET email = COALESCE($2, email),
           uid = COALESCE($3, uid),
           updated_at = $4::timestamptz
       WHERE tenant_id = $1`,
      [tenantId, email || null, userId || null, now],
    )
    await upsertProfileForTenant(db, tenantId, {
      email,
      userId,
      name,
      phone,
      now,
    })
    return tenantId
  } catch (error) {
    // Last resort: do not break Sign In / Sign Up on tenant sync issues
    console.error('ensureTenantForUser soft-fail:', error.message)
    if (preferredId) return preferredId
    if (email) {
      const again = await db
        .query(`SELECT tenant_id FROM tenants WHERE email = $1 LIMIT 1`, [email])
        .catch(() => ({ rows: [] }))
      if (again.rows[0]?.tenant_id) return again.rows[0].tenant_id
    }
    return preferredId || `uid_${userId || randomUUID()}`
  }
}

async function upsertProfileForTenant(db, tenantId, { email, userId, name, phone, now }) {
  await db.query(
    `INSERT INTO profiles (
       tenant_id, email, uid, name, phone, provider, email_verified,
       status, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, 'local', TRUE, 'active', $6::timestamptz, $6::timestamptz
     )
     ON CONFLICT (tenant_id) DO UPDATE SET
       email = COALESCE(EXCLUDED.email, profiles.email),
       uid = COALESCE(EXCLUDED.uid, profiles.uid),
       name = COALESCE(EXCLUDED.name, profiles.name),
       phone = COALESCE(EXCLUDED.phone, profiles.phone),
       provider = 'local',
       email_verified = TRUE,
       updated_at = EXCLUDED.updated_at`,
    [tenantId, email, userId || null, name, phone, now],
  )
}

/**
 * Sign In — Gmail + mobile only (existing accounts).
 * Optimized: one joined SELECT; login bookkeeping is non-blocking.
 */
export async function loginWithEmailPhone({ email, phone }) {
  assertPostgres()
  const { cleanEmail, cleanPhone } = validateEmailPhone({ email, phone })
  const db = getPool()

  const found = await db.query(
    `SELECT u.*,
            s.plan AS sub_plan,
            s.status AS sub_status,
            s.expires_at AS sub_expires_at,
            s.activated_at AS sub_activated_at
     FROM users u
     LEFT JOIN subscriptions s ON s.user_id = u.id
     WHERE u.email = $1
     LIMIT 1`,
    [cleanEmail],
  )
  const existing = found.rows[0]
  if (!existing || existing.status === 'disabled') {
    const error = new Error('No account found. Please Sign Up.')
    error.status = 404
    throw error
  }

  const storedPhone = normalizePhone(existing.phone)
  // Gmail is the account key. Mobile is required, but a mismatch must not
  // block Sign In — update stored mobile to the one just entered.
  const nextPhone = cleanPhone || storedPhone

  const user = mapUser(existing)
  user.phone = nextPhone

  const tenantId = `uid_${user.id}`
  const subscription = mapSubscription({
    plan: existing.sub_plan,
    status: existing.sub_status,
    expires_at: existing.sub_expires_at,
    activated_at: existing.sub_activated_at,
  })

  // Do not block the response on bookkeeping / tenant warm-up
  void db
    .query(
      `UPDATE users
       SET phone = $2,
           failed_login_attempts = 0,
           locked_until = NULL,
           last_login_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [existing.id, nextPhone],
    )
    .then(() => ensureTenantForUser(user))
    .catch(() => undefined)

  return { user, tenantId, created: false, subscription }
}

/**
 * Sign Up — Name + Gmail + mobile (new accounts only).
 * Optimized: one CTE insert (user + subscription); skip pre-read.
 */
export async function registerUser({ name, email, phone }) {
  assertPostgres()
  const { cleanName, cleanEmail, cleanPhone } = validateIdentity({
    name,
    email,
    phone,
  })

  const userId = newUserId()
  const subId = randomUUID()
  const db = getPool()
  let row
  try {
    const inserted = await db.query(
      `WITH new_user AS (
         INSERT INTO users (
           id, email, password_hash, name, phone, email_verified, provider, status
         ) VALUES ($1, $2, NULL, $3, $4, FALSE, 'local', 'active')
         RETURNING *
       ),
       new_sub AS (
         INSERT INTO subscriptions (id, user_id, plan, status, expires_at, activated_at)
         SELECT $5, id, NULL, 'none', NULL, NULL FROM new_user
       )
       SELECT * FROM new_user`,
      [userId, cleanEmail, cleanName, cleanPhone, subId],
    )
    row = inserted.rows[0]
  } catch (error) {
    if (error?.code === '23505') {
      const dup = new Error('Account already exists. Please Sign In.')
      dup.status = 409
      throw dup
    }
    throw error
  }

  const user = mapUser(row)

  const [tenantId, didMigrate] = await Promise.all([
    ensureTenantForUser(user),
    migrateLegacyLifetimeByEmail(cleanEmail, userId),
  ])

  const subscription = didMigrate
    ? await getSubscriptionByUserId(userId)
    : mapSubscription(null)

  return { user, tenantId, created: true, subscription }
}

/** Join / Next flow — sign up if new, otherwise sign in with email+phone. */
export async function signInWithDetails({ name, email, phone }) {
  const existing = await findUserByEmail(normalizeEmail(email))
  if (existing) {
    return loginWithEmailPhone({ email, phone })
  }
  return registerUser({ name, email, phone })
}

export async function authenticateUser(input) {
  return loginWithEmailPhone(input)
}

/**
 * If this email previously paid under the old profile system,
 * attach lifetime to the new permanent userId.
 */
async function migrateLegacyLifetimeByEmail(email, userId) {
  const db = getPool()
  const res = await db.query(
    `SELECT tenant_id, uid, subscription_status, status
     FROM profiles
     WHERE email = $1
       AND (
         subscription_status = 'active'
         OR status = 'paid'
       )
       AND COALESCE(subscription_status, 'none') <> 'revoked'
     LIMIT 1`,
    [email],
  )
  const legacy = res.rows[0]
  if (!legacy) return false

  await activateLifetimeSubscription(userId)

  if (legacy.uid && legacy.uid !== userId) {
    await db.query(
      `UPDATE profiles
       SET uid = $2, updated_at = NOW()
       WHERE tenant_id = $1`,
      [legacy.tenant_id, userId],
    ).catch(() => undefined)
  }
  return true
}

export async function issueTokenPair(user, meta = {}) {
  const refreshRaw = createRefreshTokenRaw()
  const tokenHash = hashToken(refreshRaw)
  const expiresAt = refreshExpiryDate()
  const db = getPool()
  const id = randomUUID()
  const [accessToken] = await Promise.all([
    signAccessToken(user),
    db.query(
      `INSERT INTO refresh_tokens (
         id, user_id, token_hash, expires_at, user_agent, ip
       ) VALUES ($1, $2, $3, $4::timestamptz, $5, $6)`,
      [
        id,
        user.id || user.userId,
        tokenHash,
        expiresAt.toISOString(),
        meta.userAgent || null,
        meta.ip || null,
      ],
    ),
  ])
  return {
    accessToken,
    refreshToken: refreshRaw,
    expiresIn: ACCESS_TTL_SECONDS(),
    refreshExpiresAt: expiresAt.toISOString(),
  }
}

function ACCESS_TTL_SECONDS() {
  const raw = String(process.env.ACCESS_TOKEN_TTL || '15m').trim()
  if (raw.endsWith('m')) return Number(raw.slice(0, -1)) * 60
  if (raw.endsWith('h')) return Number(raw.slice(0, -1)) * 3600
  if (raw.endsWith('s')) return Number(raw.slice(0, -1))
  return 900
}

export async function rotateRefreshToken(refreshToken, meta = {}) {
  assertPostgres()
  const tokenHash = hashToken(refreshToken)
  const db = getPool()
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const found = await client.query(
      `SELECT * FROM refresh_tokens
       WHERE token_hash = $1
       LIMIT 1
       FOR UPDATE`,
      [tokenHash],
    )
    const row = found.rows[0]
    if (!row || row.revoked_at || new Date(row.expires_at) <= new Date()) {
      await client.query('ROLLBACK')
      const error = new Error('Session expired. Please sign in again.')
      error.status = 401
      throw error
    }

    await client.query(
      `UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1`,
      [row.id],
    )

    const userRes = await client.query(`SELECT * FROM users WHERE id = $1`, [
      row.user_id,
    ])
    const userRow = userRes.rows[0]
    if (!userRow || userRow.status === 'disabled') {
      await client.query('ROLLBACK')
      const error = new Error('Session expired. Please sign in again.')
      error.status = 401
      throw error
    }

    const user = mapUser(userRow)
    const accessToken = await signAccessToken(user)
    const newRaw = createRefreshTokenRaw()
    const newHash = hashToken(newRaw)
    const expiresAt = refreshExpiryDate()
    await client.query(
      `INSERT INTO refresh_tokens (
         id, user_id, token_hash, expires_at, user_agent, ip
       ) VALUES ($1, $2, $3, $4::timestamptz, $5, $6)`,
      [
        randomUUID(),
        user.id,
        newHash,
        expiresAt.toISOString(),
        meta.userAgent || null,
        meta.ip || null,
      ],
    )
    await client.query('COMMIT')
    await ensureTenantForUser(user)
    return {
      user,
      accessToken,
      refreshToken: newRaw,
      expiresIn: ACCESS_TTL_SECONDS(),
      refreshExpiresAt: expiresAt.toISOString(),
    }
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // ignore
    }
    throw error
  } finally {
    client.release()
  }
}

export async function revokeRefreshToken(refreshToken) {
  if (!refreshToken) return
  assertPostgres()
  const db = getPool()
  await db.query(
    `UPDATE refresh_tokens
     SET revoked_at = NOW()
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hashToken(refreshToken)],
  )
}

export async function revokeAllRefreshTokensForUser(userId) {
  assertPostgres()
  const db = getPool()
  await db.query(
    `UPDATE refresh_tokens
     SET revoked_at = NOW()
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  )
}

export async function activateLifetimeSubscription(userId) {
  assertPostgres()
  const db = getPool()
  const now = new Date().toISOString()
  await db.query(
    `INSERT INTO subscriptions (id, user_id, plan, status, expires_at, activated_at, updated_at)
     VALUES ($1, $2, 'lifetime', 'active', NULL, $3::timestamptz, $3::timestamptz)
     ON CONFLICT (user_id) DO UPDATE SET
       plan = 'lifetime',
       status = 'active',
       expires_at = NULL,
       activated_at = COALESCE(subscriptions.activated_at, EXCLUDED.activated_at),
       updated_at = EXCLUDED.updated_at
     WHERE COALESCE(subscriptions.status, 'none') <> 'revoked'`,
    [randomUUID(), userId, now],
  )

  // Mirror onto profile for legacy readers
  const tenantId = `uid_${userId}`
  await db.query(
    `UPDATE profiles
     SET status = 'paid',
         subscription_status = 'active',
         subscription_type = 'lifetime',
         subscription_activated_at = COALESCE(subscription_activated_at, $2::timestamptz),
         updated_at = $2::timestamptz
     WHERE tenant_id = $1
       AND COALESCE(subscription_status, 'none') <> 'revoked'`,
    [tenantId, now],
  )
}

export async function updateUserProfile(userId, { name, phone }) {
  assertPostgres()
  const db = getPool()
  const cleanName = name != null ? sanitizeName(name) : null
  const cleanPhone = phone !== undefined ? normalizePhone(phone) : undefined
  await db.query(
    `UPDATE users
     SET name = COALESCE($2, name),
         phone = CASE WHEN $3::boolean THEN $4 ELSE phone END,
         updated_at = NOW()
     WHERE id = $1`,
    [
      userId,
      cleanName || null,
      cleanPhone !== undefined,
      cleanPhone ?? null,
    ],
  )
  const row = await findUserById(userId)
  await ensureTenantForUser(row)
  return mapUser(row)
}

export { mapUser, mapSubscription, normalizeEmail, normalizePhone, sanitizeName }
