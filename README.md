# 🛡️ Data Guardian 2.0

**Enterprise-grade secure data sharing platform** with military-grade encryption, OTP protection, and instant revocation.

## ✨ Features

- **🔐 AES-256-GCM Encryption** — Military-grade encryption for all shared data
- **🔑 OTP Protection** — 6-digit one-time passwords with HMAC-SHA256 hashing
- **⏱️ Self-Destructing Links** — Time-limited access with automatic expiry
- **🚫 Instant Revocation** — Revoke access immediately from the owner dashboard
- **📸 Screenshot Detection** — Automatic access revocation on screenshot attempts
- **📱 QR Code Delivery** — Generate QR codes for easy link sharing
- **🏗️ Zero-Knowledge Architecture** — We can't read your data, ever
- **🔒 Device & Email Binding** — Prevent session hijacking and link forwarding

## 🚀 Tech Stack

| Technology | Purpose |
|---|---|
| **Next.js 16** | Full-stack React framework (App Router) |
| **TypeScript** | Type-safe development |
| **Prisma** | Database ORM with PostgreSQL |
| **NextAuth.js** | Authentication (Google OAuth) |
| **Upstash Redis** | Rate limiting & session management |
| **Zod** | Runtime input validation |

## 📦 Getting Started

### Prerequisites

- **Node.js** ≥ 18.17.0 (see `.nvmrc`)
- **PostgreSQL** database (or [Neon](https://neon.tech))
- **Google OAuth** credentials
- **Upstash Redis** instance

### Installation

```bash
# Clone the repository
git clone https://github.com/bharathraj-ai/DATA-GUARDIAN-2.0.git
cd DATA-GUARDIAN-2.0

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your credentials

# Generate Prisma client
npx prisma generate

# Push database schema
npx prisma db push

# Start development server
npm run dev
```

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `GOOGLE_CLIENT_ID` | ✅ | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | ✅ | Google OAuth client secret |
| `NEXTAUTH_URL` | ✅ | Application base URL |
| `NEXTAUTH_SECRET` | ✅ | NextAuth.js secret key |
| `ENCRYPTION_KEY` | ✅ | AES-256 encryption key (32 bytes, hex) |
| `UPSTASH_REDIS_REST_URL` | ✅ | Redis REST API URL |
| `UPSTASH_REDIS_REST_TOKEN` | ✅ | Redis REST API token |

## 🏗️ Architecture

```
src/
├── app/                    # Next.js App Router pages
│   ├── api/                # API routes (health check)
│   ├── auth/               # Authentication pages
│   ├── dashboard/          # Owner & Vendor dashboards
│   ├── how-it-works/       # How it works page
│   ├── legal/              # Privacy, Terms, Cookies
│   ├── services/           # Services page
│   └── signup/             # Secure link creation
├── components/             # Shared UI components
├── lib/                    # Utilities & configuration
│   ├── auth.ts             # NextAuth configuration
│   ├── crypto.ts           # Encryption & hashing utilities
│   ├── rate-limit.ts       # Rate limiting with Redis
│   └── validations.ts      # Zod validation schemas
├── actions/                # Server actions
│   ├── verify-otp.ts       # OTP verification logic
│   └── revoke-on-screenshot.ts  # Screenshot revocation
└── types/                  # TypeScript type extensions
```

## 🐳 Docker

```bash
# Build the image
docker build -t data-guardian .

# Run the container
docker run -p 3000:3000 --env-file .env data-guardian
```

The Dockerfile includes a `HEALTHCHECK` that pings `/api/health` every 30 seconds.

## 🔒 Security

- **Zero Trust**: All operations validated server-side
- **Single-Attempt OTP**: OTPs are invalidated after first use
- **Rate Limiting**: Protection against brute-force attacks
- **Device Binding**: Sessions bound to the original device
- **Email Binding**: Links restricted to the intended recipient
- **Audit Logging**: Complete trail of all security events

## 📄 License

Private — All rights reserved.
