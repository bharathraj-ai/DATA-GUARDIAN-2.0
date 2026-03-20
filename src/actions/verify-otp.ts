'use server';

import { prisma } from '@/lib/prisma';
import { verifyOTPHash, generateSessionId } from '@/lib/crypto';
import { otpVerifySchema, OTPVerifyInput } from '@/lib/validations';
import { cookies, headers } from 'next/headers';
import { generateDeviceHash } from '@/lib/fingerprint';
import { notifyLinkAccessed } from '@/lib/notifications';
import { checkOTPRateLimit, extractClientIP, formatRateLimitError } from '@/lib/rate-limit';
import { auth } from '@/lib/auth';

// Anti-Phishing Configuration
const OTP_VERIFY_WINDOW_MINUTES = 3;  // OTP valid for 3 minutes (reduced from 5 for tighter security)

// Cache Redis availability check at module load (performance optimization)
const isRedisConfigured = !!(
    process.env.UPSTASH_REDIS_REST_URL &&
    process.env.UPSTASH_REDIS_REST_TOKEN &&
    !process.env.UPSTASH_REDIS_REST_URL.includes('your-redis')
);

// Conditionally import Redis functions only if configured
async function tryCreateSession(token: string, sessionId: string, ttlSeconds: number): Promise<boolean> {
    if (!isRedisConfigured) return false;

    try {
        const { createSession } = await import('@/lib/redis');
        await createSession(token, sessionId, ttlSeconds);
        return true;
    } catch {
        return false;
    }
}

async function tryCheckRevoked(token: string): Promise<boolean | null> {
    if (!isRedisConfigured) return null;

    try {
        const { isTokenRevoked } = await import('@/lib/redis');
        return await isTokenRevoked(token);
    } catch {
        return null;
    }
}

export type VerifyOTPResult = {
    success: boolean;
    accessGranted?: boolean;
    sessionId?: string;
    error?: string;
    errorType?: 'EXPIRED' | 'USED' | 'INVALID_OTP' | 'NOT_FOUND' | 'VALIDATION_ERROR' | 'REVOKED' | 'LOCKED' | 'DENIED' | 'EMAIL_MISMATCH';
};

