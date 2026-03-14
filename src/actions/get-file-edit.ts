'use server';

import { prisma } from '@/lib/prisma';
import { decryptBuffer } from '@/lib/crypto';
import { cookies } from 'next/headers';
import * as XLSX from 'xlsx';
import { tryCheckRevoked, tryValidateSession } from '@/lib/redis-helpers';
import mammoth from 'mammoth';



export type FileEditData = {
    success: boolean;
    type?: 'text' | 'spreadsheet' | 'image' | 'richtext' | 'pdf' | 'unsupported';
    content?: string;
    rows?: any[][];
    mimeType?: string;
    error?: string;
};

/**
 * Get the full decrypted file content for inline editing.
 */
export async function getFileForEdit(token: string, fileId: string): Promise<FileEditData> {
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

        const mime = fileRecord.fileType;

        // Text files
        if (mime.startsWith('text/')) {
            return {
                success: true,
                type: 'text',
                mimeType: mime,
                content: buffer.toString('utf-8'),
            };
        }

        // Spreadsheet
        if (mime.includes('spreadsheet') || mime.includes('excel') || mime.includes('csv')) {
            const workbook = XLSX.read(buffer, { type: 'buffer' });
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1 }) as any[][];
            return {
                success: true,
                type: 'spreadsheet',
                mimeType: mime,
                rows,
            };
        }

        // Images
        if (mime.startsWith('image/')) {
            return {
                success: true,
                type: 'image',
                mimeType: mime,
                content: `data:${mime};base64,${buffer.toString('base64')}`,
            };
        }

        // DOCX -> convert to HTML using mammoth
        if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || mime === 'application/msword') {
            try {
                const result = await mammoth.convertToHtml({ buffer });
                return {
                    success: true,
                    type: 'richtext',
                    mimeType: mime,
                    content: result.value,
                };
            } catch (docxErr) {
                console.error('DOCX parse error:', docxErr);
                return {
                    success: true,
                    type: 'text',
                    mimeType: mime,
                    content: '(Could not parse this document)',
                };
            }
        }

        // PDF files
        if (mime === 'application/pdf') {
            return {
                success: true,
                type: 'pdf',
                mimeType: mime,
                content: `data:application/pdf;base64,${buffer.toString('base64')}`,
            };
        }

        // JSON files
        if (mime === 'application/json') {
            return {
                success: true,
                type: 'text',
                mimeType: mime,
                content: buffer.toString('utf-8'),
            };
        }

        return { success: false, type: 'unsupported', error: 'This file type cannot be edited inline.' };

    } catch (error) {
        console.error('Get File For Edit Error:', error);
        return { success: false, error: 'Failed to load file for editing' };
    }
}
