import { mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Local / Render: backend/data
 * Vercel or DATA_DIR=tmp: /tmp
 */
export function getDataDir() {
  if (process.env.DATA_DIR && process.env.DATA_DIR !== 'tmp') {
    return path.resolve(process.env.DATA_DIR)
  }

  if (process.env.VERCEL || process.env.DATA_DIR === 'tmp') {
    return path.join(os.tmpdir(), 'bizvyapar-data')
  }

  return path.resolve(__dirname, '../../data')
}

export function getRegistryPath() {
  return path.join(getDataDir(), 'registry.json')
}

export function getTenantsDir() {
  return path.join(getDataDir(), 'tenants')
}

/** Each user gets an isolated folder + database file. */
export function getTenantDir(tenantId) {
  return path.join(getTenantsDir(), sanitizeTenantId(tenantId))
}

export function getTenantDbPath(tenantId) {
  return path.join(getTenantDir(tenantId), 'database.json')
}

export function sanitizeTenantId(tenantId) {
  return String(tenantId || '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 128)
}

export async function ensureDataLayout() {
  await mkdir(getTenantsDir(), { recursive: true })
}
