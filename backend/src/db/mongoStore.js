/**
 * Mongo tenant/profile/payment/registration store (BizVyapar website data).
 */
import { randomUUID } from 'node:crypto'
import { col } from './mongo.js'
import { shouldGrantLifetimeFromEnv } from '../subscription.js'
import { activateLifetimeSubscription } from '../auth/mongoUserStore.js'

function normEmail(email) {
  return email ? String(email).trim().toLowerCase() : null
}

function normUid(uid) {
  return uid ? String(uid).trim() : null
}

async function resolveTenantId({ email, uid }) {
  const normalizedEmail = normEmail(email)
  const normalizedUid = normUid(uid)
  if (!normalizedEmail && !normalizedUid) {
    const error = new Error('Cannot create user profile without email or uid.')
    error.status = 400
    throw error
  }

  const existing = await col('profiles').findOne({
    $or: [
      ...(normalizedUid
        ? [{ uid: normalizedUid }, { tenantId: `uid_${normalizedUid}` }]
        : []),
      ...(normalizedEmail ? [{ email: normalizedEmail }] : []),
    ],
  })
  if (existing?.tenantId) return existing.tenantId

  return normalizedUid
    ? `uid_${normalizedUid}`
    : `email_${Buffer.from(normalizedEmail).toString('hex').slice(0, 40)}`
}

function mapProfile(doc, tenantId) {
  if (!doc) {
    return {
      tenantId,
      email: null,
      uid: null,
      name: null,
      phone: null,
      picture: null,
      provider: null,
      emailVerified: false,
      status: 'active',
      subscriptionStatus: 'none',
      subscriptionType: null,
      subscriptionActivatedAt: null,
      createdAt: null,
      updatedAt: null,
      lastLoginAt: null,
    }
  }
  return {
    tenantId: doc.tenantId,
    email: doc.email || null,
    uid: doc.uid || null,
    name: doc.name || null,
    phone: doc.phone || null,
    picture: doc.picture || null,
    provider: doc.provider || null,
    emailVerified: Boolean(doc.emailVerified),
    status: doc.status || 'active',
    subscriptionStatus: doc.subscriptionStatus || 'none',
    subscriptionType: doc.subscriptionType || null,
    subscriptionActivatedAt: doc.subscriptionActivatedAt || null,
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null,
    lastLoginAt: doc.lastLoginAt || null,
  }
}

export async function mongoTouchLogin(identity) {
  const tenantId = await resolveTenantId(identity)
  const now = new Date()
  await col('profiles').updateOne(
    { tenantId },
    {
      $set: {
        email: normEmail(identity.email),
        uid: normUid(identity.uid),
        name: identity.name || null,
        phone: identity.phone || null,
        picture: identity.picture || null,
        provider: identity.provider || 'local',
        emailVerified: Boolean(identity.emailVerified),
        status: 'active',
        lastLoginAt: now,
        updatedAt: now,
      },
      $setOnInsert: {
        tenantId,
        createdAt: now,
        subscriptionStatus: 'none',
        subscriptionType: null,
        subscriptionActivatedAt: null,
      },
    },
    { upsert: true },
  )
  await col('activity').insertOne({
    _id: randomUUID(),
    tenantId,
    type: 'login',
    details: { provider: identity.provider || 'local' },
    at: now,
  })
  const profile = await col('profiles').findOne({ tenantId })
  return { tenantId, profile: mapProfile(profile, tenantId) }
}

export async function mongoGetOwnProfile(tenantId) {
  const profile = await col('profiles').findOne({ tenantId: String(tenantId) })
  const payments = await col('payments')
    .find({ tenantId: String(tenantId) })
    .sort({ paidAt: -1 })
    .limit(20)
    .toArray()
  const latestPayment = payments[0] || null
  return {
    profile: mapProfile(profile, tenantId),
    latestPayment,
    summary: {
      latestPayment,
      paymentCount: payments.length,
    },
  }
}

export async function mongoGetOwnDatabaseSnapshot(tenantId) {
  const id = String(tenantId)
  const [profile, payments, registrations, activity] = await Promise.all([
    col('profiles').findOne({ tenantId: id }),
    col('payments').find({ tenantId: id }).sort({ paidAt: -1 }).toArray(),
    col('registrations').find({ tenantId: id }).sort({ joinedAt: -1 }).toArray(),
    col('activity').find({ tenantId: id }).sort({ at: -1 }).limit(50).toArray(),
  ])
  return {
    tenantId: id,
    profile: mapProfile(profile, id),
    payments,
    registrations,
    activity,
  }
}

