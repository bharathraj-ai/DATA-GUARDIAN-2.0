import { prisma } from '@/lib/prisma';
import redis from '@/lib/redis';

/**
 * Ensures Redis is configured and available
 */
function isRedisConfigured(): boolean {
    return !!(
        process.env.UPSTASH_REDIS_REST_URL &&
        process.env.UPSTASH_REDIS_REST_TOKEN &&
        !process.env.UPSTASH_REDIS_REST_URL.includes('your-redis')
    );
}

export type LimitType = 'view' | 'download';

export interface LimitCheckResult {
    allowed: boolean;
    error?: string;
    currentCount: number;
}

/**
 * Atomically increments a usage counter and checks against a maximum limit.
 * Uses Hybrid Architecture: Redis for speed, PostgreSQL AuditLog for recovery.
 * 
 * @param linkId The internal ID of the SecureLink
 * @param type 'view' or 'download'
 * @param maxLimit The maximum allowed occurrences (null = unlimited)
 * @param expiresAt The Date object representing when the link expires
 * @returns Object with allowed status and current count
 */
export async function incrementAndCheckLimit(
    linkId: string,
    type: LimitType,
    maxLimit: number | null,
    expiresAt: Date
): Promise<LimitCheckResult> {
    if (!isRedisConfigured()) {
        console.warn(`[LIMITS] Redis not configured. Cannot strictly enforce ${type} limits using Redis.`);
        // Fallback to DB if we must enforce limit
        if (maxLimit !== null) {
            return fallbackLimitCheck(linkId, type, maxLimit);
        }
        return { allowed: true, currentCount: 0 };
    }

    const key = `${type}:${linkId}`;
    const ttlSeconds = Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
    
    if (ttlSeconds <= 0) {
        return { allowed: false, error: 'Link expired', currentCount: 0 };
    }

    try {
        // 1. Check if counter exists. If not, we might need to rebuild from AuditLog.
        const exists = await redis.exists(key);
        
        if (!exists) {
            // Rebuild from AuditLog
            const actionType = type === 'view' ? 'ACCESSED' : 'VENDOR_DOWNLOADED_FILE';

            // Count historic occurrences
            const count = await prisma.auditLog.count({
                where: {
                    linkId,
                    action: actionType
                }
            });

            // Set the base value if it doesn't exist (NX)
            await redis.set(key, count, { nx: true, ex: ttlSeconds });
        }

        // 2. Atomically increment
        const currentCount = await redis.incr(key);
        
        // Ensure TTL is set in case incr recreated the key without TTL
        if (currentCount === 1) {
             await redis.expire(key, ttlSeconds);
        }

        // 3. Check limit
        if (maxLimit !== null && currentCount > maxLimit) {
            // Rollback the increment since it was rejected
            await redis.decr(key);
            return {
                allowed: false,
                error: `Maximum ${type} limit reached`,
                currentCount: currentCount - 1
            };
        }

        return {
            allowed: true,
            currentCount
        };

    } catch (error) {
        console.error(`[LIMITS] Error checking ${type} limit for ${linkId}:`, error);
        // Fail-closed for security on limits? If Redis errors, fallback to AuditLog count.
        if (maxLimit !== null) {
            return fallbackLimitCheck(linkId, type, maxLimit);
        }
        return { allowed: true, currentCount: 0 };
    }
}

async function fallbackLimitCheck(linkId: string, type: LimitType, maxLimit: number): Promise<LimitCheckResult> {
    try {
        const actionType = type === 'view' ? 'ACCESSED' : 'VENDOR_DOWNLOADED_FILE';
        const count = await prisma.auditLog.count({
            where: { linkId, action: actionType }
        });
        
        // +1 for the current request
        if ((count + 1) > maxLimit) {
            return { allowed: false, error: `Maximum ${type} limit reached (fallback check)`, currentCount: count };
        }
        return { allowed: true, currentCount: count + 1 };
    } catch (dbError) {
        return { allowed: false, error: 'Internal system error', currentCount: 0 };
    }
}
