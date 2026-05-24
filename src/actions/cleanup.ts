'use server';

import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { executeCleanup, type CleanupResult } from '@/lib/cleanup-core';

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
            return { success: false, deletedLinks: 0, deletedUserData: 0, deletedFiles: 0, deletedAuditLogs: 0, deletedMongoFiles: 0, error: 'Authentication required' };
        }
        
        return await executeCleanup();
    } catch (error) {
        console.error('Action cleanup error:', error instanceof Error ? error.message : 'Unknown');
        return {
            success: false,
            deletedLinks: 0,
            deletedUserData: 0,
            deletedFiles: 0,
            deletedAuditLogs: 0,
            deletedMongoFiles: 0,
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
                },
                UserFile: {
                    select: {
                        id: true,
                        mongoFileId: true,
                        mongoFile: {
                            select: { id: true, gridFSId: true }
                        }
                    }
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

        // ═══════════════════════════════════════════════════════════════
        // STEP 1: Delete GridFS binary files from MongoDB (outside Prisma tx)
        // ═══════════════════════════════════════════════════════════════
        const mongoGridFSIds: string[] = [];
        for (const file of secureLink.UserFile) {
            if (file.mongoFile?.gridFSId) {
                mongoGridFSIds.push(file.mongoFile.gridFSId);
            }
        }

        if (mongoGridFSIds.length > 0) {
            try {
                const { deleteFromMongo } = await import('@/lib/mongo/operations');
                await Promise.allSettled(
                    mongoGridFSIds.map(id => deleteFromMongo(id))
                );
                console.log(`[CLEANUP] Deleted ${mongoGridFSIds.length} GridFS file(s)`);
            } catch (err) {
                console.error('[CLEANUP] GridFS deletion error (non-blocking):', err);
            }
        }

        // ═══════════════════════════════════════════════════════════════
        // STEP 2: Delete ALL database records in a transaction
        // ═══════════════════════════════════════════════════════════════
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

            // 1. Delete MongoFile metadata records (Prisma-managed)
            const mongoFileIds = secureLink.UserFile
                .map(f => f.mongoFileId)
                .filter((id): id is string => !!id);

            if (mongoFileIds.length > 0) {
                await tx.mongoFile.deleteMany({
                    where: { id: { in: mongoFileIds } },
                });
            }

            // 2. Delete chat messages
            await tx.chatMessage.deleteMany({
                where: { secureLinkId: secureLink.id },
            });

            // 3. Delete collaboration data for all files
            const fileIds = secureLink.UserFile.map(f => f.id);
            if (fileIds.length > 0) {
                await tx.documentSession.deleteMany({
                    where: { fileId: { in: fileIds } },
                });
                await tx.collabOperation.deleteMany({
                    where: { fileId: { in: fileIds } },
                });
                await tx.documentChatMessage.deleteMany({
                    where: { fileId: { in: fileIds } },
                });
            }

            // 4. Delete attached files (cascades FileVersion, Annotation)
            await tx.userFile.deleteMany({
                where: { secureLinkId: secureLink.id },
            });

            // 5. Delete the secure link (cascades VendorAccess, LinkAccess, ChatMessage)
            await tx.secureLink.deleteMany({
                where: { id: secureLink.id },
            });

            // 6. Delete encrypted user data
            await tx.userData.deleteMany({
                where: { id: secureLink.userId },
            });
        });

        console.log(`[CLEANUP] Single link fully purged: ${secureLink.id} (${secureLink.UserFile.length} files, ${mongoGridFSIds.length} GridFS objects)`);
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
