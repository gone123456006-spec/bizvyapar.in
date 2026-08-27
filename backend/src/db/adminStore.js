/**
 * Admin directory: users + payments + subscription (Postgres + file tenants).
 */

import { buildSubscription } from '../subscription.js'
import { isPostgresEnabled, getPool } from './postgres.js'
import { listTenantIds } from './registry.js'
import { getOwnDatabaseSnapshot } from './userDb.js'

function mapAdminUser({ profile, payments = [], paymentCount = 0 }) {
  const subscription = buildSubscription(profile || {}, paymentCount)
  const latest = payments[0] || null
  return {
    tenantId: profile?.tenantId || null,
    user: {
      name: profile?.name || null,
      email: profile?.email || null,
      phone: profile?.phone || null,
      uid: profile?.uid || null,
      provider: profile?.provider || null,
      emailVerified: Boolean(profile?.emailVerified),
      picture: profile?.picture || null,
      createdAt: profile?.createdAt || null,
      lastLoginAt: profile?.lastLoginAt || null,
      status: profile?.status || null,
    },
    subscription: {
      status: subscription.status,
      type: subscription.type,
      label: subscription.label,
      activatedAt: subscription.activatedAt,
      expiresAt: null,
    },
    payment: latest
      ? {
          paymentId: latest.paymentId,
          orderId: latest.orderId || null,
          amount: latest.amount ?? null,
          currency: latest.currency || 'INR',
          status: latest.status || null,
          paidAt: latest.paidAt || null,
          webinarLink: latest.webinarLink || null,
        }
      : null,
    paymentCount,
    payments: payments.map((item) => ({
      paymentId: item.paymentId,
      orderId: item.orderId || null,
      amount: item.amount ?? null,
      currency: item.currency || 'INR',
      status: item.status || null,
      paidAt: item.paidAt || null,
      webinarLink: item.webinarLink || null,
    })),
  }
}

async function listFromPostgres() {
  const db = getPool()
  const profiles = await db.query(
    `SELECT *
     FROM profiles
     ORDER BY COALESCE(last_login_at, updated_at, created_at) DESC`,
  )

  const payments = await db.query(
    `SELECT *
     FROM payments
     ORDER BY paid_at DESC`,
  )

  const paymentsByTenant = new Map()
  for (const row of payments.rows) {
    const list = paymentsByTenant.get(row.tenant_id) || []
    list.push({
      paymentId: row.payment_id,
      orderId: row.order_id,
      amount: row.amount,
      currency: row.currency,
      status: row.status,
      paidAt: row.paid_at,
      webinarLink: row.webinar_link,
    })
    paymentsByTenant.set(row.tenant_id, list)
  }

  return profiles.rows.map((row) => {
    const profile = {
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
    const tenantPayments = paymentsByTenant.get(row.tenant_id) || []
    return mapAdminUser({
      profile,
      payments: tenantPayments,
      paymentCount: tenantPayments.length,
    })
  })
}

async function listFromFiles() {
  const ids = await listTenantIds()
  const users = []
  for (const tenantId of ids) {
    const snap = await getOwnDatabaseSnapshot(tenantId)
    const payments = Array.isArray(snap.payments)
      ? [...snap.payments].sort(
          (a, b) => new Date(b.paidAt || 0).getTime() - new Date(a.paidAt || 0).getTime(),
        )
      : []
    users.push(
      mapAdminUser({
        profile: { ...(snap.profile || {}), tenantId },
        payments,
        paymentCount: payments.length,
      }),
    )
  }
  users.sort((a, b) => {
    const aTime = new Date(a.user.lastLoginAt || a.user.createdAt || 0).getTime()
    const bTime = new Date(b.user.lastLoginAt || b.user.createdAt || 0).getTime()
    return bTime - aTime
  })
  return users
}

export async function listAdminUsers() {
  if (isPostgresEnabled()) return listFromPostgres()
  return listFromFiles()
}
