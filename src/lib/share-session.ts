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

export function getSessionSecret(): string {
  const secret = process.env.SESSION_HMAC_SECRET?.trim();
  if (!secret) {
    throw new Error(
      'SESSION_HMAC_SECRET is required for share session signing. ' +
      'Set a dedicated >=32-char secret that is NOT shared with ENCRYPTION_KEY or other secrets.'
    );
  }
  if (secret.length < 32) {
    throw new Error('SESSION_HMAC_SECRET must be at least 32 characters');
  }
  // Strict cryptographic separation: never reuse encryption keys
  if (process.env.ENCRYPTION_KEY && secret === process.env.ENCRYPTION_KEY.trim()) {
    throw new Error('SESSION_HMAC_SECRET must not match ENCRYPTION_KEY');
  }
  if (process.env.KEK_KEY && secret === process.env.KEK_KEY.trim()) {
    throw new Error('SESSION_HMAC_SECRET must not match KEK_KEY');
  }
  return secret;
}

/**
 * Returns all secrets that could have signed existing session cookies,
 * ordered primary-first. Used only during verification so cookies signed
 * with a previous session secret (key rotation) or NEXTAUTH_SECRET (migration
 * window before SESSION_HMAC_SECRET was added) remain valid until expiration.
 *
 * NOTE: ENCRYPTION_KEY is NEVER used for HMAC session signing.
 */
function getSessionVerificationSecrets(): string[] {
  const primary = getSessionSecret();
  const secrets = [primary];

  // 1. Safe key rotation support: previous session secret
  const prevSecret = (process.env.SESSION_HMAC_SECRET_PREVIOUS || process.env.SESSION_HMAC_SECRET_OLD)?.trim();
  if (prevSecret && prevSecret !== primary && prevSecret.length >= 32) {
    secrets.push(prevSecret);
  }

  // 2. Migration compatibility: accept cookies signed with NEXTAUTH_SECRET
  // prior to SESSION_HMAC_SECRET separation.
  const nextauth = process.env.NEXTAUTH_SECRET?.trim();
  if (nextauth && nextauth !== primary && !secrets.includes(nextauth) && nextauth.length >= 32) {
    secrets.push(nextauth);
  }

  return secrets;
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', getSessionSecret()).update(payload).digest('hex');
}

function verifySignature(payload: string, mac: string): boolean {
  for (const secret of getSessionVerificationSecrets()) {
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    if (timingSafeEqualHex(mac, expected)) {
      return true;
    }
  }
  return false;
}

function timingSafeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');
    if (ba.length !== bb.length || ba.length === 0) return false;
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
    if (!verifySignature(`${shareToken}:${sessionId}:${expiresAt}:${emailNorm}`, mac)) {
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

    // Accept MAC signed with or without trailing empty email (legacy vs new signer)
    if (
      !verifySignature(`${shareToken}:${sessionId}:${expiresAt}`, mac) &&
      !verifySignature(`${shareToken}:${sessionId}:${expiresAt}:`, mac)
    ) {
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
