"use client";
import React, { useState, useRef, useEffect, useCallback } from "react";
import "../editor.css";
import { DocumentData } from "../types";
import { getFileIcon, isCoarsePointer, uid } from "../utils/editorUtils";
import { parseFile } from "../utils/fileParsers";
import { exportDocument } from "../utils/fileExporters";
import { useEditorState } from "../hooks/useEditorState";
import { Page } from "../layout/Page";
import { TableActions } from "../elements/TableElement";
import { SpreadsheetApp } from "../elements/SpreadsheetApp";
import { secureFetch } from "@/lib/security/secure-fetch";
import { useCollaborationStore } from "@/store/useCollaborationStore";

interface UniversalEditorProps {
  token?: string;
  fileId?: string;
  initialFileProp?: File | null;
  currentUserLevel: number;
  highestAuthorityLevel: number;
  forceReadOnly?: boolean;
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
  forceReadOnly,
  onClose,
  onSave,
  onSubmit,
  forceAutoSave,
  onAutoSaveComplete
}: UniversalEditorProps) {
  const isReadOnly = forceReadOnly ?? (currentUserLevel > highestAuthorityLevel);
  const myUserId = useCollaborationStore((s) => s.myUserId);
  const [view, setView] = useState("editor");
  const { doc, setDoc, activePage, setActivePage, selectedId, setSelectedId, undo, redo, pushHistory, updatePage, deleteElement, updateSelected } = useEditorState(null);
  
  const [draggedPageIdx, setDraggedPageIdx] = useState<number | null>(null);
  const [initialPdfFile, setInitialPdfFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(Boolean(initialFileProp));
  const [loadingMsg, setLoadingMsg] = useState(initialFileProp ? `Loading ${initialFileProp.name}...` : "");
  const [scale, setScale] = useState(() => (isCoarsePointer() ? 1.35 : 1.0));
  const [showBg, setShowBg] = useState(true);
  
  const [chatOpen, setChatOpen] = useState(false);
  const [chatTab, setChatTab] = useState('group');
  const [privateTarget, setPrivateTarget] = useState<{ email: string; name: string } | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pageModalOpen, setPageModalOpen] = useState<'add' | 'rename' | null>(null);
  const [pageModalTitle, setPageModalTitle] = useState("");
  const [pageModalError, setPageModalError] = useState("");
  const [pageToRenameIdx, setPageToRenameIdx] = useState<number | null>(null);
  const docRef = useRef(doc);
  const selectedIdRef = useRef(selectedId);
  const activePageRef = useRef(activePage);
  const onSaveRef = useRef(onSave);
  const onSubmitRef = useRef(onSubmit);
  const isSavingRef = useRef(false);
  const isDirtyRef = useRef(false);
  const hydratedDocRef = useRef(false);
  const lastSavedDocRef = useRef<DocumentData | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Table tools state
  const [tableActions, setTableActions] = useState<TableActions | null>(null);
  const onRegisterTableActions = useCallback((actions: TableActions | null) => {
    setTableActions(actions);
  }, []);

  // Chat Polling (per-file DocumentChat — distinct from share-link SSE chat)
  useEffect(() => {
    if (!chatOpen || !token || !fileId) return;
    const fetchChat = async () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      try {
        const res = await secureFetch(`/api/documents/${fileId}/chat?token=${token}`);
        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            setMessages(data.messages);
          }
        }
      } catch (e) { }
    };
    fetchChat();
    const inv = setInterval(fetchChat, 10_000);
    return () => clearInterval(inv);
  }, [chatOpen, token, fileId]);

  useEffect(() => {
    if (chatOpen) chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, chatOpen]);

  useEffect(() => {
    const onOpen = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as { fileId?: string; targetUserId?: string; targetName?: string } | undefined;
      if (detail?.fileId && fileId && detail.fileId !== fileId) return;
      if (detail?.targetUserId) {
        setPrivateTarget({
          email: detail.targetUserId,
          name: detail.targetName || detail.targetUserId.split('@')[0],
        });
        setChatTab('private');
      } else {
        setChatTab('group');
      }
      setChatOpen(true);
    };
    window.addEventListener('dg:open-chat', onOpen as EventListener);
    return () => window.removeEventListener('dg:open-chat', onOpen as EventListener);
  }, [fileId]);

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !token || !fileId) return;
    const msg = newMessage;
    setNewMessage("");
    try {
      await secureFetch(`/api/documents/${fileId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          message: msg,
          isPrivate: chatTab === 'private',
          targetUser: chatTab === 'private' ? (privateTarget?.email || null) : null
        })
      });
    } catch (e) {
      console.error("Chat error", e);
    }
  };

  const handleUploadReplace = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onSave) return;

    const allowed = ['.pdf', '.txt', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.csv', '.xlsx', '.xls', '.zip', '.doc', '.docx', '.odt'];
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

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (initialFileProp) {
      handleFile(initialFileProp);
    }
  }, [initialFileProp]);

  const handleFile = async (file: File) => {
    // Always parse — read-only only blocks edits, not opening the existing document.
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

  const triggerAddPage = () => {
    if (isReadOnly) return;
    setPageModalTitle("");
    setPageModalError("");
    setPageModalOpen('add');
  };
  
  const triggerRenamePage = (idx: number) => {
    if (isReadOnly) return;
    setPageToRenameIdx(idx);
    setPageModalTitle(doc?.pages[idx]?.title || doc?.metadata?.sheetNames?.[idx] || `Page ${idx + 1}`);
    setPageModalError("");
    setPageModalOpen('rename');
  };

  const handlePageModalSubmit = () => {
    if (!doc) return;
    const title = pageModalTitle.trim();
    if (!title) {
      setPageModalError("Title is required.");
      return;
    }
    if (title.length > 100) {
      setPageModalError("Title maximum length is 100 characters.");
      return;
    }
    if (doc.pages.some((p, i) => p.title === title && (pageModalOpen === 'rename' ? i !== pageToRenameIdx : true))) {
      setPageModalError("Title must be unique.");
      return;
    }

    if (pageModalOpen === 'add') {
      const np = { id: uid(), title, order: doc.pages.length, createdAt: Date.now(), width: 794, height: 1122, elements: [], bgImage: null };
      const nd = { ...doc, pages: [...doc.pages, np] };
      setDoc(nd);
      pushHistory(nd);
      setActivePage(nd.pages.length - 1);
      handleSaveToLink(false, nd);
    } else if (pageModalOpen === 'rename' && pageToRenameIdx !== null) {
      const newPages = [...doc.pages];
      newPages[pageToRenameIdx] = { ...newPages[pageToRenameIdx], title };
      const nd = { ...doc, pages: newPages };
      setDoc(nd);
      pushHistory(nd);
      handleSaveToLink(false, nd);
    }
    setPageModalOpen(null);
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

  const handleSaveToLink = useCallback(async (isSubmit = false, overrideDoc: DocumentData | null = null, silent = false) => {
    if (isSavingRef.current) return;
    isSavingRef.current = true;
    
    const currentDoc = overrideDoc || docRef.current;
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

      const spreadsheetDraft =
        currentDoc.type === "xlsx" || currentDoc.type === "xls" || currentDoc.type === "csv";
      if (!isSubmit && !spreadsheetDraft) {
        savedFile = new File(
          [JSON.stringify(currentDoc)],
          currentDoc.name || "workspace.dg",
          { type: "application/json" }
        );
      } else {
        savedFile = await exportDocument(currentDoc);
      }

      await actionFn(savedFile);
      lastSavedDocRef.current = currentDoc;
      isDirtyRef.current = false;

      // After final commit, always return to the secure view page
      if (isSubmit && token) {
        try {
          sessionStorage.setItem('dg:internal-nav', '1');
        } catch { /* ignore */ }
        window.location.assign(`/view/${token}`);
        return;
      }

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
  }, [token]);

  useEffect(() => {
    docRef.current = doc;
    selectedIdRef.current = selectedId;
    activePageRef.current = activePage;
    if (!doc) return;
    if (!hydratedDocRef.current) {
      hydratedDocRef.current = true;
      lastSavedDocRef.current = doc;
      isDirtyRef.current = false;
      return;
    }
    isDirtyRef.current = doc !== lastSavedDocRef.current;
  }, [doc, selectedId, activePage]);

  useEffect(() => {
    onSaveRef.current = onSave;
    onSubmitRef.current = onSubmit;
  }, [onSave, onSubmit]);

  useEffect(() => {
    if (isReadOnly) return;
    const interval = setInterval(() => {
      if (docRef.current && isDirtyRef.current) {
        handleSaveToLink(false, docRef.current, true).catch(err => console.error("Autosave error:", err));
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [isReadOnly, handleSaveToLink]);

  useEffect(() => {
    const onForce = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as { fileId?: string } | undefined;
      if (detail?.fileId && fileId && detail.fileId !== fileId) return;
      if (!docRef.current || !isDirtyRef.current) return;
      handleSaveToLink(false, docRef.current, true).catch(err => console.error("Priority autosave error:", err));
    };
    window.addEventListener('dg:force-autosave', onForce as EventListener);
    return () => window.removeEventListener('dg:force-autosave', onForce as EventListener);
  }, [fileId, handleSaveToLink]);

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
      const currentSelectedId = selectedIdRef.current;
      if ((e.key === "Delete" || e.key === "Backspace") && currentSelectedId && document.activeElement?.tagName === "BODY" && !isReadOnly) { 
        const p = docRef.current?.pages[activePageRef.current]; 
        if (p) deleteElement(p.id, currentSelectedId); 
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
  }, [isReadOnly, undo, redo, deleteElement]);

  return (
    <div className="editor-container" onContextMenu={e => e.preventDefault()} onCopy={e => e.preventDefault()}>
      {/* ═══ Confirmation Modal ═══ */}
      {showConfirmModal && (
        <div className="confirm-overlay">
          <div className="confirm-card">
            <div style={{ width: 56, height: 56, borderRadius: 12, background: "#e0f2fe", margin: "0 auto 20px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0284c7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
            </div>
            <h2 style={{ fontFamily: "'Inter', sans-serif", fontSize: 22, fontWeight: 600, color: "#0f172a", marginBottom: 12 }}>Commit Changes?</h2>
            <p style={{ fontSize: 14, color: "#64748b", lineHeight: 1.7, marginBottom: 32 }}>
              This will save and commit your final edits to the document.<br />Your access will remain active and no notifications will be sent.
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <button className="btn btn-outline" onClick={() => setShowConfirmModal(false)} style={{ padding: "12px 28px" }}>Cancel</button>
              <button className="btn btn-finish" onClick={() => { setShowConfirmModal(false); handleSaveToLink(true); }} style={{ padding: "12px 28px" }}>Commit Changes</button>
            </div>
          </div>
        </div>
      )}

      {pageModalOpen && (
        <div className="confirm-overlay">
          <div className="confirm-card">
            <h2 style={{ fontFamily: "'Inter', sans-serif", fontSize: 20, fontWeight: 600, color: "#0f172a", marginBottom: 16 }}>
              {pageModalOpen === 'add' ? 'New Page' : 'Rename Page'}
            </h2>
            {pageModalError && <div style={{ color: "#ef4444", fontSize: 13, marginBottom: 12 }}>{pageModalError}</div>}
            <input 
              type="text" 
              value={pageModalTitle} 
              onChange={e => { setPageModalTitle(e.target.value); setPageModalError(""); }}
              placeholder="Page Title"
              style={{ width: "100%", padding: "10px 14px", borderRadius: 8, background: "#fff", border: "1px solid #e5e7eb", color: "#0f172a", fontSize: 14, marginBottom: 24 }}
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); handlePageModalSubmit(); }
                if (e.key === 'Escape') { e.preventDefault(); setPageModalOpen(null); }
              }}
            />
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
              <button className="btn btn-outline" onClick={() => setPageModalOpen(null)} style={{ padding: "8px 16px" }}>Cancel</button>
              <button className="btn btn-primary" onClick={handlePageModalSubmit} style={{ padding: "8px 16px" }}>
                {pageModalOpen === 'add' ? 'Create' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Top Navbar ═══ */}
      <div className="glass-bar editor-topbar">
        <div className="editor-topbar-left">
          {onClose && (
            <button className="btn btn-ghost editor-back-btn" onClick={onClose} style={{ padding: "6px 12px", fontSize: 13, border: "1px solid #e5e7eb", borderRadius: 8, gap: 6 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><polyline points="12 19 5 12 12 5" /></svg>
              <span className="editor-back-label">Back</span>
            </button>
          )}
          <div className="editor-brand" onClick={() => { setDoc(null); setInitialPdfFile(null); setView("editor"); }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: "#e0f2fe", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid #bae6fd", flexShrink: 0 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0284c7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
            </div>
            <span className="editor-brand-label">Secure Protocol</span>
          </div>
        </div>

        <div className="editor-topbar-actions">
          {doc && view === "editor" && (
            <>
              <div className="editor-zoom" style={{ display: "flex", alignItems: "center", gap: 1, padding: "2px", background: "#fff", borderRadius: 8, border: "1px solid #e5e7eb" }}>
                <button className="btn btn-ghost" style={{ padding: 6, borderRadius: 4, height: 28, width: 28, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setScale(s => Math.max(0.4, +(s - 0.1).toFixed(2)))} title="Zoom Out">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="5" y1="12" x2="19" y2="12" /></svg>
                </button>
                <span style={{ fontSize: 11, color: "#64748b", minWidth: 38, textAlign: "center", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{Math.round(scale * 100)}%</span>
                <button className="btn btn-ghost" style={{ padding: 6, borderRadius: 4, height: 28, width: 28, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setScale(s => Math.min(2.5, +(s + 0.1).toFixed(2)))} title="Zoom In">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                </button>
              </div>

              {token && fileId && (
                <button className={`btn ${chatOpen ? "btn-primary" : "btn-outline"}`} onClick={() => setChatOpen(!chatOpen)} style={{ padding: "6px 12px", borderRadius: 8, border: chatOpen ? "none" : "1px solid #e5e7eb" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                  <span className="editor-action-label">Chat</span>
                </button>
              )}

              {!isReadOnly && (
                <>
                  <label className="btn btn-outline" style={{ cursor: "pointer", padding: "6px 12px" }} title="Upload a file to completely replace the current document">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                    <span className="editor-action-label">Replace</span>
                    <input type="file" style={{ display: "none" }} onChange={handleUploadReplace} />
                  </label>
                  <button className="btn btn-finish" onClick={() => setShowConfirmModal(true)} style={{ padding: "6px 16px" }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
                    <span className="editor-finish-full">Finish Editing</span>
                    <span className="editor-finish-short">Finish</span>
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* ═══ Main Editor Content ═══ */}
      <div style={{ flex: 1, position: "relative", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {loading ? (
          <div className="fup" style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#f4f7fb", zIndex: 1000 }}>
            <svg className="spin" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#0284c7" strokeWidth="2" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
            <div style={{ marginTop: 24, fontSize: 16, fontWeight: 500, color: "#334155", letterSpacing: "-0.01em" }}>{loadingMsg}</div>
          </div>
        ) : !doc ? (
          <div className="fup" style={{ margin: "auto", maxWidth: 440, width: "100%", padding: 24 }}>
            {initialFileProp ? (
              <div style={{ textAlign: "center", color: "#64748b", fontSize: 14 }}>
                Preparing document…
              </div>
            ) : !isReadOnly && (
              <label className="dz" style={{ display: "block" }}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#0284c7" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ margin: "0 auto 20px" }}><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" /><line x1="12" y1="18" x2="12" y2="12" /><line x1="9" y1="15" x2="15" y2="15" /></svg>
                <div style={{ fontSize: 18, fontWeight: 600, color: "#0f172a", marginBottom: 8, letterSpacing: "-0.01em" }}>Upload File</div>
                <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.6 }}>Supports TXT, CSV, Excel, Images & ZIP<br />PDFs will open in viewer</div>
                <input type="file" style={{ display: "none" }} onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
              </label>
            )}
          </div>
        ) : view === "editor" ? (
          <>
            {/* ═══ Horizontal Toolbar ═══ */}
            {!isReadOnly && (
              <div className="editor-toolbar">
                {/* PAGES */}
                <div className="toolbar-section">
                  <div className="toolbar-label">Pages</div>
                  <div className="toolbar-chip-row">
                    {doc.pages.map((p, i) => (
                      <button key={p.id} className={`toolbar-page-btn ${activePage === i ? "active" : ""}`} onClick={() => setActivePage(i)} onDoubleClick={() => triggerRenamePage(i)} draggable onDragStart={e => handleDragStart(e, i)} onDragOver={e => handleDragOver(e, i)} onDrop={e => handleDropPage(e, i)} title={p.title || doc.metadata?.sheetNames?.[i] || `Page ${i + 1}`}>{p.title || doc.metadata?.sheetNames?.[i] || String(i + 1)}</button>
                    ))}
                    <button className="toolbar-page-btn add" onClick={triggerAddPage} title="Add Page">+ Add Page</button>
                  </div>
                </div>

                <div className="toolbar-sep" />

                {/* INSERT */}
                <div className="toolbar-section">
                  <div className="toolbar-label">Insert</div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button className="toolbar-btn" onClick={addText} title="Add Text">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M4 7V4h16v3" /><line x1="12" y1="4" x2="12" y2="20" /><line x1="8" y1="20" x2="16" y2="20" /></svg>
                      Text
                    </button>
                    <label className="toolbar-btn" style={{ cursor: "pointer" }} title="Add Image">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></svg>
                      Image
                      <input type="file" accept="image/*" style={{ display: "none" }} onChange={addImage} />
                    </label>
                    <button className="toolbar-btn" onClick={addTable} title="Add Table">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="15" x2="21" y2="15" /><line x1="9" y1="3" x2="9" y2="21" /><line x1="15" y1="3" x2="15" y2="21" /></svg>
                      Table
                    </button>
                  </div>
                </div>

                <div className="toolbar-sep" />

                {/* TABLE TOOLS */}
                <div className="toolbar-section">
                  <div className="toolbar-label">Table Tools</div>
                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    <button className="toolbar-btn tt-add" onClick={() => tableActions?.addRow()} disabled={!tableActions} title="Add Row Below">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                      Row +
                    </button>
                    <button className="toolbar-btn tt-remove" onClick={() => tableActions?.deleteRow()} disabled={!tableActions || !tableActions.canDeleteRow} title="Delete Row">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="8" y1="12" x2="16" y2="12" /></svg>
                      Row −
                    </button>
                    <button className="toolbar-btn tt-col-add" onClick={() => tableActions?.addCol()} disabled={!tableActions} title="Add Column Right">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                      Col +
                    </button>
                    <button className="toolbar-btn tt-remove" onClick={() => tableActions?.deleteCol()} disabled={!tableActions || !tableActions.canDeleteCol} title="Delete Column">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="8" y1="12" x2="16" y2="12" /></svg>
                      Col −
                    </button>
                    <div className="toolbar-mini-sep" />
                    <button className={`toolbar-btn ${tableActions?.isFrozenCol ? "active" : ""}`} onClick={() => tableActions?.toggleFreezeCol?.()} disabled={!tableActions} title="Freeze 1st Column">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="9" y1="3" x2="9" y2="21" /></svg>
                      Freeze
                    </button>
                    <button className={`toolbar-btn ${tableActions?.hasHeader ? "active" : ""}`} onClick={() => tableActions?.toggleHeader()} disabled={!tableActions} title="Toggle Header">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /></svg>
                      Header
                    </button>
                    <button className="toolbar-btn" onClick={() => tableActions?.sortAsc()} disabled={!tableActions || !tableActions.hasActiveCell} title="Sort Ascending">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></svg>
                      Asc
                    </button>
                    <button className="toolbar-btn" onClick={() => tableActions?.sortDesc()} disabled={!tableActions || !tableActions.hasActiveCell} title="Sort Descending">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></svg>
                      Desc
                    </button>
                  </div>
                </div>

                <div className="toolbar-sep" />

                {/* TEXT TOOLS */}
                <div className="toolbar-section">
                  <div className="toolbar-label">Text Tools</div>
                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    <button className={`toolbar-btn ${tableActions?.currentCell?.bold ? "active" : ""}`} onClick={() => tableActions?.applyStyle("bold", !tableActions?.currentCell?.bold)} disabled={!tableActions?.hasActiveCell} title="Bold" style={{ fontWeight: 700 }}>B</button>
                    <button className={`toolbar-btn ${tableActions?.currentCell?.italic ? "active" : ""}`} onClick={() => tableActions?.applyStyle("italic", !tableActions?.currentCell?.italic)} disabled={!tableActions?.hasActiveCell} title="Italic" style={{ fontStyle: "italic" }}>I</button>
                    <button className="toolbar-btn" disabled={!tableActions?.hasActiveCell} title="Underline" style={{ textDecoration: "underline" }}>U</button>
                    <div className="toolbar-mini-sep" />
                    <button className={`toolbar-btn ${!tableActions?.currentCell?.align || tableActions?.currentCell?.align === "left" ? "active" : ""}`} onClick={() => tableActions?.applyStyle("align", "left")} disabled={!tableActions?.hasActiveCell} title="Align Left">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="17" y1="10" x2="3" y2="10" /><line x1="21" y1="6" x2="3" y2="6" /><line x1="21" y1="14" x2="3" y2="14" /><line x1="17" y1="18" x2="3" y2="18" /></svg>
                    </button>
                    <button className={`toolbar-btn ${tableActions?.currentCell?.align === "center" ? "active" : ""}`} onClick={() => tableActions?.applyStyle("align", "center")} disabled={!tableActions?.hasActiveCell} title="Center">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="10" x2="6" y2="10" /><line x1="21" y1="6" x2="3" y2="6" /><line x1="21" y1="14" x2="3" y2="14" /><line x1="18" y1="18" x2="6" y2="18" /></svg>
                    </button>
                    <button className={`toolbar-btn ${tableActions?.currentCell?.align === "right" ? "active" : ""}`} onClick={() => tableActions?.applyStyle("align", "right")} disabled={!tableActions?.hasActiveCell} title="Align Right">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="21" y1="10" x2="7" y2="10" /><line x1="21" y1="6" x2="3" y2="6" /><line x1="21" y1="14" x2="3" y2="14" /><line x1="21" y1="18" x2="7" y2="18" /></svg>
                    </button>
                    <button className="toolbar-btn" onClick={() => tableActions?.applyStyle("align", "justify" as any)} disabled={!tableActions?.hasActiveCell} title="Justify">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="21" y1="10" x2="3" y2="10" /><line x1="21" y1="6" x2="3" y2="6" /><line x1="21" y1="14" x2="3" y2="14" /><line x1="21" y1="18" x2="3" y2="18" /></svg>
                    </button>
                  </div>
                </div>

                {/* PROPERTIES */}
                {selectedId && (() => {
                  const sel = doc.pages[activePage]?.elements.find(e => e.id === selectedId);
                  if (!sel) return null;
                  return (
                    <>
                      <div className="toolbar-sep" />
                      <div className="toolbar-section">
                        <div className="toolbar-label">Properties</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            <span className="toolbar-prop-label">X</span>
                            <input type="number" className="toolbar-prop-input" value={Math.round(sel.x)} onChange={e => updateSelected({ x: +e.target.value })} />
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            <span className="toolbar-prop-label">Y</span>
                            <input type="number" className="toolbar-prop-input" value={Math.round(sel.y)} onChange={e => updateSelected({ y: +e.target.value })} />
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            <span className="toolbar-prop-label">W</span>
                            <input type="number" className="toolbar-prop-input" value={Math.round(sel.width)} onChange={e => updateSelected({ width: +e.target.value })} />
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            <span className="toolbar-prop-label">H</span>
                            <input type="number" className="toolbar-prop-input" value={Math.round(sel.height)} onChange={e => updateSelected({ height: +e.target.value })} />
                          </div>
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>
            )}

            {/* ═══ Canvas Area (full width) ═══ */}
            <div className={`editor-canvas ${(doc.type === "xlsx" || doc.type === "xls" || doc.type === "csv") ? "is-sheet" : ""}`} onClick={() => setSelectedId(null)}>
              {(doc.type === "xlsx" || doc.type === "xls" || doc.type === "csv") ? (
                <SpreadsheetApp
                  doc={doc}
                  scale={scale}
                  activePage={activePage}
                  setActivePage={setActivePage}
                  updatePage={updatePage}
                  onRegisterTableActions={onRegisterTableActions}
                  onRenameTab={triggerRenamePage}
                  hideTabs={!isReadOnly}
                />
              ) : (
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
                      onRegisterTableActions={onRegisterTableActions}
                    />
                  )}
                </div>
              )}
            </div>

            {/* Chat Drawer */}
            {chatOpen && (
              <div className="editor-chat-drawer">
                <div style={{ padding: 14, background: "linear-gradient(135deg, #0284c7, #0369a1)", display: "flex", gap: 8 }}>
                  <button className="btn btn-ghost" style={{ flex: 1, background: chatTab === 'group' ? "rgba(255,255,255,0.2)" : "transparent", color: "#fff" }} onClick={() => setChatTab('group')}>Team</button>
                  <button className="btn btn-ghost" style={{ flex: 1, background: chatTab === 'private' ? "rgba(255,255,255,0.2)" : "transparent", color: "#fff" }} onClick={() => setChatTab('private')}>Private</button>
                </div>
                <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                  {messages.filter(m => !m.isSystem && (chatTab === 'private' ? m.isPrivate : !m.isPrivate)).map((m, i) => {
                    const sender = String(m.sender || m.userId || "");
                    const mine = Boolean(myUserId && sender && sender.toLowerCase() === myUserId.toLowerCase());
                    const label = mine ? "You" : (sender.split("@")[0] || "Collaborator");
                    return (
                    <div key={m.id || i} style={{ background: mine ? "#e0f2fe" : "#f8fafc", border: "1px solid #e2e8f0", padding: "10px 14px", borderRadius: 12, alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "85%" }}>
                      <div style={{ fontSize: 10, color: "#64748b", marginBottom: 4, fontWeight: 600 }}>{label}</div>
                      <div style={{ fontSize: 13, lineHeight: 1.5, color: "#0f172a", whiteSpace: "pre-wrap" }}>{m.message}</div>
                    </div>
                    );
                  })}
                  <div ref={chatEndRef} />
                </div>
                <div style={{ padding: 16, borderTop: "1px solid #e0f2fe", background: "#f8fafc" }}>
                  <textarea className="pinput" style={{ resize: "none", height: 80, marginBottom: 8, fontSize: 13 }} placeholder={`Message ${chatTab === 'private' ? (privateTarget?.name || "collaborator") + " directly..." : "Team..."}`} value={newMessage} onChange={e => setNewMessage(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }} />
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
