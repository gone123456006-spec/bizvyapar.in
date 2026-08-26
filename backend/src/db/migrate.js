import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { getDataDir, ensureDataLayout } from './paths.js'
import { touchLogin, recordPayment, upsertRegistration } from './userDb.js'

let migrated = false

async function readJsonIfExists(filePath) {
  try {
    const raw = await readFile(filePath, 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/**
 * One-time migration from shared waitlist.json / users.json
 * into fully isolated per-user databases.
 */
export async function migrateLegacySharedData() {
  if (migrated) return { migrated: false, reason: 'already-ran' }
  migrated = true

  await ensureDataLayout()
  const dataDir = getDataDir()
  const users = (await readJsonIfExists(path.join(dataDir, 'users.json'))) || []
  const waitlist =
    (await readJsonIfExists(path.join(dataDir, 'waitlist.json'))) || []

  let usersMigrated = 0
  let waitlistMigrated = 0

  if (Array.isArray(users)) {
    for (const user of users) {
      if (!user?.uid && !user?.email) continue
      await touchLogin({
        uid: user.uid || null,
        email: user.email || null,
        name: user.name || null,
        picture: user.picture || null,
        provider: user.provider || 'google.com',
        emailVerified: Boolean(user.emailVerified),
      })
      usersMigrated += 1
    }
  }

  if (Array.isArray(waitlist)) {
    for (const entry of waitlist) {
      if (!entry?.email) continue
      const identity = {
        email: entry.email,
        name: entry.name || null,
        phone: entry.phone || null,
      }

      if (entry.status === 'paid' && entry.paymentId) {
        await recordPayment(identity, {
          name: entry.name,
          email: entry.email,
          phone: entry.phone,
          paymentId: entry.paymentId,
          orderId: entry.orderId || null,
          amount: entry.amount || 100,
          webinarLink: entry.webinarLink || null,
        })
      } else {
        await upsertRegistration(identity, {
          name: entry.name,
          email: entry.email,
          phone: entry.phone,
          status: entry.status || 'joined',
        })
      }
      waitlistMigrated += 1
    }
  }

  console.log('[db] legacy migration complete', {
    usersMigrated,
    waitlistMigrated,
  })

  return { migrated: true, usersMigrated, waitlistMigrated }
}
