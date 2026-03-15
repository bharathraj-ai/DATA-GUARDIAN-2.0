'use server';

import { prisma } from '@/lib/prisma';
import { decryptBuffer } from '@/lib/crypto';
import { cookies } from 'next/headers';
import { tryCheckRevoked, tryValidateSession } from '@/lib/redis-helpers';

export type RawFileData = {
    success: boolean;
    base64Content?: string;
    mimeType?: string;
    fileName?: string;
    error?: string;
};

export async function getRawFileForEdit(token: string, fileId: string): Promise<RawFileData> {
    try {
        const cookieStore = await cookies();
        const sessionId = cookieStore.get('session_id')?.value;

        if (await tryCheckRevoked(token)) {
            return { success: false, error: 'Access revoked' };
        }

        if (sessionId) {
            const isValid = await tryValidateSession(token, sessionId);
            if (isValid === false) return { success: false, error: 'Session invalid' };
        } else {
            return { success: false, error: 'Session required' };
        }

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

        if (!fileRecord.SecureLink.allowEditing) {
            return { success: false, error: 'Editing is not permitted by the owner' };
        }

        let buffer: Buffer;
        try {
            buffer = decryptBuffer(
                fileRecord.encryptedContent,
                fileRecord.iv,
                fileRecord.authTag
            );
        } catch (e) {
            return { success: false, error: 'Decryption failed' };
        }

        return {
            success: true,
            mimeType: fileRecord.fileType,
            fileName: fileRecord.fileName,
            base64Content: buffer.toString('base64'),
        };

    } catch (error) {
        console.error('Get Raw File Error:', error);
        return { success: false, error: 'Failed to load file content' };
    }
}
