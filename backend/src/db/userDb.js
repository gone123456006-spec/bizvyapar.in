import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import {
  ensureDataLayout,
  getTenantDbPath,
  getTenantDir,
  sanitizeTenantId,
} from './paths.js'
import { resolveTenant, listTenantIds } from './registry.js'
import { isPostgresEnabled } from './postgres.js'
import * as pg from './pgStore.js'
import { applyLifetimeEntitlement, shouldGrantLifetimeFromEnv } from '../subscription.js'

function emptyDatabase(tenantId) {
  const now = new Date().toISOString()
  return {
    version: 1,
    tenantId,
    createdAt: now,
    updatedAt: now,
    profile: {
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
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
    },
    payments: [],
    registrations: [],
    activity: [],
    reminders: [],
  }
}

const locks = new Map()

function withTenantLock(tenantId, fn) {
  const key = sanitizeTenantId(tenantId)
  const previous = locks.get(key) || Promise.resolve()
  const run = previous.then(fn, fn)
  locks.set(
    key,
    run.then(
      () => undefined,
      () => undefined,
    ),
  )
  return run
}

async function readTenantDb(tenantId) {
  const id = sanitizeTenantId(tenantId)
  try {
    const raw = await readFile(getTenantDbPath(id), 'utf8')
    const parsed = JSON.parse(raw)
    return {
      ...emptyDatabase(id),
      ...parsed,
      tenantId: id,
      profile: { ...emptyDatabase(id).profile, ...(parsed.profile || {}) },
      payments: Array.isArray(parsed.payments) ? parsed.payments : [],
      registrations: Array.isArray(parsed.registrations)
        ? parsed.registrations
        : [],
      activity: Array.isArray(parsed.activity) ? parsed.activity : [],
      reminders: Array.isArray(parsed.reminders) ? parsed.reminders : [],
    }
  } catch {
    return emptyDatabase(id)
  }
}

