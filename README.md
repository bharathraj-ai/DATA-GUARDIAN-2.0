# 🛡️ Data Guardian 2.0

**Enterprise-grade secure data sharing platform** with military-grade encryption, real-time collaboration, priority-based editing, and a strict Zero Trust security architecture.

## ✨ Key Features

- **🔐 AES-256-GCM Encryption** — Military-grade encrypted file storage with per-file Data Encryption Keys (DEK). All data is encrypted at rest and in transit.
- **🔑 Zero Trust OTP Protection** — 6-digit one-time passwords with per-vendor isolation. Features a secure 3-attempt policy—entering the wrong OTP 3 times results in permanent link revocation.
- **👥 Dynamic Group Sharing** — Share secure links with multiple vendors simultaneously, each receiving their own unique OTP and assigned a hierarchical access level.
- **🥇 Hierarchical Vendor Priority & Preemption** — Explicit level-based control (Level 1 Team Leader, Level 2+ Members). If a lower-level member is editing a file and a higher-level member joins the session, the lower-level user receives a **30-second priority countdown** to wrap up. At the end of the countdown, the file is forcefully auto-saved and locked.
- **🔄 Instant Auto-Reloading** — Through sophisticated Server-Sent Events (SSE) polling the database Audit Logs, when a lower-priority user's file is auto-saved, the Team Leader's browser detects the exact millisecond of the update and **instantly auto-reloads the newly edited file** directly into their viewer without requiring a page refresh.
- **⚡ Real-Time Collaboration & Chat** — Live document presence tracking and built-in encrypted chat (Group and Private-to-Leader) powered via Server-Sent Events (SSE).
- **🟢 Live Activity Monitor** — Owners can track real-time connection status, active participants, and chat feeds directly from their unified dashboard.
- **📜 Enterprise Audit Trails** — Immutable, server-side logging of all security events (OTP failures, access revocations) and document manipulations, filterable via a comprehensive UI with CSV export capabilities.
- **🚫 Context-Aware Auto-Revocation** — Links can be explicitly revoked by the owner or auto-expire based on time. All data is permanently purged upon expiry.
- **🚷 Strict No-Export Policy** — All download, export, and print functionalities are entirely disabled for vendors so that the encrypted data NEVER leaves the browser sandbox. Vendors can only edit and securely save back to the server.
- **📸 Advanced Anti-Screenshot & Screen-Recording Protection** — Uses a combination of `visibilitychange`, `blur`, and specific keyboard capture (`PrintScreen`, `Win+Shift`) to immediately revoke access if a user attempts to screenshot, screen-record, or switch tabs away from the secure viewer.
- **🔒 Device & Email Binding** — Sessions are fingerprinted to the original device. OTPs can only be verified if the authenticated user's email perfectly matches the intended recipient.

## 🔒 Security Architecture

### Comprehensive Interaction Blocking (Secure Viewer)

| Threat Vector | Protection Mechanism |
|---|---|
| **Tab Switch / Alt+Tab** | `visibilitychange` + `blur` event listeners trigger instant access revocation |
| **PrintScreen Key** | Strict `keyup` capture triggers instant access revocation |
| **Win+Shift (Snipping Tool)** | `keydown` capture combinations trigger instant access revocation |
| **Ctrl+P (Print)**| Key combination blocked + instant access revocation |
| **Ctrl+S, Ctrl+C, Ctrl+U** | Save, Copy, and View Source key combinations blocked + instant access revocation |
| **F12 / Ctrl+Shift+I**| DevTools shortcuts blocked + instant access revocation |
| **Right-Click** | Context menu (`contextmenu`) entirely disabled |
| **Text Selection** | Global CSS `user-select: none` applied to the viewer |
| **Drag & Drop** | `dragstart` events blocked to prevent dragging text/images out of the browser |

### Zero Trust Principles

