'use client';

import { useCallback, useEffect, useId, useState, type MouseEvent } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { X } from 'lucide-react';
import styles from './SiteFooter.module.css';

type FooterTopicId =
  | 'secure-sharing'
  | 'dashboard'
  | 'enterprise'
  | 'kill-switch'
  | 'documentation'
  | 'developer-api'
  | 'help-center'
  | 'system-status'
  | 'privacy'
  | 'terms'
  | 'security-audits'
  | 'cookies';

type FooterTopic = {
  id: FooterTopicId;
  label: string;
  eyebrow: string;
  title: string;
  lead: string;
  points: string[];
  note?: string;
  cta?: { href: string; label: string };
};

const TOPICS: Record<FooterTopicId, FooterTopic> = {
  'secure-sharing': {
    id: 'secure-sharing',
    label: 'Secure Sharing',
    eyebrow: 'Product',
    title: 'Share files without losing control',
    lead: 'Owners create a time-limited encrypted link. Vendors unlock it with a separate OTP — not with the link alone.',
    points: [
      'Upload files (multi-format, size-capped) and generate a Secure Protocol link.',
      'Send the link on one channel and the 6-digit OTP on another.',
      'Optional email binding so only the invited Google account can open it.',
      'Revoke anytime — access stops and shared data is cleaned up.',
    ],
    cta: { href: '/create-link', label: 'Create a secure link' },
  },
  dashboard: {
    id: 'dashboard',
    label: 'Dashboard',
    eyebrow: 'Product',
    title: 'One desk for owners and vendors',
    lead: 'After Google sign-in you choose Owner or Vendor. Each role gets a dashboard built for that job.',
    points: [
      'Owners see link status, activity, and a kill-switch to revoke access.',
      'Vendors see received links — active, used, expired, revoked, or on break.',
      'Audit-friendly history stays available even after a link is cleaned up.',
      'Role selection happens once during onboarding, then routes you correctly.',
    ],
    cta: { href: '/dashboard', label: 'Open dashboard' },
  },
  enterprise: {
    id: 'enterprise',
    label: 'Enterprise Services',
    eyebrow: 'Product',
    title: 'Built for controlled business handoffs',
    lead: 'Secure Protocol is designed for teams that must share sensitive files with outside vendors without email attachments.',
    points: [
      'Zero-trust access: prove identity, then unlock a short-lived session.',
      'Device binding on active vendor sessions reduces link forwarding risk.',
      'Break sessions let vendors pause work and re-authenticate to resume.',
      'Enterprise-oriented services page covers how teams adopt the protocol.',
    ],
    cta: { href: '/services', label: 'View services' },
  },
  'kill-switch': {
    id: 'kill-switch',
    label: 'Kill Switch',
    eyebrow: 'Product',
    title: 'Revoke access in one move',
    lead: 'Owners keep a separate control path. If a share must stop, the kill switch cuts the session and cleans up shared data.',
    points: [
      'Revoke from the owner dashboard or the dedicated owner-token page.',
      'Active vendor sessions are blocked quickly via revoke checks.',
      'Shared files and access records are cleaned up after revoke.',
      'Audit logs keep a record of revoke events for later review.',
    ],
    cta: { href: '/dashboard', label: 'Open owner controls' },
  },
  documentation: {
    id: 'documentation',
    label: 'Documentation',
    eyebrow: 'Resources',
    title: 'Quick protocol guide',
    lead: 'A short field guide to the pieces you will use day to day in Secure Protocol.',
    points: [
      'SecureLink — encrypted package with token, expiry, and access rules.',
      'OTP — hashed one-time code; wrong attempts can lock or revoke the link.',
      'Session — short-lived vendor access with device binding after unlock.',
      'Owner token — separate control path for revoke without using the share URL.',
    ],
    note: 'Full published docs are expanding; this summary matches the live product behavior.',
  },
  'developer-api': {
    id: 'developer-api',
    label: 'Developer API',
    eyebrow: 'Resources',
    title: 'How the app is wired today',
    lead: 'Secure Protocol runs on Next.js with server actions, Prisma, and Redis-backed session controls.',
    points: [
      'Auth: NextAuth + Google OAuth, then Owner/Vendor role selection.',
      'Data: Prisma models for links, vendor access, files, and audit logs.',
      'Realtime controls: Redis for sessions, revoke cache, and rate limits.',
      'Streams & editors: protected view/edit routes for in-browser work.',
    ],
    note: 'Public API keys are not exposed in the marketing footer yet — this describes the current architecture.',
  },
  'help-center': {
    id: 'help-center',
    label: 'Help Center',
    eyebrow: 'Resources',
    title: 'Common questions',
    lead: 'Fast answers for the issues owners and vendors hit most often.',
    points: [
      'Invalid OTP? Check the latest email code; after repeated fails the link may lock.',
      'Wrong Google account? Sign out and use the email bound to the share.',
      'Need to stop access now? Owners can revoke from the dashboard or owner token page.',
      'Vendor paused mid-work? Use Break session, then re-enter OTP to resume.',
    ],
    cta: { href: '/auth/signin', label: 'Sign in for support tools' },
  },
  'system-status': {
    id: 'system-status',
    label: 'System Status',
    eyebrow: 'Resources',
    title: 'What “healthy” looks like',
    lead: 'Secure Protocol depends on a few core services. If sharing feels slow, these are the first places to check.',
    points: [
      'App server (Next.js) — pages, sign-in, and server actions.',
      'PostgreSQL via Prisma — links, users, audit records.',
      'Redis — OTP rate limits, sessions, and fast revoke checks.',
      'Google OAuth — account sign-in for owners and vendors.',
    ],
    note: 'There is no public status page yet. If create-link or OTP verify stalls, confirm database and Redis connectivity in your environment.',
  },
  privacy: {
    id: 'privacy',
    label: 'Privacy Policy',
    eyebrow: 'Legal',
    title: 'Privacy in plain terms',
    lead: 'We collect what the product needs to authenticate you and run secure shares — not to read your file contents as a business model.',
    points: [
      'Account data comes from Google sign-in (name, email, profile basics).',
      'Share metadata (expiry, attempts, device binding, audit events) is stored to enforce policy.',
      'File payloads are handled as encrypted share material inside the protocol flow.',
      'You can review the full policy for retention and contact details.',
    ],
    cta: { href: '/legal/privacy', label: 'Read Privacy Policy' },
  },
  terms: {
    id: 'terms',
    label: 'Terms of Service',
    eyebrow: 'Legal',
    title: 'Using Secure Protocol responsibly',
    lead: 'By signing in and creating or opening shares, you agree to use the service for lawful, authorized handoffs only.',
    points: [
      'Owners are responsible for who they invite and what they upload.',
      'Vendors must not bypass OTP, device, or session controls.',
      'Revocation, expiry, and cleanup are part of the product — expect data to disappear when access ends.',
      'Misuse (phishing, unauthorized redistribution) is not allowed.',
    ],
    cta: { href: '/legal/terms', label: 'Read Terms of Service' },
  },
  'security-audits': {
    id: 'security-audits',
    label: 'Security Audits',
    eyebrow: 'Legal',
    title: 'Controls you can inspect in-product',
    lead: 'Security is enforced in the protocol itself: encryption, OTP, binding, revoke, and audit trails.',
    points: [
      'AES-256-GCM style encryption for protected file material at rest in the share flow.',
      'OTP hashing and attempt limits to stop brute-force unlocks.',
      'Device-bound vendor sessions after successful OTP.',
      'Owner-visible audit logs for access, deny, revoke, and session events.',
    ],
    note: 'Formal third-party audit reports are not published in this footer yet; the live controls above are what the app implements today.',
  },
  cookies: {
    id: 'cookies',
    label: 'Cookie Policy',
    eyebrow: 'Legal',
    title: 'Cookies we actually use',
    lead: 'Secure Protocol uses essential cookies and session storage to keep you signed in and to protect share sessions.',
    points: [
      'Auth session cookies from NextAuth / Google sign-in.',
      'Share-session cookies after OTP so vendors can work without re-entering codes every click.',
      'No marketing pixel wall in the core product flow.',
      'Clearing site data signs you out and ends local session continuity.',
    ],
    cta: { href: '/legal/cookies', label: 'Read Cookie Policy' },
  },
};

