import { Redis } from '@upstash/redis';

// ============================================
// REDIS CLIENT INITIALIZATION (Lazy Singleton)
// ============================================

/**
 * Serverless Redis client for ephemeral session management
 * Uses Upstash Redis REST API for edge compatibility
 *
 * LAZY INIT: Client is created on first use, not at module import.
 * This prevents crashes when redis.ts is imported but Redis credentials
 * are misconfigured or unavailable.
 */
let _redis: Redis | null = null;

function getRedis(): Redis {
    if (!_redis) {
        _redis = new Redis({
            url: process.env.UPSTASH_REDIS_REST_URL!,
            token: process.env.UPSTASH_REDIS_REST_TOKEN!,
        });
    }
    return _redis;
}

// Proxy object that lazily accesses the real Redis client
const redis = new Proxy({} as Redis, {
    get(_target, prop) {
        const client = getRedis();
        const value = (client as any)[prop];
        if (typeof value === 'function') {
            return value.bind(client);
        }
        return value;
    }
});

// Session key prefixes for organization
const SESSION_PREFIX = 'session:';
/** SET of concurrent session IDs for a share token (collaborative editing). */
const SESSIONS_SET_PREFIX = 'sessions:';
/** @deprecated Legacy singleton — cleared on write; no longer authoritative. */
const ACTIVE_SESSION_PREFIX = 'active:';
const REVOKED_PREFIX = 'revoked:';

// ============================================
// SESSION TYPES
// ============================================

export interface SessionData {
    sessionId: string;
    token: string;
    createdAt: number;
    expiresAt: number;
    deviceFingerprint?: string;
}

export interface CreateSessionOptions {
    /** Prior session for the same vendor — removed so re-login does not leave orphans. */
    replaceSessionId?: string | null;
}

export type RedisSessionCheck = 'valid' | 'superseded' | 'unknown';

// ============================================
// SESSION MANAGEMENT
// ============================================

/**
 * Creates an ephemeral session in Redis
 *
 * Security features:
 * - TTL enforced at Redis level (not frontend)
 * - Multiple concurrent sessions per token (one per collaborator)
 * - Optional replaceSessionId drops that vendor's previous session only
 * - Session ID is cryptographically random
 *
 * @param token - The share link token
 * @param sessionId - Unique session identifier
 * @param ttlSeconds - Time-to-live in seconds
 * @param deviceFingerprint - Optional device fingerprint for suspicious activity detection
 * @param options - Optional replace of a prior session for the same recipient
 */
export async function createSession(
    token: string,
    sessionId: string,
    ttlSeconds: number,
    deviceFingerprint?: string,
    options?: CreateSessionOptions
): Promise<void> {
    const sessionKey = `${SESSION_PREFIX}${token}:${sessionId}`;
    const sessionsSetKey = `${SESSIONS_SET_PREFIX}${token}`;
    const legacyActiveKey = `${ACTIVE_SESSION_PREFIX}${token}`;

    const sessionData: SessionData = {
        sessionId,
        token,
        createdAt: Date.now(),
        expiresAt: Date.now() + (ttlSeconds * 1000),
        deviceFingerprint,
    };

    const pipeline = redis.pipeline();

    // Drop only the replaced session (same vendor re-auth), not other collaborators
    const replaceId = options?.replaceSessionId;
    if (replaceId && replaceId !== sessionId) {
        pipeline.del(`${SESSION_PREFIX}${token}:${replaceId}`);
        pipeline.srem(sessionsSetKey, replaceId);
    }

    // Clear legacy singleton so old active:{token} cannot block multi-user sessions
    pipeline.del(legacyActiveKey);

    pipeline.set(sessionKey, JSON.stringify(sessionData), { ex: ttlSeconds });
    pipeline.sadd(sessionsSetKey, sessionId);
    // Keep the index at least as long as this session (stale members are harmless)
    pipeline.expire(sessionsSetKey, ttlSeconds);

    await pipeline.exec();
}

/**
 * Validates a session against Redis cache.
 * unknown     = cache miss → caller must trust signed cookie + DB
 * superseded  = this session was ended (break / re-login / revoke / legacy singleton)
 * valid       = this session exists in Redis (collaborators may have other sessions too)
 */
function isRedisTruthy(value: unknown): boolean {
    return value === 1 || value === true || value === '1';
}

export async function validateSession(
    token: string,
    sessionId: string
): Promise<RedisSessionCheck> {
    const sessionKey = `${SESSION_PREFIX}${token}:${sessionId}`;
    const pipeline = redis.pipeline();
    pipeline.exists(`${REVOKED_PREFIX}${token}`);
    pipeline.exists(sessionKey);
    pipeline.sismember(`${SESSIONS_SET_PREFIX}${token}`, sessionId);
    pipeline.get(`${ACTIVE_SESSION_PREFIX}${token}`);
    const [revoked, exists, inSet, legacyActive] = await pipeline.exec();

    if (isRedisTruthy(revoked)) {
        return 'superseded';
    }
    if (isRedisTruthy(exists)) {
        return 'valid';
    }
    if (isRedisTruthy(inSet)) {
        return 'superseded';
    }
    if (legacyActive) {
        return legacyActive === sessionId ? 'valid' : 'superseded';
    }
    return 'unknown';
}

export type SseAccessCheck = 'revoked' | 'invalid' | 'ok' | 'unknown';

/**
 * Single Redis round-trip for SSE kill-switch + session validity.
 * Distinguishes revoke vs session-invalid so clients can show the right event.
 */
