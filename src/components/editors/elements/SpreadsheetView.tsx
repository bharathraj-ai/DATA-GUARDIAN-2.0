import React, { useState, useRef, useEffect, useCallback } from "react";
import { PageData, TableElementData, TableCellData, EditorElement } from "../types";
import { TableActions } from "./TableElement";

export interface SheetRuntimeState {
  activeCell: { r: number; c: number } | null;
  scrollTop: number;
  isFrozenCol: boolean;
}

interface SpreadsheetViewProps {
  page: PageData;
  scale: number;
  initialState?: SheetRuntimeState;
  onStateChange?: (pageId: string, state: SheetRuntimeState) => void;
  onUpdate: (pageId: string, elements: EditorElement[]) => void;
  onRegisterTableActions?: (actions: TableActions | null) => void;
}

export const SpreadsheetView = React.memo(({ page, scale, initialState, onStateChange, onUpdate, onRegisterTableActions }: SpreadsheetViewProps) => {
  const table = page.elements.find((e: EditorElement) => e.type === "table") as TableElementData | undefined;
  const { rows = [], colW = 100, colWidths = [], rowH = 28, hasHeader = true, id: tableId = "", height: tableHeight = 0, width: tableWidth = 0 } = table || {};

  const updateTable = useCallback((patch: Partial<TableElementData>) => {
    if (!tableId) return;
    const newElements = page.elements.map((e: EditorElement) => (e.id === tableId ? { ...e, ...patch } : e));
    onUpdate(page.id, newElements as EditorElement[]);
  }, [page, tableId, onUpdate]);

  const [activeCell, setActiveCell] = useState<{ r: number; c: number } | null>(initialState?.activeCell || null);
  const [editingCell, setEditingCell] = useState<{ r: number; c: number } | null>(null);
  const [editValue, setEditValue] = useState("");
  const editInputRef = useRef<HTMLTextAreaElement>(null);

  const [resizingCol, setResizingCol] = useState<{ c: number; startX: number; startW: number } | null>(null);
  const [liveWidth, setLiveWidth] = useState<number | null>(null);

  const [isFrozenCol, setIsFrozenCol] = useState(initialState?.isFrozenCol || false);

  // Scroll and Virtualization State
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(initialState?.scrollTop || 0);
  const [clientHeight, setClientHeight] = useState(800);

  useEffect(() => {
    return () => {
      onStateChange?.(page.id, { activeCell, isFrozenCol, scrollTop });
    };
  }, [page.id, activeCell, isFrozenCol, scrollTop, onStateChange]);

  useEffect(() => {
    if (scrollRef.current) {
      setClientHeight(scrollRef.current.clientHeight);
      if (initialState?.scrollTop) {
        scrollRef.current.scrollTop = initialState.scrollTop;
      }
    }
  }, [initialState?.scrollTop]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!resizingCol) return;
    const diff = e.clientX - resizingCol.startX;
    const newW = resizingCol.startW + diff / scale;
    setLiveWidth(Math.max(40, Math.min(newW, 800)));
  }, [resizingCol, scale]);

  const handleMouseUp = useCallback(() => {
    if (resizingCol && liveWidth !== null) {
      const newWidths = [...(colWidths.length ? colWidths : Array(rows[0]?.length || 0).fill(colW))];
      newWidths[resizingCol.c] = liveWidth;
      const newTableWidth = newWidths.reduce((a, b) => a + b, 0);
      updateTable({ colWidths: newWidths, width: newTableWidth });
    }
    setResizingCol(null);
    setLiveWidth(null);
  }, [resizingCol, liveWidth, colWidths, colW, rows, updateTable]);

  useEffect(() => {
    if (resizingCol) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [resizingCol, handleMouseMove, handleMouseUp]);

  useEffect(() => {
    if (editingCell && editInputRef.current) {
      editInputRef.current.focus();
      const len = editInputRef.current.value.length;
      editInputRef.current.setSelectionRange(len, len);
    }
  }, [editingCell]);

  const updateCell = useCallback((r: number, c: number, patch: Partial<TableCellData>) => {
    const newRows = rows.map((row: TableCellData[], ri: number) =>
      ri === r ? row.map((cell: TableCellData, ci: number) => (ci === c ? { ...cell, ...patch } : cell)) : row
    );
    updateTable({ rows: newRows });
  }, [rows, updateTable]);

  const finishEditing = useCallback(() => {
    if (editingCell) {
      updateCell(editingCell.r, editingCell.c, { value: editValue });
      setEditingCell(null);
    }
  }, [editingCell, editValue, updateCell]);

  const addRow = useCallback(() => {
    const cols = rows[0] ? rows[0].length : 3;
    const insertIdx = activeCell ? activeCell.r + 1 : rows.length;
    const newRows = [...rows];
    newRows.splice(insertIdx, 0, Array.from({ length: cols }, () => ({ value: "" })));
    updateTable({ rows: newRows, height: tableHeight + rowH });
  }, [rows, activeCell, updateTable, tableHeight, rowH]);

  const deleteRow = useCallback(() => {
    if (!activeCell || rows.length <= 1) return;
    const newRows = rows.filter((_: TableCellData[], ri: number) => ri !== activeCell.r);
    setActiveCell(null);
    setEditingCell(null);
    updateTable({ rows: newRows, height: Math.max(50, tableHeight - rowH) });
  }, [rows, activeCell, updateTable, tableHeight, rowH]);

  const addCol = useCallback(() => {
    const insertIdx = activeCell ? activeCell.c + 1 : rows[0] ? rows[0].length : 0;
    const newRows = rows.map((row: TableCellData[]) => {
      const nr = [...row];
      nr.splice(insertIdx, 0, { value: "" });
      return nr;
    });
    updateTable({ rows: newRows, width: tableWidth + colW });
  }, [rows, activeCell, updateTable, tableWidth, colW]);

  const deleteCol = useCallback(() => {
    if (!activeCell || (rows[0] && rows[0].length <= 1)) return;
    const newRows = rows.map((row: TableCellData[]) => row.filter((_: TableCellData, ci: number) => ci !== activeCell.c));
    setActiveCell(null);
    setEditingCell(null);
    updateTable({ rows: newRows, width: Math.max(100, tableWidth - colW) });
  }, [rows, activeCell, updateTable, tableWidth, colW]);

  const toggleHeader = useCallback(() => {
    updateTable({ hasHeader: !hasHeader });
  }, [hasHeader, updateTable]);

  const toggleFreezeCol = useCallback(() => {
    setIsFrozenCol(!isFrozenCol);
  }, [isFrozenCol]);

  const sortData = useCallback((asc: boolean) => {
    if (!activeCell || rows.length < 2) return;
    const c = activeCell.c;
    const startIdx = hasHeader ? 1 : 0;
    const headerRow = hasHeader ? [rows[0]] : [];
    const dataRows = [...rows.slice(startIdx)];

    dataRows.sort((a, b) => {
      const va = (a[c]?.value || "").trim();
      const vb = (b[c]?.value || "").trim();
      const na = parseFloat(va);
      const nb = parseFloat(vb);
      let res = 0;
      if (!isNaN(na) && !isNaN(nb)) {
        res = na - nb;
      } else {
        res = va.localeCompare(vb);
      }
      return asc ? res : -res;
    });

    updateTable({ rows: [...headerRow, ...dataRows] });
  }, [activeCell, rows, hasHeader, updateTable]);

  const applyStyle = useCallback((key: keyof TableCellData, val: any) => {
    if (!activeCell) return;
    updateCell(activeCell.r, activeCell.c, { [key]: val });
  }, [activeCell, updateCell]);

  useEffect(() => {
    if (!onRegisterTableActions) return;
    onRegisterTableActions({
      addRow, deleteRow, addCol, deleteCol, toggleHeader,
      sortAsc: () => sortData(true), sortDesc: () => sortData(false),
      applyStyle, hasActiveCell: !!activeCell, hasHeader,
      currentCell: activeCell ? rows[activeCell.r]?.[activeCell.c] ?? null : null,
      canDeleteRow: !!activeCell && rows.length > 1,
      canDeleteCol: !!activeCell && (rows[0] ? rows[0].length > 1 : false),
      toggleFreezeCol, isFrozenCol,
    });
  }, [activeCell, rows, hasHeader, onRegisterTableActions, isFrozenCol, addRow, deleteRow, addCol, deleteCol, toggleHeader, sortData, applyStyle, toggleFreezeCol]);

  // VIRTUALIZATION LOGIC
  const scaledRowH = rowH * scale;
  const totalRows = rows.length;
  // Over-scan buffer
  const overscan = 10;
  
  let startIndex = Math.floor(scrollTop / scaledRowH) - overscan;
  if (startIndex < 0) startIndex = 0;
  // If we have header, row 0 is sticky, so don't render it in the body twice.
  if (hasHeader && startIndex === 0) startIndex = 1;

  const endIndex = Math.min(totalRows - 1, Math.floor((scrollTop + clientHeight) / scaledRowH) + overscan);

  const visibleRows = [];
  for (let i = startIndex; i <= endIndex; i++) {
    if (i < totalRows) visibleRows.push({ row: rows[i], r: i });
  }

  const renderCell = (cell: TableCellData, r: number, c: number) => {
    const isHeader = hasHeader && r === 0;
    const isActive = activeCell?.r === r && activeCell?.c === c;
    const isEditing = editingCell?.r === r && editingCell?.c === c;

    const bg = cell.bgColor || (isHeader ? "#f3f4f6" : "#ffffff");
    const color = cell.textColor || (isHeader ? "#111827" : "#000000");
    const bold = cell.bold ?? isHeader;
    const italic = cell.italic ?? false;
    const align = cell.align || "left";

    const isResizingThis = resizingCol?.c === c;
    const currentWidth = isResizingThis && liveWidth !== null ? liveWidth : (colWidths[c] || colW);
    const cellIsFrozen = isFrozenCol && c === 0;

    return (
      <td
        key={c}
        onClick={(e) => {
          e.stopPropagation();
          if (editingCell && (editingCell.r !== r || editingCell.c !== c)) finishEditing();
          setActiveCell({ r, c });
          if (isActive && !isEditing) {
            setEditValue(cell.value);
            setEditingCell({ r, c });
          }
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          setActiveCell({ r, c });
          setEditValue(cell.value);
          setEditingCell({ r, c });
        }}
        style={{
          border: isActive ? "2px solid #3b82f6" : "1px solid #e5e7eb",
          background: isActive && !isEditing ? "#f8fafc" : bg, 
          padding: 0,
          minWidth: currentWidth * scale,
          width: currentWidth * scale,
          minHeight: scaledRowH,
          verticalAlign: "middle",
          transition: isResizingThis ? "none" : "background 0.2s",
          position: cellIsFrozen ? "sticky" : "relative",
          left: cellIsFrozen ? 0 : undefined,
          zIndex: isHeader && cellIsFrozen ? 30 : isHeader ? 20 : cellIsFrozen ? 10 : 1,
        }}
      >
        {isEditing ? (
          <textarea
            ref={editInputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={() => finishEditing()}
            onKeyDown={(e) => {
              if (e.key === "Escape") { setEditingCell(null); e.preventDefault(); }
              else if (e.key === "Enter" && !e.shiftKey) { finishEditing(); e.preventDefault(); }
            }}
            style={{
              width: "100%", height: "100%", minHeight: (rowH - 4) * scale,
              border: "none", outline: "none", resize: "none",
              background: "transparent", color, fontWeight: bold ? 600 : 400,
              fontStyle: italic ? "italic" : "normal", textAlign: align,
              padding: `${2 * scale}px ${4 * scale}px`, fontSize: 11 * scale,
              fontFamily: "inherit", overflow: "hidden",
            }}
          />
        ) : (
          <div
            style={{
              width: "100%", height: "100%", color,
              fontWeight: bold ? 600 : 400, fontStyle: italic ? "italic" : "normal",
              textAlign: align, padding: `${2 * scale}px ${4 * scale}px`,
              whiteSpace: isHeader ? "nowrap" : "pre-wrap", wordBreak: "break-word",
            }}
          >
            {cell.value || "\u00A0"}
          </div>
        )}
        {r === 0 && (
          <div
            onMouseDown={(e) => {
              e.stopPropagation(); e.preventDefault();
              setResizingCol({ c, startX: e.clientX, startW: currentWidth });
            }}
            style={{
              position: 'absolute', right: -3, top: 0, bottom: 0, width: 6,
              cursor: 'col-resize', zIndex: 40,
              backgroundColor: isResizingThis ? '#3b82f6' : 'transparent',
            }}
          />
        )}
      </td>
    );
  };

  if (!table) return null;

  const totalTableWidth = colWidths.length > 0 ? colWidths.reduce((a: number, b: number) => a + b, 0) : (rows[0]?.length || 0) * colW;
  const topSpacer = hasHeader ? Math.max(0, startIndex - 1) * scaledRowH : startIndex * scaledRowH;
  const bottomSpacer = Math.max(0, totalRows - 1 - endIndex) * scaledRowH;

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      onClick={() => setActiveCell(null)}
      style={{ width: "100%", height: "100%", overflow: "auto", position: "relative", background: "#ffffff" }}
    >
      <table style={{ borderCollapse: "collapse", fontSize: 11 * scale, width: totalTableWidth * scale, tableLayout: "fixed" }}>
        {hasHeader && rows[0] && (
          <thead style={{ position: "sticky", top: 0, zIndex: 20 }}>
            <tr>{rows[0].map((cell: TableCellData, c: number) => renderCell(cell, 0, c))}</tr>
          </thead>
        )}
        <tbody>
          <tr style={{ height: topSpacer }}>
            <td colSpan={rows[0]?.length || 1} style={{ padding: 0, border: "none" }}></td>
          </tr>
          {visibleRows.map(({ row, r }) => (
            <tr key={r}>{row.map((cell: TableCellData, c: number) => renderCell(cell, r, c))}</tr>
          ))}
          <tr style={{ height: bottomSpacer }}>
            <td colSpan={rows[0]?.length || 1} style={{ padding: 0, border: "none" }}></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
});

SpreadsheetView.displayName = "SpreadsheetView";
