import { DocumentData, TextElementData, ImageElementData, TableElementData, ZipEntryElementData } from "../types";
import { uid } from "./editorUtils";

export async function parseTXT(file: File): Promise<DocumentData> {
  const text = await file.text();
  const lines = text.split("\n");
  const elements: TextElementData[] = lines.map((line, i) => ({
    id: uid(), type: "text", content: line || " ",
    x: 60, y: 60 + i * 24, width: 680, height: 22,
    font: "Georgia", size: 12, bold: false, italic: false, color: "#1a1a1a", selected: false
  }));
  return { 
    type: "txt", name: file.name, 
    pages: [{ id: uid(), width: 794, height: Math.max(1122, 60 + lines.length * 24 + 80), elements, bgImage: null }] 
  };
}

export async function parseImage(file: File): Promise<DocumentData> {
  const src = await new Promise<string>(r => { 
    const fr = new FileReader(); 
    fr.onload = e => r(e.target?.result as string); 
    fr.readAsDataURL(file); 
  });
  return { 
    type: "image", name: file.name, 
    pages: [{ id: uid(), width: 794, height: 1122, elements: [{ id: uid(), type: "image", src, x: 97, y: 60, width: 600, height: 400, selected: false } as ImageElementData], bgImage: null }] 
  };
}

export async function parseCSV(file: File): Promise<DocumentData> {
  const text = await file.text();
  const rows = text.split("\n").filter(Boolean).map(r => r.split(",").map(c => ({ value: c.replace(/^"|"$/g, "").trim() })));
  const cols = Math.max(...rows.map(r => r.length), 1);
  rows.forEach(r => { while (r.length < cols) r.push({ value: "" }); });
  const colWidths = Array(cols).fill(60);
  for (let c = 0; c < cols; c++) {
    let maxLen = 5;
    for (const row of rows) {
      if (row[c] && row[c].value.length > maxLen) {
        maxLen = row[c].value.length;
      }
    }
    colWidths[c] = Math.min(400, Math.max(60, maxLen * 8));
  }
  const tableWidth = colWidths.reduce((a, b) => a + b, 0);
  const pageWidth = Math.max(794, tableWidth + 57 * 2);
  
  return { 
    type: "csv", name: file.name, 
    pages: [{ id: uid(), width: pageWidth, height: Math.max(1122, rows.length * 28 + 120), elements: [{ id: uid(), type: "table", x: 57, y: 60, width: tableWidth, height: rows.length * 28 + 2, rows, colW: 100, colWidths, rowH: 28, selected: false, hasHeader: true } as TableElementData], bgImage: null }] 
  };
}

export async function parseZIP(file: File): Promise<DocumentData> {
  await new Promise<void>((res, rej) => { 
    if ((window as any).JSZip) return res(); 
    const s = document.createElement("script"); 
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"; 
    s.onload = () => res(); 
    s.onerror = rej; 
    document.head.appendChild(s); 
  });
  const ab = await file.arrayBuffer();
  const zip = await (window as any).JSZip.loadAsync(ab);
  const entries: any[] = [];
  zip.forEach((path: string, f: any) => { if (!f.dir) entries.push({ path, file: f }); });
  const items = await Promise.all(entries.map(async ({ path, file: f }) => {
    const ext = path.split(".").pop()?.toLowerCase() || "";
    let preview: string | null = null;
    if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) { 
      const blob = await f.async("blob"); 
      preview = URL.createObjectURL(blob); 
    }
    const size = (await f.async("arraybuffer")).byteLength;
    return { id: uid(), path, ext, size, preview };
  }));
  const elements: ZipEntryElementData[] = items.map((item, i) => ({ 
    id: item.id, type: "zipentry", path: item.path, ext: item.ext, size: item.size, preview: item.preview, 
    x: 57 + (i % 4) * 175, y: 80 + Math.floor(i / 4) * 200, width: 160, height: 175, selected: false 
  }));
  return { 
    type: "zip", name: file.name, 
    pages: [{ id: uid(), width: 794, height: Math.max(1122, 80 + Math.ceil(items.length / 4) * 200 + 80), elements, bgImage: null }] 
  };
}

export async function parseExcel(file: File): Promise<DocumentData> {
  if (file.name.toLowerCase().endsWith(".xls") && !file.name.toLowerCase().endsWith(".xlsx")) {
    throw new Error("Legacy .xls is not supported. Save as .xlsx or .csv.");
  }
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const ab = await file.arrayBuffer();
  await workbook.xlsx.load(ab);

  const pages: DocumentData["pages"] = [];
  const sheetNames: string[] = [];

  workbook.eachSheet((worksheet) => {
    const sheetName = worksheet.name;
    sheetNames.push(sheetName);
    const strRows: Array<Array<{ value: string }>> = [];
    worksheet.eachRow({ includeEmpty: true }, (row) => {
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      strRows.push(
        values.map((c) => ({
          value: c !== undefined && c !== null ? String(typeof c === "object" && c && "text" in (c as object) ? (c as { text: string }).text : c) : "",
        })),
      );
    });
    const cols = Math.max(...strRows.map((r) => r.length), 1);
    strRows.forEach((r) => {
      while (r.length < cols) r.push({ value: "" });
    });

    const colWidths = Array(cols).fill(60) as number[];
    for (let c = 0; c < cols; c++) {
      const col = worksheet.getColumn(c + 1);
      if (col.width) {
        colWidths[c] = Math.max(60, Number(col.width) * 8);
      } else {
        let maxLen = 5;
        for (const row of strRows) {
          if (row[c] && row[c].value.length > maxLen) maxLen = row[c].value.length;
        }
        colWidths[c] = Math.min(400, Math.max(60, maxLen * 8));
      }
    }

    const tableWidth = colWidths.reduce((a, b) => a + b, 0);
    const pageWidth = Math.max(794, tableWidth + 57 * 2);

    pages.push({
      id: uid(),
      width: pageWidth,
      height: Math.max(1122, strRows.length * 28 + 120),
      elements: [
        {
          id: uid(),
          type: "table",
          x: 57,
          y: 60,
          width: tableWidth,
          height: strRows.length * 28 + 2,
          rows: strRows,
          colW: 100,
          colWidths,
          rowH: 28,
          selected: false,
          hasHeader: true,
        } as TableElementData,
      ],
      bgImage: null,
    });
  });

  return {
    type: file.name.endsWith(".csv") ? "csv" : "xlsx",
    name: file.name,
    pages,
    metadata: {
      sheetNames,
      activeSheet: 0,
    },
  };
}

export async function parseFile(file: File): Promise<DocumentData> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  if (ext === "pdf" || ext === "doc" || ext === "docx" || ext === "odt") {
    throw new Error("Open this file in the Word editor.");
  }

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (
      parsed &&
      typeof parsed.type === "string" &&
      typeof parsed.name === "string" &&
      Array.isArray(parsed.pages) &&
      parsed.pages.length > 0 &&
      parsed.pages.every((p: any) => p && typeof p.id === "string" && Array.isArray(p.elements))
    ) {
      return parsed as DocumentData;
    }
  } catch (e) {
    // Not a JSON workspace — proceed to standard file parsing
  }

  if (ext === "txt") return parseTXT(file);
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return parseImage(file);
  if (["csv"].includes(ext)) return parseCSV(file);
  if (["xlsx", "xls"].includes(ext)) return parseExcel(file);
  if (ext === "zip") return parseZIP(file);
  return parseTXT(file);
}
