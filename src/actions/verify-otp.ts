'use server';

import { prisma } from '@/lib/prisma';
import { verifyOTPHash, encryptData } from '@/lib/crypto';
import { otpVerifySchema, OTPVerifyInput } from '@/lib/validations';
import { cookies, headers } from 'next/headers';
import { generateDeviceHash, isActiveSessionFresh } from '@/lib/fingerprint';
import { DEVICE_MISMATCH_ERROR, isSessionDeviceMismatch } from '@/lib/session-device';
import { notifyLinkAccessed } from '@/lib/notifications';
import { checkOTPRateLimit, checkLinkRateLimit, extractClientIP, formatRateLimitError } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { auth } from '@/lib/auth';

// NOTE: OTP verification window is intentionally disabled (infinite reuse allowed per product design).
// Break-Based OTP rotation handles expiry at the OTP level via currentOtpExpiresAt.

import { tryCheckRevoked, tryCreateSession } from '@/lib/redis-helpers';
import { incrementAndCheckLimit } from '@/lib/limits';

export type VerifyOTPResult = {
    success: boolean;
    accessGranted?: boolean;
    sessionId?: string;
    error?: string;
    errorType?: 'EXPIRED' | 'USED' | 'INVALID_OTP' | 'NOT_FOUND' | 'VALIDATION_ERROR' | 'REVOKED' | 'LOCKED' | 'DENIED' | 'EMAIL_MISMATCH' | 'LIMIT_EXCEEDED';
};

/**
 * Verifies OTP and creates an ephemeral Redis session
 * 
 * ZERO TRUST Security Features:
 * - Email Binding (allowedVendorEmail must match authenticated user)
 * - 3-ATTEMPTS OTP (wrong OTP 3 times = permanent link revocation)
 * - Device Binding (bound to ACTIVE access session after OTP — not link creator)
 * - Server-side OTP validation (Zero Trust)
 * - Redis session with TTL (auto-expire)
 * - Kill switch check (Revocation)
 * - ANTI-PHISHING: Rate limiting (10 attempts/15 min per IP)
 * - ANTI-PHISHING: Single-use OTP enforcement (hash cleared after success)
 */
