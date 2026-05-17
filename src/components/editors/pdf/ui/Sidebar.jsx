/**
 * Sidebar Component
 * 
 * Right panel showing either document info (when no block selected)
 * or block properties (when a block is selected) with editing controls.
 *
 * @module pdf/ui/Sidebar
 */

import { memo } from "react";

const BLOCK_TYPES = ["h1", "h2", "h3", "paragraph", "list", "pagebreak"];

/**
 * @param {Object} props
 * @param {number|null} props.selectedBlock - Index of selected block
 * @param {Array} props.blocks - All blocks
 * @param {Object} props.stats - Block type counts
 * @param {File|null} props.file - Source file
 * @param {{numPages: number}} props.parsed - Parsed data
 * @param {boolean} props.disabled - Editing locked
 * @param {(index: number, patch: Object) => void} props.onUpdateBlock
 * @param {(index: number) => void} props.onDeleteBlock
 * @param {(index: number, dir: number) => void} props.onMoveBlock
 * @param {(index: number|null) => void} props.onSelectBlock
 * @param {() => void} props.onUploadReplace - Trigger upload replace
 * @param {() => void} props.onFinishEditing - Trigger finish editing
 * @param {boolean} props.hasOnSave - Whether onSave callback exists
 */
const Sidebar = memo(function Sidebar({
  selectedBlock, blocks, stats, file, parsed, disabled,
  onUpdateBlock, onDeleteBlock, onMoveBlock, onSelectBlock,
  onUploadReplace, onFinishEditing, hasOnSave
}) {
  const block = selectedBlock !== null ? blocks[selectedBlock] : null;

  return (
    <div style={{ width: 240, background: "#fff", borderLeft: "1px solid #e4e9f5", display: "flex", flexDirection: "column", flexShrink: 0 }}>
      {/* Header */}
      <div style={{ padding: "14px 16px", borderBottom: "1px solid #f0f4fb" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#1a2540", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          {selectedBlock !== null ? "Block Properties" : "Document Info"}
        </span>
      </div>

      {/* Content area */}
      <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        {selectedBlock === null ? (
          /* ─── Document Info View ───────────────────────────────────── */
          <>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, color: "#8896b0", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Source File</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#1a2540", wordBreak: "break-all" }}>{file?.name}</div>
              <div style={{ fontSize: 12, color: "#8896b0", marginTop: 3 }}>{(file?.size / 1024).toFixed(1)} KB · {parsed?.numPages} pages</div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, color: "#8896b0", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Block Summary</div>
              {Object.entries(stats).filter(([,v]) => v > 0).map(([k,v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 0", borderBottom: "1px solid #f0f4fb" }}>
                  <span style={{ color: "#5a6a8a", fontWeight: 500 }}>{k}</span>
                  <span style={{ fontWeight: 700, color: "#2347a0" }}>{v}</span>
                </div>
              ))}
            </div>
            <div style={{ background: "#f5f7ff", borderRadius: 10, padding: "12px 14px", border: "1px solid #e4e9f5" }}>
              <div style={{ fontSize: 11, color: "#5a6a8a", lineHeight: 1.6 }}>
                <strong style={{ color: "#2347a0" }}>Click</strong> a block to select.<br/>
                <strong style={{ color: "#2347a0" }}>Double-click</strong> to edit text.<br/>
                <strong style={{ color: "#2347a0" }}>Change type</strong> via dropdown.<br/>
                <strong style={{ color: "#2347a0" }}>Reorder</strong> with ↑↓ arrows.
              </div>
            </div>
          </>
        ) : (
          /* ─── Block Properties View ───────────────────────────────── */
          <>
            {block && (
              <>
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 10, color: "#8896b0", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Block #{selectedBlock + 1}</div>
                  <select
                    value={block.type}
                    onChange={e => onUpdateBlock(selectedBlock, { type: e.target.value })}
                    disabled={disabled}
                    style={{ width: "100%", background: "#f5f7ff", border: "1.5px solid #a0b4d4", borderRadius: 8, padding: "7px 10px", fontSize: 12, fontWeight: 600, color: "#2347a0", fontFamily: "inherit", cursor: disabled ? "not-allowed" : "pointer", outline: "none" }}
                  >
                    {BLOCK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>

                {block.type !== "pagebreak" && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 10, color: "#8896b0", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Text Content</div>
                    <textarea
                      value={block.text || ""}
                      onChange={e => onUpdateBlock(selectedBlock, { text: e.target.value })}
                      disabled={disabled}
                      style={{ width: "100%", background: "#f5f7ff", border: "1px solid #dde3f0", borderRadius: 8, padding: "8px 10px", fontSize: 12, color: "#1a2540", fontFamily: "'DM Sans', sans-serif", resize: "vertical", minHeight: 80, outline: "none", lineHeight: 1.5 }}
                    />
                  </div>
                )}

                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 10, color: "#8896b0", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Formatting</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {[{k:"bold",l:"B",s:{fontWeight:"bold"}},{k:"italic",l:"I",s:{fontStyle:"italic"}}].map(({k,l,s}) => (
                      <button key={k}
                        onClick={() => onUpdateBlock(selectedBlock, { [k]: !block[k] })}
                        disabled={disabled}
                        style={{ flex:1, padding:"6px", background: block[k] ? "#2347a0" : "#f5f7ff", color: block[k] ? "#fff" : "#5a6a8a", border: "1px solid " + (block[k] ? "#2347a0" : "#dde3f0"), borderRadius: 7, cursor: disabled ? "not-allowed" : "pointer", fontFamily: "inherit", ...s, fontSize: 14, fontWeight: "bold" }}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 6 }}>
                  <button className="btn btn-ghost btn-sm" disabled={disabled} style={{ flex: 1, justifyContent: "center" }} onClick={() => onMoveBlock(selectedBlock, -1)}>↑ Up</button>
                  <button className="btn btn-ghost btn-sm" disabled={disabled} style={{ flex: 1, justifyContent: "center" }} onClick={() => onMoveBlock(selectedBlock, 1)}>↓ Down</button>
                </div>

                <button className="btn btn-sm" disabled={disabled} onClick={() => { onDeleteBlock(selectedBlock); onSelectBlock(null); }}
                  style={{ width: "100%", marginTop: 8, justifyContent: "center", background: "#fee2e2", color: "#dc2626", border: "1px solid #fca5a5", borderRadius: 8, fontSize: 12, cursor: disabled ? "not-allowed" : "pointer" }}>
                  🗑 Delete Block
                </button>
              </>
            )}
          </>
        )}
      </div>

      {/* Bottom actions */}
      <div style={{ padding: 16, borderTop: "1px solid #f0f4fb", display: "flex", flexDirection: "column", gap: 8 }}>
        {hasOnSave && !disabled && (
          <>
            <button className="btn btn-outline" style={{ width: "100%", justifyContent: "center", fontSize: 14, padding: "11px", gap: "8px" }} onClick={onUploadReplace}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
              Upload Replace
            </button>
            <button className="btn" style={{ width: "100%", justifyContent: "center", fontSize: 14, padding: "11px", background: "linear-gradient(135deg, #2347a0, #3b7cf4)", color: "#fff", border: "none", boxShadow: "0 4px 12px rgba(35,71,160,0.25)" }} onClick={onFinishEditing}>
              ✅ Finish Editing
            </button>
          </>
        )}
      </div>
    </div>
  );
});

export default Sidebar;
