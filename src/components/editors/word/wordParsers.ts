export type WordDocument = {
    type: 'word';
    name: string;
    html: string;
    sourceExt: string;
};

export { isWordLikeFile } from './isWordLikeFile';

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function textToHtml(text: string): string {
    const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/);
    if (!blocks.some((b) => b.trim())) {
        return '<p></p>';
    }
    return blocks
        .map((block) => {
            const lines = block.split('\n').map((line) => escapeHtml(line) || '<br>');
            return `<p>${lines.join('<br>')}</p>`;
        })
        .join('');
}

function looksLikeWordWorkspace(raw: string): WordDocument | null {
    try {
        const parsed = JSON.parse(raw) as Partial<WordDocument> & { pages?: unknown };
        if (parsed?.type === 'word' && typeof parsed.html === 'string') {
            return {
                type: 'word',
                name: typeof parsed.name === 'string' ? parsed.name : 'document.docx',
                html: parsed.html || '<p></p>',
                sourceExt: parsed.sourceExt || '.docx',
            };
        }
        if (parsed?.type && Array.isArray(parsed.pages)) {
            const pages = parsed.pages as Array<{ elements?: Array<{ type?: string; content?: string }> }>;
            const parts = pages.flatMap((page) =>
                (page.elements || [])
                    .filter((el) => el.type === 'text' && el.content)
                    .map((el) => `<p>${escapeHtml(String(el.content))}</p>`),
            );
            if (parts.length) {
                return {
                    type: 'word',
                    name: typeof parsed.name === 'string' ? parsed.name : 'document.docx',
                    html: parts.join(''),
                    sourceExt: '.docx',
                };
            }
        }
    } catch {
        /* not JSON */
    }
    return null;
}

async function parsePdf(file: File): Promise<string> {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjs.getDocument({ data }).promise;
    const parts: string[] = [];

    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const lines: string[] = [];
        let current = '';
        let lastY: number | null = null;

        for (const item of content.items) {
            if (!('str' in item)) continue;
            const y = 'transform' in item ? Number((item as { transform: number[] }).transform[5]) : 0;
            if (lastY !== null && Math.abs(lastY - y) > 6 && current.trim()) {
                lines.push(current.trimEnd());
                current = '';
            }
            current += item.str;
            if (!(item as { hasEOL?: boolean }).hasEOL) current += ' ';
            lastY = y;
        }
        if (current.trim()) lines.push(current.trimEnd());

        const pageHtml = lines
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => `<p>${escapeHtml(line)}</p>`)
            .join('');
        if (pageHtml) {
            if (i > 1) parts.push('<hr>');
            parts.push(pageHtml);
        }
    }

    return parts.join('') || '<p></p>';
}

async function parseDocx(file: File): Promise<string> {
    const mammoth = await import('mammoth');
    const result = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
    return result.value?.trim() ? result.value : '<p></p>';
}

export async function parseWordFile(file: File): Promise<WordDocument> {
    const name = file.name || 'document';
    const ext = `.${(name.split('.').pop() || '').toLowerCase()}`;
    const sourceExt = ['.pdf', '.doc', '.docx', '.odt', '.txt'].includes(ext) ? ext : '.docx';

    try {
        const raw = await file.text();
        const workspace = looksLikeWordWorkspace(raw);
        if (workspace) {
            return { ...workspace, name, sourceExt: workspace.sourceExt || sourceExt };
        }
        if (sourceExt === '.txt' || file.type === 'text/plain') {
            return { type: 'word', name, html: textToHtml(raw), sourceExt: '.txt' };
        }
    } catch {
        /* binary */
    }

    if (sourceExt === '.pdf' || file.type === 'application/pdf') {
        return { type: 'word', name, html: await parsePdf(file), sourceExt: '.pdf' };
    }

    if (['.doc', '.docx', '.odt'].includes(sourceExt) || /word|opendocument\.text/i.test(file.type)) {
        try {
            return { type: 'word', name, html: await parseDocx(file), sourceExt };
        } catch {
            return {
                type: 'word',
                name,
                html: '<p>This document could not be opened for editing. Try saving it as .docx and upload again.</p>',
                sourceExt,
            };
        }
    }

    return { type: 'word', name, html: '<p></p>', sourceExt };
}

