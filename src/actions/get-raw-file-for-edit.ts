'use server';

import { prisma } from '@/lib/prisma';
import { decryptBuffer, decryptDek } from '@/lib/crypto';
import { authorizeSecureLink } from '@/lib/linkAuthorization';
import { downloadFromMongo } from '@/lib/mongo/operations';
import { gridFsIdForFile } from '@/lib/security/resource-ownership';

export type RawFileData = {
    success: boolean;
    base64Content?: string;
    mimeType?: string;
    fileName?: string;
    version?: number;
    myAssignedLevel?: number;
    capabilities?: { canEdit: boolean; canPreview: boolean; canComment: boolean; canDownload: boolean };
    remainingSeconds?: number;
    error?: string;
};

export async function getRawFileForEdit(token: string, fileId: string): Promise<RawFileData> {
    try {
        const authResult = await authorizeSecureLink(token, 'edit', fileId);
        if (!authResult.success) {
            throw new Error(authResult.error);
        }

        const secureLink = authResult.context.secureLink;
        const { loadUserFileContentForLink } = await import('@/lib/security/resource-ownership');
        const fileRecord = await loadUserFileContentForLink(fileId, secureLink.id);

        if (!fileRecord) {
            return { success: false, error: 'File not found' };
        }

        if (!secureLink.allowEditing) {
            return { success: false, error: 'Editing is not permitted by the owner' };
        }

        if ((fileRecord as any).editingLocked) {
            return { success: false, error: 'Editing is locked for this file.' };
        }

        // Transition status to 'editing' if it's currently 'draft'
        if ((fileRecord as any).status === 'draft') {
            await prisma.userFile.update({
                where: { id: fileId },
                data: { status: 'editing' } as any
            });
        }

        let buffer: Buffer;

        // Priority: inline encrypted content (draft saves) → S3 (original upload)
        if (fileRecord.encryptedContent) {
            // ── Inline path: decrypt DB-stored content (latest draft) ──
            try {
                const dek = (fileRecord as any).encryptedDek ? decryptDek((fileRecord as any).encryptedDek) : undefined;
                buffer = decryptBuffer(
                    fileRecord.encryptedContent,
                    fileRecord.iv!,
                    fileRecord.authTag!,
                    dek
                );
            } catch (e) {
                return { success: false, error: 'Decryption failed' };
            }
        } else if ((fileRecord as any).mongoFileId) {
            // ── Mongo fallback: download file from Mongo ─────────
            try {
                const gridFSId = gridFsIdForFile(fileRecord);
                if (!gridFSId) {
                    return { success: false, error: 'Mongo file record not found' };
                }

                const downloadedBuffer = await downloadFromMongo(gridFSId, fileRecord.fileSize);

                // If iv/authTag are present, the file was encrypted at upload — decrypt it.
                // If they're null, submitFinal stored the file raw in GridFS — use as-is.
                if (fileRecord.iv && fileRecord.authTag) {
                    const dek = (fileRecord as any).encryptedDek ? decryptDek((fileRecord as any).encryptedDek) : undefined;
                    buffer = decryptBuffer(
                        downloadedBuffer,
                        fileRecord.iv,
                        fileRecord.authTag,
                        dek
                    );
                } else {
                    buffer = downloadedBuffer;
                }
            } catch (e) {
                console.error('[MONGO_EDIT] Download/Decrypt failed:', e);
                return { success: false, error: 'Failed to retrieve or decrypt file from storage' };
            }
        } else {
            return { success: false, error: 'File has no content available' };
        }

        const myAssignedLevel = authResult.context.isOwner
            ? 1
            : (authResult.context.vendorAccess?.level ?? 2);

        return {
            success: true,
            mimeType: fileRecord.fileType,
            fileName: fileRecord.fileName,
            version: fileRecord.version,
            base64Content: buffer.toString('base64'),
            myAssignedLevel,
            capabilities: authResult.context.capabilities,
            remainingSeconds: Math.max(
                0,
                Math.floor((secureLink.expiresAt.getTime() - Date.now()) / 1000),
            ),
        };

    } catch (error) {
        console.error('Get Raw File Error:', error);
        return { success: false, error: 'Failed to load file content' };
    }
}