const PRODUCT_LINKS: FooterTopicId[] = ['secure-sharing', 'dashboard', 'enterprise', 'kill-switch'];
const RESOURCE_LINKS: FooterTopicId[] = ['documentation', 'developer-api', 'help-center', 'system-status'];
const LEGAL_LINKS: FooterTopicId[] = ['privacy', 'terms', 'security-audits', 'cookies'];

export default function SiteFooter() {
  const titleId = useId();
  const [openId, setOpenId] = useState<FooterTopicId | null>(null);
  const topic = openId ? TOPICS[openId] : null;

  const close = useCallback(() => setOpenId(null), []);

  useEffect(() => {
    if (!openId) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [openId, close]);

  const openTopic = (id: FooterTopicId) => (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setOpenId(id);
  };

  const renderCol = (title: string, ids: FooterTopicId[]) => (
    <div>
      <h4 className="footer-col-title">{title}</h4>
      <div className="footer-links">
        {ids.map((id) => (
          <button
            key={id}
            type="button"
            className={`footer-link ${styles.footerBtn}`}
            onClick={openTopic(id)}
          >
            {TOPICS[id].label}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <>
      <footer className="footer">
        <div className="container">
          <div className="footer-grid">
            <div className="footer-brand">
              <Link href="/" className="footer-logo">
                <Image
                  src="/logo.jpg"
                  alt="Secure Protocol"
                  width={28}
                  height={28}
                  style={{ opacity: 0.9, borderRadius: '4px' }}
                />
                <span className="footer-logo-text">Secure Protocol</span>
              </Link>
              <p className="footer-motto">
                Enterprise-grade data security. Protect, share, and control your sensitive information with zero-knowledge architecture.
              </p>
              <div className="footer-socials">
                <a href="#" aria-label="Twitter">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z" /></svg>
                </a>
                <a href="#" aria-label="GitHub">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" /></svg>
                </a>
                <a href="#" aria-label="LinkedIn">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" /><rect x="2" y="9" width="4" height="12" /><circle cx="4" cy="4" r="2" /></svg>
                </a>
              </div>
            </div>

            {renderCol('Product', PRODUCT_LINKS)}
            {renderCol('Resources', RESOURCE_LINKS)}
            {renderCol('Legal', LEGAL_LINKS)}
          </div>

          <div className="footer-bottom">
            <p>&copy; {new Date().getFullYear()} Secure Protocol. All rights reserved.</p>
            <div className="footer-bottom-links">
              <span>English (US)</span>
              <span>ISO 27001 Certified</span>
            </div>
          </div>
        </div>
      </footer>

      {topic ? (
        <div className={styles.overlay} role="presentation" onClick={close}>
          <div
            className={styles.dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.dialogTop}>
              <p className={styles.eyebrow}>{topic.eyebrow}</p>
              <button type="button" className={styles.close} onClick={close} aria-label="Close">
                <X size={18} strokeWidth={2.25} />
              </button>
            </div>

            <h2 id={titleId} className={styles.title}>
              {topic.title}
            </h2>
            <p className={styles.lead}>{topic.lead}</p>

            <ul className={styles.points}>
              {topic.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>

            {topic.note ? <p className={styles.note}>{topic.note}</p> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
