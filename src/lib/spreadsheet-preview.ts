import 'server-only';
import ExcelJS from 'exceljs';

export type PreviewCell = string | number | boolean | '';

function cellToPreview(value: unknown): PreviewCell {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const rich = value as { text?: unknown; result?: unknown; hyperlink?: unknown };
    if (rich.result !== undefined) return cellToPreview(rich.result);
    if (typeof rich.text === 'string') return rich.text;
    if (typeof rich.hyperlink === 'string') return rich.hyperlink;
    return '';
  }
  return String(value);
}

/**
 * First `limit` rows of an XLSX via ExcelJS — never SheetJS (xlsx@0.18.x).
 * Rejects OLE2 .xls; callers should treat CSV separately.
 */
export async function previewXlsxRows(
  buffer: Buffer,
  limit: number,
): Promise<{ rows: PreviewCell[][]; total: number }> {
  if (!buffer?.length) {
    throw new Error('Spreadsheet is empty');
  }
  // PK zip header — ExcelJS cannot safely parse BIFF .xls
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new Error('Only .xlsx spreadsheets can be previewed on the server');
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw new Error('Spreadsheet has no readable sheets');
  }

  const all: PreviewCell[][] = [];
  const colCount = Math.max(sheet.columnCount || 0, 1);

  sheet.eachRow({ includeEmpty: false }, (row) => {
    const raw = Array.isArray(row.values) ? row.values.slice(1) : [];
    const width = Math.max(colCount, raw.length);
    const cells: PreviewCell[] = [];
    for (let i = 0; i < width; i++) {
      cells.push(cellToPreview(raw[i]));
    }
    all.push(cells);
  });

  return { rows: all.slice(0, Math.max(0, limit)), total: all.length };
}
