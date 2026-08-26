import {
  hasReminder,
  listPaidRecipients,
  markReminder,
} from './userDb.js'
import { isEmailConfigured, sendWorkshopReminderEmail } from '../email.js'

function getNextWorkshopSunday(from = new Date()) {
  const next = new Date(from)
  next.setHours(17, 0, 0, 0)
  const day = next.getDay()
  let addDays = (7 - day) % 7
  if (addDays === 0 && from.getTime() >= next.getTime()) {
    addDays = 7
  }
  next.setDate(next.getDate() + addDays)
  return next
}

function withinWindow(nowMs, targetMs, windowMs = 60_000) {
  return nowMs >= targetMs && nowMs < targetMs + windowMs
}

/**
 * Sends T-24h and T-30m reminders using only each paid user's own record.
 * Safe to call every minute.
 */
export async function runReminderPass(now = new Date()) {
  if (!isEmailConfigured()) {
    return { skipped: true, reason: 'email-not-configured' }
  }

  const workshopAt = getNextWorkshopSunday(now)
  const nowMs = now.getTime()
  const workshopMs = workshopAt.getTime()
  const t24 = workshopMs - 24 * 60 * 60 * 1000
  const t30 = workshopMs - 30 * 60 * 1000

  const kinds = []
  if (withinWindow(nowMs, t24)) kinds.push('t24h')
  if (withinWindow(nowMs, t30)) kinds.push('t30m')

  if (kinds.length === 0) {
    return { skipped: true, reason: 'outside-reminder-windows', workshopAt }
  }

  const recipients = await listPaidRecipients()
  let sent = 0
  let skipped = 0

  for (const recipient of recipients) {
    for (const kind of kinds) {
      const already = await hasReminder({
        tenantId: recipient.tenantId,
        paymentId: recipient.paymentId,
        kind,
        workshopAt,
      })
      if (already) {
        skipped += 1
        continue
      }

      try {
        await sendWorkshopReminderEmail({
          to: recipient.email,
          name: recipient.name,
          kind,
          webinarLink: recipient.webinarLink,
          workshopAt,
        })
        await markReminder({
          tenantId: recipient.tenantId,
          paymentId: recipient.paymentId,
          kind,
          workshopAt,
        })
        sent += 1
      } catch (error) {
        console.error('[reminders] failed', {
          tenantId: recipient.tenantId,
          kind,
          error: error.message,
        })
      }
    }
  }

  console.log('[reminders] pass complete', {
    workshopAt: workshopAt.toISOString(),
    kinds,
    sent,
    skipped,
    recipients: recipients.length,
  })

  return { sent, skipped, kinds, workshopAt }
}

export function startReminderScheduler() {
  const enabled =
    String(process.env.REMINDERS_ENABLED || 'true').toLowerCase() !== 'false'
  if (!enabled) {
    console.log('[reminders] disabled')
    return null
  }

  // First pass shortly after boot, then every minute.
  const timer = setInterval(() => {
    void runReminderPass().catch((error) => {
      console.error('[reminders] pass error', error)
    })
  }, 60_000)

  timer.unref?.()

  setTimeout(() => {
    void runReminderPass().catch((error) => {
      console.error('[reminders] pass error', error)
    })
  }, 5_000).unref?.()

  console.log('[reminders] scheduler started (every 60s)')
  return timer
}
