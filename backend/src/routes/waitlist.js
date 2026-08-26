import { Router } from 'express'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.resolve(__dirname, '../../data')
const dataFile = path.join(dataDir, 'waitlist.json')

export const waitlistRouter = Router()

async function loadEntries() {
  try {
    const raw = await readFile(dataFile, 'utf8')
    return JSON.parse(raw)
  } catch {
    return []
  }
}

async function saveEntries(entries) {
  await mkdir(dataDir, { recursive: true })
  await writeFile(dataFile, JSON.stringify(entries, null, 2), 'utf8')
}

waitlistRouter.post('/', async (req, res) => {
  const name = String(req.body?.name || '').trim()
  const email = String(req.body?.email || '').trim().toLowerCase()
  const phone = String(req.body?.phone || '').trim()

  if (!name || name.length < 2) {
    return res.status(400).json({ message: 'Please enter your full name.' })
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ message: 'Please enter a valid email.' })
  }

  if (phone && !/^[0-9+\-\s]{7,15}$/.test(phone)) {
    return res.status(400).json({ message: 'Please enter a valid phone number.' })
  }

  const entries = await loadEntries()
  const existing = entries.find((entry) => entry.email === email)

  if (existing) {
    return res.status(200).json({
      message: 'You are already on the waitlist. We will email the webinar link.',
      alreadyJoined: true,
    })
  }

  entries.push({
    name,
    email,
    phone: phone || null,
    joinedAt: new Date().toISOString(),
  })

  await saveEntries(entries)

  return res.status(201).json({
    message: 'You are on the waitlist. Check your email for the webinar link.',
  })
})
