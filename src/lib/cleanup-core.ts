import { prisma } from '@/lib/prisma';

export type CleanupResult = {
    success: boolean;
    deletedLinks: number;
    deletedUserData: number;
    deletedFiles: number;
    deletedAuditLogs: number;
    deletedMongoFiles: number;
    error?: string;
};

export async function executeCleanup(): Promise<CleanupResult> {
    try {
        const now = new Date();

        // Implement Batching/Pagination
        const BATCH_SIZE = 100;
        let totalDeletedLinks = 0;
        let totalDeletedUserData = 0;
        let totalDeletedFiles = 0;
        let totalDeletedMongoFiles = 0;
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
                    UserFile: {
                        select: {
                            id: true,
                            mongoFileId: true,
                            mongoFile: {
                                select: { id: true, gridFSId: true }
                            }
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

            // ═══════════════════════════════════════════════════════════
            // STEP 1: Delete GridFS binary files from MongoDB
            // ═══════════════════════════════════════════════════════════
            const allGridFSIds: string[] = [];
            for (const link of linksBatch) {
                for (const file of link.UserFile) {
                    if (file.mongoFile?.gridFSId) {
                        allGridFSIds.push(file.mongoFile.gridFSId);
                    }
                }
            }

            if (allGridFSIds.length > 0) {
                try {
                    const { deleteFromMongo } = await import('@/lib/mongo/operations');
                    await Promise.allSettled(
                        allGridFSIds.map(id => deleteFromMongo(id))
                    );
                    totalDeletedMongoFiles += allGridFSIds.length;
                    console.log(`[CLEANUP] Batch: deleted ${allGridFSIds.length} GridFS file(s)`);
                } catch (err) {
                    console.error('[CLEANUP] Batch GridFS deletion error (non-blocking):', err);
                }
            }

            // ═══════════════════════════════════════════════════════════
            // STEP 2: Delete all DB records in a transaction
            // ═══════════════════════════════════════════════════════════
            const userDataIds = linksBatch.map(link => link.userId);
            const linkIds = linksBatch.map(link => link.id);
            const allFileIds = linksBatch.flatMap(link => link.UserFile.map(f => f.id));
            const allMongoFileIds = linksBatch
                .flatMap(link => link.UserFile.map(f => f.mongoFileId))
                .filter((id): id is string => !!id);

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

                // 1. Delete MongoFile metadata records
                if (allMongoFileIds.length > 0) {
                    await tx.mongoFile.deleteMany({
                        where: { id: { in: allMongoFileIds } },
                    });
                }

                // 2. Delete chat messages
                await tx.chatMessage.deleteMany({
                    where: { secureLinkId: { in: linkIds } },
                });

                // 3. Delete collaboration data for all files
                if (allFileIds.length > 0) {
                    await tx.documentSession.deleteMany({
                        where: { fileId: { in: allFileIds } },
                    });
                    await tx.collabOperation.deleteMany({
                        where: { fileId: { in: allFileIds } },
                    });
                    await tx.documentChatMessage.deleteMany({
                        where: { fileId: { in: allFileIds } },
                    });
                }

                // 4. Delete attached files (cascades FileVersion, Annotation)
                const deletedFiles = await tx.userFile.deleteMany({
                    where: {
                        secureLinkId: { in: linkIds },
                    },
                });

                // 5. Delete secure links (cascades VendorAccess, LinkAccess)
                const deletedLinks = await tx.secureLink.deleteMany({
                    where: {
                        id: { in: linkIds },
                    },
                });

                // 6. Delete encrypted user data
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
            `${totalDeletedMongoFiles} GridFS objects, ` +
            `${totalDeletedAuditLogs} audit logs`
        );

        return {
            success: true,
            deletedLinks: totalDeletedLinks,
            deletedUserData: totalDeletedUserData,
            deletedFiles: totalDeletedFiles,
            deletedAuditLogs: totalDeletedAuditLogs,
            deletedMongoFiles: totalDeletedMongoFiles,
        };
    } catch (error) {
        console.error('Cleanup error:', error instanceof Error ? error.message : 'Unknown');
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
 * Purge a single expired/revoked link. Server-only — do NOT expose as an
 * unauthenticated Server Action. Callers must already have verified the link
 * is expired/revoked (or be an authorized owner/cron path).
 */
export async function executeSingleLinkCleanup(token: string): Promise<{ success: boolean; error?: string }> {
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
                    select: { vendorEmail: true },
                },
                UserFile: {
                    select: {
                        id: true,
                        mongoFileId: true,
                        mongoFile: {
                            select: { id: true, gridFSId: true },
                        },
                    },
                },
            },
        });

        if (!secureLink) {
            return { success: true };
        }

        const now = new Date();
        const isExpiredOrRevoked = secureLink.expiresAt < now || secureLink.isRevoked;

        if (!isExpiredOrRevoked) {
            return { success: false, error: 'Link is still active' };
        }

        const mongoGridFSIds: string[] = [];
        for (const file of secureLink.UserFile) {
            if (file.mongoFile?.gridFSId) {
                mongoGridFSIds.push(file.mongoFile.gridFSId);
            }
        }

        if (mongoGridFSIds.length > 0) {
            try {
                const { deleteFromMongo } = await import('@/lib/mongo/operations');
                await Promise.allSettled(mongoGridFSIds.map((id) => deleteFromMongo(id)));
            } catch (err) {
                console.error('[CLEANUP] GridFS deletion error (non-blocking):', err);
            }
        }

        await prisma.$transaction(async (tx) => {
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

            const mongoFileIds = secureLink.UserFile
                .map((f) => f.mongoFileId)
                .filter((id): id is string => !!id);

            if (mongoFileIds.length > 0) {
                await tx.mongoFile.deleteMany({
                    where: { id: { in: mongoFileIds } },
                });
            }

            await tx.chatMessage.deleteMany({
                where: { secureLinkId: secureLink.id },
            });

            const fileIds = secureLink.UserFile.map((f) => f.id);
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

            await tx.userFile.deleteMany({
                where: { secureLinkId: secureLink.id },
            });

            await tx.secureLink.deleteMany({
                where: { id: secureLink.id },
            });

            await tx.userData.deleteMany({
                where: { id: secureLink.userId },
            });
        });

        return { success: true };
    } catch (error) {
        console.error('Single link cleanup error:', error instanceof Error ? error.message : 'Unknown');
        return { success: false, error: 'Cleanup failed' };
    }
}
