/**
 * Document Export Module
 * 
 * Handles exporting editor blocks to:
 *  1. DOCX format (via hand-crafted OOXML + JSZip)
 *  2. PDF format (via pdf-lib)
 *
 * Unicode sanitization is applied for PDF export since
 * StandardFonts only support WinAnsi encoding.
 *
 * @module pdf/exporter
 */

import { loadScript } from "./parser";

/* ─── XML Escape Helper ─────────────────────────────────────────────── */
export function esc(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ─── WinAnsi Sanitizer (for pdf-lib StandardFonts) ─────────────────── */
function sanitize(str) {
  if (!str) return "";
  return str
    .replace(/[\u2018\u2019\u02BC\u02B9]/g, "'")
    .replace(/[\u201C\u201D\u201F\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2015\u2212]/g, "-")
    .replace(/[\u2022\u2219\u00B7]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[^\x20-\x7E]/g, "?")
    .trim();
}

/* ═══════════════════════════════════════════════════════════════
   DOCX EXPORT — Hand-crafted OOXML + JSZip
═══════════════════════════════════════════════════════════════ */

function buildDocxXML(blocks) {
  const bodyParts = [];

  for (const block of blocks) {
    if (block.type === "pagebreak") {
      bodyParts.push(`<w:p><w:r><w:br w:type="page"/></w:r></w:p>`);
      continue;
    }

    const styleMap = { h1: "Heading1", h2: "Heading2", h3: "Heading3", paragraph: "Normal", list: "ListParagraph" };
    const styleId = styleMap[block.type] || "Normal";
    const fontSize = block.fontSize ? block.fontSize * 2 : 24;

    let rpr = `<w:sz w:val="${fontSize}"/><w:szCs w:val="${fontSize}"/>`;
    if (block.bold || block.type.startsWith("h")) rpr += `<w:b/><w:bCs/>`;
    if (block.italic) rpr += `<w:i/><w:iCs/>`;

    const pStyle = `<w:pStyle w:val="${styleId}"/>`;
    const numPr = block.type === "list"
      ? `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>` : "";

    const text = esc(block.text || "");
    bodyParts.push(
      `<w:p>` +
      `<w:pPr>${pStyle}${numPr}</w:pPr>` +
      `<w:r><w:rPr>${rpr}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>` +
      `</w:p>`
    );
  }

  if (!bodyParts.length) bodyParts.push(`<w:p><w:r><w:t>Empty document</w:t></w:r></w:p>`);

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
  xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  mc:Ignorable="w14">
  <w:body>
    ${bodyParts.join("\n    ")}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;
}

function buildStylesXML() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
          xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="24"/></w:rPr></w:rPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Normal" w:default="1">
    <w:name w:val="Normal"/>
    <w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="24"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:outlineLvl w:val="0"/><w:spacing w:before="480" w:after="240"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Calibri Light" w:hAnsi="Calibri Light"/><w:b/><w:sz w:val="52"/><w:color w:val="2E74B5"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:outlineLvl w:val="1"/><w:spacing w:before="360" w:after="160"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Calibri Light" w:hAnsi="Calibri Light"/><w:b/><w:sz w:val="36"/><w:color w:val="2E74B5"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:outlineLvl w:val="2"/><w:spacing w:before="240" w:after="120"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Calibri Light" w:hAnsi="Calibri Light"/><w:b/><w:sz w:val="28"/><w:color w:val="1F4E79"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="ListParagraph">
    <w:name w:val="List Paragraph"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:ind w:left="720"/></w:pPr>
  </w:style>
</w:styles>`;
}

function buildNumberingXML() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0">
    <w:multiLevelType w:val="hybridMultilevel"/>
    <w:lvl w:ilvl="0">
      <w:start w:val="1"/>
      <w:numFmt w:val="bullet"/>
      <w:lvlText w:val="&#x2022;"/>
      <w:lvlJc w:val="left"/>
      <w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>
    </w:lvl>
  </w:abstractNum>
  <w:num w:numId="1">
    <w:abstractNumId w:val="0"/>
  </w:num>
</w:numbering>`;
}

