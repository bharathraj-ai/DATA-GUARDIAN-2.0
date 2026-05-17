'use server';

import { prisma } from '@/lib/prisma';
import { encryptBuffer, generateDek, encryptDek } from '@/lib/crypto';
import * as XLSX from 'xlsx';
import { authorizeSecureLink } from '@/lib/linkAuthorization';
import { validateMimeType } from '@/lib/security/file-validator';
import { checkUploadRateLimit, extractClientIP, formatRateLimitError } from '@/lib/rate-limit';
import { headers } from 'next/headers';

export type SaveEditResult = {
    success: boolean;
    error?: string;
};

/**
 * Save inline-edited text content back to the file.
 * 
 * SECURITY: Content is server-generated text (from the editor), not a raw file upload.
 * Size-limited to prevent DoS.
 */
const MAX_TEXT_SIZE = 10 * 1024 * 1024; // 10MB max for text edits
const MAX_ROWS = 100_000; // Max spreadsheet rows
const MAX_IMAGE_SIZE = 25 * 1024 * 1024; // 25MB max for image edits
const MAX_PDF_SIZE = 50 * 1024 * 1024; // 50MB max for PDF edits

export async function saveEditedText(
    token: string,
    fileId: string,
    content: string
): Promise<SaveEditResult> {
    try {
        const authResult = await authorizeSecureLink(token, 'edit', fileId);
        if (!authResult.success) {
            throw new Error(authResult.error);
        }

        const requestHeaders = await headers();
        const clientIP = extractClientIP(requestHeaders);
        const rateLimit = await checkUploadRateLimit(clientIP);
        if (!rateLimit.allowed) {
            return { success: false, error: formatRateLimitError(rateLimit) };
        }
        
        const secureLink = authResult.context.secureLink;
        const fileRecord = secureLink.UserFile.find((f: any) => f.id === fileId);
        if (!fileRecord) {
            return { success: false, error: 'File not found' };
        }

        if ((fileRecord as any).editingLocked) {
            return { success: false, error: 'Editing is locked for this file.' };
        }

        // SECURITY: Size limit to prevent DoS
        if (typeof content !== 'string' || content.length > MAX_TEXT_SIZE) {
            return { success: false, error: `Content exceeds maximum size (${MAX_TEXT_SIZE / 1024 / 1024}MB).` };
        }

        const buffer = Buffer.from(content, 'utf-8');
        const dek = generateDek();
        const { iv, authTag, encryptedContent } = encryptBuffer(buffer, dek);
        const encryptedDek = encryptDek(dek);

        await prisma.userFile.update({
            where: { id: fileId },
            data: {
                encryptedContent,
                iv,
                authTag,
                encryptedDek,
                fileSize: buffer.length,
            },
        });

        await prisma.auditLog.create({
            data: {
                action: 'VENDOR_EDITED_FILE',
                linkId: secureLink.id,
                reason: `Vendor edited text file inline: ${fileRecord.fileName}`,
                metadata: JSON.stringify({ fileId, newSize: buffer.length }),
            },
        });

        return { success: true };
    } catch (error) {
        console.error('Save Edited Text Error:', error);
        return { success: false, error: 'Failed to save changes' };
    }
}

/**
 * Save inline-edited spreadsheet content back as .xlsx.
 */
export async function saveEditedSpreadsheet(
    token: string,
    fileId: string,
    rows: any[][]
): Promise<SaveEditResult> {
    try {
        const authResult = await authorizeSecureLink(token, 'edit', fileId);
        if (!authResult.success) {
            throw new Error(authResult.error);
        }
        
        const requestHeaders = await headers();
        const clientIP = extractClientIP(requestHeaders);
        const rateLimit = await checkUploadRateLimit(clientIP);
        if (!rateLimit.allowed) {
            return { success: false, error: formatRateLimitError(rateLimit) };
        }
        
        const secureLink = authResult.context.secureLink;
        const fileRecord = secureLink.UserFile.find((f: any) => f.id === fileId);
        if (!fileRecord) {
            return { success: false, error: 'File not found' };
        }

        if ((fileRecord as any).editingLocked) {
            return { success: false, error: 'Editing is locked for this file.' };
        }

        // SECURITY: Validate rows input to prevent DoS
        if (!Array.isArray(rows) || rows.length === 0) {
            return { success: false, error: 'Invalid spreadsheet data.' };
        }
        if (rows.length > MAX_ROWS) {
            return { success: false, error: `Spreadsheet exceeds ${MAX_ROWS.toLocaleString()} row limit.` };
        }

        const worksheet = XLSX.utils.aoa_to_sheet(rows);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
        const xlsxBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

        const dek = generateDek();
        const { iv, authTag, encryptedContent } = encryptBuffer(Buffer.from(xlsxBuffer), dek);
        const encryptedDek = encryptDek(dek);

        await prisma.userFile.update({
            where: { id: fileId },
            data: {
                encryptedContent,
                iv,
                authTag,
                encryptedDek,
                fileSize: xlsxBuffer.length,
                fileType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            },
        });

        await prisma.auditLog.create({
            data: {
                action: 'VENDOR_EDITED_FILE',
                linkId: secureLink.id,
                reason: `Vendor edited spreadsheet inline: ${fileRecord.fileName}`,
                metadata: JSON.stringify({ fileId, rows: rows.length, newSize: xlsxBuffer.length }),
            },
        });

        return { success: true };
    } catch (error) {
        console.error('Save Edited Spreadsheet Error:', error);
        return { success: false, error: 'Failed to save changes' };
    }
}