async function writeTenantDb(tenantId, db) {
  const id = sanitizeTenantId(tenantId)
  await ensureDataLayout()
  await mkdir(getTenantDir(id), { recursive: true })
  const target = getTenantDbPath(id)
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`
  const payload = {
    ...db,
    tenantId: id,
    updatedAt: new Date().toISOString(),
  }
  await writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8')
  await rename(tmp, target)
  return payload
}

function pushActivity(db, type, details = {}) {
  db.activity.unshift({
    id: randomUUID(),
    type,
    details,
    at: new Date().toISOString(),
  })
  db.activity = db.activity.slice(0, 100)
}

export async function touchLogin(identity) {
  if (isPostgresEnabled()) return pg.pgTouchLogin(identity)

  const { tenantId } = await resolveTenant(identity)
  return withTenantLock(tenantId, async () => {
    const db = await readTenantDb(tenantId)
    const now = new Date().toISOString()
    db.profile = {
      ...db.profile,
      tenantId,
      email: identity.email || db.profile.email || null,
      uid: identity.uid || db.profile.uid || null,
      name: identity.name || db.profile.name || null,
      phone: identity.phone || db.profile.phone || null,
      picture: identity.picture || db.profile.picture || null,
      provider: identity.provider || db.profile.provider || null,
      emailVerified: identity.emailVerified ?? db.profile.emailVerified ?? false,
      lastLoginAt: now,
      updatedAt: now,
    }

    // Recovery grant + keep existing lifetime fields intact across logins
    if (
      shouldGrantLifetimeFromEnv(db.profile.email) &&
      db.profile.subscriptionStatus !== 'revoked'
    ) {
      db.profile = applyLifetimeEntitlement(db.profile, now)
      pushActivity(db, 'subscription_granted', {
        source: 'LIFETIME_GRANT_EMAILS',
        subscriptionType: 'lifetime',
      })
    }

    pushActivity(db, 'login', { provider: identity.provider || null })
    const saved = await writeTenantDb(tenantId, db)
    return { tenantId, profile: saved.profile }
  })
}

export async function getOwnProfile(tenantId) {
  if (isPostgresEnabled()) return pg.pgGetOwnProfile(tenantId)

  return withTenantLock(tenantId, async () => {
    const db = await readTenantDb(tenantId)
    return {
      tenantId,
      profile: db.profile,
      paymentCount: db.payments.length,
      registrationCount: db.registrations.length,
      latestPayment: db.payments[0] || null,
      latestRegistration: db.registrations[0] || null,
    }
  })
}

export async function getOwnDatabaseSnapshot(tenantId) {
  if (isPostgresEnabled()) return pg.pgGetOwnDatabaseSnapshot(tenantId)
  return withTenantLock(tenantId, async () => readTenantDb(tenantId))
}

export async function upsertRegistration(identity, registration) {
  if (isPostgresEnabled()) return pg.pgUpsertRegistration(identity, registration)

  const { tenantId } = await resolveTenant(identity)
  return withTenantLock(tenantId, async () => {
    const db = await readTenantDb(tenantId)
    const now = new Date().toISOString()
    const email = String(registration.email || identity.email || '')
      .trim()
      .toLowerCase()

    db.profile = {
      ...db.profile,
      tenantId,
      email: email || db.profile.email,
      name: registration.name || db.profile.name,
      phone: registration.phone || db.profile.phone,
      updatedAt: now,
    }

    const existingIndex = db.registrations.findIndex(
      (entry) => entry.email === email,
    )
    const record = {
      id:
        existingIndex >= 0
          ? db.registrations[existingIndex].id
          : randomUUID(),
      name: registration.name,
      email,
      phone: registration.phone || null,
      status: registration.status || 'joined',
      joinedAt:
        existingIndex >= 0
          ? db.registrations[existingIndex].joinedAt
          : now,
      updatedAt: now,
    }

    if (existingIndex >= 0) {
      db.registrations[existingIndex] = {
        ...db.registrations[existingIndex],
        ...record,
      }
    } else {
      db.registrations.unshift(record)
      pushActivity(db, 'registration', { email, status: record.status })
    }

    const saved = await writeTenantDb(tenantId, db)
    return {
      tenantId,
      registration: saved.registrations.find((item) => item.email === email),
      alreadyJoined: existingIndex >= 0,
      profile: saved.profile,
    }
  })
}

export async function recordPayment(identity, payment) {
  if (isPostgresEnabled()) return pg.pgRecordPayment(identity, payment)

  const { tenantId } = await resolveTenant(identity)
  return withTenantLock(tenantId, async () => {
    const db = await readTenantDb(tenantId)
    const now = new Date().toISOString()
    const email = String(payment.email || identity.email || '')
      .trim()
      .toLowerCase()

    const duplicate = db.payments.find(
      (entry) => entry.paymentId === payment.paymentId,
    )
    if (duplicate) {
      return {
        tenantId,
        alreadyRecorded: true,
        profile: db.profile,
        payment: duplicate,
        registration:
          db.registrations.find((entry) => entry.email === email) || null,
      }
    }

    db.profile = applyLifetimeEntitlement(
      {
        ...db.profile,
        tenantId,
        email: email || db.profile.email,
        name: payment.name || db.profile.name,
        phone: payment.phone || db.profile.phone,
        uid: identity.uid || db.profile.uid,
      },
      now,
    )

    const paymentRecord = {
      id: randomUUID(),
      paymentId: payment.paymentId,
      orderId: payment.orderId,
      amount: payment.amount,
      currency: payment.currency || 'INR',
      status: 'paid',
      webinarLink: payment.webinarLink || null,
      email,
      name: payment.name,
      phone: payment.phone,
      paidAt: now,
    }

    db.payments.unshift(paymentRecord)

    const registrationIndex = db.registrations.findIndex(
      (entry) => entry.email === email,
    )
    const registration = {
      id:
        registrationIndex >= 0
          ? db.registrations[registrationIndex].id
          : randomUUID(),
      name: payment.name,
      email,
      phone: payment.phone,
      status: 'paid',
      paymentId: payment.paymentId,
      orderId: payment.orderId,
      amount: payment.amount,
      webinarLink: payment.webinarLink || null,
      paidAt: now,
      joinedAt:
        registrationIndex >= 0
          ? db.registrations[registrationIndex].joinedAt
          : now,
      updatedAt: now,
    }

    if (registrationIndex >= 0) {
      db.registrations[registrationIndex] = {
        ...db.registrations[registrationIndex],
        ...registration,
      }
    } else {
      db.registrations.unshift(registration)
    }

    pushActivity(db, 'payment', {
      paymentId: payment.paymentId,
      amount: payment.amount,
      subscriptionType: 'lifetime',
    })
    pushActivity(db, 'subscription_activated', {
      subscriptionType: 'lifetime',
      paymentId: payment.paymentId,
    })

    const saved = await writeTenantDb(tenantId, db)
    return {
      tenantId,
      alreadyRecorded: false,
      profile: saved.profile,
      payment: saved.payments[0],
      registration: saved.registrations.find((entry) => entry.email === email),
    }
  })
}

export async function findPaymentAnywhere(paymentId) {
  if (isPostgresEnabled()) return pg.pgFindPaymentById(paymentId)

  const ids = await listTenantIds()
  for (const tenantId of ids) {
    const db = await readTenantDb(tenantId)
    const found = db.payments.find((entry) => entry.paymentId === paymentId)
    if (found) return { ...found, tenantId }
  }
  return null
}

export async function listPaidRecipients() {
  if (isPostgresEnabled()) return pg.pgListPaidRecipients()

  const ids = await listTenantIds()
  const recipients = []
  for (const tenantId of ids) {
    const db = await readTenantDb(tenantId)
    const latest = db.payments[0]
    if (!latest || latest.status !== 'paid' || !latest.email) continue
    recipients.push({
      tenantId,
      paymentId: latest.paymentId,
      email: latest.email,
      name: latest.name || db.profile.name,
      webinarLink: latest.webinarLink || null,
      uid: db.profile.uid || null,
    })
  }
  return recipients
}

export async function hasReminder({ tenantId, paymentId, kind, workshopAt }) {
  if (isPostgresEnabled()) {
    return pg.pgHasReminder({ tenantId, paymentId, kind, workshopAt })
  }

  return withTenantLock(tenantId, async () => {
    const db = await readTenantDb(tenantId)
    const key = workshopAt.toISOString()
    return db.reminders.some(
      (item) =>
        item.paymentId === paymentId &&
        item.kind === kind &&
        item.workshopAt === key,
    )
  })
}

export async function markReminder({ tenantId, paymentId, kind, workshopAt }) {
  if (isPostgresEnabled()) {
    return pg.pgMarkReminder({ tenantId, paymentId, kind, workshopAt })
  }

  return withTenantLock(tenantId, async () => {
    const db = await readTenantDb(tenantId)
    db.reminders.unshift({
      id: randomUUID(),
      paymentId,
      kind,
      workshopAt: workshopAt.toISOString(),
      sentAt: new Date().toISOString(),
    })
    db.reminders = db.reminders.slice(0, 50)
    await writeTenantDb(tenantId, db)
  })
}

export function publicTenantFingerprint(tenantId) {
  return createHash('sha256')
    .update(String(tenantId))
    .digest('hex')
    .slice(0, 12)
}

export async function findTenantIdByEmail(email) {
  if (isPostgresEnabled()) return pg.pgFindTenantIdByEmail(email)
  const { findTenantIdByEmail: fileFind } = await import('./registry.js')
  return fileFind(email)
}

export async function findTenantIdByUid(uid) {
  if (isPostgresEnabled()) return pg.pgFindTenantIdByUid(uid)
  const { findTenantIdByUid: fileFind } = await import('./registry.js')
  return fileFind(uid)
}
