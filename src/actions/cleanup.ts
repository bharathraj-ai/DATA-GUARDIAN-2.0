'use server';

import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { executeCleanup, executeSingleLinkCleanup, type CleanupResult } from '@/lib/cleanup-core';
import { requireOwnerRole } from '@/lib/security/roles';

/**
 * Bulk purge expired/revoked links. OWNER-only (DB role).
 * Cron jobs must use POST /api/cleanup with CRON_SECRET — not this action.
 * Scoped: only purges links owned by the caller (never global tenant wipe).
 */
export async function cleanupExpiredData(): Promise<CleanupResult> {
    try {
        const session = await auth();
        if (!session?.user?.id || !(await requireOwnerRole(session.user.id))) {
            return {
                success: false,
                deletedLinks: 0,
                deletedUserData: 0,
                deletedFiles: 0,
                deletedAuditLogs: 0,
                deletedMongoFiles: 0,
                deletedStaleStaging: 0,
                error: 'Forbidden',
            };
        }

        return await executeCleanup({ ownerId: session.user.id });
    } catch (error) {
        console.error('Action cleanup error:', error instanceof Error ? error.message : 'Unknown');
        return {
            success: false,
            deletedLinks: 0,
            deletedUserData: 0,
            deletedFiles: 0,
            deletedAuditLogs: 0,
            deletedMongoFiles: 0,
            deletedStaleStaging: 0,
            error: 'Cleanup failed',
        };
    }
}

/**
 * Owner-authenticated single-link purge.
 * Internal server code should call executeSingleLinkCleanup from cleanup-core instead.
 */
export async function cleanupSingleLink(token: string): Promise<{ success: boolean; error?: string }> {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, error: 'Authentication required' };
        }

        const secureLink = await prisma.secureLink.findUnique({
            where: { token },
            select: { ownerId: true, expiresAt: true, isRevoked: true },
        });

        if (!secureLink) {
            return { success: true };
        }

        if (secureLink.ownerId !== session.user.id) {
            return { success: false, error: 'Forbidden' };
        }

        const now = new Date();
        if (secureLink.expiresAt >= now && !secureLink.isRevoked) {
            return { success: false, error: 'Link is still active' };
        }

        return await executeSingleLinkCleanup(token);
    } catch (error) {
        console.error('Single link cleanup error:', error instanceof Error ? error.message : 'Unknown');
        return { success: false, error: 'Cleanup failed' };
    }
}

/**
 * Owner-scoped cleanup statistics (no global infra leak).
 */
export async function getCleanupStats(): Promise<{
    pendingCleanup: number;
    totalLinks: number;
    expiredLinks: number;
    revokedLinks: number;
    activeLinks: number;
}> {
    const empty = {
        pendingCleanup: 0,
        totalLinks: 0,
        expiredLinks: 0,
        revokedLinks: 0,
        activeLinks: 0,
    };

    const session = await auth();
    if (!session?.user?.id || !(await requireOwnerRole(session.user.id))) {
        return empty;
    }

    const now = new Date();
    const ownerId = session.user.id;

    const [total, expired, revoked, active] = await Promise.all([
        prisma.secureLink.count({ where: { ownerId } }),
        prisma.secureLink.count({ where: { ownerId, expiresAt: { lt: now } } }),
        prisma.secureLink.count({ where: { ownerId, isRevoked: true } }),
        prisma.secureLink.count({
            where: { ownerId, isRevoked: false, expiresAt: { gte: now } },
        }),
    ]);

    return {
        pendingCleanup: expired + revoked,
        totalLinks: total,
        expiredLinks: expired,
        revokedLinks: revoked,
        activeLinks: active,
    };
}
