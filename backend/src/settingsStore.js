/**
 * Runtime app settings (webinar link, workshop price).
 * Postgres when available; otherwise durable JSON file under data/.
 * Env vars are fallbacks until an admin saves overrides.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPool, isPostgresEnabled } from './db/postgres.js'
import { col, isMongoEnabled } from './db/mongo.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SETTINGS_FILE = path.join(__dirname, '..', 'data', 'app-settings.json')

const KEYS = {
  webinarLink: 'webinar_link',
  workshopAmountPaise: 'workshop_amount_paise',
}

let memoryCache = null
let memoryCacheAt = 0
const CACHE_MS = 2_000

function envDefaults() {
  const paise = Number(process.env.WORKSHOP_AMOUNT_PAISE || 100)
  return {
    webinarLink: String(process.env.WEBINAR_LINK || '').trim(),
    workshopAmountPaise: Number.isFinite(paise) && paise > 0 ? Math.round(paise) : 100,
    updatedAt: null,
    source: 'env',
  }
}

export function formatAmountLabel(paise) {
  const value = Number(paise) / 100
  if (!Number.isFinite(value)) return '₹1'
  if (Number.isInteger(value)) return `₹${value}`
  return `₹${value.toFixed(2)}`
}

async function ensureSettingsTable(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
}

async function readFileSettings() {
  try {
    const raw = await readFile(SETTINGS_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

async function writeFileSettings(data) {
  await mkdir(path.dirname(SETTINGS_FILE), { recursive: true })
  await writeFile(SETTINGS_FILE, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

async function readPostgresSettings() {
  const db = getPool()
  if (!db) return null
  await ensureSettingsTable(db)
  const result = await db.query(
    `SELECT key, value, updated_at FROM app_settings WHERE key = ANY($1::text[])`,
    [[KEYS.webinarLink, KEYS.workshopAmountPaise]],
  )
  if (!result.rows.length) return null

  const map = Object.fromEntries(result.rows.map((row) => [row.key, row]))
  const defaults = envDefaults()
  const webinarRow = map[KEYS.webinarLink]
  const amountRow = map[KEYS.workshopAmountPaise]
  const amount = Number(amountRow?.value)
  const updatedCandidates = [webinarRow?.updated_at, amountRow?.updated_at]
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
  const updatedAt = updatedCandidates.length
    ? new Date(Math.max(...updatedCandidates)).toISOString()
    : null

  return {
    webinarLink: webinarRow ? String(webinarRow.value || '').trim() : defaults.webinarLink,
    workshopAmountPaise:
      Number.isFinite(amount) && amount > 0
        ? Math.round(amount)
        : defaults.workshopAmountPaise,
    updatedAt,
    source: 'postgres',
  }
}

async function writePostgresSettings(patch) {
  const db = getPool()
  if (!db) return false
  await ensureSettingsTable(db)
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    if (Object.prototype.hasOwnProperty.call(patch, 'webinarLink')) {
      await client.query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [KEYS.webinarLink, String(patch.webinarLink || '').trim()],
      )
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'workshopAmountPaise')) {
      await client.query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [KEYS.workshopAmountPaise, String(Math.round(patch.workshopAmountPaise))],
      )
    }
    await client.query('COMMIT')
    return true
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

function invalidateCache() {
  memoryCache = null
  memoryCacheAt = 0
}

export async function getAppSettings({ force = false } = {}) {
  const now = Date.now()
  if (!force && memoryCache && now - memoryCacheAt < CACHE_MS) {
    return memoryCache
  }

  const defaults = envDefaults()
  let stored = null

  if (isMongoEnabled()) {
    try {
      const rows = await col('settings')
        .find({ key: { $in: [KEYS.webinarLink, KEYS.workshopAmountPaise] } })
        .toArray()
      if (rows.length) {
        const map = Object.fromEntries(rows.map((row) => [row.key, row]))
        const defaults = envDefaults()
        const webinarRow = map[KEYS.webinarLink]
        const amountRow = map[KEYS.workshopAmountPaise]
        const amount = Number(amountRow?.value)
        stored = {
          webinarLink:
            String(webinarRow?.value || '').trim() || defaults.webinarLink,
          workshopAmountPaise:
            Number.isFinite(amount) && amount > 0
              ? Math.round(amount)
              : defaults.workshopAmountPaise,
          updatedAt: webinarRow?.updatedAt || amountRow?.updatedAt || null,
          source: 'mongodb',
        }
      }
    } catch (error) {
      console.error('[settings] mongodb read failed', error.message)
    }
  }

  if (!stored && isPostgresEnabled()) {
    try {
      stored = await readPostgresSettings()
    } catch (error) {
      console.error('[settings] postgres read failed', error.message)
    }
  }

  if (!stored) {
    const file = await readFileSettings()
    if (file) {
      const amount = Number(file.workshopAmountPaise)
      stored = {
        webinarLink: String(file.webinarLink || '').trim() || defaults.webinarLink,
        workshopAmountPaise:
          Number.isFinite(amount) && amount > 0
            ? Math.round(amount)
            : defaults.workshopAmountPaise,
        updatedAt: file.updatedAt || null,
        source: 'file',
      }
    }
  }

  const settings = stored || defaults
  memoryCache = settings
  memoryCacheAt = now
  return settings
}

export async function getWebinarLink() {
  const settings = await getAppSettings()
  return settings.webinarLink
}

export async function getWorkshopAmountPaise() {
  const settings = await getAppSettings()
  return settings.workshopAmountPaise
}

export async function updateAppSettings(input = {}) {
  const current = await getAppSettings({ force: true })
  const next = { ...current }

  if (Object.prototype.hasOwnProperty.call(input, 'webinarLink')) {
    const link = String(input.webinarLink || '').trim()
    if (link && !/^https?:\/\//i.test(link)) {
      const error = new Error('Webinar link must start with http:// or https://')
      error.status = 400
      throw error
    }
    next.webinarLink = link
  }

  if (Object.prototype.hasOwnProperty.call(input, 'workshopAmountPaise')) {
    const amount = Number(input.workshopAmountPaise)
    if (!Number.isFinite(amount) || amount < 100 || amount > 10_000_000) {
      const error = new Error(
        'Subscription price must be between ₹1.00 and ₹100,000.00 (in paise: 100–10000000).',
      )
      error.status = 400
      throw error
    }
    next.workshopAmountPaise = Math.round(amount)
  }

  if (Object.prototype.hasOwnProperty.call(input, 'amountRupees')) {
    const rupees = Number(input.amountRupees)
    if (!Number.isFinite(rupees) || rupees < 1 || rupees > 100_000) {
      const error = new Error('Subscription price must be between ₹1 and ₹100,000.')
      error.status = 400
      throw error
    }
    next.workshopAmountPaise = Math.round(rupees * 100)
  }

  next.updatedAt = new Date().toISOString()

  const patch = {
    webinarLink: next.webinarLink,
    workshopAmountPaise: next.workshopAmountPaise,
  }

  if (isMongoEnabled()) {
    const now = new Date()
    await Promise.all([
      col('settings').updateOne(
        { key: KEYS.webinarLink },
        {
          $set: { value: String(patch.webinarLink || ''), updatedAt: now },
          $setOnInsert: { key: KEYS.webinarLink },
        },
        { upsert: true },
      ),
      col('settings').updateOne(
        { key: KEYS.workshopAmountPaise },
        {
          $set: {
            value: String(patch.workshopAmountPaise),
            updatedAt: now,
          },
          $setOnInsert: { key: KEYS.workshopAmountPaise },
        },
        { upsert: true },
      ),
    ])
    next.source = 'mongodb'
  } else if (isPostgresEnabled()) {
    await writePostgresSettings(patch)
    next.source = 'postgres'
  } else {
    await writeFileSettings({
      ...patch,
      updatedAt: next.updatedAt,
    })
    next.source = 'file'
  }

  invalidateCache()
  return getAppSettings({ force: true })
}

export function toPublicSettings(settings) {
  return {
    webinarLink: settings.webinarLink || null,
    amountPaise: settings.workshopAmountPaise,
    amountLabel: formatAmountLabel(settings.workshopAmountPaise),
    updatedAt: settings.updatedAt,
  }
}
