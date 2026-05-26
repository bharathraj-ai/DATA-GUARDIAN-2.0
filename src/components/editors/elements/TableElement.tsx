import React, { useState, useRef, useEffect, useCallback } from "react";
import { TableElementData, TableCellData } from "../types";

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
  const { rows = [], colW = 100, rowH = 28, hasHeader = true } = el;
  const [activeCell, setActiveCell] = useState<{ r: number; c: number } | null>(null);
  const [editingCell, setEditingCell] = useState<{ r: number; c: number } | null>(null);
  const [editValue, setEditValue] = useState("");
  const editInputRef = useRef<HTMLTextAreaElement>(null);

  // Auto focus input when editing starts
  useEffect(() => {
    if (editingCell && editInputRef.current) {
      editInputRef.current.focus();
      const len = editInputRef.current.value.length;
      editInputRef.current.setSelectionRange(len, len);
    }
  }, [editingCell]);

  // Click outside to clear active cell if not selecting table
  useEffect(() => {
    if (!selected) {
      setActiveCell(null);
      if (editingCell) finishEditing();
    }
  }, [selected]);

  const finishEditing = () => {
    if (editingCell) {
      updateCell(editingCell.r, editingCell.c, { value: editValue });
      setEditingCell(null);
    }
  };

  const updateCell = (r: number, c: number, patch: Partial<TableCellData>) => {
    const newRows = rows.map((row, ri) =>
      ri === r
        ? row.map((cell, ci) => (ci === c ? { ...cell, ...patch } : cell))
        : row
    );
    onUpdate({ rows: newRows });
  };

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
  }, [activeCell, rows]);

  // Register actions with parent when selected
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

  const currentCell = activeCell ? rows[activeCell.r]?.[activeCell.c] : null;

  const renderCell = (cell: TableCellData, r: number, c: number) => {
    const isHeader = hasHeader && r === 0;
    const isActive = activeCell?.r === r && activeCell?.c === c;
    const isEditing = editingCell?.r === r && editingCell?.c === c;

    const bg = cell.bgColor || (isHeader ? "#18181b" : "#09090b");
    const color = cell.textColor || (isHeader ? "#fafafa" : "#d4d4d8");
    const bold = cell.bold ?? isHeader;
    const italic = cell.italic ?? false;
    const align = cell.align || "left";

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
          if (isActive && !isEditing) {
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
          border: isActive ? "2px solid #3b82f6" : "1px solid #27272a",
          background: bg,
          padding: 0,
          minWidth: colW * scale,
          height: rowH * scale,
          verticalAlign: "top",
          transition: "background 0.2s",
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
              textAlign: align,
              padding: `${2 * scale}px ${4 * scale}px`,
              fontSize: 11 * scale,
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
              textAlign: align,
              padding: `${2 * scale}px ${4 * scale}px`,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {cell.value || "\u00A0"}
          </div>
        )}
      </td>
    );
  };

  return (
    <div
      style={{
        position: "relative",
        width: el.width * scale,
        height: el.height * scale,
        border: selected ? "2px solid #fff" : "1px solid transparent",
        cursor: "pointer",
        zIndex: selected ? 100 : 1,
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      <div style={{ width: "100%", height: "100%", overflow: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 11 * scale, width: "100%", tableLayout: "fixed" }}>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => renderCell(cell, r, c))}
              </tr>
            ))}
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
