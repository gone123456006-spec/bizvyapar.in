# BizVyapar

Waitlist webinar app (React + Vite frontend, Express API).

## Project structure

```
bizvyapar/
├── api/          # Vercel serverless entry (Express)
├── frontend/     # React + Vite
├── backend/      # Express API (local + shared with Vercel)
├── vercel.json
└── package.json
```

## Local setup

```bash
npm install
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
# fill in real values in both .env files
npm run dev
```

- Frontend: http://localhost:5173  
- API: http://localhost:5000/api  
- Health: http://localhost:5000/api/health  

Frontend `/api` is proxied to the backend in development.

## Production build (local check)

```bash
npm run build
npm run preview
```

## Deploy backend on Render (recommended for API)

1. Push this repo to GitHub.
2. In [Render](https://render.com) → **New** → **Blueprint** (uses [`render.yaml`](./render.yaml))  
   **or** **Web Service** with:
   - **Root Directory:** `backend`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Health Check Path:** `/health`
3. Add a **Postgres** database and set `DATABASE_URL` (Blueprint does this automatically).
4. Add env vars from [`backend/.env.example`](./backend/.env.example)  
   (required: `CORS_ORIGIN`, Razorpay keys, `RAZORPAY_WEBHOOK_SECRET`, `WEBINAR_LINK`, Gmail SMTP, Firebase).
5. Razorpay webhook URL: `https://YOUR-SERVICE.onrender.com/api/payments/webhook`
6. Keep-alive (prevent free-tier sleep):
   - Set GitHub secret `KEEPALIVE_URL=https://YOUR-SERVICE.onrender.com/health`  
     (workflow runs every minute), **or**
   - Set Render cron `KEEPALIVE_URL` to the same `/health` URL, **or**
   - Run `KEEPALIVE_URL=... npm run keepalive` on any always-on machine.
7. Verify:
   - `GET /health` → lightweight `{ status: "ok" }`
   - `GET /api/health` → `ready: true` + `database: "postgres"`

### Product logic (live)

- **Google before pay** — create-order/verify require Firebase Bearer token; seat binds to `uid` tenant.
- **Idempotent payments** — same `payment_id` returns success without duplicate rows/emails.
- **Reminders** — T-24h and T-30m before Sunday 5:00 PM from each paid user’s own record.
- **Webhook** — `payment.captured` still records the seat if the browser closes.

### Connect frontend to Render API

In the frontend host (Vercel or elsewhere), set:

```
VITE_API_BASE_URL=https://YOUR-SERVICE.onrender.com
```

Rebuild/redeploy the frontend after changing this.

Also allow your frontend domain in Firebase Auth and Razorpay Checkout.

## Deploy on Vercel (frontend + optional combined API)

1. Push this repo to GitHub.
2. Import the repo in [Vercel](https://vercel.com) (root directory = repo root).
3. Vercel will use `vercel.json` (`build` → `frontend/dist`, `/api` → Express).
4. Add all variables from [`.env.example`](./.env.example) in  
   **Project → Settings → Environment Variables** (Production + Preview).
5. If API is on Render, set `VITE_API_BASE_URL` to the Render URL and you can skip backend env on Vercel.
6. If API stays on Vercel, set `CORS_ORIGIN` to your live URL.
7. In Firebase Console → Authentication → Authorized domains, add your domain.
8. In Razorpay Dashboard, allow your production domain for Checkout.
9. Deploy.

### After deploy

- Site: `https://your-app.vercel.app`
- Health (Vercel API): `https://your-app.vercel.app/api/health`
- Health (Render API): `https://YOUR-SERVICE.onrender.com/api/health`

### Notes

- **User isolation:** every person gets a separate database under `backend/data/tenants/<tenantId>/database.json` (profile, payments, registrations, activity). Shared `users.json` / `waitlist.json` are retired and auto-migrated once on startup.
- Waitlist file storage on Vercel uses `/tmp` (ephemeral). On Render it uses `backend/data` on the service disk (survives restarts; wiped on some redeploys — use a DB for permanent storage later).
- Own profile APIs: `GET /api/profile/me`, `GET /api/auth/me` (Bearer Firebase token) — returns **only that user's** data.
- `FIREBASE_PRIVATE_KEY`: paste with `\n` characters or use the multiline env UI.
- Keep `RAZORPAY_KEY_SECRET`, SMTP password, and Firebase private key **server-only** (no `VITE_` prefix).
- Free Render services may sleep when idle; first request after sleep can take ~30–60s.
