import nodemailer from 'nodemailer'

function getSmtpConfig() {
  const host = String(
    process.env.SMTP_HOST || 'smtp-relay.brevo.com',
  ).trim()
  const user = String(
    process.env.SMTP_USER ||
      process.env.BREVO_SMTP_LOGIN ||
      process.env.GMAIL_USER ||
      '',
  ).trim()
  const pass = String(
    process.env.SMTP_PASS ||
      process.env.BREVO_SMTP_KEY ||
      process.env.GMAIL_APP_PASSWORD ||
      '',
  )
    .replace(/\s+/g, '')
    .trim()
  const from = String(
    process.env.SMTP_FROM || process.env.EMAIL_FROM || '',
  ).trim()
  const port = Number(process.env.SMTP_PORT || 587)
  const secure =
    String(process.env.SMTP_SECURE || (port === 465 ? 'true' : 'false'))
      .toLowerCase() === 'true'
  const senderName = String(process.env.SMTP_SENDER_NAME || 'BizVyapar').trim()

  // From must be a Brevo-verified sender (often your Gmail). Login is separate.
  if (!user || !pass || !from) {
    return null
  }

  const provider = /brevo|sendinblue/i.test(host) ? 'brevo' : 'smtp'

  return { host, user, pass, from, port, secure, senderName, provider }
}

export function isEmailConfigured() {
  return Boolean(getSmtpConfig())
}

export function getEmailConfigStatus() {
  const smtp = getSmtpConfig()

  if (!smtp) {
    return {
      configured: false,
      reason:
        'Missing SMTP_USER / SMTP_PASS / SMTP_FROM (Brevo SMTP login + SMTP key + verified sender)',
    }
  }

  return {
    configured: true,
    mode: smtp.provider === 'brevo' ? 'brevo-smtp' : 'smtp',
    senderEmail: smtp.from,
    senderName: smtp.senderName,
    host: smtp.host,
    port: smtp.port,
  }
}

function getNextWorkshopSunday(from = new Date()) {
  const next = new Date(from)
  next.setHours(17, 0, 0, 0)

  const day = next.getDay()
  let addDays = (7 - day) % 7

  if (addDays === 0 && from.getTime() >= next.getTime()) {
    addDays = 7
  }

  next.setDate(next.getDate() + addDays)
  return next
}

