/**
 * Shared Redis validation helpers used across server actions.
 * Extracted to avoid duplicating the same ~20 lines in 6+ files.
 *
 * SECURITY MODEL (Two-Tier):
 *
 * ┌─────────────────────────────────────────────────────────┐
 * │ Redis NOT configured (no env vars)                      │
 * │ → Returns null (unknown)                                │
 * │ → Callers fall through to authoritative DB checks       │
 * │   (secureLink.isRevoked, expiresAt, isUsed)             │
 * │ → App works without Redis, DB is source of truth        │
 * ├─────────────────────────────────────────────────────────┤
 * │ Redis IS configured but ERRORS (timeout, crash, etc.)   │
 * │ → FAIL CLOSED: treat as revoked / session invalid       │
 * │ → Attacker cannot bypass auth by killing Redis          │
 * ├─────────────────────────────────────────────────────────┤
 * │ Redis IS configured and responds                        │
 * │ → Authoritative answer: true/false                      │
 * └─────────────────────────────────────────────────────────┘
 */

/** Returns true if Redis env vars are present and look real */
function isRedisConfigured(): boolean {
    return !!(
        process.env.UPSTASH_REDIS_REST_URL &&
        process.env.UPSTASH_REDIS_REST_TOKEN &&
        !process.env.UPSTASH_REDIS_REST_URL.includes('your-redis')
    );
}

/**
 * Check if a token has been revoked via Redis.
 *
 * Returns:
 *  - true  → Redis confirms revoked, OR Redis is configured but errored (FAIL CLOSED)
 *  - false → Redis confirms NOT revoked
 *  - null  → Redis is NOT CONFIGURED (caller falls through to DB)
 */
export async function tryCheckRevoked(token: string): Promise<boolean | null> {
    if (!isRedisConfigured()) {
        // Redis genuinely not set up — return null so callers can fall through to DB
        return null;
    }

    // Redis IS configured — errors must FAIL CLOSED
    try {
        const { isTokenRevoked } = await import('@/lib/redis');
        const revoked = await isTokenRevoked(token);
        return revoked === true;
    } catch (err) {
        console.error('[SECURITY] Redis tryCheckRevoked FAIL CLOSED — treating as revoked:', err instanceof Error ? err.message : 'Unknown');
        return true; // FAIL CLOSED: configured Redis errored → assume revoked
    }
}

/**
 * Validate a session via Redis.
 *
 * Returns:
 *  - true  → Redis confirms session IS valid
 *  - false → Redis confirms session is NOT valid, OR Redis errored (FAIL CLOSED)
 *  - null  → Redis is NOT CONFIGURED (caller falls through to DB)
 */
export async function tryValidateSession(token: string, sessionId: string): Promise<boolean | null> {
    if (!isRedisConfigured()) {
        // Redis genuinely not set up — return null so callers can fall through to DB
        return null;
    }

    // Redis IS configured — errors must FAIL CLOSED
    try {
        const { validateSession } = await import('@/lib/redis');
        const isValid = await validateSession(token, sessionId);
        return isValid === true; // Strict boolean coercion
    } catch (err) {
        console.error('[SECURITY] Redis tryValidateSession FAIL CLOSED — treating as invalid:', err instanceof Error ? err.message : 'Unknown');
        return false; // FAIL CLOSED: configured Redis errored → session invalid
    }
}

/**
 * Get session TTL.
 * Falls back to DB-based expiry time when Redis is unavailable.
 */
export async function tryGetSessionTTL(token: string, sessionId: string, fallback: number): Promise<number> {
    if (!isRedisConfigured()) {
        return fallback; // Use DB-based expiry when Redis is unavailable
    }

    try {
        const { getSessionTTL } = await import('@/lib/redis');
        const ttl = await getSessionTTL(token, sessionId);
        return ttl > 0 ? ttl : fallback;
    } catch (err) {
        console.error('[SECURITY] Redis tryGetSessionTTL error, falling back to DB expiry:', err instanceof Error ? err.message : 'Unknown');
        return fallback;
    }
}

/**
 * Create a session.
 * Returns false if Redis is unavailable — caller should still set the cookie
 * since the DB-level checks (isUsed, expiresAt, isRevoked) remain authoritative.
 */
export async function tryCreateSession(token: string, sessionId: string, ttlSeconds: number): Promise<boolean> {
    if (!isRedisConfigured()) {
        console.warn('[SECURITY] Redis not configured — session created in cookie only (DB-gated)');
        return false;
    }

    try {
        const { createSession } = await import('@/lib/redis');
        await createSession(token, sessionId, ttlSeconds);
        return true;
    } catch (err) {
        console.error('[SECURITY] Redis tryCreateSession error:', err instanceof Error ? err.message : 'Unknown');
        return false;
    }
}