/**
 * Save an edited image (from Fabric.js canvas export) back to the file.
 * Receives a base64 data URL, decodes it, encrypts, and stores.
 */
export async function saveEditedImage(
    token: string,
    fileId: string,
    dataUrl: string
): Promise<SaveEditResult> {
    try {
        const authResult = await authorizeSecureLink(token, 'edit', fileId);
        if (!authResult.success) {
            throw new Error(authResult.error);
        }
        
        const requestHeaders = await headers();
        const clientIP = extractClientIP(requestHeaders);
        const rateLimit = await checkUploadRateLimit(clientIP);
        if (!rateLimit.allowed) {
            return { success: false, error: formatRateLimitError(rateLimit) };
        }
        
        const secureLink = authResult.context.secureLink;
        const fileRecord = secureLink.UserFile.find((f: any) => f.id === fileId);
        if (!fileRecord) {
            return { success: false, error: 'File not found' };
        }

        if ((fileRecord as any).editingLocked) {
            return { success: false, error: 'Editing is locked for this file.' };
        }

        // Decode base64 data URL
        const matches = dataUrl.match(/^data:(.+);base64,(.+)$/);
        if (!matches) {
            return { success: false, error: 'Invalid image data' };
        }
        const base64Data = matches[2];
        const buffer = Buffer.from(base64Data, 'base64');

        // SECURITY: Size limit
        if (buffer.length > MAX_IMAGE_SIZE) {
            return { success: false, error: `Image exceeds ${MAX_IMAGE_SIZE / 1024 / 1024}MB limit.` };
        }

        // SECURITY: Validate magic bytes — do NOT trust the MIME from the data URL
        const isJpeg = buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
        const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
        if (!isJpeg && !isPng) {
            return { success: false, error: 'Invalid image format. Only JPEG and PNG are accepted.' };
        }
        const trustedMimeType = isJpeg ? 'image/jpeg' : 'image/png';

        const dek = generateDek();
        const { iv, authTag, encryptedContent } = encryptBuffer(buffer, dek);
        const encryptedDek = encryptDek(dek);

        await prisma.userFile.update({
            where: { id: fileId },
            data: {
                encryptedContent,
                iv,
                authTag,
                encryptedDek,
                fileSize: buffer.length,
                fileType: trustedMimeType, // Server-determined, not client-provided
            },
        });

        await prisma.auditLog.create({
            data: {
                action: 'VENDOR_EDITED_FILE',
                linkId: secureLink.id,
                reason: `Vendor edited image inline: ${fileRecord.fileName}`,
                metadata: JSON.stringify({ fileId, newSize: buffer.length }),
            },
        });

        return { success: true };
    } catch (error) {
        console.error('Save Edited Image Error:', error);
        return { success: false, error: 'Failed to save image' };
    }
}

/**
 * Save rich text (HTML) content back to the file.
 */
export async function saveEditedRichText(
    token: string,
    fileId: string,
    htmlContent: string
): Promise<SaveEditResult> {
    try {
        const authResult = await authorizeSecureLink(token, 'edit', fileId);
        if (!authResult.success) {
            throw new Error(authResult.error);
        }
        
        const requestHeaders = await headers();
        const clientIP = extractClientIP(requestHeaders);
        const rateLimit = await checkUploadRateLimit(clientIP);
        if (!rateLimit.allowed) {
            return { success: false, error: formatRateLimitError(rateLimit) };
        }
        
        const secureLink = authResult.context.secureLink;
        const fileRecord = secureLink.UserFile.find((f: any) => f.id === fileId);
        if (!fileRecord) {
            return { success: false, error: 'File not found' };
        }

        if ((fileRecord as any).editingLocked) {
            return { success: false, error: 'Editing is locked for this file.' };
        }

        // SECURITY: Size limit for rich text
        if (typeof htmlContent !== 'string' || htmlContent.length > MAX_TEXT_SIZE) {
            return { success: false, error: `Content exceeds maximum size (${MAX_TEXT_SIZE / 1024 / 1024}MB).` };
        }

        const buffer = Buffer.from(htmlContent, 'utf-8');

        const dek = generateDek();
        const { iv, authTag, encryptedContent } = encryptBuffer(buffer, dek);
        const encryptedDek = encryptDek(dek);

        await prisma.userFile.update({
            where: { id: fileId },
            data: {
                encryptedContent,
                iv,
                authTag,
                encryptedDek,
                fileSize: buffer.length,
            },
        });

        await prisma.auditLog.create({
            data: {
                action: 'VENDOR_EDITED_FILE',
                linkId: secureLink.id,
                reason: `Vendor edited rich text inline: ${fileRecord.fileName}`,
                metadata: JSON.stringify({ fileId, newSize: buffer.length }),
            },
        });

        return { success: true };
    } catch (error) {
        console.error('Save Edited RichText Error:', error);
        return { success: false, error: 'Failed to save changes' };
    }
}

