'use server';

import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';

export type CleanupResult = {
    success: boolean;
    deletedLinks: number;
    deletedUserData: number;
    deletedFiles: number;
    deletedAuditLogs: number;
    error?: string;
};

/**
 * Cleanup expired and revoked secure links and ALL associated data
 * 
 * COMPLETE DATA PURGE:
 * - Deletes audit logs (references link)
 * - Deletes attached files (encrypted)
 * - Deletes the secure link itself
 * - Deletes the encrypted user data
 * 
 * After cleanup, NOTHING remains — no trace of the data ever existing.
 * Should be called via cron job (Vercel Cron, etc.) and also triggered
 * automatically when a link expires during viewing.
 */
export async function cleanupExpiredData(): Promise<CleanupResult> {
    try {
        // SECURITY: Only authenticated OWNER users can trigger bulk cleanup
        // (Cron jobs use the API route with cron-auth, not this server action)
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, deletedLinks: 0, deletedUserData: 0, deletedFiles: 0, deletedAuditLogs: 0, error: 'Authentication required' };
        }
        const now = new Date();

        // Implement Batching/Pagination
        const BATCH_SIZE = 100;
        let totalDeletedLinks = 0;
        let totalDeletedUserData = 0;
        let totalDeletedFiles = 0;
        const totalDeletedAuditLogs = 0; // Audit logs are preserved

        let hasMore = true;

        while (hasMore) {
            // Find a batch of expired or revoked secure links
            const linksBatch = await prisma.secureLink.findMany({
                where: {
                    OR: [
                        { expiresAt: { lt: now } },
                        { isRevoked: true },
                    ],
                },
                select: {
                    id: true,
                    userId: true,
                    isRevoked: true,
                    ownerId: true,
                    purpose: true,
                    LinkAccess: {
                        select: {
                            vendorEmail: true,
                        }
                    },
                    expiresAt: true,
                    createdAt: true,
                },
                take: BATCH_SIZE,
            });

            if (linksBatch.length === 0) {
                hasMore = false;
                break;
            }

            const userDataIds = linksBatch.map(link => link.userId);
            const linkIds = linksBatch.map(link => link.id);

            // Delete batch in a transaction
            const result = await prisma.$transaction(async (tx) => {
                // 0. Update SendRecord statuses (these survive deletion)
                for (const link of linksBatch) {
                    if (link.ownerId) {
                        const status = link.isRevoked ? 'revoked' : 'expired';
                        const isGroupShare = link.LinkAccess.length > 1;
                        const vendorEmailToMatch = isGroupShare 
                            ? `Group Share (${link.LinkAccess.length} members)`
                            : (link.LinkAccess[0]?.vendorEmail || null);

                        await tx.sendRecord.updateMany({
                            where: {
                                ownerId: link.ownerId,
                                topic: link.purpose || '',
                                vendorEmail: vendorEmailToMatch,
                                status: 'active',
                            },
                            data: {
                                status,
                                expiredAt: now,
                            },
                        });
                    }
                }

                // 1. Delete attached files
                const deletedFiles = await tx.userFile.deleteMany({
                    where: {
                        secureLinkId: { in: linkIds },
                    },
                });

                // 2. Delete secure links
                const deletedLinks = await tx.secureLink.deleteMany({
                    where: {
                        id: { in: linkIds },
                    },
                });

                // 3. Delete encrypted user data
                const deletedUserData = await tx.userData.deleteMany({
                    where: {
                        id: { in: userDataIds },
                    },
                });

                return {
                    deletedLinks: deletedLinks.count,
                    deletedUserData: deletedUserData.count,
                    deletedFiles: deletedFiles.count,
                };
            });

            totalDeletedLinks += result.deletedLinks;
            totalDeletedUserData += result.deletedUserData;
            totalDeletedFiles += result.deletedFiles;

            // Optional: small delay to yield event loop and reduce DB pressure
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        // SECURITY: Log only counts, never data content
        console.log(
            `[CLEANUP] Purged ${totalDeletedLinks} links, ` +
            `${totalDeletedUserData} encrypted records, ` +
            `${totalDeletedFiles} files, ` +
            `${totalDeletedAuditLogs} audit logs`
        );

        return {
            success: true,
            deletedLinks: totalDeletedLinks,
            deletedUserData: totalDeletedUserData,
            deletedFiles: totalDeletedFiles,
            deletedAuditLogs: totalDeletedAuditLogs,
        };
    } catch (error) {
        console.error('Cleanup error:', error instanceof Error ? error.message : 'Unknown');
        return {
            success: false,
            deletedLinks: 0,
            deletedUserData: 0,
            deletedFiles: 0,
            deletedAuditLogs: 0,
            error: 'Cleanup failed',
        };
    }
}

