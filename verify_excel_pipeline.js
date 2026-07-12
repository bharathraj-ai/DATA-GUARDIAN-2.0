const fs = require('fs');
const XLSX = require('xlsx');

function uid() { return Math.random().toString(36).substring(2, 9); }

async function parseExcelMock(buffer) {
  console.log("\n--- Stage 1: XLSX workbook import ---");
  const workbook = XLSX.read(buffer, { type: "buffer" });
  console.log("workbook.SheetNames:", workbook.SheetNames);
  if (workbook.SheetNames.length === 1) {
    console.error("STOP: Stage 1 has only one worksheet.");
    return;
  }
  
  console.log("\n--- Stage 2 & 3: parseExcel() and DocumentData ---");
  const pages = [];
  const sheetNames = workbook.SheetNames;
  
  for (const sheetName of sheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    // simplified for brevity
    pages.push({ id: uid(), sheetName });
  }
  
  const document = { 
    type: "xlsx", 
    pages,
    metadata: {
      sheetNames,
      activeSheet: 0
    }
  };
  
  console.log("document.metadata.sheetNames:", document.metadata.sheetNames);
  console.log("document.pages.length:", document.pages.length);
  
  if (document.pages.length === 1) {
    console.error("STOP: Stage 2/3 lost the worksheets.");
    return;
  }
  
  console.log("\n--- Stage 4: Save/Load ---");
  const serialized = JSON.stringify(document);
  const deserialized = JSON.parse(serialized);
  console.log("deserialized.metadata.sheetNames:", deserialized.metadata.sheetNames);
  console.log("deserialized.pages.length:", deserialized.pages.length);
  
  console.log("\n--- Stage 5: SpreadsheetView ---");
  console.log("pages.length before rendering:", deserialized.pages.length);
  
  console.log("\n--- Stage 6: WorkbookTabs ---");
  const tabs = deserialized.metadata.sheetNames || deserialized.pages.map((_, i) => `Sheet${i + 1}`);
  console.log("Tabs to render:", tabs);
  
  console.log("\nAll verifications passed in isolated test!");
}

async function run() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["A"]]), "Sheet1");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["B"]]), "Attendance");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["C"]]), "Leave Register");
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  
  await parseExcelMock(buffer);
}
run();
