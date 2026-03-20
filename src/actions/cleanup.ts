'use server';

import { prisma } from '@/lib/prisma';

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
        const now = new Date();

        // Find all expired or revoked secure links
        const linksToClean = await prisma.secureLink.findMany({
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
                UserFile: { select: { id: true } },
            },
        });

        if (linksToClean.length === 0) {
            return {
                success: true,
                deletedLinks: 0,
                deletedUserData: 0,
                deletedFiles: 0,
                deletedAuditLogs: 0,
            };
        }

        const userDataIds = linksToClean.map(link => link.userId);
        const linkIds = linksToClean.map(link => link.id);

        // Delete EVERYTHING in a transaction (order matters for foreign keys)
        const result = await prisma.$transaction(async (tx) => {
            // 0. Update SendRecord statuses (these survive deletion)
            for (const link of linksToClean) {
                if (link.ownerId) {
                    const status = link.isRevoked ? 'revoked' : 'expired';
                    const isGroupShare = link.LinkAccess.length > 1;
                    const vendorEmailToMatch = isGroupShare 
                        ? `Group Share (${link.LinkAccess.length} members)`
                        : (link.LinkAccess[0]?.vendorEmail || null);

                    // Update matching SendRecords by owner + topic + vendor
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

            // 1. Delete audit logs first (they reference SecureLink)
            const deletedAuditLogs = await tx.auditLog.deleteMany({
                where: {
                    linkId: { in: linkIds },
                },
            });

            // 2. Delete attached files (they reference SecureLink)
            const deletedFiles = await tx.userFile.deleteMany({
                where: {
                    secureLinkId: { in: linkIds },
                },
            });

            // 3. Delete secure links (they reference UserData)
            const deletedLinks = await tx.secureLink.deleteMany({
                where: {
                    id: { in: linkIds },
                },
            });

            // 4. Delete encrypted user data (now safe, no references left)
            const deletedUserData = await tx.userData.deleteMany({
                where: {
                    id: { in: userDataIds },
                },
            });

            return {
                deletedLinks: deletedLinks.count,
                deletedUserData: deletedUserData.count,
                deletedFiles: deletedFiles.count,
                deletedAuditLogs: deletedAuditLogs.count,
            };
        });

        // SECURITY: Log only counts, never data content
        console.log(
            `[CLEANUP] Purged ${result.deletedLinks} links, ` +
            `${result.deletedUserData} encrypted records, ` +
            `${result.deletedFiles} files, ` +
            `${result.deletedAuditLogs} audit logs`
        );

        return {
            success: true,
            ...result,
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
            // 1. Delete audit logs
            await tx.auditLog.deleteMany({
                where: { linkId: secureLink.id },
            });

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
