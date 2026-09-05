import { cookies } from 'next/headers';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authorizeSecureLink } from '@/lib/linkAuthorization';
import { generateOTP, hashOTP } from '@/lib/crypto';
import { logger, redactEmail } from '@/lib/logger';
import { resolveLockActor } from '@/lib/collaboration/resolve-lock-actor';
import { releaseEditLock } from '@/lib/collaboration/edit-lock-service';
import { extractSessionId } from '@/lib/share-session';

const MAX_DRAFT_CHARS = 48_000;

export type SuddenExitPayload = {
    lastSavedWork?: unknown;
    resumePoint?: unknown;
    currentPage?: number;
    draftVersion?: number;
    fileId?: string;
    clientInstanceId?: string;
};

export type SuddenExitResult = {
    success: boolean;
    otpRotated?: boolean;
    lockReleased?: boolean;
    error?: string;
};

function slimDraft(draft: unknown): unknown {
    if (draft == null) return undefined;
    try {
        const raw = typeof draft === 'string' ? draft : JSON.stringify(draft);
        if (raw.length <= MAX_DRAFT_CHARS) {
            return typeof draft === 'string' ? draft : draft;
        }
        return { _truncated: true, bytes: raw.length };
    } catch {
        return undefined;
    }
}

async function releaseLockIfHeld(options: {
    fileId?: string;
    token: string;
    sessionId: string;
    effectiveEmail: string | null;
    isOwner: boolean;
    ownerId: string | null;
    vendors: Array<{ id?: string; email: string; level?: number }>;
    clientInstanceId?: string;
    linkId: string;
}): Promise<boolean> {
    if (!options.fileId) return false;
    const actor = resolveLockActor({
        sessionId: options.sessionId,
        effectiveEmail: options.effectiveEmail,
        isOwner: options.isOwner,
        token: options.token,
        ownerId: options.ownerId,
        vendors: options.vendors,
        clientInstanceId: options.clientInstanceId,
    });
    if (!actor) return false;
    try {
        const result = await releaseEditLock({
            documentId: options.fileId,
            linkId: options.linkId,
            actor,
        });
        return result.released;
    } catch (err) {
        logger.warn(
            '[sudden-exit] lock release failed',
            err instanceof Error ? err.message : 'Unknown',
        );
        return false;
    }
}

/**
 * Sudden browser/tab close: persist slim draft, release edit lock, rotate OTP, end session.
 * Does not consume the vendor break quota (that is only for explicit Take a break).
 */
