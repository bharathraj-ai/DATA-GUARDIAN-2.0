import { prisma } from '@/lib/prisma';
import redis from '@/lib/redis';
import { Prisma } from '@prisma/client';

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
 * Redis INCR when available; Serializable Postgres claim when not.
 */
export async function incrementAndCheckLimit(
    linkId: string,
    type: LimitType,
    maxLimit: number | null,
    expiresAt: Date
): Promise<LimitCheckResult> {
    if (maxLimit === null) {
        return { allowed: true, currentCount: 0 };
    }

    const ttlSeconds = Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
    if (ttlSeconds <= 0) {
        return { allowed: false, error: 'Link expired', currentCount: 0 };
    }

    if (!isRedisConfigured()) {
        return atomicDbLimitCheck(linkId, type, maxLimit);
    }

    const key = `${type}:${linkId}`;

    try {
        const exists = await redis.exists(key);

        if (!exists) {
            const actionType = type === 'view' ? 'ACCESSED' : 'VENDOR_DOWNLOADED_FILE';
            const count = await prisma.auditLog.count({
                where: { linkId, action: actionType },
            });
            await redis.set(key, count, { nx: true, ex: ttlSeconds });
        }

        const currentCount = await redis.incr(key);
        if (currentCount === 1) {
            await redis.expire(key, ttlSeconds);
        }

        if (currentCount > maxLimit) {
            await redis.decr(key);
            return {
                allowed: false,
                error: `Maximum ${type} limit reached`,
                currentCount: currentCount - 1,
            };
        }

        return { allowed: true, currentCount };
    } catch (error) {
        console.error(`[LIMITS] Error checking ${type} limit for ${linkId}:`, error);
        return atomicDbLimitCheck(linkId, type, maxLimit);
    }
}

/**
 * Serializable transaction: count + reserve row so concurrent requests cannot both pass.
 */
async function atomicDbLimitCheck(
    linkId: string,
    type: LimitType,
    maxLimit: number,
): Promise<LimitCheckResult> {
    const actionType = type === 'view' ? 'ACCESSED' : 'VENDOR_DOWNLOADED_FILE';
    const reserveAction = type === 'view' ? 'VIEW_LIMIT_RESERVE' : 'DOWNLOAD_LIMIT_RESERVE';

    try {
        return await prisma.$transaction(
            async (tx) => {
                const count = await tx.auditLog.count({
                    where: {
                        linkId,
                        action: { in: [actionType, reserveAction] },
                    },
                });

                if (count >= maxLimit) {
                    return {
                        allowed: false,
                        error: `Maximum ${type} limit reached`,
                        currentCount: count,
                    };
                }

                await tx.auditLog.create({
                    data: {
                        action: reserveAction,
                        linkId,
                        reason: `Atomic ${type} limit claim`,
                        metadata: JSON.stringify({ claimedAt: Date.now() }),
                    },
                });

                return { allowed: true, currentCount: count + 1 };
            },
            {
                isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
                maxWait: 5000,
                timeout: 10000,
            },
        );
    } catch (dbError) {
        // Serialization conflict → fail closed
        console.error('[LIMITS] Atomic DB limit check failed:', dbError);
        return { allowed: false, error: 'Limit check busy — retry', currentCount: 0 };
    }
}
