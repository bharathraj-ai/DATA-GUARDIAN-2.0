'use server';

import { prisma } from '@/lib/prisma';
import { encryptBuffer } from '@/lib/crypto';
import { cookies } from 'next/headers';
import { tryCheckRevoked, tryValidateSession } from '@/lib/redis-helpers';

export type UpdateFileResult = {
    success: boolean;
    error?: string;
};

export async function updateFile(token: string, fileId: string, formData: FormData): Promise<UpdateFileResult> {
    try {
        // 1. Session & Access Validation
        const cookieStore = await cookies();
        const sessionId = cookieStore.get('session_id')?.value;

        // Check revocation
        if (await tryCheckRevoked(token)) {
            return { success: false, error: 'Access revoked' };
        }

        // Check session
        if (sessionId) {
            const isValid = await tryValidateSession(token, sessionId);
            if (isValid === false) return { success: false, error: 'Session invalid' };
        } else {
            return { success: false, error: 'Session required to edit files' };
        }

        // 2. Fetch File Metadata & Verify Link
        const fileRecord = await prisma.userFile.findUnique({
            where: { id: fileId },
            include: { SecureLink: true },
        });

        if (!fileRecord || fileRecord.SecureLink.token !== token) {
            return { success: false, error: 'File not found' };
        }

        if (fileRecord.SecureLink.isRevoked || fileRecord.SecureLink.expiresAt < new Date()) {
            return { success: false, error: 'Access expired or revoked' };
        }

        // 3. Extract the new file from FormData
        const file = formData.get('file') as File;
        if (!file || file.size === 0) {
            return { success: false, error: 'No valid file provided' };
        }

        const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB single file limit for edits
        if (file.size > MAX_FILE_SIZE) {
            return { success: false, error: `File size exceeds 25MB limit` };
        }

        // 4. Encrypt the new file
        const buffer = Buffer.from(await file.arrayBuffer());
        const { iv, authTag, encryptedContent } = encryptBuffer(buffer);

        // 5. Update Database Record
        await prisma.userFile.update({
            where: { id: fileId },
            data: {
                fileName: file.name,
                fileType: file.type,
                fileSize: file.size,
                encryptedContent,
                iv,
                authTag,
            }
        });

        // 6. Audit Log Action
        await prisma.auditLog.create({
            data: {
                action: 'VENDOR_EDITED_FILE',
                linkId: fileRecord.SecureLink.id,
                reason: `Vendor uploaded a new version of file: ${fileRecord.fileName} -> ${file.name}`,
                metadata: JSON.stringify({
                    fileId,
                    oldSize: fileRecord.fileSize,
                    newSize: file.size,
                    newFileName: file.name
                }),
            },
        });

        return { success: true };

    } catch (error) {
        console.error('Update File Error:', error);
        return { success: false, error: 'An unexpected error occurred while saving the file' };
    }
}
