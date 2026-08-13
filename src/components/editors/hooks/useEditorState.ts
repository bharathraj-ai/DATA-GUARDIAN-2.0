import { useState, useCallback, useRef, useEffect } from "react";
import { DocumentData, EditorElement } from "../types";

export function useEditorState(initialDoc: DocumentData | null) {
  const [doc, setDoc] = useState<DocumentData | null>(initialDoc);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [historyLength, setHistoryLength] = useState(0);
  const [activePage, setActivePage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const historyRef = useRef<DocumentData[]>([]);
  const historyIdxRef = useRef(-1);
  const pendingHistoryRef = useRef<DocumentData | null>(null);
  const historyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushHistory = useCallback(() => {
    if (historyTimerRef.current) {
      clearTimeout(historyTimerRef.current);
      historyTimerRef.current = null;
    }
    const nd = pendingHistoryRef.current;
    if (!nd) return;
    pendingHistoryRef.current = null;
    const idx = historyIdxRef.current;
    const newHistory = [...historyRef.current.slice(0, idx + 1), structuredClone(nd)].slice(-50);
    historyRef.current = newHistory;
    historyIdxRef.current = newHistory.length - 1;
    setHistoryIdx(newHistory.length - 1);
    setHistoryLength(newHistory.length);
  }, []);

  useEffect(() => () => {
    if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
  }, []);

  const pushHistory = useCallback((nd: DocumentData, immediate = false) => {
    pendingHistoryRef.current = nd;
    if (immediate) {
      flushHistory();
      return;
    }
    if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
    historyTimerRef.current = setTimeout(flushHistory, 400);
  }, [flushHistory]);

  const undo = useCallback(() => {
    flushHistory();
    const idx = historyIdxRef.current;
    if (idx > 0) {
      setDoc(structuredClone(historyRef.current[idx - 1]));
      historyIdxRef.current = idx - 1;
      setHistoryIdx(idx - 1);
    }
  }, [flushHistory]);

  const redo = useCallback(() => {
    flushHistory();
    const idx = historyIdxRef.current;
    const h = historyRef.current;
    if (idx < h.length - 1) {
      setDoc(structuredClone(h[idx + 1]));
      historyIdxRef.current = idx + 1;
      setHistoryIdx(idx + 1);
    }
  }, [flushHistory]);

  const updatePage = useCallback((pageId: string, elements: EditorElement[]) => {
    setDoc(d => {
      if (!d) return d;
      const nd = { ...d, pages: d.pages.map(p => p.id === pageId ? { ...p, elements } : p) };
      pushHistory(nd);
      return nd;
    });
  }, [pushHistory]);

  const deleteElement = useCallback((pageId: string, elId: string) => {
    setDoc(d => {
      if (!d) return d;
      const nd = { ...d, pages: d.pages.map(p => ({ ...p, elements: p.elements.filter(e => e.id !== elId) })) };
      pushHistory(nd, true);
      return nd;
    });
    setSelectedId(null);
  }, [pushHistory]);

  const updateSelected = useCallback((patch: Partial<EditorElement>) => {
    setSelectedId(currentSelectedId => {
      if (!currentSelectedId) return currentSelectedId;
      setDoc(d => {
        if (!d) return d;
        const nd = { ...d, pages: d.pages.map(p => ({ ...p, elements: p.elements.map(e => e.id === currentSelectedId ? { ...e, ...patch } : e) as EditorElement[] })) };
        pushHistory(nd, true);
        return nd;
      });
      return currentSelectedId;
    });
  }, [pushHistory]);

  return {
    doc, setDoc,
    activePage, setActivePage,
    selectedId, setSelectedId,
    historyIdx, historyLength,
    undo, redo, pushHistory,
    updatePage, deleteElement, updateSelected
  };
}
