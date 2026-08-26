import { useEffect, useRef, useState } from 'react'
import { useAuth, getAccessToken } from './context/AuthContext.jsx'
import { apiUrl } from './lib/api.js'
import './App.css'

function CheckIcon({ className = 'review-check' }) {
  return (
    <span className={className} aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
        <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z" />
      </svg>
    </span>
  )
}

/** Next Sunday at 5:00 PM local time. After that slot passes, rolls to the following Sunday. */
function getNextWorkshopSunday(from = new Date()) {
  const next = new Date(from)
  next.setHours(17, 0, 0, 0)

  const day = next.getDay() // 0 = Sunday
  let addDays = (7 - day) % 7

  if (addDays === 0 && from.getTime() >= next.getTime()) {
    addDays = 7
  }

  next.setDate(next.getDate() + addDays)
  return next
}

function formatWorkshopDay(date) {
  return date.toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  })
}

function formatWorkshopLabel(date) {
  return `${formatWorkshopDay(date)} · 5:00 PM`
}

const FAQ_ITEMS = [
  {
    q: 'What is TReDS?',
    a: 'TReDS (Trade Receivables Discounting System) is a digital platform that helps MSMEs get money against eligible unpaid invoices. Instead of waiting for the buyer to pay, the invoice can be discounted through the platform, allowing the MSME to receive funds earlier.',
  },
  {
    q: 'What is Invoice Discounting?',
    a: 'Invoice discounting means getting funds against an unpaid invoice before its due date. A financial institution provides the funds after applying a discount/charge, while the invoice is settled when the buyer makes the payment.',
  },
  {
    q: 'What is Invoice Financing?',
    a: 'Invoice financing is a broader term for using outstanding invoices to access working capital. It can help a business get funds tied up in unpaid invoices instead of waiting for the full payment cycle.',
  },
  {
    q: 'How does TReDS work?',
    a: 'The basic process is simple: Invoice Raised → Buyer Accepts Invoice → Invoice Uploaded on TReDS → Financing Offer → Invoice Discounted → Funds Received. The exact process and timelines can vary depending on the transaction and participating institutions.',
  },
  {
    q: 'Who can use TReDS?',
    a: 'TReDS is primarily designed to help Micro, Small and Medium Enterprises (MSMEs) finance their eligible trade receivables. Eligibility depends on the platform, transaction, buyer and applicable requirements.',
  },
  {
    q: 'Does the buyer need to approve the invoice?',
    a: 'Yes, generally the buyer must accept or confirm the invoice before it can be financed through TReDS. This helps establish that the receivable is genuine and payable by the buyer.',
  },
  {
    q: 'How quickly can I receive the money?',
    a: 'Once an eligible invoice is accepted and successfully financed, funds can be received much earlier than the original invoice due date. The actual timing depends on the platform, financier, documentation and transaction process.',
  },
  {
    q: 'Is Invoice Discounting a loan?',
    a: "Not necessarily. Invoice discounting is generally based on an existing trade receivable rather than simply giving funds against the business's future income. The exact legal and financial structure depends on the arrangement and financing institution.",
  },
  {
    q: 'How much does Invoice Financing cost?',
    a: 'The cost can vary based on factors such as the buyer, invoice, tenure, transaction risk and financing institution. There may be a discounting charge, financing cost or other applicable fees. The actual commercial terms should always be checked before accepting an offer.',
  },
  {
    q: 'Why should a business consider TReDS or Invoice Financing?',
    a: 'It can help businesses unlock money stuck in unpaid invoices, improve working capital and maintain smoother cash flow. Instead of waiting for the entire payment cycle, an eligible business may be able to access funds earlier against its receivables.',
  },
]


