/**
 * BlockPreview Component
 * 
 * Renders a single document block with inline editing, type badge,
 * reorder controls, and selection state. Memoized to prevent
 * unnecessary re-renders in large document lists.
 *
 * @module pdf/ui/BlockPreview
 */

import { useState, useRef, useEffect, memo } from "react";
import { esc } from "../exporter";

/* ─── Type-specific visual styles ────────────────────────────────────── */
const TYPE_STYLES = {
  h1: { fontSize: 26, fontWeight: 800, color: "#1a2e5a", marginBottom: 4, fontFamily: "'Playfair Display', serif" },
  h2: { fontSize: 20, fontWeight: 700, color: "#2347a0", marginBottom: 3, fontFamily: "'Playfair Display', serif" },
  h3: { fontSize: 15, fontWeight: 700, color: "#1f4e79", marginBottom: 2, fontFamily: "'DM Sans', sans-serif" },
  paragraph: { fontSize: 13, fontWeight: 400, color: "#222", lineHeight: 1.7, fontFamily: "'DM Sans', sans-serif" },
  list: { fontSize: 13, fontWeight: 400, color: "#222", lineHeight: 1.7, paddingLeft: 20, fontFamily: "'DM Sans', sans-serif" },
};

/* ─── Badge colors per block type ────────────────────────────────────── */
const BADGE_COLORS = {
  h1: "#2347a0",
  h2: "#3b7cf4",
  h3: "#0ea5e9",
  list: "#16a34a",
  paragraph: "#6b7280",
};

const BLOCK_TYPES = ["h1", "h2", "h3", "paragraph", "list", "pagebreak"];

/**
 * @param {Object} props
 * @param {{id: string, type: string, text?: string}} props.block
 * @param {number} props.index
 * @param {boolean} props.selected
 * @param {boolean} [props.disabled] - When true, editing is locked
 * @param {(index: number) => void} props.onSelect
 * @param {(index: number, patch: Object) => void} props.onUpdate
 * @param {(index: number) => void} props.onDelete
 * @param {(index: number) => void} props.onMoveUp
 * @param {(index: number) => void} props.onMoveDown
 */
const BlockPreview = memo(function BlockPreview({ block, index, selected, disabled, onSelect, onUpdate, onDelete, onMoveUp, onMoveDown }) {
  const [editing, setEditing] = useState(false);
  const ref = useRef(null);
  const lastUpdateContent = useRef(block.text);

  useEffect(() => {
    if (!editing && ref.current && ref.current.innerHTML !== (block.text || "")) {
      ref.current.innerHTML = esc(block.text || "");
      lastUpdateContent.current = block.text;
    }
  }, [block.text, editing]);

  /* ─── Page Break Separator ───────────────────────────────────────── */
  if (block.type === "pagebreak") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "8px 0", opacity: 0.5 }}>
        <div style={{ flex: 1, height: 1, borderTop: "2px dashed #b0bacc" }} />
        <span style={{ fontSize: 11, color: "#8896b0", fontFamily: "monospace", whiteSpace: "nowrap" }}>— Page Break —</span>
        <div style={{ flex: 1, height: 1, borderTop: "2px dashed #b0bacc" }} />
      </div>
    );
  }

  const baseStyle = TYPE_STYLES[block.type] || TYPE_STYLES.paragraph;
  const badgeColor = BADGE_COLORS[block.type] || BADGE_COLORS.paragraph;

  return (
    <div
      style={{
        display: "flex", alignItems: "flex-start", gap: 8,
        padding: "6px 8px", borderRadius: 8,
        background: selected ? "#edf2ff" : "transparent",
        border: selected ? "1px solid #a0b4f0" : "1px solid transparent",
        cursor: "pointer", transition: "all 0.15s", marginBottom: 2,
      }}
      onClick={() => onSelect(index)}
    >
      {/* Type badge */}
      <div style={{
        flexShrink: 0, marginTop: 3,
        fontSize: 9, fontWeight: 700, letterSpacing: "0.05em",
        background: badgeColor,
        color: "#fff", borderRadius: 4, padding: "2px 5px", minWidth: 28, textAlign: "center"
      }}>
        {block.type === "paragraph" ? "¶" : block.type === "list" ? "•" : block.type.toUpperCase()}
      </div>

      {/* Content */}
      <div
        ref={ref}
        contentEditable={editing && !disabled}
        suppressContentEditableWarning
        style={{ ...baseStyle, flex: 1, outline: "none", minHeight: 18 }}
        onDoubleClick={e => {
          if (disabled) return;
          e.stopPropagation();
          setEditing(true);
          ref.current?.focus();
        }}
        onBlur={e => {
          setEditing(false);
          const newHtml = e.target.innerText;
          if (newHtml !== lastUpdateContent.current) {
            lastUpdateContent.current = newHtml;
            onUpdate(index, { text: newHtml });
          }
        }}
      />

      {/* Controls (visible when selected and not locked) */}
      {selected && !disabled && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2, flexShrink: 0 }}>
          <select
            value={block.type}
            onChange={e => { onUpdate(index, { type: e.target.value }); }}
            onClick={e => e.stopPropagation()}
            style={{ fontSize: 10, background: "#f0f4ff", border: "1px solid #c0ccee", borderRadius: 4, padding: "2px 4px", color: "#333", cursor: "pointer", outline: "none", fontFamily: "inherit" }}
          >
            {BLOCK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <div style={{ display: "flex", gap: 2 }}>
            <button onClick={e => { e.stopPropagation(); onMoveUp(index); }}
              style={{ fontSize: 10, padding: "1px 5px", background: "#e8edff", border: "1px solid #c0ccee", borderRadius: 3, cursor: "pointer" }}>↑</button>
            <button onClick={e => { e.stopPropagation(); onMoveDown(index); }}
              style={{ fontSize: 10, padding: "1px 5px", background: "#e8edff", border: "1px solid #c0ccee", borderRadius: 3, cursor: "pointer" }}>↓</button>
            <button onClick={e => { e.stopPropagation(); onDelete(index); }}
              style={{ fontSize: 10, padding: "1px 5px", background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 3, cursor: "pointer", color: "#dc2626" }}>×</button>
          </div>
        </div>
      )}
    </div>
  );
});

export default BlockPreview;