- **3-Attempt OTP Limit** — Entering a wrong OTP 3 times instantly and permanently revokes the link to prevent brute-force attacks.
- **Device & Email Binding** — Sessions are locked to the browser fingerprint and the specific authenticated OAuth email address.
- **Aggressive Kill Switch** — Fast Redis session invalidation combined with DB revocation triggers an immediate UI lock-out on any security violation.
- **Hermetic Viewing Environment** — Data is decrypted directly in the browser's memory using `pdf-lib` and `pdfjs-dist` without leaving traces in local storage.
- **Unmodifiable Audit Logging** — Every critical interaction, from successful views to security violations, is permanently logged in an append-only database to guarantee compliance tracing.

## 🚀 Tech Stack

| Technology | Purpose |
|---|---|
| **Next.js (App Router)** | Full-stack React framework optimized for Server Actions |
| **TypeScript** | End-to-end type-safe development |
| **Prisma (PostgreSQL)** | Type-safe database ORM managing relational links |
| **NextAuth.js** | Google OAuth Authentication for strict identity verification |
| **Upstash Redis** | Rate limiting, Session Management, and high-speed Kill Switches |
| **Nodemailer** | Secure OTP and notification email delivery via SMTP |
| **Server-Sent Events (SSE)** | Low-latency real-time heartbeat, chat, and auto-reload signaling |
| **PDF-Lib / PDF.js** | In-browser hermetic parsing and editing of PDF documents |

## 📦 Getting Started

### Prerequisites

- **Node.js** ≥ 18.17.0
- **PostgreSQL** database (e.g., [Neon](https://neon.tech))
- **Google OAuth** credentials
- **Upstash Redis** instance (optional — the app gracefully falls back to DB-only polling if not provided)

### Installation & Setup

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

# Push database schema to PostgreSQL
npx prisma db push

# Start the development server
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
| `UPSTASH_REDIS_REST_URL` | ⬜ | Redis REST API URL (optional, highly recommended) |
| `UPSTASH_REDIS_REST_TOKEN` | ⬜ | Redis REST API token (optional) |

## 🏗️ Project Structure

```
src/
├── app/                        # Next.js App Router
│   ├── api/                    # API routes
│   │   ├── stream/             # SSE real-time data streaming & auto-reload signaling
│   │   ├── chat/               # Real-time chat API
│   │   ├── session-monitor/    # Live session monitoring
│   │   └── cleanup/            # Auto-expiry cleanup webhooks
│   ├── auth/                   # OAuth sign-in/sign-out boundaries
│   ├── dashboard/              # Owner & Vendor dashboards
│   ├── create-link/            # Secure link creation with AES-256 chunked encryption
│   ├── view/[token]/           # Secure Zero-Trust data viewer
│   ├── share/[token]/          # Initial OTP entry point
│   └── revoke/[ownerToken]/    # Owner forced revocation
├── actions/                    # Next.js Server Actions (Backend Logic)
│   ├── verify-otp.ts           # Per-vendor OTP validation logic
│   ├── create-link-with-files.ts # Encrypted link + file upload processing
│   ├── update-file.ts          # Saves edited files back to the DB securely
│   └── revoke-on-screenshot.ts # Security violation handler
├── components/                 # React UI Components
│   ├── editors/                # In-Browser Universal Editor (PDF, DOCX, TXT)
│   └── ...                     
├── lib/                        # Core utilities & engines
│   ├── crypto.ts               # AES-256-GCM, HMAC, DEK/KEK encryption routines
│   ├── auth.ts                 # NextAuth security configurations
│   ├── email.ts                # SMTP delivery service
│   └── rate-limit.ts           # Redis-backed rate limiters
└── prisma/
    └── schema.prisma           # Database relational models
```

## 🐳 Docker Deployment

```bash
# Build the Docker image
docker build -t data-guardian .

# Run the container (Requires an active .env file)
docker run -p 3000:3000 --env-file .env data-guardian
```

The `Dockerfile` includes an automated `HEALTHCHECK` that strictly monitors container responsiveness and dependencies.

## 📄 License

Private — All rights reserved.
