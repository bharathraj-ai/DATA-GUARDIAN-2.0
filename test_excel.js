const XLSX = require("xlsx");

// Create a workbook with multiple sheets
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["A"]]), "Sheet1");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["B"]]), "Attendance");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["C"]]), "Leave Register");

const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

// Now read it back
const readWb = XLSX.read(buffer, { type: "buffer" });
console.log(readWb.SheetNames);
