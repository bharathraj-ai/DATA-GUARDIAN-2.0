# Secure Protocol 1.0

Zero-trust secure data sharing. Team leaders upload encrypted files, share OTP-protected links with vendors, and revoke instantly.

**Hierarchy:** Admin → Company → Manager → Team leader (owner) → Vendor

## Stack

- **Next.js 16** (App Router) + TypeScript + React 19
- **Prisma** + PostgreSQL
- **MongoDB GridFS** (ciphertext object store — not S3)
- **NextAuth** (Google OAuth + optional OIDC)
- **Upstash Redis** (sessions / rate limits / revoke — required in production)
- **AES-256-GCM** encryption at rest

## Setup

```bash
npm install
# copy .env.example → .env and fill values
npx prisma generate
npx prisma migrate deploy   # or: npx prisma db push
npm run dev
```

App runs at `http://localhost:3000`.

## Env vars

See [`.env.example`](.env.example) for the full list. Critical production requirements:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` / `DIRECT_URL` | PostgreSQL |
| `NEXTAUTH_URL` / `NEXTAUTH_SECRET` | Auth |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google login |
| `ENCRYPTION_KEY` / `KEK_KEY` | Distinct 64-hex keys |
| `OTP_HMAC_SECRET` / `SESSION_HMAC_SECRET` / `AUDIT_HMAC_SECRET` | Distinct HMAC secrets |
| `UPSTASH_REDIS_REST_URL` / `TOKEN` | Required in production |
| `MONGODB_URI` | GridFS ciphertext |
| `EMAIL_USER` / `EMAIL_PASS` | OTP email (SMTP) |
| `CRON_SECRET` | Cleanup cron auth |
| `ADMIN_EMAILS` | Optional platform admin allowlist |

Optional: malware Lambda (`AWS_LAMBDA_SCAN_*`), HTTP KMS, Sentry, OIDC SSO.

## Main flow

1. Sign in → pick **Team leader** or **Vendor** (Company / Manager / Admin are invite- or seed-only)
2. Team leader creates a secure link with files (plan limits apply)
3. Vendors open `/share/[token]` → verify **emailed** OTP
4. Work in `/view/[token]` or `/editor/...`
5. Team leader monitors and revokes anytime

## Structure

```
src/
├── app/                 # Pages + API routes
│   ├── api/             # REST + SSE endpoints
│   ├── auth/            # Sign-in, role select
│   ├── create-link/     # Team leader creates secure links
│   ├── dashboard/       # admin | company | manager | owner | vendor
│   ├── settings/        # Account settings
│   ├── help|docs|status/
│   ├── editor/          # In-browser file editor
│   ├── share/[token]/   # OTP entry
│   ├── view/[token]/    # Secure viewer
│   └── revoke/          # Owner revoke link
├── actions/             # Server actions
├── components/
├── lib/                 # crypto, auth, redis, security, storage, plans
└── proxy.ts             # CSP / CSRF / route protection (Next.js proxy)
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm start` | Run production |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript |
| `npm test` | Jest (incl. production contracts) |

## Plans

Free / Team / Enterprise limits are enforced on create-link. Upgrades are request/contact-sales (no Stripe in v1).

## Malware scan Lambda

Optional deploy scripts live under `infra/lambda/malware-scan/`.
