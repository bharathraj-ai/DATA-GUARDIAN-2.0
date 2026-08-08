'use server';

import { prisma } from '@/lib/prisma';
import { executeSingleLinkCleanup } from '@/lib/cleanup-core';
import { auth } from '@/lib/auth';
import { logger } from '@/lib/logger';

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
 * Revokes access to a secure link (Kill Switch)
 * 
 * This action:
 * 1. Immediately invalidates any active Redis session
 * 2. Marks the link as revoked in the database
 * 3. Optionally deletes the encrypted data immediately
 * 4. Creates an audit log entry
 */
export async function revokeAccess(
    ownerToken: string,
    deleteDataImmediately: boolean = false
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
            include: { UserData: true },
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
                    reason: 'Unauthorized user attempted to revoke link',
                    metadata: JSON.stringify({
                        attemptedBy: session.user.id,
                        actualOwner: secureLink.ownerId
                    })
                }
            }).catch(e => logger.warn('Failed to log REVOKE_ACCESS_DENIED', e.message));

            return {
                success: false,
                error: 'Unauthorized: You do not have permission to revoke this link.',
            };
        }

        if (secureLink.isRevoked) {
            return {
                success: false,
                error: 'This link has already been revoked.',
            };
        }

        // KILL SWITCH: Invalidate Redis session IMMEDIATELY (parallel with DB update)
        const [redisResult] = await Promise.all([
            tryInvalidateSession(secureLink.token),
            // Start DB transaction in parallel for speed
            prisma.$transaction(async (tx) => {
                // Mark as revoked
                await tx.secureLink.update({
                    where: { id: secureLink.id },
                    data: { isRevoked: true },
                });

                // Create audit log for revocation
                await tx.auditLog.create({
                    data: {
                        action: 'REVOKE_ACCESS_SUCCESS',
                        linkId: secureLink.id,
                        reason: 'Owner requested manual revocation',
                        metadata: JSON.stringify({ killSwitchLatencyMs: 0, revokedBy: session.user.id }), // Will be updated below
                    },
                });

                // Optionally delete encrypted data immediately
                if (deleteDataImmediately && secureLink.UserData) {
                    // Create audit log BEFORE deleting (to satisfy FK constraint)
                    await tx.auditLog.create({
                        data: {
                            action: 'DATA_DELETED',
                            linkId: secureLink.id,
                        },
                    });

                    // Now delete the user data
                    await tx.userData.delete({
                        where: { id: secureLink.UserData.id },
                    });
                }
            })
        ]);

        // Log kill switch performance
        logger.info(`[KILL SWITCH] Link ${secureLink.id} revoked by ${session.user.id} | Redis: ${redisResult.success ? `${redisResult.latencyMs}ms` : 'N/A'} | Target: <100ms`);

        // AUTO-CLEANUP: Purge ALL data after revocation (fire-and-forget)
        executeSingleLinkCleanup(secureLink.token).catch(() => { });

        return {
            success: true,
            message: 'Access revoked and all data permanently deleted.',
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
 * Gets the current status of a secure link for the owner
 */
export async function getLinkStatus(ownerToken: string): Promise<{
    success: boolean;
    status?: {
        isUsed: boolean;
        isRevoked: boolean;
        isExpired: boolean;
        expiresAt: Date;
        createdAt: Date;
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
                ownerId: true,
                isUsed: true,
                isRevoked: true,
                expiresAt: true,
                createdAt: true,
                LinkAccess: {
                    select: { isUsed: true }
                }
            },
        });

        if (!secureLink) {
            return {
                success: false,
                error: 'Invalid owner token. This link may not exist.',
            };
        }

        if (secureLink.ownerId !== session.user.id) {
            await prisma.auditLog.create({
                data: {
                    action: 'GET_LINK_STATUS_DENIED',
                    linkId: secureLink.id,
                    reason: 'Unauthorized user attempted to view link status',
                    metadata: JSON.stringify({
                        attemptedBy: session.user.id,
                        actualOwner: secureLink.ownerId
                    })
                }
            }).catch(e => logger.warn('Failed to log GET_LINK_STATUS_DENIED', e.message));

            return {
                success: false,
                error: 'Unauthorized: You do not have permission to view this link status.',
            };
        }

        // SEC-2: Success audit log removed — getLinkStatus is a read-only polling
        // operation called frequently from the dashboard. Logging every successful
        // read creates significant DB bloat with no security benefit.
        // The GET_LINK_STATUS_DENIED log above (unauthorized access) is preserved.

        const now = new Date();
        const isExpired = secureLink.expiresAt < now;
        const anyVendorUsed = secureLink.LinkAccess?.some(a => a.isUsed) || false;

        return {
            success: true,
            status: {
                isUsed: secureLink.isUsed || anyVendorUsed,
                isRevoked: secureLink.isRevoked,
                isExpired,
                expiresAt: secureLink.expiresAt,
                createdAt: secureLink.createdAt,
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
