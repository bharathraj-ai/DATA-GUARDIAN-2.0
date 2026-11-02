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
 * null  = Redis and DB unavailable
 * true  = revoked (in Redis cache or confirmed in authoritative PostgreSQL)
 * false = not revoked
 */
export async function tryCheckRevoked(token: string): Promise<boolean | null> {
    if (isRedisConfigured()) {
        try {
            const { isTokenRevoked } = await getRedisModule();
            const revoked = await isTokenRevoked(token);
            if (revoked === true) {
                return true;
            }
            if (revoked === false) {
                return false;
            }
        } catch (err) {
            logger.warn('[Redis] tryCheckRevoked unavailable — falling back to authoritative PostgreSQL check', {
                error: err instanceof Error ? err.message : String(err),
                token,
            });
        }
    }

    // Authoritative PostgreSQL fallback: Redis outage must never falsely mark a valid link as revoked
    try {
        const { prisma } = await import('@/lib/prisma');
        const link = await prisma.secureLink.findUnique({
            where: { token },
            select: { isRevoked: true },
        });
        return link?.isRevoked === true;
    } catch (dbErr) {
        logger.error('[DB] Fallback revocation check failed during Redis outage', dbErr);
        return null;
    }
}

/**
 * Permanently mark a token as revoked in Redis without TTL expiration (DL-03).
 */
export async function trySetRevoked(token: string): Promise<void> {
    if (!isRedisConfigured()) return;
    try {
        const { invalidateSession } = await getRedisModule();
        await invalidateSession(token, true);
    } catch (err) {
        logger.warn('[Redis] Failed to backfill permanent revocation marker', {
            error: err instanceof Error ? err.message : String(err),
        });
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
 * deviceFingerprint binds the access session to the verifying device.
 * replaceSessionId drops that vendor's prior Redis session only (not other collaborators).
 */
export async function tryCreateSession(
    token: string,
    sessionId: string,
    ttlSeconds: number,
    deviceFingerprint?: string,
    replaceSessionId?: string | null,
): Promise<boolean> {
    if (!isRedisConfigured()) {
        return false;
    }

    try {
        const { createSession } = await getRedisModule();
        await createSession(token, sessionId, ttlSeconds, deviceFingerprint, {
            replaceSessionId,
        });
        return true;
    } catch (err) {
        logger.error('Redis tryCreateSession cache write failed (non-fatal)', err);
        return false;
    }
}

/**
 * Best-effort: drop one collaborator's Redis session (break / logout).
 * Does not revoke the share or other vendors' sessions.
 */
export async function tryInvalidateOneSession(
    token: string,
    sessionId: string,
): Promise<boolean> {
    if (!isRedisConfigured() || !sessionId) {
        return false;
    }

    try {
        const { invalidateOneSession } = await getRedisModule();
        await invalidateOneSession(token, sessionId);
        return true;
    } catch (err) {
        logger.error('Redis tryInvalidateOneSession failed (non-fatal)', err);
        return false;
    }
}

/**
 * Read device fingerprint bound to a specific Redis session (if any).
 * null = Redis unavailable / no session fingerprint stored.
 */
/**
 * SSE heartbeat access check.
 * - Redis accelerates active session / kill-switch lookup.
 * - If Redis errors out, authoritative PostgreSQL fallback ensures valid links/sessions are not falsely revoked.
 */
export async function trySseAccessCheck(
    token: string,
    sessionId: string,
): Promise<'revoked' | 'invalid' | 'ok'> {
    if (!isRedisConfigured()) {
        return 'ok';
    }

    try {
        const { checkSseAccess } = await getRedisModule();
        const result = await checkSseAccess(token, sessionId);
        if (result === 'unknown') return 'ok';
        return result;
    } catch (err) {
        logger.warn('[Redis] trySseAccessCheck unavailable — falling back to authoritative PostgreSQL check', {
            error: err instanceof Error ? err.message : String(err),
            token,
        });
    }

    // Authoritative PostgreSQL fallback on Redis outage
    try {
        const { prisma } = await import('@/lib/prisma');
        const link = await prisma.secureLink.findUnique({
            where: { token },
            select: {
                isRevoked: true,
                VendorAccess: {
                    select: {
                        activeSessionId: true,
                        isRevoked: true,
                    },
                },
            },
        });

        if (!link || link.isRevoked) {
            return 'revoked';
        }

        if (link.VendorAccess && link.VendorAccess.length > 0) {
            const vendor = link.VendorAccess.find((v) => v.activeSessionId === sessionId);
            if (vendor?.isRevoked) {
                return 'revoked';
            }
        }

        return 'ok';
    } catch (dbErr) {
        logger.error('[DB] Fallback SSE access check failed during Redis outage', dbErr);
        return 'revoked';
    }
}

export async function tryGetSessionDeviceFingerprint(
    token: string,
    sessionId?: string,
): Promise<string | null> {
    if (!isRedisConfigured()) {
        return null;
    }

    try {
        const mod = await getRedisModule();
        if (sessionId) {
            const session = await mod.getSession(token, sessionId);
            return session?.deviceFingerprint ?? null;
        }
        const session = await mod.getActiveSession(token);
        return session?.deviceFingerprint ?? null;
    } catch (err) {
        logger.error('Redis tryGetSessionDeviceFingerprint failed', err);
        return null;
    }
}
