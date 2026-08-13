import {
    AlignmentType,
    Document,
    HeadingLevel,
    Packer,
    Paragraph,
    Table,
    TableCell,
    TableRow,
    TextRun,
    WidthType,
    type IParagraphOptions,
} from 'docx';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

function withExt(name: string, ext: string): string {
    const base = name.replace(/\.[^.]+$/, '') || 'document';
    return `${base}${ext}`;
}

function htmlToPlainParagraphs(html: string): string[] {
    if (typeof DOMParser === 'undefined') {
        return html.replace(/<[^>]+>/g, ' ').split(/\n+/).map((s) => s.trim()).filter(Boolean);
    }
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
    const blocks = Array.from(doc.body.querySelectorAll('p, h1, h2, h3, h4, li, div'));
    if (!blocks.length) {
        const text = doc.body.textContent?.trim();
        return text ? [text] : [''];
    }
    return blocks
        .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean);
}

function runsFromNode(node: Node, marks: { bold?: boolean; italics?: boolean; underline?: boolean } = {}): TextRun[] {
    if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent || '';
        if (!text) return [];
        return [new TextRun({ text, bold: marks.bold, italics: marks.italics, underline: marks.underline ? {} : undefined })];
    }
    if (!(node instanceof HTMLElement)) return [];
    const next = {
        bold: marks.bold || ['STRONG', 'B'].includes(node.tagName),
        italics: marks.italics || ['EM', 'I'].includes(node.tagName),
        underline: marks.underline || node.tagName === 'U',
    };
    return Array.from(node.childNodes).flatMap((child) => runsFromNode(child, next));
}

function paragraphFromElement(el: HTMLElement): Paragraph {
    const tag = el.tagName.toLowerCase();
    const align = (el.style.textAlign || el.getAttribute('style') || '').toLowerCase();
    const alignment =
        align.includes('center') ? AlignmentType.CENTER
            : align.includes('right') ? AlignmentType.RIGHT
                : align.includes('justify') ? AlignmentType.JUSTIFIED
                    : AlignmentType.LEFT;

    const heading =
        tag === 'h1' ? HeadingLevel.HEADING_1
            : tag === 'h2' ? HeadingLevel.HEADING_2
                : tag === 'h3' ? HeadingLevel.HEADING_3
                    : undefined;
    const options: IParagraphOptions = {
        children: runsFromNode(el).length ? runsFromNode(el) : [new TextRun(el.textContent || '')],
        alignment,
        heading,
    };
    return new Paragraph(options);
}

function tableFromElement(tableEl: HTMLTableElement): Table {
    const rows = Array.from(tableEl.rows).map((row) =>
        new TableRow({
            children: Array.from(row.cells).map((cell) =>
                new TableCell({
                    children: [new Paragraph({ children: [new TextRun(cell.textContent || '')] })],
                }),
            ),
        }),
    );
    return new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: rows.length ? rows : [new TableRow({ children: [new TableCell({ children: [new Paragraph('')] })] })],
    });
}

export async function exportWordHtml(html: string, fileName: string, sourceExt: string): Promise<File> {
    const ext = sourceExt.toLowerCase();
    if (ext === '.pdf') return exportHtmlToPdf(html, fileName);
    if (ext === '.txt') {
        const text = htmlToPlainParagraphs(html).join('\n\n') || '';
        return new File([text], withExt(fileName, '.txt'), { type: 'text/plain' });
    }
    return exportHtmlToDocx(html, fileName);
}

export async function exportHtmlToDocx(html: string, fileName: string): Promise<File> {
    const parsed = new DOMParser().parseFromString(`<div id="root">${html || '<p></p>'}</div>`, 'text/html');
    const root = parsed.getElementById('root') || parsed.body;
    const children: Array<Paragraph | Table> = [];

    const walk = (el: Element) => {
        const tag = el.tagName.toLowerCase();
        if (tag === 'table') {
            children.push(tableFromElement(el as HTMLTableElement));
            return;
        }
        if (['p', 'h1', 'h2', 'h3', 'h4', 'li'].includes(tag)) {
            children.push(paragraphFromElement(el as HTMLElement));
            return;
        }
        if (tag === 'ul' || tag === 'ol' || tag === 'div' || tag === 'blockquote') {
            Array.from(el.children).forEach(walk);
            return;
        }
        if (tag === 'hr') {
            children.push(new Paragraph({ text: '' }));
        }
    };

    Array.from(root.children).forEach(walk);
    if (!children.length) children.push(new Paragraph({ text: root.textContent || '' }));

    const doc = new Document({
        sections: [{ properties: {}, children }],
    });
    const blob = await Packer.toBlob(doc);
    return new File([blob], withExt(fileName, '.docx'), {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
}

export async function exportHtmlToPdf(html: string, fileName: string): Promise<File> {
    const paragraphs = htmlToPlainParagraphs(html);
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.TimesRoman);
    const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
    const pageWidth = 612;
    const pageHeight = 792;
    const margin = 72;
    const maxWidth = pageWidth - margin * 2;
    const size = 12;
    const lineHeight = 16;

    let page = pdf.addPage([pageWidth, pageHeight]);
    let y = pageHeight - margin;

    const wrap = (text: string, useBold = false) => {
        const face = useBold ? bold : font;
        const words = text.split(/\s+/);
        let line = '';
        const lines: string[] = [];
        for (const word of words) {
            const next = line ? `${line} ${word}` : word;
            if (face.widthOfTextAtSize(next, size) > maxWidth && line) {
                lines.push(line);
                line = word;
            } else {
                line = next;
            }
        }
        if (line) lines.push(line);
        return { lines, face };
    };

    for (const para of paragraphs.length ? paragraphs : ['']) {
        const heading = para.length < 80 && para === para.toUpperCase() && /[A-Z]/.test(para);
        const { lines, face } = wrap(para, heading);
        for (const line of lines) {
            if (y < margin + lineHeight) {
                page = pdf.addPage([pageWidth, pageHeight]);
                y = pageHeight - margin;
            }
            page.drawText(line, {
                x: margin,
                y,
                size,
                font: face,
                color: rgb(0.07, 0.09, 0.15),
            });
            y -= lineHeight;
        }
        y -= 8;
    }

    const bytes = await pdf.save();
    return new File([new Uint8Array(bytes)], withExt(fileName, '.pdf'), { type: 'application/pdf' });
}
