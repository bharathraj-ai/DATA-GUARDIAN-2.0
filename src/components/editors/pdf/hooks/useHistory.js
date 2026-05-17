/**
 * useHistory Hook
 * 
 * React hook wrapping the history manager for undo/redo functionality.
 * Replaces the inline useState-based history from the original component.
 *
 * @module pdf/hooks/useHistory
 */

import { useState, useCallback, useRef } from "react";
import { createHistory } from "../history";

/**
 * @param {Array} initialState - Initial blocks array
 * @returns {{
 *   push: (state: Array) => void,
 *   undo: () => Array|null,
 *   redo: () => Array|null,
 *   canUndo: boolean,
 *   canRedo: boolean,
 *   historyIndex: number,
 *   historyLength: number,
 * }}
 */
export function useHistory(initialState) {
  const historyRef = useRef(null);
  const [, forceUpdate] = useState(0);

  // Lazy init — create history manager once
  if (!historyRef.current) {
    historyRef.current = createHistory();
    if (initialState && initialState.length > 0) {
      historyRef.current.push(initialState);
    }
  }

  const h = historyRef.current;

  const push = useCallback((state) => {
    h.push(state);
    forceUpdate(n => n + 1);
  }, [h]);

  const undo = useCallback(() => {
    const prev = h.undo();
    if (prev) forceUpdate(n => n + 1);
    return prev;
  }, [h]);

  const redo = useCallback(() => {
    const next = h.redo();
    if (next) forceUpdate(n => n + 1);
    return next;
  }, [h]);

  return {
    push,
    undo,
    redo,
    canUndo: h.canUndo(),
    canRedo: h.canRedo(),
    historyIndex: h.getIndex(),
    historyLength: h.getLength(),
  };
}
