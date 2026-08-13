'use server';

import { after } from 'next/server';
import { prisma } from '@/lib/prisma';
import { cookies } from 'next/headers';
import { authorizeSecureLink } from '@/lib/linkAuthorization';
import { generateOTP, hashOTP } from '@/lib/crypto';
import { logger, redactEmail } from '@/lib/logger';

export type TakeBreakResult = {
    success: boolean;
    message?: string;
    error?: string;
    errorType?: 'NO_BREAKS' | 'UNAUTHORIZED' | 'EXPIRED' | 'GENERIC';
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
        return { _truncated: true, bytes: raw.length };
    } catch {
        return undefined;
    }
}

function runAfterResponse(work: () => Promise<void>) {
    try {
        after(work);
    } catch {
        void work();
    }
}

/**
 * Break-Based OTP Rotation — optimized hot path.
 * Does not decrypt documents. Draft save is optional/slim; prefer prior autosave.
 * OTP email + Redis invalidation run after the response so the button is instant.
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
        const authResult = await authorizeSecureLink(token, 'view', undefined, { lite: true });
        if (!authResult.success) {
            return { success: false, error: authResult.error, errorType: 'UNAUTHORIZED' };
        }

        const vendorEmail = authResult.context.effectiveEmail || undefined;
        if (!vendorEmail) {
            return { success: false, error: 'Unauthorized vendor session', errorType: 'UNAUTHORIZED' };
        }

        const secureLink = authResult.context.secureLink;

        if (secureLink.isRevoked || secureLink.expiresAt < new Date()) {
            return { success: false, error: 'This link has expired or been revoked.', errorType: 'EXPIRED' };
        }

        const vendorAccess = secureLink.VendorAccess?.find(
            (v) => v.email.toLowerCase() === vendorEmail.toLowerCase()
        );

        if (!vendorAccess) {
            return { success: false, error: 'Vendor access not found', errorType: 'UNAUTHORIZED' };
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
                errorType: 'NO_BREAKS',
                error: "You don't have a break left for this session.",
                breaksUsed,
                breaksRemaining: 0,
            };
        }

        const newOtp = generateOTP();
        const newOtpHash = await hashOTP(newOtp);
        const now = new Date();
        const draft = slimDraft(payload.lastSavedWork);
        const shouldSaveDraft = payload.draftVersion >= draftVersion && draft !== undefined;
        const emailLower = vendorEmail.toLowerCase();

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

                await Promise.all([
                    tx.linkAccess.updateMany({
                        where: {
                            secureLinkId: secureLink.id,
                            vendorEmail: { equals: emailLower, mode: 'insensitive' },
                        },
                        data: {
                            isUsed: false,
                            otpHash: newOtpHash,
                            failedAttempts: 0,
                            lockedAt: null,
                        },
                    }),
                    tx.otpHistory.updateMany({
                        where: { vendorAccessId: vendorAccess.id, status: 'ACTIVE' },
                        data: {
                            status: 'INVALIDATED',
                            invalidatedAt: now,
                            reason: 'BREAK_STARTED',
                        },
                    }),
                    tx.auditLog.create({
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
                    }),
                ]);

                await tx.otpHistory.create({
                    data: {
                        vendorAccessId: vendorAccess.id,
                        otpHash: newOtpHash,
                        reason: 'BREAK_ROTATION',
                        status: 'ACTIVE',
                    },
                });
            });
        } catch (e) {
            if (e instanceof Error && e.message === 'BREAK_LIMIT') {
                return {
                    success: false,
                    errorType: 'NO_BREAKS',
                    error: "You don't have a break left for this session.",
                    breaksUsed,
                    breaksRemaining: 0,
                };
            }
            throw e;
        }

        const cookieStore = await cookies();
        const endingSessionCookie = cookieStore.get('session_id')?.value;
        const { extractSessionId } = await import('@/lib/share-session');
        const endingSessionId = extractSessionId(endingSessionCookie);

        cookieStore.delete('session_id');
        cookieStore.delete('vendor_email');

        const remainingMs = secureLink.expiresAt.getTime() - Date.now();
        const validityMinutes = Math.max(1, Math.min(10, Math.floor(remainingMs / 60000)));

        runAfterResponse(async () => {
            if (endingSessionId) {
                try {
                    const { tryInvalidateOneSession } = await import('@/lib/redis-helpers');
                    await tryInvalidateOneSession(token, endingSessionId);
                } catch (err) {
                    logger.warn(
                        'Redis session invalidation failed during break:',
                        err instanceof Error ? err.message : 'Unknown',
                    );
                }
            }

            try {
                const { sendOTPEmail, isEmailConfigured } = await import('@/lib/email');
                if (!isEmailConfigured()) {
                    logger.error('[EMAIL] Not configured — break OTP email not sent');
                    return;
                }
                await sendOTPEmail(vendorEmail, token, newOtp, validityMinutes);
                logger.info(`Break OTP sent to ${redactEmail(vendorEmail)}`);
            } catch (err) {
                logger.error(
                    'Failed to send break OTP email:',
                    err instanceof Error ? err.message : 'Unknown',
                );
            }
        });

        return {
            success: true,
            message: 'Break started. New OTP sent to your email for when you resume.',
            breaksUsed: breaksUsed + 1,
            breaksRemaining: allowedBreaks - breaksUsed - 1,
        };
    } catch (error) {
        logger.error('Break session error:', error instanceof Error ? error.message : 'Unknown');
        return { success: false, error: 'Failed to take break. Please try again.', errorType: 'GENERIC' };
    }
}
