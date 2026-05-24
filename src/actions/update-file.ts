'use server';

import { prisma } from '@/lib/prisma';
import { encryptBuffer, generateDek, encryptDek } from '@/lib/crypto';
import { authorizeSecureLink } from '@/lib/linkAuthorization';
import { validateMimeType, ALLOWED_EXTENSIONS } from '@/lib/security/file-validator';
import path from 'path';

export type UpdateFileResult = {
    success: boolean;
    error?: string;
    newVersion?: number;
};

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB

/**
 * Save draft edits — always stores inline (encrypted in DB) for speed.
 * S3 upload only happens on final submission (submit-final.ts).
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
        const fileRecord = secureLink.UserFile.find((f: any) => f.id === fileId);

        if (!fileRecord) {
            return { success: false, error: 'File not found.' };
        }

        if ((fileRecord as any).editingLocked) {
            return { success: false, error: 'Editing is locked for this file.' };
        }

        // 7. Snapshot current version for rollback support (only if inline content exists)
        if (fileRecord.encryptedContent) {
            try {
                await prisma.fileVersion.create({
                    data: {
                        fileId: fileRecord.id,
                        versionNumber: fileRecord.version,
                        encryptedContent: fileRecord.encryptedContent,
                        iv: fileRecord.iv!,
                        authTag: fileRecord.authTag!,
                        encryptedDek: (fileRecord as any).encryptedDek,
                        fileSize: fileRecord.fileSize,
                        changeType: 'annotation',
                        changeDescription: `Snapshot before update from version ${fileRecord.version}`,
                    },
                });
            } catch (err: any) {
                if (err.code !== 'P2002') throw err; // Ignore unique constraint if snapshot already taken
            }
        }

        // 8. Encrypt new content with fresh DEK (per-file key rotation on every save)
        //    Always store inline in DB for fast draft saves — S3 only on final submit
        const dek = generateDek();
        const { iv, authTag, encryptedContent } = encryptBuffer(fileBuffer, dek);
        const encryptedDek = encryptDek(dek);
        const newETag = crypto.randomUUID();

        // 9. Atomic update with OCC — rejects stale writes
        const result = await prisma.userFile.updateMany({
            where: {
                id: fileId,
                version: expectedVersion, // Will be 0 rows if another user already saved
            },
            data: {
                fileName: fileRecord.fileName, // Preserve original filename — do not trust client
                fileType: trustedMimeType,
                fileSize: uploadedFile.size,
                encryptedContent,
                iv,
                authTag,
                encryptedDek,
                eTag: newETag,
                version: { increment: 1 },
            },
        });

        if (result.count === 0) {
            return {
                success: false,
                error: 'Conflict: this file was modified by another user. Reload and try again.',
            };
        }

        // 10. Immutable audit log
        await prisma.auditLog.create({
            data: {
                action: 'VENDOR_EDITED_FILE',
                linkId: secureLink.id,
                reason: `File updated: ${fileRecord.fileName}`,
                metadata: JSON.stringify({
                    fileId,
                    previousVersion: fileRecord.version,
                    newVersion: fileRecord.version + 1,
                    oldSize: fileRecord.fileSize,
                    newSize: uploadedFile.size,
                    trustedMimeType,
                    newETag,
                }),
            },
        });

        return { success: true, newVersion: fileRecord.version + 1 };
    } catch (error) {
        console.error('updateFile error:', error);
        return { success: false, error: error instanceof Error ? error.message : 'An unexpected error occurred while saving.' };
    }
}
