import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

export type CleanupResult = {
    success: boolean;
    deletedLinks: number;
    deletedUserData: number;
    deletedFiles: number;
    deletedAuditLogs: number;
    deletedMongoFiles: number;
    deletedOrphanFiles?: number;
    error?: string;
};

/** Keep batches small — Neon direct compute + cold starts blow long interactive txs. */
const BATCH_SIZE = 10;

type LinkCleanupRow = {
    id: string;
    userId: string;
    isRevoked: boolean;
    ownerId: string | null;
    purpose: string | null;
    LinkAccess: { vendorEmail: string }[];
    UserFile: {
        id: string;
        mongoFileId: string | null;
        mongoFile: { id: string; gridFSId: string } | null;
    }[];
};

async function deleteGridFSFiles(gridFSIds: string[]) {
    if (gridFSIds.length === 0) return;
    try {
        const { deleteFromMongo } = await import('@/lib/mongo/operations');
        const { getStorageProvider } = await import('@/lib/storage/storage-provider');
        const provider = getStorageProvider();
        await Promise.allSettled(
            gridFSIds.map(async (id) => {
                await deleteFromMongo(id).catch(() => {});
                await provider.delete(id).catch(() => {});
            })
        );
    } catch (err) {
        logger.error('[CLEANUP] Batch GridFS deletion error (non-blocking)', err);
    }
}

/**
 * SendRecord / AuditLog survive link deletion.
 * Runs outside any interactive transaction — Neon round-trips routinely exceed 5s.
 * Failures here must not block the purge.
 */
async function stampSurvivingRecords(links: LinkCleanupRow[], now: Date) {
    try {
        const auditByOwner = new Map<string, string[]>();

        for (const link of links) {
            if (!link.ownerId) continue;

            const status = link.isRevoked ? 'revoked' : 'expired';
            const vendorEmail =
                link.LinkAccess.length > 1
                    ? link.LinkAccess.map((a) => a.vendorEmail).join(', ')
                    : (link.LinkAccess[0]?.vendorEmail || null);

            try {
                const { stampSendRecord } = await import('@/lib/send-record');
                await stampSendRecord({
                    ownerId: link.ownerId,
                    purpose: link.purpose,
                    vendorEmail,
                    status,
                });
            } catch (err) {
                console.warn(
                    '[CLEANUP] sendRecord stamp skipped:',
                    err instanceof Error ? err.message : err,
                );
            }

            const ids = auditByOwner.get(link.ownerId) ?? [];
            ids.push(link.id);
            auditByOwner.set(link.ownerId, ids);
        }

        for (const [ownerId, linkIds] of auditByOwner) {
            try {
                await prisma.auditLog.updateMany({
                    where: { linkId: { in: linkIds }, ownerId: null },
                    data: { ownerId },
                });
            } catch (err) {
                console.warn(
                    '[CLEANUP] auditLog stamp skipped:',
                    err instanceof Error ? err.message : err,
                );
            }
        }
    } catch (err) {
        console.warn(
            '[CLEANUP] stampSurvivingRecords failed (non-blocking):',
            err instanceof Error ? err.message : err,
        );
    }
}

/**
 * Atomic, idempotent, and recoverable row purge (DL-02).
 *
 * Executes all deletions in a single batch transaction so that a database failure
 * rolls back completely, preventing partial deletion from leaving inconsistent
 * or orphaned records.
 *
 * Safe to retry repeatedly without data corruption.
 */
