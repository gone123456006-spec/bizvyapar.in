import { Router } from 'express'
import { getAppSettings, toPublicSettings } from '../settingsStore.js'

export const publicSettingsRouter = Router()

/** Public site settings — polled by the marketing site (price + webinar link). */
publicSettingsRouter.get('/', async (_req, res, next) => {
  try {
    const settings = await getAppSettings()
    res.set('Cache-Control', 'no-store')
    res.json(toPublicSettings(settings))
  } catch (error) {
    next(error)
  }
})
