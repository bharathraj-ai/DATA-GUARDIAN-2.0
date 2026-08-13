/**
 * Redis helpers — OPTIONAL CACHE only.
 *
 * Postgres + signed share-session cookies are authoritative for:
 *   create-link, OTP, revoke, expiry, session binding.
 *
 * Redis accelerates:
 *   kill-switch (revoked:{token}), ephemeral session TTL, rate limits.
 *
 * Return semantics:
 *   true/false → Redis answered
 *   null       → Redis not configured or unavailable → caller uses DB / signed cookie
 *
 * When Redis IS configured but errors on revoke/session reads → fail closed
 * (true revoked / false invalid) so a killed Redis cannot open access.
 */

import { logger } from '@/lib/logger';

let _redisModule: typeof import('@/lib/redis') | null = null;
async function getRedisModule() {
    if (!_redisModule) {
        _redisModule = await import('@/lib/redis');
    }
    return _redisModule;
}

/** Returns true if Redis env vars are present and look real */
export function isRedisConfigured(): boolean {
    return !!(
        process.env.UPSTASH_REDIS_REST_URL &&
        process.env.UPSTASH_REDIS_REST_TOKEN &&
        !process.env.UPSTASH_REDIS_REST_URL.includes('your-redis')
    );
}

/**
 * Fast revoke cache lookup.
 * null = no Redis → check SecureLink.isRevoked in DB
 * true  = revoked (or Redis configured but errored — fail closed)
 * false = Redis says not revoked (still verify DB)
 */
export async function tryCheckRevoked(token: string): Promise<boolean | null> {
    if (!isRedisConfigured()) {
        return null;
    }

    try {
        const { isTokenRevoked } = await getRedisModule();
        return (await isTokenRevoked(token)) === true;
    } catch (err) {
        logger.error('Redis tryCheckRevoked FAIL CLOSED — treating as revoked', err);
        return true;
    }
}

/**
 * Fast session cache lookup.
 * null  = no Redis / cache miss → verify signed cookie + VendorAccess.activeSessionId
 * true  = Redis confirms this is the active session
 * false = Redis has a different active session (superseded)
 *
 * A Redis miss must NOT fail closed — OTP sets a signed cookie even when
 * the Redis write is slow or skipped. Treating miss as invalid kicked users
 * out of /view right after a successful OTP.
 */
export async function tryValidateSession(token: string, sessionId: string): Promise<boolean | null> {
    if (!isRedisConfigured()) {
        return null;
    }

    try {
        const { validateSession } = await getRedisModule();
        const result = await validateSession(token, sessionId);
        if (result === 'valid') return true;
        if (result === 'superseded') return false;
        return null;
    } catch (err) {
        logger.error('Redis tryValidateSession error — falling back to signed cookie', err);
        return null;
    }
}

/**
 * Session TTL from Redis cache, or fallback when Redis is absent/errors.
 */
export async function tryGetSessionTTL(token: string, sessionId: string, fallback: number): Promise<number> {
    if (!isRedisConfigured()) {
        return fallback;
    }

    try {
        const { getSessionTTL } = await getRedisModule();
        const ttl = await getSessionTTL(token, sessionId);
        return ttl > 0 ? ttl : fallback;
    } catch (err) {
        logger.error('Redis tryGetSessionTTL error, using DB fallback', err);
        return fallback;
    }
}

/**
 * Best-effort cache write. App does not depend on this succeeding.
 * Returns true if cached, false if Redis skipped/unavailable.
 * deviceFingerprint binds the active access session to the verifying device.
 */
export async function tryCreateSession(
    token: string,
    sessionId: string,
    ttlSeconds: number,
    deviceFingerprint?: string,
): Promise<boolean> {
    if (!isRedisConfigured()) {
        return false;
    }

    try {
        const { createSession } = await getRedisModule();
        await createSession(token, sessionId, ttlSeconds, deviceFingerprint);
        return true;
    } catch (err) {
        logger.error('Redis tryCreateSession cache write failed (non-fatal)', err);
        return false;
    }
}

/**
 * Read device fingerprint bound to the active Redis session (if any).
 * null = Redis unavailable / no session fingerprint stored.
 */
export async function tryGetSessionDeviceFingerprint(
    token: string,
): Promise<string | null> {
    if (!isRedisConfigured()) {
        return null;
    }

    try {
        const { getActiveSession } = await getRedisModule();
        const session = await getActiveSession(token);
        return session?.deviceFingerprint ?? null;
    } catch (err) {
        logger.error('Redis tryGetSessionDeviceFingerprint failed', err);
        return null;
    }
}
