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

// ============================================
// SESSION MANAGEMENT
// ============================================

/**
 * Creates an ephemeral session in Redis
 * 
 * Security features:
 * - TTL enforced at Redis level (not frontend)
 * - Single active session per token (new session invalidates old)
 * - Session ID is cryptographically random
 * 
 * @param token - The share link token
 * @param sessionId - Unique session identifier
 * @param ttlSeconds - Time-to-live in seconds
 * @param deviceFingerprint - Optional device fingerprint for suspicious activity detection
 */
export async function createSession(
    token: string,
    sessionId: string,
    ttlSeconds: number,
    deviceFingerprint?: string
): Promise<void> {
    const sessionKey = `${SESSION_PREFIX}${token}:${sessionId}`;
    const activeKey = `${ACTIVE_SESSION_PREFIX}${token}`;

    const sessionData: SessionData = {
        sessionId,
        token,
        createdAt: Date.now(),
        expiresAt: Date.now() + (ttlSeconds * 1000),
        deviceFingerprint,
    };

    // Use pipeline for atomic operations
    const pipeline = redis.pipeline();

    // Invalidate any existing active session for this token
    const existingSessionId = await redis.get<string>(activeKey);
    if (existingSessionId) {
        pipeline.del(`${SESSION_PREFIX}${token}:${existingSessionId}`);
    }

    // Create new session with TTL
    pipeline.set(sessionKey, JSON.stringify(sessionData), { ex: ttlSeconds });

    // Set this as the active session
    pipeline.set(activeKey, sessionId, { ex: ttlSeconds });

    await pipeline.exec();
}

/**
 * Validates a session
 * 
 * @param token - The share link token
 * @param sessionId - Session ID to validate
 * @returns true if session is valid and active
 */
export async function validateSession(
    token: string,
    sessionId: string
): Promise<boolean> {
    // Check if link is revoked
    const isRevoked = await redis.exists(`${REVOKED_PREFIX}${token}`);
    if (isRevoked) {
        return false;
    }

    // Check if this is the active session
    const activeSessionId = await redis.get<string>(`${ACTIVE_SESSION_PREFIX}${token}`);
    if (activeSessionId !== sessionId) {
        return false;
    }

    // Check if session exists (not expired)
    const sessionKey = `${SESSION_PREFIX}${token}:${sessionId}`;
    const exists = await redis.exists(sessionKey);

    return exists === 1;
}

/**
 * Gets the active session data for a token
 * 
 * @param token - The share link token
 * @returns Session data or null if no active session
 */
export async function getActiveSession(token: string): Promise<SessionData | null> {
    const activeSessionId = await redis.get<string>(`${ACTIVE_SESSION_PREFIX}${token}`);
    if (!activeSessionId) {
        return null;
    }

    const sessionKey = `${SESSION_PREFIX}${token}:${activeSessionId}`;
    const sessionData = await redis.get<string>(sessionKey);

    if (!sessionData) {
        return null;
    }

    return JSON.parse(sessionData) as SessionData;
}

/**
 * Invalidates all sessions for a token (kill switch)
 * 
 * Security: This immediately terminates any active viewing session
 * 
 * @param token - The share link token
 * @param permanentRevoke - If true, prevents any future sessions
 */
export async function invalidateSession(
    token: string,
    permanentRevoke: boolean = false
): Promise<void> {
    const activeKey = `${ACTIVE_SESSION_PREFIX}${token}`;
    const activeSessionId = await redis.get<string>(activeKey);

    const pipeline = redis.pipeline();

    // Delete active session marker
    pipeline.del(activeKey);

    // Delete the session data if exists
    if (activeSessionId) {
        pipeline.del(`${SESSION_PREFIX}${token}:${activeSessionId}`);
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
    const activeKey = `${ACTIVE_SESSION_PREFIX}${token}`;
    const exists = await redis.exists(activeKey);
    return exists === 1;
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
    const activeKey = `${ACTIVE_SESSION_PREFIX}${token}`;

    // Get current TTL
    const currentTTL = await redis.ttl(sessionKey);
    if (currentTTL <= 0) {
        return false;
    }

    const newTTL = currentTTL + additionalSeconds;

    // Update both keys
    await redis.expire(sessionKey, newTTL);
    await redis.expire(activeKey, newTTL);

    return true;
}

export default redis;
