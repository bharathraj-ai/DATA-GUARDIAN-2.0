"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import PDFtoDOCX from "./PDFtoDOCX";

const uid = () => Math.random().toString(36).slice(2, 10);
const FONTS = ["Georgia", "Times New Roman", "Palatino", "Garamond", "Arial", "Helvetica", "Verdana", "Tahoma", "Trebuchet MS", "Courier New", "Lucida Console", "Monaco", "Impact", "Comic Sans MS"];
const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72];
const FILE_ICONS = { pdf: "📄", txt: "📝", xlsx: "📊", xls: "📊", csv: "📊", png: "🖼️", jpg: "🖼️", jpeg: "🖼️", gif: "🖼️", webp: "🖼️", zip: "🗜️", doc: "📃", docx: "📃", default: "📁" };
const getFileIcon = (name = "") => { const ext = name.split(".").pop().toLowerCase(); return FILE_ICONS[ext] || FILE_ICONS.default; };

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

async function parsePDF(file) {
  return new Promise((resolve) => {
    const doWork = async () => {
      await loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js", "pdfjs-main", "pdfjsLib");
      const pdfjsLib = window["pdfjs-dist/build/pdf"] || window["pdfjsLib"];
      if (!pdfjsLib) { console.error("PDF.js not found"); return; }
      pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      const ab = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
      const pages = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const baseScale = 1.0;
        const vp = page.getViewport({ scale: baseScale });
        const textContent = await page.getTextContent();

        const pdfWidth = Math.abs(page.view[2] - page.view[0]);
        const scaleFactor = vp.width / pdfWidth;

        const renderScale = 2.0;
        const renderVp = page.getViewport({ scale: renderScale });
        const canvas = document.createElement("canvas");
        canvas.width = renderVp.width; canvas.height = renderVp.height;
        const ctx = canvas.getContext("2d");
        await page.render({ canvasContext: ctx, viewport: renderVp }).promise;
        const pageImage = canvas.toDataURL("image/png");

        const sortedItems = textContent.items
          .filter(item => item.str && item.str.trim() !== "")
          .map(item => {
            const [vx, vy] = vp.convertToViewportPoint(item.transform[4], item.transform[5]);
            const tx = pdfjsLib.Util.transform(vp.transform, item.transform);
            const fontSize = Math.sqrt(tx[0] * tx[0] + tx[1] * tx[1]);
            return { ...item, vx, vy, fontSize };
          })
          .sort((a, b) => (Math.round(a.vy) - Math.round(b.vy)) || (a.vx - b.vx));

        const elements = [];
        let currentGroup = null;
        sortedItems.forEach(item => {
          if (!currentGroup || Math.abs(currentGroup.y - (item.vy - item.fontSize)) > 2 || (item.vx - (currentGroup.x + currentGroup.width) > 5)) {
            if (currentGroup) elements.push(currentGroup);
            currentGroup = {
              id: uid(), type: "text", content: item.str,
              x: item.vx, y: item.vy - item.fontSize,
              width: item.width * (vp.width / (page.view[2] - page.view[0])),
              height: item.fontSize,
              font: (item.fontName || "Helvetica").replace(/[^a-zA-Z\s]/g, ""),
              size: Math.round(item.fontSize),
              bold: /Bold/i.test(item.fontName || ""),
              italic: /Italic|Oblique/i.test(item.fontName || ""),
              color: "#000000", selected: false, isFromPDF: true
            };
          } else {
            currentGroup.content += (item.str.startsWith(" ") ? "" : " ") + item.str;
            currentGroup.width = (item.vx + item.width * (vp.width / (page.view[2] - page.view[0]))) - currentGroup.x;
          }
        });
        if (currentGroup) elements.push(currentGroup);
        pages.push({ id: uid(), width: Math.round(vp.width), height: Math.round(vp.height), elements, bgImage: pageImage });
      }
      resolve({ type: "pdf", name: file.name, pages });
    };
    doWork();
  });
}

async function parseTXT(file) {
  const text = await file.text();
  const lines = text.split("\n");
  const elements = lines.map((line, i) => ({
    id: uid(), type: "text", content: line || " ",
    x: 60, y: 60 + i * 24, width: 680, height: 22,
    font: "Georgia", size: 12, bold: false, italic: false, color: "#1a1a1a", selected: false
  }));
  return { type: "txt", name: file.name, pages: [{ id: uid(), width: 794, height: Math.max(1122, 60 + lines.length * 24 + 80), elements, bgImage: null }] };
}

async function parseImage(file) {
  const src = await new Promise(r => { const fr = new FileReader(); fr.onload = e => r(e.target.result); fr.readAsDataURL(file); });
  return { type: "image", name: file.name, pages: [{ id: uid(), width: 794, height: 1122, elements: [{ id: uid(), type: "image", src, x: 97, y: 60, width: 600, height: 400, selected: false }], bgImage: null }] };
}

async function parseCSV(file) {
  const text = await file.text();
  const rows = text.split("\n").filter(Boolean).map(r => r.split(",").map(c => c.replace(/^"|"$/g, "").trim()));
  const cols = Math.max(...rows.map(r => r.length));
  const colW = Math.min(120, Math.floor(680 / cols));
  return { type: "csv", name: file.name, pages: [{ id: uid(), width: 794, height: Math.max(1122, rows.length * 28 + 120), elements: [{ id: uid(), type: "table", x: 57, y: 60, width: cols * colW, height: rows.length * 28 + 2, rows, colW, rowH: 28, selected: false }], bgImage: null }] };
}