export async function purgeLinkRows(ids: {
    linkIds: string[];
    fileIds: string[];
    mongoFileIds: string[];
    userDataIds: string[];
}) {
    if (ids.linkIds.length === 0 && ids.userDataIds.length === 0) {
        return { deletedLinks: 0, deletedUserData: 0, deletedFiles: 0 };
    }

    // Atomic transaction ensures all operations succeed or all roll back
    const results = await prisma.$transaction([
        prisma.chatMessage.deleteMany({
            where: { secureLinkId: { in: ids.linkIds } },
        }),
        ...(ids.fileIds.length > 0 ? [
            prisma.documentSession.deleteMany({
                where: { fileId: { in: ids.fileIds } },
            }),
            prisma.collabOperation.deleteMany({
                where: { fileId: { in: ids.fileIds } },
            }),
            prisma.documentChatMessage.deleteMany({
                where: { fileId: { in: ids.fileIds } },
            }),
            prisma.annotation.deleteMany({
                where: { fileId: { in: ids.fileIds } },
            }),
            prisma.fileVersion.deleteMany({
                where: { fileId: { in: ids.fileIds } },
            }),
        ] : []),
        // UserFile references MongoFile — delete UserFile before MongoFile
        prisma.userFile.deleteMany({
            where: { secureLinkId: { in: ids.linkIds } },
        }),
        ...(ids.mongoFileIds.length > 0 ? [
            prisma.mongoFile.deleteMany({
                where: { id: { in: ids.mongoFileIds } },
            }),
        ] : []),
        prisma.secureLink.deleteMany({
            where: { id: { in: ids.linkIds } },
        }),
        prisma.userData.deleteMany({
            where: { id: { in: ids.userDataIds } },
        }),
    ]);

    const len = results.length;
    const deletedUserData = results[len - 1]?.count ?? 0;
    const deletedLinks = results[len - 2]?.count ?? 0;
    const userFileOffset = ids.mongoFileIds.length > 0 ? 4 : 3;
    const deletedFiles = results[len - userFileOffset]?.count ?? 0;

    return {
        deletedLinks,
        deletedUserData,
        deletedFiles,
    };
}

