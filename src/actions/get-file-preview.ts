'use server';

import { prisma } from '@/lib/prisma';
import ExcelJS from 'exceljs';
import { Readable } from 'stream';
import { authorizeSecureLink } from '@/lib/linkAuthorization';
import { checkDownloadRateLimit, extractClientIP, formatRateLimitError } from '@/lib/rate-limit';
import { headers } from 'next/headers';
import { decryptUserFileBytes } from '@/lib/decrypt-user-file';

const PREVIEW_ROW_LIMIT = 10;

function tryParseEditorWorkspace(buffer: Buffer): {
    type?: string;
    name?: string;
    pages?: Array<{ elements?: Array<{ type?: string; rows?: unknown[][] }> }>;
} | null {
    try {
        const text = buffer.toString('utf8').trim();
        if (!text.startsWith('{')) return null;
        const parsed = JSON.parse(text) as {
            type?: string;
            name?: string;
            pages?: Array<{ elements?: Array<{ type?: string; rows?: unknown[][] }> }>;
        };
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.pages)) {
            return parsed;
        }
    } catch {
        /* not JSON workspace */
    }
    return null;
}

function cellPreviewValue(cell: unknown): string | number | boolean | '' {
    if (cell === null || cell === undefined) return '';
    if (typeof cell === 'object') {
        const value = (cell as { value?: unknown }).value;
        if (value === null || value === undefined) return '';
        if (typeof value === 'object') return '';
        return value as string | number | boolean;
    }
    return cell as string | number | boolean;
}

function rowsFromWorkspace(
    workspace: NonNullable<ReturnType<typeof tryParseEditorWorkspace>>,
    limit: number,
): { rows: Array<Array<string | number | boolean | ''>>; total: number } {
    const all: Array<Array<string | number | boolean | ''>> = [];
    for (const page of workspace.pages || []) {
        for (const el of page.elements || []) {
            if (el.type !== 'table' || !Array.isArray(el.rows)) continue;
            for (const row of el.rows) {
                all.push((Array.isArray(row) ? row : []).map(cellPreviewValue));
            }
        }
    }
    return { rows: all.slice(0, limit), total: all.length };
}

