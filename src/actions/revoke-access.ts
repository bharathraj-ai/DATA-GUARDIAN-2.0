'use server';

import { prisma } from '@/lib/prisma';

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
        // Find the secure link by owner token
        const secureLink = await prisma.secureLink.findUnique({
            where: { ownerToken },
            include: { userData: true },
        });

        if (!secureLink) {
            return {
                success: false,
                error: 'Invalid owner token. This link may not exist.',
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
                        action: 'REVOKED',
                        linkId: secureLink.id,
                        reason: 'Owner requested manual revocation',
                        metadata: JSON.stringify({ killSwitchLatencyMs: 0 }), // Will be updated below
                    },
                });

                // Optionally delete encrypted data immediately
                if (deleteDataImmediately && secureLink.userData) {
                    // Create audit log BEFORE deleting (to satisfy FK constraint)
                    await tx.auditLog.create({
                        data: {
                            action: 'DATA_DELETED',
                            linkId: secureLink.id,
                        },
                    });

                    // Now delete the user data
                    await tx.userData.delete({
                        where: { id: secureLink.userData.id },
                    });
                }
            })
        ]);

        // Log kill switch performance
        console.log(`[KILL SWITCH] Link ${secureLink.id} revoked | Redis: ${redisResult.success ? `${redisResult.latencyMs}ms` : 'N/A'} | Target: <100ms`);

        return {
            success: true,
            message: deleteDataImmediately
                ? 'Access revoked and data deleted immediately.'
                : 'Access revoked. Data will be deleted on cleanup.',
        };
    } catch (error) {
        console.error('Error revoking access:', error instanceof Error ? error.message : 'Unknown');
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
        const secureLink = await prisma.secureLink.findUnique({
            where: { ownerToken },
            select: {
                isUsed: true,
                isRevoked: true,
                expiresAt: true,
                createdAt: true,
            },
        });

        if (!secureLink) {
            return {
                success: false,
                error: 'Invalid owner token. This link may not exist.',
            };
        }

        const now = new Date();
        const isExpired = secureLink.expiresAt < now;

        return {
            success: true,
            status: {
                isUsed: secureLink.isUsed,
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
