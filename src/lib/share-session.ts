/**
 * Share-link session tokens — authoritative without Redis.
 *
 * Cookie format: `{sessionId}.{expiresUnix}.{hmac}`
 * HMAC = HMAC-SHA256(ENCRYPTION_KEY, `${shareToken}:${sessionId}:${expiresUnix}`)
 *
 * Redis may cache the same session for fast kill-switch / TTL lookups,
 * but create-link, OTP, and auth must work when Redis is absent.
 */

import crypto from 'crypto';
import { generateSessionId } from '@/lib/crypto';

function getSessionSecret(): string {
  const secret = process.env.ENCRYPTION_KEY || process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error('ENCRYPTION_KEY or NEXTAUTH_SECRET is required for share sessions');
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

export type MintedShareSession = {
  sessionId: string;
  cookieValue: string;
  maxAge: number;
  expiresAt: number;
};

/** Create a signed share session (DB/cookie authoritative; Redis optional cache). */
export function mintShareSession(shareToken: string, ttlSeconds: number): MintedShareSession {
  const sessionId = generateSessionId();
  const maxAge = Math.max(1, Math.floor(ttlSeconds));
  const expiresAt = Math.floor(Date.now() / 1000) + maxAge;
  const payload = `${shareToken}:${sessionId}:${expiresAt}`;
  const cookieValue = `${sessionId}.${expiresAt}.${sign(payload)}`;
  return { sessionId, cookieValue, maxAge, expiresAt };
}

export type VerifiedShareSession =
  | { valid: true; sessionId: string; expiresAt: number }
  | { valid: false };

/**
 * Verify signed session cookie for a share token.
 * Rejects forged, expired, or malformed cookies (including legacy unsigned values).
 */
export function verifyShareSession(cookieValue: string | undefined | null, shareToken: string): VerifiedShareSession {
  if (!cookieValue || !shareToken) {
    return { valid: false };
  }

  const parts = cookieValue.split('.');
  if (parts.length !== 3) {
    return { valid: false };
  }

  const [sessionId, expiresStr, mac] = parts;
  if (!sessionId || !expiresStr || !mac) {
    return { valid: false };
  }

  const expiresAt = parseInt(expiresStr, 10);
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 < Date.now()) {
    return { valid: false };
  }

  const expected = sign(`${shareToken}:${sessionId}:${expiresAt}`);
  if (!timingSafeEqualHex(mac, expected)) {
    return { valid: false };
  }

  return { valid: true, sessionId, expiresAt };
}

/** Extract raw sessionId from cookie (signed or legacy) for DB comparisons. */
export function extractSessionId(cookieValue: string | undefined | null): string | null {
  if (!cookieValue) return null;
  const parts = cookieValue.split('.');
  if (parts.length === 3 && parts[0]) return parts[0];
  // Legacy unsigned cookie — still return for migration window comparisons
  if (parts.length === 1 && cookieValue.length >= 16) return cookieValue;
  return null;
}
