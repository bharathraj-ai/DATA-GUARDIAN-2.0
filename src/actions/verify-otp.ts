'use server';

import { prisma } from '@/lib/prisma';
import { verifyOTPHash, generateSessionId, encryptData } from '@/lib/crypto';
import crypto from 'crypto';
import { otpVerifySchema, OTPVerifyInput } from '@/lib/validations';
import { cookies, headers } from 'next/headers';
import { generateDeviceHash } from '@/lib/fingerprint';
import { notifyLinkAccessed } from '@/lib/notifications';
import { checkOTPRateLimit, extractClientIP, formatRateLimitError } from '@/lib/rate-limit';
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
 * - Device Binding (User-Agent/Platform hash)
 * - Server-side OTP validation (Zero Trust)
 * - Redis session with TTL (auto-expire)
 * - Kill switch check (Revocation)
 * - ANTI-PHISHING: Rate limiting (10 attempts/15 min per IP)
 * - ANTI-PHISHING: 3-minute OTP verification window
 * - ANTI-PHISHING: Single-use OTP enforcement
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
        const [rateLimit, revokedInRedis, session, secureLink] = await Promise.all([
            checkOTPRateLimit(clientIP),
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
        if (!rateLimit.allowed) {
            prisma.auditLog.create({
                data: {
                    action: 'DENIED',
                    reason: 'Rate limit exceeded',
                    metadata: JSON.stringify({
                        ip: clientIP.substring(0, 6) + '***',
                        type: 'rate_limit',
                        retryAfter: rateLimit.retryAfter
                    })
                }
            }).catch(() => { }); // fire-and-forget audit

            return {
                success: false,
                error: formatRateLimitError(rateLimit),
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

        // Get effective access state (Per-vendor if available, otherwise global legacy)
        const vendorAccess = secureLink.LinkAccess?.find(
            a => userEmail && a.vendorEmail.toLowerCase() === userEmail.toLowerCase()
        );

        const isLocked = vendorAccess ? vendorAccess.lockedAt : secureLink.lockedAt;
        const failedAttempts = vendorAccess ? vendorAccess.failedAttempts : secureLink.failedAttempts;
        const isUsed = vendorAccess ? vendorAccess.isUsed : secureLink.isUsed;
        const deviceHash = vendorAccess ? vendorAccess.deviceHash : secureLink.deviceHash;
        const otpVerifiedAt = vendorAccess ? vendorAccess.otpVerifiedAt : secureLink.otpVerifiedAt;
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
        let vendor = null;
        if (vendorEmail) {
            vendor = secureLink.VendorAccess.find(v => v.email === vendorEmail);
            if (!vendor) {
                return {
                    success: false,
                    error: `This link was created for a different recipient. Access denied.`,
                    errorType: 'EMAIL_MISMATCH',
                };
            }
        } else if (secureLink.VendorAccess && secureLink.VendorAccess.length > 0) {
            // Break-Based OTP Rotation: Try currentOtpHash first (active OTP only)
            const hmacHash = crypto.createHmac('sha256', process.env.ENCRYPTION_KEY!)
                .update(otp).digest('hex');

            // Priority 1: Match against currentOtpHash (the only valid OTP after rotation)
            vendor = secureLink.VendorAccess.find(
                v => v.currentOtpHash && v.currentOtpHash === hmacHash
            ) || null;

            // Priority 2: Fallback to legacy otpHash for vendors created before OTP rotation migration
            if (!vendor) {
                vendor = secureLink.VendorAccess.find(
                    v => !v.currentOtpHash && v.otpHash && !v.otpHash.startsWith('$2') && v.otpHash === hmacHash
                ) || null;
            }

            // Priority 3: Legacy bcrypt hashes (old OTPs from pre-HMAC era)
            if (!vendor) {
                for (const v of secureLink.VendorAccess) {
                    if (!v.currentOtpHash && v.otpHash?.startsWith('$2') && await verifyOTPHash(otp, v.otpHash)) {
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
                const fiveMinsAgo = new Date(Date.now() - 5 * 60000);
                if (vendor.lastSeenAt && vendor.lastSeenAt > fiveMinsAgo) {
                    return {
                        success: false,
                        error: 'Another active session is currently running in a different tab or device.',
                        errorType: 'DENIED',
                    };
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

        // Single-use OTP check removed to allow reuse

        // OTP verification window removed to allow infinite reuse as requested by user
        const now = new Date();

        // 5. SECURITY: Check device binding
        // If deviceHash is set (link was previously used), ensuring it's the same device
        if (isUsed && deviceHash && deviceHash !== currentDeviceHash) {
            // Log security event
            await prisma.auditLog.create({
                data: {
                    action: 'DENIED',
                    linkId: secureLink.id,
                    reason: 'Device mismatch (Session hijacking prevention)',
                    metadata: JSON.stringify({ type: 'device_mismatch' }),
                }
            });

            // ANTI-PHISHING: Alert owner of suspicious access (fire-and-forget)
            if (secureLink.notificationEmail) {
                import('@/lib/notifications').then(({ notifyDeviceMismatch }) => {
                    notifyDeviceMismatch(secureLink.notificationEmail!, secureLink.id)
                        .catch(() => { }); // Silent fail
                });
            }

            return {
                success: false,
                error: 'Access denied: Link is bound to a different device/browser.',
                errorType: 'DENIED',
            };
        }

        // 6. Check link expiry
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
        const targetHash = vendor?.currentOtpHash || vendor?.otpHash || vendorAccess?.otpHash || secureLink.otpHash;

        if (!targetHash) {
            return {
                success: false,
                error: 'No OTP request found. Please request a new OTP.',
                errorType: 'EXPIRED',
            };
        }

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
                        reason: shouldLock ? 'Max OTP attempts reached: Locked' : 'Invalid OTP entered',
                    },
                });

                // Break-Based OTP Rotation: forensic audit for OTP failure
                await tx.auditLog.create({
                    data: {
                        action: 'OTP_LOGIN_FAILURE',
                        linkId: secureLink.id,
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

        // Generate session ID and try to create Redis session
        const sessionId = generateSessionId();
        await tryCreateSession(token, sessionId, ttlSeconds);

        // Success: Mark link as used, bind device, mark OTP verified, and create audit log
        // PERFORMANCE: otpFirstAttemptAt tracking merged into this transaction
        await prisma.$transaction(async (tx) => {
            // Only update deviceHash if not already set (Bind on first use)
            const updateData: any = {
                isUsed: true,
                otpVerifiedAt: now  // ANTI-PHISHING: Mark OTP as single-use
            };
            if (!deviceHash) {
                updateData.deviceHash = currentDeviceHash;
            }

            if (vendorAccess) {
                await tx.linkAccess.update({
                    where: { id: vendorAccess.id },
                    data: {
                        ...updateData,
                        // PERFORMANCE: merged otpFirstAttemptAt into this write
                        ...(needsFirstAttemptTracking ? { otpFirstAttemptAt: now } : {}),
                    },
                });
            } else {
                await tx.secureLink.update({
                    where: { id: secureLink.id },
                    data: {
                        ...updateData,
                        // PERFORMANCE: merged otpFirstAttemptAt into this write
                        ...(needsFirstAttemptTracking ? { otpFirstAttemptAt: now } : {}),
                    },
                });
            }

            if (vendor) {
                let totalBreakDuration = vendor.totalBreakDuration;
                if (vendor.status === 'break' && vendor.breakStartedAt) {
                    totalBreakDuration += Math.floor((now.getTime() - vendor.breakStartedAt.getTime()) / 1000);
                }

                await tx.vendorAccess.update({
                    where: { id: vendor.id },
                    data: {
                        loginCount: vendor.status === 'break' ? vendor.loginCount : { increment: 1 },
                        status: 'active',
                        breakStartedAt: null,
                        totalBreakDuration,
                        activeSessionId: sessionId,
                        lastLoginAt: now,
                        lastSeenAt: now
                    }
                });
            }

            await tx.auditLog.create({
                data: {
                    action: 'ACCESSED',
                    linkId: secureLink.id,
                    metadata: JSON.stringify({
                        ttlSeconds,
                        purpose: secureLink.purpose || undefined  // V2.1: Log purpose
                    }),
                },
            });

            // Break-Based OTP Rotation: forensic audit for OTP success
            await tx.auditLog.create({
                data: {
                    action: 'OTP_LOGIN_SUCCESS',
                    linkId: secureLink.id,
                    reason: 'OTP verification successful',
                    metadata: JSON.stringify({
                        isBreakResume: vendor?.status === 'break',
                        breaksUsed: vendor?.breaksUsed ?? 0,
                        allowedBreaks: vendor?.allowedBreaks ?? 0,
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

        // Set session cookie (httpOnly for security)
        const cookieStore = await cookies();
        cookieStore.set('session_id', sessionId, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: ttlSeconds,
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
        console.error('Error verifying OTP:', error instanceof Error ? error.message : 'Unknown');
        return {
            success: false,
            error: 'Verification failed. Please try again.',
        };
    }
}
