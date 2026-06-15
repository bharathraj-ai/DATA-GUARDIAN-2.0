import crypto from 'crypto';

/**
 * Production fail-closed cron authorization.
 * - In production: CRON_SECRET must be set and Authorization: Bearer <secret> must match (timing-safe).
 * - In development: if CRON_SECRET is unset, allow local cron (optional); if set, require it.
 */
export function isCronSecretConfigured(): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  return Boolean(secret && secret.length >= 32);
}

export function timingSafeBearerMatch(authHeader: string | null, secret: string): boolean {
  if (!authHeader || !secret) return false;
  const prefix = 'Bearer ';
  if (!authHeader.startsWith(prefix)) return false;
  const token = authHeader.slice(prefix.length);
  // Fixed-length digest compare — avoids length-based timing leaks
  const ha = crypto.createHash('sha256').update(token, 'utf8').digest();
  const hb = crypto.createHash('sha256').update(secret, 'utf8').digest();
  return crypto.timingSafeEqual(ha, hb);
}

export type CronAuthFailure = { ok: false; status: 401 | 503; message: string };
export type CronAuthSuccess = { ok: true };

export function authorizeCronRequest(request: Request): CronAuthSuccess | CronAuthFailure {
  const secret = process.env.CRON_SECRET?.trim();

  if (!secret) {
    throw new Error('Missing CRON_SECRET');
  }

  if (secret.length < 32) {
    throw new Error('Weak CRON_SECRET');
  }

  const authHeader = request.headers.get('authorization');
  let ok = timingSafeBearerMatch(authHeader, secret);

  if (!ok) {
    return { ok: false, status: 401, message: 'Unauthorized' };
  }
  return { ok: true };
}
