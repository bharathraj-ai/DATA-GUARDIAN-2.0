'use server';

import { prisma } from '@/lib/prisma';
import { authorizeSecureLink } from '@/lib/linkAuthorization';
import { encryptBuffer, generateDek } from '@/lib/crypto';
import { validateMimeType, ALLOWED_EXTENSIONS } from '@/lib/security/file-validator';
import path from 'path';
import { logger, redactEmail } from '@/lib/logger';

export type SubmitFinalResult = {
    success: boolean;
    error?: string;
};

export async function submitFinal(
    token: string,
    fileId: string,
    formData: FormData
): Promise<SubmitFinalResult> {
    try {
        // 1. Authorize (Must have edit capability)
        const authResult = await authorizeSecureLink(token, 'edit', fileId);
        if (!authResult.success) {
            return { success: false, error: authResult.error };
        }

        const vendorEmail = authResult.context.effectiveEmail || 'unknown';

        // 2. Extract and validate file
        const file = formData.get('file');
        if (!file || typeof file !== 'object' || !('arrayBuffer' in file)) {
            return { success: false, error: 'No valid file provided.' };
        }
        const uploadedFile = file as File;

        const ext = path.extname(uploadedFile.name).toLowerCase();
        if (!ALLOWED_EXTENSIONS.has(ext)) {
            return { success: false, error: `File type "${ext}" is not allowed.` };
        }

        const fileBuffer = Buffer.from(await uploadedFile.arrayBuffer());
        const mimeValidation = validateMimeType(fileBuffer, ext);
        if (!mimeValidation.valid) {
            return { success: false, error: mimeValidation.error };
        }

        // 3. Get file record to check storage type (bound to this link)
        const { loadUserFileContentForLink } = await import('@/lib/security/resource-ownership');
        const fileRecord = await loadUserFileContentForLink(fileId, authResult.context.secureLink.id);
        if (!fileRecord) {
            return { success: false, error: 'File not found.' };
        }

        const { resolveLockActor } = await import('@/lib/collaboration/resolve-lock-actor');
        const { assertActorHoldsEditLock, requestEditLock } = await import('@/lib/collaboration/edit-lock-service');
        const actor = resolveLockActor({
            sessionId: authResult.context.sessionId,
            effectiveEmail: authResult.context.effectiveEmail,
            level: authResult.context.isOwner ? 1 : (authResult.context.vendorAccess?.level ?? 2),
            isOwner: authResult.context.isOwner,
            token,
            ownerId: authResult.context.secureLink.ownerId,
            vendors: authResult.context.secureLink.VendorAccess,
            clientInstanceId: formData.get('editClientInstanceId')?.toString(),
        });
        if (!actor) {
            return { success: false, error: 'Identity required for editing.' };
        }
        let lockCheck = await assertActorHoldsEditLock({ documentId: fileId, actor });
        if (!lockCheck.ok && (lockCheck.reason === 'no_lock' || lockCheck.reason === 'lock_expired')) {
            const acquired = await requestEditLock({
                documentId: fileId,
                linkId: authResult.context.secureLink.id,
                actor,
            });
            if (acquired.status === 'acquired' || acquired.status === 'already_holder') {
                lockCheck = { ok: true, lock: acquired.lock };
            }
        }
        if (!lockCheck.ok) {
            return {
                success: false,
                error: lockCheck.reason === 'not_holder'
                    ? 'Your editing session is no longer active. A higher-priority collaborator may have taken control.'
                    : 'You do not hold the editing lock for this document.',
            };
        }

        const isMongoBacked = !!(fileRecord as any).mongoFileId;

        logger.info(`FileId: ${fileId}, Vendor: ${redactEmail(vendorEmail)}, FileName: ${uploadedFile.name}, Storage: ${isMongoBacked ? 'Mongo' : 'inline'}`);

        if (isMongoBacked) {
            // Encrypt then store ciphertext in GridFS.
            const mongoFile = await prisma.mongoFile.findUnique({
                where: { id: (fileRecord as any).mongoFileId },
                select: { folder: true, uploadedBy: true, projectId: true, vendorId: true },
            });

            if (!mongoFile) {
                return { success: false, error: 'Mongo file record not found.' };
            }

            const dek = generateDek();
            const { iv, authTag, encryptedContent } = encryptBuffer(fileBuffer, dek);
            const { wrapDekForLink } = await import('@/lib/security/kms');
            const encryptedDek = await wrapDekForLink(dek, authResult.context.secureLink.id);

            const { putCiphertext, mongoPointerFromStorageKey, FINAL_FOLDER } = await import('@/lib/blob-store');
            const storageKey = await putCiphertext(encryptedContent, {
                fileName: fileRecord.fileName,
                folder: FINAL_FOLDER,
                uploadedBy: mongoFile.uploadedBy,
            });
            const pointer = storageKey ? mongoPointerFromStorageKey(storageKey) : null;
            if (!pointer) {
                return { success: false, error: 'Object storage is not configured.' };
            }
            const checksum = (await import('crypto')).createHash('sha256').update(encryptedContent).digest('hex');

            await prisma.mongoFile.update({
                where: { id: (fileRecord as any).mongoFileId },
                data: {
                    gridFSId: pointer,
                    mimeType: mimeValidation.mimeType!,
                    fileSize: uploadedFile.size,
                    checksum,
                    folder: 'final-submissions',
                    status: 'submitted',
                },
            });

            // Keep DEK envelope metadata so downloads remain decryptable
            await prisma.userFile.update({
                where: { id: fileId },
                data: {
                    fileSize: uploadedFile.size,
                    status: 'submitted',
                    submittedAt: new Date(),
                    submittedBy: vendorEmail,
                    version: { increment: 1 },
                    encryptedContent: null, // bytes live in GridFS
                    iv,
                    authTag,
                    encryptedDek,
                } as any
            });
        } else {
            // ── Legacy path: encrypt and store inline ────────────────
            const dek = generateDek();
            const { iv, authTag, encryptedContent } = encryptBuffer(fileBuffer, dek);
            const { wrapDekForLink } = await import('@/lib/security/kms');
            const encryptedDek = await wrapDekForLink(dek, authResult.context.secureLink.id);

            await prisma.userFile.update({
                where: { id: fileId },
                data: {
                    encryptedContent,
                    iv,
                    authTag,
                    encryptedDek,
                    fileSize: uploadedFile.size,
                    status: 'submitted',
                    submittedAt: new Date(),
                    submittedBy: vendorEmail,
                    version: { increment: 1 }
                } as any
            });
        }

        logger.info(`DB Update successful for ${fileId}`);

        // 5. Vendor access is intentionally NOT revoked after final submission
        // (Access remains active per business logic change)

        // 6. Audit Log
        await prisma.auditLog.create({
            data: {
                action: 'VENDOR_SUBMITTED_FINAL',
                linkId: authResult.context.secureLink.id,
                reason: `Vendor submitted final document: ${uploadedFile.name}. Access preserved.`,
                metadata: JSON.stringify({
                    fileId,
                    submittedBy: vendorEmail,
                    fileSize: uploadedFile.size,
                    storageType: isMongoBacked ? 'mongo' : 'inline',
                })
            }
        });

        logger.info(`Audit log created. Submission complete.`);

        // 7. Owner notification removed — submit only commits the change.
        // No email is sent and no access is revoked.

        return { success: true };
    } catch (error) {
        logger.error('submitFinal error:', error);
        return { success: false, error: 'Failed to submit final document.' };
    }
}