function getCountdownParts(target, now = new Date()) {
  const totalMs = Math.max(0, target.getTime() - now.getTime())
  const totalSeconds = Math.floor(totalMs / 1000)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  return { days, hours, minutes, seconds, totalMs }
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

function loadRazorpayScript() {
  return new Promise((resolve, reject) => {
    if (window.Razorpay) {
      resolve(window.Razorpay)
      return
    }

    const existing = document.querySelector('script[data-razorpay="1"]')
    if (existing) {
      if (window.Razorpay) {
        resolve(window.Razorpay)
        return
      }
      existing.addEventListener('load', () => {
        if (window.Razorpay) resolve(window.Razorpay)
        else reject(new Error('Razorpay script loaded but checkout is unavailable.'))
      }, { once: true })
      existing.addEventListener(
        'error',
        () =>
          reject(
            new Error(
              'Failed to load Razorpay checkout. Disable ad-block, or try another browser.',
            ),
          ),
        { once: true },
      )
      return
    }

    const script = document.createElement('script')
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'
    script.async = true
    script.crossOrigin = 'anonymous'
    script.dataset.razorpay = '1'

    const timeout = window.setTimeout(() => {
      reject(new Error('Razorpay checkout timed out. Check your internet and try again.'))
    }, 15000)

    script.onload = () => {
      window.clearTimeout(timeout)
      if (window.Razorpay) resolve(window.Razorpay)
      else reject(new Error('Razorpay script loaded but checkout is unavailable.'))
    }
    script.onerror = () => {
      window.clearTimeout(timeout)
      reject(
        new Error(
          'Failed to load Razorpay checkout. Disable ad-block, or try another browser.',
        ),
      )
    }
    document.body.appendChild(script)
  })
}

async function createPaymentOrder(lead) {
  const token = await getAccessToken()
  if (!token) {
    throw new Error('Please sign in with Google before payment.')
  }

  let orderRes
  try {
    orderRes = await fetch(apiUrl('/api/payments/create-order'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(lead),
    })
  } catch {
    throw new Error(
      'Could not reach payment server. Confirm VITE_API_BASE_URL and Render API are online.',
    )
  }

  let orderData = {}
  try {
    orderData = await orderRes.json()
  } catch {
    orderData = {}
  }

  if (!orderRes.ok) {
    throw new Error(orderData.message || `Could not start payment (${orderRes.status}).`)
  }

  if (!orderData.orderId || !orderData.keyId) {
    throw new Error('Payment order response was incomplete. Check Razorpay keys on Render.')
  }

  return orderData
}

function FieldIcon({ filled, children }) {
  if (filled) {
    return <CheckIcon className="pill-check" />
  }

  return (
    <span className="pill-icon" aria-hidden="true">
      {children}
    </span>
  )
}

export default function App() {
  const { user, signingIn, error, signInWithGoogle, signOut } = useAuth()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [consent, setConsent] = useState(true)
  const [status, setStatus] = useState('idle')
  const [message, setMessage] = useState('')
  const [submitted, setSubmitted] = useState(null)
  const [showJoinForm, setShowJoinForm] = useState(false)
  const [joinStep, setJoinStep] = useState('details')
  const [showProfileMenu, setShowProfileMenu] = useState(false)
  const [showAllFaqs, setShowAllFaqs] = useState(false)
  const [nextWorkshop, setNextWorkshop] = useState(() => getNextWorkshopSunday())
  const [countdown, setCountdown] = useState(() =>
    getCountdownParts(getNextWorkshopSunday()),
  )
  const pendingOrderRef = useRef(null)

  useEffect(() => {
    if (!showJoinForm) return undefined
    loadRazorpayScript().catch(() => {})
    return undefined
  }, [showJoinForm])

  useEffect(() => {
    function refreshWorkshop() {
      const next = getNextWorkshopSunday()
      setNextWorkshop(next)
      setCountdown(getCountdownParts(next))
    }

    refreshWorkshop()

    const tick = window.setInterval(() => {
      const next = getNextWorkshopSunday()
      setNextWorkshop(next)
      setCountdown(getCountdownParts(next))
    }, 1000)

    return () => window.clearInterval(tick)
  }, [])

  useEffect(() => {
    if (user?.email) {
      setEmail(user.email)
    }
    if (user?.name) {
      setName(user.name)
    }
  }, [user])

  useEffect(() => {
    if (!showJoinForm) return undefined
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [showJoinForm])

  useEffect(() => {
    if (!showProfileMenu) return undefined

    function handlePointerDown(event) {
      if (!event.target.closest('.nav-profile-wrap')) {
        setShowProfileMenu(false)
      }
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') setShowProfileMenu(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [showProfileMenu])

  useEffect(() => {
    if (!user) setShowProfileMenu(false)
  }, [user])

  function openJoinForm(event) {
    if (event) event.preventDefault()
    setJoinStep('details')
    setStatus('idle')
    setMessage('')
    setSubmitted(null)
    pendingOrderRef.current = null
    setShowJoinForm(true)
  }

  function closeJoinForm() {
    setShowJoinForm(false)
    setJoinStep('details')
    setStatus('idle')
    setMessage('')
    pendingOrderRef.current = null
  }

  async function handleDetailsNext(event) {
    event.preventDefault()
    setStatus('loading')
    setMessage('')

    if (!name.trim()) {
      setStatus('error')
      setMessage('Please enter your name.')
      return
    }

    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setStatus('error')
      setMessage('Please enter a valid email.')
      return
    }

    const digits = phone.replace(/\D/g, '')
    if (digits.length !== 10) {
      setStatus('error')
      setMessage('Please enter a valid 10-digit mobile number.')
      return
    }

    if (!consent) {
      setStatus('error')
      setMessage('Please accept the contact authorisation to continue.')
      return
    }

    try {
      let activeUser = user
      if (!activeUser) {
        setMessage('Please sign in with Google to continue…')
        activeUser = await signInWithGoogle()
        if (!activeUser) {
          throw new Error('Google sign-in is required before payment.')
        }
      }

      const lockedEmail = (activeUser.email || email).trim()
      const lockedName = (name || activeUser.name || '').trim()
      setEmail(lockedEmail)
      if (!name.trim() && activeUser.name) setName(activeUser.name)

      setStatus('idle')
      setMessage('')
      setJoinStep('payment')
      pendingOrderRef.current = createPaymentOrder({
        name: lockedName,
        email: lockedEmail,
        phone,
      })
    } catch (error) {
      setStatus('error')
      setMessage(error.message || 'Please sign in with Google first.')
    }
  }

  async function handlePayNow(event) {
    event.preventDefault()
    setStatus('loading')
    setMessage('')

    try {
      let activeUser = user
      if (!activeUser) {
        setMessage('Please sign in with Google to continue payment…')
        activeUser = await signInWithGoogle()
        if (!activeUser) {
          throw new Error('Please sign in with Google first, then pay.')
        }
      }

      const payName = (name || activeUser.name || '').trim()
      const payEmail = (activeUser.email || email || '').trim()
      const payPhone = phone.trim()

      if (activeUser.email && activeUser.email !== email) {
        setEmail(activeUser.email)
      }
      if (activeUser.name && !name.trim()) {
        setName(activeUser.name)
      }

      const [RazorpayCheckout, orderData] = await Promise.all([
        loadRazorpayScript(),
        createPaymentOrder({ name: payName, email: payEmail, phone: payPhone }),
      ])

      pendingOrderRef.current = Promise.resolve(orderData)
      const keyId = orderData.keyId || import.meta.env.VITE_RAZORPAY_KEY_ID

      if (!keyId) {
        throw new Error('Razorpay key is missing.')
      }

      const rzp = new RazorpayCheckout({
        key: keyId,
        amount: orderData.amount,
        currency: orderData.currency || 'INR',
        name: 'BizVyapar',
        description: 'Live 30-Min Workshop',
        order_id: orderData.orderId,
        prefill: {
          name: orderData.name,
          email: orderData.email,
          contact: orderData.phone,
        },
        notes: {
          product: 'Live 30-Min Workshop',
        },
        theme: {
          color: '#006b3c',
        },
        handler: (response) => {
          void (async () => {
            setStatus('loading')
            setMessage('Payment received. Confirming your seat…')

            const paymentId = response?.razorpay_payment_id || ''
            const controller = new AbortController()
            const timer = window.setTimeout(() => controller.abort(), 45000)

            try {
              const token = await getAccessToken()
              if (!token) {
                throw new Error('Please sign in with Google to confirm payment.')
              }

              let verifyRes
              try {
                verifyRes = await fetch(apiUrl('/api/payments/verify'), {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                  },
                  signal: controller.signal,
                  body: JSON.stringify({
                    name: payName,
                    email: payEmail,
                    phone: payPhone,
                    razorpay_order_id: response.razorpay_order_id,
                    razorpay_payment_id: response.razorpay_payment_id,
                    razorpay_signature: response.razorpay_signature,
                  }),
                })
              } catch (networkError) {
                if (networkError?.name === 'AbortError') {
                  throw new Error(
                    'Confirmation timed out. If ₹1 was deducted, your seat is likely booked — check Gmail or contact support with payment ID ' +
                      paymentId,
                  )
                }
                throw new Error(
                  'Could not confirm payment with server. If ₹1 was deducted, contact support with payment ID ' +
                    paymentId,
                )
              }

              let verifyData = {}
              try {
                verifyData = await verifyRes.json()
              } catch {
                verifyData = {}
              }

              if (!verifyRes.ok) {
                throw new Error(
                  verifyData.message ||
                    `Payment verification failed (${verifyRes.status}). Payment ID: ${paymentId}`,
                )
              }

              pendingOrderRef.current = null
              setSubmitted({
                name: payName,
                email: payEmail,
                phone: payPhone,
                webinarLink: verifyData.webinarLink || null,
                emailSent: Boolean(verifyData.emailSent),
                emailError: verifyData.emailError || null,
              })
              setJoinStep('success')
              setStatus('success')
              setMessage(
                verifyData.message ||
                  'Your payment is done. Now you are in for the Webinar.',
              )
            } catch (error) {
              setStatus('error')
              setMessage(error.message || 'Payment verification failed.')
            } finally {
              window.clearTimeout(timer)
            }
          })()
        },
        modal: {
          ondismiss: () => {
            setStatus('idle')
            setMessage('')
          },
        },
      })

      rzp.on('payment.failed', (response) => {
        setStatus('error')
        setMessage(
          response?.error?.description ||
            response?.error?.reason ||
            'Payment failed. Please try again.',
        )
      })

      rzp.open()
      setStatus('idle')
    } catch (error) {
      pendingOrderRef.current = null
      setStatus('error')
      setMessage(error.message || 'Could not complete payment. Please try again.')
    }
  }

  function formatPhone(value) {
    if (!value) return '—'
    const digits = value.replace(/\D/g, '')
    if (digits.length === 10) {
      return `+91 ${digits.slice(0, 5)}-${digits.slice(5)}`
    }
    return `+91 ${value}`
  }

  return (
    <div className="page">
      <div className="site-header">
        <div className="top-bar">
          <p>
            <strong>Learn simple GST billing</strong> for your shop
            <span className="top-bar-sep" aria-hidden="true">
              |
            </span>
            Live workshop <strong>{formatWorkshopLabel(nextWorkshop)}</strong>
            <span className="top-bar-sep" aria-hidden="true">
              |
            </span>
            Starts in{' '}
            <strong>
              {countdown.days}D - {pad2(countdown.hours)}H - {pad2(countdown.minutes)}M -{' '}
              {pad2(countdown.seconds)}S
            </strong>
            <span className="top-bar-sep" aria-hidden="true">
              |
            </span>
            <button className="top-bar-link" type="button" onClick={openJoinForm}>
              Join now
            </button>
          </p>
        </div>

        <header className="nav">
          <a className="nav-brand" href="#top">
            <img
              className="brand-logo brand-logo--nav"
              src="/images/logo.png?v=2"
              alt="BizVyapar"
            />
          </a>

          <div className="nav-actions">
            {!user ? (
              <button
                className="nav-signin"
                type="button"
                onClick={signInWithGoogle}
                disabled={signingIn}
              >
                {signingIn ? 'Signing in…' : 'Sign In'}
                <svg
                  className="nav-signin-chevron"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>
            ) : null}

            <div className="nav-profile-wrap">
              <button
                className="nav-link nav-profile"
                type="button"
                onClick={() => {
                  if (!user) {
                    signInWithGoogle()
                    return
                  }
                  setShowProfileMenu((open) => !open)
                }}
                aria-label={user ? 'Open profile menu' : 'Profile'}
                aria-expanded={user ? showProfileMenu : undefined}
                aria-haspopup={user ? 'menu' : undefined}
                title={user ? user.name || user.email : 'Sign in with Google'}
              >
                {user?.picture ? (
                  <img
                    className="nav-user-avatar"
                    src={user.picture}
                    alt=""
                  />
                ) : (
                  <span className="nav-profile-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" focusable="false">
                      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                    </svg>
                  </span>
                )}
              </button>

              {user && showProfileMenu ? (
                <div
                  className="profile-menu"
                  role="menu"
                  aria-label="Profile menu"
                >
                  <div className="profile-menu-header">
                    {user.picture ? (
                      <img
                        className="profile-menu-avatar"
                        src={user.picture}
                        alt=""
                      />
                    ) : (
                      <span className="profile-menu-avatar profile-menu-avatar-fallback">
                        {(user.name || user.email || 'U').charAt(0).toUpperCase()}
                      </span>
                    )}
                    <div className="profile-menu-meta">
                      <strong className="profile-menu-name">
                        {user.name || 'User'}
                      </strong>
                      <span className="profile-menu-email">
                        {user.email || '—'}
                      </span>
                    </div>
                  </div>

                  <button
                    className="profile-menu-item"
                    type="button"
                    role="menuitem"
                    onClick={() => setShowProfileMenu(false)}
                  >
                    View Profile
                  </button>
                  <button
                    className="profile-menu-item"
                    type="button"
                    role="menuitem"
                    onClick={async () => {
                      setShowProfileMenu(false)
                      await signOut()
                    }}
                  >
                    Logout
                  </button>
                </div>
              ) : null}
            </div>
          </div>
          {error ? <p className="nav-auth-error">{error}</p> : null}
        </header>
      </div>

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <h1 id="hero-title">Turn Your Invoice Into Bank Balance.</h1>

            <p className="hero-support">
              Learn how MSME invoices can be discounted through TReDS and turned
              into cash in your bank.
            </p>

            <div className="hero-points-wrap">
              <svg
                className="hero-sketch-arrow hero-sketch-arrow-left"
                viewBox="0 0 200 120"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
                overflow="visible"
              >
                <path
                  d="M14 34 C 10 64, 32 90, 64 80 C 98 68, 94 36, 68 40 C 46 44, 52 78, 92 88 C 124 96, 150 88, 168 74"
                  stroke="#1f2937"
                  strokeWidth="3.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M158 58 L186 74 L156 90"
                  stroke="#1f2937"
                  strokeWidth="3.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>

              <div className="hero-points-grid">
                <article className="hero-point-card">
                  <span className="hero-point-check" aria-hidden="true" />
                  <div>
                    <strong>Faster Cash Flow</strong>
                    <p>Get access to cash sooner.</p>
                  </div>
                </article>
                <article className="hero-point-card">
                  <span className="hero-point-check" aria-hidden="true" />
                  <div>
                    <strong>Secure &amp; Regulated</strong>
                    <p>Understand a trusted invoice financing process.</p>
                  </div>
                </article>
                <article className="hero-point-card">
                  <span className="hero-point-check" aria-hidden="true" />
                  <div>
                    <strong>Better Working Capital</strong>
                    <p>Keep your business cash moving.</p>
                  </div>
                </article>
                <article className="hero-point-card">
                  <span className="hero-point-check" aria-hidden="true" />
                  <div>
                    <strong>Grow With Confidence</strong>
                    <p>Use better cash flow to keep your business moving.</p>
                  </div>
                </article>
              </div>

              <svg
                className="hero-sketch-arrow hero-sketch-arrow-right"
                viewBox="0 0 200 120"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
                overflow="visible"
              >
                <path
                  d="M14 34 C 10 64, 32 90, 64 80 C 98 68, 94 36, 68 40 C 46 44, 52 78, 92 88 C 124 96, 150 88, 168 74"
                  stroke="#1f2937"
                  strokeWidth="3.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M158 58 L186 74 L156 90"
                  stroke="#1f2937"
                  strokeWidth="3.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>

            <button className="hero-cta" type="button" onClick={openJoinForm}>
              Join now &gt;
            </button>

            <div className="hero-stats-wrap">
              <svg
                className="hero-stats-shape"
                viewBox="0 0 1200 140"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <path
                  d="M0 60
                     C0 40 18 26 40 26
                     H370
                     C420 26 455 4 500 2
                     C545 0 555 0 600 0
                     C645 0 655 0 700 2
                     C745 4 780 26 830 26
                     H1160
                     C1182 26 1200 40 1200 60
                     V140
                     H0
                     Z"
                  fill="#0a0a0a"
                />
              </svg>

              <div className="hero-stats-badge" aria-live="polite">
                <strong className="hero-stats-badge-timer">
                  {countdown.days}D - {pad2(countdown.hours)}H - {pad2(countdown.minutes)}M -{' '}
                  {pad2(countdown.seconds)}S
                </strong>
              </div>

              <div className="hero-stats">
                <div className="hero-stat">
                  <strong>{formatWorkshopDay(nextWorkshop)}</strong>
                  <span>Day</span>
                </div>
                <div className="hero-stat">
                  <strong>5:00 PM</strong>
                  <span>Time</span>
                </div>
                <div className="hero-stat">
                  <strong>Online</strong>
                  <span>Mode</span>
                </div>
                <div className="hero-stat">
                  <strong>Live 30-Min Workshop</strong>
                  <span>Format</span>
                </div>
                <div className="hero-stat">
                  <strong>Invoice to Instant Cash</strong>
                  <span>Topic</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="section speaker-section" id="speaker">
          <div className="speaker-card">
            <div className="speaker-photo-wrap">
              <img
                className="speaker-photo"
                src="/images/ca-shree-ram-raut.png?v=6"
                alt="CA Shree Ram Raut"
              />
            </div>

            <div className="speaker-content">
              <p className="speaker-eyebrow">Know Your Mentor</p>
              <h2>CA Shree Ram Raut</h2>
              <p className="speaker-intro">
                Expertise in Finance, Taxation, Auditing &amp; Risk Management
              </p>

              <ul className="speaker-exp">
                <li>Chartered Accountant</li>
                <li>SEBI-Registered Research Analyst</li>
                <li>Ex-Deloitte</li>
                <li>Partner at S G P R &amp; Co.</li>
                <li>Strategic Financial Planning &amp; Management</li>
                <li>
                  Founder: Fintaxcoach, Finovert &amp; Ezywapaar
                </li>
              </ul>
            </div>

            <div className="speaker-actions">
              <button
                className="hero-cta speaker-cta"
                type="button"
                onClick={openJoinForm}
              >
                Join now &gt;
              </button>
            </div>
          </div>
        </section>

        <section className="section" id="register">
          <div className="spot-banner register-banner">
            <div className="spot-copy">
              <h2>Reserve Your Place.</h2>
              <p className="register-desc">
                The workshop is available through the waiting list. Complete your
                registration{' '}
                <span className="register-desc-line">
                  to reserve your place for the Sunday session.
                </span>
              </p>

              <p className="register-price">
                Reserve Your Place — <strong>₹1</strong>
              </p>

              <div className="spot-actions register-join-actions register-join-actions--desktop">
                <button
                  className="spot-cta"
                  type="button"
                  onClick={openJoinForm}
                >
                  Join now &gt;
                </button>
                <p className="spot-pill register-schedule">
                  <span>
                    Scheduled on <strong>{formatWorkshopDay(nextWorkshop)}</strong>{' '}
                    at <strong>5:00 PM</strong>
                  </span>
                </p>
              </div>

              <p className="spot-pill register-schedule register-schedule--mobile">
                <span>
                  Scheduled on <strong>{formatWorkshopDay(nextWorkshop)}</strong>{' '}
                  at <strong>5:00 PM</strong>
                </span>
              </p>

              <p className="register-flow">
                Payment → Confirmation → Added to Waiting List →{' '}
                {formatWorkshopDay(nextWorkshop)} Workshop at 5:00 PM
              </p>
              <p className="register-trust">
                <span className="register-trust-live">Live</span> • Online •
                Interactive • Practical
              </p>
            </div>

            <div className="spot-art">
              <div className="spot-video">
                <div className="spot-video-screen">
                  <div className="spot-video-top" aria-hidden="true">
                    <span className="spot-video-live">
                      <i /> LIVE
                    </span>
                    <span className="spot-video-title">Sunday Workshop Preview</span>
                  </div>

                  <div className="spot-video-bars" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </div>

                  <button
                    className="spot-video-play"
                    type="button"
                    aria-label="Locked webinar video — join waitlist to unlock"
                    onClick={openJoinForm}
                  >
                    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                      <path d="M8 6.82v10.36c0 .79.87 1.27 1.54.84l8.14-5.18a1 1 0 0 0 0-1.69L9.54 5.98A.99.99 0 0 0 8 6.82z" />
                    </svg>
                  </button>

                  <span className="spot-video-lock" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" focusable="false">
                      <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2" />
                      <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <circle cx="12" cy="16" r="1.25" fill="currentColor" />
                    </svg>
                  </span>

                  <div className="spot-video-controls" aria-hidden="true">
                    <div className="spot-video-progress">
                      <span className="spot-video-progress-fill" />
                    </div>
                    <div className="spot-video-controls-row">
                      <span className="spot-video-time">0:00 / 45:00</span>
                      <div className="spot-video-tools">
                        <svg viewBox="0 0 24 24" fill="none">
                          <path d="M4 10v4h4l5 4V6L8 10H4z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                          <path d="M16 9.5a3.5 3.5 0 0 1 0 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                        </svg>
                        <svg viewBox="0 0 24 24" fill="none">
                          <path d="M9 4H5v4M15 4h4v4M15 20h4v-4M9 20H5v-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                    </div>
                  </div>
                </div>
                <p className="spot-video-caption">
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2" />
                    <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  Locked Video
                </p>
              </div>
              <p className="register-price-under-video">
                Reserve Your Place — <strong>₹1</strong>
              </p>
            </div>

            <div className="spot-actions register-join-actions register-join-actions--mobile">
              <button
                className="spot-cta"
                type="button"
                onClick={openJoinForm}
              >
                Join now &gt;
              </button>
            </div>
          </div>
        </section>

        <section className="section treds-section" id="treds" aria-labelledby="treds-title">
          <div className="treds-banner">
            <header className="treds-header">
              <h2 id="treds-title">Invoice to Bank Balance via TReDS</h2>
              <p className="treds-subtitle">
                From unpaid invoices to faster working capital.
              </p>
            </header>

            <div className="treds-flow">
              <article className="treds-card treds-card--input" aria-label="Input: Invoice">
                <span className="treds-badge treds-badge--input">INPUT</span>
                <div className="treds-card-title">
                  <h3>Invoice</h3>
                </div>
                <ul className="treds-list">
                  <li>Goods/Services Delivered</li>
                  <li>Invoice Raised</li>
                  <li>Buyer Accepts</li>
                  <li>Uploaded on TReDS</li>
                </ul>
              </article>

              <div className="treds-hub" aria-hidden="true">
                <div className="treds-hub-line treds-hub-line--left">
                  <span className="treds-hub-dash" />
                  <svg className="treds-hub-arrow" viewBox="0 0 24 24" focusable="false">
                    <path d="M5.5 4.2 Q10.2 12 5.5 19.8 L19.2 12 Z" />
                  </svg>
                </div>
                <div className="treds-hub-core">
                  <p className="treds-hub-label">TReDS</p>
                  <span className="treds-hub-circle">
                    <svg viewBox="0 0 24 24" fill="none">
                      <path
                        d="M4 19h16M6 19V9l6-4 6 4v10"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinejoin="round"
                      />
                      <path d="M10 19v-5h4v5" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <p className="treds-hub-strong">Transparent • Secure • Fast</p>
                  <p className="treds-hub-meta">Technology | Trust | Liquidity</p>
                </div>
                <div className="treds-hub-line treds-hub-line--right">
                  <span className="treds-hub-dash" />
                  <svg className="treds-hub-arrow" viewBox="0 0 24 24" focusable="false">
                    <path d="M5.5 4.2 Q10.2 12 5.5 19.8 L19.2 12 Z" />
                  </svg>
                </div>
              </div>

              <article className="treds-card treds-card--output" aria-label="Output: Bank Balance">
                <span className="treds-badge treds-badge--output">OUTPUT</span>
                <div className="treds-card-title">
                  <h3>Bank Balance</h3>
                </div>
                <ul className="treds-list treds-list--output">
                  <li>Invoice Discounted</li>
                  <li>Funds Transferred</li>
                  <li>Instant Liquidity</li>
                  <li>Business Keeps Moving</li>
                </ul>
              </article>
            </div>
          </div>
        </section>

        <section className="section treds-summary-section" aria-labelledby="webinar-objectives-title">
          <h2 id="webinar-objectives-title" className="treds-summary-title">
            Webinar Objectives
          </h2>
          <blockquote className="treds-quote">
            <span className="treds-quote-mark treds-quote-mark--open" aria-hidden="true">
              “
            </span>
            <p className="treds-lead">
              <span className="treds-lead-line">
                Understand TReDS &amp; Invoice Discounting,
              </span>
              <span className="treds-lead-line">
                learn how to unlock cash against invoices,
              </span>
              <span className="treds-lead-line">
                understand eligibility and the process, improve cash flow
              </span>
              <span className="treds-lead-line">
                and working capital, and see a practical real-world example.
              </span>
            </p>
            <p className="treds-lead treds-lead--mobile">
              Understand TReDS &amp; Invoice Discounting, learn how to unlock
              cash against invoices, understand eligibility and the process,
              improve cash flow and working capital, and see a practical
              real-world example.
            </p>
            <span className="treds-quote-mark treds-quote-mark--close" aria-hidden="true">
              ”
            </span>
          </blockquote>

          <button
            className="hero-cta treds-summary-cta"
            type="button"
            onClick={openJoinForm}
          >
            Join now &gt;
          </button>
        </section>

        <section className="section faq-section" id="faq" aria-labelledby="faq-title">
          <h2 id="faq-title" className="faq-title">
            <span className="faq-title-main">FAQs — TReDS</span>
            <span className="faq-title-sep">, </span>
            <span className="faq-title-sub">
              Invoice Discounting &amp; Invoice Financing
            </span>
          </h2>

          <div className="faq-list">
            {(showAllFaqs ? FAQ_ITEMS : FAQ_ITEMS.slice(0, 5)).map((item) => (
              <article className="faq-item" key={item.q}>
                <h3 className="faq-question">{item.q}</h3>
                <p className="faq-answer">{item.a}</p>
              </article>
            ))}
          </div>

          <button
            className="faq-more"
            type="button"
            onClick={() => setShowAllFaqs((open) => !open)}
          >
            {showAllFaqs ? 'Show less' : 'more...'}
          </button>
        </section>
      </main>

      <footer className="footer">
        <div className="footer-inner">
          <a className="footer-brand" href="#top">
            <img
              className="brand-logo brand-logo--footer"
              src="/images/logo.png?v=2"
              alt="BizVyapar"
            />
          </a>
          <p>Waitlist webinar for Indian small businesses.</p>
        </div>
      </footer>

      {showJoinForm && (
        <div
          className="popup-overlay join-form-overlay"
          role="presentation"
          onClick={closeJoinForm}
        >
          <div
            className="join-form-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="join-form-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="join-form-close"
              aria-label="Close form"
              onClick={closeJoinForm}
            >
              ×
            </button>

            <div className="join-card">
              {joinStep === 'success' && submitted ? (
                <div className="review-panel" role="status">
                  <h2 id="join-form-title">You’re in</h2>
                  <p className="join-sub">
                    {message ||
                      'Your payment is done. Now you are in for the Webinar.'}
                  </p>

                  {submitted.emailSent ? (
                    <p className="join-sub">
                      We sent the webinar link to <strong>{submitted.email}</strong>.
                    </p>
                  ) : (
                    <p className="form-error" role="alert">
                      Email not sent to <strong>{submitted.email}</strong>
                      {submitted.emailError ? `: ${submitted.emailError}` : '.'}
                      {' '}Please check Gmail SMTP settings in backend/.env.
                    </p>
                  )}

                  {submitted.webinarLink ? (
                    <a
                      className="btn-trial"
                      href={submitted.webinarLink}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open webinar link
                    </a>
                  ) : null}
                </div>
              ) : joinStep === 'payment' ? (
                <>
                  <h2 id="join-form-title">Complete payment</h2>
                  <p className="join-sub">
                    Pay securely to confirm your webinar seat.
                  </p>

                  <div className="payment-illustration-wrap">
                    <img
                      className="payment-illustration"
                      src="/images/payment.png?v=2"
                      alt=""
                      aria-hidden="true"
                    />
                  </div>

                  <div className="payment-summary">
                    <ul className="payment-perks">
                      <li>
                        <span>All Upcoming Webinar</span>
                        <CheckIcon className="payment-perk-check" />
                      </li>
                      <li>
                        <span>1-to-1 Mentorship</span>
                        <CheckIcon className="payment-perk-check" />
                      </li>
                      <li>
                        <span>Business Learning</span>
                        <CheckIcon className="payment-perk-check" />
                      </li>
                      <li>
                        <span>Invoice Financing Support</span>
                        <CheckIcon className="payment-perk-check" />
                      </li>
                      <li>
                        <span>Access Till Programme Ends</span>
                        <CheckIcon className="payment-perk-check" />
                      </li>
                    </ul>

                    <div className="payment-total">
                      <span>Live 30-Min Workshop</span>
                      <strong>₹1</strong>
                    </div>
                  </div>

                  {status === 'error' && (
                    <p className="form-error" role="alert">
                      {message}
                    </p>
                  )}

                  <p className="payment-recipient">
                    Payment Partner <strong>RECUIT PLUS PVT LTD.</strong>
                  </p>

                  <button
                    className="btn-trial"
                    type="button"
                    onClick={handlePayNow}
                    disabled={status === 'loading' || signingIn}
                  >
                    {status === 'loading' || signingIn
                      ? message?.includes('Confirming')
                        ? 'Confirming payment…'
                        : 'Please wait…'
                      : user
                        ? 'Pay Now · Join'
                        : 'Sign in & Pay Now'}
                  </button>

                  <p className="form-note">
                    Secure payment · Instant confirmation
                  </p>

                  <button
                    className="btn-back"
                    type="button"
                    onClick={() => {
                      setStatus('idle')
                      setMessage('')
                      pendingOrderRef.current = null
                      setJoinStep('details')
                    }}
                    disabled={status === 'loading'}
                  >
                    ← Back to details
                  </button>
                </>
              ) : (
                <>
                  <h2 id="join-form-title">Reserve your free seat</h2>
                  <p className="join-sub">
                    Enter your details and we will send the webinar link.
                  </p>

                  <form className="join-form" onSubmit={handleDetailsNext} noValidate>
                    <label className="pill-field">
                      <span className="sr-only">Name</span>
                      <input
                        type="text"
                        name="name"
                        autoComplete="name"
                        placeholder="Name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                      />
                      <FieldIcon filled={name.trim().length > 0}>
                        <svg viewBox="0 0 24 24" focusable="false">
                          <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                        </svg>
                      </FieldIcon>
                    </label>

                    <label className="pill-field">
                      <span className="sr-only">Email</span>
                      <input
                        type="email"
                        name="email"
                        autoComplete="email"
                        placeholder="Email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                      />
                      <FieldIcon filled={email.trim().length > 0}>
                        <svg viewBox="0 0 24 24" focusable="false">
                          <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z" />
                        </svg>
                      </FieldIcon>
                    </label>

                    <label className="pill-field pill-phone">
                      <span className="phone-label">Phone</span>
                      <span className="phone-prefix" aria-hidden="true">
                        <span className="flag" />
                        +91
                      </span>
                      <input
                        type="tel"
                        name="phone"
                        autoComplete="tel"
                        placeholder="10-digit mobile"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                      />
                      <FieldIcon filled={phone.trim().length > 0}>
                        <svg viewBox="0 0 24 24" focusable="false">
                          <path d="M6.62 10.79a15.15 15.15 0 006.59 6.59l2.2-2.2a1 1 0 011.01-.24c1.12.37 2.33.57 3.58.57a1 1 0 011 1V20a1 1 0 01-1 1C10.4 21 3 13.6 3 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.45.57 3.57a1 1 0 01-.25 1.02l-2.2 2.2z" />
                        </svg>
                      </FieldIcon>
                    </label>

                    <label className="consent">
                      <input
                        type="checkbox"
                        checked={consent}
                        onChange={(e) => setConsent(e.target.checked)}
                      />
                      <span>
                        I authorise BizVyapar &amp; its representatives to
                        contact me with updates and notifications via
                        Email/SMS/WhatsApp/Call and other channels, even if my
                        number is registered on DND/NDNC.
                      </span>
                    </label>

                    {status === 'error' && (
                      <p className="form-error" role="alert">
                        {message}
                      </p>
                    )}

                    <button className="btn-trial" type="submit">
                      Next &gt;
                    </button>

                    <p className="form-note">
                      Next step: payment to confirm your seat.
                    </p>
                  </form>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
