'use server';

import { prisma } from '@/lib/prisma';
import { decryptBuffer } from '@/lib/crypto';
import { auth } from '@/lib/auth';

export type DownloadFileResult = {
    success: boolean;
    fileName?: string;
    fileContent?: string; // Base64 string
    fileType?: string;
    error?: string;
};

export async function downloadFile(fileId: string): Promise<DownloadFileResult> {
    try {
        // 1. Verify Session & Ownership (Zero Trust)
        const session = await auth();
        if (!session?.user) {
            return { success: false, error: 'Authentication required' };
        }

        const userId = session.user.id;

        // 2. Fetch File & Verify Owner
        const fileRecord = await prisma.userFile.findUnique({
            where: { id: fileId },
            include: { SecureLink: true },
        });

        if (!fileRecord) {
            return { success: false, error: 'File not found' };
        }

        if (fileRecord.SecureLink.ownerId !== userId) {
            return { success: false, error: 'Unauthorized: You do not own this file' };
        }

        // 3. Decrypt Content
        let buffer: Buffer;
        try {
            buffer = decryptBuffer(
                fileRecord.encryptedContent,
                fileRecord.iv,
                fileRecord.authTag
            );
        } catch (e) {
            return { success: false, error: 'Decryption failed. The file may be corrupted.' };
        }

        // 4. Audit Log Action
        await prisma.auditLog.create({
            data: {
                action: 'OWNER_DOWNLOADED',
                linkId: fileRecord.SecureLink.id,
                reason: `Owner downloaded file: ${fileRecord.fileName}`,
                metadata: JSON.stringify({
                    fileId: fileRecord.id,
                    fileType: fileRecord.fileType,
                    fileSize: fileRecord.fileSize
                }),
            },
        });

        // 5. Return Base64 encoded file
        return {
            success: true,
            fileName: fileRecord.fileName,
            fileType: fileRecord.fileType,
            fileContent: buffer.toString('base64'),
        };
    } catch (error) {
        console.error('Download Error:', error);
        return { success: false, error: 'An unexpected error occurred' };
    }
}
