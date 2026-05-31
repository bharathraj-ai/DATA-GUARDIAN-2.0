import { useState, useCallback, useRef } from "react";
import { DocumentData, EditorElement } from "../types";

export function useEditorState(initialDoc: DocumentData | null) {
  const [doc, setDoc] = useState<DocumentData | null>(initialDoc);
  const [history, setHistory] = useState<DocumentData[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [activePage, setActivePage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Use refs to avoid stale closures in callbacks
  const historyRef = useRef(history);
  const historyIdxRef = useRef(historyIdx);
  historyRef.current = history;
  historyIdxRef.current = historyIdx;

  const pushHistory = useCallback((nd: DocumentData) => {
    const idx = historyIdxRef.current;
    const newHistory = [...historyRef.current.slice(0, idx + 1), structuredClone(nd)].slice(-50);
    setHistory(newHistory);
    setHistoryIdx(newHistory.length - 1);
  }, []);

  const undo = useCallback(() => {
    const idx = historyIdxRef.current;
    if (idx > 0) {
      setDoc(structuredClone(historyRef.current[idx - 1]));
      setHistoryIdx(idx - 1);
    }
  }, []);

  const redo = useCallback(() => {
    const idx = historyIdxRef.current;
    const h = historyRef.current;
    if (idx < h.length - 1) {
      setDoc(structuredClone(h[idx + 1]));
      setHistoryIdx(idx + 1);
    }
  }, []);

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
      pushHistory(nd);
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
        pushHistory(nd);
        return nd;
      });
      return currentSelectedId;
    });
  }, [pushHistory]);

  return {
    doc, setDoc,
    activePage, setActivePage,
    selectedId, setSelectedId,
    historyIdx, historyLength: history.length,
    undo, redo, pushHistory,
    updatePage, deleteElement, updateSelected
  };
}
