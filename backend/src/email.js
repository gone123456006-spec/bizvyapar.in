import nodemailer from 'nodemailer'

function getSmtpConfig() {
  const host = String(process.env.SMTP_HOST || 'smtp.gmail.com').trim()
  const user = String(process.env.SMTP_USER || process.env.GMAIL_USER || '').trim()
  const pass = String(
    process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD || '',
  ).trim()
  const from = String(
    process.env.SMTP_FROM || process.env.EMAIL_FROM || user || '',
  ).trim()
  const port = Number(process.env.SMTP_PORT || 587)
  const secure =
    String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true'
  const senderName = String(process.env.SMTP_SENDER_NAME || 'Easy Vyapar').trim()

  if (!user || !pass || !from) {
    return null
  }

  return { host, user, pass, from, port, secure, senderName }
}

export function isEmailConfigured() {
  return Boolean(getSmtpConfig())
}

export function getEmailConfigStatus() {
  const smtp = getSmtpConfig()

  if (!smtp) {
    return {
      configured: false,
      reason: 'Missing Gmail SMTP_USER / SMTP_PASS (App Password)',
    }
  }

  return {
    configured: true,
    mode: 'gmail-smtp',
    senderEmail: smtp.from,
    senderName: smtp.senderName,
    host: smtp.host,
  }
}

function buildEmailContent({ name, paymentId, webinarLink }) {
  const link = webinarLink || process.env.WEBINAR_LINK || ''
  const safeName = name || 'there'

  const text = [
    `Hi ${safeName},`,
    '',
    'Your payment is done.',
    'Now you are in for the webinar.',
    '',
    link ? `Join webinar link: ${link}` : 'We will share the webinar link shortly.',
    '',
    paymentId ? `Payment ID: ${paymentId}` : '',
    '',
    'See you in the session,',
    'Team Easy Vyapar',
  ]
    .filter(Boolean)
    .join('\n')

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#1f2a2e;max-width:560px">
      <h2 style="margin:0 0 12px">Your payment is done</h2>
      <p style="margin:0 0 12px">Hi ${safeName},</p>
      <p style="margin:0 0 12px"><strong>Now you are in for the Webinar.</strong></p>
      ${
        link
          ? `<p style="margin:0 0 16px"><a href="${link}" style="display:inline-block;background:#ffde03;color:#111;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:10px">Join Webinar</a></p>
             <p style="margin:0 0 12px;font-size:13px;color:#5f6b70">Or open this link: <a href="${link}">${link}</a></p>`
          : `<p style="margin:0 0 12px">We will share the webinar link shortly.</p>`
      }
      ${paymentId ? `<p style="margin:0 0 12px;font-size:13px;color:#5f6b70">Payment ID: ${paymentId}</p>` : ''}
      <p style="margin:16px 0 0">See you in the session,<br/>Team Easy Vyapar</p>
    </div>
  `

  return {
    subject: 'Your payment is done — you are in for the Easy Vyapar webinar',
    text,
    html,
    safeName,
  }
}

export async function sendWebinarPaymentEmail({
  to,
  name,
  paymentId,
  webinarLink,
}) {
  const recipient = String(to || '').trim().toLowerCase()
  if (!recipient) {
    const error = new Error('Missing recipient email for confirmation mail.')
    error.status = 400
    throw error
  }

  const config = getSmtpConfig()
  if (!config) {
    const error = new Error(
      'Email is not configured. Add Gmail SMTP_USER and SMTP_PASS (App Password) to backend/.env',
    )
    error.status = 503
    throw error
  }

  const { subject, text, html, safeName } = buildEmailContent({
    name,
    paymentId,
    webinarLink,
  })

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  })

  const info = await transporter.sendMail({
    from: `"${config.senderName}" <${config.from}>`,
    to: `"${safeName}" <${recipient}>`,
    subject,
    text,
    html,
  })

  console.log('[email] sent via Gmail SMTP', {
    to: recipient,
    messageId: info.messageId || null,
  })

  return { mode: 'gmail-smtp', messageId: info.messageId || null }
}
