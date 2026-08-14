'use server';

import { after } from 'next/server';
import { prisma } from '@/lib/prisma';
import { executeSingleLinkCleanup } from '@/lib/cleanup-core';
import { auth } from '@/lib/auth';
import { logger } from '@/lib/logger';

function runAfterResponse(work: () => Promise<void>) {
    try {
        after(work);
    } catch {
        void work();
    }
}

// Cache Redis availability check at module load (performance optimization)
const isRedisConfigured = !!(
    process.env.UPSTASH_REDIS_REST_URL &&
    process.env.UPSTASH_REDIS_REST_TOKEN &&
    !process.env.UPSTASH_REDIS_REST_URL.includes('your-redis')
);

// Conditionally invalidate Redis session if configured
async function tryInvalidateSession(token: string): Promise<{ success: boolean; latencyMs: number }> {
    if (!isRedisConfigured) return { success: false, latencyMs: 0 };

    const start = Date.now();
    try {
        const { invalidateSession } = await import('@/lib/redis');
        await invalidateSession(token, true); // true = permanent revoke
        return { success: true, latencyMs: Date.now() - start };
    } catch {
        return { success: false, latencyMs: Date.now() - start };
    }
}

export type RevokeAccessResult = {
    success: boolean;
    message?: string;
    error?: string;
};

/**
 * Revokes access to a secure link (Kill Switch) and permanently deletes all linked data.
 */
export async function revokeAccess(
    ownerToken: string,
    _deleteDataImmediately: boolean = true // kept for callers; purge always runs
): Promise<RevokeAccessResult> {
    try {
        const session = await auth();

        if (!session?.user?.id) {
            return {
                success: false,
                error: 'Authentication required. Please log in.',
            };
        }

        // Find the secure link by owner token
        const secureLink = await prisma.secureLink.findUnique({
            where: { ownerToken },
            select: {
                id: true,
                token: true,
                ownerId: true,
                isRevoked: true,
            },
        });

        if (!secureLink) {
            return {
                success: false,
                error: 'Invalid owner token. This link may not exist.',
            };
        }

        // Verify ownership (BOLA prevention)
        if (secureLink.ownerId !== session.user.id) {
            await prisma.auditLog.create({
                data: {
                    action: 'REVOKE_ACCESS_DENIED',
                    linkId: secureLink.id,
                    ownerId: secureLink.ownerId,
                    reason: 'Unauthorized user attempted to revoke link',
                    metadata: JSON.stringify({
                        attemptedBy: session.user.id,
                        actualOwner: secureLink.ownerId,
                    }),
                },
            }).catch((e) => logger.warn('Failed to log REVOKE_ACCESS_DENIED', e.message));

            return {
                success: false,
                error: 'Unauthorized: You do not have permission to revoke this link.',
            };
        }

        if (secureLink.isRevoked) {
            runAfterResponse(async () => {
                await executeSingleLinkCleanup(secureLink.token);
            });
            return {
                success: true,
                message: 'Access already revoked. Remaining data is being deleted.',
            };
        }

        // KILL SWITCH: Redis + DB revoke first (access stops now). Purge files after the response.
        const [redisResult] = await Promise.all([
            tryInvalidateSession(secureLink.token),
            prisma.$transaction(async (tx) => {
                await tx.secureLink.update({
                    where: { id: secureLink.id },
                    data: { isRevoked: true },
                });

                await tx.vendorAccess.updateMany({
                    where: { secureLinkId: secureLink.id },
                    data: {
                        activeSessionId: null,
                        activeDeviceHash: null,
                        isRevoked: true,
                    },
                });

                await tx.auditLog.create({
                    data: {
                        action: 'REVOKE_ACCESS_SUCCESS',
                        linkId: secureLink.id,
                        ownerId: session.user.id,
                        reason: 'Owner requested manual revocation — data purge follows',
                        metadata: JSON.stringify({
                            revokedBy: session.user.id,
                            dataDeleted: false,
                        }),
                    },
                });
            }),
        ]);

        logger.info(
            `[KILL SWITCH] Link ${secureLink.id} revoked by ${session.user.id} | Redis: ${
                redisResult.success ? `${redisResult.latencyMs}ms` : 'N/A'
            }`,
        );

        const tokenToPurge = secureLink.token;
        runAfterResponse(async () => {
            const cleanup = await executeSingleLinkCleanup(tokenToPurge);
            if (!cleanup.success) {
                logger.error(`[KILL SWITCH] Cleanup failed for ${secureLink.id}: ${cleanup.error}`);
            }
        });

        return {
            success: true,
            message: 'Access revoked. Shared data is being permanently deleted.',
        };
    } catch (error) {
        logger.error('Error revoking access:', error instanceof Error ? error.message : 'Unknown');
        return {
            success: false,
            error: 'Failed to revoke access. Please try again.',
        };
    }
}

/**
 * Gets the current status of a secure link for the owner.
 * Expired/revoked links trigger an immediate data purge.
 */
export async function getLinkStatus(ownerToken: string): Promise<{
    success: boolean;
    status?: {
        isUsed: boolean;
        isRevoked: boolean;
        isExpired: boolean;
        expiresAt: Date;
        createdAt: Date;
        dataDeleted?: boolean;
    };
    error?: string;
}> {
    try {
        const session = await auth();

        if (!session?.user?.id) {
            return {
                success: false,
                error: 'Authentication required. Please log in.',
            };
        }

        const secureLink = await prisma.secureLink.findUnique({
            where: { ownerToken },
            select: {
                id: true,
                token: true,
                ownerId: true,
                isUsed: true,
                isRevoked: true,
                expiresAt: true,
                createdAt: true,
                LinkAccess: {
                    select: { isUsed: true },
                },
            },
        });

        if (!secureLink) {
            return {
                success: false,
                error: 'Invalid owner token. This link may not exist (data may already be deleted).',
            };
        }

        if (secureLink.ownerId !== session.user.id) {
            await prisma.auditLog.create({
                data: {
                    action: 'GET_LINK_STATUS_DENIED',
                    linkId: secureLink.id,
                    ownerId: secureLink.ownerId,
                    reason: 'Unauthorized user attempted to view link status',
                    metadata: JSON.stringify({
                        attemptedBy: session.user.id,
                        actualOwner: secureLink.ownerId,
                    }),
                },
            }).catch((e) => logger.warn('Failed to log GET_LINK_STATUS_DENIED', e.message));

            return {
                success: false,
                error: 'Unauthorized: You do not have permission to view this link status.',
            };
        }

        const now = new Date();
        const isExpired = secureLink.expiresAt < now;
        const anyVendorUsed = secureLink.LinkAccess?.some((a) => a.isUsed) || false;

        if (secureLink.isRevoked || isExpired) {
            runAfterResponse(async () => {
                await executeSingleLinkCleanup(secureLink.token);
            });
        }

        return {
            success: true,
            status: {
                isUsed: secureLink.isUsed || anyVendorUsed,
                isRevoked: secureLink.isRevoked,
                isExpired,
                expiresAt: secureLink.expiresAt,
                createdAt: secureLink.createdAt,
                dataDeleted: false,
            },
        };
    } catch (error) {
        console.error('Error getting link status:', error instanceof Error ? error.message : 'Unknown');
        return {
            success: false,
            error: 'Failed to get link status.',
        };
    }
}
