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
  const cols = Math.max(...rows.map(r => r.length));
  const colW = Math.min(120, Math.floor(680 / cols));
  return { 
    type: "csv", name: file.name, 
    pages: [{ id: uid(), width: 794, height: Math.max(1122, rows.length * 28 + 120), elements: [{ id: uid(), type: "table", x: 57, y: 60, width: cols * colW, height: rows.length * 28 + 2, rows, colW, rowH: 28, selected: false, hasHeader: true } as TableElementData], bgImage: null }] 
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
  const XLSX = await import("xlsx");
  const ab = await file.arrayBuffer();
  const workbook = XLSX.read(ab, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
  const strRows = rows.map((r: any) => (r || []).map((c: any) => ({ value: c !== undefined && c !== null ? String(c) : "" })));
  const cols = Math.max(...strRows.map(r => r.length), 1);
  strRows.forEach(r => { while (r.length < cols) r.push({ value: "" }); });
  const colW = Math.max(60, Math.min(120, Math.floor(680 / cols)));
  return { 
    type: file.name.endsWith(".csv") ? "csv" : "xlsx", name: file.name, 
    pages: [{ id: uid(), width: 794, height: Math.max(1122, strRows.length * 28 + 120), elements: [{ id: uid(), type: "table", x: 57, y: 60, width: cols * colW, height: strRows.length * 28 + 2, rows: strRows, colW, rowH: 28, selected: false, hasHeader: true } as TableElementData], bgImage: null }] 
  };
}

export async function parseFile(file: File): Promise<DocumentData> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  if (ext === "pdf") throw new Error("PDF files cannot be edited. They are view-only.");

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
