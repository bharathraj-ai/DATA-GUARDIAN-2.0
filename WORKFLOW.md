# 🔐 Data Guardian 2.0 - Complete Workflow & Technical Documentation

## 📋 Table of Contents
1. [Project Overview](#project-overview)
2. [How It Works](#how-it-works)
3. [Control Systems](#control-systems)
4. [Technology Stack](#technology-stack)
5. [Architecture](#architecture)
6. [Security Features](#security-features)
7. [User Flow](#user-flow)
8. [API Endpoints](#api-endpoints)
9. [Database Schema](#database-schema)
10. [Deployment](#deployment)

---

## 🎯 Project Overview

**Data Guardian 2.0** is a secure, time-limited data sharing platform that allows users to share sensitive information with complete control and privacy.

### Key Features
- **Time-Limited Access** - Links expire after specified duration
- **OTP Authentication** - Two-factor authentication for access
- **Single-Use Links** - Links can only be used once
- **Kill Switch** - Instant revocation of access anytime
- **End-to-End Encryption** - AES-256 encryption for all data
- **File Sharing** - Secure file attachments up to 15MB
- **Real-Time Monitoring** - Live status updates via Server-Sent Events
- **Zero Knowledge** - Server never stores unencrypted data

### Use Cases
- Sharing confidential business documents
- Transmitting medical records (HIPAA compliant)
- Sending legal documents securely
- Sharing personal identification documents
- Temporary access to sensitive information
- Secure password sharing

---

## 🔄 How It Works

### Step-by-Step Process

#### 1. Link Creation (Sender Side)
```
User fills form → Data encrypted → Link generated → OTP created
```


**Detailed Flow:**
1. User enters recipient information (name, email, phone, age, gender)
2. User optionally uploads files (images, PDFs, Excel, etc.)
3. User sets expiration time (in minutes)
4. System encrypts all data using AES-256
5. System generates unique tokens:
   - **Share Token** - For recipient access
   - **Owner Token** - For sender control (kill switch)
6. System generates 6-digit OTP
7. System creates QR code for mobile sharing
8. User receives:
   - Share link (to send to recipient)
   - OTP (to send separately)
   - Owner dashboard link (for revocation)

#### 2. Link Sharing (Distribution)
```
Sender → Share Link (via email/chat) → Recipient
Sender → OTP (via separate channel) → Recipient
```

**Security Best Practice:**
- Share link and OTP through **different channels**
- Example: Link via email, OTP via SMS
- This prevents unauthorized access if one channel is compromised

#### 3. OTP Verification (Recipient Side)
```
Recipient opens link → Enters OTP → Verified → Access granted
```

**Detailed Flow:**
1. Recipient clicks share link
2. OTP verification page loads
3. Recipient enters 6-digit OTP
4. System validates:
   - OTP correctness
   - Link not expired
   - Link not already used
   - Link not revoked
5. If valid: Create session and redirect to data view
6. If invalid: Show error and remaining attempts (3 max)

#### 4. Data Viewing (Recipient Side)
```
View page loads → Data displayed (masked) → Real-time countdown
```

**Detailed Flow:**
1. Encrypted data retrieved from database
2. Data decrypted server-side
3. Sensitive fields masked (email, phone)
4. Real-time countdown via Server-Sent Events (SSE)
5. Recipient can:
   - View masked data
   - Temporarily reveal full data (10 seconds)
   - Preview/download attached files
6. Session monitored continuously
7. Auto-expires when time runs out

#### 5. Kill Switch (Sender Control)
```
Sender opens owner link → Clicks revoke → Access terminated instantly
```

**Detailed Flow:**
1. Sender opens owner dashboard link
2. Dashboard shows:
   - Link status (Active/Used/Expired/Revoked)
   - Time remaining
   - Creation time
   - Whether OTP was verified
3. Sender clicks "Revoke Access Now"
4. System immediately:
   - Marks link as revoked in database
   - Terminates active SSE connections
   - Recipient sees "Access Revoked" error
5. Response time: < 3 seconds (SSE heartbeat interval)

---

## 🎛️ Control Systems

### 1. Access Control System

**Multi-Layer Authentication:**
```
Layer 1: Unique Token (URL-based)
Layer 2: OTP Verification (6-digit code)
Layer 3: Session Validation (Cookie-based)
Layer 4: Time-Based Expiration (Automatic)
```

**Access States:**
- **Not Verified** - Link created but OTP not entered
- **Active** - OTP verified, data accessible
- **Expired** - Time limit reached
- **Revoked** - Owner terminated access
- **Used** - Single-use link already accessed

### 2. Time Control System

**Expiration Management:**
```
Creation Time + Validity Duration = Expiration Time
```

**Implementation:**
- Server-side countdown (authoritative)
- Client-side countdown (display only)
- SSE heartbeat every 3 seconds
- Automatic cleanup of expired data

**Time Zones:**
- All times stored in UTC
- Converted to local time for display
- Consistent across all users

### 3. Revocation Control System (Kill Switch)

**Instant Revocation:**
```
Owner Action → Database Update → SSE Notification → Access Terminated
```

**Implementation:**
- Owner dashboard with real-time status
- One-click revocation
- Optional data deletion
- Cross-tab synchronization
- Audit trail logging

**Response Time:**
- Database update: < 100ms
- SSE detection: < 3 seconds
- Total revocation time: < 3 seconds

### 4. Rate Limiting System

**OTP Attempt Limiting:**
```
Max 3 attempts per link
Failed attempts tracked
Automatic lockout after 3 failures
```

**Implementation:**
- Counter stored in database
- Decremented on each failed attempt
- Link becomes unusable after 3 failures
- Prevents brute-force attacks

### 5. Session Management System

**Session Lifecycle:**
```
OTP Verified → Session Created → Cookie Set → SSE Connected → Monitored
```

**Implementation:**
- Secure HTTP-only cookies
- Session ID validation on every request
- SSE connection for real-time updates
- Automatic session termination on expiry

### 6. Data Masking System

**Privacy Protection:**
```
Full Data → Masked Display → Temporary Reveal → Auto-Hide
```

**Masking Rules:**
- Email: `t***@example.com`
- Phone: `***-***-7890`
- Reveal duration: 10 seconds
- Auto-hide after timeout

---

## 💻 Technology Stack

### Frontend Technologies

**Framework & Libraries:**
- **Next.js 16.1.6** - React framework with App Router
- **React 19.2.3** - UI library
- **TypeScript 5** - Type-safe JavaScript
- **Turbopack** - Fast bundler (Next.js 16 default)

**Styling:**
- **Custom CSS** - Professional design system
- **CSS Variables** - Consistent theming
- **Glassmorphism** - Modern UI effects
- **Responsive Design** - Mobile-first approach

**State Management:**
- **React Hooks** - useState, useEffect, useRef
- **Client Components** - Interactive UI
- **Server Components** - Static content

**Real-Time Communication:**
- **Server-Sent Events (SSE)** - Live updates
- **EventSource API** - Browser-native SSE client

### Backend Technologies

**Runtime & Framework:**
- **Node.js** - JavaScript runtime
- **Next.js API Routes** - Serverless functions
- **Server Actions** - Form handling

**Database:**
- **SQLite** - Local development database
- **Prisma 5.22.0** - ORM and query builder
- **PostgreSQL** - Production database (optional)

**Security:**
- **Crypto (Node.js)** - AES-256 encryption
- **bcryptjs 3.0.3** - Password hashing (if needed)
- **UUID 13.0.0** - Unique identifier generation

**File Processing:**
- **XLSX 0.18.5** - Excel file parsing
- **QRCode 1.5.4** - QR code generation
- **File System API** - File upload handling

**Validation:**
- **Zod 4.3.6** - Schema validation
- **TypeScript** - Compile-time type checking

### Infrastructure

**Caching & Performance:**
- **Upstash Redis** (optional) - Rate limiting
- **Next.js Cache** - Disabled for dynamic pages
- **Browser Cache** - Controlled via headers

**Development Tools:**
- **ESLint 9** - Code linting
- **TypeScript Compiler** - Type checking
- **Turbopack** - Fast refresh

**Deployment:**
- **Docker** - Containerization
- **Vercel** - Recommended hosting
- **Standalone Output** - Self-hosted option

---

## 🏗️ Architecture

### System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         CLIENT SIDE                          │
├─────────────────────────────────────────────────────────────┤
│  Browser → Next.js Pages → React Components → CSS Styles    │
│     ↓           ↓              ↓                 ↓           │
│  Router    Server Actions   State Mgmt      Animations      │
└─────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────┐
│                        SERVER SIDE                           │
├─────────────────────────────────────────────────────────────┤
│  Next.js Server → API Routes → Server Actions → Middleware  │
│       ↓              ↓             ↓              ↓          │
│  SSE Stream    Validation    Encryption    Cache Control    │
└─────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────┐
│                      DATA LAYER                              │
├─────────────────────────────────────────────────────────────┤
│  Prisma ORM → SQLite/PostgreSQL → File System → Redis       │
│      ↓            ↓                    ↓            ↓        │
│  Queries    Encrypted Data         Files      Rate Limits   │
└─────────────────────────────────────────────────────────────┘
```

### Application Structure

```
DATA-GUARDIAN-2.0/
├── src/
│   ├── app/                          # Next.js App Router
│   │   ├── page.tsx                  # Home page
│   │   ├── layout.tsx                # Root layout
│   │   ├── globals.css               # Global styles
│   │   ├── signup/                   # Link creation
│   │   │   ├── page.tsx
│   │   │   └── layout.tsx
│   │   ├── share/[token]/            # OTP verification
│   │   │   ├── page.tsx
│   │   │   └── layout.tsx
│   │   ├── view/[token]/             # Data viewing
│   │   │   ├── page.tsx
│   │   │   └── layout.tsx
│   │   ├── revoke/[ownerToken]/      # Kill switch
│   │   │   ├── page.tsx
│   │   │   └── layout.tsx
│   │   ├── services/                 # Features page
│   │   ├── how-it-works/             # Documentation
│   │   └── api/                      # API routes
│   │       ├── stream/[token]/       # SSE endpoint
│   │       └── cleanup/              # Cron job
│   ├── actions/                      # Server actions
│   │   ├── create-link-with-files.ts
│   │   ├── verify-otp.ts
│   │   ├── get-user.ts
│   │   ├── revoke-access.ts
│   │   └── cleanup.ts
│   ├── lib/                          # Utilities
│   │   ├── prisma.ts                 # Database client
│   │   ├── crypto.ts                 # Encryption
│   │   ├── redis.ts                  # Cache (optional)
│   │   └── getBaseUrl.js             # URL helper
│   └── middleware.ts                 # Cache control
├── prisma/
│   ├── schema.prisma                 # Database schema
│   ├── dev.db                        # SQLite database
│   └── migrations/                   # DB migrations
├── public/                           # Static assets
├── next.config.ts                    # Next.js config
├── tsconfig.json                     # TypeScript config
├── package.json                      # Dependencies
└── .env                              # Environment variables
```

### Data Flow

**Link Creation Flow:**
```
User Input → Validation → Encryption → Database → Token Generation → Response
```

**OTP Verification Flow:**
```
Token + OTP → Validation → Session Creation → Cookie Set → Redirect
```

**Data Viewing Flow:**
```
Token → Session Check → Decryption → Masking → SSE Connection → Display
```

**Revocation Flow:**
```
Owner Token → Validation → Database Update → SSE Broadcast → Access Denied
```

---
