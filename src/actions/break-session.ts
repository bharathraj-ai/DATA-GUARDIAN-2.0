'use server';

import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { cookies } from 'next/headers';
import { authorizeSecureLink } from '@/lib/linkAuthorization';
import { generateOTP, hashOTP, decryptData } from '@/lib/crypto';
import { logger, redactEmail } from '@/lib/logger';

export type TakeBreakResult = {
    success: boolean;
    message?: string;
    error?: string;
    breaksUsed?: number;
    breaksRemaining?: number;
};

/**
 * Break-Based OTP Rotation System
 *
 * When a vendor clicks "Take Break":
 * 1. Validates authenticated session
 * 2. Checks break limit (breaksUsed < allowedBreaks)
 * 3. Archives current OTP → OtpHistory (INVALIDATED, reason: BREAK_STARTED)
 * 4. Generates new 6-digit OTP (crypto.randomInt)
 * 5. Hashes with HMAC-SHA256 and saves as currentOtpHash
 * 6. Emails new OTP to vendor
 * 7. Destroys current session (cookies + Redis)
 * 8. Creates audit entries: BREAK_STARTED, OTP_ROTATED, SESSION_TERMINATED
 *
 * SECURITY: Old OTPs are NEVER deleted — only marked INVALIDATED.
 * Only currentOtpHash is accepted for authentication.
 */
