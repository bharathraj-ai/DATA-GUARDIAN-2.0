'use server';

import { prisma } from '@/lib/prisma';
import { authorizeSecureLink } from '@/lib/linkAuthorization';
import { encryptBuffer, generateDek, encryptDek } from '@/lib/crypto';
import { validateMimeType, ALLOWED_EXTENSIONS } from '@/lib/security/file-validator';
import { uploadToMongo } from '@/lib/mongo/operations';
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

        const isMongoBacked = !!(fileRecord as any).mongoFileId;

        logger.info(`FileId: ${fileId}, Vendor: ${redactEmail(vendorEmail)}, FileName: ${uploadedFile.name}, Storage: ${isMongoBacked ? 'Mongo' : 'inline'}`);

        if (isMongoBacked) {
            // ── Mongo path: upload final version to Mongo ─────────────────
            const mongoFile = await prisma.mongoFile.findUnique({
                where: { id: (fileRecord as any).mongoFileId },
                select: { folder: true, uploadedBy: true, projectId: true, vendorId: true },
            });

            if (!mongoFile) {
                return { success: false, error: 'Mongo file record not found.' };
            }

            const mongoUpload = await uploadToMongo({
                buffer: fileBuffer,
                originalFileName: fileRecord.fileName,
                mimeType: mimeValidation.mimeType!,
                fileExtension: ext.replace('.', ''),
                folder: 'final-submissions',
                uploadedBy: mongoFile.uploadedBy,
            });

            // Update MongoFile with new submission key
            await prisma.mongoFile.update({
                where: { id: (fileRecord as any).mongoFileId },
                data: {
                    gridFSId: mongoUpload.gridFSId,
                    mimeType: mimeValidation.mimeType!,
                    fileSize: uploadedFile.size,
                    checksum: mongoUpload.checksum,
                    folder: 'final-submissions',
                    status: 'submitted',
                },
            });

            // Update UserFile metadata — clear encryption fields since Mongo stores raw
            await prisma.userFile.update({
                where: { id: fileId },
                data: {
                    fileSize: uploadedFile.size,
                    status: 'submitted',
                    submittedAt: new Date(),
                    submittedBy: vendorEmail,
                    version: { increment: 1 },
                    // Clear old inline encryption metadata — the Mongo file is stored raw
                    encryptedContent: null,
                    iv: null,
                    authTag: null,
                    encryptedDek: null,
                } as any
            });
        } else {
            // ── Legacy path: encrypt and store inline ────────────────
            const dek = generateDek();
            const { iv, authTag, encryptedContent } = encryptBuffer(fileBuffer, dek);
            const encryptedDek = encryptDek(dek);

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
