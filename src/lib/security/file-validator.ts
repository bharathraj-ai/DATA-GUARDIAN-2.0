/**
 * Server-side file validation — magic bytes + extension allowlist.
 * NEVER trust the Content-Type header sent by the client.
 */

/** Allowlisted file extensions */
export const ALLOWED_EXTENSIONS = new Set([
    '.pdf', '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt',
    '.txt', '.csv', '.png', '.jpg', '.jpeg', '.gif', '.webp',
    '.odt', '.ods', '.odp',
]);

/**
 * DANGEROUS extensions — always reject, even if somehow snuck past allowlist.
 * Prevents polyglot attacks where an attacker crafts a .pdf.exe double-extension.
 */
export const DANGEROUS_EXTENSIONS = new Set([
    '.exe', '.dll', '.bat', '.cmd', '.com', '.msi', '.ps1', '.vbs', '.vbe',
    '.js', '.jse', '.wsf', '.wsh', '.scr', '.pif', '.hta', '.cpl',
    '.jar', '.sh', '.bash', '.app', '.action', '.command', '.workflow',
    '.reg', '.inf', '.lnk', '.url', '.svg', '.html', '.htm', '.xhtml',
    '.php', '.py', '.rb', '.pl', '.asp', '.aspx', '.jsp', '.cgi',
]);

/** Allowlisted MIME types */
export const ALLOWED_MIME_TYPES = new Set([
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-powerpoint',
    'text/plain',
    'text/csv',
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'application/vnd.oasis.opendocument.text',
    'application/vnd.oasis.opendocument.spreadsheet',
    'application/vnd.oasis.opendocument.presentation',
]);

/**
 * Magic byte signatures mapped to their real MIME types.
 * Source: https://en.wikipedia.org/wiki/List_of_file_signatures
 */
const MAGIC_SIGNATURES: { bytes: number[]; mask?: number[]; mimeType: string }[] = [
    { bytes: [0x25, 0x50, 0x44, 0x46], mimeType: 'application/pdf' }, // %PDF
    { bytes: [0x50, 0x4B, 0x03, 0x04], mimeType: 'application/zip' }, // PK\x03\x04 — ZIP-based (DOCX/XLSX/PPTX/OD*)
    { bytes: [0x50, 0x4B, 0x05, 0x06], mimeType: 'application/zip' }, // PK\x05\x06 — Empty ZIP
    { bytes: [0x50, 0x4B, 0x07, 0x08], mimeType: 'application/zip' }, // PK\x07\x08 — Spanned ZIP
    { bytes: [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1], mimeType: 'application/msoffice' }, // OLE2 — DOC/XLS/PPT
    { bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], mimeType: 'image/png' }, // PNG
    { bytes: [0xFF, 0xD8, 0xFF], mimeType: 'image/jpeg' }, // JPEG
    { bytes: [0x47, 0x49, 0x46, 0x38], mimeType: 'image/gif' }, // GIF87a / GIF89a
    { bytes: [0x52, 0x49, 0x46, 0x46], mimeType: 'image/webp' }, // RIFF (WebP)
];

/** ZIP-based Office extension to canonical MIME map */
const ZIP_EXTENSION_MIME: Record<string, string> = {
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.odt':  'application/vnd.oasis.opendocument.text',
    '.ods':  'application/vnd.oasis.opendocument.spreadsheet',
    '.odp':  'application/vnd.oasis.opendocument.presentation',
};

/** OLE2-based extension to canonical MIME map */
const OLE2_EXTENSION_MIME: Record<string, string> = {
    '.doc': 'application/msword',
    '.xls': 'application/vnd.ms-excel',
    '.ppt': 'application/vnd.ms-powerpoint',
};

/** Plain-text extensions */
const TEXT_EXTENSIONS = new Set(['.txt', '.csv']);

export interface MimeValidationResult {
    valid: boolean;
    mimeType?: string;
    error?: string;
}

/**
 * Validates a file buffer against its declared extension using magic bytes.
 * Returns the trusted server-side MIME type on success.
 *
 * @param buffer - File bytes (first 16 bytes are sufficient for magic detection)
 * @param ext    - Lowercased extension (e.g. ".pdf")
 */
