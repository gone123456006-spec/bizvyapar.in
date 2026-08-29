import { randomUUID } from 'node:crypto'
import { getPool } from './postgres.js'
import { shouldGrantLifetimeFromEnv } from '../subscription.js'

async function upsertTenant(client, { email, uid }) {
  const normalizedEmail = email ? String(email).trim().toLowerCase() : null
  const normalizedUid = uid ? String(uid).trim() : null

  if (!normalizedEmail && !normalizedUid) {
    const error = new Error('Cannot create user profile without email or uid.')
    error.status = 400
    throw error
  }

  const existing = await client.query(
    `SELECT tenant_id, email, uid FROM tenants
     WHERE ($1::text IS NOT NULL AND uid = $1)
        OR ($2::text IS NOT NULL AND email = $2)
     LIMIT 1`,
    [normalizedUid, normalizedEmail],
  )

  const now = new Date().toISOString()

  if (existing.rows[0]) {
    const tenantId = existing.rows[0].tenant_id
    await client.query(
      `UPDATE tenants
       SET email = COALESCE($2, email),
           uid = COALESCE(uid, $3),
           updated_at = $4::timestamptz
       WHERE tenant_id = $1`,
      [tenantId, normalizedEmail, normalizedUid, now],
    )
    return tenantId
  }

  const tenantId = normalizedUid
    ? `uid_${normalizedUid}`
    : `email_${Buffer.from(normalizedEmail).toString('hex').slice(0, 40)}`

  await client.query(
    `INSERT INTO tenants (tenant_id, email, uid, created_at, updated_at)
     VALUES ($1, $2, $3, $4::timestamptz, $4::timestamptz)
     ON CONFLICT (tenant_id) DO UPDATE
       SET email = COALESCE(EXCLUDED.email, tenants.email),
           uid = COALESCE(EXCLUDED.uid, tenants.uid),
           updated_at = EXCLUDED.updated_at`,
    [tenantId, normalizedEmail, normalizedUid, now],
  )

  return tenantId
}

async function ensureProfile(client, tenantId, identity = {}) {
  const now = new Date().toISOString()
  await client.query(
    `INSERT INTO profiles (
       tenant_id, email, uid, name, phone, picture, provider,
       email_verified, status, created_at, updated_at, last_login_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, 'active', $9::timestamptz, $9::timestamptz, NULL
     )
     ON CONFLICT (tenant_id) DO UPDATE SET
       email = COALESCE(EXCLUDED.email, profiles.email),
       uid = COALESCE(profiles.uid, EXCLUDED.uid),
       name = COALESCE(EXCLUDED.name, profiles.name),
       phone = COALESCE(EXCLUDED.phone, profiles.phone),
       picture = COALESCE(EXCLUDED.picture, profiles.picture),
       provider = COALESCE(EXCLUDED.provider, profiles.provider),
       email_verified = COALESCE(EXCLUDED.email_verified, profiles.email_verified),
       updated_at = EXCLUDED.updated_at`,
    [
      tenantId,
      identity.email || null,
      identity.uid || null,
      identity.name || null,
      identity.phone || null,
      identity.picture || null,
      identity.provider || null,
      Boolean(identity.emailVerified),
      now,
    ],
  )
}

async function addActivity(client, tenantId, type, details = {}) {
  await client.query(
    `INSERT INTO activity (id, tenant_id, type, details, at)
     VALUES ($1, $2, $3, $4::jsonb, NOW())`,
    [randomUUID(), tenantId, type, JSON.stringify(details)],
  )
}

async function loadProfile(client, tenantId) {
  const result = await client.query(
    `SELECT * FROM profiles WHERE tenant_id = $1`,
    [tenantId],
  )
  const row = result.rows[0]
  if (!row) return null
  return {
    tenantId: row.tenant_id,
    email: row.email,
    uid: row.uid,
    name: row.name,
    phone: row.phone,
    picture: row.picture,
    provider: row.provider,
    emailVerified: row.email_verified,
    status: row.status,
    subscriptionStatus: row.subscription_status || 'none',
    subscriptionType: row.subscription_type || null,
    subscriptionActivatedAt: row.subscription_activated_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
  }
}

function mapPayment(row) {
  if (!row) return null
  return {
    id: row.id,
    paymentId: row.payment_id,
    orderId: row.order_id,
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    webinarLink: row.webinar_link,
    email: row.email,
    name: row.name,
    phone: row.phone,
    paidAt: row.paid_at,
  }
}

