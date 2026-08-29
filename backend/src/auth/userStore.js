/**
 * Users + subscriptions + refresh tokens (Postgres).
 * userId (UUID) is the permanent identity — never derived from name/email/phone.
 */
import { randomUUID } from 'node:crypto'
import { getPool, isPostgresEnabled } from '../db/postgres.js'
import { hashPassword, verifyPassword } from './password.js'
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
      'Secure auth requires DATABASE_URL (Postgres). File tenants are not supported for password accounts.',
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
 * Ensure tenant/profile rows exist for payment isolation (tenant_id = uid_<userId>).
 */
export async function ensureTenantForUser(user) {
  assertPostgres()
  const db = getPool()
  const userId = user.id || user.userId
  const tenantId = `uid_${userId}`
  const email = normalizeEmail(user.email)
  const now = new Date().toISOString()

  await db.query(
    `INSERT INTO tenants (tenant_id, email, uid, created_at, updated_at)
     VALUES ($1, $2, $3, $4::timestamptz, $4::timestamptz)
     ON CONFLICT (tenant_id) DO UPDATE
       SET email = COALESCE(EXCLUDED.email, tenants.email),
           uid = COALESCE(tenants.uid, EXCLUDED.uid),
           updated_at = EXCLUDED.updated_at`,
    [tenantId, email, userId, now],
  )

  await db.query(
    `INSERT INTO profiles (
       tenant_id, email, uid, name, phone, provider, email_verified,
       status, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, 'local', TRUE, 'active', $6::timestamptz, $6::timestamptz
     )
     ON CONFLICT (tenant_id) DO UPDATE SET
       email = COALESCE(EXCLUDED.email, profiles.email),
       uid = COALESCE(profiles.uid, EXCLUDED.uid),
       name = COALESCE(EXCLUDED.name, profiles.name),
       phone = COALESCE(EXCLUDED.phone, profiles.phone),
       provider = 'local',
       email_verified = TRUE,
       updated_at = EXCLUDED.updated_at`,
    [
      tenantId,
      email,
      userId,
      sanitizeName(user.name) || null,
      normalizePhone(user.phone),
      now,
    ],
  )

  return tenantId
}

export async function registerUser({ name, email, password, phone }) {
  assertPostgres()
  const cleanName = sanitizeName(name)
  const cleanEmail = normalizeEmail(email)
  const cleanPhone = normalizePhone(phone)

  if (!cleanName || cleanName.length < 2) {
    const error = new Error('Please enter your full name.')
    error.status = 400
    throw error
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    const error = new Error('Please enter a valid email address.')
    error.status = 400
    throw error
  }

  const existing = await findUserByEmail(cleanEmail)
  if (existing) {
    const error = new Error('Could not create account. Please try signing in.')
    error.status = 409
    throw error
  }

  const userId = newUserId()
  const passwordHash = await hashPassword(password)
  const db = getPool()
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO users (
         id, email, password_hash, name, phone, email_verified, provider, status
       ) VALUES ($1, $2, $3, $4, $5, FALSE, 'local', 'active')`,
      [userId, cleanEmail, passwordHash, cleanName, cleanPhone],
    )
    await client.query(
      `INSERT INTO subscriptions (id, user_id, plan, status, expires_at, activated_at)
       VALUES ($1, $2, NULL, 'none', NULL, NULL)`,
      [randomUUID(), userId],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    if (error?.code === '23505') {
      const dup = new Error('Could not create account. Please try signing in.')
      dup.status = 409
      throw dup
    }
    throw error
  } finally {
    client.release()
  }

  const row = await findUserById(userId)
  const tenantId = await ensureTenantForUser(row)
  await migrateLegacyLifetimeByEmail(cleanEmail, userId)
  return { user: mapUser(row), tenantId }
}

/**
 * If this email previously paid under the old profile system (no password user),
 * attach lifetime to the new permanent userId without trusting the client.
 */
async function migrateLegacyLifetimeByEmail(email, userId) {
  const db = getPool()
  const res = await db.query(
    `SELECT tenant_id, uid, subscription_status, status
     FROM profiles
     WHERE LOWER(email) = LOWER($1)
       AND (
         subscription_status = 'active'
         OR status = 'paid'
       )
       AND COALESCE(subscription_status, 'none') <> 'revoked'
     LIMIT 1`,
    [email],
  )
  const legacy = res.rows[0]
  if (!legacy) return

  await activateLifetimeSubscription(userId)

  // Point legacy profile at the new permanent userId when it was a different uid
  if (legacy.uid && legacy.uid !== userId) {
    await db.query(
      `UPDATE profiles
       SET uid = $2, updated_at = NOW()
       WHERE tenant_id = $1`,
      [legacy.tenant_id, userId],
    ).catch(() => undefined)
  }
}

const GENERIC_LOGIN_ERROR = 'Invalid email or password.'

export async function authenticateUser({ email, password }) {
  assertPostgres()
  const cleanEmail = normalizeEmail(email)
  const row = await findUserByEmail(cleanEmail)

  // Constant-ish failure path
  if (!row || row.status === 'disabled') {
    const error = new Error(GENERIC_LOGIN_ERROR)
    error.status = 401
    throw error
  }

  if (row.locked_until && new Date(row.locked_until) > new Date()) {
    const error = new Error('Account temporarily locked. Try again later.')
    error.status = 423
    throw error
  }

  const ok = await verifyPassword(password, row.password_hash)
  const db = getPool()
  if (!ok) {
    const attempts = Number(row.failed_login_attempts || 0) + 1
    const lock =
      attempts >= 8
        ? new Date(Date.now() + 15 * 60 * 1000).toISOString()
        : null
    await db.query(
      `UPDATE users
       SET failed_login_attempts = $2,
           locked_until = $3::timestamptz,
           updated_at = NOW()
       WHERE id = $1`,
      [row.id, attempts, lock],
    )
    const error = new Error(GENERIC_LOGIN_ERROR)
    error.status = 401
    throw error
  }

  await db.query(
    `UPDATE users
     SET failed_login_attempts = 0,
         locked_until = NULL,
         last_login_at = NOW(),
         updated_at = NOW()
     WHERE id = $1`,
    [row.id],
  )

  const fresh = await findUserById(row.id)
  const tenantId = await ensureTenantForUser(fresh)
  return { user: mapUser(fresh), tenantId }
}

export async function issueTokenPair(user, meta = {}) {
  const accessToken = await signAccessToken(user)
  const refreshRaw = createRefreshTokenRaw()
  const tokenHash = hashToken(refreshRaw)
  const expiresAt = refreshExpiryDate()
  const db = getPool()
  const id = randomUUID()
  await db.query(
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
  )
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
