/**
 * PDF Parser Module
 * 
 * Handles loading pdf.js from CDN and extracting structured text + page images.
 * Uses Blob URLs instead of base64 data URLs for memory efficiency.
 * 
 * @module pdf/parser
 */

/* ─── CDN Script Loader (shared, idempotent) ────────────────────────── */
export function loadScript(src, id, globalName) {
  return new Promise((res, rej) => {
    if (globalName && (window[globalName] || window["pdfjs-dist/build/pdf"])) { res(); return; }
    if (document.getElementById(id)) {
      const wait = () => {
        if (window[globalName] || window["pdfjs-dist/build/pdf"]) res();
        else setTimeout(wait, 50);
      };
      wait();
      return;
    }
    const s = document.createElement("script");
    s.id = id; s.src = src;
    s.onload = () => {
      const wait = () => {
        if (window[globalName] || window["pdfjs-dist/build/pdf"]) res();
        else setTimeout(wait, 50);
      };
      wait();
    };
    s.onerror = rej;
    document.head.appendChild(s);
  });
}

/**
 * Parse a PDF File into structured page data.
 * 
 * Each page contains:
 *  - width/height: viewport dimensions
 *  - lines[]: text items grouped into visual lines
 *  - pageImg: Blob URL for the rendered page image (memory-efficient)
 *
 * @param {File} file - PDF file to parse
 * @param {(progress: number, currentPage?: number, totalPages?: number) => void} [onProgress]
 * @returns {Promise<{numPages: number, pages: Array, blobUrls: string[]}>}
 */
export async function parsePDF(file, onProgress) {
  await loadScript(
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
    "pdfjs-main",
    "pdfjsLib"
  );
  const lib = window["pdfjs-dist/build/pdf"] || window["pdfjsLib"];
  if (!lib) throw new Error("PDF.js failed to load from CDN.");
  lib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  const ab = await file.arrayBuffer();
  const pdf = await lib.getDocument({ data: ab }).promise;
  const pages = [];
  const blobUrls = []; // Track for cleanup

  for (let i = 1; i <= pdf.numPages; i++) {
    if (onProgress) onProgress(Math.round((i / pdf.numPages) * 40), i, pdf.numPages);
    const page = await pdf.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();

    // Render to canvas → Blob URL (not base64, saves ~33% memory)
    const canvas = document.createElement("canvas");
    const scale = 1.5;
    canvas.width = vp.width * scale;
    canvas.height = vp.height * scale;
    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport: page.getViewport({ scale }) }).promise;

    // Convert canvas to Blob URL instead of dataURL
    const pageImg = await new Promise((resolve) => {
      canvas.toBlob((blob) => {
        if (blob) {
          const url = URL.createObjectURL(blob);
          blobUrls.push(url);
          resolve(url);
        } else {
          // Fallback to dataURL if toBlob fails
          resolve(canvas.toDataURL("image/png"));
        }
      }, "image/png");
    });

    // Group text items into lines
    const lines = [];
    let buf = [], lastY = null;
    const flush = () => {
      if (!buf.length) return;
      const f = buf[0];
      const text = buf.map(x => x.str).join(" ").trim();
      if (!text) { buf = []; return; }
      lines.push({
        text,
        x: Math.round(f.transform[4]),
        y: Math.round(vp.height - f.transform[5]),
        fontSize: Math.round(Math.abs(f.transform[3]) || 12),
        fontName: (f.fontName || "").toLowerCase(),
        bold: /bold/i.test(f.fontName || ""),
        italic: /italic|oblique/i.test(f.fontName || ""),
        width: buf.reduce((s, x) => s + (x.width || 0), 0),
      });
      buf = [];
    };
    for (const item of tc.items) {
      const y = Math.round(item.transform[5]);
      if (lastY !== null && Math.abs(y - lastY) > 1.5) flush();
      buf.push(item);
      lastY = y;
    }
    flush();

    pages.push({ width: Math.round(vp.width), height: Math.round(vp.height), lines, pageImg });
  }
  return { numPages: pdf.numPages, pages, blobUrls };
}

/**
 * Revoke all Blob URLs created during parsing.
 * Call this when the editor unmounts or a new file is loaded.
 * 
 * @param {string[]} blobUrls - Array of Blob URLs to revoke
 */
export function revokeBlobUrls(blobUrls) {
  if (!blobUrls) return;
  for (const url of blobUrls) {
    try {
      if (url && url.startsWith("blob:")) {
        URL.revokeObjectURL(url);
      }
    } catch { /* ignore revocation errors */ }
  }
}
