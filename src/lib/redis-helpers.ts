/**
 * Shared Redis validation helpers used across server actions.
 * Extracted to avoid duplicating the same ~20 lines in 6+ files.
 */

/** Check if a token has been revoked via Redis. Returns null if Redis is unavailable. */
export async function tryCheckRevoked(token: string): Promise<boolean | null> {
    try {
        if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN ||
            process.env.UPSTASH_REDIS_REST_URL.includes('your-redis')) {
            return null;
        }
        const { isTokenRevoked } = await import('@/lib/redis');
        return await isTokenRevoked(token);
    } catch {
        return null;
    }
}

/** Validate a session via Redis. Returns null if Redis is unavailable. */
export async function tryValidateSession(token: string, sessionId: string): Promise<boolean | null> {
    try {
        if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN ||
            process.env.UPSTASH_REDIS_REST_URL.includes('your-redis')) {
            return null;
        }
        const { validateSession } = await import('@/lib/redis');
        return await validateSession(token, sessionId);
    } catch {
        return null;
    }
}