export async function verifyOTP(input: OTPVerifyInput & { email?: string }): Promise<VerifyOTPResult> {
    try {
        // Server-side validation (Zero Trust)
        const validatedData = otpVerifySchema.safeParse(input);

        if (!validatedData.success) {
            return {
                success: false,
                error: validatedData.error.issues[0]?.message || 'Invalid input',
                errorType: 'VALIDATION_ERROR',
            };
        }

        const { token, otp } = validatedData.data;
        const vendorEmail = input.email?.toLowerCase().trim();
        const _headers = await headers();
        const currentDeviceHash = generateDeviceHash(_headers);
        const clientIP = extractClientIP(_headers);

        // PERFORMANCE: Run independent async operations in parallel
        // Rate limit, Redis revoke check, auth session, and DB query are all independent
        const [rateLimit, linkRateLimit, revokedInRedis, session, secureLink] = await Promise.all([
            checkOTPRateLimit(clientIP),
            checkLinkRateLimit(token),
            tryCheckRevoked(token),
            auth(),
            prisma.secureLink.findUnique({
                where: { token },
                select: {
                    id: true,
                    token: true,
                    otpHash: true,
                    expiresAt: true,
                    isUsed: true,
                    isRevoked: true,
                    failedAttempts: true,
                    lockedAt: true,
                    deviceHash: true,
                    userId: true,
                    ownerId: true,
                    createdAt: true,
                    maxViews: true,
                    // V2.1 fields
                    purpose: true,
                    purposeDetail: true,
                    notificationEmail: true,
                    // Zero Trust: Email binding
                    LinkAccess: {
                        select: {
                            id: true,
                            vendorEmail: true,
                            otpHash: true,
                            isUsed: true,
                            deviceHash: true,
                            failedAttempts: true,
                            lockedAt: true,
                            otpFirstAttemptAt: true,
                            otpVerifiedAt: true,
                        }
                    },
                    // Anti-Phishing fields (Legacy fallback)
                    otpFirstAttemptAt: true,
                    otpVerifiedAt: true,
                    VendorAccess: {
                        select: {
                            id: true,
                            email: true,
                            otpHash: true,
                            isRevoked: true,
                            status: true,
                            activeSessionId: true,
                            activeDeviceHash: true,
                            lastSeenAt: true,
                            loginCount: true,
                            failedAttempts: true,
                            breakStartedAt: true,
                            totalBreakDuration: true,
                            // Break-Based OTP Rotation fields
                            currentOtpHash: true,
                            currentOtpExpiresAt: true,
                            breaksUsed: true,
                            allowedBreaks: true,
                        }
                    },
                }
            }),
        ]);

        // ANTI-PHISHING: Rate limiting check
        if (!rateLimit.allowed || !linkRateLimit.allowed) {
            const limited = !rateLimit.allowed ? rateLimit : linkRateLimit;
            prisma.auditLog.create({
                data: {
                    action: 'DENIED',
                    reason: 'Rate limit exceeded',
                    metadata: JSON.stringify({
                        ip: clientIP.substring(0, 6) + '***',
                        type: 'rate_limit',
                        retryAfter: limited.retryAfter
                    })
                }
            }).catch(() => { }); // fire-and-forget audit

            return {
                success: false,
                error: formatRateLimitError(limited),
                errorType: 'DENIED'
            };
        }

        // Check if token is revoked in Redis (if available)
        if (revokedInRedis === true) {
            return {
                success: false,
                error: 'This link has been revoked by the owner.',
                errorType: 'REVOKED',
            };
        }

        // ZERO TRUST: Verify authenticated user email
        const userEmail = session?.user?.email;

        // secureLink already fetched in parallel above

        // Link not found
        if (!secureLink) {
            return {
                success: false,
                error: 'This link is invalid or has been deleted.',
                errorType: 'NOT_FOUND',
            };
        }

        const sessionEmail = session?.user?.email?.toLowerCase().trim();
        const effectiveVendorEmail = vendorEmail || sessionEmail || '';

        // Get effective access state (Per-vendor if available, otherwise global legacy)
        const vendorAccess = secureLink.LinkAccess?.find(
            (a) =>
                (effectiveVendorEmail && a.vendorEmail.toLowerCase() === effectiveVendorEmail) ||
                (sessionEmail && a.vendorEmail.toLowerCase() === sessionEmail),
        );

        const isLocked = vendorAccess ? vendorAccess.lockedAt : secureLink.lockedAt;
        const failedAttempts = vendorAccess ? vendorAccess.failedAttempts : secureLink.failedAttempts;
        const otpFirstAttemptAt = vendorAccess ? vendorAccess.otpFirstAttemptAt : secureLink.otpFirstAttemptAt;

        // 1. SECURITY: Check if link is permanently locked
        if (isLocked) {
            return {
                success: false,
                error: 'This link has been permanently locked due to excessive failed attempts.',
                errorType: 'LOCKED',
            };
        }

        // 2. ZERO TRUST: Check max attempts (3 ATTEMPTS POLICY)
        if (failedAttempts >= 3) {
            return {
                success: false,
                error: 'This link has been permanently revoked due to invalid OTP attempts.',
                errorType: 'LOCKED',
            };
        }

        // 3. ZERO TRUST: Email binding validation using VendorAccess
        let vendor: (typeof secureLink.VendorAccess)[number] | null = null;
        if (effectiveVendorEmail) {
            vendor =
                secureLink.VendorAccess.find(
                    (v) => v.email.toLowerCase() === effectiveVendorEmail,
                ) ?? null;
            if (!vendor && secureLink.VendorAccess.length > 0) {
                return {
                    success: false,
                    error: `This link was created for a different recipient. Access denied.`,
                    errorType: 'EMAIL_MISMATCH',
                };
            }
        } else if (secureLink.VendorAccess && secureLink.VendorAccess.length > 0) {
            // Break-Based OTP Rotation: timing-safe verify against currentOtpHash first
            for (const v of secureLink.VendorAccess) {
                if (v.currentOtpHash && await verifyOTPHash(otp, v.currentOtpHash)) {
                    vendor = v;
                    break;
                }
            }

            // Fallback to legacy otpHash (HMAC or bcrypt) when no rotated hash exists
            if (!vendor) {
                for (const v of secureLink.VendorAccess) {
                    if (!v.currentOtpHash && v.otpHash && await verifyOTPHash(otp, v.otpHash)) {
                        vendor = v;
                        break;
                    }
                }
            }
        }

        if (vendor) {
            if (vendor.isRevoked) {
                return {
                    success: false,
                    error: `Your access to this session has been revoked.`,
                    errorType: 'REVOKED',
                };
            }

            if (vendor.status === 'completed') {
                return {
                    success: false,
                    error: 'This task has already been completed.',
                    errorType: 'DENIED',
                };
            }

            if (vendor.status === 'active' && vendor.activeSessionId) {
                if (isActiveSessionFresh(vendor.lastSeenAt)) {
                    // Live session on a DIFFERENT device/browser → deny
                    if (isSessionDeviceMismatch(vendor.activeDeviceHash, currentDeviceHash)) {
                        await prisma.auditLog.create({
                            data: {
                                action: 'DENIED',
                                linkId: secureLink.id,
                                reason: 'Active session device mismatch',
                                metadata: JSON.stringify({ type: 'device_mismatch', scope: 'active_session' }),
                            },
                        });

                        if (secureLink.notificationEmail) {
                            import('@/lib/notifications').then(({ notifyDeviceMismatch }) => {
                                notifyDeviceMismatch(secureLink.notificationEmail!, secureLink.id)
                                    .catch(() => { });
                            });
                        }

                        return {
                            success: false,
                            error: DEVICE_MISMATCH_ERROR,
                            errorType: 'DENIED',
                        };
                    }

                    // Same device (or unbound session): allow OTP to replace/refresh the
                    // active session so a closed tab / lost cookie does not soft-lock the vendor.
                }
            }

            // Login limit removed as requested by user
        } else if (secureLink.LinkAccess && secureLink.LinkAccess.length > 0) {
            if (!userEmail) {
                await prisma.auditLog.create({
                    data: {
                        action: 'DENIED',
                        linkId: secureLink.id,
                        reason: 'Unauthenticated access attempt to email-bound link',
                        metadata: JSON.stringify({ type: 'no_auth' }),
                    }
                });

                return {
                    success: false,
                    error: 'Authentication required. Please sign in with Google.',
                    errorType: 'DENIED',
                };
            }

            const isAllowed = secureLink.LinkAccess.some(
                access => access.vendorEmail.toLowerCase() === userEmail.toLowerCase()
            );

            if (!isAllowed) {
                await prisma.auditLog.create({
                    data: {
                        action: 'DENIED',
                        linkId: secureLink.id,
                        reason: 'Email mismatch - forwarded link attempt blocked',
                        metadata: JSON.stringify({
                            type: 'email_mismatch',
                            attemptedEmail: userEmail.substring(0, 3) + '***'
                        }),
                    }
                });

                // Alert the owner about forwarded link attempt
                if (secureLink.notificationEmail) {
                    import('@/lib/notifications').then(({ notifyForwardedLinkAttempt }) => {
                        notifyForwardedLinkAttempt(
                            secureLink.notificationEmail!,
                            secureLink.id,
                            secureLink.LinkAccess.map(a => a.vendorEmail).join(', ')
                        ).catch(() => { }); // Silent fail
                    });
                }

                return {
                    success: false,
                    error: `This link was created for a different recipient. Access denied.`,
                    errorType: 'EMAIL_MISMATCH',
                };
            }
        }

        // 4. SECURITY: Check if link is revoked in DB
        if (secureLink.isRevoked) {
            return {
                success: false,
                error: 'This link has been revoked by the owner.',
                errorType: 'REVOKED',
            };
        }

        const linkHasVendors =
            (secureLink.VendorAccess?.length ?? 0) > 0 ||
            (secureLink.LinkAccess?.length ?? 0) > 0;

        const perVendorHash =
            vendor?.currentOtpHash ||
            vendor?.otpHash ||
            vendorAccess?.otpHash ||
            null;

        const targetHash =
            perVendorHash ||
            (!linkHasVendors ? secureLink.otpHash : null);

        // SINGLE-USE OTP: consumed codes cannot re-auth. Resend / break rotation installs a fresh hash.
        if (linkHasVendors && !perVendorHash) {
            return {
                success: false,
                error:
                    'This code was already used or the link was opened on another device. Tap "Send a new code", then enter the latest OTP from your email.',
                errorType: 'USED',
            };
        }

        if (!targetHash || targetHash.startsWith('USED:')) {
            return {
                success: false,
                error:
                    'No active OTP for this link. Tap "Send a new code" to get a fresh code by email.',
                errorType: 'USED',
            };
        }

        const now = new Date();

        // NOTE: Permanent link-level device binding removed.
        // Device binding is enforced against the ACTIVE access session only
        // (see VendorAccess.activeDeviceHash / Redis session fingerprint above).

        // 5. Check link expiry
        if (secureLink.expiresAt < now) {
            return {
                success: false,
                error: 'This link has expired.',
                errorType: 'EXPIRED',
            };
        }

        // PERFORMANCE: otpFirstAttemptAt tracking moved into the success/failure
        // transaction below to eliminate a separate DB round-trip
        const needsFirstAttemptTracking = !otpFirstAttemptAt;

        // Break-Based OTP Rotation: Use currentOtpHash if available (only valid OTP after rotation)
        // Falls back to legacy otpHash for backward compatibility with pre-rotation vendors
        // targetHash computed above (per-vendor first; legacy open links use SecureLink.otpHash)

        // Check if the vendor's current OTP has expired (break-rotation expiry)
        if (vendor?.currentOtpExpiresAt && vendor.currentOtpExpiresAt < new Date()) {
            return {
                success: false,
                error: 'Your OTP has expired. Please request a new one.',
                errorType: 'EXPIRED',
            };
        }

        const isValidOTP = await verifyOTPHash(otp, targetHash);

        if (!isValidOTP) {
            // ZERO TRUST: 3 ATTEMPTS - Wrong OTP = Increment Failed Attempts
            // After 3 failed attempts, permanent revocation
            let attemptsRemaining = 0;
            await prisma.$transaction(async (tx) => {
                let shouldLock = false;

                if (vendorAccess) {
                    const updated = await tx.linkAccess.update({
                        where: { id: vendorAccess.id },
                        data: { failedAttempts: { increment: 1 } },
                    });
                    attemptsRemaining = 3 - updated.failedAttempts;
                    if (updated.failedAttempts >= 3) {
                        await tx.linkAccess.update({
                            where: { id: vendorAccess.id },
                            data: { lockedAt: new Date() },
                        });
                        shouldLock = true;
                    }
                } else if (vendor) {
                    const updated = await tx.vendorAccess.update({
                        where: { id: vendor.id },
                        data: { failedAttempts: { increment: 1 } },
                    });
                    attemptsRemaining = 3 - updated.failedAttempts;
                    if (updated.failedAttempts >= 3) {
                        await tx.vendorAccess.update({
                            where: { id: vendor.id },
                            data: { isRevoked: true },
                        });
                        shouldLock = true;
                    }
                } else {
                    const updated = await tx.secureLink.update({
                        where: { id: secureLink.id },
                        data: { failedAttempts: { increment: 1 } },
                    });
                    attemptsRemaining = 3 - updated.failedAttempts;
                    if (updated.failedAttempts >= 3) {
                        await tx.secureLink.update({
                            where: { id: secureLink.id },
                            data: {
                                lockedAt: new Date(),
                                isRevoked: true, // Immediate revocation for individual links
                            },
                        });
                        shouldLock = true;
                    }
                }

                await tx.auditLog.create({
                    data: {
                        action: shouldLock ? 'LOCKED' : 'DENIED',
                        linkId: secureLink.id,
                        ownerId: secureLink.ownerId,
                        reason: shouldLock ? 'Max OTP attempts reached: Locked' : 'Invalid OTP entered',
                    },
                });

                // Break-Based OTP Rotation: forensic audit for OTP failure
                await tx.auditLog.create({
                    data: {
                        action: 'OTP_LOGIN_FAILURE',
                        linkId: secureLink.id,
                        ownerId: secureLink.ownerId,
                        reason: 'OTP verification failed',
                        metadata: JSON.stringify({
                            attemptsRemaining: Math.max(0, attemptsRemaining),
                            wasLocked: shouldLock,
                        }),
                    },
                });
            });

            return {
                success: false,
                error: attemptsRemaining > 0
                    ? `Invalid OTP. You have ${attemptsRemaining} attempt${attemptsRemaining === 1 ? '' : 's'} remaining.`
                    : 'Invalid OTP. Maximum attempts reached.',
                errorType: 'INVALID_OTP',
            };
        }

        // Calculate remaining TTL for session
        const remainingMs = secureLink.expiresAt.getTime() - now.getTime();
        const ttlSeconds = Math.max(1, Math.floor(remainingMs / 1000));

        // 7. Enforce View Limit (Hybrid Architecture)
        const limitCheck = await incrementAndCheckLimit(
            secureLink.id,
            'view',
            secureLink.maxViews,
            secureLink.expiresAt
        );

        if (!limitCheck.allowed) {
            // Log the denied access due to limit
            await prisma.auditLog.create({
                data: {
                    action: 'DENIED',
                    linkId: secureLink.id,
                    reason: 'Maximum view limit reached',
                    metadata: JSON.stringify({ maxViews: secureLink.maxViews })
                }
            });
            return {
                success: false,
                error: limitCheck.error || 'Maximum view limit reached.',
                errorType: 'LIMIT_EXCEEDED',
            };
        }

        // Signed session cookie is authoritative; Redis cache is best-effort
        const { mintShareSession } = await import('@/lib/share-session');
        const minted = mintShareSession(token, ttlSeconds, vendor?.email || vendorEmail || userEmail || null);
        const sessionId = minted.sessionId;
        // Bind CURRENT recipient device to this access session (not the link creator).
        // replaceSessionId drops only this vendor's prior Redis session — other collaborators stay online.
        await tryCreateSession(
            token,
            sessionId,
            ttlSeconds,
            currentDeviceHash,
            vendor?.activeSessionId ?? null,
        );

        // Success: Mark link as used, bind device to ACTIVE session, create audit log
        // PERFORMANCE: otpFirstAttemptAt tracking merged into this transaction
        await prisma.$transaction(async (tx) => {
            // Do NOT permanently bind SecureLink/LinkAccess.deviceHash to a device.
            // Share links stay portable; only the active session is device-bound.
            const updateData: {
                isUsed: boolean;
                otpVerifiedAt: Date;
            } = {
                isUsed: true,
                otpVerifiedAt: now,
            };

            if (vendorAccess) {
                await tx.linkAccess.update({
                    where: { id: vendorAccess.id },
                    data: {
                        ...updateData,
                        otpHash: null, // single-use: consume per-vendor OTP
                        ...(needsFirstAttemptTracking ? { otpFirstAttemptAt: now } : {}),
                    },
                });
                // Owner dashboard + stream gates read SecureLink.isUsed / otpVerifiedAt
                await tx.secureLink.update({
                    where: { id: secureLink.id },
                    data: {
                        isUsed: true,
                        otpVerifiedAt: now,
                        ...(needsFirstAttemptTracking && !secureLink.otpFirstAttemptAt
                            ? { otpFirstAttemptAt: now }
                            : {}),
                    },
                });
            } else {
                await tx.secureLink.update({
                    where: { id: secureLink.id },
                    data: {
                        ...updateData,
                        // Rotate link OTP hash to a dead value so the code cannot be replayed
                        otpHash: `USED:${secureLink.id}:${now.getTime()}`,
                        ...(needsFirstAttemptTracking ? { otpFirstAttemptAt: now } : {}),
                    },
                });
            }

            if (vendor) {
                let totalBreakDuration = vendor.totalBreakDuration;
                if (vendor.status === 'break' && vendor.breakStartedAt) {
                    totalBreakDuration += Math.floor((now.getTime() - vendor.breakStartedAt.getTime()) / 1000);
                }

                // Consume OTP (single-use): clear hashes so the same code cannot re-auth
                await tx.otpHistory.updateMany({
                    where: { vendorAccessId: vendor.id, status: 'ACTIVE' },
                    data: {
                        status: 'INVALIDATED',
                        invalidatedAt: now,
                        reason: 'OTP_CONSUMED',
                    },
                });

                await tx.vendorAccess.update({
                    where: { id: vendor.id },
                    data: {
                        loginCount: vendor.status === 'break' ? vendor.loginCount : { increment: 1 },
                        status: 'active',
                        breakStartedAt: null,
                        totalBreakDuration,
                        activeSessionId: sessionId,
                        activeDeviceHash: currentDeviceHash,
                        lastLoginAt: now,
                        lastSeenAt: now,
                        currentOtpHash: null,
                        otpHash: null,
                    },
                });
            }

            await tx.auditLog.create({
                data: {
                    action: 'ACCESSED',
                    linkId: secureLink.id,
                    ownerId: secureLink.ownerId,
                    metadata: JSON.stringify({
                        ttlSeconds,
                        purpose: secureLink.purpose || undefined,
                        deviceBoundToSession: true,
                    }),
                },
            });

            // Break-Based OTP Rotation: forensic audit for OTP success
            await tx.auditLog.create({
                data: {
                    action: 'OTP_LOGIN_SUCCESS',
                    linkId: secureLink.id,
                    ownerId: secureLink.ownerId,
                    reason: 'OTP verification successful',
                    metadata: JSON.stringify({
                        isBreakResume: vendor?.status === 'break',
                        breaksUsed: vendor?.breaksUsed ?? 0,
                        allowedBreaks: vendor?.allowedBreaks ?? 0,
                        sessionDeviceBound: true,
                    }),
                },
            });
        });

        // V2.1: Send access notification if enabled
        // PERFORMANCE: Fire-and-forget — don't block the response for email delivery
        if (secureLink.notificationEmail) {
            notifyLinkAccessed(
                secureLink.notificationEmail,
                secureLink.id,
                secureLink.purpose || undefined
            ).catch((err) => console.error('Failed to send access notification:', err));
        }

        // Set signed session cookie (httpOnly). Redis cache is optional.
        const cookieStore = await cookies();
        cookieStore.set('session_id', minted.cookieValue, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: minted.maxAge,
            path: '/',
        });

        // Set email cookie to identify the specific vendor in the session.
        // SEC-3: The email is AES-256-GCM encrypted before storage to prevent
        // plaintext exposure in browser DevTools / extensions. The server decrypts
        // it on every request via decryptData() in linkAuthorization.ts.
        if (vendor) {
            const encryptedEmail = encryptData({ email: vendor.email });
            cookieStore.set('vendor_email', encryptedEmail, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict',
                maxAge: ttlSeconds,
                path: '/',
            });
        }

        return {
            success: true,
            accessGranted: true,
            // SECURITY: sessionId intentionally NOT returned in response body
            // It's already set as an httpOnly cookie — the only safe channel
        };
    } catch (error) {
        logger.error('Error verifying OTP', error);
        return {
            success: false,
            error: 'Verification failed. Please try again.',
        };
    }
}