/**
 * Save an edited PDF (with baked-in annotations from pdf-lib) back to the file.
 * Receives a base64 data URL, decodes it, encrypts, and stores.
 */
export async function saveEditedPdf(
    token: string,
    fileId: string,
    dataUrl: string
): Promise<SaveEditResult> {
    try {
        const authResult = await authorizeSecureLink(token, 'edit', fileId);
        if (!authResult.success) {
            throw new Error(authResult.error);
        }
        
        const requestHeaders = await headers();
        const clientIP = extractClientIP(requestHeaders);
        const rateLimit = await checkUploadRateLimit(clientIP);
        if (!rateLimit.allowed) {
            return { success: false, error: formatRateLimitError(rateLimit) };
        }
        
        const secureLink = authResult.context.secureLink;
        const fileRecord = secureLink.UserFile.find((f: any) => f.id === fileId);
        if (!fileRecord) {
            return { success: false, error: 'File not found' };
        }

        if ((fileRecord as any).editingLocked) {
            return { success: false, error: 'Editing is locked for this file.' };
        }

        // Decode base64 data URL
        const matches = dataUrl.match(/^data:(.+);base64,(.+)$/);
        if (!matches) {
            return { success: false, error: 'Invalid PDF data' };
        }
        const base64Data = matches[2];
        const buffer = Buffer.from(base64Data, 'base64');

        // SECURITY: Size limit
        if (buffer.length > MAX_PDF_SIZE) {
            return { success: false, error: `PDF exceeds ${MAX_PDF_SIZE / 1024 / 1024}MB limit.` };
        }

        // SECURITY: Validate PDF magic bytes (%PDF)
        if (buffer[0] !== 0x25 || buffer[1] !== 0x50 || buffer[2] !== 0x44 || buffer[3] !== 0x46) {
            return { success: false, error: 'Invalid PDF data — file content does not match PDF format.' };
        }

        // Snapshot old version before overwriting
        const maxVersion = await prisma.fileVersion.aggregate({
            where: { fileId },
            _max: { versionNumber: true },
        });
        const nextVersion = (maxVersion._max.versionNumber ?? 0) + 1;

        await prisma.fileVersion.create({
            data: {
                fileId,
                versionNumber: nextVersion,
                encryptedContent: fileRecord.encryptedContent!,
                iv: fileRecord.iv!,
                authTag: fileRecord.authTag!,
                encryptedDek: fileRecord.encryptedDek!,
                fileSize: fileRecord.fileSize,
                changeType: 'annotation',
                changeDescription: 'Pre-save snapshot (PDF annotation)',
            },
        });

        // SECURITY: Cap FileVersion history to 10 versions to prevent unbounded DB growth
        const MAX_VERSIONS = 10;
        const versionCount = await prisma.fileVersion.count({ where: { fileId } });
        if (versionCount > MAX_VERSIONS) {
            const versionsToDelete = await prisma.fileVersion.findMany({
                where: { fileId },
                orderBy: { versionNumber: 'asc' },
                take: versionCount - MAX_VERSIONS,
                select: { id: true }
            });
            await prisma.fileVersion.deleteMany({
                where: { id: { in: versionsToDelete.map(v => v.id) } }
            });
        }

        const dek = generateDek();
        const { iv, authTag, encryptedContent } = encryptBuffer(buffer, dek);
        const encryptedDek = encryptDek(dek);

        await prisma.userFile.update({
            where: { id: fileId },
            data: {
                encryptedContent,
                iv,
                authTag,
                encryptedDek,
                fileSize: buffer.length,
            },
        });

        await prisma.auditLog.create({
            data: {
                action: 'VENDOR_EDITED_FILE',
                linkId: secureLink.id,
                reason: `Vendor edited/annotated PDF inline: ${fileRecord.fileName}`,
                metadata: JSON.stringify({ fileId, newSize: buffer.length }),
            },
        });

        return { success: true };
    } catch (error) {
        console.error('Save Edited PDF Error:', error);
        return { success: false, error: 'Failed to save PDF' };
    }
}

