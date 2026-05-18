'use server';

import { prisma } from '@/lib/prisma';
import { decryptBuffer } from '@/lib/crypto';
import * as XLSX from 'xlsx';
import { authorizeSecureLink } from '@/lib/linkAuthorization';
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
        const authResult = await authorizeSecureLink(token, 'edit', fileId);
        if (!authResult.success) {
            throw new Error(authResult.error);
        }

        const secureLink = authResult.context.secureLink;
        const fileRecord = secureLink.UserFile.find((f: any) => f.id === fileId);

        if (!fileRecord) {
            return { success: false, error: 'File not found' };
        }

        let buffer: Buffer;
        try {
            buffer = decryptBuffer(
                fileRecord.encryptedContent!,
                fileRecord.iv!,
                fileRecord.authTag!
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
