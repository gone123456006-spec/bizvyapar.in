import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import { healthRouter } from './routes/health.js'
import { apiRouter } from './routes/api.js'
import { getEmailConfigStatus } from './email.js'

const app = express()
const PORT = process.env.PORT || 5000

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  }),
)
app.use(express.json())

app.use('/api/health', healthRouter)
app.use('/api', apiRouter)

app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(err.status || 500).json({
    message: err.message || 'Internal server error',
  })
})

app.listen(PORT, () => {
  console.log(`Easy Vyapar API running on http://localhost:${PORT}`)
  console.log('[email]', getEmailConfigStatus())
})
