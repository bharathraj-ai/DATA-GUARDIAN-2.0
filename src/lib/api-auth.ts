import { cookies, headers } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { generateDeviceHash } from '@/lib/fingerprint';
import { DEVICE_MISMATCH_ERROR } from '@/lib/session-device';
import { extractClientIP, checkGlobalRateLimit } from '@/lib/rate-limit';
import crypto from 'crypto';
import { validateCSRF } from '@/lib/security/csrf';
import { logger, redactToken, redactEmail } from '@/lib/logger';
import { isRedisConfigured } from '@/lib/redis-helpers';
import { verifyShareSession } from '@/lib/share-session';
import { decryptData } from '@/lib/crypto';

async function getRedisClient() {
    if (!isRedisConfigured()) {
        return null;
    }
    try {
        const { default: redisClient } = await import('@/lib/redis');
        return redisClient;
    } catch {
        return null;
    }
}

interface LogMetadata {
    ip?: string;
    [key: string]: unknown;
}

async function logSecurityEvent(action: string, linkId: string | null, metadata: LogMetadata) {
    try {
        if (metadata.ip) {
            metadata.ip = metadata.ip.substring(0, 6) + '***';
        }
        await prisma.auditLog.create({
            data: {
                action: action,
                linkId: linkId || undefined,
                reason: 'Zero-Trust API Authorization Gate',
                metadata: JSON.stringify(metadata),
            },
        });
    } catch (e) {
        logger.error('Audit log failed', e);
    }
}

export type ApiCapability = 'view' | 'preview' | 'edit' | 'download' | 'comment';

export type CapabilityFlags = {
    canEdit: boolean;
    canPreview: boolean;
    canComment: boolean;
    canDownload: boolean;
};

export type AuthorizeApiOptions = {
    httpMethod: string;
    /** Required object-level capability. Defaults to view. */
    action?: ApiCapability;
};

function normalizeEmail(value: string | null | undefined): string | null {
    return value?.trim().toLowerCase() || null;
}

function resolveCapabilities(
    secureLink: {
        allowEditing: boolean;
        allowDownload: boolean | null;
        allowComment: boolean | null;
    },
    isAuthorized: boolean,
    isOwner: boolean,
    editingLocked: boolean,
): CapabilityFlags {
    const member = isAuthorized || isOwner;
    return {
        canPreview: member,
        canEdit: Boolean(secureLink.allowEditing) && member && !editingLocked,
        canComment: (secureLink.allowComment ?? true) && member,
        canDownload: isOwner || (Boolean(secureLink.allowDownload) && isAuthorized),
    };
}

function denyCapability(action: ApiCapability, capabilities: CapabilityFlags): string | null {
    if (action === 'edit' && !capabilities.canEdit) return 'Forbidden: Edit access denied';
    if (action === 'preview' && !capabilities.canPreview) return 'Forbidden: Preview access denied';
    if (action === 'download' && !capabilities.canDownload) return 'Forbidden: Download access denied';
    if (action === 'comment' && !capabilities.canComment) return 'Forbidden: Comment access denied';
    if (action === 'view' && !capabilities.canPreview) return 'Forbidden: View access denied';
    return null;
}

/**
 * Zero-trust gate for UserFile APIs.
 * Auth: signed session cookie + Postgres ownership/capability checks.
 * Redis is optional cache (revoke/nonce).
 */