/**
 * Build a .docx Blob from editor blocks.
 * 
 * @param {Array} blocks - Document blocks
 * @param {(progress: number) => void} onProgress
 * @returns {Promise<Blob>}
 */
export async function buildDocx(blocks, onProgress) {
  await loadScript(
    "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
    "jszip-main"
  );

  onProgress(85);
  const zip = new window.JSZip();

  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
  <Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
</Types>`);

  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);

  zip.file("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
</Relationships>`);

  zip.file("word/document.xml", buildDocxXML(blocks));
  zip.file("word/styles.xml", buildStylesXML());
  zip.file("word/numbering.xml", buildNumberingXML());
  zip.file("word/settings.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:defaultTabStop w:val="720"/>
  <w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>
</w:settings>`);

  onProgress(95);
  const blob = await zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  onProgress(100);
  return blob;
}

/**
 * Build a PDF File from editor blocks using pdf-lib.
 * Handles Unicode sanitization for WinAnsi encoding.
 * 
 * @param {Array} blocks - Document blocks
 * @param {File|null} sourceFile - Original file (for naming)
 * @param {(progress: number, label?: string) => void} onProgress
 * @returns {Promise<File>}
 */
export async function buildPdfExport(blocks, sourceFile, onProgress) {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
  const fontBoldItalic = await pdfDoc.embedFont(StandardFonts.HelveticaBoldOblique);

  const PAGE_W = 595.28; // A4
  const PAGE_H = 841.89;
  const MARGIN = 50;
  const usable = PAGE_W - MARGIN * 2;

  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const sizeMap = { h1: 22, h2: 18, h3: 15, paragraph: 11, list: 11 };
  const lineSpacing = 1.5;

  const pickFont = (block) => {
    if (block.bold && block.italic) return fontBoldItalic;
    if (block.bold) return fontBold;
    if (block.italic) return fontItalic;
    return fontRegular;
  };

  const wrapText = (text, font, size, maxW) => {
    const words = (text || "").split(/\s+/);
    const lines = [];
    let cur = "";
    for (const word of words) {
      const test = cur ? cur + " " + word : word;
      const w = font.widthOfTextAtSize(test, size);
      if (w > maxW && cur) {
        lines.push(cur);
        cur = word;
      } else {
        cur = test;
      }
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [""];
  };

  for (let bi = 0; bi < blocks.length; bi++) {
    const p = 60 + Math.round((bi / (blocks.length || 1)) * 30);
    onProgress(p);
    const block = blocks[bi];

    if (block.type === "pagebreak") {
      page = pdfDoc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
      continue;
    }

    const sz = sizeMap[block.type] || 11;
    const font = pickFont(block);
    const rawText = block.type === "list" ? "  -  " + (block.text || "") : (block.text || "");
    const text = sanitize(rawText);
    const wrapped = wrapText(text, font, sz, usable);
    const lineH = sz * lineSpacing;
    const blockH = wrapped.length * lineH + (block.type.startsWith("h") ? sz * 0.6 : sz * 0.3);

    // New page if not enough space
    if (y - blockH < MARGIN) {
      page = pdfDoc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }

    // Heading top spacing
    if (block.type.startsWith("h")) y -= sz * 0.4;

    const color = block.type.startsWith("h") ? rgb(0.14, 0.28, 0.63) : rgb(0.1, 0.1, 0.1);

    for (const line of wrapped) {
      try {
        page.drawText(line, { x: MARGIN, y, size: sz, font, color });
      } catch (err) {
        console.warn("Skipping line due to render error:", line, err);
      }
      y -= lineH;
    }

    // Bottom spacing
    y -= block.type.startsWith("h") ? sz * 0.3 : sz * 0.2;
  }

  onProgress(92, "Finalising PDF…");
  const pdfBytes = await pdfDoc.save();
  const blob = new Blob([pdfBytes], { type: "application/pdf" });
  const name = (sourceFile?.name || "document").replace(/\.pdf$/i, "");
  return new File([blob], name + "_edited.pdf", { type: "application/pdf" });
}