function formatWorkshopDate(date) {
  return date.toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function buildEmailContent({ name, paymentId, webinarLink, amountLabel }) {
  const link = webinarLink || process.env.WEBINAR_LINK || ''
  const safeName = name || 'there'
  const workshop = getNextWorkshopSunday()
  const dateLabel = formatWorkshopDate(workshop)
  const timeLabel = '5:00 PM (GMT +5:30) Calcutta, Chennai, Mumbai, New Delhi'
  const hostLine =
    'Hosted by CA Shree Ram Raut | Expertise in Finance, Taxation, Auditing & Risk Management | Founder BizVyapar'
  const paidAmount = amountLabel || '₹1'
  const safeLink = escapeHtml(link)
  const safePaymentId = escapeHtml(paymentId)
  const supportNumber = '9153832948'

  const text = [
    `Join BizVyapar Live Workshop Now!`,
    hostLine,
    '',
    dateLabel,
    timeLabel,
    '',
    `Hi ${safeName},`,
    '',
    'Thank You for choosing BizVyapar. Your payment is done. Now you are in for the Webinar.',
    'Please save this email and join on time using the webinar room link below.',
    '',
    link ? `Join Webinar: ${link}` : 'We will share the webinar link shortly.',
    link ? `Webinar room: ${link}` : '',
    'Room password: N/A',
    '',
    'Payment details:',
    `- Amount paid: ${paidAmount}`,
    paymentId ? `- Payment ID: ${paymentId}` : '',
    `- Status: Paid`,
    '',
    `Support contact number: ${supportNumber}`,
    '',
    'See you at the webinar!',
    'Team BizVyapar',
  ]
    .filter(Boolean)
    .join('\n')

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.55;color:#111827;max-width:640px;margin:0 auto;padding:8px 4px">
      <h1 style="margin:0 0 10px;font-size:26px;line-height:1.25;color:#111827;font-weight:700">
        Join BizVyapar Live Workshop Now!
      </h1>
      <p style="margin:0 0 14px;font-size:13px;line-height:1.5;color:#6b7280;font-style:italic">
        ${escapeHtml(hostLine)}
      </p>
      <p style="margin:0 0 4px;font-size:15px;font-weight:700;color:#ea580c">
        ${escapeHtml(dateLabel)}
      </p>
      <p style="margin:0 0 16px;font-size:15px;font-weight:700;color:#ea580c">
        ${escapeHtml(timeLabel)}
      </p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 18px" />
      <p style="margin:0 0 10px;font-size:15px">Hi ${escapeHtml(safeName)},</p>
      <p style="margin:0 0 10px;font-size:15px">
        <strong>Thank You for choosing BizVyapar. Your payment is done. Now you are in for the Webinar.</strong>
      </p>
      <p style="margin:0 0 16px;font-size:15px;color:#374151">
        Please save this email and join on time using the webinar room link below.
      </p>
      ${
        link
          ? `<p style="margin:0 0 14px">
               <a href="${safeLink}" style="display:inline-block;background:#ffde03;color:#111;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:10px">
                 Join Webinar
               </a>
             </p>
             <ul style="margin:0 0 16px;padding-left:20px;font-size:14px;color:#374151">
               <li style="margin:0 0 8px">
                 <strong>Webinar room:</strong>
                 <a href="${safeLink}" style="color:#1a73e8;word-break:break-all">${safeLink}</a>
               </li>
               <li style="margin:0"><strong>Room password:</strong> N/A</li>
             </ul>`
          : `<p style="margin:0 0 16px;font-size:15px">We will share the webinar link shortly.</p>`
      }
      <p style="margin:0 0 8px;font-size:15px;font-weight:700;color:#111827">Payment details</p>
      <ul style="margin:0 0 14px;padding-left:20px;font-size:14px;color:#374151">
        <li style="margin:0 0 6px"><strong>Amount paid:</strong> ${escapeHtml(paidAmount)}</li>
        ${
          paymentId
            ? `<li style="margin:0 0 6px"><strong>Payment ID:</strong> ${safePaymentId}</li>`
            : ''
        }
        <li style="margin:0"><strong>Status:</strong> Paid</li>
      </ul>
      <p style="margin:0 0 18px;font-size:14px;color:#374151">
        <strong>Support contact number:</strong>
        <a href="tel:${supportNumber}" style="color:#111827;text-decoration:none">${supportNumber}</a>
      </p>
      <p style="margin:0;font-size:15px">See you at the webinar!<br/>Team BizVyapar</p>
    </div>
  `

  return {
    subject: 'Join BizVyapar Live Workshop — your seat is confirmed',
    text,
    html,
    safeName,
  }
}

function buildReminderContent({ name, kind, webinarLink, workshopAt }) {
  const safeName = name || 'there'
  const link = webinarLink || process.env.WEBINAR_LINK || ''
  const dateLabel = workshopAt.toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  const timeLabel = '5:00 PM (GMT +5:30) Calcutta, Chennai, Mumbai, New Delhi'
  const isDayBefore = kind === 't24h'
  const headline = isDayBefore
    ? 'Reminder: BizVyapar workshop is tomorrow!'
    : 'We are about to start — join now!'
  const body = isDayBefore
    ? 'This is your 24-hour reminder. Please keep this email handy and join on time tomorrow.'
    : 'In about 30 minutes, your BizVyapar live workshop will begin. Please proceed to the webinar room now.'

  const text = [
    headline,
    '',
    `Hi ${safeName},`,
    body,
    '',
    dateLabel,
    timeLabel,
    link ? `Join Webinar: ${link}` : '',
    '',
    'Support contact number: 9153832948',
    'See you at the webinar!',
    'Team BizVyapar',
  ]
    .filter(Boolean)
    .join('\n')

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.55;color:#111827;max-width:640px;margin:0 auto;padding:8px 4px">
      <h1 style="margin:0 0 12px;font-size:24px;color:#111827">${escapeHtml(headline)}</h1>
      <p style="margin:0 0 10px">Hi ${escapeHtml(safeName)},</p>
      <p style="margin:0 0 14px">${escapeHtml(body)}</p>
      <p style="margin:0 0 4px;font-weight:700;color:#ea580c">${escapeHtml(dateLabel)}</p>
      <p style="margin:0 0 16px;font-weight:700;color:#ea580c">${escapeHtml(timeLabel)}</p>
      ${
        link
          ? `<p style="margin:0 0 14px">
               <a href="${escapeHtml(link)}" style="display:inline-block;background:#ffde03;color:#111;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:10px">
                 Join Webinar
               </a>
             </p>`
          : ''
      }
      <p style="margin:0 0 12px;font-size:14px"><strong>Support contact number:</strong> 9153832948</p>
      <p style="margin:0">See you at the webinar!<br/>Team BizVyapar</p>
    </div>
  `

  return {
    subject: isDayBefore
      ? 'Reminder: BizVyapar workshop tomorrow at 5:00 PM'
      : 'Starting soon: join BizVyapar webinar now',
    text,
    html,
    safeName,
  }
}

async function sendMail({ to, name, subject, text, html }) {
  const recipient = String(to || '').trim().toLowerCase()
  if (!recipient) {
    const error = new Error('Missing recipient email.')
    error.status = 400
    throw error
  }

  const config = getSmtpConfig()
  if (!config) {
    const error = new Error(
      'Email is not configured. Add Brevo SMTP_USER, SMTP_PASS, and SMTP_FROM on the server.',
    )
    error.status = 503
    throw error
  }

  const safeName = name || 'there'
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

  console.log(`[email] sent via ${config.provider}-smtp`, {
    to: recipient,
    subject,
    host: config.host,
    messageId: info.messageId || null,
  })

  return { mode: `${config.provider}-smtp`, messageId: info.messageId || null }
}

export async function sendWebinarPaymentEmail({
  to,
  name,
  paymentId,
  webinarLink,
  amountLabel,
}) {
  const { subject, text, html, safeName } = buildEmailContent({
    name,
    paymentId,
    webinarLink,
    amountLabel,
  })
  return sendMail({ to, name: safeName, subject, text, html })
}

export async function sendWorkshopReminderEmail({
  to,
  name,
  kind,
  webinarLink,
  workshopAt,
}) {
  const { subject, text, html, safeName } = buildReminderContent({
    name,
    kind,
    webinarLink,
    workshopAt,
  })
  return sendMail({ to, name: safeName, subject, text, html })
}
