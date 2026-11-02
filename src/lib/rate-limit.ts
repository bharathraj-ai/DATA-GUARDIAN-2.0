/**
 * Rate limiting — distributed Redis rate limiting with strict fail-closed protection.
 *
 * Distributed deployments:
 * - Production REQUIRES distributed Redis rate limiting.
 * - Security-sensitive operations (OTP verification, login) FAIL CLOSED when Redis is unavailable
 *   in production, preventing brute-force attacks across multi-instance clusters.
 * - Non-production / development preserves in-memory fallback for local developer ergonomics.
 */

import crypto from 'crypto';
import net from 'net';
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

export interface CheckRateLimitOptions {
  /** If true, failing closed is enforced in production when Redis is down */
  securitySensitive?: boolean;
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

export function isDistributedRateLimitRequired(): boolean {
  return (
    process.env.NODE_ENV === 'production' ||
    process.env.REQUIRE_DISTRIBUTED_RATE_LIMIT === 'true'
  );
}

export function _resetRedisClientForTesting(): void {
  redisClient = null;
}

export function _clearMemoryBucketsForTesting(): void {
  memoryBuckets.clear();
}

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

export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  options?: CheckRateLimitOptions
): Promise<RateLimitResult> {
  const isProd = isDistributedRateLimitRequired();
  const isSensitive = options?.securitySensitive ?? false;

  const redis = await getRedis();

  if (!redis) {
    if (isProd && isSensitive) {
      logger.error(`[RATE LIMIT FAIL-CLOSED] Redis unavailable for security-sensitive operation: ${key}`);
      return {
        allowed: false,
        remaining: 0,
        resetAt: Date.now() + windowSeconds * 1000,
        retryAfter: windowSeconds,
        usedMemoryFallback: false,
      };
    }
    return checkRateLimitMemory(key, limit, windowSeconds);
  }

  try {
    const raw = await redis.eval(RATE_LIMIT_LUA, [key], [windowSeconds]) as unknown;
    const pair = Array.isArray(raw) ? raw : [raw, windowSeconds];
    const current = Number(pair[0]);
    let ttl = Number(pair[1]);
    if (!Number.isFinite(current)) {
      if (isProd && isSensitive) {
        logger.error(`[RATE LIMIT FAIL-CLOSED] Non-numeric rate limit returned for ${key}`);
        return {
          allowed: false,
          remaining: 0,
          resetAt: Date.now() + windowSeconds * 1000,
          retryAfter: windowSeconds,
          usedMemoryFallback: false,
        };
      }
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
    logger.error(`[RATE LIMIT] Redis error on ${key}:`, error);
    if (isProd && isSensitive) {
      logger.error(`[RATE LIMIT FAIL-CLOSED] Failing closed due to Redis error on security-sensitive operation: ${key}`);
      return {
        allowed: false,
        remaining: 0,
        resetAt: Date.now() + windowSeconds * 1000,
        retryAfter: windowSeconds,
        usedMemoryFallback: false,
      };
    }
    return checkRateLimitMemory(`fb:${key}`, limit, windowSeconds);
  }
}

export async function checkOTPRateLimit(
  ip: string,
  options?: CheckRateLimitOptions
): Promise<RateLimitResult> {
  const sanitizedIP = sanitizeIP(ip);
  return checkRateLimit(
    `ratelimit:otp:${sanitizedIP}`,
    RATE_LIMITS.OTP_VERIFY.MAX_ATTEMPTS,
    RATE_LIMITS.OTP_VERIFY.WINDOW_SECONDS,
    { securitySensitive: true, ...options },
  );
}

export async function checkLinkRateLimit(
  token: string,
  options?: CheckRateLimitOptions
): Promise<RateLimitResult> {
  return checkRateLimit(
    `ratelimit:link:${tokenBucketSuffix(token)}`,
    RATE_LIMITS.LINK_ACCESS.MAX_ATTEMPTS,
    RATE_LIMITS.LINK_ACCESS.WINDOW_SECONDS,
    options,
  );
}

export async function checkGlobalRateLimit(
  ip: string,
  options?: CheckRateLimitOptions
): Promise<RateLimitResult> {
  const sanitizedIP = sanitizeIP(ip);
  return checkRateLimit(
    `ratelimit:global:${sanitizedIP}`,
    RATE_LIMITS.GLOBAL_IP.MAX_ATTEMPTS,
    RATE_LIMITS.GLOBAL_IP.WINDOW_SECONDS,
    options,
  );
}

export async function checkUploadRateLimit(
  ip: string,
  options?: CheckRateLimitOptions
): Promise<RateLimitResult> {
  const sanitizedIP = sanitizeIP(ip);
  return checkRateLimit(
    `ratelimit:upload:${sanitizedIP}`,
    RATE_LIMITS.UPLOAD_IP.MAX_ATTEMPTS,
    RATE_LIMITS.UPLOAD_IP.WINDOW_SECONDS,
    options,
  );
}

export async function checkLoginRateLimit(
  ip: string,
  options?: CheckRateLimitOptions
): Promise<RateLimitResult> {
  const sanitizedIP = sanitizeIP(ip);
  return checkRateLimit(
    `ratelimit:login:${sanitizedIP}`,
    RATE_LIMITS.LOGIN_IP.MAX_ATTEMPTS,
    RATE_LIMITS.LOGIN_IP.WINDOW_SECONDS,
    { securitySensitive: true, ...options },
  );
}

export async function checkDownloadRateLimit(
  ip: string,
  options?: CheckRateLimitOptions
): Promise<RateLimitResult> {
  const sanitizedIP = sanitizeIP(ip);
  return checkRateLimit(
    `ratelimit:download:${sanitizedIP}`,
    RATE_LIMITS.DOWNLOAD_IP.MAX_ATTEMPTS,
    RATE_LIMITS.DOWNLOAD_IP.WINDOW_SECONDS,
    options,
  );
}

/** Secure-link chat: per-IP + per-token throttles (fail-closed). */
export async function checkSecureChatRateLimits(
  ip: string,
  token: string,
  options?: CheckRateLimitOptions
): Promise<RateLimitResult> {
  const ipRes = await checkRateLimit(
    `ratelimit:chat:ip:${sanitizeIP(ip)}`,
    RATE_LIMITS.CHAT_IP.MAX_ATTEMPTS,
    RATE_LIMITS.CHAT_IP.WINDOW_SECONDS,
    options,
  );
  if (!ipRes.allowed) return ipRes;
  return checkRateLimit(
    `ratelimit:chat:tok:${tokenBucketSuffix(token)}`,
    RATE_LIMITS.CHAT_TOKEN.MAX_ATTEMPTS,
    RATE_LIMITS.CHAT_TOKEN.WINDOW_SECONDS,
    options,
  );
}

export function sanitizeIP(ip: string): string {
  if (!ip || ip === 'unknown') return 'unknown';
  const clean = cleanCandidateIP(ip);
  if (!clean) return 'unknown';
  return clean.replace(/:/g, '-').substring(0, 45);
}

// ============================================
// TRUSTED PROXY & CLIENT IP RESOLUTION (SV-06)
// ============================================

export function isValidIP(ip: string | null | undefined): boolean {
  if (!ip || typeof ip !== 'string') return false;
  return net.isIP(ip.trim()) !== 0;
}

/**
 * Validates and normalizes candidate IP strings:
 * - Strips quotes
 * - Handles IPv6 bracketed syntax `[2001:db8::1]:8080`
 * - Handles IPv4 with port `1.2.3.4:8080`
 * - Validates IPv4 and IPv6 format
 */
export function cleanCandidateIP(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  let candidate = raw.trim();

  // Strip surrounding quotes
  if (
    (candidate.startsWith('"') && candidate.endsWith('"')) ||
    (candidate.startsWith("'") && candidate.endsWith("'"))
  ) {
    candidate = candidate.slice(1, -1).trim();
  }

  // Bracketed IPv6 with optional port: [2001:db8::1] or [::1]:8080
  const bracketMatch = candidate.match(/^\[([a-fA-F0-9:]+)\](?::\d+)?$/);
  if (bracketMatch) {
    candidate = bracketMatch[1];
  } else if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+$/.test(candidate)) {
    // IPv4 with port
    candidate = candidate.split(':')[0];
  }

  if (net.isIP(candidate) !== 0) {
    return candidate;
  }
  return null;
}

