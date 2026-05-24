import React, { useState, useRef, useEffect } from "react";
import { TableElementData, TableCellData } from "../types";

interface TableElementProps {
  el: TableElementData;
  scale: number;
  onUpdate: (patch: Partial<TableElementData>) => void;
  selected: boolean;
  onSelect: () => void;
}

export const TableElement = React.memo(({ el, scale, onUpdate, selected, onSelect }: TableElementProps) => {
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

  const applyStyle = (key: keyof TableCellData, val: any) => {
    if (!activeCell) return;
    updateCell(activeCell.r, activeCell.c, { [key]: val });
  };

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

  const currentCell = activeCell ? rows[activeCell.r]?.[activeCell.c] : null;

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
      {selected && (
        <div
          data-nondrag="1"
          style={{
            position: "absolute",
            top: -48,
            left: 0,
            display: "flex",
            gap: 6,
            background: "#18181b",
            padding: "6px",
            borderRadius: 8,
            border: "1px solid #3f3f46",
            boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
            zIndex: 1001,
            alignItems: "center",
            width: "max-content",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button className="btn btn-ghost" style={{ padding: "4px 8px", fontSize: 11 }} onClick={addRow} title="Add Row Below">Row +</button>
          <button className="btn btn-danger" style={{ padding: "4px 8px", fontSize: 11 }} onClick={deleteRow} disabled={!activeCell || rows.length <= 1} title="Delete Row">Row -</button>
          <div className="sep" style={{ height: 16 }} />
          <button className="btn btn-ghost" style={{ padding: "4px 8px", fontSize: 11 }} onClick={addCol} title="Add Column Right">Col +</button>
          <button className="btn btn-danger" style={{ padding: "4px 8px", fontSize: 11 }} onClick={deleteCol} disabled={!activeCell || (rows[0] && rows[0].length <= 1)} title="Delete Column">Col -</button>
          <div className="sep" style={{ height: 16 }} />
          <button className="btn btn-ghost" style={{ padding: "4px 8px", fontSize: 11, background: hasHeader ? "#27272a" : "transparent" }} onClick={toggleHeader} title="Toggle Header">Header</button>
          <button className="btn btn-ghost" style={{ padding: "4px 8px", fontSize: 11 }} onClick={() => sortData(true)} disabled={!activeCell} title="Sort Ascending">Asc</button>
          <button className="btn btn-ghost" style={{ padding: "4px 8px", fontSize: 11 }} onClick={() => sortData(false)} disabled={!activeCell} title="Sort Descending">Desc</button>
          <div className="sep" style={{ height: 16 }} />
          
          <button className="btn btn-ghost" style={{ padding: "4px 8px", fontSize: 11, fontWeight: "bold", background: currentCell?.bold ? "#3f3f46" : "transparent" }} onClick={() => applyStyle("bold", !currentCell?.bold)} disabled={!activeCell} title="Bold">B</button>
          <button className="btn btn-ghost" style={{ padding: "4px 8px", fontSize: 11, fontStyle: "italic", background: currentCell?.italic ? "#3f3f46" : "transparent" }} onClick={() => applyStyle("italic", !currentCell?.italic)} disabled={!activeCell} title="Italic">I</button>
          
          <div className="sep" style={{ height: 16 }} />
          <input type="color" title="Background Color" style={{ width: 24, height: 24, border: "none", cursor: "pointer", background: "transparent" }} value={currentCell?.bgColor || "#09090b"} onChange={(e) => applyStyle("bgColor", e.target.value)} disabled={!activeCell} />
          <input type="color" title="Text Color" style={{ width: 24, height: 24, border: "none", cursor: "pointer", background: "transparent" }} value={currentCell?.textColor || "#fafafa"} onChange={(e) => applyStyle("textColor", e.target.value)} disabled={!activeCell} />
        </div>
      )}
      
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