export function validateMimeType(buffer: Buffer, ext: string): MimeValidationResult {
    // SECURITY: Reject known-dangerous extensions immediately
    if (DANGEROUS_EXTENSIONS.has(ext)) {
        return { valid: false, error: `File type "${ext}" is blocked for security reasons.` };
    }

    if (buffer.length < 4) {
        return { valid: false, error: 'File is too small to be valid.' };
    }

    // Zip-bomb protection: warn if very small ZIP (real Office docs are >2KB)
    if (buffer.length < 1024 && (ext === '.docx' || ext === '.xlsx' || ext === '.pptx')) {
        return { valid: false, error: 'File is suspiciously small for a document.' };
    }

    const header = Array.from(buffer.slice(0, 16));

    // Text/CSV — no magic bytes; validate content is actually text (not binary)
    if (TEXT_EXTENSIONS.has(ext)) {
        // SECURITY: Check if content is actually printable text (reject renamed binaries)
        const sample = buffer.subarray(0, Math.min(4096, buffer.length));
        let printableCount = 0;
        for (let i = 0; i < sample.length; i++) {
            const b = sample[i];
            // Allow tabs, newlines, carriage returns, and printable ASCII + UTF-8 continuation bytes
            if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127) || b >= 0x80) {
                printableCount++;
            }
        }
        if (sample.length > 0 && (printableCount / sample.length) < 0.90) {
            return { valid: false, error: 'File contains binary data but claims to be text. Possible MIME spoofing.' };
        }
        return { valid: true, mimeType: ext === '.csv' ? 'text/csv' : 'text/plain' };
    }

    for (const sig of MAGIC_SIGNATURES) {
        const matches = sig.bytes.every((byte, i) => header[i] === byte);
        if (!matches) continue;

        if (sig.mimeType === 'application/zip') {
            // Must be a known ZIP-based Office/OD* extension
            const resolved = ZIP_EXTENSION_MIME[ext];
            if (!resolved) {
                return { valid: false, error: `ZIP-based file with extension "${ext}" is not permitted.` };
            }
            return { valid: true, mimeType: resolved };
        }

        if (sig.mimeType === 'application/msoffice') {
            const resolved = OLE2_EXTENSION_MIME[ext];
            if (!resolved) {
                return { valid: false, error: `Legacy Office file with extension "${ext}" is not permitted.` };
            }
            return { valid: true, mimeType: resolved };
        }

        // Verify the detected MIME matches extension claim
        if (sig.mimeType === 'image/jpeg' && ext !== '.jpg' && ext !== '.jpeg') {
            return { valid: false, error: 'MIME/extension mismatch for JPEG.' };
        }
        if (sig.mimeType === 'image/png' && ext !== '.png') {
            return { valid: false, error: 'MIME/extension mismatch for PNG.' };
        }
        if (sig.mimeType === 'image/gif' && ext !== '.gif') {
            return { valid: false, error: 'MIME/extension mismatch for GIF.' };
        }
        if (sig.mimeType === 'image/webp' && ext !== '.webp') {
            return { valid: false, error: 'MIME/extension mismatch for WebP.' };
        }
        if (sig.mimeType === 'application/pdf' && ext !== '.pdf') {
            return { valid: false, error: 'MIME/extension mismatch for PDF.' };
        }

        return { valid: true, mimeType: sig.mimeType };
    }

    // Heuristics for common user mistakes (e.g. CSV, XML, HTML renamed to .xlsx)
    const sample = buffer.subarray(0, Math.min(4096, buffer.length));
    const sampleStr = sample.toString('utf-8').trimStart().toLowerCase();
    
    const isSpreadsheetExt = ext === '.xlsx' || ext === '.xls';

    if (sampleStr.startsWith('<?xml')) {
        return { valid: false, error: `File appears to be an XML document but has a "${ext}" extension.` };
    }
    if (sampleStr.startsWith('<html') || sampleStr.startsWith('<!doctype html') || sampleStr.startsWith('<table')) {
        return { valid: false, error: `HTML content is not allowed as "${ext}". Rename or export a real spreadsheet.` };
    }
    
    // Check if it's purely printable text (like a CSV)
    let printableCount = 0;
    for (let i = 0; i < sample.length; i++) {
        const b = sample[i];
        if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127) || b >= 0x80) printableCount++;
    }
    if (sample.length > 0 && (printableCount / sample.length) > 0.95) {
        if (isSpreadsheetExt) return { valid: true, mimeType: 'text/csv' };
        return { valid: false, error: `File appears to be a plain text/CSV document but has a "${ext}" extension.` };
    }

    return { valid: false, error: `Could not verify file integrity for "${ext}". Possible content mismatch.` };
}