export type FilePreviewResult = {
    success: boolean;
    type?: 'image' | 'pdf' | 'spreadsheet' | 'text' | 'word';
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

        const caps = authResult.context.capabilities;
        // Full file export (image/PDF data URIs) requires download or edit.
        // Spreadsheet/text/word in-app snippets are allowed for view-only links.
        const allowFullExport = caps.canDownload || caps.canEdit;

        const requestHeaders = await headers();
        const clientIP = extractClientIP(requestHeaders);
        const rateLimit = await checkDownloadRateLimit(clientIP);
        if (!rateLimit.allowed) {
            return { success: false, error: formatRateLimitError(rateLimit) };
        }

        const secureLink = authResult.context.secureLink;
        const { loadUserFileContentForLink } = await import('@/lib/security/resource-ownership');
        const fileRecord = await loadUserFileContentForLink(fileId, secureLink.id);

        if (!fileRecord) {
            return { success: false, error: 'File not found' };
        }

        let buffer: Buffer;
        try {
            buffer = await decryptUserFileBytes(fileRecord);
        } catch (e) {
            console.error('[PREVIEW] Decrypt failed:', e);
            return { success: false, error: 'Failed to retrieve file for preview' };
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

        // A. Images -> Base64 Data URI (download-equivalent)
        if (mime.startsWith('image/')) {
            if (!allowFullExport) {
                return {
                    success: false,
                    error: 'Image export is disabled. Open the in-app viewer instead.',
                    restricted: true,
                    restrictionType: 'download_disabled',
                };
            }
            const base64 = buffer.toString('base64');
            // Note: Image scaling can be added in future V2.2 if needed
            return {
                success: true,
                type: 'image',
                content: `data:${mime};base64,${base64}`,
                restricted: false,
            };
        }

        // B. PDF -> Base64 Data URI (download-equivalent)
        if (mime === 'application/pdf') {
            if (!allowFullExport) {
                return {
                    success: false,
                    error: 'PDF export is disabled. Open the in-app viewer instead.',
                    restricted: true,
                    restrictionType: 'download_disabled',
                };
            }
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

        // C. Spreadsheet (Excel/CSV) — real xlsx OR editor JSON workspace drafts
        const fileNameLower = (fileRecord.fileName || '').toLowerCase();
        const mimeLowerEarly = (mime || '').toLowerCase();
        const looksSpreadsheet =
            mimeLowerEarly.includes('spreadsheet') ||
            mimeLowerEarly.includes('excel') ||
            mimeLowerEarly.includes('csv') ||
            fileNameLower.endsWith('.xlsx') ||
            fileNameLower.endsWith('.xls') ||
            fileNameLower.endsWith('.csv');

        const workspace = tryParseEditorWorkspace(buffer);
        if (
            workspace &&
            (looksSpreadsheet ||
                workspace.type === 'xlsx' ||
                workspace.type === 'xls' ||
                workspace.type === 'csv')
        ) {
            const { rows, total } = rowsFromWorkspace(workspace, PREVIEW_ROW_LIMIT);
            const restricted = total > PREVIEW_ROW_LIMIT;
            if (restricted) await logRestriction('excel_rows', total);
            return {
                success: true,
                type: 'spreadsheet',
                content: rows,
                restricted,
                restrictionType: restricted
                    ? `Showing first ${PREVIEW_ROW_LIMIT} of ${total} rows`
                    : undefined,
                totalSize: total,
            };
        }

        if (looksSpreadsheet) {
            if (fileNameLower.endsWith('.xls') && !fileNameLower.endsWith('.xlsx')) {
                return {
                    success: false,
                    error: 'Legacy .xls previews are disabled. Re-save as .xlsx or .csv.',
                };
            }
            const workbook = new ExcelJS.Workbook();
            const isCsv =
                fileNameLower.endsWith('.csv') || mimeLowerEarly.includes('csv');
            if (isCsv) {
                await workbook.csv.read(Readable.from(buffer));
            } else {
                // ExcelJS typings conflict with Node Buffer generics across versions
                await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
            }
            const firstSheet = workbook.worksheets[0];
            if (!firstSheet) {
                return { success: false, error: 'Spreadsheet has no readable sheets' };
            }
            const rawRows: unknown[][] = [];
            firstSheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
                if (rowNumber > PREVIEW_ROW_LIMIT) return;
                const values = Array.isArray(row.values) ? row.values.slice(1) : [];
                rawRows.push(values);
            });
            const previewRows = rawRows
                .slice(0, PREVIEW_ROW_LIMIT)
                .map((row) => (Array.isArray(row) ? row.map(cellPreviewValue) : []));
            const restricted =
                firstSheet.rowCount > PREVIEW_ROW_LIMIT ||
                previewRows.length >= PREVIEW_ROW_LIMIT;

            if (restricted) {
                await logRestriction('excel_rows', previewRows.length);
            }

            return {
                success: true,
                type: 'spreadsheet',
                content: previewRows,
                restricted,
                restrictionType: restricted ? `Showing first ${PREVIEW_ROW_LIMIT} rows` : undefined,
                totalSize: previewRows.length,
            };
        }

        // D. Word / ODT -> HTML preview (read-only)
        const fileName = fileNameLower;
        const mimeLower = mimeLowerEarly || (mime || '').toLowerCase();
        const isWord =
            mimeLower.includes('wordprocessingml') ||
            mimeLower.includes('msword') ||
            mimeLower.includes('opendocument.text') ||
            fileName.endsWith('.docx') ||
            fileName.endsWith('.doc') ||
            fileName.endsWith('.odt');

        if (isWord) {
            try {
                const mammoth = await import('mammoth');
                const result = await mammoth.convertToHtml({ buffer });
                const html = (result.value || '').trim();
                if (!html) {
                    return { success: false, error: 'This Word file has no previewable text. Use Edit to open it.' };
                }
                return {
                    success: true,
                    type: 'word',
                    content: html,
                    restricted: false,
                };
            } catch (err) {
                console.error('[PREVIEW] Word convert failed:', err);
                return {
                    success: false,
                    error: 'Could not preview this Word document. Use Edit to open it.',
                };
            }
        }

        // E. Text -> V2.1: Limited to 500 chars
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
        return { success: false, error: 'Failed to open preview' };
    }
}
