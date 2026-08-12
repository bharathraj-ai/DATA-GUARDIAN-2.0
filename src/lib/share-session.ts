/**
 * Share-link session tokens — authoritative without Redis.
 *
 * Cookie format: `{sessionId}.{expiresUnix}.{emailB64url|_}.{hmac}`
 * HMAC = HMAC-SHA256(SESSION_HMAC_SECRET, `${shareToken}:${sessionId}:${expiresUnix}:${emailNorm}`)
 *
 * emailNorm is bound into the MAC so clients cannot swap vendor identity.
 * Redis may cache the same session for fast kill-switch / TTL lookups,
 * but create-link, OTP, and auth must work when Redis is absent.
 */

import crypto from 'crypto';
import { generateSessionId } from '@/lib/crypto';

function getSessionSecret(): string {
  // Prefer dedicated secret; fall back for migration (never use ENCRYPTION_KEY alone long-term)
  const secret =
    process.env.SESSION_HMAC_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.ENCRYPTION_KEY;
  if (!secret) {
    throw new Error('SESSION_HMAC_SECRET, NEXTAUTH_SECRET, or ENCRYPTION_KEY is required for share sessions');
  }
  return secret;
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', getSessionSecret()).update(payload).digest('hex');
}

function timingSafeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

function normalizeEmail(email: string | null | undefined): string {
  return (email || '').trim().toLowerCase();
}

function encodeEmailPart(email: string): string {
  if (!email) return '_';
  return Buffer.from(email, 'utf8').toString('base64url');
}

function decodeEmailPart(part: string): string {
  if (!part || part === '_') return '';
  try {
    return Buffer.from(part, 'base64url').toString('utf8').trim().toLowerCase();
  } catch {
    return '';
  }
}

export type MintedShareSession = {
  sessionId: string;
  cookieValue: string;
  maxAge: number;
  expiresAt: number;
  vendorEmail: string | null;
};

/** Create a signed share session (DB/cookie authoritative; Redis optional cache). */
export function mintShareSession(
  shareToken: string,
  ttlSeconds: number,
  vendorEmail?: string | null,
): MintedShareSession {
  const sessionId = generateSessionId();
  const maxAge = Math.max(1, Math.floor(ttlSeconds));
  const expiresAt = Math.floor(Date.now() / 1000) + maxAge;
  const emailNorm = normalizeEmail(vendorEmail);
  const payload = `${shareToken}:${sessionId}:${expiresAt}:${emailNorm}`;
  const cookieValue = `${sessionId}.${expiresAt}.${encodeEmailPart(emailNorm)}.${sign(payload)}`;
  return { sessionId, cookieValue, maxAge, expiresAt, vendorEmail: emailNorm || null };
}

export type VerifiedShareSession =
  | { valid: true; sessionId: string; expiresAt: number; vendorEmail: string | null }
  | { valid: false };

/**
 * Verify signed session cookie for a share token.
 * Rejects forged, expired, or malformed cookies (including legacy unsigned values).
 */
export function verifyShareSession(
  cookieValue: string | undefined | null,
  shareToken: string,
): VerifiedShareSession {
  if (!cookieValue || !shareToken) {
    return { valid: false };
  }

  const parts = cookieValue.split('.');

  // New format: sessionId.expires.emailPart.mac
  if (parts.length === 4) {
    const [sessionId, expiresStr, emailPart, mac] = parts;
    if (!sessionId || !expiresStr || !mac) {
      return { valid: false };
    }

    const expiresAt = parseInt(expiresStr, 10);
    if (!Number.isFinite(expiresAt) || expiresAt * 1000 < Date.now()) {
      return { valid: false };
    }

    const emailNorm = decodeEmailPart(emailPart);
    const expected = sign(`${shareToken}:${sessionId}:${expiresAt}:${emailNorm}`);
    if (!timingSafeEqualHex(mac, expected)) {
      return { valid: false };
    }

    return { valid: true, sessionId, expiresAt, vendorEmail: emailNorm || null };
  }

  // Legacy 3-part format (migration window): sessionId.expires.mac — no bound email
  if (parts.length === 3) {
    const [sessionId, expiresStr, mac] = parts;
    if (!sessionId || !expiresStr || !mac) {
      return { valid: false };
    }

    const expiresAt = parseInt(expiresStr, 10);
    if (!Number.isFinite(expiresAt) || expiresAt * 1000 < Date.now()) {
      return { valid: false };
    }

    const expected = sign(`${shareToken}:${sessionId}:${expiresAt}`);
    // Also accept MAC that includes empty email (new signer with legacy cookie)
    const expectedWithEmptyEmail = sign(`${shareToken}:${sessionId}:${expiresAt}:`);
    if (!timingSafeEqualHex(mac, expected) && !timingSafeEqualHex(mac, expectedWithEmptyEmail)) {
      return { valid: false };
    }

    return { valid: true, sessionId, expiresAt, vendorEmail: null };
  }

  return { valid: false };
}

/** Extract raw sessionId from cookie (signed or legacy) for DB comparisons. */
export function extractSessionId(cookieValue: string | undefined | null): string | null {
  if (!cookieValue) return null;
  const parts = cookieValue.split('.');
  if ((parts.length === 3 || parts.length === 4) && parts[0]) return parts[0];
  if (parts.length === 1 && cookieValue.length >= 16) return cookieValue;
  return null;
}
