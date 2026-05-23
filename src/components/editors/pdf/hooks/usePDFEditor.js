/**
 * usePDFEditor Hook
 * 
 * Core state machine for the PDF editor. Manages:
 *  - Phase transitions (upload → processing → editing → submitting → done)
 *  - Block CRUD operations  
 *  - File processing pipeline
 *  - Export + submission flow (no autosave)
 *  - Blob URL lifecycle management
 *
 * @module pdf/hooks/usePDFEditor
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { parsePDF, revokeBlobUrls } from "../parser";
import { inferStructure, countBlockTypes, uid } from "../inferStructure";
import { buildPdfExport } from "../exporter";
import { useHistory } from "./useHistory";

/**
 * Editor phases:
 *  - upload: File selection screen
 *  - processing: Parsing/exporting in progress
 *  - editing: Main editor active
 *  - submitting: Confirmation modal visible
 *  - pending_approval: Waiting for owner decision
 *  - done: Export/submission complete
 */

/**
 * @param {Object} options
 * @param {File|null} options.initialFile
 * @param {(file: File) => Promise<void>} options.onSave
 * @param {boolean} options.forceAutoSave
 * @param {() => void} options.onAutoSaveComplete
 */
export function usePDFEditor({ initialFile, onSave, forceAutoSave, onAutoSaveComplete }) {
  const [phase, setPhase] = useState(initialFile ? "processing" : "upload");
  const [progress, setProgress] = useState(initialFile ? 5 : 0);
  const [progressLabel, setProgressLabel] = useState(initialFile ? "Loading PDF engine…" : "");
  const [file, setFile] = useState(initialFile || null);
  const [parsed, setParsed] = useState(null);
  const [blocks, setBlocks] = useState([]);
  const [selectedBlock, setSelectedBlock] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [previewPage, setPreviewPage] = useState(0);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [editingLocked, setEditingLocked] = useState(false);
  const [submissionStatus, setSubmissionStatus] = useState(null); // null | 'pending_owner_approval' | 'completed' | 'rejected'

  // Blob URL tracking for cleanup
  const blobUrlsRef = useRef([]);

  // History hook (replaces inline history state)
  const history = useHistory([]);

  // File input refs
  const fileRef = useRef(null);
  const replaceFileRef = useRef(null);

  // Stats (derived from blocks)
  const stats = countBlockTypes(blocks);

  /* ─── Cleanup Blob URLs on unmount ────────────────────────────────── */
  useEffect(() => {
    return () => {
      revokeBlobUrls(blobUrlsRef.current);
    };
  }, []);

  /* ─── Internal file handler ───────────────────────────────────────── */
  const handleFileInternal = useCallback(async (f) => {
    if (!f || !f.name.toLowerCase().endsWith(".pdf")) {
      alert("Please upload a PDF file.");
      return;
    }

    // Revoke old blob URLs before loading new file
    revokeBlobUrls(blobUrlsRef.current);
    blobUrlsRef.current = [];

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

      // Track Blob URLs for cleanup
      if (parsedData.blobUrls) {
        blobUrlsRef.current = parsedData.blobUrls;
      }

      setParsed(parsedData);
      setProgress(50);
      setProgressLabel("Analysing document structure…");
      await new Promise(r => setTimeout(r, 300));

      const inferredBlocks = inferStructure(parsedData);
      setBlocks(inferredBlocks);
      history.push(inferredBlocks);

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
  }, [history]);

  /* ─── Auto-process initialFile on mount ───────────────────────────── */
  useEffect(() => {
    if (initialFile) {
      // Defer execution slightly to avoid synchronous setState inside mount effect
      const t = setTimeout(() => {
        handleFileInternal(initialFile);
      }, 0);
      return () => clearTimeout(t);
    }
  }, [initialFile, handleFileInternal]);

  /* ─── Block CRUD operations ───────────────────────────────────────── */
  const updateBlock = useCallback((i, patch) => {
    if (editingLocked) return;
    setBlocks(b => {
      const nb = b.map((x, idx) => idx === i ? { ...x, ...patch } : x);
      history.push(nb);
      return nb;
    });
  }, [editingLocked, history]);

  const deleteBlock = useCallback((i) => {
    if (editingLocked) return;
    setBlocks(b => {
      const nb = b.filter((_, idx) => idx !== i);
      history.push(nb);
      return nb;
    });
  }, [editingLocked, history]);

  const addBlock = useCallback((type) => {
    if (editingLocked) return;
    const nb = { id: uid(), type, text: type === "pagebreak" ? "" : "New " + type };
    setBlocks(b => {
      const nbs = [...b, nb];
      history.push(nbs);
      return nbs;
    });
  }, [editingLocked, history]);

  const moveBlock = useCallback((i, dir) => {
    if (editingLocked) return;
    setBlocks(b => {
      const nb = [...b];
      const j = i + dir;
      if (j < 0 || j >= nb.length) return nb;
      [nb[i], nb[j]] = [nb[j], nb[i]];
      history.push(nb);
      return nb;
    });
  }, [editingLocked, history]);

  /* ─── Undo / Redo ─────────────────────────────────────────────────── */
  const undo = useCallback(() => {
    if (editingLocked) return;
    const prev = history.undo();
    if (prev) setBlocks(prev);
  }, [editingLocked, history]);

  const redo = useCallback(() => {
    if (editingLocked) return;
    const next = history.redo();
    if (next) setBlocks(next);
  }, [editingLocked, history]);

  /* ─── Upload Replace (different file) ─────────────────────────────── */
  const handleUploadReplace = useCallback(async (e) => {
    const uploadedFile = e.target.files?.[0];
    if (!uploadedFile || !onSave) return;

    const allowed = ['.pdf', '.txt', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.csv', '.xlsx', '.xls', '.zip'];
    const ex = uploadedFile.name.substring(uploadedFile.name.lastIndexOf('.')).toLowerCase();

    if (!allowed.includes(ex)) {
      alert("Unsupported file format for Replace.");
      return;
    }

    setPhase("processing");
    setProgress(50);
    setProgressLabel("Uploading and Replacing File...");
    try {
      await onSave(uploadedFile);
    } catch (err) {
      alert("Error replacing file: " + err.message);
      setPhase("editing");
    }
  }, [onSave]);

  /* ─── Finish Editing → Confirmation Modal ─────────────────────────── */
  const initiateFinishEditing = useCallback(() => {
    setShowConfirmModal(true);
  }, []);

  const cancelSubmission = useCallback(() => {
    setShowConfirmModal(false);
  }, []);

  /* ─── Submit Final Document ───────────────────────────────────────── */
  const submitFinalDocument = useCallback(async () => {
    if (!onSave) return;
    setShowConfirmModal(false);
    setPhase("processing");
    setProgress(60);
    setProgressLabel("Building Final PDF…");

    try {
      const resultFile = await buildPdfExport(blocks, file, (p, label) => {
        setProgress(p);
        if (label) setProgressLabel(label);
      });

      setProgressLabel("Uploading final version…");
      setProgress(95);
      await onSave(resultFile);
      setProgress(100);

      // Lock editing and set status
      setEditingLocked(true);
      setSubmissionStatus('pending_owner_approval');
      setPhase("done");

      if (forceAutoSave && onAutoSaveComplete) {
        onAutoSaveComplete();
      }
    } catch (e) {
      console.error("PDF Export Error:", e);
      alert(`PDF Export Error: ${e.message}\n\nThis is usually caused by unsupported characters in the text.`);
      setPhase("editing");
    }
  }, [blocks, file, onSave, forceAutoSave, onAutoSaveComplete]);

  /* ─── Legacy: forceAutoSave support ───────────────────────────────── */
  useEffect(() => {
    if (forceAutoSave && phase === "editing") {
      // Defer execution slightly to avoid synchronous setState inside effect
      const t = setTimeout(() => {
        submitFinalDocument();
      }, 0);
      return () => clearTimeout(t);
    }
  }, [forceAutoSave, phase, submitFinalDocument]);

  /* ─── Keyboard shortcuts ──────────────────────────────────────────── */
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
  }, [undo, redo]);

  /* ─── Owner Approval Actions ──────────────────────────────────────── */
  const handleOwnerApproval = useCallback(() => {
    setSubmissionStatus('completed');
    setEditingLocked(true);
  }, []);

  const handleOwnerRejection = useCallback(() => {
    setSubmissionStatus(null);
    setEditingLocked(false);
    setPhase("editing");
  }, []);

  return {
    // State
    phase, setPhase,
    progress,
    progressLabel,
    file,
    parsed,
    blocks,
    selectedBlock, setSelectedBlock,
    dragOver, setDragOver,
    stats,
    previewPage, setPreviewPage,
    showConfirmModal,
    editingLocked,
    submissionStatus,
    history,

    // Refs
    fileRef,
    replaceFileRef,

    // Actions
    handleFile: handleFileInternal,
    updateBlock,
    deleteBlock,
    addBlock,
    moveBlock,
    undo,
    redo,
    handleUploadReplace,
    initiateFinishEditing,
    cancelSubmission,
    submitFinalDocument,
    handleOwnerApproval,
    handleOwnerRejection,
  };
}
