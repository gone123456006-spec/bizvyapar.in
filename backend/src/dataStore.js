/**
 * Compatibility shim — shared JSON stores are retired.
 * All user data is fully isolated in per-user databases under data/tenants/.
 */
export { getDataDir } from './db/paths.js'
export {
  findTenantIdByEmail,
  findTenantIdByUid,
  resolveTenant,
} from './db/registry.js'
export {
  openUserDatabase,
  touchLogin,
  recordPayment,
  upsertRegistration,
  getOwnProfile,
} from './db/userDb.js'

/** @deprecated Shared waitlist is disabled for isolation. */
export async function loadWaitlistEntries() {
  throw new Error(
    'Shared waitlist storage is disabled. Use per-user databases via userDb.',
  )
}

/** @deprecated Shared waitlist is disabled for isolation. */
export async function saveWaitlistEntries() {
  throw new Error(
    'Shared waitlist storage is disabled. Use per-user databases via userDb.',
  )
}

/** @deprecated Shared users file is disabled for isolation. */
export async function loadUsers() {
  throw new Error(
    'Shared users storage is disabled. Use per-user databases via userDb.',
  )
}

/** @deprecated Shared users file is disabled for isolation. */
export async function saveUsers() {
  throw new Error(
    'Shared users storage is disabled. Use per-user databases via userDb.',
  )
}