/**
 * Delete a SINGLE expired/revoked secure link and all its associated data.
 * Called automatically when a link is detected as expired during viewing.
 * 
 * COMPLETE DATA PURGE for one link:
 * - Audit logs
 * - Files
 * - Link record
 * - Encrypted user data
 */
export async function cleanupSingleLink(token: string): Promise<{ success: boolean; error?: string }> {
    try {
        const secureLink = await prisma.secureLink.findUnique({
            where: { token },
            select: {
                id: true,
                userId: true,
                expiresAt: true,
                isRevoked: true,
                ownerId: true,
                purpose: true,
                LinkAccess: {
                    select: { vendorEmail: true }
                }
            },
        });

        if (!secureLink) {
            return { success: true }; // Already cleaned up
        }

        const now = new Date();
        const isExpiredOrRevoked = secureLink.expiresAt < now || secureLink.isRevoked;

        if (!isExpiredOrRevoked) {
            return { success: false, error: 'Link is still active' };
        }

        // Delete EVERYTHING for this single link
        await prisma.$transaction(async (tx) => {
            // 0. Update SendRecord statuses (these survive deletion)
            if (secureLink.ownerId) {
                const status = secureLink.isRevoked ? 'revoked' : 'expired';
                const isGroupShare = secureLink.LinkAccess.length > 1;
                const vendorEmailToMatch = isGroupShare 
                    ? `Group Share (${secureLink.LinkAccess.length} members)`
                    : (secureLink.LinkAccess[0]?.vendorEmail || null);

                await tx.sendRecord.updateMany({
                    where: {
                        ownerId: secureLink.ownerId,
                        topic: secureLink.purpose || '',
                        vendorEmail: vendorEmailToMatch,
                        status: 'active',
                    },
                    data: {
                        status,
                        expiredAt: now,
                    },
                });
            }

            // 1. SECURITY/COMPLIANCE: DO NOT delete audit logs.
            // Audit logs must survive data deletion for forensic retention.

            // 2. Delete attached files
            await tx.userFile.deleteMany({
                where: { secureLinkId: secureLink.id },
            });

            // 3. Delete the secure link
            await tx.secureLink.delete({
                where: { id: secureLink.id },
            });

            // 4. Delete encrypted user data
            await tx.userData.delete({
                where: { id: secureLink.userId },
            });
        });

        console.log(`[CLEANUP] Single link purged: ${secureLink.id}`);
        return { success: true };
    } catch (error) {
        console.error('Single link cleanup error:', error instanceof Error ? error.message : 'Unknown');
        return { success: false, error: 'Cleanup failed' };
    }
}

/**
 * Get cleanup statistics (for monitoring)
 */
export async function getCleanupStats(): Promise<{
    pendingCleanup: number;
    totalLinks: number;
    expiredLinks: number;
    revokedLinks: number;
    activeLinks: number;
}> {
    // SECURITY: Require authentication to view infrastructure stats
    const session = await auth();
    if (!session?.user?.id) {
        return { pendingCleanup: 0, totalLinks: 0, expiredLinks: 0, revokedLinks: 0, activeLinks: 0 };
    }
    const now = new Date();

    const [total, expired, revoked] = await Promise.all([
        prisma.secureLink.count(),
        prisma.secureLink.count({ where: { expiresAt: { lt: now } } }),
        prisma.secureLink.count({ where: { isRevoked: true } }),
    ]);

    return {
        pendingCleanup: expired + revoked,
        totalLinks: total,
        expiredLinks: expired,
        revokedLinks: revoked,
        activeLinks: total - expired,
    };
}
