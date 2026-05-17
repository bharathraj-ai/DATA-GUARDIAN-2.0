'use server';

import { prisma } from '@/lib/prisma';
import { authorizeSecureLink } from '@/lib/linkAuthorization';
import { encryptBuffer, generateDek, encryptDek } from '@/lib/crypto';
import { validateMimeType, ALLOWED_EXTENSIONS } from '@/lib/security/file-validator';
import { uploadToMongo } from '@/lib/mongo/operations';
import path from 'path';

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

        // 3. Get file record to check storage type
        const fileRecord = authResult.context.secureLink.UserFile.find((f: any) => f.id === fileId);
        if (!fileRecord) {
            return { success: false, error: 'File not found.' };
        }

        const isMongoBacked = !!(fileRecord as any).mongoFileId;

        console.log(`[Submit] FileId: ${fileId}, Vendor: ${vendorEmail}, FileName: ${uploadedFile.name}, Storage: ${isMongoBacked ? 'Mongo' : 'inline'}`);

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

            // Update UserFile metadata (no encrypted content)
            await prisma.userFile.update({
                where: { id: fileId },
                data: {
                    fileSize: uploadedFile.size,
                    status: 'submitted',
                    submittedAt: new Date(),
                    submittedBy: vendorEmail,
                    editingLocked: true,
                    version: { increment: 1 }
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
                    editingLocked: true,
                    version: { increment: 1 }
                } as any
            });
        }

        console.log(`[Submit] DB Update successful for ${fileId}`);

        // 5. Revoke vendor access for this specific link after final submission
        if (authResult.context.effectiveEmail) {
            const lowerEmail = authResult.context.effectiveEmail.toLowerCase();

            // Revoke VendorAccess
            const revokedVA = await prisma.vendorAccess.updateMany({
                where: {
                    secureLinkId: authResult.context.secureLink.id,
                    email: { mode: 'insensitive', equals: lowerEmail }
                },
                data: { isRevoked: true }
            });

            // Revoke LinkAccess
            const revokedLA = await prisma.linkAccess.updateMany({
                where: {
                    secureLinkId: authResult.context.secureLink.id,
                    vendorEmail: { mode: 'insensitive', equals: lowerEmail }
                },
                data: { isUsed: false }
            });

            console.log(`[Submit] Revoked access for ${lowerEmail}. VendorAccess: ${revokedVA.count}, LinkAccess: ${revokedLA.count}`);
        }

        // 6. Audit Log
        await prisma.auditLog.create({
            data: {
                action: 'VENDOR_SUBMITTED_FINAL',
                linkId: authResult.context.secureLink.id,
                reason: `Vendor submitted final document: ${uploadedFile.name}. Access revoked.`,
                metadata: JSON.stringify({
                    fileId,
                    submittedBy: vendorEmail,
                    fileSize: uploadedFile.size,
                    storageType: isMongoBacked ? 'mongo' : 'inline',
                })
            }
        });

        console.log(`[Submit] Audit log created. Submission complete.`);

        return { success: true };
    } catch (error) {
        console.error('submitFinal error:', error);
        return { success: false, error: 'Failed to submit final document.' };
    }
}
