# 🛡️ Data Guardian 2.0

**Enterprise-grade secure data sharing platform** with military-grade encryption, real-time collaboration, and Zero Trust security architecture.

## ✨ Key Features

- **🔐 AES-256-GCM Encryption** — Military-grade encrypted file storage with per-file Data Encryption Keys (DEK).
- **🔑 Zero Trust OTP Protection** — 6-digit one-time passwords, per-vendor isolation. Single attempt policy — wrong OTP = permanent revocation.
- **👥 Dynamic Group Sharing** — Share secure links with multiple vendors, each with their own OTP and hierarchical access level.
- **🥇 Hierarchical Vendor Priority** — Explicit level-based control (Level 1 Owner, Level 2 Admin, etc.). Higher levels preempt lower-level editing.
- **⚡ Real-Time Collaboration** — Live document editing with built-in encrypted chat via Server-Sent Events (SSE).
- **🟢 Live Activity Monitor** — Owners track real-time connection status, active participants, and chat feeds from the dashboard.
- **🚫 Instant Revocation & Self-Destruct** — Links can be explicitly revoked or auto-expire. All data permanently deleted on expiry.
- **📸 Anti-Screenshot & Device Binding** — Automatic access revocation on screenshot attempts (PrintScreen, Win+Shift, Snipping Tool), tab switching, and DevTools. Sessions locked to original device fingerprint.
- **🔒 Anti-Phishing Protection** — 3-minute OTP verification window, single-use OTP enforcement, forwarded link detection with owner alerts.

## 🔒 Security Architecture

### Keyboard & Interaction Blocking (View Page)

| Threat Vector | Protection |
|---|---|
| Tab Switch / Alt+Tab | `visibilitychange` + `blur` → instant revocation |
| PrintScreen | `keydown` + `keyup` → instant revocation |
| Win+Shift (Snipping Tool) | `keydown` capture → instant revocation |
| Ctrl+P (Print) | Blocked + instant revocation |
| Ctrl+S (Save) | Blocked + instant revocation |
| Ctrl+C (Copy) | Blocked + instant revocation |
| Ctrl+U (View Source) | Blocked + instant revocation |
| Ctrl+Shift+I/J (DevTools) | Blocked + instant revocation |
| F12 (DevTools) | Blocked + instant revocation |
| Right-click | Context menu disabled |
| Text Selection | CSS `user-select: none` |
| Drag & Drop | `dragstart` → instant revocation |
| Print (CSS) | `@media print` hides all content |

### Zero Trust Principles

- **Single-Attempt OTP** — Wrong OTP = permanent link revocation. No retries.
- **Device Binding** — Sessions bound to browser/device fingerprint on first use.
- **Email Binding** — OTPs locked to specific vendor emails. Forwarded links are blocked.
- **Kill Switch** — Redis session invalidation + DB revocation on any security violation.
- **Event Revocation** — SSE streams severed instantly on compromise, expiry, or owner action.

## 🚀 Tech Stack

| Technology | Purpose |
|---|---|
| **Next.js (App Router)** | Full-stack React framework |
| **TypeScript** | Type-safe development |
| **Prisma (PostgreSQL)** | Type-safe database ORM |
| **NextAuth.js** | Google OAuth Authentication |
| **Upstash Redis** | Rate limiting & Session Management |
| **Nodemailer (Gmail SMTP)** | OTP & notification email delivery |
| **Server-Sent Events (SSE)** | Real-time data streaming & collaboration |

## 📦 Getting Started

### Prerequisites

- **Node.js** ≥ 18.17.0
- **PostgreSQL** database (e.g., [Neon](https://neon.tech))
- **Google OAuth** credentials
- **Upstash Redis** instance (optional — gracefully degrades without it)

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
| `KEK_KEY` | ✅ | Key Encryption Key for per-file DEKs |
| `EMAIL_USER` | ✅ | Gmail address for sending OTPs |
| `EMAIL_PASS` | ✅ | Gmail App Password |
| `UPSTASH_REDIS_REST_URL` | ⬜ | Redis REST API URL (optional) |
| `UPSTASH_REDIS_REST_TOKEN` | ⬜ | Redis REST API token (optional) |

## 🏗️ Project Structure

```
src/
├── app/                        # Next.js App Router
│   ├── api/                    # API routes
│   │   ├── stream/             # SSE real-time data streaming
│   │   ├── collaboration/      # Heartbeat & presence endpoints
│   │   ├── chat/               # Real-time chat API
│   │   ├── session-monitor/    # Live session monitoring
│   │   ├── documents/          # Document CRDT operations
│   │   ├── files/              # File serving endpoints
│   │   ├── cleanup/            # Auto-expiry cleanup
│   │   └── health/             # Container health check
│   ├── auth/                   # OAuth sign-in/sign-out
│   ├── dashboard/              # Owner & Vendor dashboards
│   ├── create-link/            # Secure link creation with file upload
│   ├── view/[token]/           # Secure data viewer with protections
│   ├── share/[token]/          # OTP verification entry point
│   └── revoke/[ownerToken]/    # Link revocation page
├── actions/                    # Next.js Server Actions
│   ├── verify-otp.ts           # Per-vendor Zero Trust OTP validation
│   ├── create-link-with-files.ts # Encrypted link + file creation
│   ├── revoke-on-screenshot.ts # Security violation handler
│   ├── get-user.ts             # Authenticated data retrieval
│   ├── dashboard.ts            # Dashboard data queries
│   └── ...                     # Other server mutations
├── components/                 # React components
│   ├── editors/                # UniversalEditor (PDF, DOCX, etc.)
│   ├── LiveActivityModal.tsx   # Real-time session monitoring
│   ├── Navbar.tsx              # Navigation bar
│   └── ...                     # Other UI components
├── lib/                        # Core utilities
│   ├── crypto.ts               # AES-256-GCM, HMAC, DEK/KEK encryption
│   ├── auth.ts                 # NextAuth configuration
│   ├── email.ts                # Gmail SMTP OTP delivery
│   ├── notifications.ts        # Security event notifications
│   ├── rate-limit.ts           # Upstash Redis rate limiter
│   ├── redis.ts                # Session management & kill switch
│   ├── collaborationEngine.ts  # Real-time presence engine
│   └── ...                     # Other utilities
├── middleware.ts                # Request-level security middleware
└── prisma/
    └── schema.prisma           # Database models
```

## 🐳 Docker Deployment

```bash
# Build the image
docker build -t data-guardian .

# Run the container
docker run -p 3000:3000 --env-file .env data-guardian
```

The Dockerfile includes an automated `HEALTHCHECK` that monitors container responsiveness.

## 📄 License

Private — All rights reserved.
