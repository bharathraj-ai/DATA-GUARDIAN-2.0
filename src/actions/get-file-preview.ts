'use server';

import { prisma } from '@/lib/prisma';
import { decryptBuffer, decryptDek } from '@/lib/crypto';
import * as XLSX from 'xlsx';
import { authorizeSecureLink } from '@/lib/linkAuthorization';
import { checkUploadRateLimit, extractClientIP, formatRateLimitError } from '@/lib/rate-limit';
import { headers } from 'next/headers';

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
        const authResult = await authorizeSecureLink(token, 'preview', fileId);
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

        // 3. Decrypt Content
        let buffer: Buffer;
        try {
            const dek = (fileRecord as any).encryptedDek ? decryptDek((fileRecord as any).encryptedDek) : undefined;
            buffer = decryptBuffer(
                fileRecord.encryptedContent!,
                fileRecord.iv!,
                fileRecord.authTag!,
                dek
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
                    linkId: secureLink.id,
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
