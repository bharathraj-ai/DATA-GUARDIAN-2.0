import { cookies, headers } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { generateDeviceHash } from '@/lib/fingerprint';
import { extractClientIP, checkGlobalRateLimit } from '@/lib/rate-limit';
import crypto from 'crypto';

// Try to load redis safely for hybrid environments
async function getRedisClient() {
    try {
        if (!process.env.UPSTASH_REDIS_REST_URL || process.env.UPSTASH_REDIS_REST_URL.includes('your-redis')) {
            return null;
        }
        const { default: redisClient } = await import('@/lib/redis');
        return redisClient;
    } catch {
        return null;
    }
}

/**
 * Audit Logging Utility without sensitive data leakage
 * Strict sanitization to prevent PII exposure in logs.
 */
async function logSecurityEvent(action: string, linkId: string | null, metadata: any) {
    try {
        // Redact IP slightly
        if (metadata.ip) {
            metadata.ip = metadata.ip.substring(0, 6) + '***';
        }
        await prisma.auditLog.create({
            data: {
                action: action,
                linkId: linkId || undefined,
                reason: 'Zero-Trust API Authorization Gate',
                metadata: JSON.stringify(metadata)
            }
        });
    } catch (e) {
        console.error('Audit log failed', e);
    }
}

export type AuthorizeApiOptions = {
    /** Actual HTTP method from NextRequest.method — required for correct CSRF policy. */
    httpMethod: string;
};

/**
 * Zero-trust gate for UserFile-scoped APIs (share-token + ephemeral session).
 */
