'use server';

import { prisma } from '@/lib/prisma';
import { verifyOTPHash, generateSessionId } from '@/lib/crypto';
import { otpVerifySchema, OTPVerifyInput } from '@/lib/validations';
import { cookies, headers } from 'next/headers';
import { generateDeviceHash } from '@/lib/fingerprint';
import { notifyLinkAccessed } from '@/lib/notifications';
import { checkOTPRateLimit, extractClientIP, formatRateLimitError } from '@/lib/rate-limit';

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
    errorType?: 'EXPIRED' | 'USED' | 'INVALID_OTP' | 'NOT_FOUND' | 'VALIDATION_ERROR' | 'REVOKED' | 'LOCKED' | 'DENIED';
};

/**
 * Verifies OTP and creates an ephemeral Redis session
 * 
 * Security Features:
 * - Max 3 OTP attempts (Lockout enforcement)
 * - Device Binding (User-Agent/Platform hash)
 * - Server-side OTP validation (Zero Trust)
 * - Redis session with TTL (auto-expire)
 * - Kill switch check (Revocation)
 * - ANTI-PHISHING: Rate limiting (10 attempts/15 min per IP)
 * - ANTI-PHISHING: 5-minute OTP verification window
 * - ANTI-PHISHING: Single-use OTP enforcement
 */
export async function verifyOTP(input: OTPVerifyInput): Promise<VerifyOTPResult> {
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
                // Anti-Phishing fields
                otpFirstAttemptAt: true,
                otpVerifiedAt: true,
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

        // 1. SECURITY: Check if link is permanently locked
        if (secureLink.lockedAt) {
            return {
                success: false,
                error: 'This link has been permanently locked due to excessive failed attempts.',
                errorType: 'LOCKED',
            };
        }

        // 2. SECURITY: Check max attempts (Double check in case lockedAt wasn't set)
        if (secureLink.failedAttempts >= 3) {
            return {
                success: false,
                error: 'Maximum verification attempts exceeded. Link is locked.',
                errorType: 'LOCKED',
            };
        }

        // 3. SECURITY: Check if link is revoked in DB
        if (secureLink.isRevoked) {
            return {
                success: false,
                error: 'This link has been revoked by the owner.',
                errorType: 'REVOKED',
            };
        }

        // ANTI-PHISHING: Check if OTP was already verified (single-use enforcement)
        if (secureLink.otpVerifiedAt) {
            await prisma.auditLog.create({
                data: {
                    action: 'DENIED',
                    linkId: secureLink.id,
                    reason: 'OTP reuse attempt blocked',
                    metadata: JSON.stringify({
                        type: 'otp_reuse',
                        originalVerifyTime: secureLink.otpVerifiedAt.toISOString()
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
        if (secureLink.otpFirstAttemptAt) {
            const windowExpiry = new Date(
                secureLink.otpFirstAttemptAt.getTime() + OTP_VERIFY_WINDOW_MINUTES * 60 * 1000
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

        // 4. SECURITY: Check device binding
        // If deviceHash is set (link was previously used), ensuring it's the same device
        if (secureLink.isUsed && secureLink.deviceHash && secureLink.deviceHash !== currentDeviceHash) {
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

        // 5. Check link expiry
        if (secureLink.expiresAt < now) {
            return {
                success: false,
                error: 'This link has expired.',
                errorType: 'EXPIRED',
            };
        }

        // ANTI-PHISHING: Track first OTP attempt (start 5-min window)
        if (!secureLink.otpFirstAttemptAt) {
            await prisma.secureLink.update({
                where: { id: secureLink.id },
                data: { otpFirstAttemptAt: now }
            });
        }

        // Verify OTP (constant-time comparison via bcrypt)
        const isValidOTP = await verifyOTPHash(otp, secureLink.otpHash);

        if (!isValidOTP) {
            // Increment failed attempts
            const newAttempts = secureLink.failedAttempts + 1;
            const isLocked = newAttempts >= 3;

            await prisma.$transaction(async (tx) => {
                await tx.secureLink.update({
                    where: { id: secureLink.id },
                    data: {
                        failedAttempts: newAttempts,
                        lockedAt: isLocked ? new Date() : null,
                        isRevoked: isLocked ? true : secureLink.isRevoked, // Auto-revoke on lock
                    },
                });

                if (isLocked) {
                    await tx.auditLog.create({
                        data: {
                            action: 'LOCKED',
                            linkId: secureLink.id,
                            reason: 'Max 3 failed OTP attempts',
                        },
                    });
                }
            });

            if (isLocked) {
                // ANTI-PHISHING: Alert owner about link being locked (fire-and-forget)
                if (secureLink.notificationEmail) {
                    import('@/lib/notifications').then(({ notifyFailedAttempts }) => {
                        notifyFailedAttempts(secureLink.notificationEmail!, secureLink.id, newAttempts)
                            .catch(() => { }); // Silent fail
                    });
                }

                return {
                    success: false,
                    error: 'Maximum attempts exceeded. This link is now permanently locked.',
                    errorType: 'LOCKED',
                };
            }

            // ANTI-PHISHING: Alert owner on 2+ failed attempts (early warning)
            if (newAttempts >= 2 && secureLink.notificationEmail) {
                import('@/lib/notifications').then(({ notifyFailedAttempts }) => {
                    notifyFailedAttempts(secureLink.notificationEmail!, secureLink.id, newAttempts)
                        .catch(() => { }); // Silent fail
                });
            }

            const attemptsLeft = 3 - newAttempts;
            return {
                success: false,
                error: `Invalid OTP. ${attemptsLeft} attempt${attemptsLeft !== 1 ? 's' : ''} remaining.`,
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
            if (!secureLink.deviceHash) {
                updateData.deviceHash = currentDeviceHash;
            }

            await tx.secureLink.update({
                where: { id: secureLink.id },
                data: updateData,
            });

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