function mapRegistration(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    status: row.status,
    paymentId: row.payment_id,
    orderId: row.order_id,
    amount: row.amount,
    webinarLink: row.webinar_link,
    paidAt: row.paid_at,
    joinedAt: row.joined_at,
    updatedAt: row.updated_at,
  }
}

export async function pgFindTenantIdByEmail(email) {
  const db = getPool()
  const normalized = String(email || '').trim().toLowerCase()
  if (!normalized) return null
  const result = await db.query(
    `SELECT tenant_id FROM tenants WHERE email = $1 LIMIT 1`,
    [normalized],
  )
  return result.rows[0]?.tenant_id || null
}

export async function pgFindTenantIdByUid(uid) {
  const db = getPool()
  const id = String(uid || '').trim()
  if (!id) return null
  const result = await db.query(
    `SELECT tenant_id FROM tenants WHERE uid = $1 LIMIT 1`,
    [id],
  )
  return result.rows[0]?.tenant_id || null
}

export async function pgTouchLogin(identity) {
  const db = getPool()
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const tenantId = await upsertTenant(client, identity)
    await ensureProfile(client, tenantId, identity)
    const now = new Date().toISOString()
    await client.query(
      `UPDATE profiles
       SET last_login_at = $2::timestamptz,
           updated_at = $2::timestamptz,
           email = COALESCE($3, email),
           uid = COALESCE(uid, $4),
           name = COALESCE($5, name),
           phone = COALESCE($6, phone),
           picture = COALESCE($7, picture),
           provider = COALESCE($8, provider),
           email_verified = COALESCE($9, email_verified)
       WHERE tenant_id = $1`,
      [
        tenantId,
        now,
        identity.email || null,
        identity.uid || null,
        identity.name || null,
        identity.phone || null,
        identity.picture || null,
        identity.provider || null,
        identity.emailVerified ?? null,
      ],
    )

    // Restore/grant lifetime for recovery emails without wiping other users
    if (shouldGrantLifetimeFromEnv(identity.email)) {
      await client.query(
        `UPDATE profiles
         SET status = 'paid',
             subscription_status = 'active',
             subscription_type = 'lifetime',
             subscription_activated_at = COALESCE(subscription_activated_at, NOW()),
             updated_at = NOW()
         WHERE tenant_id = $1
           AND COALESCE(subscription_status, 'none') <> 'revoked'`,
        [tenantId],
      )
      await addActivity(client, tenantId, 'subscription_granted', {
        source: 'LIFETIME_GRANT_EMAILS',
        subscriptionType: 'lifetime',
      })
    }

    await addActivity(client, tenantId, 'login', {
      provider: identity.provider || null,
    })
    await client.query('COMMIT')
    const profile = await loadProfile(client, tenantId)
    return { tenantId, profile }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function pgGetOwnProfile(tenantId) {
  const db = getPool()
  const profileRes = await db.query(`SELECT * FROM profiles WHERE tenant_id = $1`, [
    tenantId,
  ])
  const row = profileRes.rows[0]
  if (!row) {
    return {
      tenantId,
      profile: null,
      paymentCount: 0,
      registrationCount: 0,
      latestPayment: null,
      latestRegistration: null,
    }
  }

  const payments = await db.query(
    `SELECT * FROM payments WHERE tenant_id = $1 ORDER BY paid_at DESC LIMIT 1`,
    [tenantId],
  )
  const regs = await db.query(
    `SELECT * FROM registrations WHERE tenant_id = $1 ORDER BY updated_at DESC LIMIT 1`,
    [tenantId],
  )
  const counts = await db.query(
    `SELECT
       (SELECT COUNT(*)::int FROM payments WHERE tenant_id = $1) AS payment_count,
       (SELECT COUNT(*)::int FROM registrations WHERE tenant_id = $1) AS registration_count`,
    [tenantId],
  )

  return {
    tenantId,
    profile: {
      tenantId: row.tenant_id,
      email: row.email,
      uid: row.uid,
      name: row.name,
      phone: row.phone,
      picture: row.picture,
      provider: row.provider,
      emailVerified: row.email_verified,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastLoginAt: row.last_login_at,
    },
    paymentCount: counts.rows[0].payment_count,
    registrationCount: counts.rows[0].registration_count,
    latestPayment: mapPayment(payments.rows[0]),
    latestRegistration: mapRegistration(regs.rows[0]),
  }
}

export async function pgGetOwnDatabaseSnapshot(tenantId) {
  const db = getPool()
  const profileRes = await db.query(`SELECT * FROM profiles WHERE tenant_id = $1`, [
    tenantId,
  ])
  const payments = await db.query(
    `SELECT * FROM payments WHERE tenant_id = $1 ORDER BY paid_at DESC`,
    [tenantId],
  )
  const regs = await db.query(
    `SELECT * FROM registrations WHERE tenant_id = $1 ORDER BY updated_at DESC`,
    [tenantId],
  )
  const activity = await db.query(
    `SELECT * FROM activity WHERE tenant_id = $1 ORDER BY at DESC LIMIT 100`,
    [tenantId],
  )
  const row = profileRes.rows[0]
  return {
    version: 1,
    tenantId,
    profile: row
      ? {
          tenantId: row.tenant_id,
          email: row.email,
          uid: row.uid,
          name: row.name,
          phone: row.phone,
          picture: row.picture,
          provider: row.provider,
          emailVerified: row.email_verified,
          status: row.status,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          lastLoginAt: row.last_login_at,
        }
      : null,
    payments: payments.rows.map(mapPayment),
    registrations: regs.rows.map(mapRegistration),
    activity: activity.rows.map((item) => ({
      id: item.id,
      type: item.type,
      details: item.details,
      at: item.at,
    })),
  }
}

export async function pgUpsertRegistration(identity, registration) {
  const db = getPool()
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const tenantId = await upsertTenant(client, identity)
    await ensureProfile(client, tenantId, {
      ...identity,
      name: registration.name,
      phone: registration.phone,
      email: registration.email,
    })

    const email = String(registration.email || identity.email || '')
      .trim()
      .toLowerCase()
    const existing = await client.query(
      `SELECT id, joined_at FROM registrations WHERE tenant_id = $1 AND email = $2`,
      [tenantId, email],
    )
    const alreadyJoined = existing.rows.length > 0
    const id = alreadyJoined ? existing.rows[0].id : randomUUID()
    const joinedAt = alreadyJoined
      ? existing.rows[0].joined_at
      : new Date().toISOString()

    await client.query(
      `INSERT INTO registrations (
         id, tenant_id, email, name, phone, status, joined_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz, NOW())
       ON CONFLICT (tenant_id, email) DO UPDATE SET
         name = EXCLUDED.name,
         phone = COALESCE(EXCLUDED.phone, registrations.phone),
         status = EXCLUDED.status,
         updated_at = NOW()`,
      [
        id,
        tenantId,
        email,
        registration.name,
        registration.phone || null,
        registration.status || 'joined',
        joinedAt,
      ],
    )

    if (!alreadyJoined) {
      await addActivity(client, tenantId, 'registration', {
        email,
        status: registration.status || 'joined',
      })
    }

    await client.query('COMMIT')
    const reg = await client.query(
      `SELECT * FROM registrations WHERE tenant_id = $1 AND email = $2`,
      [tenantId, email],
    )
    const profile = await loadProfile(client, tenantId)
    return {
      tenantId,
      alreadyJoined,
      registration: mapRegistration(reg.rows[0]),
      profile,
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function pgRecordPayment(identity, payment) {
  const db = getPool()
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const tenantId = await upsertTenant(client, identity)
    await ensureProfile(client, tenantId, {
      ...identity,
      name: payment.name,
      phone: payment.phone,
      email: payment.email,
    })

    const email = String(payment.email || identity.email || '')
      .trim()
      .toLowerCase()

    const existingPay = await client.query(
      `SELECT * FROM payments WHERE payment_id = $1 LIMIT 1`,
      [payment.paymentId],
    )

    if (existingPay.rows[0]) {
      const row = existingPay.rows[0]
      if (row.tenant_id !== tenantId) {
        const error = new Error('Payment already belongs to another account.')
        error.status = 409
        throw error
      }
      await client.query('COMMIT')
      const profile = await loadProfile(client, tenantId)
      const reg = await client.query(
        `SELECT * FROM registrations WHERE tenant_id = $1 AND email = $2`,
        [tenantId, email],
      )
      return {
        tenantId,
        alreadyRecorded: true,
        profile,
        payment: mapPayment(row),
        registration: mapRegistration(reg.rows[0]),
      }
    }

    const paymentRowId = randomUUID()
    await client.query(
      `INSERT INTO payments (
         id, tenant_id, payment_id, order_id, amount, currency, status,
         webinar_link, email, name, phone, paid_at
       ) VALUES ($1,$2,$3,$4,$5,$6,'paid',$7,$8,$9,$10,NOW())`,
      [
        paymentRowId,
        tenantId,
        payment.paymentId,
        payment.orderId || null,
        payment.amount,
        payment.currency || 'INR',
        payment.webinarLink || null,
        email,
        payment.name,
        payment.phone,
      ],
    )

    await client.query(
      `UPDATE profiles
       SET status = 'paid',
           subscription_status = 'active',
           subscription_type = 'lifetime',
           subscription_activated_at = COALESCE(subscription_activated_at, NOW()),
           name = COALESCE($2, name),
           phone = COALESCE($3, phone),
           email = COALESCE($4, email),
           updated_at = NOW()
       WHERE tenant_id = $1`,
      [tenantId, payment.name || null, payment.phone || null, email],
    )

    const existingReg = await client.query(
      `SELECT id, joined_at FROM registrations WHERE tenant_id = $1 AND email = $2`,
      [tenantId, email],
    )
    const regId = existingReg.rows[0]?.id || randomUUID()
    const joinedAt = existingReg.rows[0]?.joined_at || new Date().toISOString()

    await client.query(
      `INSERT INTO registrations (
         id, tenant_id, email, name, phone, status, payment_id, order_id,
         amount, webinar_link, paid_at, joined_at, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,'paid',$6,$7,$8,$9,NOW(),$10::timestamptz,NOW()
       )
       ON CONFLICT (tenant_id, email) DO UPDATE SET
         name = EXCLUDED.name,
         phone = EXCLUDED.phone,
         status = 'paid',
         payment_id = EXCLUDED.payment_id,
         order_id = EXCLUDED.order_id,
         amount = EXCLUDED.amount,
         webinar_link = EXCLUDED.webinar_link,
         paid_at = NOW(),
         updated_at = NOW()`,
      [
        regId,
        tenantId,
        email,
        payment.name,
        payment.phone,
        payment.paymentId,
        payment.orderId || null,
        payment.amount,
        payment.webinarLink || null,
        joinedAt,
      ],
    )

    await addActivity(client, tenantId, 'payment', {
      paymentId: payment.paymentId,
      amount: payment.amount,
      subscriptionType: 'lifetime',
    })
    await addActivity(client, tenantId, 'subscription_activated', {
      subscriptionType: 'lifetime',
      paymentId: payment.paymentId,
    })

    await client.query('COMMIT')

    const profile = await loadProfile(client, tenantId)
    const pay = await client.query(`SELECT * FROM payments WHERE payment_id = $1`, [
      payment.paymentId,
    ])
    const reg = await client.query(
      `SELECT * FROM registrations WHERE tenant_id = $1 AND email = $2`,
      [tenantId, email],
    )

    return {
      tenantId,
      alreadyRecorded: false,
      profile,
      payment: mapPayment(pay.rows[0]),
      registration: mapRegistration(reg.rows[0]),
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function pgListPaidRecipients() {
  const db = getPool()
  const result = await db.query(
    `SELECT DISTINCT ON (p.tenant_id)
       p.tenant_id,
       p.payment_id,
       p.email,
       p.name,
       p.webinar_link,
       pr.uid
     FROM payments p
     JOIN profiles pr ON pr.tenant_id = p.tenant_id
     WHERE p.status = 'paid' AND p.email IS NOT NULL
     ORDER BY p.tenant_id, p.paid_at DESC`,
  )
  return result.rows.map((row) => ({
    tenantId: row.tenant_id,
    paymentId: row.payment_id,
    email: row.email,
    name: row.name,
    webinarLink: row.webinar_link,
    uid: row.uid,
  }))
}

export async function pgHasReminder({ tenantId, paymentId, kind, workshopAt }) {
  const db = getPool()
  const result = await db.query(
    `SELECT 1 FROM reminder_log
     WHERE tenant_id = $1 AND payment_id = $2 AND kind = $3 AND workshop_at = $4::timestamptz
     LIMIT 1`,
    [tenantId, paymentId, kind, workshopAt.toISOString()],
  )
  return result.rows.length > 0
}

export async function pgMarkReminder({ tenantId, paymentId, kind, workshopAt }) {
  const db = getPool()
  await db.query(
    `INSERT INTO reminder_log (id, tenant_id, payment_id, kind, workshop_at, sent_at)
     VALUES ($1,$2,$3,$4,$5::timestamptz,NOW())
     ON CONFLICT (tenant_id, payment_id, kind, workshop_at) DO NOTHING`,
    [randomUUID(), tenantId, paymentId, kind, workshopAt.toISOString()],
  )
}

export async function pgFindPaymentById(paymentId) {
  const db = getPool()
  const result = await db.query(
    `SELECT * FROM payments WHERE payment_id = $1 LIMIT 1`,
    [paymentId],
  )
  const row = result.rows[0]
  if (!row) return null
  return { ...mapPayment(row), tenantId: row.tenant_id }
}