export async function suddenBrowserExit(
    token: string,
    payload: SuddenExitPayload = {},
): Promise<SuddenExitResult> {
    try {
        const authResult = await authorizeSecureLink(token, 'view', undefined, { lite: true });
        if (!authResult.success) {
            return { success: false, error: authResult.error };
        }

        const { secureLink, sessionId, effectiveEmail, isOwner } = authResult.context;
        const vendorEmail = effectiveEmail?.toLowerCase().trim() || null;

        const lockReleased = await releaseLockIfHeld({
            fileId: payload.fileId,
            token: secureLink.token,
            sessionId,
            effectiveEmail,
            isOwner,
            ownerId: secureLink.ownerId,
            vendors: secureLink.VendorAccess,
            clientInstanceId: payload.clientInstanceId,
            linkId: secureLink.id,
        });

        if (isOwner || !vendorEmail) {
            return { success: true, otpRotated: false, lockReleased };
        }

        const vendorAccess = secureLink.VendorAccess.find(
            (v) => v.email.toLowerCase() === vendorEmail,
        );
        if (!vendorAccess || vendorAccess.isRevoked) {
            return { success: true, otpRotated: false, lockReleased };
        }
        if (vendorAccess.status === 'completed' || vendorAccess.status === 'expired') {
            return { success: true, otpRotated: false, lockReleased };
        }

        const now = new Date();
        const draft = slimDraft(payload.lastSavedWork);
        const draftVersion = vendorAccess.draftVersion ?? 1;
        const shouldSaveDraft =
            draft !== undefined &&
            (typeof payload.draftVersion !== 'number' || payload.draftVersion >= draftVersion);

        const newOtp = generateOTP();
        const newOtpHash = await hashOTP(newOtp);

        const claimed = await prisma.$transaction(async (tx) => {
            const updated = await tx.vendorAccess.updateMany({
                where: {
                    id: vendorAccess.id,
                    status: 'active',
                },
                data: {
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
                              lastSavedWork: draft as Prisma.InputJsonValue,
                              resumePoint: (payload.resumePoint ?? undefined) as Prisma.InputJsonValue | undefined,
                              currentPage: payload.currentPage,
                              draftVersion: { increment: 1 },
                              lastCommitAt: now,
                          }
                        : {
                              resumePoint: (payload.resumePoint ?? undefined) as Prisma.InputJsonValue | undefined,
                          }),
                },
            });

            if (updated.count === 0) {
                if (shouldSaveDraft || payload.resumePoint !== undefined) {
                    await tx.vendorAccess.updateMany({
                        where: { id: vendorAccess.id },
                        data: {
                            lastSeenAt: now,
                            ...(shouldSaveDraft ? { lastSavedWork: draft as Prisma.InputJsonValue } : {}),
                            ...(payload.resumePoint !== undefined
                                ? { resumePoint: payload.resumePoint as Prisma.InputJsonValue }
                                : {}),
                        },
                    });
                }
                return false;
            }

            await tx.linkAccess.updateMany({
                where: {
                    secureLinkId: secureLink.id,
                    vendorEmail: { equals: vendorEmail, mode: 'insensitive' },
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
                    reason: 'SUDDEN_EXIT',
                },
            });

            await tx.otpHistory.create({
                data: {
                    vendorAccessId: vendorAccess.id,
                    otpHash: newOtpHash,
                    reason: 'SUDDEN_EXIT',
                    status: 'ACTIVE',
                },
            });

            await tx.auditLog.create({
                data: {
                    action: 'SUDDEN_BROWSER_EXIT',
                    linkId: secureLink.id,
                    reason: 'Vendor closed browser or tab unexpectedly',
                    metadata: JSON.stringify({
                        vendorEmail: redactEmail(vendorEmail),
                        otpRotated: true,
                        sessionTerminated: true,
                        fileId: payload.fileId ?? null,
                    }),
                },
            });

            return true;
        });

        const cookieStore = await cookies();
        const endingSessionCookie = cookieStore.get('session_id')?.value;
        const endingSessionId = extractSessionId(endingSessionCookie) || sessionId;

        cookieStore.delete('session_id');
        cookieStore.delete('vendor_email');

        void (async () => {
            try {
                if (endingSessionId) {
                    const { tryInvalidateOneSession } = await import('@/lib/redis-helpers');
                    await tryInvalidateOneSession(token, endingSessionId);
                }
            } catch (err) {
                logger.warn(
                    '[sudden-exit] Redis session invalidation failed',
                    err instanceof Error ? err.message : 'Unknown',
                );
            }
        })();

        if (!claimed) {
            return { success: true, otpRotated: false, lockReleased };
        }

        try {
            const remainingMs = secureLink.expiresAt.getTime() - Date.now();
            const validityMinutes = Math.max(1, Math.min(10, Math.floor(remainingMs / 60000)));
            const { enqueueOtpEmails, processDueJobs } = await import('@/lib/jobs');
            await enqueueOtpEmails(
                [{ email: vendorEmail, otp: newOtp }],
                token,
                validityMinutes,
            );
            await processDueJobs(5);
        } catch (err) {
            logger.error(
                '[sudden-exit] Failed to send OTP email',
                err instanceof Error ? err.message : 'Unknown',
            );
        }

        return { success: true, otpRotated: true, lockReleased };
    } catch (error) {
        logger.error(
            '[sudden-exit]',
            error instanceof Error ? error.message : 'Unknown',
        );
        return { success: false, error: 'Failed to handle sudden exit' };
    }
}
