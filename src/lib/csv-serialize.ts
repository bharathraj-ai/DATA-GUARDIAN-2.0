/**
 * Minimal CSV helpers — avoids the vulnerable `xlsx` package for row export.
 */

export function cellToCsvField(cell: unknown): string {
  const s = cell === null || cell === undefined ? '' : String(cell);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function rowsToCsv(rows: unknown[][]): string {
  return rows.map((row) => (Array.isArray(row) ? row : []).map(cellToCsvField).join(',')).join('\n');
}
