"use client";
import React, { useState, useRef, useEffect } from "react";
import "../editor.css";
import { DocumentData } from "../types";
import { getFileIcon, uid } from "../utils/editorUtils";
import { parseFile } from "../utils/fileParsers";
import { exportDocument } from "../utils/fileExporters";
import { useEditorState } from "../hooks/useEditorState";
import { Page } from "../layout/Page";

interface UniversalEditorProps {
  token?: string;
  fileId?: string;
  initialFileProp?: File | null;
  currentUserLevel: number;
  highestAuthorityLevel: number;
  onClose?: () => void;
  onSave?: (file: File) => Promise<void>;
  onSubmit?: (file: File) => Promise<void>;
  forceAutoSave?: boolean;
  onAutoSaveComplete?: () => void;
}

export default function UniversalEditor({
  token,
  fileId,
  initialFileProp,
  currentUserLevel,
  highestAuthorityLevel,
  onClose,
  onSave,
  onSubmit,
  forceAutoSave,
  onAutoSaveComplete
}: UniversalEditorProps) {
  const isReadOnly = currentUserLevel > highestAuthorityLevel;
  const [view, setView] = useState("editor");
  const { doc, setDoc, activePage, setActivePage, selectedId, setSelectedId, historyIdx, undo, redo, pushHistory, updatePage, deleteElement, updateSelected } = useEditorState(null);
  
  const [draggedPageIdx, setDraggedPageIdx] = useState<number | null>(null);
  const [initialPdfFile, setInitialPdfFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [scale, setScale] = useState(1.0);
  const [showBg, setShowBg] = useState(true);
  
  const [chatOpen, setChatOpen] = useState(false);
  const [chatTab, setChatTab] = useState('group');
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  
  const docRef = useRef(doc);
  const onSaveRef = useRef(onSave);
  const onSubmitRef = useRef(onSubmit);
  const isSavingRef = useRef(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Chat Polling
  useEffect(() => {
    if (!chatOpen || !token || !fileId) return;
    const fetchChat = async () => {
      try {
        const res = await fetch(`/api/documents/${fileId}/chat?token=${token}`);
        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            setMessages(data.messages);
          }
        }
      } catch (e) { }
    };
    fetchChat();
    const inv = setInterval(fetchChat, 3000);
    return () => clearInterval(inv);
  }, [chatOpen, token, fileId]);

  useEffect(() => {
    if (chatOpen) chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, chatOpen]);

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !token || !fileId) return;
    const msg = newMessage;
    setNewMessage("");
    try {
      await fetch(`/api/documents/${fileId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          message: msg,
          isPrivate: chatTab === 'private',
          targetUser: chatTab === 'private' ? "Leader" : null
        })
      });
    } catch (e) {
      console.error("Chat error", e);
    }
  };

  const handleUploadReplace = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onSave) return;

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
    } catch (err: any) {
      alert("Error replacing file: " + err.message);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (initialFileProp) {
      handleFile(initialFileProp);
    }
  }, [initialFileProp]);

  const handleFile = async (file: File) => {
    if (isReadOnly) return;
    if (file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf") {
      alert("PDF files are view-only and cannot be edited. Please use the secure viewer.");
      return;
    }
    setLoading(true); 
    setLoadingMsg(`Parsing ${file.name}...`);
    try { 
      const parsed = await parseFile(file); 
      setDoc(parsed); 
      pushHistory(parsed); 
      setActivePage(0); 
      setSelectedId(null); 
    }
    catch (e: any) { alert("Error: " + e.message); }
    setLoading(false);
  };

  const addText = () => {
    if (!doc) return; const page = doc.pages[activePage]; if (!page) return;
    const el = { id: uid(), type: "text" as const, content: "New text block", x: 80, y: 80, width: 300, height: 30, font: "Georgia", size: 14, bold: false, italic: false, color: "#1a1a1a", selected: false };
    updatePage(page.id, [...page.elements, el]); setSelectedId(el.id);
  };

  const addImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file || !doc) return;
    const fr = new FileReader(); 
    fr.onload = ev => { 
      const page = doc.pages[activePage]; 
      const el = { id: uid(), type: "image" as const, src: ev.target?.result as string, x: 80, y: 100, width: 250, height: 180, selected: false }; 
      updatePage(page.id, [...page.elements, el]); 
      setSelectedId(el.id); 
    }; 
    fr.readAsDataURL(file); 
    e.target.value = "";
  };

  const addTable = () => {
    if (!doc) return; const page = doc.pages[activePage]; if (!page) return;
    const rows = [["Header 1", "Header 2", "Header 3"].map(v=>({value: v})), ["Cell 1", "Cell 2", "Cell 3"].map(v=>({value: v})), ["Cell 4", "Cell 5", "Cell 6"].map(v=>({value: v}))];
    const el = { id: uid(), type: "table" as const, x: 80, y: 100, width: 360, height: 84, rows, colW: 120, rowH: 28, selected: false, hasHeader: true };
    updatePage(page.id, [...page.elements, el]); setSelectedId(el.id);
  };

  const addPage = () => {
    if (!doc) return;
    const np = { id: uid(), order: doc.pages.length, createdAt: Date.now(), width: 794, height: 1122, elements: [], bgImage: null };
    const nd = { ...doc, pages: [...doc.pages, np] };
    setDoc(nd);
    pushHistory(nd);
    setActivePage(nd.pages.length - 1);
    handleSaveToLink(false, nd);
  };

  const handleDragStart = (e: React.DragEvent, idx: number) => {
    setDraggedPageIdx(idx);
    e.dataTransfer.effectAllowed = "move";
  };
  
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDropPage = (e: React.DragEvent, targetIdx: number) => {
    e.preventDefault();
    if (draggedPageIdx === null || draggedPageIdx === targetIdx || isReadOnly || !doc) return;
    
    const newPages = [...doc.pages];
    const [movedPage] = newPages.splice(draggedPageIdx, 1);
    newPages.splice(targetIdx, 0, movedPage);
    newPages.forEach((p, i) => { p.order = i; });
    
    const nd = { ...doc, pages: newPages };
    setDoc(nd);
    pushHistory(nd);
    
    if (activePage === draggedPageIdx) {
      setActivePage(targetIdx);
    } else if (activePage > draggedPageIdx && activePage <= targetIdx) {
      setActivePage(activePage - 1);
    } else if (activePage < draggedPageIdx && activePage >= targetIdx) {
      setActivePage(activePage + 1);
    }
    setDraggedPageIdx(null);
    handleSaveToLink(false, nd);
  };

  const handleSaveToLink = async (isSubmit = false, overrideDoc: DocumentData | null = null, silent = false) => {
    if (isSavingRef.current) return;
    isSavingRef.current = true;
    
    const currentDoc = overrideDoc || doc;
    const actionFn = isSubmit ? onSubmitRef.current : onSaveRef.current;
    if (!actionFn || !currentDoc) {
      isSavingRef.current = false;
      return;
    }
    
    if (!silent) {
      setLoading(true);
      setLoadingMsg(isSubmit ? "Submitting Final Document..." : "Saving Draft...");
    }
    
    try {
      let savedFile: File;

      if (!isSubmit) {
        savedFile = new File(
          [JSON.stringify(currentDoc)],
          currentDoc.name || "workspace.dg",
          { type: "application/json" }
        );
      } else {
        savedFile = await exportDocument(currentDoc);
      }

      await actionFn(savedFile);
      if (!silent) setLoading(false);
    } catch (e: any) {
      console.error("Save error:", e);
      if (!silent) {
        alert("Failed to save: " + e.message);
        setLoading(false);
      }
    } finally {
      isSavingRef.current = false;
    }
  };

  useEffect(() => {
    docRef.current = doc;
  }, [doc]);

  useEffect(() => {
    onSaveRef.current = onSave;
    onSubmitRef.current = onSubmit;
  }, [onSave, onSubmit]);

  useEffect(() => {
    if (isReadOnly) return;
    const interval = setInterval(() => {
      if (docRef.current) {
        handleSaveToLink(false, docRef.current, true).catch(err => console.error("Autosave error:", err));
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [isReadOnly]);

  useEffect(() => {
    if (forceAutoSave && doc && !isReadOnly && !loading) {
      handleSaveToLink().then(() => {
        if (onAutoSaveComplete) onAutoSaveComplete();
      });
    }
  }, [forceAutoSave]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "y") { e.preventDefault(); redo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === "c" || e.key === "C" || e.key === "x" || e.key === "X")) { e.preventDefault(); }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId && document.activeElement?.tagName === "BODY" && !isReadOnly) { 
        const p = doc?.pages[activePage]; 
        if (p) deleteElement(p.id, selectedId); 
      }
    };
    const preventCopy = (e: ClipboardEvent) => e.preventDefault();
    window.addEventListener("keydown", h);
    window.addEventListener("copy", preventCopy);
    window.addEventListener("cut", preventCopy);
    return () => {
      window.removeEventListener("keydown", h);
      window.removeEventListener("copy", preventCopy);
      window.removeEventListener("cut", preventCopy);
    };
  }, [selectedId, activePage, doc, historyIdx]);

  return (
    <div className="editor-container" onContextMenu={e => e.preventDefault()} onCopy={e => e.preventDefault()}>
      {/* ═══ Confirmation Modal ═══ */}
      {showConfirmModal && (
        <div className="confirm-overlay">
          <div className="confirm-card">
            <div style={{ width: 56, height: 56, borderRadius: 12, background: "#27272a", margin: "0 auto 20px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fafafa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
            </div>
            <h2 style={{ fontFamily: "'Inter', sans-serif", fontSize: 22, fontWeight: 600, color: "#fafafa", marginBottom: 12 }}>Commit Changes?</h2>
            <p style={{ fontSize: 14, color: "#71717a", lineHeight: 1.7, marginBottom: 32 }}>
              This will save and commit your final edits to the document.<br />Your access will remain active and no notifications will be sent.
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <button className="btn btn-outline" onClick={() => setShowConfirmModal(false)} style={{ padding: "12px 28px" }}>Cancel</button>
              <button className="btn btn-finish" onClick={() => { setShowConfirmModal(false); handleSaveToLink(true); }} style={{ padding: "12px 28px" }}>Commit Changes</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Top Navbar ═══ */}
      <div className="glass-bar" style={{ height: 56, display: "flex", alignItems: "center", padding: "0 20px", flexShrink: 0, zIndex: 100, position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {onClose && (
            <button className="btn btn-ghost" onClick={onClose} style={{ padding: "6px 12px", fontSize: 13, border: "1px solid #27272a", borderRadius: 6, gap: 6 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><polyline points="12 19 5 12 12 5" /></svg>
              Back
            </button>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }} onClick={() => { setDoc(null); setInitialPdfFile(null); setView("editor"); }}>
            <div style={{ width: 28, height: 28, borderRadius: 6, background: "#18181b", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid #27272a" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fafafa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
            </div>
            <span style={{ fontFamily: "'Inter', sans-serif", fontWeight: 600, fontSize: 15, color: "#fafafa", letterSpacing: "-0.019em" }}>Data Guardian</span>
          </div>
        </div>

        {doc && view === "editor" && (
          <div style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: 8, padding: "5px 12px", background: "#18181b", borderRadius: 20, border: "1px solid #27272a", maxWidth: "260px", fontSize: 12, color: "#a1a1aa" }}>
            <span>{getFileIcon(doc.name)}</span>
            <span style={{ fontWeight: 500, color: "#fafafa", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={doc.name}>
              {doc.name}
            </span>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginLeft: "auto" }}>
          {doc && view === "editor" && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 1, padding: "2px", background: "#18181b", borderRadius: 6, border: "1px solid #27272a" }}>
                <button className="btn btn-ghost" style={{ padding: 6, borderRadius: 4, height: 28, width: 28, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setScale(s => Math.max(0.4, +(s - 0.1).toFixed(2)))} title="Zoom Out">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="5" y1="12" x2="19" y2="12" /></svg>
                </button>
                <span style={{ fontSize: 11, color: "#a1a1aa", minWidth: 38, textAlign: "center", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{Math.round(scale * 100)}%</span>
                <button className="btn btn-ghost" style={{ padding: 6, borderRadius: 4, height: 28, width: 28, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setScale(s => Math.min(2.5, +(s + 0.1).toFixed(2)))} title="Zoom In">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                </button>
              </div>

              {token && fileId && (
                <button className={`btn ${chatOpen ? "btn-primary" : "btn-outline"}`} onClick={() => setChatOpen(!chatOpen)} style={{ padding: "6px 12px", borderRadius: 6, border: chatOpen ? "none" : "1px solid #3f3f46" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                  Chat
                </button>
              )}

              {!isReadOnly && (
                <>
                  <label className="btn btn-outline" style={{ cursor: "pointer", padding: "6px 12px" }} title="Upload a file to completely replace the current document">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                    Replace
                    <input type="file" style={{ display: "none" }} onChange={handleUploadReplace} />
                  </label>
                  <button className="btn btn-finish" onClick={() => setShowConfirmModal(true)} style={{ padding: "6px 16px" }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
                    Finish Editing
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* ═══ Main Editor Content ═══ */}
      <div style={{ flex: 1, position: "relative", display: "flex", overflow: "hidden" }}>
        {loading ? (
          <div className="fup" style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#09090b", zIndex: 1000 }}>
            <svg className="spin" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#fafafa" strokeWidth="2" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
            <div style={{ marginTop: 24, fontSize: 16, fontWeight: 500, color: "#d4d4d8", letterSpacing: "-0.01em" }}>{loadingMsg}</div>
          </div>
        ) : !doc ? (
          <div className="fup" style={{ margin: "auto", maxWidth: 440, width: "100%", padding: 24 }}>
            {!isReadOnly && (
              <label className="dz" style={{ display: "block" }}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ margin: "0 auto 20px" }}><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" /><line x1="12" y1="18" x2="12" y2="12" /><line x1="9" y1="15" x2="15" y2="15" /></svg>
                <div style={{ fontSize: 18, fontWeight: 600, color: "#fafafa", marginBottom: 8, letterSpacing: "-0.01em" }}>Upload File</div>
                <div style={{ fontSize: 13, color: "#71717a", lineHeight: 1.6 }}>Supports TXT, CSV, Excel, Images & ZIP<br />PDFs will open in viewer</div>
                <input type="file" style={{ display: "none" }} onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
              </label>
            )}
          </div>
        ) : view === "editor" ? (
          <>
            {/* Editor Sidebar */}
            <div style={{ width: 260, background: "#18181b", borderRight: "1px solid #27272a", display: "flex", flexDirection: "column", flexShrink: 0 }}>
              <div style={{ padding: "20px 20px 16px", borderBottom: "1px solid #27272a" }}>
                <h3 style={{ fontSize: 11, color: "#71717a", textTransform: "uppercase", letterSpacing: ".1em", fontWeight: 600, marginBottom: 16 }}>Pages</h3>
                <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 8, margin: "0 -4px", padding: "0 4px" }}>
                  {doc.pages.map((p, i) => (
                    <div key={p.id} className={`thumb-card ${activePage === i ? "active" : ""}`} style={{ cursor: "pointer", position: "relative", flexShrink: 0 }} onClick={() => setActivePage(i)} draggable onDragStart={e => handleDragStart(e, i)} onDragOver={e => handleDragOver(e, i)} onDrop={e => handleDropPage(e, i)}>
                      <div style={{ width: 48, height: 64, background: "#09090b", border: activePage === i ? "1px solid #fff" : "1px solid #3f3f46", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#71717a", transition: "all 0.2s" }}>{i + 1}</div>
                      <div className="thumb-overlay" style={{ position: "absolute", inset: 0, background: activePage === i ? "transparent" : "rgba(24,24,27,0.4)", borderRadius: 4, transition: "all 0.2s", pointerEvents: "none" }} />
                    </div>
                  ))}
                  {!isReadOnly && (
                    <div onClick={addPage} style={{ width: 48, height: 64, background: "rgba(255,255,255,0.03)", border: "1px dashed #3f3f46", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, transition: "all 0.2s" }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#71717a" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                    </div>
                  )}
                </div>
              </div>

              {!isReadOnly && (
                <div style={{ padding: "20px", borderBottom: "1px solid #27272a" }}>
                  <h3 style={{ fontSize: 11, color: "#71717a", textTransform: "uppercase", letterSpacing: ".1em", fontWeight: 600, marginBottom: 12 }}>Insert</h3>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <button className="btn btn-outline" style={{ justifyContent: "center" }} onClick={addText}>Text</button>
                    <label className="btn btn-outline" style={{ justifyContent: "center", cursor: "pointer", margin: 0 }}>
                      Image <input type="file" accept="image/*" style={{ display: "none" }} onChange={addImage} />
                    </label>
                    <button className="btn btn-outline" style={{ justifyContent: "center", gridColumn: "1 / -1" }} onClick={addTable}>Table</button>
                  </div>
                </div>
              )}

              {/* Element Properties */}
              {selectedId && !isReadOnly && (() => {
                const sel = doc.pages[activePage]?.elements.find(e => e.id === selectedId);
                if (!sel) return null;
                return (
                  <div style={{ padding: "20px", flex: 1, overflowY: "auto" }}>
                    <h3 style={{ fontSize: 11, color: "#71717a", textTransform: "uppercase", letterSpacing: ".1em", fontWeight: 600, marginBottom: 16 }}>Properties</h3>
                    <div className="psec" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <div><div className="plabel">X</div><input type="number" className="pinput" value={Math.round(sel.x)} onChange={e => updateSelected({ x: +e.target.value })} /></div>
                      <div><div className="plabel">Y</div><input type="number" className="pinput" value={Math.round(sel.y)} onChange={e => updateSelected({ y: +e.target.value })} /></div>
                      <div><div className="plabel">W</div><input type="number" className="pinput" value={Math.round(sel.width)} onChange={e => updateSelected({ width: +e.target.value })} /></div>
                      <div><div className="plabel">H</div><input type="number" className="pinput" value={Math.round(sel.height)} onChange={e => updateSelected({ height: +e.target.value })} /></div>
                    </div>
                    {sel.type === "text" && (
                      <div className="psec">
                        <div className="plabel">Typography</div>
                        <select className="tsel" style={{ width: "100%", marginBottom: 8 }} value={(sel as any).font || "Georgia"} onChange={e => updateSelected({ font: e.target.value })}>
                          {["Georgia", "Arial", "Courier New", "Times New Roman"].map(f => <option key={f} value={f}>{f}</option>)}
                        </select>
                        <div style={{ display: "flex", gap: 8 }}>
                          <input type="number" className="pinput" style={{ width: 60 }} value={(sel as any).size || 12} onChange={e => updateSelected({ size: +e.target.value })} />
                          <input type="color" className="pinput" style={{ padding: 2, height: 34, flex: 1 }} value={(sel as any).color || "#000000"} onChange={e => updateSelected({ color: e.target.value })} />
                        </div>
                        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                          <button className="btn btn-outline" style={{ flex: 1, background: (sel as any).bold ? "#3f3f46" : "transparent" }} onClick={() => updateSelected({ bold: !(sel as any).bold })}>B</button>
                          <button className="btn btn-outline" style={{ flex: 1, background: (sel as any).italic ? "#3f3f46" : "transparent" }} onClick={() => updateSelected({ italic: !(sel as any).italic })}>I</button>
                          <button className="btn btn-outline" style={{ flex: 1, background: (sel as any).underline ? "#3f3f46" : "transparent" }} onClick={() => updateSelected({ underline: !(sel as any).underline })}>U</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Canvas Area */}
            <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", background: "#09090b", position: "relative" }} onClick={() => setSelectedId(null)}>
              <div style={{ minHeight: "100%", padding: "40px", display: "flex", flexDirection: "column", alignItems: "center" }}>
                {doc.pages[activePage] && (
                  <Page 
                    page={doc.pages[activePage]} 
                    scale={scale} 
                    selectedId={selectedId} 
                    onSelect={setSelectedId} 
                    onUpdate={updatePage} 
                    onDelete={deleteElement} 
                    showBg={showBg} 
                  />
                )}
              </div>
            </div>

            {/* Chat Drawer */}
            {chatOpen && (
              <div style={{ width: 320, background: "#18181b", borderLeft: "1px solid #27272a", display: "flex", flexDirection: "column", flexShrink: 0 }}>
                <div style={{ padding: 16, borderBottom: "1px solid #27272a", display: "flex", gap: 8 }}>
                  <button className="btn btn-ghost" style={{ flex: 1, background: chatTab === 'group' ? "#27272a" : "transparent", color: chatTab === 'group' ? "#fff" : "#a1a1aa" }} onClick={() => setChatTab('group')}>Team</button>
                  <button className="btn btn-ghost" style={{ flex: 1, background: chatTab === 'private' ? "#27272a" : "transparent", color: chatTab === 'private' ? "#fff" : "#a1a1aa" }} onClick={() => setChatTab('private')}>Private</button>
                </div>
                <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                  {messages.filter(m => chatTab === 'private' ? m.isPrivate : !m.isPrivate).map((m, i) => (
                    <div key={i} style={{ background: m.userId === "you" ? "#27272a" : "transparent", border: "1px solid #3f3f46", padding: "10px 14px", borderRadius: 8, alignSelf: m.userId === "you" ? "flex-end" : "flex-start", maxWidth: "85%" }}>
                      <div style={{ fontSize: 10, color: "#71717a", marginBottom: 4, fontWeight: 600 }}>{m.userId === "you" ? "You" : "Reviewer"}</div>
                      <div style={{ fontSize: 13, lineHeight: 1.5, color: "#d4d4d8" }}>{m.message}</div>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>
                <div style={{ padding: 16, borderTop: "1px solid #27272a" }}>
                  <textarea className="pinput" style={{ resize: "none", height: 80, marginBottom: 8, fontSize: 13 }} placeholder={`Message ${chatTab === 'private' ? "Leader directly..." : "Team..."}`} value={newMessage} onChange={e => setNewMessage(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }} />
                  <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} onClick={handleSendMessage}>Send</button>
                </div>
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