export async function authorizeApiRequest(
    fileId: string,
    token: string,
    options: AuthorizeApiOptions,
) {
    const action: ApiCapability = options.action ?? 'view';

    if (!token || !fileId) {
        return { errorResponse: NextResponse.json({ error: 'Zero-Trust Violation: Missing parameters' }, { status: 400 }) };
    }

    const _headers = await headers();
    const cookieStore = await cookies();
    const ip = extractClientIP(_headers);
    const redis = await getRedisClient();

    const rateLimit = await checkGlobalRateLimit(ip);
    if (!rateLimit.allowed) {
        await logSecurityEvent('DENIED', null, { ip, reason: 'Rate limit exceeded' });
        return { errorResponse: NextResponse.json({ error: 'Too Many Requests' }, { status: 429 }) };
    }

    const csrfResult = validateCSRF({ method: options.httpMethod || 'GET', headers: _headers });
    if (!csrfResult.allowed) {
        await logSecurityEvent('DENIED', null, { ip, reason: csrfResult.reason });
        return { errorResponse: NextResponse.json({ error: csrfResult.reason }, { status: csrfResult.status }) };
    }

    const nonce = _headers.get('x-security-nonce');
    const timestamp = _headers.get('x-timestamp');

    if (redis) {
        if (!nonce || !timestamp) {
            await logSecurityEvent('DENIED', null, { ip, reason: 'Missing replay protection headers' });
            return {
                errorResponse: NextResponse.json(
                    { error: 'Forbidden: Missing x-security-nonce / x-timestamp' },
                    { status: 403 },
                ),
            };
        }

        const parsedTs = parseInt(timestamp, 10);
        if (!Number.isFinite(parsedTs) || Math.abs(Date.now() - parsedTs) > 60000) {
            await logSecurityEvent('DENIED', null, { ip, reason: 'Stale request timestamp' });
            return {
                errorResponse: NextResponse.json(
                    { error: 'Replay Attack Prevented: Timestamp stale' },
                    { status: 403 },
                ),
            };
        }

        const setResult = await redis.set(`nonce:${nonce}`, '1', { nx: true, ex: 65 });
        if (setResult === null) {
            logger.security(`Replay attack detected for token: ${redactToken(token)}`);
            await logSecurityEvent('DENIED', null, { ip, reason: 'Reused nonce' });
            return {
                errorResponse: NextResponse.json(
                    { error: 'Replay Attack Prevented: Nonce reused' },
                    { status: 403 },
                ),
            };
        }
    }

    const sessionCookie = cookieStore.get('session_id')?.value;
    const verified = verifyShareSession(sessionCookie, token);
    if (!verified.valid) {
        await logSecurityEvent('DENIED', null, { ip, reason: 'Missing or invalid signed session' });
        return { errorResponse: NextResponse.json({ error: 'Unauthorized: Missing Hardened Session' }, { status: 401 }) };
    }
    const sessionId = verified.sessionId;

    if (redis) {
        const isRevoked = await redis.exists(`revoked:${token}`);
        if (isRevoked) {
            await logSecurityEvent('DENIED', null, { ip, reason: 'Access globally revoked in Redis cache' });
            return { errorResponse: NextResponse.json({ error: 'Forbidden: Access revoked' }, { status: 403 }) };
        }

        const activeSessionId = await redis.get(`active:${token}`);
        if (activeSessionId && activeSessionId !== sessionId) {
            await logSecurityEvent('DENIED', null, { ip, reason: 'Invalid or expired Redis Session match' });
            return { errorResponse: NextResponse.json({ error: 'Unauthorized: Invalid or Hijacked Session' }, { status: 401 }) };
        }
    }

    const file = await prisma.userFile.findUnique({
        where: { id: fileId },
        include: {
            mongoFile: true,
            SecureLink: {
                include: { VendorAccess: true, LinkAccess: true },
            },
        },
    });

    // Ownership: file must belong to this share token (blocks cross-user fileId swap)
    if (!file || file.SecureLink.token !== token) {
        await logSecurityEvent('DENIED', null, {
            fileId,
            token: redactToken(token),
            ip,
            reason: 'Cross-resource attempt blocked',
        });
        return { errorResponse: NextResponse.json({ error: 'Forbidden: Resource mismatch' }, { status: 403 }) };
    }

    const secureLink = file.SecureLink;

    if (secureLink.isRevoked || secureLink.expiresAt < new Date()) {
        await logSecurityEvent('DENIED', secureLink.id, { ip, reason: 'Link expired or revoked in DB' });
        return { errorResponse: NextResponse.json({ error: 'Forbidden: Link has expired or been revoked' }, { status: 403 }) };
    }
    if (secureLink.lockedAt) {
        await logSecurityEvent('DENIED', secureLink.id, { ip, reason: 'Link permanently locked' });
        return { errorResponse: NextResponse.json({ error: 'Forbidden: Link is permanently locked' }, { status: 403 }) };
    }

    const vendorWithSession = secureLink.VendorAccess.find((v) => v.activeSessionId);
    if (vendorWithSession?.activeSessionId && vendorWithSession.activeSessionId !== sessionId) {
        const matched = secureLink.VendorAccess.some((v) => v.activeSessionId === sessionId);
        if (!matched) {
            await logSecurityEvent('DENIED', secureLink.id, { ip, reason: 'DB session mismatch' });
            return { errorResponse: NextResponse.json({ error: 'Unauthorized: Session superseded' }, { status: 401 }) };
        }
    }

    // Active-session device binding (NOT link-creator binding).
    // Owners are exempt. Mismatch denies this request only — never revokes the share link.
    const authSessionEarly = await auth();
    const isOwnerEarly = Boolean(
        authSessionEarly?.user?.id && authSessionEarly.user.id === secureLink.ownerId,
    );

    if (!isOwnerEarly) {
        const currentDeviceHash = generateDeviceHash(_headers);
        const sessionVendor = secureLink.VendorAccess.find((v) => v.activeSessionId === sessionId);
        let boundDeviceHash: string | null | undefined = sessionVendor?.activeDeviceHash;

        if (!boundDeviceHash && redis) {
            try {
                const raw = await redis.get(`session:${token}:${sessionId}`);
                if (typeof raw === 'string') {
                    const parsed = JSON.parse(raw) as { deviceFingerprint?: string };
                    boundDeviceHash = parsed.deviceFingerprint;
                } else if (raw && typeof raw === 'object' && 'deviceFingerprint' in (raw as object)) {
                    boundDeviceHash = (raw as { deviceFingerprint?: string }).deviceFingerprint;
                }
            } catch {
                // ignore parse errors — fall through without Redis fingerprint
            }
        }

        if (boundDeviceHash && boundDeviceHash !== currentDeviceHash) {
            await logSecurityEvent('DENIED', secureLink.id, {
                ip,
                reason: 'Active session device mismatch',
                type: 'device_mismatch',
                expectedHash: boundDeviceHash.substring(0, 8),
                actualHash: currentDeviceHash.substring(0, 8),
            });

            return {
                errorResponse: NextResponse.json(
                    { error: DEVICE_MISMATCH_ERROR },
                    { status: 403 },
                ),
            };
        }
    }

    const authSession = authSessionEarly;
    const sessionEmail = normalizeEmail(authSession?.user?.email);

    const rawCookieEmail = cookieStore.get('vendor_email')?.value;
    let cookieEmail: string | null = null;
    if (rawCookieEmail) {
        try {
            const decoded = decryptData<{ email: string }>(rawCookieEmail);
            cookieEmail = normalizeEmail(decoded.email);
        } catch {
            cookieEmail = normalizeEmail(rawCookieEmail.includes(':') ? null : rawCookieEmail);
        }
    }
    const effectiveEmail = cookieEmail || sessionEmail;
    const isOwner = Boolean(authSession?.user?.id && authSession.user.id === secureLink.ownerId);

    const hasEmailGate =
        Boolean(secureLink.allowedVendorEmail) ||
        secureLink.VendorAccess.length > 0 ||
        (secureLink.LinkAccess?.length ?? 0) > 0;

    let isAuthorized = false;
    let detectedLevel = 2;
    let otpUsed = secureLink.isUsed;

    if (isOwner) {
        isAuthorized = true;
        otpUsed = true;
        detectedLevel = 1;
    } else if (!hasEmailGate) {
        isAuthorized = true;
    } else if (effectiveEmail) {
        if (secureLink.allowedVendorEmail && normalizeEmail(secureLink.allowedVendorEmail) === effectiveEmail) {
            isAuthorized = true;
        }

        const vendor = secureLink.VendorAccess.find(
            (v) => normalizeEmail(v.email) === effectiveEmail && !v.isRevoked,
        );
        if (vendor) {
            isAuthorized = true;
            detectedLevel = vendor.level;
        }

        const access = secureLink.LinkAccess.find(
            (l) => normalizeEmail(l.vendorEmail) === effectiveEmail && !l.lockedAt,
        );
        if (access) {
            isAuthorized = true;
            detectedLevel = access.level;
            otpUsed = access.isUsed;
        }
    }

    if (!isAuthorized) {
        await logSecurityEvent('EMAIL_MISMATCH', secureLink.id, {
            attemptedEmail: redactEmail(effectiveEmail),
        });
        return { errorResponse: NextResponse.json({ error: 'Forbidden: Identity Mismatch or Revoked' }, { status: 403 }) };
    }

    if (!otpUsed) {
        await logSecurityEvent('DENIED', secureLink.id, { ip, reason: 'OTP not verified' });
        return { errorResponse: NextResponse.json({ error: 'Unauthorized: OTP verification required' }, { status: 401 }) };
    }

    const capabilities = resolveCapabilities(
        secureLink,
        isAuthorized,
        isOwner,
        file.editingLocked,
    );
    const capabilityError = denyCapability(action, capabilities);
    if (capabilityError) {
        await logSecurityEvent('DENIED', secureLink.id, {
            ip,
            reason: capabilityError,
            action,
            allowEditing: secureLink.allowEditing,
            editingLocked: file.editingLocked,
        });
        return { errorResponse: NextResponse.json({ error: capabilityError }, { status: 403 }) };
    }

    return {
        file,
        secureLink,
        sessionId,
        effectiveEmail,
        level: detectedLevel,
        isOwner,
        capabilities,
    };
}

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