export async function mongoUpsertRegistration(identity, registration) {
  const tenantId = await resolveTenantId(identity)
  const email = normEmail(registration.email || identity.email)
  const now = new Date()
  await col('profiles').updateOne(
    { tenantId },
    {
      $set: {
        email,
        uid: normUid(identity.uid),
        name: registration.name || identity.name || null,
        phone: registration.phone || identity.phone || null,
        updatedAt: now,
      },
      $setOnInsert: {
        tenantId,
        createdAt: now,
        status: 'active',
        subscriptionStatus: 'none',
      },
    },
    { upsert: true },
  )
  await col('registrations').updateOne(
    { tenantId, email },
    {
      $set: {
        name: registration.name || null,
        phone: registration.phone || null,
        status: registration.status || 'joined',
        paymentId: registration.paymentId || null,
        orderId: registration.orderId || null,
        updatedAt: now,
      },
      $setOnInsert: {
        _id: randomUUID(),
        tenantId,
        email,
        joinedAt: now,
      },
    },
    { upsert: true },
  )
  await col('activity').insertOne({
    _id: randomUUID(),
    tenantId,
    type: 'registration',
    details: { email },
    at: now,
  })
  return { tenantId }
}

export async function mongoRecordPayment(identity, payment) {
  const tenantId = await resolveTenantId(identity)
  const userId = normUid(identity.uid)
  const now = new Date()
  const paymentId = String(payment.paymentId || payment.id)
  const doc = {
    _id: payment.id || randomUUID(),
    tenantId,
    userId,
    paymentId,
    orderId: payment.orderId || null,
    amount: payment.amount ?? null,
    currency: payment.currency || 'INR',
    status: payment.status || 'paid',
    webinarLink: payment.webinarLink || null,
    email: normEmail(payment.email || identity.email),
    name: payment.name || identity.name || null,
    phone: payment.phone || identity.phone || null,
    paidAt: payment.paidAt ? new Date(payment.paidAt) : now,
    createdAt: now,
  }

  await col('payments').updateOne(
    { paymentId },
    { $set: doc },
    { upsert: true },
  )

  if (userId) {
    await activateLifetimeSubscription(userId)
  }

  await col('profiles').updateOne(
    { tenantId },
    {
      $set: {
        email: doc.email,
        uid: userId,
        name: doc.name,
        phone: doc.phone,
        status: 'paid',
        subscriptionStatus: 'active',
        subscriptionType: 'lifetime',
        subscriptionActivatedAt: now,
        updatedAt: now,
      },
      $setOnInsert: { tenantId, createdAt: now },
    },
    { upsert: true },
  )

  if (doc.email) {
    await col('registrations').updateOne(
      { tenantId, email: doc.email },
      {
        $set: {
          name: doc.name,
          phone: doc.phone,
          status: 'paid',
          paymentId,
          orderId: doc.orderId,
          updatedAt: now,
        },
        $setOnInsert: {
          _id: randomUUID(),
          tenantId,
          email: doc.email,
          joinedAt: now,
        },
      },
      { upsert: true },
    )
  }

  await col('activity').insertOne({
    _id: randomUUID(),
    tenantId,
    type: 'payment',
    details: { paymentId, amount: doc.amount },
    at: now,
  })

  if (shouldGrantLifetimeFromEnv(doc.email)) {
    if (userId) await activateLifetimeSubscription(userId)
  }

  return { tenantId, saved: doc }
}

export async function mongoFindPaymentById(paymentId) {
  const doc = await col('payments').findOne({ paymentId: String(paymentId) })
  if (!doc) return null
  return { ...doc, tenantId: doc.tenantId }
}

export async function mongoListPaidRecipients() {
  const rows = await col('profiles')
    .find({
      $or: [
        { subscriptionStatus: 'active' },
        { status: 'paid' },
      ],
    })
    .project({ email: 1, name: 1, phone: 1, uid: 1, tenantId: 1 })
    .toArray()
  return rows
    .filter((r) => r.email)
    .map((r) => ({
      email: r.email,
      name: r.name,
      phone: r.phone,
      uid: r.uid,
      tenantId: r.tenantId,
    }))
}

export async function mongoFindTenantIdByEmail(email) {
  const doc = await col('profiles').findOne({ email: normEmail(email) })
  return doc?.tenantId || null
}

export async function mongoFindTenantIdByUid(uid) {
  const normalized = normUid(uid)
  const doc = await col('profiles').findOne({
    $or: [{ uid: normalized }, { tenantId: `uid_${normalized}` }],
  })
  return doc?.tenantId || null
}
