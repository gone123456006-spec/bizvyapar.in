# Easy Vyapar

Billing and business management app with a separated frontend and backend.

## Project structure

```
easy-vyapar/
├── frontend/   # React + Vite (port 5173)
├── backend/    # Express API (port 5000)
└── package.json
```

## Setup

```bash
npm install
```

## Run

Start both servers:

```bash
npm run dev
```

Or start them separately:

```bash
npm run dev:backend
npm run dev:frontend
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:5000/api
- Health check: http://localhost:5000/api/health

Frontend `/api` requests are proxied to the backend during development.
