import * as fs from 'fs';
import * as XLSX from 'xlsx';
import { parseExcel } from './src/components/editors/utils/fileParsers';

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
  } as any;

  console.log("Parsing...");
  const result = await parseExcel(file);
  console.log("Doc type:", result.type);
  console.log("Pages length:", result.pages.length);
  console.log("Metadata sheetNames:", result.metadata?.sheetNames);
}

main().catch(console.error);
