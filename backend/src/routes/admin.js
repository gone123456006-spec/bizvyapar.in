import { Router } from 'express'
import {
  createAdminToken,
  getAdminDashboardName,
  isAdminConfigured,
  requireAdmin,
  verifyAdminPassword,
} from '../adminAuth.js'
import { listAdminUsers } from '../db/adminStore.js'
import {
  formatAmountLabel,
  getAppSettings,
  toPublicSettings,
  updateAppSettings,
} from '../settingsStore.js'

export const adminRouter = Router()

adminRouter.get('/status', (_req, res) => {
  res.json({
    dashboard: getAdminDashboardName(),
    configured: isAdminConfigured(),
  })
})

adminRouter.post('/login', (req, res) => {
  if (!isAdminConfigured()) {
    return res.status(503).json({
      message: 'TredsDash is not configured. Set ADMIN_PASSWORD on the server.',
    })
  }

  const password = String(req.body?.password || '')
  if (!verifyAdminPassword(password)) {
    return res.status(401).json({ message: 'Incorrect password.' })
  }

  const token = createAdminToken()
  return res.json({
    dashboard: getAdminDashboardName(),
    token,
    expiresInHours: 12,
  })
})

adminRouter.get('/session', requireAdmin, (req, res) => {
  res.json({
    dashboard: getAdminDashboardName(),
    ok: true,
    exp: req.admin?.exp || null,
  })
})

adminRouter.get('/users', requireAdmin, async (_req, res, next) => {
  try {
    const users = await listAdminUsers()
    res.json({
      dashboard: getAdminDashboardName(),
      count: users.length,
      users,
    })
  } catch (error) {
    next(error)
  }
})

adminRouter.get('/settings', requireAdmin, async (_req, res, next) => {
  try {
    const settings = await getAppSettings({ force: true })
    res.json({
      dashboard: getAdminDashboardName(),
      settings: {
        webinarLink: settings.webinarLink || '',
        amountPaise: settings.workshopAmountPaise,
        amountRupees: settings.workshopAmountPaise / 100,
        amountLabel: formatAmountLabel(settings.workshopAmountPaise),
        updatedAt: settings.updatedAt,
        source: settings.source,
      },
      public: toPublicSettings(settings),
    })
  } catch (error) {
    next(error)
  }
})

adminRouter.put('/settings', requireAdmin, async (req, res, next) => {
  try {
    const body = req.body || {}
    const patch = {}

    if (Object.prototype.hasOwnProperty.call(body, 'webinarLink')) {
      patch.webinarLink = body.webinarLink
    }
    if (Object.prototype.hasOwnProperty.call(body, 'amountPaise')) {
      patch.workshopAmountPaise = body.amountPaise
    }
    if (Object.prototype.hasOwnProperty.call(body, 'amountRupees')) {
      patch.amountRupees = body.amountRupees
    }

    if (!Object.keys(patch).length) {
      return res.status(400).json({ message: 'No settings to update.' })
    }

    const settings = await updateAppSettings(patch)
    res.json({
      dashboard: getAdminDashboardName(),
      message: 'Settings saved. Website will reflect changes within a few seconds.',
      settings: {
        webinarLink: settings.webinarLink || '',
        amountPaise: settings.workshopAmountPaise,
        amountRupees: settings.workshopAmountPaise / 100,
        amountLabel: formatAmountLabel(settings.workshopAmountPaise),
        updatedAt: settings.updatedAt,
        source: settings.source,
      },
      public: toPublicSettings(settings),
    })
  } catch (error) {
    next(error)
  }
})
