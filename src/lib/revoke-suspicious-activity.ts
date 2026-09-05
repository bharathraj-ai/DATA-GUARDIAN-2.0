import { prisma } from '@/lib/prisma';
import { logger, redactEmail } from '@/lib/logger';
import { isRedisConfigured } from '@/lib/redis-helpers';
import { buildForensicWatermark } from '@/lib/security/forensic-watermark';

export const SUSPICIOUS_REVOKE_REASONS = ['screenshot', 'devtools', 'tab_switch', 'copy'] as const;
export type SuspiciousRevokeReason = (typeof SUSPICIOUS_REVOKE_REASONS)[number];

export function isAllowedSuspiciousReason(reason: unknown): reason is SuspiciousRevokeReason {
    return (
        typeof reason === 'string' &&
        (SUSPICIOUS_REVOKE_REASONS as readonly string[]).includes(reason)
    );
}

export type SuspiciousRevokeResult = {
    success: boolean;
    alreadyRevoked?: boolean;
    error?: string;
    notify?: {
        email: string;
        linkId: string;
        vendorEmail: string | null;
        reason: SuspiciousRevokeReason;
        forensicWatermark: string;
    };
    tokenToPurge?: string;
};

async function tryInvalidateSession(token: string): Promise<void> {
    if (!isRedisConfigured()) return;
    try {
        const { invalidateSession } = await import('@/lib/redis');
        await invalidateSession(token, true);
    } catch (err) {
        logger.warn(
            '[suspicious-revoke] Redis invalidate failed (DB revoke still applies)',
            err instanceof Error ? err.message : 'Unknown',
        );
    }
}

/**
 * Kill-switch when a vendor is caught attempting to capture protected content.
 * Access stops immediately (Redis + DB). Caller should notify the owner and
 * purge files after the HTTP response.
 */
export async function revokeForSuspiciousActivity(options: {
    token: string;
    reason: SuspiciousRevokeReason;
    vendorEmail: string | null;
    sessionId: string;
}): Promise<SuspiciousRevokeResult> {
    const { token, reason, vendorEmail, sessionId } = options;

    const secureLink = await prisma.secureLink.findUnique({
        where: { token },
        select: {
            id: true,
            token: true,
            ownerId: true,
            isRevoked: true,
            notificationEmail: true,
            purpose: true,
            User: { select: { email: true } },
        },
    });

    if (!secureLink) {
        return { success: false, error: 'not_found' };
    }

    if (secureLink.isRevoked) {
        await tryInvalidateSession(token);
        return { success: true, alreadyRevoked: true };
    }

    await tryInvalidateSession(token);

    const vendorNorm = (vendorEmail || '').trim().toLowerCase();

    const claimed = await prisma.$transaction(async (tx) => {
        const claimedRows = await tx.secureLink.updateMany({
            where: { id: secureLink.id, isRevoked: false },
            data: { isRevoked: true },
        });

        if (claimedRows.count === 0) {
            return false;
        }

        await tx.vendorAccess.updateMany({
            where: { secureLinkId: secureLink.id },
            data: {
                isRevoked: true,
                activeSessionId: null,
                activeDeviceHash: null,
                status: 'expired',
            },
        });

        await tx.auditLog.create({
            data: {
                action: 'SUSPICIOUS_ACTIVITY_REVOKE',
                linkId: secureLink.id,
                ownerId: secureLink.ownerId,
                reason:
                    'Vendor screenshot/capture attempt detected — access revoked and owner notified',
                metadata: JSON.stringify({
                    reason,
                    vendorEmail: vendorNorm ? redactEmail(vendorNorm) : null,
                    sessionId: sessionId.substring(0, 8) + '...',
                    forensicWatermark: buildForensicWatermark({
                        viewerEmail: vendorNorm || null,
                        token,
                        deviceHash: sessionId,
                    }).line,
                }),
            },
        });

        return true;
    });

    if (!claimed) {
        return { success: true, alreadyRevoked: true };
    }

    logger.info(
        `[suspicious-revoke] Link ${secureLink.id} revoked after ${reason} by ${redactEmail(vendorNorm)}`,
    );

    const { stampSendRecord } = await import('@/lib/send-record');
    await stampSendRecord({
        ownerId: secureLink.ownerId,
        purpose: secureLink.purpose,
        vendorEmail: vendorNorm || null,
        status: 'suspicious',
    });

    const notifyEmail = secureLink.notificationEmail || secureLink.User?.email || null;
    const forensicWatermark = buildForensicWatermark({
        viewerEmail: vendorNorm || null,
        token,
        deviceHash: sessionId,
    }).line;

    return {
        success: true,
        tokenToPurge: token,
        notify: notifyEmail
            ? {
                  email: notifyEmail,
                  linkId: secureLink.id,
                  vendorEmail: vendorNorm || null,
                  reason,
                  forensicWatermark,
              }
            : undefined,
    };
}