async function parseZIP(file) {
  await new Promise((res, rej) => { if (window.JSZip) return res(); const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  const ab = await file.arrayBuffer();
  const zip = await window.JSZip.loadAsync(ab);
  const entries = [];
  zip.forEach((path, f) => { if (!f.dir) entries.push({ path, file: f }); });
  const items = await Promise.all(entries.map(async ({ path, file: f }) => {
    const ext = path.split(".").pop().toLowerCase();
    let preview = null;
    if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) { const blob = await f.async("blob"); preview = URL.createObjectURL(blob); }
    const size = (await f.async("arraybuffer")).byteLength;
    return { id: uid(), path, ext, size, preview };
  }));
  const elements = items.map((item, i) => ({ id: item.id, type: "zipentry", path: item.path, ext: item.ext, size: item.size, preview: item.preview, x: 57 + (i % 4) * 175, y: 80 + Math.floor(i / 4) * 200, width: 160, height: 175, selected: false }));
  return { type: "zip", name: file.name, pages: [{ id: uid(), width: 794, height: Math.max(1122, 80 + Math.ceil(items.length / 4) * 200 + 80), elements, bgImage: null }] };
}

async function parseExcel(file) {
  const XLSX = await import("xlsx");
  const ab = await file.arrayBuffer();
  const workbook = XLSX.read(ab, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
  const strRows = rows.map(r => (r || []).map(c => c !== undefined && c !== null ? String(c) : ""));
  const cols = Math.max(...strRows.map(r => r.length), 1);
  strRows.forEach(r => { while(r.length < cols) r.push(""); });
  const colW = Math.max(60, Math.min(120, Math.floor(680 / cols)));
  return { type: file.name.endsWith(".csv") ? "csv" : "xlsx", name: file.name, pages: [{ id: uid(), width: 794, height: Math.max(1122, strRows.length * 28 + 120), elements: [{ id: uid(), type: "table", x: 57, y: 60, width: cols * colW, height: strRows.length * 28 + 2, rows: strRows, colW, rowH: 28, selected: false }], bgImage: null }] };
}

async function parseFile(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  if (ext === "pdf") return parsePDF(file);
  if (ext === "txt") return parseTXT(file);
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return parseImage(file);
  if (["csv"].includes(ext)) return parseCSV(file);
  if (["xlsx", "xls"].includes(ext)) return parseExcel(file);
  if (ext === "zip") return parseZIP(file);
  return parseTXT(file);
}



function TableCell({ cell, r, c, scale, rowH, colW, onCellChange }) {
  const ref = useRef(null);
  const [editing, setEditing] = useState(false);
  const lastVal = useRef(cell);

  useEffect(() => {
    if (!editing && ref.current && ref.current.innerHTML !== String(cell)) {
      ref.current.innerHTML = String(cell);
      lastVal.current = String(cell);
    }
  }, [cell, editing]);

  return (
    <td style={{ border: "1px solid #c8ccd6", background: r === 0 ? "#f8f9fc" : "#ffffff", padding: `${2 * scale}px ${4 * scale}px`, minWidth: colW * scale, height: rowH * scale, fontWeight: r === 0 ? 600 : 400, color: "#111", verticalAlign: "top" }}>
      <div 
        ref={ref}
        contentEditable 
        suppressContentEditableWarning 
        style={{ outline: "none", minWidth: 20, minHeight: 14, wordBreak: "break-word" }}
        onFocus={() => setEditing(true)}
        onBlur={e => {
          setEditing(false);
          const newContent = e.target.innerHTML;
          if (newContent !== lastVal.current) {
             lastVal.current = newContent;
             onCellChange(r, c, newContent);
          }
        }}
      />
    </td>
  );
}

function TableElement({ el, scale, onUpdate, selected, onSelect }) {
  const { rows = [], colW = 100, rowH = 28 } = el;
  const handleCellChange = (r, c, newContent) => {
    const newRows = rows.map((ro, ri) => ri === r ? ro.map((cl, ci) => ci === c ? newContent : cl) : ro); 
    onUpdate({ rows: newRows }); 
  };
  return (
    <div style={{ position: "absolute", left: el.x * scale, top: el.y * scale, width: el.width * scale, height: el.height * scale, border: selected ? "2px solid #3b7cf4" : "1px solid transparent", cursor: "pointer", overflow: "auto" }} onClick={e => { e.stopPropagation(); onSelect(); }}>
      <table style={{ borderCollapse: "collapse", fontSize: 11 * scale, width: "100%" }}>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>{row.map((cell, c) => (
              <TableCell key={c} cell={cell || ""} r={r} c={c} scale={scale} rowH={rowH} colW={colW} onCellChange={handleCellChange} />
            ))}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ZipEntryElement({ el, scale, selected, onSelect }) {
  const name = el.path.split("/").pop();
  const kb = (el.size / 1024).toFixed(1);
  const icon = FILE_ICONS[el.ext] || FILE_ICONS.default;
  return (
    <div style={{ position: "absolute", left: el.x * scale, top: el.y * scale, width: el.width * scale, height: el.height * scale, border: selected ? "2px solid #3b7cf4" : "2px solid #e2e5ef", borderRadius: 10 * scale, background: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.07)", padding: 8 * scale, gap: 4 * scale }} onClick={e => { e.stopPropagation(); onSelect(); }}>
      {el.preview ? <img src={el.preview} alt={name} style={{ width: "80%", height: 80 * scale, objectFit: "cover", borderRadius: 4 }} /> : <div style={{ fontSize: 36 * scale }}>{icon}</div>}
      <div style={{ fontSize: 10 * scale, textAlign: "center", wordBreak: "break-all", color: "#333", fontWeight: 600, lineHeight: 1.3 }}>{name}</div>
      <div style={{ fontSize: 9 * scale, color: "#888" }}>{kb} KB</div>
    </div>
  );
}

function DraggableElement({ el, scale, onUpdate, onDelete, children, selected, onSelect }) {
  const startDrag = (e) => {
    if (e.target.closest("[data-nondrag]")) return;
    e.stopPropagation(); onSelect();
    const sx = e.clientX, sy = e.clientY, ox = el.x, oy = el.y;
    const onMove = (me) => onUpdate({ x: ox + (me.clientX - sx) / scale, y: oy + (me.clientY - sy) / scale });
    const up = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", up);
  };
  const startResize = (e) => {
    e.stopPropagation();
    const sx = e.clientX, sy = e.clientY, ow = el.width || 200, oh = el.height || 100;
    const onMove = (me) => onUpdate({ width: Math.max(60, ow + (me.clientX - sx) / scale), height: Math.max(30, oh + (me.clientY - sy) / scale) });
    const up = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", up);
  };
  return (
    <div onMouseDown={startDrag} style={{ position: "absolute", left: el.x * scale, top: el.y * scale, cursor: "move", userSelect: "none" }}>
      {children}
      {selected && <>
        <button data-nondrag="1" onClick={e => { e.stopPropagation(); onDelete(); }} style={{ position: "absolute", top: -14, right: -14, width: 22, height: 22, borderRadius: "50%", background: "#ff3b4e", color: "#fff", border: "none", fontSize: 14, cursor: "pointer", lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 6px rgba(255,59,78,0.5)", zIndex: 10 }}>×</button>
        <div data-nondrag="1" onMouseDown={startResize} style={{ position: "absolute", bottom: -8, right: -8, width: 16, height: 16, borderRadius: 3, background: "#3b7cf4", cursor: "se-resize", zIndex: 10, border: "2px solid #fff" }} />
      </>}
    </div>
  );
}

function TextElement({ el, scale, onUpdate, selected, onSelect }) {
  const ref = useRef(null);
  const [editing, setEditing] = useState(false);
  const lastUpdateContent = useRef(el.content);

  useEffect(() => {
    // Only apply external changes if we are not actively in editing mode
    if (!editing && ref.current && ref.current.innerHTML !== el.content) {
      ref.current.innerHTML = el.content || "";
      lastUpdateContent.current = el.content;
    }
  }, [el.content, editing]);

  return (
    <div ref={ref} style={{ position: "absolute", left: el.x * scale, top: el.y * scale, width: (el.width || 200) * scale, minHeight: (el.height || 20) * scale, fontFamily: el.font || "Georgia", fontSize: (el.size || 12) * scale, fontWeight: el.bold ? "bold" : "normal", fontStyle: el.italic ? "italic" : "normal", textDecoration: el.underline ? "underline" : "none", color: el.color || "#000", border: selected ? "2px solid #3b7cf4" : editing ? "1px dashed #3b7cf4" : "1px solid transparent", borderRadius: 2, padding: 0, cursor: editing ? "text" : "move", outline: "none", background: "#fff", lineHeight: 1, wordBreak: "normal", whiteSpace: "nowrap", boxSizing: "border-box", zIndex: selected ? 100 : 1 }}
      contentEditable={editing} suppressContentEditableWarning
      onClick={e => { e.stopPropagation(); onSelect(); }}
      onDoubleClick={e => { e.stopPropagation(); setEditing(true); ref.current?.focus(); }}
      onBlur={e => { 
        setEditing(false); 
        const newHtml = e.target.innerHTML;
        if (newHtml !== lastUpdateContent.current) {
          lastUpdateContent.current = newHtml;
          onUpdate({ content: newHtml }); 
        }
      }}
    />
  );
}

function ImageElement({ el, scale, selected, onSelect }) {
  return (
    <div style={{ position: "absolute", left: el.x * scale, top: el.y * scale, width: (el.width || 200) * scale, height: (el.height || 150) * scale, border: selected ? "2px solid #3b7cf4" : "1px solid transparent", cursor: "move", overflow: "hidden" }} onClick={e => { e.stopPropagation(); onSelect(); }}>
      <img src={el.src} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
    </div>
  );
}

function Page({ page, scale, selectedId, onSelect, onUpdate, onDelete, showBg }) {
  const updateEl = (id, patch) => onUpdate(page.id, page.elements.map(e => e.id === id ? { ...e, ...patch } : e));
  const handleDrop = (e) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / scale, y = (e.clientY - rect.top) / scale;
    Array.from(e.dataTransfer.files).forEach(file => {
      if (file.type.startsWith("image/")) {
        const fr = new FileReader(); fr.onload = ev => onUpdate(page.id, [...page.elements, { id: uid(), type: "image", src: ev.target.result, x, y, width: 200, height: 150, selected: false }]); fr.readAsDataURL(file);
      }
    });
  };
  return (
    <div style={{ position: "relative", width: page.width * scale, height: page.height * scale, background: "#fff", boxShadow: "0 4px 28px rgba(0,0,0,0.18)", marginBottom: 32, flexShrink: 0, overflow: "hidden" }} onClick={() => onSelect(null)} onDragOver={e => e.preventDefault()} onDrop={handleDrop}>
      {page.bgImage && showBg && <img src={page.bgImage} alt="" style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none", opacity: 0.4 }} />}
      {page.elements.map(el => {
        const sel = selectedId === el.id;
        const upd = patch => updateEl(el.id, patch);
        const del = () => onDelete(page.id, el.id);
        const sel2 = () => onSelect(el.id);
        if (el.type === "text") return <DraggableElement key={el.id} el={el} scale={scale} onUpdate={upd} onDelete={del} selected={sel} onSelect={sel2}><TextElement el={el} scale={scale} onUpdate={upd} selected={sel} onSelect={sel2} /></DraggableElement>;
        if (el.type === "image") return <DraggableElement key={el.id} el={el} scale={scale} onUpdate={upd} onDelete={del} selected={sel} onSelect={sel2}><ImageElement el={el} scale={sel} selected={sel} onSelect={sel2} /></DraggableElement>;
        if (el.type === "table") return <DraggableElement key={el.id} el={el} scale={scale} onUpdate={upd} onDelete={del} selected={sel} onSelect={sel2}><TableElement el={el} scale={scale} onUpdate={upd} selected={sel} onSelect={sel2} /></DraggableElement>;
        if (el.type === "zipentry") return <DraggableElement key={el.id} el={el} scale={scale} onUpdate={upd} onDelete={del} selected={sel} onSelect={sel2}><ZipEntryElement el={el} scale={scale} selected={sel} onSelect={sel2} /></DraggableElement>;
        return null;
      })}
    </div>
  );
}

export default function UniversalEditor({ initialFileProp, onClose, onSave, token, fileId, currentUserLevel = 2, highestAuthorityLevel = 2, forceAutoSave = false, onAutoSaveComplete }) {
  const isReadOnly = currentUserLevel > highestAuthorityLevel;
  const [view, setView] = useState("editor");
  const [doc, setDoc] = useState(null);
  const [initialPdfFile, setInitialPdfFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [scale, setScale] = useState(1.0);
  const [selectedId, setSelectedId] = useState(null);
  const [activePage, setActivePage] = useState(0);
  const [showBg, setShowBg] = useState(true);
  const [history, setHistory] = useState([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatTab, setChatTab] = useState('group');
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const chatEndRef = useRef(null);
  const fileRef = useRef(null);
  const imageRef = useRef(null);
  const replaceFileRef = useRef(null);

  // Chat Polling
  useEffect(() => {
    if (!chatOpen || !token || !fileId) return;
    const fetchChat = async () => {
      try {
        const res = await fetch(`/api/documents/${fileId}/chat?token=${token}`);
        if(res.ok) {
           const data = await res.json();
           if (data.success) {
             setMessages(data.messages);
           }
        }
      } catch (e) {}
    };
    fetchChat();
    const inv = setInterval(fetchChat, 3000);
    return () => clearInterval(inv);
  }, [chatOpen, token, fileId]);

  useEffect(() => {
     if(chatOpen) chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, chatOpen]);

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !token || !fileId) return;
    const msg = newMessage;
    setNewMessage("");
    try {
       await fetch(`/api/documents/${fileId}/chat`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
             token,
             message: msg,
             isPrivate: chatTab === 'private',
             targetUser: chatTab === 'private' ? "Leader" : null // simplify for MVP
          })
       });
       // fetchChat will pick it up on next poll, or we could optimistically update
    } catch(e) {
       console.error("Chat error", e);
    }
  };

  const handleUploadReplace = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !onSave) return;
    
    // Check if the file is supported
    const allowed = ['.pdf', '.txt', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.csv', '.xlsx', '.xls', '.zip'];
    const ex = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    
    if (!allowed.includes(ex)) {
        alert("Unsupported file format for Replace.");
        return;
    }
    
    setLoading(true);
    setLoadingMsg("Uploading and Replacing File...");
    try {
        await onSave(file);
    } catch (err) {
        alert("Error replacing file: " + err.message);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (initialFileProp) {
        handleFile(initialFileProp);
    }
  }, [initialFileProp]);

  const selectedEl = doc?.pages.flatMap(p => p.elements).find(e => e.id === selectedId);

  const pushHistory = useCallback((nd) => {
    setHistory(h => [...h.slice(0, historyIdx + 1), JSON.parse(JSON.stringify(nd))].slice(-50));
    setHistoryIdx(i => i + 1);
  }, [historyIdx]);

  const undo = () => { if (historyIdx > 0) { setDoc(JSON.parse(JSON.stringify(history[historyIdx - 1]))); setHistoryIdx(i => i - 1); } };
  const redo = () => { if (historyIdx < history.length - 1) { setDoc(JSON.parse(JSON.stringify(history[historyIdx + 1]))); setHistoryIdx(i => i + 1); } };

  const handleFile = async (file) => {
    if (isReadOnly) return;
    if (file.name.toLowerCase().endsWith(".pdf")) {
      setInitialPdfFile(file);
      setView("pdf2docx");
      return;
    }
    setLoading(true); setLoadingMsg(`Parsing ${file.name}...`);
    try { const parsed = await parseFile(file); setDoc(parsed); pushHistory(parsed); setActivePage(0); setSelectedId(null); }
    catch (e) { alert("Error: " + e.message); }
    setLoading(false);
  };

  const updatePage = (pageId, elements) => {
    if (isReadOnly) return;
    setDoc(d => { const nd = { ...d, pages: d.pages.map(p => p.id === pageId ? { ...p, elements } : p) }; pushHistory(nd); return nd; });
  };
  const deleteElement = (pageId, elId) => {
    if (isReadOnly) return;
    setDoc(d => { const nd = { ...d, pages: d.pages.map(p => p.id === pageId ? { ...p, elements: p.elements.filter(e => e.id !== elId) } : p) }; pushHistory(nd); return nd; });
    setSelectedId(null);
  };
  const updateSelected = (patch) => {
    if (isReadOnly || !selectedId) return;
    setDoc(d => { const nd = { ...d, pages: d.pages.map(p => ({ ...p, elements: p.elements.map(e => e.id === selectedId ? { ...e, ...patch } : e) })) }; pushHistory(nd); return nd; });
  };
  const addText = () => {
    if (!doc) return; const page = doc.pages[activePage]; if (!page) return;
    const el = { id: uid(), type: "text", content: "New text block", x: 80, y: 80, width: 300, height: 30, font: "Georgia", size: 14, bold: false, italic: false, color: "#1a1a1a", selected: false };
    updatePage(page.id, [...page.elements, el]); setSelectedId(el.id);
  };
  const addImage = (e) => {
    const file = e.target.files?.[0]; if (!file || !doc) return;
    const fr = new FileReader(); fr.onload = ev => { const page = doc.pages[activePage]; const el = { id: uid(), type: "image", src: ev.target.result, x: 80, y: 100, width: 250, height: 180, selected: false }; updatePage(page.id, [...page.elements, el]); setSelectedId(el.id); }; fr.readAsDataURL(file); e.target.value = "";
  };
  const addTable = () => {
    if (!doc) return; const page = doc.pages[activePage]; if (!page) return;
    const rows = [["Header 1", "Header 2", "Header 3"], ["Cell 1", "Cell 2", "Cell 3"], ["Cell 4", "Cell 5", "Cell 6"]];
    const el = { id: uid(), type: "table", x: 80, y: 100, width: 360, height: 84, rows, colW: 120, rowH: 28, selected: false };
    updatePage(page.id, [...page.elements, el]); setSelectedId(el.id);
  };
  const addPage = () => {
    if (!doc) return;
    const np = { id: uid(), width: 794, height: 1122, elements: [], bgImage: null };
    setDoc(d => { const nd = { ...d, pages: [...d.pages, np] }; pushHistory(nd); return nd; });
    setActivePage(doc.pages.length);
  };

  const handleSaveToLink = async () => {
    if (!onSave || !doc) return;
    setLoading(true);
    setLoadingMsg("Saving to Secure Link...");
    try {
      let savedFile;
      if (doc.type === 'pdf') {
        const { PDFDocument, rgb, StandardFonts } = await import("pdf-lib");
        const pdfDoc = await PDFDocument.create();
        for (const page of doc.pages) {
          const pdfPage = pdfDoc.addPage([page.width, page.height]);
          pdfPage.drawRectangle({ x: 0, y: 0, width: page.width, height: page.height, color: rgb(1, 1, 1) });
          for (const el of page.elements) {
            if (el.type === "text") {
              try { const font = await pdfDoc.embedFont(el.bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica); const fs = el.size || 12; pdfPage.drawText(el.content || "", { x: el.x, y: Math.max(0, page.height - el.y - fs), size: fs, font, color: rgb(0, 0, 0) }); } catch { }
            } else if (el.type === "image" && el.src) {
              try { const b64 = el.src.split(",")[1]; const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); const img = el.src.includes("image/png") ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes); pdfPage.drawImage(img, { x: el.x, y: page.height - el.y - el.height, width: el.width, height: el.height }); } catch { }
            } else if (el.type === "table") {
              try { const font = await pdfDoc.embedFont(StandardFonts.Helvetica); const { rows = [], colW = 100, rowH = 24 } = el; for (let r = 0; r < rows.length; r++) for (let c = 0; c < (rows[r] || []).length; c++) { const cx = el.x + c * colW, cy = page.height - el.y - (r + 1) * rowH; pdfPage.drawRectangle({ x: cx, y: cy, width: colW, height: rowH, borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 0.5, color: r === 0 ? rgb(0.88, 0.88, 0.95) : rgb(1, 1, 1) }); pdfPage.drawText(String(rows[r][c] || ""), { x: cx + 4, y: cy + 6, size: 9, font, color: rgb(0, 0, 0) }); } } catch { }
            }
          }
        }
        const pdfBytes = await pdfDoc.save();
        savedFile = new File([pdfBytes], doc.name + ".pdf", { type: "application/pdf" });
      } else if (doc.type === "csv" || doc.type === "xlsx" || doc.type === "xls") {
        const table = doc.pages[0]?.elements.find(e => e.type === "table");
        if (table && table.rows) {
          const XLSX = await import("xlsx");
          const worksheet = XLSX.utils.aoa_to_sheet(table.rows);
          if (doc.type === "csv") {
            const csvStr = XLSX.utils.sheet_to_csv(worksheet);
            savedFile = new File([csvStr], doc.name || "edited.csv", { type: "text/csv" });
          } else {
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
            const buf = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
            savedFile = new File([buf], doc.name || "edited.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
          }
        } else {
          savedFile = new File([""], doc.name || "edited.txt", { type: "text/plain" });
        }
      } else {
        const text = doc?.pages.flatMap(p => p.elements.filter(e => e.type === "text").map(e => e.content)).join("\n");
        savedFile = new File([text], doc.name || "edited.txt", { type: "text/plain" });
      }
      await onSave(savedFile);
    } catch (err) {
      alert("Error saving: " + err.message);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (forceAutoSave && doc && !isReadOnly && !loading) {
      handleSaveToLink().then(() => {
        if (onAutoSaveComplete) onAutoSaveComplete();
      });
    }
  }, [forceAutoSave]);

  useEffect(() => {
    const h = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "y") { e.preventDefault(); redo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === "c" || e.key === "C" || e.key === "x" || e.key === "X")) { e.preventDefault(); }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId && document.activeElement.tagName === "BODY" && !isReadOnly) { const p = doc?.pages[activePage]; if (p) deleteElement(p.id, selectedId); }
    };
    const preventCopy = (e) => e.preventDefault();
    window.addEventListener("keydown", h);
    window.addEventListener("copy", preventCopy);
    window.addEventListener("cut", preventCopy);
    return () => {
        window.removeEventListener("keydown", h);
        window.removeEventListener("copy", preventCopy);
        window.removeEventListener("cut", preventCopy);
    };
  }, [selectedId, activePage, doc, historyIdx]);

  const css = `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Playfair+Display:wght@700;800&display=swap');
    *{box-sizing:border-box;margin:0;padding:0;user-select:none;-webkit-user-select:none;}
    input, textarea, [contenteditable] { user-select: auto;-webkit-user-select:auto; }
    body{font-family:'Inter',sans-serif;background:#f0f4fb;color:#1a2540;}
    ::-webkit-scrollbar{width:6px;height:6px;}
    ::-webkit-scrollbar-track{background:#f1f4f9;}
    ::-webkit-scrollbar-thumb{background:#c0c8e0;border-radius:10px;}
    ::-webkit-scrollbar-thumb:hover{background:#3b7cf4;}
    
    .btn{display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:8px;border:none;cursor:pointer;font-size:13px;font-weight:500;transition:all .2s;white-space:nowrap;font-family:inherit;}
    .btn-ghost{background:transparent;color:#5a6a8a;}
    .btn-ghost:hover:not(:disabled){background:#edf2ff;color:#2347a0;}
    .btn-ghost:disabled{opacity:0.35;cursor:not-allowed;}
    .btn-primary{background:linear-gradient(135deg, #2347a0, #3b7cf4);color:#fff;box-shadow:0 4px 12px rgba(35,71,160,0.25);}
    .btn-primary:hover{transform:translateY(-1px);box-shadow:0 6px 16px rgba(35,71,160,0.35);}
    .btn-danger{background:#fee2e2;color:#dc2626;border:1px solid #fecaca;}
    .btn-danger:hover{background:#fecaca;}
    .btn-outline{border:1px solid #e4e9f5;background:#fff;color:#5a6a8a;}
    .btn-outline:hover{border-color:#3b7cf4;color:#3b7cf4;background:#f8faff;}
    
    .sep{width:1px;height:24px;background:#e4e9f5;margin:0 6px;}
    .tsel{background:#fff;color:#1a2540;border:1px solid #e4e9f5;border-radius:6px;padding:4px 8px;font-size:12px;font-family:inherit;cursor:pointer;outline:none;box-shadow:0 1px 2px rgba(0,0,0,0.05);}
    .tsel:hover{border-color:#3b7cf4;}
    
    .pinput{width:100%;background:#fff;border:1px solid #e4e9f5;color:#1a2540;border-radius:6px;padding:8px 10px;font-size:12px;font-family:inherit;outline:none;transition:border-color .2s;}
    .pinput:focus{border-color:#3b7cf4;box-shadow:0 0 0 3px rgba(59,124,244,0.1);}
    
    .plabel{font-size:10px;color:#8896b0;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px;font-weight:600;}
    .psec{margin-bottom:18px;}
    
    .thumb{width:100%;aspect-ratio:210/297;background:#fff;border-radius:8px;cursor:pointer;overflow:hidden;margin-bottom:10px;position:relative;border:2px solid transparent;transition:all .2s;box-shadow:0 2px 8px rgba(0,0,0,0.06);}
    .thumb:hover{transform:translateY(-2px);box-shadow:0 4px 12px rgba(0,0,0,0.1);}
    .thumb.active{border-color:#3b7cf4;box-shadow:0 4px 16px rgba(59,124,244,0.2);}
    
    .dz{border:2.5px dashed #a0b4d4;border-radius:24px;padding:60px 40px;text-align:center;cursor:pointer;transition:all .25s;background:rgba(255,255,255,0.5);}
    .dz:hover{border-color:#3b7cf4;background:#fff;transform:scale(1.01);box-shadow:0 12px 40px rgba(35,71,160,0.08);}
    
    .panel{background:#fff;border-radius:16px;border:1px solid #e4e9f5;box-shadow:0 4px 20px rgba(35,71,160,0.07);overflow:hidden;}
    
    @keyframes spin{to{transform:rotate(360deg);}}
    .spin{animation:spin .8s linear infinite;}
    @keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
    .fup{animation:fadeUp .4s ease both;}
    .pulse{animation:pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
  `;

  return (
    <>
      <style>{css}</style>
      <div 
        style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#f0f4fb", color: "#1a2540", userSelect: "none", WebkitUserSelect: "none" }}
        onContextMenu={e => e.preventDefault()}
        onCopy={e => e.preventDefault()}
      >

        <div style={{ height: 56, background: "#fff", borderBottom: "1px solid #e4e9f5", display: "flex", alignItems: "center", padding: "0 24px", gap: 16, flexShrink: 0, boxShadow: "0 2px 10px rgba(35,71,160,0.06)", zIndex: 100 }}>
          {onClose && (
            <button className="btn btn-ghost" onClick={onClose} style={{ padding: "4px 8px" }}>← Back</button>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }} onClick={() => { setDoc(null); setInitialPdfFile(null); setView("editor"); }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: "linear-gradient(135deg, #2347a0, #3b7cf4)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 12px rgba(35,71,160,0.25)" }}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 2L3 6v8l7 4 7-4V6L10 2z" stroke="#fff" strokeWidth="1.5" fill="rgba(255,255,255,0.15)" /><path d="M10 2v16M3 6l7 4 7-4" stroke="#fff" strokeWidth="1.5" /></svg>
            </div>
            <span style={{ fontFamily: "'Playfair Display', serif", fontWeight: 800, fontSize: 18, color: "#1a2540", letterSpacing: "-0.01em" }}>UniEdit</span>
            <span style={{ fontSize: 10, color: "#3b7cf4", background: "#edf2ff", borderRadius: 5, padding: "2px 8px", fontWeight: 700, letterSpacing: "0.05em", border: "1px solid rgba(59,124,244,0.15)" }}>PRO</span>
          </div>
          
          <div style={{ flex: 1 }} />

          {doc && view === "editor" && <div style={{ marginRight: "auto", display: "flex", alignItems: "center", gap: 10, padding: "4px 16px", background: "#f5f7ff", borderRadius: 10, fontSize: 13, color: "#5a6a8a" }}>
            <span>{getFileIcon(doc.name)}</span>
            <span style={{ fontWeight: 600 }}>{doc.name}</span>
          </div>}

          {doc && view === "editor" && <>
            <div style={{ display: "flex", gap: 4 }}>
              <button className="btn btn-ghost" onClick={undo} disabled={isReadOnly || historyIdx <= 0} title="Undo (Ctrl+Z)">↩ Undo</button>
              <button className="btn btn-ghost" onClick={redo} disabled={isReadOnly || historyIdx >= history.length - 1} title="Redo (Ctrl+Y)">↪ Redo</button>
            </div>
            <div className="sep" />
            {onSave && (
              <div style={{ display: "flex", gap: "8px" }}>
                <button className="btn btn-outline" disabled={isReadOnly} style={{ background: "#fff", borderColor: "#a0b4d4", color: "#2347a0", gap: "6px", opacity: isReadOnly ? 0.5 : 1, cursor: isReadOnly ? "not-allowed" : "pointer" }} onClick={() => replaceFileRef.current?.click()}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                  Upload Replace
                </button>
                <input ref={replaceFileRef} type="file" accept=".pdf,.txt,.png,.jpg,.jpeg,.gif,.webp,.csv,.xlsx,.xls,.zip" style={{ display: "none" }} onChange={(e) => { handleUploadReplace(e); e.target.value = ""; }} />
                <button className="btn btn-primary" disabled={isReadOnly} style={{ opacity: isReadOnly ? 0.5 : 1, cursor: isReadOnly ? "not-allowed" : "pointer", background: "linear-gradient(135deg, #10b981, #059669)", boxShadow: "0 4px 12px rgba(16, 185, 129, 0.25)" }} onClick={handleSaveToLink}>
                  💾 Save Replace
                </button>
              </div>
            )}
            {token && fileId && (
               <>
                 <div className="sep" />
                 <button className={`btn ${chatOpen ? 'btn-primary' : 'btn-outline'}`} onClick={() => setChatOpen(!chatOpen)}>
                    💬 Chat
                 </button>
               </>
            )}
          </>}
        </div>

        {isReadOnly && doc && view === "editor" && (
            <div className="fup" style={{ padding: "10px 16px", background: "#fee2e2", borderBottom: "1px solid #fecaca", color: "#dc2626", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, zIndex: 99, flexShrink: 0 }}>
                ⚠️ Editing is disabled. A higher authority Team Leader (Level {highestAuthorityLevel}) is currently active in this session.
            </div>
        )}

        {doc && view === "editor" && <div style={{ height: 48, background: "#fff", borderBottom: "1px solid #e4e9f5", display: "flex", alignItems: "center", padding: "0 16px", gap: 6, flexShrink: 0, overflowX: "auto" }}>
          <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>📂 Open File</button>
          <input ref={fileRef} type="file" disabled={isReadOnly} accept=".pdf,.txt,.png,.jpg,.jpeg,.gif,.webp,.csv,.xlsx,.xls,.zip" style={{ display: "none" }} onChange={e => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }} />
          <div className="sep" />
          <button className="btn btn-ghost" style={{ background: showBg ? "#edf2ff" : "transparent", color: showBg ? "#2347a0" : "#5a6a8a" }} onClick={() => setShowBg(!showBg)}>{showBg ? "👁 Background: On" : "👁 Background: Off" } </button>
          <div className="sep" />
          <button className="btn btn-ghost" disabled={isReadOnly} onClick={addText}>＋ Text</button>
          <button className="btn btn-ghost" disabled={isReadOnly} onClick={() => imageRef.current?.click()}>🖼 Image</button>
          <input ref={imageRef} type="file" accept="image/*" style={{ display: "none" }} onChange={addImage} disabled={isReadOnly} />
          <button className="btn btn-ghost" disabled={isReadOnly} onClick={addTable}>⊞ Table</button>
          <button className="btn btn-ghost" disabled={isReadOnly} onClick={addPage}>＋ Page</button>
          <div className="sep" />
          {selectedEl?.type === "text" && <>
            <select className="tsel" value={selectedEl.font || "Georgia"} onChange={e => updateSelected({ font: e.target.value })} style={{ width: 130 }}>{FONTS.map(f => <option key={f} value={f}>{f}</option>)}</select>
            <select className="tsel" value={selectedEl.size || 12} onChange={e => updateSelected({ size: Number(e.target.value) })}>{FONT_SIZES.map(s => <option key={s} value={s}>{s}</option>)}</select>
            <button className="btn btn-ghost" style={{ fontWeight: "bold", background: selectedEl.bold ? "#1e2235" : "transparent" }} onClick={() => updateSelected({ bold: !selectedEl.bold })}>B</button>
            <button className="btn btn-ghost" style={{ fontStyle: "italic", background: selectedEl.italic ? "#1e2235" : "transparent" }} onClick={() => updateSelected({ italic: !selectedEl.italic })}>I</button>
            <button className="btn btn-ghost" style={{ textDecoration: "underline", background: selectedEl.underline ? "#1e2235" : "transparent" }} onClick={() => updateSelected({ underline: !selectedEl.underline })}>U</button>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ fontSize: 11, color: "#4a5268" }}>Color</span>
              <input type="color" value={selectedEl.color || "#000000"} onChange={e => updateSelected({ color: e.target.value })} style={{ width: 28, height: 24, border: "none", borderRadius: 4, background: "none", cursor: "pointer", padding: 0 }} />
            </div>
            <div className="sep" />
          </>}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 5 }}>
            <button className="btn btn-ghost" style={{ padding: "4px 9px" }} onClick={() => setScale(s => Math.max(0.4, +(s - 0.1).toFixed(2)))}>−</button>
            <span style={{ fontSize: 12, color: "#4a5268", minWidth: 40, textAlign: "center" }}>{Math.round(scale * 100)}%</span>
            <button className="btn btn-ghost" style={{ padding: "4px 9px" }} onClick={() => setScale(s => Math.min(2.5, +(s + 0.1).toFixed(2)))}>＋</button>
            <select className="tsel" value={scale} onChange={e => setScale(Number(e.target.value))}>
              {[0.5, 0.75, 1, 1.25, 1.5, 2].map(v => <option key={v} value={v}>{Math.round(v * 100)}%</option>)}
            </select>
          </div>
        </div>}

        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          {view === "editor" && (
            <>
              {doc && <div style={{ width: 140, background: "#fff", borderRight: "1px solid #e4e9f5", padding: "16px 12px", overflowY: "auto", flexShrink: 0, display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#8896b0", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Pages</div>
                {doc.pages.map((page, idx) => (
                  <div key={page.id} className={`thumb ${idx === activePage ? "active" : ""}`} onClick={() => setActivePage(idx)}>
                    {page.bgImage ? <img src={page.bgImage} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <div style={{ background: "#f8faff", width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#c0c8e0", fontSize: 14, fontWeight: 700 }}>{idx + 1}</div>}
                    <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, textAlign: "center", fontSize: 10, color: "#fff", background: "linear-gradient(transparent, rgba(26,37,64,0.6))", padding: "8px 0", fontWeight: 600 }}>{idx + 1}</div>
                  </div>
                ))}
                <button className="btn btn-outline" disabled={isReadOnly} style={{ borderStyle: "dashed", width: "100%", fontSize: 12, padding: "8px", cursor: isReadOnly ? "not-allowed" : "pointer" }} onClick={addPage}>＋ Add Page</button>
              </div>}

              <div style={{ flex: 1, overflowY: "auto", overflowX: "auto", display: "flex", flexDirection: "column", alignItems: "center", padding: "48px 24px", background: "linear-gradient(135deg, #f8faff 0%, #edf2ff 100%)", position: "relative" }}>
                {loading && <div style={{ position: "fixed", inset: 0, background: "rgba(255,255,255,0.85)", backdropFilter: "blur(4px)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 1000, gap: 20 }}>
                  <div className="spin" style={{ width: 56, height: 56, borderRadius: "50%", border: "3px solid #e0e7ff", borderTopColor: "#3b7cf4" }} />
                  <div style={{ color: "#2347a0", fontSize: 16, fontWeight: 600 }}>{loadingMsg}</div>
                </div>}

                {!doc && !loading && <div className="fup" style={{ maxWidth: 640, width: "100%", marginTop: 32 }}>
                  <div style={{ textAlign: "center", marginBottom: 48 }}>
                    <div className="pulse" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 84, height: 84, borderRadius: 24, background: "linear-gradient(135deg, #2347a0, #3b7cf4)", boxShadow: "0 8px 32px rgba(35,71,160,0.25)", marginBottom: 28 }}>
                      <svg width="40" height="40" viewBox="0 0 20 20" fill="none"><path d="M10 2L3 6v8l7 4 7-4V6L10 2z" stroke="#fff" strokeWidth="1.5" fill="rgba(255,255,255,0.15)" /><path d="M10 2v16M3 6l7 4 7-4" stroke="#fff" strokeWidth="1.5" /></svg>
                    </div>
                    <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 42, fontWeight: 800, color: "#1a2540", letterSpacing: "-0.02em", marginBottom: 12 }}>Universal Editor</h1>
                    <p style={{ color: "#5a6a8a", fontSize: 16, lineHeight: 1.6 }}>Edit PDFs, Documents, and Media with precision.<br />Professional tools for your daily workflow.</p>
                  </div>

                  <div className="dz" onClick={() => fileRef.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}>
                    <div style={{ fontSize: 52, marginBottom: 16 }}>📄</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: "#1a2540", marginBottom: 8 }}>Drop your file here</div>
                    <div style={{ fontSize: 14, color: "#8896b0", marginBottom: 28 }}>PDF · DOCX · PNG · CSV · XLSX · ZIP · TXT</div>
                    <button className="btn btn-primary" style={{ fontSize: 14, padding: "12px 32px" }}>Browse Files</button>
                  </div>
                  <input ref={fileRef} type="file" accept=".pdf,.txt,.png,.jpg,.jpeg,.gif,.webp,.csv,.xlsx,.xls,.zip" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16, marginTop: 40 }}>
                    {[["📑", "PDF Edit", "Full text & layout extraction"], ["✍️", "Structured Docs", "Export to DOCX or PDF"], ["📊", "Data Cells", "Directly edit CSV & XLSX"], ["🖼️", "Media Studio", "Reposition & annotate images"], ["📦", "ZIP Explorer", "Browse & edit zipped docs"], ["🎨", "Premium UI", "Modern workspace aesthetic"]].map(([icon, title, desc]) => (
                      <div key={title} className="panel" style={{ padding: "20px 16px", background: "#fff" }}>
                        <div style={{ fontSize: 28, marginBottom: 8 }}>{icon}</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "#1a2540", marginBottom: 4 }}>{title}</div>
                        <div style={{ fontSize: 12, color: "#8896b0", lineHeight: 1.5 }}>{desc}</div>
                      </div>
                    ))}
                  </div>
                </div>}

                {doc && doc.pages.map((page, idx) => (
                  <div key={page.id} className="fup" style={{ display: idx === activePage ? "block" : "none" }}>
                    <Page page={page} scale={scale} selectedId={selectedId} onSelect={setSelectedId} onUpdate={updatePage} onDelete={deleteElement} showBg={showBg} />
                  </div>
                ))}

                {doc && doc.pages.length > 1 && <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 12, padding: "8px 20px", background: "#fff", borderRadius: 24, border: "1px solid #e4e9f5", boxShadow: "0 4px 12px rgba(35,71,160,0.06)", position: "sticky", bottom: 20 }}>
                  <button className="btn btn-ghost" style={{ padding: "4px 12px" }} disabled={activePage === 0} onClick={() => setActivePage(p => p - 1)}>← Prev</button>
                  <span style={{ fontSize: 13, color: "#5a6a8a", fontWeight: 600 }}>{activePage + 1} / {doc.pages.length}</span>
                  <button className="btn btn-ghost" style={{ padding: "4px 12px" }} disabled={activePage === doc.pages.length - 1} onClick={() => setActivePage(p => p + 1)}>Next →</button>
                </div>}
              </div>

              {doc && selectedEl && <div style={{ width: 260, background: "#fff", borderLeft: "1px solid #e4e9f5", overflowY: "auto", flexShrink: 0 }}>
                <div style={{ padding: "16px 18px", borderBottom: "1px solid #e4e9f5", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#f8faff" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#8896b0", textTransform: "uppercase", letterSpacing: "0.08em" }}>Properties</span>
                  {!isReadOnly && <button className="btn btn-danger" style={{ fontSize: 10, padding: "3px 10px" }} onClick={() => { const p = doc.pages[activePage]; if (p) deleteElement(p.id, selectedId); }}>Delete</button>}
                </div>
                <div style={{ padding: 18, pointerEvents: isReadOnly ? "none" : "auto", opacity: isReadOnly ? 0.7 : 1 }}>
                  <div className="psec"><div className="plabel">Element Type</div><div style={{ fontSize: 14, color: "#1a2540", fontWeight: 600 }}>{selectedEl.type.toUpperCase()}</div></div>
                  <div className="psec"><div className="plabel">Position & Size</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      {["x", "y"].map(k => <div key={k}><div style={{ fontSize: 10, color: "#4a5268", marginBottom: 3 }}>{k.toUpperCase()}</div><input className="pinput" type="number" value={Math.round(selectedEl[k] || 0)} onChange={e => updateSelected({ [k]: Number(e.target.value) })} /></div>)}
                    </div>
                  </div>
                  <div className="psec"><div className="plabel">Size</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                      {["width", "height"].map(k => <div key={k}><div style={{ fontSize: 10, color: "#4a5268", marginBottom: 3 }}>{k.charAt(0).toUpperCase() + k.slice(1)}</div><input className="pinput" type="number" value={Math.round(selectedEl[k] || 0)} onChange={e => updateSelected({ [k]: Number(e.target.value) })} /></div>)}
                    </div>
                  </div>
                  {selectedEl.type === "text" && <>
                    <div className="psec"><div className="plabel">Content</div><textarea className="pinput" rows={4} value={selectedEl.content || ""} onChange={e => updateSelected({ content: e.target.value })} style={{ resize: "vertical" }} /></div>
                    <div className="psec"><div className="plabel">Font</div><select className="pinput" value={selectedEl.font || "Georgia"} onChange={e => updateSelected({ font: e.target.value })}>{FONTS.map(f => <option key={f} value={f}>{f}</option>)}</select></div>
                    <div className="psec"><div className="plabel">Font Size</div><input className="pinput" type="number" value={selectedEl.size || 12} onChange={e => updateSelected({ size: Number(e.target.value) })} /></div>
                    <div className="psec"><div className="plabel">Style</div>
                      <div style={{ display: "flex", gap: 5 }}>
                        {[{ k: "bold", label: "B", s: { fontWeight: "bold" } }, { k: "italic", label: "I", s: { fontStyle: "italic" } }, { k: "underline", label: "U", s: { textDecoration: "underline" } }].map(({ k, label, s }) => (
                          <button key={k} className="btn btn-ghost" style={{ ...s, flex: 1, justifyContent: "center", background: selectedEl[k] ? "#1e2235" : "transparent", border: "1px solid #1e2235" }} onClick={() => updateSelected({ [k]: !selectedEl[k] })}>{label}</button>
                        ))}
                      </div>
                    </div>
                    <div className="psec"><div className="plabel">Text Color</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <input type="color" value={selectedEl.color || "#000000"} onChange={e => updateSelected({ color: e.target.value })} style={{ width: 34, height: 30, border: "none", borderRadius: 5, background: "none", cursor: "pointer", padding: 0 }} />
                        <input className="pinput" value={selectedEl.color || "#000000"} onChange={e => updateSelected({ color: e.target.value })} style={{ flex: 1 }} />
                      </div>
                    </div>
                  </>}
                </div>
              </div>}
            </>
          )}

          {view === "pdf2docx" && <PDFtoDOCX onBack={() => { setView("editor"); setInitialPdfFile(null); }} initialFile={initialPdfFile} onSave={onSave} forceAutoSave={forceAutoSave} onAutoSaveComplete={onAutoSaveComplete} />}

          {/* Chat Sidebar */}
          {chatOpen && (
             <div style={{ width: 320, background: "#fff", borderLeft: "1px solid #e4e9f5", display: "flex", flexDirection: "column", flexShrink: 0, boxShadow: "-4px 0 24px rgba(35,71,160,0.05)" }}>
                <div style={{ padding: "16px", borderBottom: "1px solid #e4e9f5", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#f8faff" }}>
                   <div style={{ fontWeight: 700, color: "#1a2540", fontSize: 14 }}>Session Chat</div>
                   <button className="btn btn-ghost" style={{ padding: 4 }} onClick={() => setChatOpen(false)}>✕</button>
                </div>
                
                <div style={{ display: "flex", borderBottom: "1px solid #e4e9f5" }}>
                   <div style={{ flex: 1, textAlign: "center", padding: "10px", fontSize: 12, cursor: "pointer", fontWeight: 600, borderBottom: chatTab === 'group' ? "2px solid #3b7cf4" : "2px solid transparent", color: chatTab === 'group' ? "#3b7cf4" : "#8896b0" }} onClick={() => setChatTab('group')}>Group Chat</div>
                   <div style={{ flex: 1, textAlign: "center", padding: "10px", fontSize: 12, cursor: "pointer", fontWeight: 600, borderBottom: chatTab === 'private' ? "2px solid #3b7cf4" : "2px solid transparent", color: chatTab === 'private' ? "#3b7cf4" : "#8896b0" }} onClick={() => setChatTab('private')}>Private (Leader)</div>
                </div>

                <div style={{ flex: 1, overflowY: "auto", padding: "16px", background: "#f8faff", display: "flex", flexDirection: "column", gap: 12 }}>
                   {messages.filter(m => chatTab === 'group' ? !m.isPrivate : m.isPrivate).map(m => (
                      <div key={m.id} style={{ alignSelf: m.level === currentUserLevel ? "flex-end" : "flex-start", maxWidth: "85%" }}>
                         <div style={{ fontSize: 10, color: "#8896b0", marginBottom: 2, textAlign: m.level === currentUserLevel ? "right" : "left", fontWeight: 600 }}>
                            {m.sender.split('@')[0]} {m.level === 1 ? '👑' : ''}
                         </div>
                         <div style={{ background: m.level === currentUserLevel ? "linear-gradient(135deg, #2347a0, #3b7cf4)" : "#fff", color: m.level === currentUserLevel ? "#fff" : "#1a2540", padding: "10px 14px", borderRadius: 16, borderTopRightRadius: m.level === currentUserLevel ? 4 : 16, borderTopLeftRadius: m.level === currentUserLevel ? 16 : 4, fontSize: 13, lineHeight: 1.4, boxShadow: "0 2px 8px rgba(0,0,0,0.05)", border: m.level === currentUserLevel ? "none" : "1px solid #e4e9f5" }}>
                            {m.message}
                         </div>
                      </div>
                   ))}
                   <div ref={chatEndRef} />
                </div>

                <div style={{ padding: "16px", borderTop: "1px solid #e4e9f5", background: "#fff", display: "flex", gap: 8 }}>
                   <input 
                     className="pinput" 
                     placeholder={chatTab === 'group' ? "Message group..." : "Message leader..."} 
                     value={newMessage} 
                     onChange={e => setNewMessage(e.target.value)} 
                     onKeyDown={e => { if(e.key === 'Enter') handleSendMessage(); }} 
                     style={{ flex: 1, borderRadius: 20, padding: "10px 16px" }}
                   />
                   <button className="btn btn-primary" style={{ borderRadius: "50%", width: 36, height: 36, padding: 0, justifyContent: "center" }} onClick={handleSendMessage}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                   </button>
                </div>
             </div>
          )}
        </div>
      </div>
    </>
  );
}
