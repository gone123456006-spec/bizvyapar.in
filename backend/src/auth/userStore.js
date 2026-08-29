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

function validateIdentity({ name, email, phone }) {
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
  if (!cleanPhone || cleanPhone.length !== 10) {
    const error = new Error('Please enter a valid 10-digit mobile number.')
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
 * Reuses an existing tenant by email (or uid) so legacy paid emails
 * never hit tenants_email_key duplicates.
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

  const existing = await db.query(
    `SELECT tenant_id, email, uid FROM tenants
     WHERE ($1::text IS NOT NULL AND uid = $1)
        OR ($2::text IS NOT NULL AND email = $2)
     LIMIT 1`,
    [userId || null, email || null],
  )

  const tenantId = existing.rows[0]?.tenant_id || `uid_${userId}`

  if (existing.rows[0]) {
    await db.query(
      `UPDATE tenants
       SET email = COALESCE($2, email),
           uid = COALESCE($3, uid),
           updated_at = $4::timestamptz
       WHERE tenant_id = $1`,
      [tenantId, email, userId || null, now],
    )
  } else {
    try {
      await db.query(
        `INSERT INTO tenants (tenant_id, email, uid, created_at, updated_at)
         VALUES ($1, $2, $3, $4::timestamptz, $4::timestamptz)`,
        [tenantId, email, userId || null, now],
      )
    } catch (error) {
      if (error?.code === '23505') {
        // Race: email claimed between select and insert — claim existing row
        const again = await db.query(
          `SELECT tenant_id FROM tenants WHERE email = $1 LIMIT 1`,
          [email],
        )
        const claimed = again.rows[0]?.tenant_id
        if (claimed) {
          await db.query(
            `UPDATE tenants
             SET uid = COALESCE($2, uid), updated_at = $3::timestamptz
             WHERE tenant_id = $1`,
            [claimed, userId || null, now],
          )
          await upsertProfileForTenant(db, claimed, {
            email,
            userId,
            name,
            phone,
            now,
          })
          return claimed
        }
        const friendly = new Error(
          'This email is already registered. Try signing in.',
        )
        friendly.status = 409
        throw friendly
      }
      throw error
    }
  }

  await upsertProfileForTenant(db, tenantId, {
    email,
    userId,
    name,
    phone,
    now,
  })
  return tenantId
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
 * Name + Email + Phone auth (no password).
 * - New Gmail → create permanent random UUID userId + subscription row
 * - Existing Gmail → must use the exact same mobile to open same userId + subscription
 * - Name is required, but returning users are keyed by Gmail + mobile
 */
export async function signInWithDetails({ name, email, phone }) {
  assertPostgres()
  const { cleanName, cleanEmail, cleanPhone } = validateIdentity({
    name,
    email,
    phone,
  })

  const existing = await findUserByEmail(cleanEmail)
  if (existing) {
    if (existing.status === 'disabled') {
      const error = new Error('This account is unavailable. Contact support.')
      error.status = 403
      throw error
    }

    const storedPhone = normalizePhone(existing.phone)
    const phoneMissing = !storedPhone
    const phoneOk = storedPhone === cleanPhone

    // Returning user must enter the exact same mobile for this Gmail
    if (!phoneMissing && !phoneOk) {
      const error = new Error(
        'Use the same Gmail and mobile number registered on this account.',
      )
      error.status = 401
      throw error
    }

    const db = getPool()
    await db.query(
      `UPDATE users
       SET name = $2,
           phone = $3,
           failed_login_attempts = 0,
           locked_until = NULL,
           last_login_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [existing.id, cleanName, cleanPhone],
    )
    const fresh = await findUserById(existing.id)
    const tenantId = await ensureTenantForUser(fresh)
    return { user: mapUser(fresh), tenantId, created: false }
  }

  const userId = newUserId()
  const subId = randomUUID()
  const db = getPool()
  const client = await db.connect()
  let row
  try {
    await client.query('BEGIN')
    const inserted = await client.query(
      `INSERT INTO users (
         id, email, password_hash, name, phone, email_verified, provider, status
       ) VALUES ($1, $2, NULL, $3, $4, FALSE, 'local', 'active')
       RETURNING *`,
      [userId, cleanEmail, cleanName, cleanPhone],
    )
    row = inserted.rows[0]
    await client.query(
      `INSERT INTO subscriptions (id, user_id, plan, status, expires_at, activated_at)
       VALUES ($1, $2, NULL, 'none', NULL, NULL)`,
      [subId, userId],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    if (error?.code === '23505') {
      return signInWithDetails({ name, email, phone })
    }
    throw error
  } finally {
    client.release()
  }

  const user = mapUser(row)
  const [tenantId] = await Promise.all([
    ensureTenantForUser(user),
    migrateLegacyLifetimeByEmail(cleanEmail, userId),
  ])
  return { user, tenantId, created: true }
}

/** @deprecated use signInWithDetails — kept for route compatibility */
export async function registerUser(input) {
  return signInWithDetails(input)
}

/** @deprecated use signInWithDetails — kept for route compatibility */
export async function authenticateUser(input) {
  return signInWithDetails(input)
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
  if (!legacy) return

  await activateLifetimeSubscription(userId)

  if (legacy.uid && legacy.uid !== userId) {
    await db.query(
      `UPDATE profiles
       SET uid = $2, updated_at = NOW()
       WHERE tenant_id = $1`,
      [legacy.tenant_id, userId],
    ).catch(() => undefined)
  }
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
