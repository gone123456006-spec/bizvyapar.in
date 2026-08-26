import 'dotenv/config'
import { sendWebinarPaymentEmail } from './src/email.js'

const to = process.argv[2] || 'shyam123456006@gmail.com'

try {
  const result = await sendWebinarPaymentEmail({
    to,
    name: 'Shyam',
    paymentId: 'demo_test',
    webinarLink: process.env.WEBINAR_LINK,
  })
  console.log('SENT', JSON.stringify(result || { ok: true }, null, 2))
} catch (error) {
  console.error('FAILED', error.message)
  process.exit(1)
}
