/**
 * MongoDB-backed auth: users, subscriptions, refresh tokens, profiles.
 * Used when MONGODB_URI is set (preferred over Postgres).
 */
import { randomUUID } from 'node:crypto'
import { col, isMongoEnabled } from '../db/mongo.js'
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

function mapUser(doc) {
  if (!doc) return null
  const id = String(doc._id || doc.id)
  return {
    id,
    userId: id,
    uid: id,
    email: doc.email,
    name: doc.name,
    phone: doc.phone,
    emailVerified: Boolean(doc.emailVerified),
    provider: doc.provider || 'local',
    status: doc.status || 'active',
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    lastLoginAt: doc.lastLoginAt,
  }
}

function mapSubscription(doc) {
  if (!doc) {
    return {
      plan: null,
      status: 'none',
      expiresAt: null,
      activatedAt: null,
      label: 'No active subscription',
    }
  }
  const active = doc.status === 'active' && doc.plan === 'lifetime'
  return {
    plan: doc.plan || null,
    status: doc.status || 'none',
    expiresAt: doc.expiresAt || null,
    activatedAt: doc.activatedAt || null,
    label: active ? 'Subscription: Active' : 'No active subscription',
  }
}

function ACCESS_TTL_SECONDS() {
  const raw = String(process.env.ACCESS_TOKEN_TTL || '15m').trim()
  if (raw.endsWith('m')) return Number(raw.slice(0, -1)) * 60
  if (raw.endsWith('h')) return Number(raw.slice(0, -1)) * 3600
  if (raw.endsWith('s')) return Number(raw.slice(0, -1))
  return 900
}

export function assertMongoAuth() {
  if (!isMongoEnabled()) {
    const error = new Error('MongoDB is not configured (MONGODB_URI).')
    error.status = 503
    throw error
  }
}

export async function findUserByEmail(email) {
  assertMongoAuth()
  return col('users').findOne({ email: normalizeEmail(email) })
}

export async function findUserById(userId) {
  assertMongoAuth()
  return col('users').findOne({ _id: String(userId) })
}

export async function getSubscriptionByUserId(userId) {
  assertMongoAuth()
  const doc = await col('subscriptions').findOne({ userId: String(userId) })
  return mapSubscription(doc)
}

export async function isLifetimeActiveForUser(userId) {
  const sub = await getSubscriptionByUserId(userId)
  return sub.status === 'active' && sub.plan === 'lifetime'
}

export async function activateLifetimeSubscription(userId) {
  assertMongoAuth()
  const now = new Date()
  await col('subscriptions').updateOne(
    { userId: String(userId) },
    {
      $set: {
        plan: 'lifetime',
        status: 'active',
        activatedAt: now,
        updatedAt: now,
      },
      $setOnInsert: {
        _id: randomUUID(),
        userId: String(userId),
        expiresAt: null,
        createdAt: now,
      },
    },
    { upsert: true },
  )
  // Mirror on profile for admin views
  await col('profiles').updateOne(
    { uid: String(userId) },
    {
      $set: {
        subscriptionStatus: 'active',
        subscriptionType: 'lifetime',
        subscriptionActivatedAt: now,
        updatedAt: now,
      },
    },
  ).catch(() => undefined)
  return getSubscriptionByUserId(userId)
}

export async function ensureTenantForUser(user) {
  assertMongoAuth()
  const userId = String(user.id || user.userId || '').trim()
  const email = normalizeEmail(user.email)
  const name = sanitizeName(user.name) || null
  const phone = normalizePhone(user.phone)
  const tenantId = userId
    ? `uid_${userId}`
    : `email_${Buffer.from(email || 'unknown').toString('hex').slice(0, 40)}`
  const now = new Date()

  const existing = await col('profiles').findOne({
    $or: [
      ...(userId ? [{ uid: userId }, { tenantId: `uid_${userId}` }] : []),
      ...(email ? [{ email }] : []),
    ],
  })

  const id = existing?.tenantId || tenantId

  await col('profiles').updateOne(
    { tenantId: id },
    {
      $set: {
        email: email || existing?.email || null,
        uid: userId || existing?.uid || null,
        name: name || existing?.name || null,
        phone: phone || existing?.phone || null,
        provider: 'local',
        emailVerified: true,
        status: 'active',
        updatedAt: now,
      },
      $setOnInsert: {
        tenantId: id,
        createdAt: now,
        lastLoginAt: null,
        subscriptionStatus: 'none',
        subscriptionType: null,
        subscriptionActivatedAt: null,
      },
    },
    { upsert: true },
  )

  return id
}

export async function loginWithEmailPhone({ email, phone }) {
  assertMongoAuth()
  const { cleanEmail, cleanPhone } = validateEmailPhone({ email, phone })

  const existing = await findUserByEmail(cleanEmail)
  if (!existing || existing.status === 'disabled') {
    const error = new Error('No account found. Please Sign Up.')
    error.status = 404
    throw error
  }

  const userId = String(existing._id)
  const now = new Date()
  await col('users').updateOne(
    { _id: userId },
    {
      $set: {
        phone: cleanPhone,
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: now,
        updatedAt: now,
      },
    },
  )

  const user = mapUser({
    ...existing,
    phone: cleanPhone,
    lastLoginAt: now,
    updatedAt: now,
  })
  const tenantId = `uid_${user.id}`
  const subscription = await getSubscriptionByUserId(user.id)
  void ensureTenantForUser(user).catch(() => undefined)

  return { user, tenantId, created: false, subscription }
}

