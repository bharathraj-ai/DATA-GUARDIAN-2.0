import { useState, useCallback } from "react";
import { DocumentData, EditorElement } from "../types";

export function useEditorState(initialDoc: DocumentData | null) {
  const [doc, setDoc] = useState<DocumentData | null>(initialDoc);
  const [history, setHistory] = useState<DocumentData[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [activePage, setActivePage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const pushHistory = useCallback((nd: DocumentData) => {
    setHistory(h => [...h.slice(0, historyIdx + 1), JSON.parse(JSON.stringify(nd))].slice(-50));
    setHistoryIdx(i => i + 1);
  }, [historyIdx]);

  const undo = () => { 
    if (historyIdx > 0) { 
      setDoc(JSON.parse(JSON.stringify(history[historyIdx - 1]))); 
      setHistoryIdx(i => i - 1); 
    } 
  };
  
  const redo = () => { 
    if (historyIdx < history.length - 1) { 
      setDoc(JSON.parse(JSON.stringify(history[historyIdx + 1]))); 
      setHistoryIdx(i => i + 1); 
    } 
  };

  const updatePage = (pageId: string, elements: EditorElement[]) => {
    setDoc(d => { 
      if (!d) return d;
      const nd = { ...d, pages: d.pages.map(p => p.id === pageId ? { ...p, elements } : p) }; 
      pushHistory(nd); 
      return nd; 
    });
  };

  const deleteElement = (pageId: string, elId: string) => {
    setDoc(d => { 
      if (!d) return d;
      const nd = { ...d, pages: d.pages.map(p => ({ ...p, elements: p.elements.filter(e => e.id !== elId) })) }; 
      pushHistory(nd); 
      return nd; 
    });
    setSelectedId(null);
  };

  const updateSelected = (patch: Partial<EditorElement>) => {
    if (!selectedId) return;
    setDoc(d => { 
      if (!d) return d;
      const nd = { ...d, pages: d.pages.map(p => ({ ...p, elements: p.elements.map(e => e.id === selectedId ? { ...e, ...patch } : e) as EditorElement[] })) }; 
      pushHistory(nd); 
      return nd; 
    });
  };

  return {
    doc, setDoc,
    activePage, setActivePage,
    selectedId, setSelectedId,
    historyIdx, historyLength: history.length,
    undo, redo, pushHistory,
    updatePage, deleteElement, updateSelected
  };
}
