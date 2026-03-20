# 🛡️ Data Guardian 2.0

**Enterprise-grade secure data sharing platform** with military-grade encryption, real-time collaboration, and Zero Trust security architecture.

## ✨ Key Features

- **🔐 AES-256-GCM Encryption** — Military-grade encrypted file storage for all shared data.
- **🔑 Zero Trust OTP Protection** — 6-digit one-time passwords, completely isolated per-vendor.
- **👥 Dynamic Group Sharing** — Share secure links with multiple vendors, enforcing individual OTP authentication.
- **🥇 Arranged Vendor Priority** — Explicit hierarchical control (Level 1, Level 2, etc.) for collaborative editing. Higher levels transparently preempt lower levels.
- **⚡ Real-Time Collaboration** — Live document editor with built-in secure chat, utilizing Server-Sent Events (SSE).
- **🟢 Live Activity Monitor** — Owners can track real-time connection status and chat feeds of all participants directly from the dashboard.
- **🚫 Instant Revocation & Self-Destruct** — Links can be explicitly revoked or set to auto-expire.
- **📸 Anti-Screenshot & Device Binding** — Automatic revocation on screenshot attempts and session locking to original hardware fingerprints.

## 🚀 Tech Stack

| Technology | Purpose |
|---|---|
| **Next.js 16 (App Router)** | Full-stack React framework |
| **TypeScript** | Type-safe development |
| **Prisma (PostgreSQL)** | Type-safe database ORM |
| **NextAuth.js** | Google OAuth Authentication |
| **Upstash Redis** | High-performance Rate limiting & Session Management |
| **Server-Sent Events (SSE)** | Low-latency Real-time Data Streaming |

## 📦 Getting Started

### Prerequisites

- **Node.js** ≥ 18.17.0
- **PostgreSQL** database (e.g., [Neon](https://neon.tech))
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

## 🏗️ Architecture Summary

```text
src/
├── app/                    # Next.js App Router endpoints
│   ├── api/                # API routes (health, SSE streams, collaboration)
│   ├── auth/               # Authentication logic & OAuth handling
│   ├── dashboard/          # Owner & Vendor dashboards
│   ├── create-link/        # Secure group link creation with priority mapping
│   ├── view/               # Secure view interface with Universal File Editor
│   └── share/              # OTP validation entry point (per-vendor)
├── components/             # Reusable UI React components (LiveActivityModal, ChatPanel, etc)
├── lib/                    # Core utilities & configuration
│   ├── auth.ts             # NextAuth strategies
│   ├── crypto.ts           # AES-256 and HMAC wrappers
│   └── rate-limit.ts       # Upstash Redis rate limiter
├── actions/                # Next.js Server Actions (Database mutations)
│   ├── verify-otp.ts       # Per-vendor zero-trust validation
│   ├── get-user.ts         # Authentication state retrieval
│   └── realtime.ts         # Collaboration presence state
└── prisma/                 # Database schema models (PostgreSQL)
```

## 🐳 Docker Deployment

```bash
# Build the image
docker build -t data-guardian .

# Run the container
docker run -p 3000:3000 --env-file .env data-guardian
```

*The Dockerfile includes an automated `HEALTHCHECK` that guarantees the container is responding effectively.*

## 🔒 Security Principles

- **Zero Trust**: No operation assumes safety; verification required per vendor/device.
- **Single-Attempt OTP**: OTPs invalid upon failure or success.
- **Hardware Binding**: Sessions bound to precise device fingerprints via modern browser APIs.
- **Event Revocation**: Live SSE streams are aggressively severed upon compromise or expiry.

## 📄 License
Private — All rights reserved.
