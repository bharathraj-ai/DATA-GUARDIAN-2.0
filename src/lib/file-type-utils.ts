/**
 * File type detection utilities for UniversalFileEditor.
 * Determines the correct editor type from MIME type and file extension.
 */

export type EditorType =
    | 'text'
    | 'json'
    | 'markdown'
    | 'csv'
    | 'spreadsheet'
    | 'richtext'
    | 'image'
    | 'pdf'
    | 'unsupported';

const TEXT_EXTENSIONS = ['txt', 'log', 'cfg', 'ini', 'env', 'yaml', 'yml', 'xml', 'html', 'css', 'js', 'ts', 'py', 'sh', 'bat'];
const SPREADSHEET_EXTENSIONS = ['xlsx', 'xls', 'ods'];
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'];

/**
 * Detect the editor type from a MIME type and optional file name.
 */
export function detectEditorType(mimeType: string, fileName?: string): EditorType {
    const ext = fileName?.split('.').pop()?.toLowerCase() || '';
    const mime = mimeType.toLowerCase();

    // JSON
    if (mime === 'application/json' || ext === 'json') return 'json';

    // Markdown
    if (mime === 'text/markdown' || ext === 'md' || ext === 'markdown') return 'markdown';

    // CSV
    if (mime === 'text/csv' || ext === 'csv') return 'csv';

    // Spreadsheet (xlsx, xls, ods)
    if (
        mime.includes('spreadsheet') ||
        mime.includes('excel') ||
        SPREADSHEET_EXTENSIONS.includes(ext)
    ) return 'spreadsheet';

    // PDF
    if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';

    // DOCX
    if (
        mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        mime === 'application/msword' ||
        ext === 'docx' ||
        ext === 'doc'
    ) return 'richtext';

    // Images
    if (mime.startsWith('image/') || IMAGE_EXTENSIONS.includes(ext)) return 'image';

    // Plain text (must be after more specific text/* checks)
    if (mime.startsWith('text/') || TEXT_EXTENSIONS.includes(ext)) return 'text';

    return 'unsupported';
}

/**
 * Get the Monaco language ID from the editor type / file extension.
 */
export function getMonacoLanguage(editorType: EditorType, fileName?: string): string {
    if (editorType === 'json') return 'json';
    if (editorType === 'markdown') return 'markdown';

    const ext = fileName?.split('.').pop()?.toLowerCase() || '';
    const langMap: Record<string, string> = {
        js: 'javascript',
        ts: 'typescript',
        py: 'python',
        html: 'html',
        css: 'css',
        xml: 'xml',
        yaml: 'yaml',
        yml: 'yaml',
        sh: 'shell',
        bat: 'bat',
    };

    return langMap[ext] || 'plaintext';
}

/**
 * Human-readable label for each editor type.
 */
export function getEditorLabel(editorType: EditorType): string {
    const labels: Record<EditorType, string> = {
        text: 'Text Editor',
        json: 'JSON Editor',
        markdown: 'Markdown Editor',
        csv: 'Spreadsheet Editor',
        spreadsheet: 'Spreadsheet Editor',
        richtext: 'Rich Text Editor',
        image: 'Image Editor',
        pdf: 'PDF Viewer',
        unsupported: 'Unsupported',
    };
    return labels[editorType];
}
