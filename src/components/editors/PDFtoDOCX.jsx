import { useState, useRef, useCallback, useEffect } from "react";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

/* ─── tiny uid ─────────────────────────────────────────────────── */
const uid = () => Math.random().toString(36).slice(2, 9);

/* ─── inject CDN scripts ───────────────────────────────────────── */
function loadScript(src, id, globalName) {
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

/* ═══════════════════════════════════════════════════════════════
   STEP 1 – Parse PDF with pdf.js → structured JSON
═══════════════════════════════════════════════════════════════ */
async function parsePDF(file, onProgress) {
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

  for (let i = 1; i <= pdf.numPages; i++) {
    if (onProgress) onProgress(Math.round((i / pdf.numPages) * 40), i, pdf.numPages);
    const page = await pdf.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();

    // render to canvas for image extraction
    const canvas = document.createElement("canvas");
    const scale = 1.5;
    canvas.width = vp.width * scale;
    canvas.height = vp.height * scale;
    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport: page.getViewport({ scale }) }).promise;
    const pageImg = canvas.toDataURL("image/png");

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
  return { numPages: pdf.numPages, pages };
}

/* ═══════════════════════════════════════════════════════════════
   STEP 2 – Infer document structure from raw lines
   Enhanced: detects alphabetic lists, roman numerals, numbered
   items, section headers, and splits blocks per logical item.
═══════════════════════════════════════════════════════════════ */
const LIST_RE = /^(?:\d+[\.\)\:]|[a-zA-Z][\.\)]|[ivxlcdm]+[\.\)]|[•\-\*\–\—]|\(?[a-zA-Z]\)|\(?\d+\))\s/i;
const SECTION_RE = /^(?:PART\s+[A-Z0-9]|SECTION\s+[A-Z0-9]|CHAPTER\s+[0-9])/i;

function classifyLine(line, medianSize) {
  const t = (line.text || "").trim();
  if (!t) return "paragraph";
  // Section headers like "PART A(1 MARK)"
  if (SECTION_RE.test(t)) return "h2";
  // Large font → heading
  if (line.fontSize >= medianSize * 1.8) return "h1";
  if (line.fontSize >= medianSize * 1.4) return "h2";
  if (line.fontSize >= medianSize * 1.15 && line.bold) return "h3";
  // All-caps short lines are likely headings
  if (t === t.toUpperCase() && t.length < 60 && t.length > 2 && /[A-Z]/.test(t)) return "h3";
  // List patterns: 1. / a. / a) / (a) / • / - / i. / ii.
  if (LIST_RE.test(t)) return "list";
  return "paragraph";
}

function inferStructure(parsed) {
  const allLines = parsed.pages.flatMap(p => p.lines);
  if (!allLines.length) return [];

  const sizes = allLines.map(l => l.fontSize);
  const medianSize = [...sizes].sort((a, b) => a - b)[Math.floor(sizes.length / 2)];

  const blocks = [];

  for (const page of parsed.pages) {
    let accum = [];  // lines being accumulated for current block
    let accType = null;

    const flush = () => {
      if (!accum.length) return;
      const sample = accum[0];
      const text = accum.map(l => l.text).join(" ");
      blocks.push({
        id: uid(),
        type: accType || "paragraph",
        text,
        fontSize: sample.fontSize,
        bold: sample.bold || (accType || "").startsWith("h"),
        italic: sample.italic,
        pageWidth: page.width,
      });
      accum = [];
      accType = null;
    };

    let lastY = null;
    for (const line of page.lines) {
      const lineType = classifyLine(line, medianSize);
      const gap = lastY !== null ? Math.abs(line.y - lastY) : 0;
      const bigGap = gap > line.fontSize * 1.6;

      // Always flush before: a new list item, a heading, a section header, or a big gap
      if (
        (lineType === "list") ||
        (lineType.startsWith("h")) ||
        bigGap
      ) {
        flush();
      }

      // If accumulating a list and this line is NOT a list item, it's a continuation (sub-line)
      // unless there's a big gap
      if (accType === "list" && lineType === "paragraph" && !bigGap) {
        // continuation of the same list item text
        accum.push(line);
      } else {
        // If type changed from what we were accumulating, flush first
        if (accType && accType !== lineType && accum.length) {
          flush();
        }
        accum.push(line);
        accType = lineType;
      }

      lastY = line.y;
    }
    flush();
    blocks.push({ id: uid(), type: "pagebreak" });
  }

  // Remove trailing pagebreak if it's the last block
  if (blocks.length && blocks[blocks.length - 1].type === "pagebreak") {
    blocks.pop();
  }

  return blocks;
}

