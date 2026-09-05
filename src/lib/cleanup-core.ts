import { prisma } from '@/lib/prisma';

export type CleanupResult = {
    success: boolean;
    deletedLinks: number;
    deletedUserData: number;
    deletedFiles: number;
    deletedAuditLogs: number;
    deletedMongoFiles: number;
    deletedStaleStaging: number;
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
        FileVersion?: { storageKey: string | null }[];
    }[];
};

async function deleteGridFSFiles(gridFSIds: string[]) {
    if (gridFSIds.length === 0) return;
    try {
        const { deleteLiveObjects } = await import('@/lib/blob-store');
        await deleteLiveObjects(gridFSIds);
        console.log(`[CLEANUP] Batch: deleted ${gridFSIds.length} object-store file(s)`);
    } catch (err) {
        console.error('[CLEANUP] Batch object-store deletion error (non-blocking):', err);
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
                link.LinkAccess.map((a) => a.vendorEmail).filter(Boolean).join(', ') || null;

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
 * Ordered deletes without an interactive transaction.
 * Interactive txs default to 5s and fail on Neon under load; cleanup is idempotent
 * so a mid-batch failure can be retried on the next run.
 */
async function purgeLinkRows(ids: {
    linkIds: string[];
    fileIds: string[];
    mongoFileIds: string[];
    userDataIds: string[];
}) {
    await prisma.chatMessage.deleteMany({
        where: { secureLinkId: { in: ids.linkIds } },
    });

    if (ids.fileIds.length > 0) {
        await prisma.documentSession.deleteMany({
            where: { fileId: { in: ids.fileIds } },
        });
        await prisma.collabOperation.deleteMany({
            where: { fileId: { in: ids.fileIds } },
        });
        await prisma.documentChatMessage.deleteMany({
            where: { fileId: { in: ids.fileIds } },
        });
    }

    // UserFile references MongoFile — delete files before mongo metadata.
    const deletedFiles = await prisma.userFile.deleteMany({
        where: { secureLinkId: { in: ids.linkIds } },
    });

    if (ids.mongoFileIds.length > 0) {
        await prisma.mongoFile.deleteMany({
            where: { id: { in: ids.mongoFileIds } },
        });
    }

    const deletedLinks = await prisma.secureLink.deleteMany({
        where: { id: { in: ids.linkIds } },
    });

    const deletedUserData = await prisma.userData.deleteMany({
        where: { id: { in: ids.userDataIds } },
    });

    return {
        deletedLinks: deletedLinks.count,
        deletedUserData: deletedUserData.count,
        deletedFiles: deletedFiles.count,
    };
}

export async function executeCleanup(options?: { ownerId?: string }): Promise<CleanupResult> {
    try {
        try {
            const { processDueJobs } = await import('@/lib/jobs');
            await processDueJobs(25);
        } catch (err) {
            console.warn(
                '[CLEANUP] job drain skipped:',
                err instanceof Error ? err.message : err,
            );
        }

        const now = new Date();
        const ownerFilter = options?.ownerId ? { ownerId: options.ownerId } : {};

        let totalDeletedLinks = 0;
        let totalDeletedUserData = 0;
        let totalDeletedFiles = 0;
        let totalDeletedMongoFiles = 0;
        let totalDeletedStaleStaging = 0;
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
                            FileVersion: {
                                select: { storageKey: true },
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
            const versionKeys: string[] = [];
            for (const link of linksBatch) {
                for (const file of link.UserFile) {
                    if (file.mongoFile?.gridFSId) {
                        allGridFSIds.push(file.mongoFile.gridFSId);
                    }
                    for (const version of file.FileVersion ?? []) {
                        if (version.storageKey) versionKeys.push(version.storageKey);
                    }
                }
            }

            await deleteGridFSFiles(allGridFSIds);
            if (versionKeys.length > 0) {
                const { deleteCiphertexts, storageKeyForPointer } = await import('@/lib/blob-store');
                const live = new Set(
                    allGridFSIds.map((id) => storageKeyForPointer(id)).filter((k): k is string => Boolean(k)),
                );
                await deleteCiphertexts(versionKeys.filter((key) => !live.has(key)));
                totalDeletedMongoFiles += versionKeys.length;
            }
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

        // Global cron only — owner-scoped cleanup must not delete other users' staging uploads.
        if (!options?.ownerId) {
            try {
                const { reapStaleStagedFiles } = await import('@/lib/create-link-stage');
                totalDeletedStaleStaging = await reapStaleStagedFiles();
            } catch (err) {
                console.warn(
                    '[CLEANUP] staging reap skipped:',
                    err instanceof Error ? err.message : err,
                );
            }
        }

        if (totalDeletedLinks > 0 || totalDeletedStaleStaging > 0) {
            console.log(
                `[CLEANUP] Purged ${totalDeletedLinks} links, ` +
                `${totalDeletedUserData} encrypted records, ` +
                `${totalDeletedFiles} files, ` +
                `${totalDeletedMongoFiles} GridFS objects, ` +
                `${totalDeletedStaleStaging} stale staging uploads, ` +
                `${totalDeletedAuditLogs} audit logs`
            );
        }

        return {
            success: true,
            deletedLinks: totalDeletedLinks,
            deletedUserData: totalDeletedUserData,
            deletedFiles: totalDeletedFiles,
            deletedAuditLogs: totalDeletedAuditLogs,
            deletedMongoFiles: totalDeletedMongoFiles,
            deletedStaleStaging: totalDeletedStaleStaging,
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
            deletedStaleStaging: 0,
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
                        FileVersion: {
                            select: { storageKey: true },
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
        const versionKeys: string[] = [];
        for (const file of secureLink.UserFile) {
            if (file.mongoFile?.gridFSId) {
                mongoGridFSIds.push(file.mongoFile.gridFSId);
            }
            for (const version of file.FileVersion ?? []) {
                if (version.storageKey) versionKeys.push(version.storageKey);
            }
        }

        await deleteGridFSFiles(mongoGridFSIds);
        if (versionKeys.length > 0) {
            const { deleteCiphertexts, storageKeyForPointer } = await import('@/lib/blob-store');
            const live = new Set(
                mongoGridFSIds.map((id) => storageKeyForPointer(id)).filter((k): k is string => Boolean(k)),
            );
            await deleteCiphertexts(versionKeys.filter((key) => !live.has(key)));
        }
        await stampSurvivingRecords([secureLink], now);

        const mongoFileIds = secureLink.UserFile
            .map((f) => f.mongoFileId)
            .filter((id): id is string => !!id);

        await purgeLinkRows({
            linkIds: [secureLink.id],
            fileIds: secureLink.UserFile.map((f) => f.id),
            mongoFileIds,
            userDataIds: [secureLink.userId],
        });

        return { success: true };
    } catch (error) {
        console.error('Single link cleanup error:', error instanceof Error ? error.message : 'Unknown');
        return { success: false, error: 'Cleanup failed' };
    }
}
