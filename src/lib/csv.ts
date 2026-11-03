/** RFC4180-ish CSV from already-trusted in-memory rows (no SheetJS). */
export function rowsToCsv(rows: unknown[][]): string {
  return rows
    .map((row) =>
      (Array.isArray(row) ? row : []).map((cell) => {
        const s = cell === null || cell === undefined ? '' : String(cell);
        if (/[",\n\r]/.test(s)) {
          return `"${s.replace(/"/g, '""')}"`;
        }
        return s;
      }).join(','),
    )
    .join('\n');
}
