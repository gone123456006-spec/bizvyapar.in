import { Router } from 'express'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isFirebaseConfigured, verifyFirebaseIdToken } from '../firebaseAdmin.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.resolve(__dirname, '../../data')
const usersFile = path.join(dataDir, 'users.json')

export const authRouter = Router()

async function loadUsers() {
  try {
    const raw = await readFile(usersFile, 'utf8')
    return JSON.parse(raw)
  } catch {
    return []
  }
}

async function saveUsers(users) {
  await mkdir(dataDir, { recursive: true })
  await writeFile(usersFile, JSON.stringify(users, null, 2), 'utf8')
}

function buildUserRecord(decoded) {
  return {
    uid: decoded.uid,
    email: decoded.email || null,
    name: decoded.name || null,
    picture: decoded.picture || null,
    emailVerified: Boolean(decoded.email_verified),
    provider: decoded.firebase?.sign_in_provider || 'google.com',
    lastLoginAt: new Date().toISOString(),
  }
}

async function upsertUser(decoded) {
  const users = await loadUsers()
  const record = buildUserRecord(decoded)
  const index = users.findIndex((user) => user.uid === record.uid)

  if (index === -1) {
    users.push({
      ...record,
      createdAt: record.lastLoginAt,
    })
  } else {
    users[index] = {
      ...users[index],
      ...record,
    }
  }

  await saveUsers(users)
  return record
}

authRouter.get('/status', (_req, res) => {
  res.json({
    configured: isFirebaseConfigured(),
    provider: 'google',
  })
})

authRouter.post('/google', async (req, res) => {
  const idToken = String(req.body?.idToken || '').trim()

  if (!idToken) {
    return res.status(400).json({ message: 'Missing Google ID token.' })
  }

  try {
    const decoded = await verifyFirebaseIdToken(idToken)
    const user = buildUserRecord(decoded)

    // Respond first; persist in the background for a snappier login.
    res.json({
      message: 'Signed in with Google.',
      user,
    })

    void upsertUser(decoded).catch((error) => {
      console.error('Failed to persist user:', error.message)
    })
  } catch (error) {
    console.error('Google sign-in failed:', error.message)
    return res.status(error.status || 401).json({
      message: error.message || 'Google sign in failed.',
    })
  }
})

authRouter.get('/me', async (req, res) => {
  const header = req.headers.authorization || ''
  const idToken = header.startsWith('Bearer ') ? header.slice(7).trim() : ''

  if (!idToken) {
    return res.status(401).json({ message: 'Missing authorization token.' })
  }

  try {
    const decoded = await verifyFirebaseIdToken(idToken)
    const user = await upsertUser(decoded)

    return res.json({ user })
  } catch (error) {
    return res.status(error.status || 401).json({
      message: error.message || 'Session expired. Please sign in again.',
    })
  }
})
