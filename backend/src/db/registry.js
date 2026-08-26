import { readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { getRegistryPath, ensureDataLayout } from './paths.js'

const EMPTY_REGISTRY = {
  version: 1,
  byEmail: {},
  byUid: {},
  tenants: {},
}

let writeChain = Promise.resolve()

async function readRegistry() {
  try {
    const raw = await readFile(getRegistryPath(), 'utf8')
    const parsed = JSON.parse(raw)
    return {
      version: 1,
      byEmail: parsed.byEmail || {},
      byUid: parsed.byUid || {},
      tenants: parsed.tenants || {},
    }
  } catch {
    return structuredClone(EMPTY_REGISTRY)
  }
}

async function writeRegistry(registry) {
  await ensureDataLayout()
  const target = getRegistryPath()
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, JSON.stringify(registry, null, 2), 'utf8')
  await rename(tmp, target)
}

/** Serialize registry mutations to avoid concurrent corruption. */
function withRegistry(mutator) {
  const run = writeChain.then(async () => {
    const registry = await readRegistry()
    const result = await mutator(registry)
    await writeRegistry(registry)
    return result
  })

  writeChain = run.then(
    () => undefined,
    () => undefined,
  )

  return run
}

export async function findTenantIdByEmail(email) {
  const normalized = String(email || '').trim().toLowerCase()
  if (!normalized) return null
  const registry = await readRegistry()
  return registry.byEmail[normalized] || null
}

export async function findTenantIdByUid(uid) {
  const id = String(uid || '').trim()
  if (!id) return null
  const registry = await readRegistry()
  return registry.byUid[id] || null
}

export async function getTenantMeta(tenantId) {
  const registry = await readRegistry()
  return registry.tenants[tenantId] || null
}

/**
 * Resolve or create an isolated tenant for this person.
 * Isolation rule: one tenant database per person (email and/or Firebase uid).
 */
export async function resolveTenant({ email, uid, name, phone, picture, provider }) {
  const normalizedEmail = String(email || '').trim().toLowerCase() || null
  const normalizedUid = String(uid || '').trim() || null

  if (!normalizedEmail && !normalizedUid) {
    const error = new Error('Cannot create user profile without email or uid.')
    error.status = 400
    throw error
  }

  return withRegistry(async (registry) => {
    let tenantId =
      (normalizedUid && registry.byUid[normalizedUid]) ||
      (normalizedEmail && registry.byEmail[normalizedEmail]) ||
      null

    const now = new Date().toISOString()

    if (!tenantId) {
      tenantId = normalizedUid
        ? `uid_${normalizedUid}`
        : `email_${Buffer.from(normalizedEmail).toString('hex').slice(0, 40)}`

      registry.tenants[tenantId] = {
        tenantId,
        email: normalizedEmail,
        uid: normalizedUid,
        createdAt: now,
        updatedAt: now,
      }
    } else {
      const meta = registry.tenants[tenantId] || { tenantId, createdAt: now }
      meta.email = normalizedEmail || meta.email || null
      meta.uid = normalizedUid || meta.uid || null
      meta.updatedAt = now
      if (name) meta.name = name
      if (phone) meta.phone = phone
      if (picture) meta.picture = picture
      if (provider) meta.provider = provider
      registry.tenants[tenantId] = meta
    }

    if (normalizedEmail) {
      // If email pointed at another tenant, keep latest mapping (merge onto current).
      registry.byEmail[normalizedEmail] = tenantId
    }
    if (normalizedUid) {
      registry.byUid[normalizedUid] = tenantId
    }

    return {
      tenantId,
      meta: registry.tenants[tenantId],
    }
  })
}

export async function listTenantIds() {
  const registry = await readRegistry()
  return Object.keys(registry.tenants)
}
