'use server';

import { prisma } from '@/lib/prisma';
import { encryptBuffer, generateDek, encryptDek } from '@/lib/crypto';
import { cookies } from 'next/headers';
import * as XLSX from 'xlsx';
import { tryCheckRevoked, tryValidateSession } from '@/lib/redis-helpers';

export type SaveEditResult = {
    success: boolean;
    error?: string;
};

/**
 * Save inline-edited text content back to the file.
 */
export async function saveEditedText(
    token: string,
    fileId: string,
    content: string
): Promise<SaveEditResult> {
    try {
        const cookieStore = await cookies();
        const sessionId = cookieStore.get('session_id')?.value;

        if (await tryCheckRevoked(token)) return { success: false, error: 'Access revoked' };
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
                linkId: fileRecord.SecureLink.id,
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
        const cookieStore = await cookies();
        const sessionId = cookieStore.get('session_id')?.value;

        if (await tryCheckRevoked(token)) return { success: false, error: 'Access revoked' };
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

        // Build a new workbook from the edited rows
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
                linkId: fileRecord.SecureLink.id,
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
        const cookieStore = await cookies();
        const sessionId = cookieStore.get('session_id')?.value;

        if (await tryCheckRevoked(token)) return { success: false, error: 'Access revoked' };
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

        // Decode base64 data URL
        const matches = dataUrl.match(/^data:(.+);base64,(.+)$/);
        if (!matches) {
            return { success: false, error: 'Invalid image data' };
        }
        const mimeType = matches[1];
        const base64Data = matches[2];
        const buffer = Buffer.from(base64Data, 'base64');

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
                fileType: mimeType,
            },
        });

        await prisma.auditLog.create({
            data: {
                action: 'VENDOR_EDITED_FILE',
                linkId: fileRecord.SecureLink.id,
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
        const cookieStore = await cookies();
        const sessionId = cookieStore.get('session_id')?.value;

        if (await tryCheckRevoked(token)) return { success: false, error: 'Access revoked' };
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
                linkId: fileRecord.SecureLink.id,
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
        const cookieStore = await cookies();
        const sessionId = cookieStore.get('session_id')?.value;

        if (await tryCheckRevoked(token)) return { success: false, error: 'Access revoked' };
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

        // Decode base64 data URL
        const matches = dataUrl.match(/^data:(.+);base64,(.+)$/);
        if (!matches) {
            return { success: false, error: 'Invalid PDF data' };
        }
        const base64Data = matches[2];
        const buffer = Buffer.from(base64Data, 'base64');

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
                encryptedContent: fileRecord.encryptedContent,
                iv: fileRecord.iv,
                authTag: fileRecord.authTag,
                encryptedDek: fileRecord.encryptedDek,
                fileSize: fileRecord.fileSize,
                changeType: 'annotation',
                changeDescription: 'Pre-save snapshot (PDF annotation)',
            },
        });

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
                linkId: fileRecord.SecureLink.id,
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

