"use client";
import React from "react";
import { TableActions } from "./TableElement";

interface TableToolsSidebarProps {
  actions: TableActions | null;
}

// ── SVG Icon Helpers ──────────────────────────────────────────────────────
const Icon = ({ children, size = 14 }: { children: React.ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);

const RowPlusIcon = () => <Icon><path d="M3 6h18M3 12h18M3 18h18" /><circle cx="19" cy="19" r="4" fill="#09090b" stroke="currentColor" /><line x1="19" y1="17" x2="19" y2="21" /><line x1="17" y1="19" x2="21" y2="19" /></Icon>;
const RowMinusIcon = () => <Icon><path d="M3 6h18M3 12h18M3 18h18" /><circle cx="19" cy="19" r="4" fill="#09090b" stroke="currentColor" /><line x1="17" y1="19" x2="21" y2="19" /></Icon>;
const ColPlusIcon = () => <Icon><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="9" y1="3" x2="9" y2="21" /><line x1="15" y1="3" x2="15" y2="21" /><circle cx="19" cy="19" r="4" fill="#09090b" stroke="currentColor" /><line x1="19" y1="17" x2="19" y2="21" /><line x1="17" y1="19" x2="21" y2="19" /></Icon>;
const ColMinusIcon = () => <Icon><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="9" y1="3" x2="9" y2="21" /><line x1="15" y1="3" x2="15" y2="21" /><circle cx="19" cy="19" r="4" fill="#09090b" stroke="currentColor" /><line x1="17" y1="19" x2="21" y2="19" /></Icon>;
const HeaderIcon = () => <Icon><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /></Icon>;
const SortAscIcon = () => <Icon><path d="M4 6h7M4 12h5M4 18h3" /><path d="M18 20V4l-4 4" /></Icon>;
const SortDescIcon = () => <Icon><path d="M4 6h7M4 12h5M4 18h3" /><path d="M18 4v16l-4-4" /></Icon>;
const BoldIcon = () => <Icon><path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" /><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" /></Icon>;
const ItalicIcon = () => <Icon><line x1="19" y1="4" x2="10" y2="4" /><line x1="14" y1="20" x2="5" y2="20" /><line x1="15" y1="4" x2="9" y2="20" /></Icon>;
const UnderlineIcon = () => <Icon><path d="M6 3v7a6 6 0 0 0 6 6 6 6 0 0 0 6-6V3" /><line x1="4" y1="21" x2="20" y2="21" /></Icon>;
const AlignLeftIcon = () => <Icon><line x1="17" y1="10" x2="3" y2="10" /><line x1="21" y1="6" x2="3" y2="6" /><line x1="21" y1="14" x2="3" y2="14" /><line x1="17" y1="18" x2="3" y2="18" /></Icon>;
const AlignCenterIcon = () => <Icon><line x1="18" y1="10" x2="6" y2="10" /><line x1="21" y1="6" x2="3" y2="6" /><line x1="21" y1="14" x2="3" y2="14" /><line x1="18" y1="18" x2="6" y2="18" /></Icon>;
const AlignRightIcon = () => <Icon><line x1="21" y1="10" x2="7" y2="10" /><line x1="21" y1="6" x2="3" y2="6" /><line x1="21" y1="14" x2="3" y2="14" /><line x1="21" y1="18" x2="7" y2="18" /></Icon>;
const JustifyIcon = () => <Icon><line x1="21" y1="10" x2="3" y2="10" /><line x1="21" y1="6" x2="3" y2="6" /><line x1="21" y1="14" x2="3" y2="14" /><line x1="21" y1="18" x2="3" y2="18" /></Icon>;
const TextColorIcon = () => <Icon size={12}><path d="M4 20h16" strokeWidth="3" /><path d="M9.5 4L5 16h2l1-3h8l1 3h2L14.5 4h-5z" /></Icon>;
const FillColorIcon = () => <Icon size={12}><path d="M19 11V9a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h4" /><path d="M16 16l3.5 3.5a2.12 2.12 0 0 0 3-3L19 13" /><path d="M14.5 17.5L20 12" /></Icon>;
const TableSectionIcon = () => <Icon size={12}><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="15" x2="21" y2="15" /><line x1="9" y1="3" x2="9" y2="21" /><line x1="15" y1="3" x2="15" y2="21" /></Icon>;

export const TableToolsSidebar: React.FC<TableToolsSidebarProps> = ({ actions }) => {
  const isDisabled = !actions;
  const hasCell = actions?.hasActiveCell ?? false;
  const cell = actions?.currentCell ?? null;

  return (
    <>
      {/* ── TABLE TOOLS ── */}
      <div className={`table-tools-section ${isDisabled ? "disabled-section" : ""}`}>
        <div className="table-tools-header">
          <TableSectionIcon />
          Table Tools
        </div>
        <div className="table-tools-grid">
          <button
            className="table-tool-btn"
            onClick={() => actions?.addRow()}
            disabled={isDisabled}
            title="Add row below selected row"
            aria-label="Add Row"
          >
            <RowPlusIcon /> Row +
          </button>
          <button
            className="table-tool-btn danger"
            onClick={() => actions?.deleteRow()}
            disabled={isDisabled || !actions?.canDeleteRow}
            title="Remove selected row"
            aria-label="Remove Row"
          >
            <RowMinusIcon /> Row −
          </button>
          <button
            className="table-tool-btn"
            onClick={() => actions?.addCol()}
            disabled={isDisabled}
            title="Add column after selected column"
            aria-label="Add Column"
          >
            <ColPlusIcon /> Col +
          </button>
          <button
            className="table-tool-btn danger"
            onClick={() => actions?.deleteCol()}
            disabled={isDisabled || !actions?.canDeleteCol}
            title="Remove selected column"
            aria-label="Remove Column"
          >
            <ColMinusIcon /> Col −
          </button>
        </div>
      </div>

      {/* ── OTHER TOOLS ── */}
      <div className={`table-tools-section ${isDisabled ? "disabled-section" : ""}`}>
        <div className="table-tools-header">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
          Other Tools
        </div>
        <div className="table-tools-grid">
          <button
            className={`table-tool-btn ${actions?.hasHeader ? "active" : ""}`}
            onClick={() => actions?.toggleHeader()}
            disabled={isDisabled}
            title="Toggle first row as header"
            aria-label="Toggle Header"
          >
            <HeaderIcon /> Header
          </button>
          <button
            className="table-tool-btn"
            onClick={() => actions?.sortAsc()}
            disabled={isDisabled || !hasCell}
            title="Sort selected column ascending"
            aria-label="Sort Ascending"
          >
            <SortAscIcon /> Ascending
          </button>
          <button
            className="table-tool-btn"
            onClick={() => actions?.sortDesc()}
            disabled={isDisabled || !hasCell}
            title="Sort selected column descending"
            aria-label="Sort Descending"
          >
            <SortDescIcon /> Descend
          </button>
          <button
            className={`table-tool-btn ${cell?.bold ? "active" : ""}`}
            onClick={() => actions?.applyStyle("bold", !cell?.bold)}
            disabled={isDisabled || !hasCell}
            title="Toggle bold on selected cell"
            aria-label="Bold"
          >
            <BoldIcon /> Bold
          </button>
          <button
            className={`table-tool-btn ${cell?.italic ? "active" : ""}`}
            onClick={() => actions?.applyStyle("italic", !cell?.italic)}
            disabled={isDisabled || !hasCell}
            title="Toggle italic on selected cell"
            aria-label="Italic"
          >
            <ItalicIcon /> Italic
          </button>
          <button
            className={`table-tool-btn ${cell?.underline ? "active" : ""}`}
            onClick={() => actions?.applyStyle("underline", !cell?.underline)}
            disabled={isDisabled || !hasCell}
            title="Toggle underline on selected cell"
            aria-label="Underline"
          >
            <UnderlineIcon /> Underline
          </button>

          <div className="table-tools-divider" style={{ gridColumn: "1 / -1" }} />

          <button
            className={`table-tool-btn ${cell?.align === "left" || !cell?.align ? "active" : ""}`}
            onClick={() => actions?.applyStyle("align", "left")}
            disabled={isDisabled || !hasCell}
            title="Align text left"
            aria-label="Align Left"
          >
            <AlignLeftIcon /> Align Left
          </button>
          <button
            className={`table-tool-btn ${cell?.align === "center" ? "active" : ""}`}
            onClick={() => actions?.applyStyle("align", "center")}
            disabled={isDisabled || !hasCell}
            title="Align text center"
            aria-label="Center"
          >
            <AlignCenterIcon /> Center
          </button>
          <button
            className={`table-tool-btn ${cell?.align === "right" ? "active" : ""}`}
            onClick={() => actions?.applyStyle("align", "right")}
            disabled={isDisabled || !hasCell}
            title="Align text right"
            aria-label="Align Right"
          >
            <AlignRightIcon /> Align Right
          </button>
          <button
            className="table-tool-btn"
            onClick={() => actions?.applyStyle("align", "justify" as any)}
            disabled={isDisabled || !hasCell}
            title="Justify text"
            aria-label="Justify"
          >
            <JustifyIcon /> Justify
          </button>

          <div className="table-tools-divider" style={{ gridColumn: "1 / -1" }} />

          {/* Color pickers */}
          <div className="table-tool-color">
            <TextColorIcon />
            <span>Text Color</span>
            <input
              type="color"
              value={cell?.textColor || "#fafafa"}
              onChange={(e) => actions?.applyStyle("textColor", e.target.value)}
              disabled={isDisabled || !hasCell}
              title="Text color"
            />
          </div>
          <div className="table-tool-color">
            <FillColorIcon />
            <span>Fill Color</span>
            <input
              type="color"
              value={cell?.bgColor || "#09090b"}
              onChange={(e) => actions?.applyStyle("bgColor", e.target.value)}
              disabled={isDisabled || !hasCell}
              title="Background color"
            />
          </div>
        </div>
      </div>
    </>
  );
};
