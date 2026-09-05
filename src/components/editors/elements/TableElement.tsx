import React, { useState, useRef, useEffect, useCallback } from "react";
import { TableElementData, TableCellData } from "../types";
import { isCoarsePointer } from "../utils/editorUtils";

export interface TableActions {
  addRow: () => void;
  deleteRow: () => void;
  addCol: () => void;
  deleteCol: () => void;
  toggleHeader: () => void;
  sortAsc: () => void;
  sortDesc: () => void;
  applyStyle: (key: keyof TableCellData, val: any) => void;
  hasActiveCell: boolean;
  hasHeader: boolean;
  currentCell: TableCellData | null;
  canDeleteRow: boolean;
  canDeleteCol: boolean;
  toggleFreezeCol?: () => void;
  isFrozenCol?: boolean;
}

interface TableElementProps {
  el: TableElementData;
  scale: number;
  onUpdate: (patch: Partial<TableElementData>) => void;
  selected: boolean;
  onSelect: () => void;
  onRegisterActions?: (actions: TableActions | null) => void;
}

export const TableElement = React.memo(({ el, scale, onUpdate, selected, onSelect, onRegisterActions }: TableElementProps) => {
  const { rows = [], colW = 100, colWidths = [], rowH = 28, hasHeader = true } = el;
  const [activeCell, setActiveCell] = useState<{ r: number; c: number } | null>(null);
  const [editingCell, setEditingCell] = useState<{ r: number; c: number } | null>(null);
  const [editValue, setEditValue] = useState("");
  const editInputRef = useRef<HTMLTextAreaElement>(null);

  const [resizingCol, setResizingCol] = useState<{ c: number, startX: number, startW: number } | null>(null);
  const [liveWidth, setLiveWidth] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [clientHeight, setClientHeight] = useState(400);

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
      onUpdate({ colWidths: newWidths, width: Math.max(el.width, newTableWidth) });
    }
    setResizingCol(null);
    setLiveWidth(null);
  }, [resizingCol, liveWidth, colWidths, colW, rows, onUpdate, el.width]);

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

  // Auto focus input when editing starts
  useEffect(() => {
    if (editingCell && editInputRef.current) {
      editInputRef.current.focus();
      const len = editInputRef.current.value.length;
      editInputRef.current.setSelectionRange(len, len);
    }
  }, [editingCell]);

  const updateCell = useCallback((r: number, c: number, patch: Partial<TableCellData>) => {
    const newRows = rows.map((row, ri) =>
      ri === r
        ? row.map((cell, ci) => (ci === c ? { ...cell, ...patch } : cell))
        : row
    );
    onUpdate({ rows: newRows });
  }, [rows, onUpdate]);

  const finishEditing = useCallback(() => {
    if (editingCell) {
      updateCell(editingCell.r, editingCell.c, { value: editValue });
      setEditingCell(null);
    }
  }, [editingCell, editValue, updateCell]);

  // Click outside to clear active cell if not selecting table
  useEffect(() => {
    if (!selected) {
      setActiveCell(null);
      if (editingCell) finishEditing();
    }
  }, [selected, editingCell, finishEditing]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setClientHeight(el.clientHeight || 400);
    const ro = new ResizeObserver(() => {
      if (scrollRef.current) setClientHeight(scrollRef.current.clientHeight || 400);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const addRow = () => {
    const cols = rows[0] ? rows[0].length : 3;
    const insertIdx = activeCell ? activeCell.r + 1 : rows.length;
    const newRows = [...rows];
    newRows.splice(
      insertIdx,
      0,
      Array.from({ length: cols }, () => ({ value: "" }))
    );
    onUpdate({ rows: newRows, height: el.height + rowH });
  };

  const deleteRow = () => {
    if (!activeCell || rows.length <= 1) return;
    const newRows = rows.filter((_, ri) => ri !== activeCell.r);
    setActiveCell(null);
    setEditingCell(null);
    onUpdate({ rows: newRows, height: Math.max(50, el.height - rowH) });
  };

  const addCol = () => {
    const insertIdx = activeCell ? activeCell.c + 1 : (rows[0] ? rows[0].length : 0);
    const newRows = rows.map((row) => {
      const nr = [...row];
      nr.splice(insertIdx, 0, { value: "" });
      return nr;
    });
    onUpdate({ rows: newRows, width: el.width + colW });
  };

  const deleteCol = () => {
    if (!activeCell || (rows[0] && rows[0].length <= 1)) return;
    const newRows = rows.map((row) => row.filter((_, ci) => ci !== activeCell.c));
    setActiveCell(null);
    setEditingCell(null);
    onUpdate({ rows: newRows, width: Math.max(100, el.width - colW) });
  };

  const toggleHeader = () => {
    onUpdate({ hasHeader: !hasHeader });
  };

  const sortData = (asc: boolean) => {
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

    onUpdate({ rows: [...headerRow, ...dataRows] });
  };

  const applyStyle = useCallback((key: keyof TableCellData, val: any) => {
    if (!activeCell) return;
    updateCell(activeCell.r, activeCell.c, { [key]: val });
  }, [activeCell, updateCell]);

  // Register actions with parent when selected
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!onRegisterActions) return;
    if (selected) {
      onRegisterActions({
        addRow,
        deleteRow,
        addCol,
        deleteCol,
        toggleHeader,
        sortAsc: () => sortData(true),
        sortDesc: () => sortData(false),
        applyStyle,
        hasActiveCell: !!activeCell,
        hasHeader,
        currentCell: activeCell ? rows[activeCell.r]?.[activeCell.c] ?? null : null,
        canDeleteRow: !!activeCell && rows.length > 1,
        canDeleteCol: !!activeCell && (rows[0] ? rows[0].length > 1 : false),
      });
    } else {
      onRegisterActions(null);
    }
  }, [selected, activeCell, rows, hasHeader, onRegisterActions]);


  const renderCell = (cell: TableCellData, r: number, c: number) => {
    const isHeader = hasHeader && r === 0;
    const isActive = activeCell?.r === r && activeCell?.c === c;
    const isEditing = editingCell?.r === r && editingCell?.c === c;

    const bg = cell.bgColor || (isHeader ? "#e0f2fe" : "#ffffff");
    const color = cell.textColor || (isHeader ? "#0f172a" : "#334155");
    const bold = cell.bold ?? isHeader;
    const italic = cell.italic ?? false;
    const underline = cell.underline ?? false;
    const align = cell.align || "left";

    const isResizingThis = resizingCol?.c === c;
    const currentWidth = isResizingThis && liveWidth !== null ? liveWidth : (colWidths[c] || colW);

    return (
      <td
        key={c}
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
          if (editingCell && (editingCell.r !== r || editingCell.c !== c)) {
            finishEditing();
          }
          setActiveCell({ r, c });
          if (isCoarsePointer() || (isActive && !isEditing)) {
            setEditValue(cell.value);
            setEditingCell({ r, c });
          }
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onSelect();
          setActiveCell({ r, c });
          setEditValue(cell.value);
          setEditingCell({ r, c });
        }}
        style={{
          border: isActive ? "2px solid #0284c7" : "1px solid #e2e8f0",
          background: bg,
          padding: 0,
          minWidth: currentWidth * scale,
          width: currentWidth * scale,
          minHeight: rowH * scale,
          touchAction: "manipulation",
          verticalAlign: "middle",
          transition: isResizingThis ? "none" : "background 0.2s",
          position: "relative",
        }}
      >
        {isEditing ? (
          <textarea
            ref={editInputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={() => finishEditing()}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setEditingCell(null); // Cancel
                e.preventDefault();
              } else if (e.key === "Enter" && !e.shiftKey) {
                finishEditing();
                e.preventDefault();
              }
            }}
            style={{
              width: "100%",
              height: "100%",
              minHeight: (rowH - 4) * scale,
              border: "none",
              outline: "none",
              resize: "none",
              background: "transparent",
              color: color,
              fontWeight: bold ? 600 : 400,
              fontStyle: italic ? "italic" : "normal",
              textDecoration: underline ? "underline" : "none",
              textAlign: align,
              padding: `${2 * scale}px ${4 * scale}px`,
              fontSize: Math.max(16, 11 * scale),
              fontFamily: "inherit",
              overflow: "hidden",
            }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              color: color,
              fontWeight: bold ? 600 : 400,
              fontStyle: italic ? "italic" : "normal",
              textDecoration: underline ? "underline" : "none",
              textAlign: align,
              padding: `${2 * scale}px ${4 * scale}px`,
              whiteSpace: isHeader ? "nowrap" : "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {cell.value || "\u00A0"}
          </div>
        )}
        {r === 0 && (
          <div
            onMouseDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setResizingCol({ c, startX: e.clientX, startW: currentWidth });
            }}
            style={{
              position: 'absolute',
              right: -3,
              top: 0,
              bottom: 0,
              width: 6,
              cursor: 'col-resize',
              zIndex: 10,
              backgroundColor: isResizingThis ? '#0284c7' : 'transparent',
            }}
          />
        )}
      </td>
    );
  };

  const totalTableWidth = colWidths.length > 0 
    ? colWidths.reduce((a, b) => a + b, 0)
    : (rows[0]?.length || 0) * colW;

  const scaledRowH = rowH * scale;
  const overscan = 8;
  let startIndex = Math.max(0, Math.floor(scrollTop / scaledRowH) - overscan);
  const endIndex = Math.min(rows.length - 1, Math.floor((scrollTop + clientHeight) / scaledRowH) + overscan);
  const virtualize = rows.length > 80;
  const visibleRows = virtualize
    ? rows.slice(startIndex, endIndex + 1).map((row, i) => ({ row, r: startIndex + i }))
    : rows.map((row, r) => ({ row, r }));
  const topSpacer = virtualize ? startIndex * scaledRowH : 0;
  const bottomSpacer = virtualize ? Math.max(0, rows.length - 1 - endIndex) * scaledRowH : 0;

  return (
    <div
      style={{
        position: "relative",
        width: el.width * scale,
        height: el.height * scale,
        border: selected ? "2px solid #0284c7" : "1px solid transparent",
        cursor: "pointer",
        zIndex: selected ? 100 : 1,
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      <div
        ref={scrollRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        style={{ width: "100%", height: "100%", overflow: "auto" }}
      >
        <table style={{ borderCollapse: "collapse", fontSize: 11 * scale, width: totalTableWidth * scale, tableLayout: "fixed" }}>
          <tbody>
            {virtualize && (
              <tr style={{ height: topSpacer }}>
                <td colSpan={rows[0]?.length || 1} style={{ padding: 0, border: "none" }} />
              </tr>
            )}
            {visibleRows.map(({ row, r }) => (
              <tr key={r}>
                {row.map((cell, c) => renderCell(cell, r, c))}
              </tr>
            ))}
            {virtualize && (
              <tr style={{ height: bottomSpacer }}>
                <td colSpan={rows[0]?.length || 1} style={{ padding: 0, border: "none" }} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  return prevProps.el === nextProps.el &&
         prevProps.scale === nextProps.scale &&
         prevProps.selected === nextProps.selected;
});
