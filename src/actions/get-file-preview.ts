'use server';

import { prisma } from '@/lib/prisma';
import { decryptBuffer } from '@/lib/crypto';
import { cookies } from 'next/headers';
import * as XLSX from 'xlsx';

// Helper: Check Redis revocation
async function tryCheckRevoked(token: string): Promise<boolean | null> {
    try {
        if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN ||
            process.env.UPSTASH_REDIS_REST_URL.includes('your-redis')) {
            return null;
        }
        const { isTokenRevoked } = await import('@/lib/redis');
        return await isTokenRevoked(token);
    } catch {
        return null;
    }
}

// Helper: Validate Session
async function tryValidateSession(token: string, sessionId: string): Promise<boolean | null> {
    try {
        if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN ||
            process.env.UPSTASH_REDIS_REST_URL.includes('your-redis')) {
            return null;
        }
        const { validateSession } = await import('@/lib/redis');
        return await validateSession(token, sessionId);
    } catch {
        return null;
    }
}

export type FilePreviewResult = {
    success: boolean;
    type?: 'image' | 'pdf' | 'spreadsheet' | 'text';
    content?: any; // Base64 string or JSON array
    error?: string;
    // V2.1 Additions
    restricted?: boolean;  // True if preview was limited
    restrictionType?: string;  // Type of restriction applied
    totalSize?: number;  // Total data size (if applicable)
};

export async function getFilePreview(token: string, fileId: string): Promise<FilePreviewResult> {
    try {
        // 1. Session & Access Validation
        const cookieStore = await cookies();
        const sessionId = cookieStore.get('session_id')?.value;
        const deviceHashHeader = (await cookies()).get('device_hash')?.value; // Or check cookies/headers

        // Check revocation
        if (await tryCheckRevoked(token)) {
            return { success: false, error: 'Access revoked' };
        }

        // Check session
        if (sessionId) {
            const isValid = await tryValidateSession(token, sessionId);
            if (isValid === false) return { success: false, error: 'Session invalid' };
        } else {
            // If no session, reject (Files only viewable in session)
            return { success: false, error: 'Session required' };
        }

        // 2. Fetch File Metadata
        const fileRecord = await prisma.userFile.findUnique({
            where: { id: fileId },
            include: { secureLink: true },
        });

        if (!fileRecord || fileRecord.secureLink.token !== token) {
            return { success: false, error: 'File not found' };
        }

        // Check DB revocation/expiry again
        if (fileRecord.secureLink.isRevoked || fileRecord.secureLink.expiresAt < new Date()) {
            return { success: false, error: 'Access expired or revoked' };
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
            return { success: false, error: 'Decryption failed' };
        }

        // 4. Process Content based on Type
        const mime = fileRecord.fileType;

        // Audit Log (V2.1: Will add PREVIEW_RESTRICTED if limited)
        const logRestriction = async (restrictionType: string, totalSize?: number) => {
            await prisma.auditLog.create({
                data: {
                    action: 'PREVIEW_RESTRICTED',
                    linkId: fileRecord.secureLink.id,
                    reason: `Preview restricted: ${fileRecord.fileName}`,
                    metadata: JSON.stringify({
                        fileId: fileRecord.id,
                        type: mime,
                        restrictionType,
                        totalSize
                    }),
                },
            });
        };

        // A. Images -> Base64 Data URI (V2.1: Full image, no scaling in first release)
        if (mime.startsWith('image/')) {
            const base64 = buffer.toString('base64');
            // Note: Image scaling can be added in future V2.2 if needed
            return {
                success: true,
                type: 'image',
                content: `data:${mime};base64,${base64}`,
                restricted: false,
            };
        }

        // B. PDF -> Base64 Data URI (V2.1: Full PDF, page restriction coming in V2.2)
        if (mime === 'application/pdf') {
            const base64 = buffer.toString('base64');
            // Note: First-page-only restriction requires PDF parsing library
            // Can be implemented in V2.2 with pdf-lib or similar
            return {
                success: true,
                type: 'pdf',
                content: `data:${mime};base64,${base64}`,
                restricted: false,
            };
        }

        // C. Spreadsheet (Excel/CSV) -> V2.1: Limited to 10 rows
        if (mime.includes('spreadsheet') || mime.includes('excel') || mime.includes('csv')) {
            const workbook = XLSX.read(buffer, { type: 'buffer' });
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1 }) as any[];

            const PREVIEW_ROW_LIMIT = 10;  // V2.1: Reduced from 20 to 10
            const totalRows = rows.length;
            const restricted = totalRows > PREVIEW_ROW_LIMIT;
            const previewRows = rows.slice(0, PREVIEW_ROW_LIMIT);

            if (restricted) {
                await logRestriction('excel_rows', totalRows);
            }

            return {
                success: true,
                type: 'spreadsheet',
                content: previewRows,
                restricted,
                restrictionType: restricted ? `Showing first ${PREVIEW_ROW_LIMIT} of ${totalRows} rows` : undefined,
                totalSize: totalRows,
            };
        }

        // D. Text -> V2.1: Limited to 500 chars
        if (mime.startsWith('text/')) {
            const fullText = buffer.toString('utf-8');
            const PREVIEW_CHAR_LIMIT = 500;  // V2.1: Reduced from 1000 to 500
            const restricted = fullText.length > PREVIEW_CHAR_LIMIT;
            const previewText = fullText.substring(0, PREVIEW_CHAR_LIMIT);

            if (restricted) {
                await logRestriction('text_chars', fullText.length);
            }

            return {
                success: true,
                type: 'text',
                content: previewText,
                restricted,
                restrictionType: restricted ? `Showing first ${PREVIEW_CHAR_LIMIT} of ${fullText.length} characters` : undefined,
                totalSize: fullText.length,
            };
        }

        return { success: false, error: 'Unsupported preview type' };

    } catch (error) {
        console.error('Preview Error:', error);
        return { success: false, error: 'Failed' };
    }
}
