'use server';

import { prisma } from '@/lib/prisma';
import { sendAccessNotification } from '@/lib/notifications';

// Cache Redis availability check at module load (performance optimization)
const isRedisConfigured = !!(
    process.env.UPSTASH_REDIS_REST_URL &&
    process.env.UPSTASH_REDIS_REST_TOKEN &&
    !process.env.UPSTASH_REDIS_REST_URL.includes('your-redis')
);

// Conditionally invalidate Redis session if configured
async function tryInvalidateSession(token: string): Promise<boolean> {
    if (!isRedisConfigured) return false;

    try {
        const { invalidateSession } = await import('@/lib/redis');
        await invalidateSession(token, true); // true = permanent revoke
        return true;
    } catch {
        return false;
    }
}

export type ScreenshotRevokeResult = {
    success: boolean;
    message?: string;
    error?: string;
};

/**
 * Revokes access due to a screenshot attempt.
 * 
 * This action:
 * 1. Immediately invalidates any active Redis session
 * 2. Marks the link as revoked in the database
 * 3. Creates an audit log entry for SCREENSHOT_ATTEMPT
 * 4. Notifies the owner if an email is configured
 */
export async function revokeOnScreenshot(token: string): Promise<ScreenshotRevokeResult> {
    try {
        // Find the secure link by share token
        const secureLink = await prisma.secureLink.findUnique({
            where: { token },
            select: {
                id: true,
                isRevoked: true,
                notificationEmail: true,
            },
        });

        if (!secureLink) {
            return {
                success: false,
                error: 'Link not found.',
            };
        }

        if (secureLink.isRevoked) {
            // Already revoked, no action needed
            return {
                success: true,
                message: 'Access was already revoked.',
            };
        }

        // KILL SWITCH: Invalidate Redis session IMMEDIATELY (parallel with DB update)
        const [redisRevoked] = await Promise.all([
            tryInvalidateSession(token),
            prisma.$transaction(async (tx) => {
                // Mark as revoked
                await tx.secureLink.update({
                    where: { id: secureLink.id },
                    data: { isRevoked: true },
                });

                // Create audit log for screenshot attempt
                await tx.auditLog.create({
                    data: {
                        action: 'SCREENSHOT_ATTEMPT',
                        linkId: secureLink.id,
                        reason: 'Access revoked due to screenshot attempt',
                    },
                });
            }),
        ]);

        // Notify the owner if email is configured
        if (secureLink.notificationEmail) {
            // Fire-and-forget notification (don't block the response)
            sendAccessNotification({
                email: secureLink.notificationEmail,
                event: 'REVOKED', // Using existing event type
                tokenId: secureLink.id,
                timestamp: new Date(),
                metadata: {
                    purpose: 'Screenshot attempt detected. Access permanently revoked.',
                },
            }).catch((err) => console.error('[NOTIFY] Failed to send screenshot alert:', err));
        }

        console.log(`[SECURITY] Link ${secureLink.id} revoked due to screenshot attempt | Redis: ${redisRevoked}`);

        return {
            success: true,
            message: 'Access has been revoked due to security violation.',
        };
    } catch (error) {
        console.error('Error revoking on screenshot:', error instanceof Error ? error.message : 'Unknown');
        return {
            success: false,
            error: 'Failed to revoke access.',
        };
    }
}