export async function authorizeApiRequest(
    fileId: string,
    token: string,
    options: AuthorizeApiOptions,
) {
    if (!token || !fileId) {
        return { errorResponse: NextResponse.json({ error: 'Zero-Trust Violation: Missing parameters' }, { status: 400 }) };
    }

    const _headers = await headers();
    const cookieStore = await cookies();
    const ip = extractClientIP(_headers);
    const redis = await getRedisClient();

    // 1. Rate Limiting (DDoS & Brute Force Prevention)
    const rateLimit = await checkGlobalRateLimit(ip);
    if (!rateLimit.allowed) {
        await logSecurityEvent('DENIED', null, { ip, reason: 'Rate limit exceeded' });
        return { errorResponse: NextResponse.json({ error: 'Too Many Requests' }, { status: 429 }) };
    }

    // 2. Anti-CSRF: only state-changing methods require Origin alignment with Host
    const method = (options.httpMethod || 'GET').toUpperCase();
    const origin = _headers.get('origin');
    const host = _headers.get('host');
    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(method);

    if (process.env.NODE_ENV === 'production' && mutating) {
        if (origin && host) {
            try {
                if (new URL(origin).host !== host) {
                    await logSecurityEvent('DENIED', null, { ip, reason: 'CSRF Origin mismatch', origin, host, method });
                    return { errorResponse: NextResponse.json({ error: 'CSRF Violation: Origin mismatch' }, { status: 403 }) };
                }
            } catch {
                await logSecurityEvent('DENIED', null, { ip, reason: 'Invalid Origin header', origin, method });
                return { errorResponse: NextResponse.json({ error: 'CSRF Violation: Invalid Origin' }, { status: 403 }) };
            }
        }
    }

    // 3. Prevent Replay Attacks (Nonce validation)
    const nonce = _headers.get('x-security-nonce');
    const timestamp = _headers.get('x-timestamp');

    if (redis && nonce && timestamp) {
        // Enforce timestamp recency (within 60 seconds)
        const timeDiff = Math.abs(Date.now() - parseInt(timestamp, 10));
        if (timeDiff > 60000) {
            await logSecurityEvent('DENIED', null, { ip, reason: 'Stale request timestamp' });
            return { errorResponse: NextResponse.json({ error: 'Replay Attack Prevented: Timestamp stale' }, { status: 403 }) };
        }

        // Verify nonce hasn't been used
        const nonceKey = `nonce:${nonce}`;
        const isReplay = await redis.setnx(nonceKey, "1");
        if (isReplay === 0) {
            console.error(`[SECURITY] Replay attack detected for token: ${token}`);
            await logSecurityEvent('DENIED', null, { ip, reason: 'Reused nonce' });
            return { errorResponse: NextResponse.json({ error: 'Replay Attack Prevented: Nonce reused' }, { status: 403 }) };
        }
        await redis.expire(nonceKey, 65); // Expire slightly after timestamp skew bound
    }

    // 4. Validate HttpOnly session cookie (Strict Mode)
    const sessionId = cookieStore.get('session_id')?.value;
    if (!sessionId) {
        await logSecurityEvent('DENIED', null, { ip, reason: 'Missing Session Cookie' });
        return { errorResponse: NextResponse.json({ error: 'Unauthorized: Missing Hardened Session' }, { status: 401 }) };
    }

    // 5. Cross-Check Session in Redis (Zero Trust Ephemeral Cache)
    if (redis) {
        const isRevoked = await redis.exists(`revoked:${token}`);
        if (isRevoked) {
            await logSecurityEvent('DENIED', null, { ip, reason: 'Access globally revoked in Redis cache' });
            return { errorResponse: NextResponse.json({ error: 'Forbidden: Access revoked' }, { status: 403 }) };
        }

        const activeSessionId = await redis.get(`active:${token}`);
        if (activeSessionId !== sessionId) {
            await logSecurityEvent('DENIED', null, { ip, reason: 'Invalid or expired Redis Session match' });
            return { errorResponse: NextResponse.json({ error: 'Unauthorized: Invalid or Hijacked Session' }, { status: 401 }) };
        }
    }

    // 6. DB Verification: Resource Bound Enforcement
    const file = await prisma.userFile.findUnique({
        where: { id: fileId },
        include: { 
            mongoFile: true,
            SecureLink: {
                include: { VendorAccess: true, LinkAccess: true }
            } 
        }
    });

    if (!file || file.SecureLink.token !== token) {
        await logSecurityEvent('DENIED', null, { fileId, token, ip, reason: 'Cross-resource attempt blocked' });
        return { errorResponse: NextResponse.json({ error: 'Forbidden: Resource mismatch' }, { status: 403 }) };
    }

    const secureLink = file.SecureLink;

    // 7. Lifecycle Binding
    if (secureLink.isRevoked || secureLink.expiresAt < new Date()) {
        await logSecurityEvent('DENIED', secureLink.id, { ip, reason: 'Link expired or revoked in DB' });
        return { errorResponse: NextResponse.json({ error: 'Forbidden: Link has expired or been revoked' }, { status: 403 }) };
    }
    if (secureLink.lockedAt) {
        await logSecurityEvent('DENIED', secureLink.id, { ip, reason: 'Link permanently locked' });
        return { errorResponse: NextResponse.json({ error: 'Forbidden: Link is permanently locked' }, { status: 403 }) };
    }

    // 8. Device Context Binding (Session Hijacking Prevention)
    const currentDeviceHash = generateDeviceHash(_headers);
    if (secureLink.deviceHash && secureLink.deviceHash !== currentDeviceHash) {
        await logSecurityEvent('SESSION_HIJACK', secureLink.id, {
            ip, expectedHash: secureLink.deviceHash.substring(0, 8), actualHash: currentDeviceHash.substring(0, 8) 
        });
        
        // ANOMALY RESPONSE: Force Logout on Anomaly Detection by wiping session entirely
        if (redis) {
            const pipeline = redis.pipeline();
            pipeline.del(`active:${token}`);
            pipeline.del(`session:${token}:${sessionId}`);
            await pipeline.exec();
        }

        // Lock Link entirely dynamically to prevent further abuse
        await prisma.secureLink.update({
             where: { id: secureLink.id },
             data: { 
                 lockedAt: new Date(),
                 isRevoked: true
             }
        });

        return { errorResponse: NextResponse.json({ error: 'Forbidden: Environmental Context Changed (Session Hijacked)' }, { status: 403 }) };
    }

    const hasEmailGate =
        Boolean(secureLink.allowedVendorEmail) ||
        secureLink.VendorAccess.length > 0 ||
        (secureLink.LinkAccess?.length ?? 0) > 0;

    // 9. Vendor Email Binding (Zero Trust Cloud Identity)
    if (hasEmailGate) {
        const session = await auth();
        const userEmail = session?.user?.email;

        const effectiveEmail = userEmail;

        if (!effectiveEmail) {
            await logSecurityEvent('DENIED', secureLink.id, { ip, reason: 'Missing Identity' });
            return { errorResponse: NextResponse.json({ error: 'Unauthorized: Required cloud identity missing' }, { status: 401 }) };
        }

        const effectiveEmailLower = effectiveEmail.toLowerCase();
        let isAuthorized = false;
        let detectedLevel = 2; // default

        if (secureLink.allowedVendorEmail && secureLink.allowedVendorEmail.toLowerCase() === effectiveEmailLower) {
            isAuthorized = true;
        } else {
            const vendor = secureLink.VendorAccess.find(v => v.email.toLowerCase() === effectiveEmailLower);
            if (vendor && !vendor.isRevoked) {
                isAuthorized = true;
                detectedLevel = vendor.level;
            }
            if (!isAuthorized && secureLink.LinkAccess?.length) {
                const access = secureLink.LinkAccess.find(
                    (l) => l.vendorEmail.toLowerCase() === effectiveEmailLower,
                );
                if (access && !access.lockedAt) {
                    isAuthorized = true;
                    detectedLevel = access.level;
                }
            }
        }

        if (!isAuthorized) {
            await logSecurityEvent('EMAIL_MISMATCH', secureLink.id, {
                attemptedEmail: effectiveEmail
            });
            return { errorResponse: NextResponse.json({ error: 'Forbidden: Identity Mismatch or Revoked' }, { status: 403 }) };
        }
        
        return { file, secureLink, sessionId, effectiveEmail, level: detectedLevel };
    }

    // Return the safe artifacts
    return { file, secureLink, sessionId, effectiveEmail: null, level: 2 };
}

/**
 * Utility to forcefully rotate a user's session ID after critical actions
 * Prevent static session identifiers from being lifted post-validation
 */
export async function rotateSessionId(token: string, oldSessionId: string): Promise<string | null> {
    const redis = await getRedisClient();
    if (!redis) return null;

    const isValid = await redis.get(`active:${token}`);
    if (isValid !== oldSessionId) return null;

    const newSessionId = crypto.randomBytes(32).toString('hex');
    const oldSessionKey = `session:${token}:${oldSessionId}`;
    const newSessionKey = `session:${token}:${newSessionId}`;
    const ttl = await redis.ttl(oldSessionKey);

    if (ttl > 0) {
        const sessionData = await redis.get(oldSessionKey);
        const pipeline = redis.pipeline();
        
        // Swap session
        if (typeof sessionData === 'string') {
            const parsed = JSON.parse(sessionData);
            parsed.sessionId = newSessionId;
            pipeline.set(newSessionKey, JSON.stringify(parsed), { ex: ttl });
        }
        
        pipeline.del(oldSessionKey);
        pipeline.set(`active:${token}`, newSessionId, { ex: ttl });
        await pipeline.exec();
    }

    return newSessionId;
}
