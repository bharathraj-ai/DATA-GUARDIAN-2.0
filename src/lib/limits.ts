import { prisma } from '@/lib/prisma';
import redis from '@/lib/redis';
import { Prisma } from '@prisma/client';
import { logger } from '@/lib/logger';

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
 * Atomic Lua script to initialize and increment counters safely (DL-04).
 * - If key exists and current >= maxLimit: denies immediately without incrementing.
 * - If key exists and current < maxLimit: atomically increments and refreshes TTL.
 * - If key does not exist and initCount < 0: returns {-1, 0} to trigger DB count.
 * - If key does not exist and initCount >= 0: initializes with DB count + 1 (or rejects if count >= maxLimit).
 * - If another concurrent request initialized the key in the interim, it safely uses the existing value.
 */
const ATOMIC_LIMIT_LUA = `
local key = KEYS[1]
local maxLimit = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local initCount = ARGV[3] and tonumber(ARGV[3]) or -1

local current = redis.call('GET', key)

if current == false then
    if initCount < 0 then
        return {-1, 0}
    end
    if initCount >= maxLimit then
        redis.call('SET', key, initCount, 'EX', ttl)
        return {0, initCount}
    end
    local nextVal = initCount + 1
    redis.call('SET', key, nextVal, 'EX', ttl)
    return {1, nextVal}
else
    local val = tonumber(current)
    if val >= maxLimit then
        return {0, val}
    end
    local nextVal = redis.call('INCR', key)
    local curTtl = redis.call('TTL', key)
    if curTtl == -1 then
        redis.call('EXPIRE', key, ttl)
    end
    return {1, nextVal}
end
`;

/**
 * Atomically increments a usage counter and checks against a maximum limit (DL-04).
 * Uses Redis Lua scripting for atomic check-and-increment when available;
 * Serializable Postgres transaction claim when Redis is unavailable.
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
        // Step 1: Probe / Atomic increment if key already exists
        let raw = await redis.eval(
            ATOMIC_LIMIT_LUA,
            [key],
            [maxLimit, ttlSeconds, -1]
        ) as unknown;

        let [allowedCode, currentCount] = Array.isArray(raw)
            ? raw.map(Number)
            : [Number(raw), 0];

        // Step 2: If key does not exist (-1), fetch historical count from DB and initialize atomically
        if (allowedCode === -1) {
            const actionType = type === 'view' ? 'ACCESSED' : 'VENDOR_DOWNLOADED_FILE';
            const count = await prisma.auditLog.count({
                where: { linkId, action: actionType },
            });

            raw = await redis.eval(
                ATOMIC_LIMIT_LUA,
                [key],
                [maxLimit, ttlSeconds, count]
            ) as unknown;

            [allowedCode, currentCount] = Array.isArray(raw)
                ? raw.map(Number)
                : [Number(raw), 0];
        }

        const allowed = allowedCode === 1;
        if (!allowed) {
            return {
                allowed: false,
                error: `Maximum ${type} limit reached`,
                currentCount,
            };
        }

        return { allowed: true, currentCount };
    } catch (error) {
        logger.error(`[LIMITS] Error checking ${type} limit for ${linkId}`, error);
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
        logger.error('[LIMITS] Atomic DB limit check failed', dbError);
        return { allowed: false, error: 'Limit check busy — retry', currentCount: 0 };
    }
}
