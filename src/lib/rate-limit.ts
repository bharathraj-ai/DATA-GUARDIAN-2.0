/**
 * Rate limiting — fail-closed when Redis is unavailable (in-process fixed-window fallback).
 *
 * Distributed deployments: each instance maintains its own memory bucket (weaker than Redis
 * but still blocks unbounded abuse per instance). Pair with edge/WAF rate limits in production.
 */

import crypto from 'crypto';
import { logger } from '@/lib/logger';
import { isRedisConfigured } from '@/lib/redis-helpers';

const RATE_LIMITS = {
  OTP_VERIFY: {
    MAX_ATTEMPTS: 10,
    WINDOW_SECONDS: 15 * 60,
  },
  LINK_ACCESS: {
    MAX_ATTEMPTS: 30,
    WINDOW_SECONDS: 60,
  },
  GLOBAL_IP: {
    MAX_ATTEMPTS: 100,
    WINDOW_SECONDS: 60,
  },
  UPLOAD_IP: {
    MAX_ATTEMPTS: 20,
    WINDOW_SECONDS: 3600,
  },
  DOWNLOAD_IP: {
    MAX_ATTEMPTS: 20,
    WINDOW_SECONDS: 3600,
  },
  CHAT_IP: {
    MAX_ATTEMPTS: 60,
    WINDOW_SECONDS: 60,
  },
  CHAT_TOKEN: {
    MAX_ATTEMPTS: 40,
    WINDOW_SECONDS: 60,
  },
  LOGIN_IP: {
    MAX_ATTEMPTS: 20,
    WINDOW_SECONDS: 15 * 60,
  },
};

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfter?: number;
  /** True when serving from in-memory fallback (not Redis). */
  usedMemoryFallback?: boolean;
}