/**
 * Verifies OTP and creates an ephemeral Redis session
 * 
 * ZERO TRUST Security Features:
 * - Email Binding (allowedVendorEmail must match authenticated user)
 * - SINGLE-ATTEMPT OTP (wrong OTP = permanent link revocation)
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

        // ANTI-PHISHING: Rate limiting check
        const rateLimit = await checkOTPRateLimit(clientIP);
        if (!rateLimit.allowed) {
            await prisma.auditLog.create({
                data: {
                    action: 'DENIED',
                    reason: 'Rate limit exceeded',
                    metadata: JSON.stringify({
                        ip: clientIP.substring(0, 6) + '***',
                        type: 'rate_limit',
                        retryAfter: rateLimit.retryAfter
                    })
                }
            });

            return {
                success: false,
                error: formatRateLimitError(rateLimit),
                errorType: 'DENIED'
            };
        }

        // Check if token is revoked in Redis (if available)
        const revokedInRedis = await tryCheckRevoked(token);
        if (revokedInRedis === true) {
            return {
                success: false,
                error: 'This link has been revoked by the owner.',
                errorType: 'REVOKED',
            };
        }

        // ZERO TRUST: Verify authenticated user email
        const session = await auth();
        const userEmail = session?.user?.email;

        // Find the secure link (V2.1 + Anti-Phishing fields)
        const secureLink = await prisma.secureLink.findUnique({
            where: { token },
            select: {
                id: true,
                token: true,
                ownerToken: true,
                otpHash: true,
                expiresAt: true,
                isUsed: true,
                isRevoked: true,
                failedAttempts: true,
                lockedAt: true,
                deviceHash: true,
                userId: true,
                createdAt: true,
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
                VendorAccess: true,
            }
        });

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

        // 2. ZERO TRUST: Check max attempts (SINGLE ATTEMPT POLICY)
        if (failedAttempts >= 1) {
            return {
                success: false,
                error: 'This link has been permanently revoked due to an invalid OTP attempt.',
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
            if (vendor.isRevoked) {
                return {
                    success: false,
                    error: `Your access to this session has been revoked.`,
                    errorType: 'REVOKED',
                };
            }
            if (vendor.loginCount >= vendor.maxLogins) {
                return {
                    success: false,
                    error: `You have reached the maximum number of logins (${vendor.maxLogins}) for this session.`,
                    errorType: 'DENIED',
                };
            }
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

        // ANTI-PHISHING: Check if OTP was already verified (single-use enforcement)
        if ((!vendor && !vendorAccess && secureLink.otpVerifiedAt) || (vendorAccess && vendorAccess.otpVerifiedAt)) {
            await prisma.auditLog.create({
                data: {
                    action: 'DENIED',
                    linkId: secureLink.id,
                    reason: 'OTP reuse attempt blocked',
                    metadata: JSON.stringify({
                        type: 'otp_reuse',
                        originalVerifyTime: (vendorAccess?.otpVerifiedAt || secureLink.otpVerifiedAt)?.toISOString()
                    })
                }
            });

            return {
                success: false,
                error: 'This OTP has already been used. Please request a new secure link.',
                errorType: 'USED'
            };
        }

        // ANTI-PHISHING: 5-minute OTP verification window
        const now = new Date();
        if (otpFirstAttemptAt) {
            const windowExpiry = new Date(
                otpFirstAttemptAt.getTime() + OTP_VERIFY_WINDOW_MINUTES * 60 * 1000
            );
            if (now > windowExpiry) {
                await prisma.auditLog.create({
                    data: {
                        action: 'DENIED',
                        linkId: secureLink.id,
                        reason: 'OTP verification window expired',
                        metadata: JSON.stringify({
                            type: 'otp_window_expired',
                            windowMinutes: OTP_VERIFY_WINDOW_MINUTES
                        })
                    }
                });

                return {
                    success: false,
                    error: `OTP verification window expired (${OTP_VERIFY_WINDOW_MINUTES} minutes). Please request a new secure link.`,
                    errorType: 'EXPIRED'
                };
            }
        }

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

        // ANTI-PHISHING: Track first OTP attempt (start 5-min window)
        if (!otpFirstAttemptAt) {
            if (vendorAccess) {
                await prisma.linkAccess.update({
                    where: { id: vendorAccess.id },
                    data: { otpFirstAttemptAt: now }
                });
            } else if (!vendor) {
                await prisma.secureLink.update({
                    where: { id: secureLink.id },
                    data: { otpFirstAttemptAt: now }
                });
            }
        }

        // Verify OTP (constant-time comparison via bcrypt)
        const targetHash = vendor?.otpHash || vendorAccess?.otpHash || secureLink.otpHash;
        
        if (!targetHash) {
             return {
                 success: false,
                 error: 'No OTP request found. Please request a new OTP.',
                 errorType: 'EXPIRED',
             };
        }

        const isValidOTP = await verifyOTPHash(otp, targetHash);

        if (!isValidOTP) {
            // ZERO TRUST: SINGLE ATTEMPT - Wrong OTP = Permanent Revocation
            // This is the strictest security policy for enterprise-grade protection
            await prisma.$transaction(async (tx) => {
                if (vendorAccess) {
                    await tx.linkAccess.update({
                        where: { id: vendorAccess.id },
                        data: {
                            failedAttempts: 1,
                            lockedAt: new Date(),
                        },
                    });
                } else if (vendor) {
                    await tx.vendorAccess.update({
                        where: { id: vendor.id },
                        data: {
                            failedAttempts: { increment: 1 },
                        }
                    });
                    if (vendor.failedAttempts + 1 >= 3) {
                         await tx.vendorAccess.update({
                            where: { id: vendor.id },
                            data: { isRevoked: true },
                        });
                    }
                } else {
                    await tx.secureLink.update({
                        where: { id: secureLink.id },
                        data: {
                            failedAttempts: 1,
                            lockedAt: new Date(),
                            isRevoked: true, // Immediate revocation for individual links
                        },
                    });
                }

                await tx.auditLog.create({
                    data: {
                        action: 'LOCKED',
                        linkId: secureLink.id,
                        reason: 'Single-attempt OTP policy: Wrong OTP entered',
                    },
                });
            });

            return {
                success: false,
                error: 'Invalid OTP.',
                errorType: 'INVALID_OTP',
            };
        }

        // Calculate remaining TTL for session
        const remainingMs = secureLink.expiresAt.getTime() - now.getTime();
        const ttlSeconds = Math.max(1, Math.floor(remainingMs / 1000));

        // Generate session ID and try to create Redis session
        const sessionId = generateSessionId();
        await tryCreateSession(token, sessionId, ttlSeconds);

        // Success: Mark link as used, bind device, mark OTP verified, and create audit log
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
                    data: updateData,
                });
            } else {
                await tx.secureLink.update({
                    where: { id: secureLink.id },
                    data: updateData,
                });
            }

            if (vendor) {
                await tx.vendorAccess.update({
                    where: { id: vendor.id },
                    data: {
                        loginCount: { increment: 1 },
                        otpHash: null, // clear OTP
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
        });

        // V2.1: Send access notification if enabled
        if (secureLink.notificationEmail) {
            try {
                await notifyLinkAccessed(
                    secureLink.notificationEmail,
                    secureLink.id,
                    secureLink.purpose || undefined
                );
            } catch (notifError) {
                console.error('Failed to send access notification:', notifError);
                // Don't fail the whole operation if notification fails
            }
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

        // Set email cookie to identify the specific vendor in the session
        if (vendor) {
             cookieStore.set('vendor_email', vendor.email, {
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
            sessionId,
        };
    } catch (error) {
        console.error('Error verifying OTP:', error instanceof Error ? error.message : 'Unknown');
        return {
            success: false,
            error: 'Verification failed. Please try again.',
        };
    }
}
