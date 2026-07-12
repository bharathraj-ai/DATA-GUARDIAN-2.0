const fs = require('fs');
const XLSX = require('xlsx');

// We can't import fileParsers.ts directly in CommonJS without compiling,
// so let's inline the exact logic of parseExcel.

function uid() { return Math.random().toString(36).substring(2); }

async function parseExcel(file) {
  const ab = await file.arrayBuffer();
  const workbook = XLSX.read(ab, { type: "array" });
  
  const pages = [];
  const sheetNames = workbook.SheetNames;

  for (const sheetName of sheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    const strRows = rows.map((r) => (r || []).map((c) => ({ value: c !== undefined && c !== null ? String(c) : "" })));
    const cols = Math.max(...strRows.map(r => r.length), 1);
    strRows.forEach(r => { while (r.length < cols) r.push({ value: "" }); });
    
    const colWidths = Array(cols).fill(60);
    const excelCols = worksheet['!cols'];
    
    for (let c = 0; c < cols; c++) {
      if (excelCols && excelCols[c] && typeof excelCols[c] === 'object') {
        const colMeta = excelCols[c];
        if (colMeta.wpx) {
          colWidths[c] = Math.max(60, colMeta.wpx);
        } else if (colMeta.width) {
          colWidths[c] = Math.max(60, colMeta.width * 8);
        } else {
          let maxLen = 5;
          for (const row of strRows) {
            if (row[c] && row[c].value.length > maxLen) {
              maxLen = row[c].value.length;
            }
          }
          colWidths[c] = Math.min(400, Math.max(60, maxLen * 8));
        }
      } else {
        let maxLen = 5;
        for (const row of strRows) {
          if (row[c] && row[c].value.length > maxLen) {
            maxLen = row[c].value.length;
          }
        }
        colWidths[c] = Math.min(400, Math.max(60, maxLen * 8));
      }
    }

    const tableWidth = colWidths.reduce((a, b) => a + b, 0);
    const pageWidth = Math.max(794, tableWidth + 57 * 2);

    pages.push({
      id: uid(), width: pageWidth, height: Math.max(1122, strRows.length * 28 + 120), 
      elements: [{ id: uid(), type: "table", x: 57, y: 60, width: tableWidth, height: strRows.length * 28 + 2, rows: strRows, colW: 100, colWidths, rowH: 28, selected: false, hasHeader: true }], 
      bgImage: null
    });
  }

  return { 
    type: file.name.endsWith(".csv") ? "csv" : "xlsx", name: file.name, 
    pages,
    metadata: {
      sheetNames,
      activeSheet: 0
    }
  };
}

async function main() {
  // Create a multi-sheet Excel file
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["A"]]), "Sheet1");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["B"]]), "Attendance");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["C"]]), "Leave Register");
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  // Mock File object
  const file = {
    name: "test.xlsx",
    arrayBuffer: async () => buffer
  };

  console.log("Parsing...");
  const result = await parseExcel(file);
  console.log("Doc type:", result.type);
  console.log("Pages length:", result.pages.length);
  console.log("Metadata sheetNames:", result.metadata?.sheetNames);
}

main().catch(console.error);
