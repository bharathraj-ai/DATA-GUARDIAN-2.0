import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { logEditLockAudit } from './edit-lock-audit';

export const PRIORITY_TAKEOVER_REASON = 'PRIORITY_TAKEOVER';

export interface TakeoverSnapshotResult {
    success: boolean;
    versionId?: string;
    versionNumber?: number;
    previousVersionId?: string | null;
    error?: string;
}

/**
 * Snapshot the current encrypted UserFile into FileVersion with reason PRIORITY_TAKEOVER.
 * Does not increment UserFile.version (content unchanged). Never stores plaintext.
 */
export async function snapshotForPriorityTakeover(options: {
    fileId: string;
    linkId: string;
    createdBy: string;
    actorSessionId?: string;
}): Promise<TakeoverSnapshotResult> {
    const { fileId, linkId, createdBy, actorSessionId } = options;

    try {
        const file = await prisma.userFile.findUnique({
            where: { id: fileId },
            select: {
                id: true,
                version: true,
                fileName: true,
                encryptedContent: true,
                iv: true,
                authTag: true,
                encryptedDek: true,
                fileSize: true,
                mongoFileId: true,
                mongoFile: {
                    select: { gridFSId: true, isDeleted: true },
                },
            },
        });

        if (!file) {
            return { success: false, error: 'File not found' };
        }

        const { buildVersionSnapshot, createFileVersionRow } = await import('@/lib/file-version-store');
        const snapshot = await buildVersionSnapshot(file, { moveLiveObject: false });

        if (!snapshot) {
            await logEditLockAudit('AUTO_SAVE_BEFORE_TAKEOVER', linkId, {
                actorUserId: createdBy,
                documentId: fileId,
                sessionId: actorSessionId,
                reason: PRIORITY_TAKEOVER_REASON,
                note: 'No ciphertext to snapshot; continuing takeover',
            });
            return { success: true, previousVersionId: null };
        }

        const [latest, agg] = await Promise.all([
            prisma.fileVersion.findFirst({
                where: { fileId },
                orderBy: { versionNumber: 'desc' },
                select: { id: true, versionNumber: true },
            }),
            prisma.fileVersion.aggregate({
                where: { fileId },
                _max: { versionNumber: true },
            }),
        ]);

        const nextNumber = Math.max(file.version, (agg._max.versionNumber ?? 0) + 1, (latest?.versionNumber ?? 0) + 1);

        const created = await createFileVersionRow({
            fileId,
            versionNumber: nextNumber,
            snapshot,
            changeType: PRIORITY_TAKEOVER_REASON,
            changeDescription: `Priority takeover checkpoint by ${createdBy}`,
            createdBy,
            reason: PRIORITY_TAKEOVER_REASON,
            previousVersionId: latest?.id ?? null,
        });

        await logEditLockAudit('DOCUMENT_VERSION_CREATED', linkId, {
            actorUserId: createdBy,
            documentId: fileId,
            sessionId: actorSessionId,
            reason: PRIORITY_TAKEOVER_REASON,
            versionId: created.id,
            versionNumber: created.versionNumber,
            previousVersionId: created.previousVersionId,
        });

        return {
            success: true,
            versionId: created.id,
            versionNumber: created.versionNumber,
            previousVersionId: created.previousVersionId,
        };
    } catch (err) {
        logger.error('PRIORITY_TAKEOVER snapshot failed', err);
        return {
            success: false,
            error: err instanceof Error ? err.message : 'Snapshot failed',
        };
    }
}

export async function touchUserFileLockedBy(fileId: string, lockedBy: string | null): Promise<void> {
    try {
        await prisma.userFile.update({
            where: { id: fileId },
            data: { lockedBy },
        });
    } catch (err) {
        logger.error('Failed to update UserFile.lockedBy (non-fatal)', err);
    }
}