export async function registerUser({ name, email, phone }) {
  assertMongoAuth()
  const { cleanName, cleanEmail, cleanPhone } = validateIdentity({
    name,
    email,
    phone,
  })

  const existing = await findUserByEmail(cleanEmail)
  if (existing) {
    return loginWithEmailPhone({ email: cleanEmail, phone: cleanPhone })
  }

  const userId = newUserId()
  const now = new Date()
  try {
    await col('users').insertOne({
      _id: userId,
      email: cleanEmail,
      passwordHash: null,
      name: cleanName,
      phone: cleanPhone,
      emailVerified: false,
      provider: 'local',
      status: 'active',
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
    })
    await col('subscriptions').insertOne({
      _id: randomUUID(),
      userId,
      plan: null,
      status: 'none',
      expiresAt: null,
      activatedAt: null,
      createdAt: now,
      updatedAt: now,
    })
  } catch (error) {
    if (error?.code === 11000) {
      return loginWithEmailPhone({ email: cleanEmail, phone: cleanPhone })
    }
    throw error
  }

  const user = mapUser({
    _id: userId,
    email: cleanEmail,
    name: cleanName,
    phone: cleanPhone,
    emailVerified: false,
    provider: 'local',
    status: 'active',
    createdAt: now,
    updatedAt: now,
    lastLoginAt: null,
  })
  const tenantId = await ensureTenantForUser(user)

  return {
    user,
    tenantId,
    created: true,
    subscription: mapSubscription(null),
  }
}

export async function issueTokenPair(user, meta = {}) {
  assertMongoAuth()
  const refreshRaw = createRefreshTokenRaw()
  const tokenHash = hashToken(refreshRaw)
  const expiresAt = refreshExpiryDate()
  const id = randomUUID()
  const userId = String(user.id || user.userId)

  const [accessToken] = await Promise.all([
    signAccessToken(user),
    col('refresh_tokens').insertOne({
      _id: id,
      userId,
      tokenHash,
      expiresAt,
      revokedAt: null,
      userAgent: meta.userAgent || null,
      ip: meta.ip || null,
      createdAt: new Date(),
    }),
  ])

  return {
    accessToken,
    refreshToken: refreshRaw,
    expiresIn: ACCESS_TTL_SECONDS(),
    refreshExpiresAt: expiresAt.toISOString(),
  }
}

export async function rotateRefreshToken(refreshToken, meta = {}) {
  assertMongoAuth()
  const tokenHash = hashToken(refreshToken)
  const row = await col('refresh_tokens').findOne({ tokenHash })
  if (!row || row.revokedAt || new Date(row.expiresAt) <= new Date()) {
    const error = new Error('Session expired. Please sign in again.')
    error.status = 401
    throw error
  }

  await col('refresh_tokens').updateOne(
    { _id: row._id },
    { $set: { revokedAt: new Date() } },
  )

  const userRow = await findUserById(row.userId)
  if (!userRow || userRow.status === 'disabled') {
    const error = new Error('Session expired. Please sign in again.')
    error.status = 401
    throw error
  }

  const user = mapUser(userRow)
  const tokens = await issueTokenPair(user, meta)
  return { user, ...tokens }
}

export async function revokeRefreshToken(refreshToken) {
  assertMongoAuth()
  if (!refreshToken) return
  const tokenHash = hashToken(refreshToken)
  await col('refresh_tokens').updateOne(
    { tokenHash },
    { $set: { revokedAt: new Date() } },
  )
}

export async function revokeAllRefreshTokensForUser(userId) {
  assertMongoAuth()
  await col('refresh_tokens').updateMany(
    { userId: String(userId), revokedAt: null },
    { $set: { revokedAt: new Date() } },
  )
}

export async function updateUserProfile(userId, patch = {}) {
  assertMongoAuth()
  const updates = { updatedAt: new Date() }
  if (patch.name != null) updates.name = sanitizeName(patch.name)
  if (patch.phone != null) updates.phone = normalizePhone(patch.phone)
  await col('users').updateOne({ _id: String(userId) }, { $set: updates })
  const row = await findUserById(userId)
  const user = mapUser(row)
  await ensureTenantForUser(user)
  return user
}

export async function signInWithDetails({ name, email, phone }) {
  const existing = await findUserByEmail(normalizeEmail(email))
  if (existing) return loginWithEmailPhone({ email, phone })
  return registerUser({ name, email, phone })
}

export async function authenticateUser(input) {
  return loginWithEmailPhone(input)
}

export { mapUser, mapSubscription, normalizeEmail, normalizePhone, sanitizeName }