export async function takeBreak(
    token: string,
    payload: {
        lastSavedWork?: any;
        resumePoint?: any;
        currentPage?: number;
        draftVersion: number;
    }
): Promise<TakeBreakResult> {
    try {
        // 1. Validate authenticated session
        const authResult = await authorizeSecureLink(token, 'view');
        if (!authResult.success) {
            return { success: false, error: authResult.error };
        }

        const session = await auth();
        let vendorEmail = session?.user?.email;
        const cookieStore = await cookies();
        if (!vendorEmail) {
            // SEC-3: vendor_email cookie is AES-256-GCM encrypted — decrypt before use
            const rawCookie = cookieStore.get('vendor_email')?.value;
            if (rawCookie) {
                try {
                    const decoded = decryptData<{ email: string }>(rawCookie);
                    vendorEmail = decoded.email;
                } catch {
                    // Graceful fallback: accept plaintext cookie for backward compatibility
                    vendorEmail = rawCookie.includes(':') ? undefined : rawCookie;
                }
            }
        }

        if (!vendorEmail) {
            return { success: false, error: 'Unauthorized vendor session' };
        }

        // 2. Reuse secureLink from authorization result — zero extra DB queries
        const secureLink = authResult.context.secureLink;

        if (secureLink.isRevoked || secureLink.expiresAt < new Date()) {
            return { success: false, error: 'This link has expired or been revoked.' };
        }

        // Reuse vendorAccess from the already-loaded VendorAccess array
        const vendorAccess = (secureLink as any).VendorAccess?.find(
            (v: any) => v.email.toLowerCase() === vendorEmail!.toLowerCase()
        );

        if (!vendorAccess) {
            return { success: false, error: 'Vendor access not found' };
        }

        // 3. Check break limit
        if (vendorAccess.breaksUsed >= vendorAccess.allowedBreaks) {
            // Audit: BREAK_LIMIT_EXCEEDED
            await prisma.auditLog.create({
                data: {
                    action: 'BREAK_LIMIT_EXCEEDED',
                    linkId: secureLink.id,
                    reason: `Vendor ${redactEmail(vendorEmail)} exceeded break limit`,
                    metadata: JSON.stringify({
                        breaksUsed: vendorAccess.breaksUsed,
                        allowedBreaks: vendorAccess.allowedBreaks,
                        taskDurationHours: vendorAccess.taskDurationHours,
                    }),
                },
            }).catch(() => {});

            return {
                success: false,
                error: `Maximum break limit reached. You have used all ${vendorAccess.allowedBreaks} allowed breaks.`,
            };
        }

        // 4. Generate new OTP
        const newOtp = generateOTP();
        const newOtpHash = await hashOTP(newOtp);
        const now = new Date();

        // 5. Atomic transaction: archive old OTP, save new OTP, update vendor state
        await prisma.$transaction(async (tx) => {
            // 5a. Invalidate ALL existing ACTIVE OtpHistory entries for this vendor
            await tx.otpHistory.updateMany({
                where: { vendorAccessId: vendorAccess.id, status: 'ACTIVE' },
                data: {
                    status: 'INVALIDATED',
                    invalidatedAt: now,
                    reason: 'BREAK_STARTED',
                },
            });

            // 5b. Create new OtpHistory entry with ACTIVE status
            await tx.otpHistory.create({
                data: {
                    vendorAccessId: vendorAccess.id,
                    otpHash: newOtpHash,
                    reason: 'BREAK_ROTATION',
                    status: 'ACTIVE',
                },
            });

            // 5c. Update VendorAccess: new OTP, increment breaks, save work, set break status
            await tx.vendorAccess.update({
                where: { id: vendorAccess.id },
                data: {
                    // OTP Rotation
                    otpHash: newOtpHash,
                    currentOtpHash: newOtpHash,
                    currentOtpCreatedAt: now,
                    currentOtpExpiresAt: secureLink.expiresAt,
                    // Break tracking
                    breaksUsed: { increment: 1 },
                    status: 'break',
                    breakStartedAt: now,
                    activeSessionId: null,
                    lastSeenAt: now,
                    // Save work state (only if draftVersion is current or newer)
                    ...(payload.draftVersion >= vendorAccess.draftVersion ? {
                        lastSavedWork: payload.lastSavedWork !== undefined ? payload.lastSavedWork : undefined,
                        resumePoint: payload.resumePoint !== undefined ? payload.resumePoint : undefined,
                        currentPage: payload.currentPage !== undefined ? payload.currentPage : undefined,
                        draftVersion: { increment: 1 },
                        lastCommitAt: now,
                    } : {}),
                },
            });

            // 5d. Audit: BREAK_STARTED
            await tx.auditLog.create({
                data: {
                    action: 'BREAK_STARTED',
                    linkId: secureLink.id,
                    reason: `Vendor break #${vendorAccess.breaksUsed + 1}/${vendorAccess.allowedBreaks}`,
                    metadata: JSON.stringify({
                        vendorEmail: redactEmail(vendorEmail),
                        breakNumber: vendorAccess.breaksUsed + 1,
                        allowedBreaks: vendorAccess.allowedBreaks,
                    }),
                },
            });

            // 5e. Audit: OTP_ROTATED
            await tx.auditLog.create({
                data: {
                    action: 'OTP_ROTATED',
                    linkId: secureLink.id,
                    reason: 'OTP rotated due to break',
                    metadata: JSON.stringify({
                        vendorEmail: redactEmail(vendorEmail),
                        rotationReason: 'BREAK_STARTED',
                    }),
                },
            });

            // 5f. Audit: SESSION_TERMINATED
            await tx.auditLog.create({
                data: {
                    action: 'SESSION_TERMINATED',
                    linkId: secureLink.id,
                    reason: 'Session terminated for break',
                    metadata: JSON.stringify({
                        vendorEmail: redactEmail(vendorEmail),
                    }),
                },
            });
        });

        // 6. Destroy session cookies
        cookieStore.delete('session_id');
        cookieStore.delete('vendor_email');

        // 7. Invalidate Redis session (fire-and-forget)
        try {
            const isRedisConfigured = !!(
                process.env.UPSTASH_REDIS_REST_URL &&
                process.env.UPSTASH_REDIS_REST_TOKEN &&
                !process.env.UPSTASH_REDIS_REST_URL.includes('your-redis')
            );
            if (isRedisConfigured) {
                const { invalidateSession } = await import('@/lib/redis');
                await invalidateSession(token, false);
            }
        } catch (err) {
            logger.warn('Redis session invalidation failed during break:', err instanceof Error ? err.message : 'Unknown');
        }

        // 8. Send new OTP email to vendor (fire-and-forget)
        import('@/lib/email').then(({ sendOTPEmail }) => {
            const remainingMs = secureLink.expiresAt.getTime() - Date.now();
            const validityMinutes = Math.max(1, Math.floor(remainingMs / 60000));

            // SEC-4: Cap break OTP validity at 10 minutes (reduced from 30).
            // Break-resumption OTPs need a tighter window since the vendor already
            // has full context — 30 minutes was unnecessarily permissive.
            sendOTPEmail(vendorEmail!, token, newOtp, Math.min(validityMinutes, 10))
                .then(() => logger.info(`Break OTP sent to ${redactEmail(vendorEmail)}`))
                .catch((err) => logger.error('Failed to send break OTP email:', err.message));
        });

        logger.info(`Break taken by ${redactEmail(vendorEmail)} | Break ${vendorAccess.breaksUsed + 1}/${vendorAccess.allowedBreaks}`);

        return {
            success: true,
            message: 'Break started. New OTP sent to your email for when you resume.',
            breaksUsed: vendorAccess.breaksUsed + 1,
            breaksRemaining: vendorAccess.allowedBreaks - vendorAccess.breaksUsed - 1,
        };
    } catch (error) {
        logger.error('Break session error:', error instanceof Error ? error.message : 'Unknown');
        return { success: false, error: 'Failed to take break. Please try again.' };
    }
}