function ipv4ToInt(ip: string): number {
  return ip
    .split('.')
    .reduce((acc, octet) => ((acc << 8) + parseInt(octet, 10)) >>> 0, 0);
}

function matchIPv4CIDR(ip: string, cidr: string): boolean {
  const [subnet, bitsStr] = cidr.split('/');
  const bits = parseInt(bitsStr, 10);
  if (isNaN(bits) || bits < 0 || bits > 32) return false;
  if (net.isIPv4(ip) && net.isIPv4(subnet)) {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (ipv4ToInt(ip) & mask) === (ipv4ToInt(subnet) & mask);
  }
  return false;
}

/**
 * Evaluates whether an IP address matches the configured trusted proxies.
 */
export function isTrustedProxy(ip: string): boolean {
  if (!isValidIP(ip)) return false;

  const trustedEnv = process.env.TRUSTED_PROXIES;
  if (!trustedEnv) {
    return false;
  }

  // Normalize IPv4-mapped IPv6 (::ffff:127.0.0.1 -> 127.0.0.1)
  let normalizedIp = ip;
  if (normalizedIp.startsWith('::ffff:') && net.isIPv4(normalizedIp.substring(7))) {
    normalizedIp = normalizedIp.substring(7);
  }

  const entries = trustedEnv.split(',').map((e) => e.trim().toLowerCase());

  for (const entry of entries) {
    if (!entry) continue;

    if (entry === 'loopback') {
      if (
        normalizedIp === '127.0.0.1' ||
        normalizedIp === '::1' ||
        matchIPv4CIDR(normalizedIp, '127.0.0.0/8')
      ) {
        return true;
      }
      continue;
    }

    if (entry === 'private') {
      if (
        matchIPv4CIDR(normalizedIp, '10.0.0.0/8') ||
        matchIPv4CIDR(normalizedIp, '172.16.0.0/12') ||
        matchIPv4CIDR(normalizedIp, '192.168.0.0/16') ||
        normalizedIp === '127.0.0.1' ||
        normalizedIp === '::1'
      ) {
        return true;
      }
      continue;
    }

    if (entry === 'cloudflare') {
      return true;
    }

    if (entry.includes('/')) {
      if (matchIPv4CIDR(normalizedIp, entry)) {
        return true;
      }
    } else {
      let cleanEntry = cleanCandidateIP(entry);
      if (cleanEntry) {
        if (cleanEntry.startsWith('::ffff:') && net.isIPv4(cleanEntry.substring(7))) {
          cleanEntry = cleanEntry.substring(7);
        }
        if (cleanEntry === normalizedIp) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Extracts and cryptographically/structurally validates the client IP address.
 *
 * Security principles:
 * 1. Never blindly trust client-supplied X-Forwarded-For[0].
 * 2. Traverse X-Forwarded-For hops right-to-left, peeling off configured trusted proxies.
 * 3. The first untrusted IP encountered is the authoritative client IP.
 * 4. Reject malformed, invalid, or injected IP strings.
 * 5. Support trusted deployment proxies (Cloudflare cf-connecting-ip, Vercel).
 */
export function extractClientIP(headers: Headers): string {
  // 1. Cloudflare deployment proxy: trust cf-connecting-ip if Cloudflare is trusted
  const cfConnectingIP = cleanCandidateIP(headers.get('cf-connecting-ip'));
  const trustCloudflare =
    process.env.TRUST_CLOUDFLARE_PROXY === 'true' ||
    (process.env.TRUSTED_PROXIES && process.env.TRUSTED_PROXIES.toLowerCase().includes('cloudflare'));
  if (trustCloudflare && cfConnectingIP) {
    return cfConnectingIP;
  }

  // 2. Parse X-Forwarded-For
  const forwardedFor = headers.get('x-forwarded-for');
  if (forwardedFor) {
    const rawHops = forwardedFor.split(',');
    const validHops: string[] = [];

    for (const raw of rawHops) {
      const clean = cleanCandidateIP(raw);
      if (clean) {
        validHops.push(clean);
      }
    }

    if (validHops.length > 0) {
      // If TRUSTED_PROXIES is configured, walk right-to-left
      // peeling off trusted proxy hops until the first untrusted client IP is found.
      const hasTrustedProxiesConfigured = Boolean(process.env.TRUSTED_PROXIES);

      if (hasTrustedProxiesConfigured) {
        for (let i = validHops.length - 1; i >= 0; i--) {
          const hop = validHops[i];
          if (!isTrustedProxy(hop)) {
            return hop;
          }
        }
        // If all hops matched trusted proxies, return the leftmost valid hop
        return validHops[0];
      } else {
        // When no trusted proxies are configured, reverse proxies append to the end.
        // The rightmost hop is the immediate caller and cannot be forged by the client.
        return validHops[validHops.length - 1];
      }
    }
  }

  // 3. Fallback to x-real-ip if present and valid
  const realIP = cleanCandidateIP(headers.get('x-real-ip'));
  if (realIP) return realIP;

  // 4. Fallback to cf-connecting-ip if valid (when not explicitly trusted above)
  if (cfConnectingIP) return cfConnectingIP;

  return 'unknown';
}

export function formatRateLimitError(result: RateLimitResult): string {
  if (result.allowed) return '';
  const minutes = Math.ceil((result.retryAfter || 60) / 60);
  return `Too many attempts. Please try again in ${minutes} minute${minutes !== 1 ? 's' : ''}.`;
}

