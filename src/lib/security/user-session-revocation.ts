import { isRedisConfigured } from '@/lib/redis-helpers';
import { logger } from '@/lib/logger';

// In-memory revocation cache for development, testing, and single-process fallback
const memoryRevocations = new Map<string, number>();

const REVOCATION_KEY_PREFIX = 'auth:min_valid_iat:';
const REVOCATION_TTL_SECONDS = 24 * 60 * 60; // 24 hours (matches NextAuth JWT maxAge)

/**
 * Invalidate all existing sessions for a user (e.g. immediately upon password reset).
 * Any JWT issued before this timestamp will be rejected.
 */
export async function revokeAllUserSessions(userId: string): Promise<void> {
    if (!userId) return;
    const epochSeconds = Math.floor(Date.now() / 1000);
    memoryRevocations.set(userId, epochSeconds);

    if (isRedisConfigured()) {
        try {
            const { default: redis } = await import('@/lib/redis');
            await redis.set(`${REVOCATION_KEY_PREFIX}${userId}`, String(epochSeconds), {
                ex: REVOCATION_TTL_SECONDS,
            });
        } catch (err) {
            logger.warn('[Auth] Failed to set user session revocation in Redis', err);
        }
    }
}

/**
 * Checks whether a user's session token was issued before the most recent revocation event.
 * @param userId - User ID
 * @param tokenIssuedAtSeconds - Unix timestamp in seconds when the JWT was issued
 */
export async function isUserSessionRevoked(
    userId: string,
    tokenIssuedAtSeconds: number,
): Promise<boolean> {
    if (!userId) return false;

    // 1. Fast in-memory check
    const memMinIat = memoryRevocations.get(userId);
    if (typeof memMinIat === 'number' && tokenIssuedAtSeconds < memMinIat) {
        return true;
    }

    // 2. Distributed Redis check (when configured)
    if (isRedisConfigured()) {
        try {
            const { default: redis } = await import('@/lib/redis');
            const raw = await redis.get(`${REVOCATION_KEY_PREFIX}${userId}`);
            if (raw !== null && raw !== undefined) {
                const redisMinIat = parseInt(String(raw), 10);
                if (Number.isFinite(redisMinIat) && tokenIssuedAtSeconds < redisMinIat) {
                    memoryRevocations.set(userId, redisMinIat);
                    return true;
                }
            }
        } catch (err) {
            logger.warn('[Auth] Error checking user session revocation in Redis', err);
        }
    }

    return false;
}

/**
 * Test helper: clear in-memory revocations between test cases
 */
export function _clearUserSessionRevocationsForTesting(): void {
    memoryRevocations.clear();
}

