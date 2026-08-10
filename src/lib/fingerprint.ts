import { createHash } from 'crypto';
import { ReadonlyHeaders } from 'next/dist/server/web/spec-extension/adapters/headers';

/**
 * Privacy-safe device hash for ACTIVE ACCESS SESSION binding.
 *
 * Uses stable browser signals only. Volatile headers (e.g. Accept-Encoding)
 * are excluded so Server Actions and fetch() from the same browser match.
 *
 * IP is excluded so Wi‑Fi ↔ cellular roaming does not break a valid session.
 */
export function generateDeviceHash(headers: ReadonlyHeaders | Headers): string {
    const userAgent = headers.get('user-agent') || 'unknown-ua';
    const acceptLanguage = headers.get('accept-language') || 'unknown-lang';
    const secChUa = headers.get('sec-ch-ua') || '';
    const secChUaPlatform = headers.get('sec-ch-ua-platform') || '';

    const fingerprintString = `${userAgent}|${acceptLanguage}|${secChUa}|${secChUaPlatform}`;

    return createHash('sha256').update(fingerprintString).digest('hex');
}

/** True when an active session still counts as live for device-binding checks. */
export const ACTIVE_SESSION_DEVICE_WINDOW_MS = 5 * 60 * 1000;

export function isActiveSessionFresh(lastSeenAt: Date | null | undefined, now = Date.now()): boolean {
    if (!lastSeenAt) return false;
    return lastSeenAt.getTime() > now - ACTIVE_SESSION_DEVICE_WINDOW_MS;
}
