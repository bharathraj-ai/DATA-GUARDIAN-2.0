'use server';

import { prisma } from '@/lib/prisma';
import { encryptBuffer, generateDek } from '@/lib/crypto';
import { authorizeSecureLink } from '@/lib/linkAuthorization';
import { validateMimeType, ALLOWED_EXTENSIONS } from '@/lib/security/file-validator';
import path from 'path';

export type UpdateFileResult = {
    success: boolean;
    error?: string;
    newVersion?: number;
    currentVersion?: number;
    conflict?: boolean;
};

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB

/**
 * Save draft edits. Ciphertext goes to object storage (GridFS) when Mongo is
 * configured; otherwise encrypted BYTEA is used as a local fallback.
 */
export async function updateFile(
    token: string,
    fileId: string,
    formData: FormData,
): Promise<UpdateFileResult> {
    try {
        // 1. Server-side authorization — all capability checks happen here
        const authResult = await authorizeSecureLink(token, 'edit', fileId);
        if (!authResult.success) {
            throw new Error(authResult.error);
        }

        // 2. Require expectedVersion (Optimistic Concurrency Control)
        const expectedVersionRaw = formData.get('expectedVersion');
        const expectedVersion = expectedVersionRaw ? parseInt(String(expectedVersionRaw), 10) : null;
        if (expectedVersion === null || Number.isNaN(expectedVersion)) {
            return { success: false, error: 'Missing or invalid expected version. Refresh and try again.' };
        }

        // 3. Extract and validate the uploaded file
        const file = formData.get('file');
        if (!file || typeof file !== 'object' || !('arrayBuffer' in file)) {
            return { success: false, error: 'No valid file provided.' };
        }
        const uploadedFile = file as File;
        if (uploadedFile.size === 0) return { success: false, error: 'File is empty.' };
        if (uploadedFile.size > MAX_FILE_SIZE) {
            return { success: false, error: `File exceeds 25 MB limit.` };
        }

        // 4. Validate file extension against allowlist
        const ext = path.extname(uploadedFile.name).toLowerCase();
        if (!ALLOWED_EXTENSIONS.has(ext)) {
            return { success: false, error: `File type "${ext}" is not allowed.` };
        }

        // 5. Read bytes and validate MIME via magic bytes (do NOT trust Content-Type header)
        const fileBuffer = Buffer.from(await uploadedFile.arrayBuffer());
        const mimeValidation = validateMimeType(fileBuffer, ext);
        if (!mimeValidation.valid) {
            return { success: false, error: mimeValidation.error };
        }
        const trustedMimeType = mimeValidation.mimeType!;

        // 6. Verify file ownership within this secure link
        const secureLink = authResult.context.secureLink;
        const { loadUserFileContentForLink } = await import('@/lib/security/resource-ownership');
        const fileRecord = await loadUserFileContentForLink(fileId, secureLink.id);

        if (!fileRecord) {
            return { success: false, error: 'File not found.' };
        }

        if ((fileRecord as any).editingLocked) {
            return { success: false, error: 'Editing is locked for this file.' };
        }

        // 6b. Distributed editing lock — Redis is source of truth (never trust client priority).
        const { resolveLockActor } = await import('@/lib/collaboration/resolve-lock-actor');
        const { assertActorHoldsEditLock, requestEditLock } = await import('@/lib/collaboration/edit-lock-service');
        const { logEditLockAudit } = await import('@/lib/collaboration/edit-lock-audit');

        const actor = resolveLockActor({
            sessionId: authResult.context.sessionId,
            effectiveEmail: authResult.context.effectiveEmail,
            level: authResult.context.isOwner ? 1 : (authResult.context.vendorAccess?.level ?? 2),
            isOwner: authResult.context.isOwner,
            token,
            ownerId: secureLink.ownerId,
            vendors: secureLink.VendorAccess,
            clientInstanceId: formData.get('editClientInstanceId')?.toString(),
        });
        if (!actor) {
            return { success: false, error: 'Identity required for editing.' };
        }

        let lockCheck = await assertActorHoldsEditLock({ documentId: fileId, actor });
        if (!lockCheck.ok && (lockCheck.reason === 'no_lock' || lockCheck.reason === 'lock_expired')) {
            const acquired = await requestEditLock({ documentId: fileId, linkId: secureLink.id, actor });
            if (acquired.status === 'acquired' || acquired.status === 'already_holder') {
                lockCheck = { ok: true, lock: acquired.lock };
            }
        }
        if (!lockCheck.ok) {
            await logEditLockAudit('STALE_SESSION_WRITE_DENIED', secureLink.id, {
                actorUserId: actor.userId,
                targetUserId: lockCheck.lock?.userId,
                documentId: fileId,
                teamId: actor.teamId,
                previousPriority: lockCheck.lock?.priority,
                requesterPriority: actor.priority,
                sessionId: actor.sessionId,
                reason: lockCheck.reason,
            });
            const message =
                lockCheck.reason === 'not_holder'
                    ? 'Your editing session is no longer active. A higher-priority collaborator may have taken control.'
                    : lockCheck.reason === 'lock_unavailable'
                        ? 'Editing lock service unavailable. Try again shortly.'
                        : 'You do not hold the editing lock for this document.';
            return { success: false, error: message };
        }

        // 7. Snapshot current ciphertext into object storage (not Postgres BYTEA)
        const {
            buildVersionSnapshot,
            createFileVersionRow,
            uploadDraftBlob,
            trimOldFileVersions,
        } = await import('@/lib/file-version-store');
        try {
            const snapshot = await buildVersionSnapshot(fileRecord as never, { moveLiveObject: true });
            if (snapshot) {
                await createFileVersionRow({
                    fileId: fileRecord.id,
                    versionNumber: fileRecord.version,
                    snapshot,
                    changeType: 'annotation',
                    changeDescription: `Snapshot before update from version ${fileRecord.version}`,
                });
            }
        } catch (err: unknown) {
            const code = typeof err === 'object' && err !== null && 'code' in err ? (err as { code?: string }).code : '';
            if (code !== 'P2002') throw err;
        }

        // 8. Encrypt new content with fresh DEK (per-file key rotation on every save)
        const dek = generateDek();
        const { iv, authTag, encryptedContent } = encryptBuffer(fileBuffer, dek);
        const { wrapDekForLink } = await import('@/lib/security/kms');
        const encryptedDek = await wrapDekForLink(dek, secureLink.id);
        const newETag = crypto.randomUUID();
        const draftBlob = await uploadDraftBlob({
            fileName: fileRecord.fileName,
            mimeType: trustedMimeType,
            fileExtension: ext,
            ciphertext: encryptedContent,
        });
        let mongoFileId = fileRecord.mongoFileId ?? null;
        if (draftBlob && !mongoFileId) {
            const created = await prisma.mongoFile.create({
                data: {
                    gridFSId: draftBlob.gridFSId,
                    originalFileName: fileRecord.fileName,
                    mimeType: trustedMimeType,
                    fileExtension: ext.replace(/^\./, '') || 'bin',
                    fileSize: uploadedFile.size,
                    checksum: draftBlob.checksum,
                    folder: 'file-drafts',
                    uploadedBy: actor.userId,
                    classification: 'RESTRICTED',
                    scanStatus: 'pending',
                },
                select: { id: true },
            });
            mongoFileId = created.id;
        }

        // 9. Atomic update with OCC.
        // Redis edit lock is the writer gate. Client expectedVersion can lag behind
        // our own autosave / access-request snapshot — use the server version, then
        // retry once if a concurrent save from this same holder raced us.
        const persist = async (occVersion: number) =>
            prisma.userFile.updateMany({
                where: { id: fileId, version: occVersion },
                data: {
                    fileName: fileRecord.fileName, // Preserve original filename — do not trust client
                    fileType: trustedMimeType,
                    fileSize: uploadedFile.size,
                    encryptedContent: draftBlob ? null : encryptedContent,
                    iv,
                    authTag,
                    encryptedDek,
                    eTag: newETag,
                    version: { increment: 1 },
                    ...(mongoFileId ? { mongoFileId } : {}),
                },
            });

        let matchedVersion = fileRecord.version;
        let result = await persist(matchedVersion);

        if (result.count === 0) {
            const stillHeld = await assertActorHoldsEditLock({ documentId: fileId, actor });
            if (!stillHeld.ok) {
                return {
                    success: false,
                    error: stillHeld.reason === 'not_holder'
                        ? 'Your editing session is no longer active. A higher-priority collaborator may have taken control.'
                        : 'You do not hold the editing lock for this document.',
                };
            }
            const fresh = await prisma.userFile.findUnique({
                where: { id: fileId },
                select: { version: true },
            });
            if (fresh && fresh.version !== matchedVersion) {
                matchedVersion = fresh.version;
                result = await persist(matchedVersion);
            }
        }

        if (result.count === 0) {
            const actual = await prisma.userFile.findUnique({
                where: { id: fileId },
                select: { version: true },
            });
            return {
                success: false,
                conflict: true,
                currentVersion: actual?.version,
                error: 'Conflict: this file was modified by another user. Reload and try again.',
            };
        }

        const newVersion = matchedVersion + 1;

        if (draftBlob && mongoFileId) {
            await prisma.mongoFile.update({
                where: { id: mongoFileId },
                data: {
                    gridFSId: draftBlob.gridFSId,
                    mimeType: trustedMimeType,
                    fileSize: uploadedFile.size,
                    checksum: draftBlob.checksum,
                    folder: 'file-drafts',
                },
            }).catch(() => undefined);
        }
        await trimOldFileVersions(fileId).catch(() => undefined);

        // 10. Immutable audit log
        await prisma.auditLog.create({
            data: {
                action: 'VENDOR_EDITED_FILE',
                linkId: secureLink.id,
                ownerId: secureLink.ownerId,
                reason: `File updated: ${fileRecord.fileName}`,
                metadata: JSON.stringify({
                    fileId,
                    previousVersion: matchedVersion,
                    newVersion,
                    clientExpectedVersion: expectedVersion,
                    oldSize: fileRecord.fileSize,
                    newSize: uploadedFile.size,
                    trustedMimeType,
                    newETag,
                }),
            },
        });

        return { success: true, newVersion, currentVersion: newVersion };
    } catch (error) {
        console.error('updateFile error:', error);
        return { success: false, error: 'An unexpected error occurred while saving.' };
    }
}