export async function checkSseAccess(token: string, sessionId: string): Promise<SseAccessCheck> {
    const sessionKey = `${SESSION_PREFIX}${token}:${sessionId}`;
    const pipeline = redis.pipeline();
    pipeline.exists(`${REVOKED_PREFIX}${token}`);
    pipeline.exists(sessionKey);
    pipeline.scard(`${SESSIONS_SET_PREFIX}${token}`);
    pipeline.get(`${ACTIVE_SESSION_PREFIX}${token}`);
    const [revoked, exists, sessionCount, legacyActive] = await pipeline.exec();

    if (isRedisTruthy(revoked)) return 'revoked';
    if (isRedisTruthy(exists)) return 'ok';
    const count = typeof sessionCount === 'number' ? sessionCount : Number(sessionCount || 0);
    if (count > 0 || (legacyActive && legacyActive !== sessionId)) return 'invalid';
    if (legacyActive === sessionId) return 'ok';
    return 'unknown';
}

/**
 * Gets session data for a specific session id
 */
export async function getSession(
    token: string,
    sessionId: string
): Promise<SessionData | null> {
    const sessionKey = `${SESSION_PREFIX}${token}:${sessionId}`;
    const sessionData = await redis.get<string>(sessionKey);

    if (!sessionData) {
        return null;
    }

    if (typeof sessionData === 'object') {
        return sessionData as SessionData;
    }

    return JSON.parse(sessionData) as SessionData;
}

/**
 * @deprecated Prefer getSession(token, sessionId). Legacy singleton lookup.
 */
export async function getActiveSession(token: string): Promise<SessionData | null> {
    const activeSessionId = await redis.get<string>(`${ACTIVE_SESSION_PREFIX}${token}`);
    if (!activeSessionId) {
        return null;
    }
    return getSession(token, activeSessionId);
}

/**
 * Invalidates one session (e.g. vendor break) without affecting other collaborators.
 */
export async function invalidateOneSession(
    token: string,
    sessionId: string
): Promise<void> {
    const sessionKey = `${SESSION_PREFIX}${token}:${sessionId}`;
    const sessionsSetKey = `${SESSIONS_SET_PREFIX}${token}`;
    const legacyActiveKey = `${ACTIVE_SESSION_PREFIX}${token}`;

    const pipeline = redis.pipeline();
    pipeline.del(sessionKey);
    pipeline.srem(sessionsSetKey, sessionId);

    const legacyActive = await redis.get<string>(legacyActiveKey);
    if (legacyActive === sessionId) {
        pipeline.del(legacyActiveKey);
    }

    await pipeline.exec();
}

/**
 * Invalidates all sessions for a token (kill switch / revoke / complete)
 *
 * Security: This immediately terminates every viewing session for the share
 *
 * @param token - The share link token
 * @param permanentRevoke - If true, prevents any future sessions
 */
export async function invalidateSession(
    token: string,
    permanentRevoke: boolean = false
): Promise<void> {
    const sessionsSetKey = `${SESSIONS_SET_PREFIX}${token}`;
    const legacyActiveKey = `${ACTIVE_SESSION_PREFIX}${token}`;

    const [sessionIds, legacyActiveId] = await Promise.all([
        redis.smembers(sessionsSetKey),
        redis.get<string>(legacyActiveKey),
    ]);

    const pipeline = redis.pipeline();
    pipeline.del(sessionsSetKey);
    pipeline.del(legacyActiveKey);

    for (const id of sessionIds || []) {
        if (id) {
            pipeline.del(`${SESSION_PREFIX}${token}:${id}`);
        }
    }

    if (legacyActiveId) {
        pipeline.del(`${SESSION_PREFIX}${token}:${legacyActiveId}`);
    }

    // If permanent revoke, set a revoked marker (24 hour TTL as cleanup)
    if (permanentRevoke) {
        pipeline.set(`${REVOKED_PREFIX}${token}`, '1', { ex: 86400 });
    }

    await pipeline.exec();
}

/**
 * Checks if a token has any active session
 *
 * @param token - The share link token
 * @returns true if there's an active session
 */
export async function isSessionActive(token: string): Promise<boolean> {
    const sessionsSetKey = `${SESSIONS_SET_PREFIX}${token}`;
    const cardinality = await redis.scard(sessionsSetKey);
    if (cardinality > 0) {
        return true;
    }
    const legacy = await redis.exists(`${ACTIVE_SESSION_PREFIX}${token}`);
    return legacy === 1;
}

/**
 * Checks if a token has been permanently revoked
 *
 * @param token - The share link token
 * @returns true if revoked
 */
export async function isTokenRevoked(token: string): Promise<boolean> {
    const exists = await redis.exists(`${REVOKED_PREFIX}${token}`);
    return exists === 1;
}

/**
 * Gets remaining TTL for a session in seconds
 *
 * @param token - The share link token
 * @param sessionId - Session ID
 * @returns Remaining seconds, or -1 if expired/not found
 */
export async function getSessionTTL(token: string, sessionId: string): Promise<number> {
    const sessionKey = `${SESSION_PREFIX}${token}:${sessionId}`;
    const ttl = await redis.ttl(sessionKey);
    return ttl;
}

/**
 * Extends session TTL (if needed for specific use cases)
 * Note: Generally we don't want to extend sessions for security
 */
export async function extendSession(
    token: string,
    sessionId: string,
    additionalSeconds: number
): Promise<boolean> {
    const sessionKey = `${SESSION_PREFIX}${token}:${sessionId}`;
    const sessionsSetKey = `${SESSIONS_SET_PREFIX}${token}`;

    const currentTTL = await redis.ttl(sessionKey);
    if (currentTTL <= 0) {
        return false;
    }

    const newTTL = currentTTL + additionalSeconds;
    const pipeline = redis.pipeline();
    pipeline.expire(sessionKey, newTTL);
    pipeline.expire(sessionsSetKey, newTTL);
    await pipeline.exec();

    return true;
}

export default redis;
