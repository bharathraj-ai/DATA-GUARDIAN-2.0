"use client";
import React from "react";
import { TableActions } from "./TableElement";
import { EditorElement } from "../types";

interface TopEditorToolbarProps {
  /* Page management */
  pages: { id: string }[];
  activePage: number;
  onSetActivePage: (i: number) => void;
  onAddPage: () => void;
  onDragStart: (e: React.DragEvent, i: number) => void;
  onDragOver: (e: React.DragEvent, i: number) => void;
  onDropPage: (e: React.DragEvent, i: number) => void;
  /* Insert */
  onAddText: () => void;
  onAddImage: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onAddTable: () => void;
  /* Table */
  tableActions: TableActions | null;
  /* Properties */
  selectedElement: EditorElement | null;
  onUpdateSelected: (patch: Partial<EditorElement>) => void;
}

/* ── Compact SVG icon wrapper ── */
const I = ({ children, s = 13 }: { children: React.ReactNode; s?: number }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);

export const TopEditorToolbar: React.FC<TopEditorToolbarProps> = ({
  pages, activePage, onSetActivePage, onAddPage,
  onDragStart, onDragOver, onDropPage,
  onAddText, onAddImage, onAddTable,
  tableActions: ta,
  selectedElement: sel, onUpdateSelected,
}) => {
  const cell = ta?.currentCell ?? null;
  const hasCell = ta?.hasActiveCell ?? false;

  return (
    <div className="edt-toolbar">
      {/* ═══ PAGES ═══ */}
      <div className="edt-group">
        <span className="edt-label">Pages</span>
        <div className="edt-row">
          {pages.map((p, i) => (
            <button
              key={p.id}
              className={`edt-page ${activePage === i ? "on" : ""}`}
              onClick={() => onSetActivePage(i)}
              draggable
              onDragStart={e => onDragStart(e, i)}
              onDragOver={e => onDragOver(e, i)}
              onDrop={e => onDropPage(e, i)}
              title={`Page ${i + 1}`}
            >
              {i + 1}
            </button>
          ))}
          <button className="edt-page edt-add" onClick={onAddPage} title="Add Page">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Add Page
          </button>
        </div>
      </div>

      <div className="edt-div" />

      {/* ═══ INSERT ═══ */}
      <div className="edt-group">
        <span className="edt-label">Insert</span>
        <div className="edt-row">
          <button className="edt-btn" onClick={onAddText} title="Insert Text Block">
            <I><path d="M4 7V4h16v3" /><line x1="12" y1="4" x2="12" y2="20" /><line x1="8" y1="20" x2="16" y2="20" /></I>
            Text
          </button>
          <label className="edt-btn" style={{ cursor: "pointer" }} title="Insert Image">
            <I><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></I>
            Image
            <input type="file" accept="image/*" hidden onChange={onAddImage} />
          </label>
          <button className="edt-btn" onClick={onAddTable} title="Insert Table">
            <I><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="15" x2="21" y2="15" /><line x1="9" y1="3" x2="9" y2="21" /><line x1="15" y1="3" x2="15" y2="21" /></I>
            Table
          </button>
        </div>
      </div>

      <div className="edt-div" />

      {/* ═══ TABLE TOOLS ═══ */}
      <div className="edt-group">
        <span className="edt-label">Table Tools</span>
        <div className="edt-row">
          <button className="edt-btn v-green" onClick={() => ta?.addRow()} disabled={!ta} title="Add Row Below">
            <I s={11}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></I> Row +
          </button>
          <button className="edt-btn v-red" onClick={() => ta?.deleteRow()} disabled={!ta || !ta.canDeleteRow} title="Delete Selected Row">
            <I s={11}><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="8" y1="12" x2="16" y2="12" /></I> Row −
          </button>
          <button className="edt-btn v-amber" onClick={() => ta?.addCol()} disabled={!ta} title="Add Column Right">
            <I s={11}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></I> Col +
          </button>
          <button className="edt-btn v-red" onClick={() => ta?.deleteCol()} disabled={!ta || !ta.canDeleteCol} title="Delete Selected Column">
            <I s={11}><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="8" y1="12" x2="16" y2="12" /></I> Col −
          </button>
          <div className="edt-mini-div" />
          <button className={`edt-btn ${ta?.hasHeader ? "on" : ""}`} onClick={() => ta?.toggleHeader()} disabled={!ta} title="Toggle Header Row">
            <I s={11}><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /></I> Header
          </button>
          <button className="edt-btn" onClick={() => ta?.sortAsc()} disabled={!ta || !hasCell} title="Sort Ascending">
            <I s={11}><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></I> Asc
          </button>
          <button className="edt-btn" onClick={() => ta?.sortDesc()} disabled={!ta || !hasCell} title="Sort Descending">
            <I s={11}><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></I> Desc
          </button>
        </div>
      </div>

      <div className="edt-div" />

      {/* ═══ TEXT TOOLS ═══ */}
      <div className="edt-group">
        <span className="edt-label">Text Tools</span>
        <div className="edt-row">
          <button className={`edt-btn ${cell?.bold ? "on" : ""}`} onClick={() => ta?.applyStyle("bold", !cell?.bold)} disabled={!hasCell} title="Bold" style={{ fontWeight: 700 }}>B</button>
          <button className={`edt-btn ${cell?.italic ? "on" : ""}`} onClick={() => ta?.applyStyle("italic", !cell?.italic)} disabled={!hasCell} title="Italic" style={{ fontStyle: "italic" }}>I</button>
          <button className="edt-btn" disabled={!hasCell} title="Underline" style={{ textDecoration: "underline" }}>U</button>
          <div className="edt-mini-div" />
          <button className={`edt-btn ${!cell?.align || cell.align === "left" ? "on" : ""}`} onClick={() => ta?.applyStyle("align", "left")} disabled={!hasCell} title="Align Left">
            <I s={12}><line x1="17" y1="10" x2="3" y2="10" /><line x1="21" y1="6" x2="3" y2="6" /><line x1="21" y1="14" x2="3" y2="14" /><line x1="17" y1="18" x2="3" y2="18" /></I>
          </button>
          <button className={`edt-btn ${cell?.align === "center" ? "on" : ""}`} onClick={() => ta?.applyStyle("align", "center")} disabled={!hasCell} title="Center">
            <I s={12}><line x1="18" y1="10" x2="6" y2="10" /><line x1="21" y1="6" x2="3" y2="6" /><line x1="21" y1="14" x2="3" y2="14" /><line x1="18" y1="18" x2="6" y2="18" /></I>
          </button>
          <button className={`edt-btn ${cell?.align === "right" ? "on" : ""}`} onClick={() => ta?.applyStyle("align", "right")} disabled={!hasCell} title="Align Right">
            <I s={12}><line x1="21" y1="10" x2="7" y2="10" /><line x1="21" y1="6" x2="3" y2="6" /><line x1="21" y1="14" x2="3" y2="14" /><line x1="21" y1="18" x2="7" y2="18" /></I>
          </button>
          <button className={`edt-btn ${cell?.align === ("justify" as any) ? "on" : ""}`} onClick={() => ta?.applyStyle("align", "justify" as any)} disabled={!hasCell} title="Justify">
            <I s={12}><line x1="21" y1="10" x2="3" y2="10" /><line x1="21" y1="6" x2="3" y2="6" /><line x1="21" y1="14" x2="3" y2="14" /><line x1="21" y1="18" x2="3" y2="18" /></I>
          </button>
        </div>
      </div>

      {/* ═══ PROPERTIES ═══ */}
      {sel && (
        <>
          <div className="edt-div" />
          <div className="edt-group">
            <span className="edt-label">Properties</span>
            <div className="edt-props">
              <div className="edt-prop"><span>X</span><input type="number" value={Math.round(sel.x)} onChange={e => onUpdateSelected({ x: +e.target.value })} /></div>
              <div className="edt-prop"><span>Y</span><input type="number" value={Math.round(sel.y)} onChange={e => onUpdateSelected({ y: +e.target.value })} /></div>
              <div className="edt-prop"><span>W</span><input type="number" value={Math.round(sel.width)} onChange={e => onUpdateSelected({ width: +e.target.value })} /></div>
              <div className="edt-prop"><span>H</span><input type="number" value={Math.round(sel.height)} onChange={e => onUpdateSelected({ height: +e.target.value })} /></div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