const RATE_LIMIT_LUA = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
return {n, ttl}
`;

let redisClient: Awaited<typeof import('@/lib/redis')>['default'] | null = null;

async function getRedis() {
  if (redisClient) return redisClient;
  if (!isRedisConfigured()) return null;

  try {
    const { default: redis } = await import('@/lib/redis');
    redisClient = redis;
    return redisClient;
  } catch (error) {
    logger.error('Redis connection failed:', error);
    return null;
  }
}

type MemEntry = { count: number; windowStartMs: number };
const memoryBuckets = new Map<string, MemEntry>();

const MEMORY_MAX_KEYS = 50_000;

function pruneMemoryIfNeeded() {
  if (memoryBuckets.size <= MEMORY_MAX_KEYS) return;
  const cutoff = Date.now() - 3600_000;
  for (const [k, v] of memoryBuckets) {
    if (v.windowStartMs < cutoff) memoryBuckets.delete(k);
  }
}

function checkRateLimitMemory(key: string, limit: number, windowSeconds: number): RateLimitResult {
  pruneMemoryIfNeeded();
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  let entry = memoryBuckets.get(key);
  if (!entry || now - entry.windowStartMs >= windowMs) {
    entry = { count: 0, windowStartMs: now };
    memoryBuckets.set(key, entry);
  }
  entry.count += 1;
  const resetAt = entry.windowStartMs + windowMs;
  const remaining = Math.max(0, limit - entry.count);
  const allowed = entry.count <= limit;
  const retryAfter = allowed ? undefined : Math.max(1, Math.ceil((resetAt - now) / 1000));

  return {
    allowed,
    remaining,
    resetAt,
    retryAfter,
    usedMemoryFallback: true,
  };
}

function tokenBucketSuffix(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 24);
}

async function checkRateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  const redis = await getRedis();

  if (!redis) {
    return checkRateLimitMemory(key, limit, windowSeconds);
  }

  try {
    const raw = await redis.eval(RATE_LIMIT_LUA, [key], [windowSeconds]) as unknown;
    const pair = Array.isArray(raw) ? raw : [raw, windowSeconds];
    const current = Number(pair[0]);
    let ttl = Number(pair[1]);
    if (!Number.isFinite(current)) {
      return checkRateLimitMemory(`fb:${key}`, limit, windowSeconds);
    }
    if (!Number.isFinite(ttl) || ttl < 0) {
      ttl = windowSeconds;
      await redis.expire(key, windowSeconds).catch(() => undefined);
    }
    const resetAt = Date.now() + Math.max(0, ttl) * 1000;
    const remaining = Math.max(0, limit - current);
    const allowed = current <= limit;
    return {
      allowed,
      remaining,
      resetAt,
      retryAfter: allowed ? undefined : Math.max(0, ttl),
      usedMemoryFallback: false,
    };
  } catch (error) {
    logger.error('Redis error — using memory fallback (fail-closed):', error);
    return checkRateLimitMemory(`fb:${key}`, limit, windowSeconds);
  }
}

export async function checkOTPRateLimit(ip: string): Promise<RateLimitResult> {
  const sanitizedIP = sanitizeIP(ip);
  return checkRateLimit(
    `ratelimit:otp:${sanitizedIP}`,
    RATE_LIMITS.OTP_VERIFY.MAX_ATTEMPTS,
    RATE_LIMITS.OTP_VERIFY.WINDOW_SECONDS,
  );
}

export async function checkLinkRateLimit(token: string): Promise<RateLimitResult> {
  return checkRateLimit(
    `ratelimit:link:${tokenBucketSuffix(token)}`,
    RATE_LIMITS.LINK_ACCESS.MAX_ATTEMPTS,
    RATE_LIMITS.LINK_ACCESS.WINDOW_SECONDS,
  );
}

export async function checkGlobalRateLimit(ip: string): Promise<RateLimitResult> {
  const sanitizedIP = sanitizeIP(ip);
  return checkRateLimit(
    `ratelimit:global:${sanitizedIP}`,
    RATE_LIMITS.GLOBAL_IP.MAX_ATTEMPTS,
    RATE_LIMITS.GLOBAL_IP.WINDOW_SECONDS,
  );
}

export async function checkUploadRateLimit(ip: string): Promise<RateLimitResult> {
  const sanitizedIP = sanitizeIP(ip);
  return checkRateLimit(
    `ratelimit:upload:${sanitizedIP}`,
    RATE_LIMITS.UPLOAD_IP.MAX_ATTEMPTS,
    RATE_LIMITS.UPLOAD_IP.WINDOW_SECONDS,
  );
}

export async function checkLoginRateLimit(ip: string): Promise<RateLimitResult> {
  const sanitizedIP = sanitizeIP(ip);
  return checkRateLimit(
    `ratelimit:login:${sanitizedIP}`,
    RATE_LIMITS.LOGIN_IP.MAX_ATTEMPTS,
    RATE_LIMITS.LOGIN_IP.WINDOW_SECONDS,
  );
}

export async function checkDownloadRateLimit(ip: string): Promise<RateLimitResult> {
  const sanitizedIP = sanitizeIP(ip);
  return checkRateLimit(
    `ratelimit:download:${sanitizedIP}`,
    RATE_LIMITS.DOWNLOAD_IP.MAX_ATTEMPTS,
    RATE_LIMITS.DOWNLOAD_IP.WINDOW_SECONDS,
  );
}

/** Secure-link chat: per-IP + per-token throttles (fail-closed). */
export async function checkSecureChatRateLimits(ip: string, token: string): Promise<RateLimitResult> {
  const ipRes = await checkRateLimit(
    `ratelimit:chat:ip:${sanitizeIP(ip)}`,
    RATE_LIMITS.CHAT_IP.MAX_ATTEMPTS,
    RATE_LIMITS.CHAT_IP.WINDOW_SECONDS,
  );
  if (!ipRes.allowed) return ipRes;
  return checkRateLimit(
    `ratelimit:chat:tok:${tokenBucketSuffix(token)}`,
    RATE_LIMITS.CHAT_TOKEN.MAX_ATTEMPTS,
    RATE_LIMITS.CHAT_TOKEN.WINDOW_SECONDS,
  );
}

function sanitizeIP(ip: string): string {
  if (!ip || ip === 'unknown') return 'unknown';
  const firstIP = ip.split(',')[0].trim();
  return firstIP.replace(/:/g, '-').substring(0, 45);
}

export function extractClientIP(headers: Headers): string {
  const forwardedFor = headers.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }
  const realIP = headers.get('x-real-ip');
  if (realIP) return realIP;
  const cfConnectingIP = headers.get('cf-connecting-ip');
  if (cfConnectingIP) return cfConnectingIP;
  return 'unknown';
}

export function formatRateLimitError(result: RateLimitResult): string {
  if (result.allowed) return '';
  const minutes = Math.ceil((result.retryAfter || 60) / 60);
  return `Too many attempts. Please try again in ${minutes} minute${minutes !== 1 ? 's' : ''}.`;
}