/* ═══════════════════════════════════════════════════════════════
   STEP 3 – Build .docx blob using docx library (CDN shimmed)
   We use a pure JS approach: build raw XML and ZIP it ourselves
   because docx-js is too large for CDN injection in browser.
   We use JSZip + hand-crafted OOXML.
═══════════════════════════════════════════════════════════════ */
function esc(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

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

  // If empty, add placeholder
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

async function buildDocx(blocks, onProgress) {
  await loadScript(
    "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
    "jszip-main"
  );

  onProgress(85);
  const zip = new window.JSZip();

  // [Content_Types].xml
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
  <Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
</Types>`);

  // _rels/.rels
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);

  // word/_rels/document.xml.rels
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

/* ═══════════════════════════════════════════════════════════════
   PREVIEW RENDERER
═══════════════════════════════════════════════════════════════ */
function BlockPreview({ block, index, selected, onSelect, onUpdate, onDelete, onMoveUp, onMoveDown }) {
  const [editing, setEditing] = useState(false);
  const ref = useRef(null);
  const lastUpdateContent = useRef(block.text);

  useEffect(() => {
    if (!editing && ref.current && ref.current.innerHTML !== (block.text || "")) {
      ref.current.innerHTML = esc(block.text || "");
      lastUpdateContent.current = block.text;
    }
  }, [block.text, editing]);

  const typeStyles = {
    h1: { fontSize: 26, fontWeight: 800, color: "#1a2e5a", marginBottom: 4, fontFamily: "'Playfair Display', serif" },
    h2: { fontSize: 20, fontWeight: 700, color: "#2347a0", marginBottom: 3, fontFamily: "'Playfair Display', serif" },
    h3: { fontSize: 15, fontWeight: 700, color: "#1f4e79", marginBottom: 2, fontFamily: "'DM Sans', sans-serif" },
    paragraph: { fontSize: 13, fontWeight: 400, color: "#222", lineHeight: 1.7, fontFamily: "'DM Sans', sans-serif" },
    list: { fontSize: 13, fontWeight: 400, color: "#222", lineHeight: 1.7, paddingLeft: 20, fontFamily: "'DM Sans', sans-serif" },
  };
  if (block.type === "pagebreak") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "8px 0", opacity: 0.5 }}>
        <div style={{ flex: 1, height: 1, borderTop: "2px dashed #b0bacc" }} />
        <span style={{ fontSize: 11, color: "#8896b0", fontFamily: "monospace", whiteSpace: "nowrap" }}>— Page Break —</span>
        <div style={{ flex: 1, height: 1, borderTop: "2px dashed #b0bacc" }} />
      </div>
    );
  }

  const baseStyle = typeStyles[block.type] || typeStyles.paragraph;

  return (
    <div
      style={{
        display: "flex", alignItems: "flex-start", gap: 8,
        padding: "6px 8px", borderRadius: 8,
        background: selected ? "#edf2ff" : "transparent",
        border: selected ? "1px solid #a0b4f0" : "1px solid transparent",
        cursor: "pointer", transition: "all 0.15s", marginBottom: 2,
      }}
      onClick={() => onSelect(index)}
    >
      {/* Type badge */}
      <div style={{
        flexShrink: 0, marginTop: 3,
        fontSize: 9, fontWeight: 700, letterSpacing: "0.05em",
        background: block.type === "h1" ? "#2347a0" : block.type === "h2" ? "#3b7cf4" : block.type === "h3" ? "#0ea5e9" : block.type === "list" ? "#16a34a" : "#6b7280",
        color: "#fff", borderRadius: 4, padding: "2px 5px", minWidth: 28, textAlign: "center"
      }}>
        {block.type === "paragraph" ? "¶" : block.type === "list" ? "•" : block.type.toUpperCase()}
      </div>

      {/* Content */}
      <div
        ref={ref}
        contentEditable={editing}
        suppressContentEditableWarning
        style={{ ...baseStyle, flex: 1, outline: "none", minHeight: 18 }}
        onDoubleClick={e => { e.stopPropagation(); setEditing(true); ref.current?.focus(); }}
        onBlur={e => { 
          setEditing(false); 
          const newHtml = e.target.innerText;
          if (newHtml !== lastUpdateContent.current) {
            lastUpdateContent.current = newHtml;
            onUpdate(index, { text: newHtml }); 
          }
        }}
      />

      {/* Controls */}
      {selected && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2, flexShrink: 0 }}>
          <select
            value={block.type}
            onChange={e => { onUpdate(index, { type: e.target.value }); }}
            onClick={e => e.stopPropagation()}
            style={{ fontSize: 10, background: "#f0f4ff", border: "1px solid #c0ccee", borderRadius: 4, padding: "2px 4px", color: "#333", cursor: "pointer", outline: "none", fontFamily: "inherit" }}
          >
            {["h1","h2","h3","paragraph","list","pagebreak"].map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <div style={{ display: "flex", gap: 2 }}>
            <button onClick={e => { e.stopPropagation(); onMoveUp(index); }}
              style={{ fontSize: 10, padding: "1px 5px", background: "#e8edff", border: "1px solid #c0ccee", borderRadius: 3, cursor: "pointer" }}>↑</button>
            <button onClick={e => { e.stopPropagation(); onMoveDown(index); }}
              style={{ fontSize: 10, padding: "1px 5px", background: "#e8edff", border: "1px solid #c0ccee", borderRadius: 3, cursor: "pointer" }}>↓</button>
            <button onClick={e => { e.stopPropagation(); onDelete(index); }}
              style={{ fontSize: 10, padding: "1px 5px", background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 3, cursor: "pointer", color: "#dc2626" }}>×</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   STATS CARD
═══════════════════════════════════════════════════════════════ */
function StatsCard({ icon, label, value, accent }) {
  return (
    <div style={{ background: "#fff", borderRadius: 12, padding: "14px 18px", border: "1px solid #e4e9f5", boxShadow: "0 2px 8px rgba(35,71,160,0.06)" }}>
      <div style={{ fontSize: 22, marginBottom: 6 }}>{icon}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: accent || "#2347a0", fontFamily: "'Playfair Display', serif", lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, color: "#8896b0", marginTop: 3, fontWeight: 500 }}>{label}</div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN APP
═══════════════════════════════════════════════════════════════ */
export default function PDFtoDOCX({ onBack, initialFile, onSave }) {
  const [phase, setPhase] = useState(initialFile ? "processing" : "upload"); // upload | processing | editing | done
  const [progress, setProgress] = useState(initialFile ? 5 : 0);
  const [progressLabel, setProgressLabel] = useState(initialFile ? "Loading PDF engine…" : "");
  const [file, setFile] = useState(initialFile || null);
  const [parsed, setParsed] = useState(null);
  const [blocks, setBlocks] = useState([]);
  const [selectedBlock, setSelectedBlock] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [stats, setStats] = useState({});
  const [previewPage, setPreviewPage] = useState(0);
  const [history, setHistory] = useState([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const fileRef = useRef(null);
  const replaceFileRef = useRef(null);

  const handleUploadReplace = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !onSave) return;
    
    const allowed = ['.pdf', '.txt', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.csv', '.xlsx', '.xls', '.zip'];
    const ex = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    
    if (!allowed.includes(ex)) {
        alert("Unsupported file format for Replace.");
        return;
    }
    
    setPhase("processing");
    setProgress(50);
    setProgressLabel("Uploading and Replacing File...");
    try {
        await onSave(file);
    } catch (err) {
        alert("Error replacing file: " + err.message);
        setPhase("editing");
    }
  };

  /* ── auto-process initialFile on mount ── */
  useEffect(() => {
    if (initialFile) {
      handleFileInternal(initialFile);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── history logic ── */
  const pushHistory = useCallback((nb) => {
    const serialized = JSON.parse(JSON.stringify(nb));
    setHistory(h => [...h.slice(0, historyIdx + 1), serialized].slice(-50));
    setHistoryIdx(i => i + 1);
  }, [historyIdx]);

  const undo = () => {
    if (historyIdx > 0) {
      const prev = history[historyIdx - 1];
      setBlocks(prev);
      setStats(countTypes(prev));
      setHistoryIdx(i => i - 1);
    }
  };

  const redo = () => {
    if (historyIdx < history.length - 1) {
      const next = history[historyIdx + 1];
      setBlocks(next);
      setStats(countTypes(next));
      setHistoryIdx(i => i + 1);
    }
  };

  /* ── keyboard listener ── */
  useEffect(() => {
    const handleKeys = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "y") {
        e.preventDefault();
        redo();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "c" || e.key === "C" || e.key === "x" || e.key === "X")) {
        e.preventDefault();
      }
    };
    const preventCopy = (e) => e.preventDefault();
    window.addEventListener("keydown", handleKeys);
    window.addEventListener("copy", preventCopy);
    window.addEventListener("cut", preventCopy);
    return () => {
      window.removeEventListener("keydown", handleKeys);
      window.removeEventListener("copy", preventCopy);
      window.removeEventListener("cut", preventCopy);
    };
  }, [history, historyIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── count block types ── */
  const countTypes = (bks) => {
    const c = { h1: 0, h2: 0, h3: 0, paragraph: 0, list: 0, pagebreak: 0 };
    bks.forEach(b => { if (c[b.type] !== undefined) c[b.type]++; });
    return c;
  };

  /* ── handle file (internal, reusable) ── */
  const handleFileInternal = async (f) => {
    if (!f || !f.name.toLowerCase().endsWith(".pdf")) {
      alert("Please upload a PDF file.");
      return;
    }
    setFile(f);
    setPhase("processing");
    setProgress(5);
    setProgressLabel("Loading PDF engine…");

    try {
      setProgressLabel("Parsing pages…");
      const parsedData = await parsePDF(f, (p, current, total) => {
        setProgress(p);
        if (current !== undefined) {
           setProgressLabel(`Parsing pages (${current} / ${total})…`);
        }
      });
      setParsed(parsedData);
      setProgress(50);
      setProgressLabel("Analysing document structure…");
      await new Promise(r => setTimeout(r, 300));

      const inferredBlocks = inferStructure(parsedData);
      setBlocks(inferredBlocks);
      setStats(countTypes(inferredBlocks));
      pushHistory(inferredBlocks);

      setProgress(70);
      setProgressLabel("Building preview…");
      await new Promise(r => setTimeout(r, 200));
      setProgress(100);
      setPhase("editing");
    } catch (e) {
      console.error(e);
      alert("Error processing PDF: " + e.message);
      setPhase("upload");
    }
  };

  const handleFile = handleFileInternal;

  /* ── save replace ── */
  const doSaveReplace = async () => {
    if (!onSave) return;
    setPhase("processing");
    setProgress(60);
    setProgressLabel("Building PDF to Save and Replace…");
    try {
      const pdfDoc = await PDFDocument.create();
      const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
      const fontBoldItalic = await pdfDoc.embedFont(StandardFonts.HelveticaBoldOblique);

      const sanitize = (str) => {
        if (!str) return "";
        // Aggressively strip any character that might break StandardFonts (WinAnsi)
        return str
          .replace(/[\u2018\u2019\u02BC\u02B9]/g, "'") 
          .replace(/[\u201C\u201D\u201F\u2033]/g, '"') 
          .replace(/[\u2013\u2014\u2015\u2212]/g, "-") 
          .replace(/[\u2022\u2219\u00B7]/g, "-")       
          .replace(/\u2026/g, "...")                  
          .replace(/[^\x20-\x7E]/g, "?")              
          .trim();
      };

      console.log("Starting PDF export with", blocks.length, "blocks");

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
        setProgress(p);
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

      setProgressLabel("Finalising PDF…");
      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: "application/pdf" });
      const name = (file?.name || "document").replace(/\.pdf$/i, "");
      const resultFile = new File([blob], name + "_edited.pdf", { type: "application/pdf" });
      await onSave(resultFile);
      setProgress(100);
      setPhase("done");
    } catch (e) {
      console.error("PDF Export Error Detailed:", e);
      alert(`PDF Export Error: ${e.message}\n\nThis is usually caused by unsupported characters in the text. I've tried to clean them up, but some remain.`);
      setPhase("editing");
    }
  };

  /* ── block editors ── */
  const updateBlock = (i, patch) => {
    setBlocks(b => {
      const nb = b.map((x, idx) => idx === i ? { ...x, ...patch } : x);
      setStats(countTypes(nb));
      pushHistory(nb);
      return nb;
    });
  };
  const deleteBlock = (i) => { 
    setBlocks(b => {
       const nb = b.filter((_, idx) => idx !== i);
       setStats(countTypes(nb));
       pushHistory(nb);
       return nb;
    }); 
  };
  const addBlock = (type) => {
    const nb = { id: uid(), type, text: type === "pagebreak" ? "" : "New " + type };
    setBlocks(b => {
      const nbs = [...b, nb];
      setStats(countTypes(nbs));
      pushHistory(nbs);
      return nbs;
    });
  };
  const moveBlock = (i, dir) => {
    setBlocks(b => {
      const nb = [...b];
      const j = i + dir;
      if (j < 0 || j >= nb.length) return nb;
      [nb[i], nb[j]] = [nb[j], nb[i]];
      pushHistory(nb);
      return nb;
    });
  };

  /* ── CSS ── */
  const css = `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Playfair+Display:wght@700;800&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin:0; padding:0; user-select:none; -webkit-user-select:none; }
    input, textarea, [contenteditable] { user-select: auto; -webkit-user-select: auto; }
    

    .drop-zone { border: 2.5px dashed #a0b4d4; border-radius: 20px; padding: 60px 40px; text-align: center; transition: all .25s; cursor: pointer; }
    .drop-zone.over { border-color: #2347a0; background: #edf2ff; transform: scale(1.01); }
    .drop-zone:hover { border-color: #3b7cf4; }

    @keyframes spin { to { transform: rotate(360deg); } }
    .spinner { animation: spin .75s linear infinite; border-radius: 50%; border: 3px solid #dde3f0; border-top-color: #2347a0; }

    @keyframes fadeUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
    .fade-up { animation: fadeUp .4s ease both; }

    @keyframes progress-bar { from { background-position: 0 0; } to { background-position: 40px 0; } }
    .pbar-animated { background: linear-gradient(90deg, #2347a0 0%, #3b7cf4 50%, #2347a0 100%); background-size: 200% 100%; animation: progress-bar 1.5s linear infinite; }

    @keyframes checkmark { 0% { stroke-dashoffset: 60; } 100% { stroke-dashoffset: 0; } }
    .check-path { stroke-dasharray: 60; stroke-dashoffset: 60; animation: checkmark .5s ease .2s forwards; }

    @keyframes float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
    .float { animation: float 3s ease-in-out infinite; }

    .panel { background: #fff; border-radius: 16px; border: 1px solid #e4e9f5; box-shadow: 0 4px 20px rgba(35,71,160,0.07); overflow: hidden; }
  `;

  /* ════════════ UPLOAD SCREEN ════════════ */
  if (phase === "upload") return (
    <>
      <style>{css}</style>
      <div style={{ flex: 1, background: "linear-gradient(135deg, #f0f4fb 0%, #e8eeff 100%)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 20px" }}>

        <div className="fade-up" style={{ textAlign: "center", marginBottom: 48 }}>
          <div className="pulse" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 84, height: 84, borderRadius: 24, background: "linear-gradient(135deg, #2347a0, #3b7cf4)", boxShadow: "0 8px 32px rgba(35,71,160,0.25)", marginBottom: 28 }}>
             <svg width="40" height="40" viewBox="0 0 20 20" fill="none"><path d="M10 2L3 6v8l7 4 7-4V6L10 2z" stroke="#fff" strokeWidth="1.5" fill="rgba(255,255,255,0.15)" /><path d="M10 2v16M3 6l7 4 7-4" stroke="#fff" strokeWidth="1.5" /></svg>
          </div>
          <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 42, fontWeight: 800, color: "#1a2540", letterSpacing: "-0.02em", marginBottom: 12 }}>PDF → DOCX</h1>
          <p style={{ color: "#5a6a8a", fontSize: 16, lineHeight: 1.6 }}>Convert your PDF into a fully editable document.<br />Professional extraction and structured layout.</p>
        </div>

        <div className={`drop-zone fade-up ${dragOver ? "over" : ""}`}
          style={{ maxWidth: 640, width: "100%", animationDelay: "0.1s" }}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}
          onClick={() => fileRef.current?.click()}
        >
          <div style={{ fontSize: 52, marginBottom: 16 }}>📄</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#1a2540", marginBottom: 8 }}>Drop your PDF here</div>
          <div style={{ fontSize: 14, color: "#8896b0", marginBottom: 28 }}>or click to browse — any PDF up to 50MB</div>
          <button className="btn btn-primary" style={{ fontSize: 14, padding: "12px 32px" }}>Choose PDF</button>
        </div>
        <input ref={fileRef} type="file" accept=".pdf" style={{ display: "none" }} onChange={e => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }} />

        <button className="btn btn-ghost" onClick={onBack} style={{ marginTop: 24 }}>← Back to Universal Editor</button>
      </div>
    </>
  );

  /* ════════════ PROCESSING SCREEN ════════════ */
  if (phase === "processing") return (
    <>
      <style>{css}</style>
      <div style={{ flex: 1, background: "linear-gradient(135deg, #f0f4fb 0%, #e8eeff 100%)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="panel fade-up" style={{ maxWidth: 460, width: "100%", margin: "0 20px", padding: 48, textAlign: "center" }}>
          <div className="float" style={{ marginBottom: 32 }}>
            <div className="spinner" style={{ width: 56, height: 56, margin: "0 auto" }} />
          </div>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 24, color: "#1a2540", marginBottom: 8 }}>
            {progress < 70 ? "Parsing PDF…" : "Building DOCX…"}
          </h2>
          <p style={{ fontSize: 13, color: "#8896b0", marginBottom: 28 }}>{progressLabel}</p>

          {/* Progress bar */}
          <div style={{ background: "#e8eeff", borderRadius: 12, height: 10, overflow: "hidden", marginBottom: 12 }}>
            <div className="pbar-animated" style={{ width: `${progress}%`, height: "100%", borderRadius: 12, transition: "width 0.3s ease" }} />
          </div>
          <div style={{ fontSize: 12, color: "#8896b0", fontFamily: "monospace" }}>{progress}%</div>

          {file && (
            <div style={{ marginTop: 24, padding: "10px 16px", background: "#f5f7ff", borderRadius: 10, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 22 }}>📄</span>
              <div style={{ textAlign: "left" }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#1a2540" }}>{file.name}</div>
                <div style={{ fontSize: 11, color: "#8896b0" }}>{(file.size / 1024).toFixed(0)} KB</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );

  /* ════════════ EDITING SCREEN ════════════ */
  if (phase === "editing") {
    const typeCounts = countTypes(blocks);

    return (
      <>
        <style>{css}</style>
        <div style={{ flex: 1, background: "#f0f4fb", display: "flex", flexDirection: "column", overflow: "hidden" }} onContextMenu={(e) => e.preventDefault()} onCopy={(e) => e.preventDefault()}>

          {/* ── Unified Top Bar ── */}
          <div style={{ height: 56, background: "#fff", borderBottom: "1px solid #e4e9f5", display: "flex", alignItems: "center", padding: "0 24px", gap: 16, flexShrink: 0, boxShadow: "0 2px 10px rgba(35,71,160,0.06)", zIndex: 100 }}>
             <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }} onClick={onBack}>
               <div style={{ width: 34, height: 34, borderRadius: 10, background: "linear-gradient(135deg, #2347a0, #3b7cf4)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 12px rgba(35,71,160,0.25)" }}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 2L3 6v8l7 4 7-4V6L10 2z" stroke="#fff" strokeWidth="1.5" fill="rgba(255,255,255,0.15)" /><path d="M10 2v16M3 6l7 4 7-4" stroke="#fff" strokeWidth="1.5" /></svg>
              </div>
              <span style={{ fontFamily: "'Playfair Display', serif", fontWeight: 800, fontSize: 18, color: "#1a2540", letterSpacing: "-0.01em" }}>UniEdit</span>
            </div>

            <div className="sep" style={{ background: "#e4e9f5", height: 24, margin: "0 10px", width: 1 }} />
            
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 16px", background: "#f5f7ff", borderRadius: 10, fontSize: 13, color: "#5a6a8a" }}>
              <span>📄</span>
              <span style={{ fontWeight: 600 }}>{file?.name}</span>
              <span style={{ color: "#b0bacc" }}>·</span>
              <span>{parsed?.numPages} page{parsed?.numPages !== 1 ? "s" : ""}</span>
            </div>

            <div style={{ flex: 1 }} />

            <div style={{ display: "flex", gap: 10, marginRight: 12 }}>
              <button className="btn btn-primary btn-sm" onClick={() => addBlock("paragraph")} style={{ padding: "6px 14px" }}>＋ Add Text</button>
            </div>

            <div style={{ display: "flex", gap: 4, marginRight: 8 }}>
              <button className="btn btn-ghost btn-sm" onClick={undo} disabled={historyIdx <= 0} title="Undo (Ctrl+Z)">↩ Undo</button>
              <button className="btn btn-ghost btn-sm" onClick={redo} disabled={historyIdx >= history.length - 1} title="Redo (Ctrl+Y)">↪ Redo</button>
            </div>

            {onSave && (
              <div style={{ display: "flex", gap: "8px" }}>
                <button className="btn btn-outline btn-sm" style={{ background: "#fff", borderColor: "#a0b4d4", color: "#2347a0", gap: "6px" }} onClick={() => replaceFileRef.current?.click()}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                  Upload Replace
                </button>
                <input ref={replaceFileRef} type="file" accept=".pdf,.txt,.png,.jpg,.jpeg,.gif,.webp,.csv,.xlsx,.xls,.zip" style={{ display: "none" }} onChange={(e) => { handleUploadReplace(e); e.target.value = ""; }} />
                <button className="btn btn-green btn-sm" onClick={doSaveReplace} style={{ fontSize: 13, padding: "8px 20px", background: "linear-gradient(135deg, #10b981, #059669)", boxShadow: "0 4px 12px rgba(16, 185, 129, 0.25)", color: "#fff", border: "none" }}>💾 Save Replace</button>
              </div>
            )}
          </div>

          {/* ── Main Layout ── */}
          <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

            {/* ── LEFT: PDF Preview ── */}
            <div style={{ width: 380, background: "#fff", borderRight: "1px solid #e4e9f5", display: "flex", flexDirection: "column", flexShrink: 0 }}>
              <div style={{ padding: "14px 16px", borderBottom: "1px solid #f0f4fb", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#1a2540", textTransform: "uppercase", letterSpacing: "0.06em" }}>PDF Preview</span>
                {parsed && (
                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    <button className="btn btn-ghost btn-sm" disabled={previewPage === 0} onClick={() => setPreviewPage(p => p - 1)} style={{ padding: "3px 8px" }}>‹</button>
                    <span style={{ fontSize: 11, color: "#8896b0" }}>{previewPage + 1} / {parsed.numPages}</span>
                    <button className="btn btn-ghost btn-sm" disabled={previewPage >= parsed.numPages - 1} onClick={() => setPreviewPage(p => p + 1)} style={{ padding: "3px 8px" }}>›</button>
                  </div>
                )}
              </div>
              <div style={{ flex: 1, overflow: "auto", padding: "16px", display: "flex", justifyContent: "center", background: "#8896b0" }}>
                {parsed?.pages[previewPage]?.pageImg && (
                  <img src={parsed.pages[previewPage].pageImg} alt={`Page ${previewPage + 1}`} style={{ maxWidth: "100%", boxShadow: "0 4px 20px rgba(0,0,0,0.3)", borderRadius: 4 }} />
                )}
              </div>
            </div>

            {/* ── CENTER: Block Editor ── */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              {/* Stats row */}
              <div style={{ padding: "12px 20px", background: "#fff", borderBottom: "1px solid #e4e9f5", display: "flex", gap: 12, overflowX: "auto" }}>
                {[
                  { icon: "📄", label: "Total Blocks", value: blocks.length, color: "#2347a0" },
                  { icon: "H1", label: "Headings", value: (typeCounts.h1||0)+(typeCounts.h2||0)+(typeCounts.h3||0), color: "#3b7cf4" },
                  { icon: "¶", label: "Paragraphs", value: typeCounts.paragraph||0, color: "#6b7a99" },
                  { icon: "•", label: "Lists", value: typeCounts.list||0, color: "#16a34a" },
                  { icon: "↵", label: "Page Breaks", value: typeCounts.pagebreak||0, color: "#f59e0b" },
                ].map(s => (
                  <div key={s.label} style={{ flexShrink: 0, background: "#f5f7ff", borderRadius: 10, padding: "8px 14px", display: "flex", alignItems: "center", gap: 8, border: "1px solid #e4e9f5" }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: s.color, minWidth: 20 }}>{s.icon}</span>
                    <div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</div>
                      <div style={{ fontSize: 10, color: "#8896b0", fontWeight: 600 }}>{s.label}</div>
                    </div>
                  </div>
                ))}
                <div style={{ flex: 1 }} />
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                  {["h1","h2","h3","paragraph","list","pagebreak"].map(t => (
                    <button key={t} className="btn btn-ghost btn-sm" onClick={() => addBlock(t)}>
                      + {t === "paragraph" ? "¶" : t === "pagebreak" ? "↵" : t === "list" ? "•" : t.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              {/* Block list */}
              <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
                <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e4e9f5", padding: "16px", boxShadow: "0 2px 12px rgba(35,71,160,0.05)" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#8896b0", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>
                    Document Structure — double-click any block to edit text
                  </div>
                  {blocks.length === 0 && (
                    <div style={{ textAlign: "center", padding: "40px 20px", color: "#8896b0", fontSize: 13 }}>
                      No content blocks found. Add some using the buttons above.
                    </div>
                  )}
                  {blocks.map((block, i) => (
                    <BlockPreview
                      key={block.id}
                      block={block}
                      index={i}
                      selected={selectedBlock === i}
                      onSelect={setSelectedBlock}
                      onUpdate={updateBlock}
                      onDelete={deleteBlock}
                      onMoveUp={i => moveBlock(i, -1)}
                      onMoveDown={i => moveBlock(i, 1)}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* ── RIGHT: Properties Panel ── */}
            <div style={{ width: 240, background: "#fff", borderLeft: "1px solid #e4e9f5", display: "flex", flexDirection: "column", flexShrink: 0 }}>
              <div style={{ padding: "14px 16px", borderBottom: "1px solid #f0f4fb" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#1a2540", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  {selectedBlock !== null ? "Block Properties" : "Document Info"}
                </span>
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
                {selectedBlock === null ? (
                  <>
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 10, color: "#8896b0", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Source File</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#1a2540", wordBreak: "break-all" }}>{file?.name}</div>
                      <div style={{ fontSize: 12, color: "#8896b0", marginTop: 3 }}>{(file?.size / 1024).toFixed(1)} KB · {parsed?.numPages} pages</div>
                    </div>
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 10, color: "#8896b0", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Block Summary</div>
                      {Object.entries(typeCounts).filter(([,v])=>v>0).map(([k,v]) => (
                        <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 0", borderBottom: "1px solid #f0f4fb" }}>
                          <span style={{ color: "#5a6a8a", fontWeight: 500 }}>{k}</span>
                          <span style={{ fontWeight: 700, color: "#2347a0" }}>{v}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ background: "#f5f7ff", borderRadius: 10, padding: "12px 14px", border: "1px solid #e4e9f5" }}>
                      <div style={{ fontSize: 11, color: "#5a6a8a", lineHeight: 1.6 }}>
                        <strong style={{ color: "#2347a0" }}>Click</strong> a block to select.<br/>
                        <strong style={{ color: "#2347a0" }}>Double-click</strong> to edit text.<br/>
                        <strong style={{ color: "#2347a0" }}>Change type</strong> via dropdown.<br/>
                        <strong style={{ color: "#2347a0" }}>Reorder</strong> with ↑↓ arrows.
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    {blocks[selectedBlock] && (() => {
                      const b = blocks[selectedBlock];
                      return (
                        <>
                          <div style={{ marginBottom: 12 }}>
                            <div style={{ fontSize: 10, color: "#8896b0", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Block #{selectedBlock + 1}</div>
                            <select
                              value={b.type}
                              onChange={e => updateBlock(selectedBlock, { type: e.target.value })}
                              style={{ width: "100%", background: "#f5f7ff", border: "1.5px solid #a0b4d4", borderRadius: 8, padding: "7px 10px", fontSize: 12, fontWeight: 600, color: "#2347a0", fontFamily: "inherit", cursor: "pointer", outline: "none" }}
                            >
                              {["h1","h2","h3","paragraph","list","pagebreak"].map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </div>
                          {b.type !== "pagebreak" && (
                            <div style={{ marginBottom: 12 }}>
                              <div style={{ fontSize: 10, color: "#8896b0", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Text Content</div>
                              <textarea
                                value={b.text || ""}
                                onChange={e => updateBlock(selectedBlock, { text: e.target.value })}
                                style={{ width: "100%", background: "#f5f7ff", border: "1px solid #dde3f0", borderRadius: 8, padding: "8px 10px", fontSize: 12, color: "#1a2540", fontFamily: "'DM Sans', sans-serif", resize: "vertical", minHeight: 80, outline: "none", lineHeight: 1.5 }}
                              />
                            </div>
                          )}
                          <div style={{ marginBottom: 12 }}>
                            <div style={{ fontSize: 10, color: "#8896b0", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Formatting</div>
                            <div style={{ display: "flex", gap: 6 }}>
                              {[{k:"bold",l:"B",s:{fontWeight:"bold"}},{k:"italic",l:"I",s:{fontStyle:"italic"}}].map(({k,l,s}) => (
                                <button key={k}
                                  onClick={() => updateBlock(selectedBlock, { [k]: !b[k] })}
                                  style={{ flex:1, padding:"6px", background: b[k] ? "#2347a0" : "#f5f7ff", color: b[k] ? "#fff" : "#5a6a8a", border: "1px solid " + (b[k] ? "#2347a0" : "#dde3f0"), borderRadius: 7, cursor: "pointer", fontFamily: "inherit", ...s, fontSize: 14, fontWeight: "bold" }}>
                                  {l}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button className="btn btn-ghost btn-sm" style={{ flex: 1, justifyContent: "center" }} onClick={() => moveBlock(selectedBlock, -1)}>↑ Up</button>
                            <button className="btn btn-ghost btn-sm" style={{ flex: 1, justifyContent: "center" }} onClick={() => moveBlock(selectedBlock, 1)}>↓ Down</button>
                          </div>
                          <button className="btn btn-sm" onClick={() => { deleteBlock(selectedBlock); setSelectedBlock(null); }}
                            style={{ width: "100%", marginTop: 8, justifyContent: "center", background: "#fee2e2", color: "#dc2626", border: "1px solid #fca5a5", borderRadius: 8, fontSize: 12 }}>
                            🗑 Delete Block
                          </button>
                        </>
                      );
                    })()}
                  </>
                )}
              </div>

              <div style={{ padding: 16, borderTop: "1px solid #f0f4fb", display: "flex", flexDirection: "column", gap: 8 }}>
                {onSave && (
                  <>
                    <button className="btn btn-outline" style={{ width: "100%", justifyContent: "center", fontSize: 14, padding: "11px", gap: "8px" }} onClick={() => replaceFileRef.current?.click()}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                      Upload Replace
                    </button>
                    <button className="btn btn-green" style={{ width: "100%", justifyContent: "center", fontSize: 14, padding: "11px", background: "linear-gradient(135deg, #10b981, #059669)", color: "#fff", border: "none" }} onClick={doSaveReplace}>
                      💾 Save Replace
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  /* ════════════ DONE SCREEN ════════════ */
  return (
    <>
      <style>{css}</style>
      <div style={{ flex: 1, background: "linear-gradient(135deg, #f0f4fb 0%, #e8eeff 100%)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <div className="panel fade-up" style={{ maxWidth: 520, width: "100%", padding: 48, textAlign: "center" }}>
          {/* Animated checkmark */}
          <div style={{ width: 80, height: 80, borderRadius: "50%", background: "linear-gradient(135deg, #16a34a, #22c55e)", margin: "0 auto 24px", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 8px 28px rgba(22,163,74,0.35)" }}>
            <svg width="38" height="38" viewBox="0 0 38 38" fill="none">
              <path className="check-path" d="M10 19l7 7 12-14" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
            </svg>
          </div>

          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 30, color: "#1a2540", marginBottom: 8 }}>Export Complete!</h2>
          <p style={{ fontSize: 14, color: "#5a6a8a", marginBottom: 32, lineHeight: 1.6 }}>
            Your file has been downloaded successfully.<br/>
            You can open it or convert another PDF.
          </p>

          {/* Stats */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 32 }}>
            <StatsCard icon="📄" label="PDF Pages" value={parsed?.numPages || "–"} accent="#2347a0" />
            <StatsCard icon="📝" label="Blocks" value={blocks.length} accent="#3b7cf4" />
            <StatsCard icon="✅" label="Status" value="Done" accent="#16a34a" />
          </div>

          <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
            <button className="btn btn-outline" onClick={() => { setPhase("editing"); }}>
              ← Back to Editor
            </button>
            <button className="btn btn-blue" onClick={() => { setPhase("upload"); setFile(null); setParsed(null); setBlocks([]); }}>
              Convert Another PDF
            </button>
          </div>

          <div style={{ marginTop: 28, padding: "14px 20px", background: "#f5f7ff", borderRadius: 12, border: "1px solid #e4e9f5", fontSize: 12, color: "#8896b0", lineHeight: 1.7 }}>
            <strong style={{ color: "#2347a0" }}>💡 Tips:</strong> Open in Word to use spell check and track changes.
            Use Google Docs to collaborate in real-time. All formatting is preserved.
          </div>
        </div>
      </div>
    </>
  );
}