export async function executeCleanup(options?: { ownerId?: string }): Promise<CleanupResult> {
    try {
        const now = new Date();
        const ownerFilter = options?.ownerId ? { ownerId: options.ownerId } : {};

        let totalDeletedLinks = 0;
        let totalDeletedUserData = 0;
        let totalDeletedFiles = 0;
        let totalDeletedMongoFiles = 0;
        const totalDeletedAuditLogs = 0; // Audit logs are preserved

        let hasMore = true;

        while (hasMore) {
            const linksBatch = await prisma.secureLink.findMany({
                where: {
                    AND: [
                        ownerFilter,
                        {
                            OR: [
                                { expiresAt: { lt: now } },
                                { isRevoked: true },
                            ],
                        },
                        {
                            cleanupStatus: { not: 'CLEANUP_COMPLETED' },
                        },
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
                        },
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
                    expiresAt: true,
                    createdAt: true,
                },
                take: BATCH_SIZE,
            });

            if (linksBatch.length === 0) {
                hasMore = false;
                break;
            }

            const allGridFSIds: string[] = [];
            for (const link of linksBatch) {
                for (const file of link.UserFile) {
                    if (file.mongoFile?.gridFSId) {
                        allGridFSIds.push(file.mongoFile.gridFSId);
                    }
                }
            }

            await deleteGridFSFiles(allGridFSIds);
            totalDeletedMongoFiles += allGridFSIds.length;

            await stampSurvivingRecords(linksBatch, now);

            const userDataIds = linksBatch.map((link) => link.userId);
            const linkIds = linksBatch.map((link) => link.id);
            const allFileIds = linksBatch.flatMap((link) => link.UserFile.map((f) => f.id));
            const allMongoFileIds = linksBatch
                .flatMap((link) => link.UserFile.map((f) => f.mongoFileId))
                .filter((id): id is string => !!id);

            const result = await purgeLinkRows({
                linkIds,
                fileIds: allFileIds,
                mongoFileIds: allMongoFileIds,
                userDataIds,
            });

            totalDeletedLinks += result.deletedLinks;
            totalDeletedUserData += result.deletedUserData;
            totalDeletedFiles += result.deletedFiles;

            await new Promise((resolve) => setTimeout(resolve, 50));
        }

        // Self-healing recovery: remove any orphaned UserData records left by legacy partial failures
        try {
            const orphanedUserData = await prisma.userData.deleteMany({
                where: { SecureLink: null },
            });
            totalDeletedUserData += orphanedUserData.count;
        } catch {}

        // Automated Orphan File Detection & Cleanup (Reliability Hardening)
        let totalDeletedOrphanFiles = 0;
        try {
            const { cleanOrphanFiles } = await import('@/lib/storage/orphan-cleanup');
            const orphanResult = await cleanOrphanFiles();
            if (orphanResult.success) {
                totalDeletedOrphanFiles = orphanResult.deletedCount;
            }
        } catch (orphanErr) {
            logger.error('[CLEANUP] Orphan file cleanup error (non-blocking)', orphanErr);
        }

        if (totalDeletedLinks > 0 || totalDeletedOrphanFiles > 0) {
            console.log(
                `[CLEANUP] Purged ${totalDeletedLinks} links, ` +
                `${totalDeletedUserData} encrypted records, ` +
                `${totalDeletedFiles} files, ` +
                `${totalDeletedMongoFiles} GridFS objects, ` +
                `${totalDeletedAuditLogs} audit logs, ` +
                `${totalDeletedOrphanFiles} orphan files`
            );
        }

        return {
            success: true,
            deletedLinks: totalDeletedLinks,
            deletedUserData: totalDeletedUserData,
            deletedFiles: totalDeletedFiles,
            deletedAuditLogs: totalDeletedAuditLogs,
            deletedMongoFiles: totalDeletedMongoFiles,
            deletedOrphanFiles: totalDeletedOrphanFiles,
        };
    } catch (error) {
        logger.error('Cleanup error', error);
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
    let linkIdToUpdate: string | null = null;
    try {
        const secureLink = await prisma.secureLink.findUnique({
            where: { token },
            select: {
                id: true,
                userId: true,
                expiresAt: true,
                isRevoked: true,
                cleanupStatus: true,
                ownerId: true,
                purpose: true,
                LinkAccess: {
                    select: { vendorEmail: true },
                },
                UserFile: {
                    select: {
                        id: true,
                        mongoFileId: true,
                        storageFileId: true,
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

        linkIdToUpdate = secureLink.id;

        if (secureLink.cleanupStatus === 'CLEANUP_COMPLETED') {
            return { success: true };
        }

        const now = new Date();
        const isExpiredOrRevoked = secureLink.expiresAt < now || secureLink.isRevoked;

        if (!isExpiredOrRevoked) {
            return { success: false, error: 'Link is still active' };
        }

        // P5.1-02: Concurrency Lock & Lifecycle State Transition to CLEANUP_IN_PROGRESS
        const claimResult = await prisma.secureLink.updateMany({
            where: {
                id: secureLink.id,
                cleanupStatus: { in: ['CLEANUP_PENDING', 'REVOKED', 'ACTIVE', 'CLEANUP_FAILED'] },
            },
            data: {
                cleanupStatus: 'CLEANUP_IN_PROGRESS',
                cleanupStartedAt: now,
                cleanupRetries: { increment: 1 },
            },
        });

        if (claimResult.count === 0) {
            // Another worker claimed or completed cleanup concurrently
            return { success: true };
        }

        const mongoGridFSIds: string[] = [];
        for (const file of secureLink.UserFile) {
            if (file.mongoFile?.gridFSId) {
                mongoGridFSIds.push(file.mongoFile.gridFSId);
            }
            if ((file as any).storageFileId) {
                mongoGridFSIds.push((file as any).storageFileId);
            }
        }

        await deleteGridFSFiles(mongoGridFSIds);
        await stampSurvivingRecords([secureLink as any], now);

        const mongoFileIds = secureLink.UserFile
            .map((f) => f.mongoFileId)
            .filter((id): id is string => !!id);

        await purgeLinkRows({
            linkIds: [secureLink.id],
            fileIds: secureLink.UserFile.map((f) => f.id),
            mongoFileIds,
            userDataIds: [secureLink.userId],
        });

        // Lifecycle completion
        await prisma.secureLink.updateMany({
            where: { id: secureLink.id },
            data: {
                cleanupStatus: 'CLEANUP_COMPLETED',
                cleanedAt: new Date(),
            },
        }).catch(() => {});

        return { success: true };
    } catch (error) {
        logger.error('Single link cleanup error', error);
        if (linkIdToUpdate) {
            await prisma.secureLink.updateMany({
                where: { id: linkIdToUpdate },
                data: {
                    cleanupStatus: 'CLEANUP_FAILED',
                    cleanupError: error instanceof Error ? error.message : String(error),
                },
            }).catch(() => {});
        }
        return { success: false, error: 'Cleanup failed' };
    }
}
