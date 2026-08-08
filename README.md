# Data Guardian 2.0

Secure data sharing platform. Owners upload encrypted files, share OTP-protected links with vendors, and track access in real time.

## Stack

- **Next.js 16** (App Router) + TypeScript + React 19
- **Prisma** + PostgreSQL
- **MongoDB** (document ops)
- **NextAuth** (Google OAuth)
- **Upstash Redis** (sessions / rate limits)
- **AES-256-GCM** encryption

## Setup

```bash
npm install
# create .env (see variables below)
npx prisma generate
npx prisma db push
npm run dev
```

App runs at `http://localhost:3000`.

## Env vars

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL (pooled) |
| `DIRECT_URL` | yes | PostgreSQL (migrations) |
| `NEXTAUTH_URL` / `NEXTAUTH_SECRET` | yes | Auth |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | yes | Google login |
| `ENCRYPTION_KEY` / `KEK_KEY` | yes | File encryption |
| `EMAIL_USER` / `EMAIL_PASS` | yes | OTP email (SMTP) |
| `MONGODB_URI` | yes | MongoDB |
| `UPSTASH_REDIS_REST_URL` / `TOKEN` | optional | Redis |
| `CRON_SECRET` | optional | Cleanup cron auth |
| `SECURE_STORAGE_PATH` | optional | Local encrypted files |

## Structure

```
src/
├── app/                 # Pages + API routes
│   ├── api/             # REST + SSE endpoints
│   ├── auth/            # Sign-in, role select
│   ├── create-link/     # Owner creates secure links
│   ├── dashboard/       # Owner & vendor dashboards
│   ├── editor/          # In-browser file editor
│   ├── share/[token]/   # OTP entry
│   ├── view/[token]/    # Secure viewer
│   └── revoke/          # Owner revoke link
├── actions/             # Server actions (OTP, upload, revoke…)
├── components/
│   ├── editors/         # PDF / spreadsheet / text editor
│   └── view/            # Secure viewer UI (chat, shield, autosave)
├── lib/                 # crypto, auth, redis, security, storage
├── store/               # Zustand (collaboration)
└── middleware.ts        # Route protection

prisma/                  # DB schema + migrations
```

## Main flow

1. Owner signs in → creates a secure link with files  
2. Vendors open `/share/[token]` → verify OTP  
3. Work in `/view/[token]` or `/editor/...` (encrypted, no export)  
4. Owner monitors live activity; can revoke anytime  

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm start` | Run production |
| `npm run lint` | ESLint |
