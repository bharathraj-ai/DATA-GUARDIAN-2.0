import crypto from 'crypto';

/**
 * Production fail-closed cron authorization.
 * - In production: CRON_SECRET must be set and Authorization: Bearer <secret> must match (timing-safe).
 * - In development: if CRON_SECRET is unset, allow local cron (optional); if set, require it.
 */
export function isCronSecretConfigured(): boolean {
  return Boolean(process.env.CRON_SECRET?.trim());
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
  const isProd = process.env.NODE_ENV === 'production';
  const secret = process.env.CRON_SECRET?.trim();

  if (isProd && !secret) {
    return {
      ok: false,
      status: 503,
      message: 'Server misconfiguration: CRON_SECRET is required in production.',
    };
  }

  if (secret) {
    const authHeader = request.headers.get('authorization');
    let ok = timingSafeBearerMatch(authHeader, secret);
    if (!ok) {
      try {
        const url = new URL(request.url);
        const q = url.searchParams.get('secret');
        if (q) {
          const ha = crypto.createHash('sha256').update(q, 'utf8').digest();
          const hb = crypto.createHash('sha256').update(secret, 'utf8').digest();
          ok = crypto.timingSafeEqual(ha, hb);
        }
      } catch {
        /* ignore */
      }
    }
    if (!ok) {
      return { ok: false, status: 401, message: 'Unauthorized' };
    }
    return { ok: true };
  }

  // Non-production without secret: allow (developer convenience) — still log once
  if (isProd === false && !secret) {
    console.warn('[CRON] CRON_SECRET unset — development mode only. Set CRON_SECRET before production.');
  }
  return { ok: true };
}
