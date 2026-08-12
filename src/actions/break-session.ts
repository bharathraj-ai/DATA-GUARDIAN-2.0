'use server';

import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { cookies } from 'next/headers';
import { authorizeSecureLink } from '@/lib/linkAuthorization';
import { generateOTP, hashOTP } from '@/lib/crypto';
import { logger, redactEmail } from '@/lib/logger';

export type TakeBreakResult = {
    success: boolean;
    message?: string;
    error?: string;
    breaksUsed?: number;
    breaksRemaining?: number;
};

/** Cap draft JSON size so break never blocks on megabyte payloads. */
const MAX_BREAK_DRAFT_CHARS = 48_000;

function slimDraft(draft: unknown): unknown {
    if (draft == null) return undefined;
    try {
        const raw = typeof draft === 'string' ? draft : JSON.stringify(draft);
        if (raw.length <= MAX_BREAK_DRAFT_CHARS) {
            return typeof draft === 'string' ? draft : draft;
        }
        // Too large — keep only a marker; autosave should already have persisted work
        return { _truncated: true, bytes: raw.length };
    } catch {
        return undefined;
    }
}

/**
 * Break-Based OTP Rotation — optimized hot path.
 * Does not decrypt documents. Draft save is optional/slim; prefer prior autosave.
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
        // Lite ACL: no UserFile list, no owner User join, no draft JSON blobs
        const authResult = await authorizeSecureLink(token, 'view', undefined, { lite: true });
        if (!authResult.success) {
            return { success: false, error: authResult.error };
        }

        const session = await auth();
        const vendorEmail =
            session?.user?.email || authResult.context.effectiveEmail || undefined;

        if (!vendorEmail) {
            return { success: false, error: 'Unauthorized vendor session' };
        }

        const secureLink = authResult.context.secureLink;

        if (secureLink.isRevoked || secureLink.expiresAt < new Date()) {
            return { success: false, error: 'This link has expired or been revoked.' };
        }

        const vendorAccess = secureLink.VendorAccess?.find(
            (v) => v.email.toLowerCase() === vendorEmail.toLowerCase()
        );

        if (!vendorAccess) {
            return { success: false, error: 'Vendor access not found' };
        }

        const breaksUsed = vendorAccess.breaksUsed ?? 0;
        const allowedBreaks = vendorAccess.allowedBreaks ?? 0;
        const draftVersion = vendorAccess.draftVersion ?? 1;

        if (breaksUsed >= allowedBreaks) {
            prisma.auditLog
                .create({
                    data: {
                        action: 'BREAK_LIMIT_EXCEEDED',
                        linkId: secureLink.id,
                        reason: `Vendor ${redactEmail(vendorEmail)} exceeded break limit`,
                        metadata: JSON.stringify({ breaksUsed, allowedBreaks }),
                    },
                })
                .catch(() => {});

            return {
                success: false,
                error: `Maximum break limit reached. You have used all ${allowedBreaks} allowed breaks.`,
            };
        }

        const newOtp = generateOTP();
        const newOtpHash = await hashOTP(newOtp);
        const now = new Date();
        const draft = slimDraft(payload.lastSavedWork);
        const shouldSaveDraft = payload.draftVersion >= draftVersion && draft !== undefined;

        try {
            await prisma.$transaction(async (tx) => {
                const claimed = await tx.vendorAccess.updateMany({
                    where: {
                        id: vendorAccess.id,
                        breaksUsed: { lt: allowedBreaks },
                        status: { in: ['active', 'break'] },
                    },
                    data: {
                        breaksUsed: { increment: 1 },
                        otpHash: newOtpHash,
                        currentOtpHash: newOtpHash,
                        currentOtpCreatedAt: now,
                        currentOtpExpiresAt: secureLink.expiresAt,
                        status: 'break',
                        breakStartedAt: now,
                        activeSessionId: null,
                        activeDeviceHash: null,
                        lastSeenAt: now,
                        ...(shouldSaveDraft
                            ? {
                                  lastSavedWork: draft as any,
                                  resumePoint: payload.resumePoint ?? undefined,
                                  currentPage: payload.currentPage,
                                  draftVersion: { increment: 1 },
                                  lastCommitAt: now,
                              }
                            : {
                                  resumePoint: payload.resumePoint ?? undefined,
                              }),
                    },
                });

                if (claimed.count === 0) {
                    throw new Error('BREAK_LIMIT');
                }

                // Allow the rotated OTP through the share gate (isUsed was set on prior unlock)
                await tx.linkAccess.updateMany({
                    where: {
                        secureLinkId: secureLink.id,
                        vendorEmail: { equals: vendorEmail.toLowerCase(), mode: 'insensitive' },
                    },
                    data: {
                        isUsed: false,
                        otpHash: newOtpHash,
                        failedAttempts: 0,
                        lockedAt: null,
                    },
                });

                await tx.otpHistory.updateMany({
                    where: { vendorAccessId: vendorAccess.id, status: 'ACTIVE' },
                    data: {
                        status: 'INVALIDATED',
                        invalidatedAt: now,
                        reason: 'BREAK_STARTED',
                    },
                });

                await tx.otpHistory.create({
                    data: {
                        vendorAccessId: vendorAccess.id,
                        otpHash: newOtpHash,
                        reason: 'BREAK_ROTATION',
                        status: 'ACTIVE',
                    },
                });

                await tx.auditLog.create({
                    data: {
                        action: 'BREAK_STARTED',
                        linkId: secureLink.id,
                        reason: `Vendor break #${breaksUsed + 1}/${allowedBreaks}`,
                        metadata: JSON.stringify({
                            vendorEmail: redactEmail(vendorEmail),
                            breakNumber: breaksUsed + 1,
                            otpRotated: true,
                            sessionTerminated: true,
                        }),
                    },
                });
            });
        } catch (e) {
            if (e instanceof Error && e.message === 'BREAK_LIMIT') {
                return {
                    success: false,
                    error: `Maximum break limit reached. You have used all ${allowedBreaks} allowed breaks.`,
                };
            }
            throw e;
        }

        const cookieStore = await cookies();
        cookieStore.delete('session_id');
        cookieStore.delete('vendor_email');

        // Redis invalidate — do not block redirect
        void (async () => {
            try {
                const configured = !!(
                    process.env.UPSTASH_REDIS_REST_URL &&
                    process.env.UPSTASH_REDIS_REST_TOKEN &&
                    !process.env.UPSTASH_REDIS_REST_URL.includes('your-redis')
                );
                if (configured) {
                    const { invalidateSession } = await import('@/lib/redis');
                    await invalidateSession(token, false);
                }
            } catch (err) {
                logger.warn(
                    'Redis session invalidation failed during break:',
                    err instanceof Error ? err.message : 'Unknown',
                );
            }
        })();

        // Email — must complete before response (Vercel freezes fire-and-forget work)
        try {
            const { sendOTPEmail, isEmailConfigured } = await import('@/lib/email');
            if (isEmailConfigured()) {
                const remainingMs = secureLink.expiresAt.getTime() - Date.now();
                const validityMinutes = Math.max(1, Math.floor(remainingMs / 60000));
                await sendOTPEmail(
                    vendorEmail,
                    token,
                    newOtp,
                    Math.min(validityMinutes, 10),
                );
                logger.info(`Break OTP sent to ${redactEmail(vendorEmail)}`);
            } else {
                logger.error('[EMAIL] Not configured — break OTP email not sent');
            }
        } catch (err) {
            logger.error(
                'Failed to send break OTP email:',
                err instanceof Error ? err.message : 'Unknown',
            );
        }

        return {
            success: true,
            message: 'Break started. New OTP sent to your email for when you resume.',
            breaksUsed: breaksUsed + 1,
            breaksRemaining: allowedBreaks - breaksUsed - 1,
        };
    } catch (error) {
        logger.error('Break session error:', error instanceof Error ? error.message : 'Unknown');
        return { success: false, error: 'Failed to take break. Please try again.' };
    }
}
