/**
 * Toolbar Component
 * 
 * Top navigation bar with file info, block add buttons, undo/redo,
 * upload replace, and the Finish Editing action. Includes the
 * submission confirmation modal overlay.
 *
 * @module pdf/ui/Toolbar
 */

import { memo } from "react";

const BLOCK_TYPES = ["h1", "h2", "h3", "paragraph", "list", "pagebreak"];

/**
 * @param {Object} props
 * @param {() => void} props.onBack
 * @param {File|null} props.file
 * @param {{numPages: number}} props.parsed
 * @param {boolean} props.hasOnSave
 * @param {boolean} props.disabled - Editing locked
 * @param {() => void} props.onAddBlock - Called with type 'paragraph'
 * @param {() => void} props.onUndo
 * @param {() => void} props.onRedo
 * @param {boolean} props.canUndo
 * @param {boolean} props.canRedo
 * @param {() => void} props.onUploadReplace
 * @param {() => void} props.onFinishEditing
 * @param {React.RefObject} props.replaceFileRef
 * @param {(e: Event) => void} props.handleUploadReplace
 * @param {boolean} props.showConfirmModal
 * @param {() => void} props.onCancelSubmission
 * @param {() => void} props.onSubmitFinal
 */
const Toolbar = memo(function Toolbar({
  onBack, file, parsed, hasOnSave, disabled,
  onAddBlock, onUndo, onRedo, canUndo, canRedo,
  onUploadReplace, onFinishEditing,
  replaceFileRef, handleUploadReplace,
  showConfirmModal, onCancelSubmission, onSubmitFinal
}) {
  return (
    <>
      {/* ─── Top Bar ────────────────────────────────────────────────── */}
      <div style={{ height: 56, background: "#fff", borderBottom: "1px solid #e4e9f5", display: "flex", alignItems: "center", padding: "0 24px", gap: 16, flexShrink: 0, boxShadow: "0 2px 10px rgba(35,71,160,0.06)", zIndex: 100 }}>
        {/* Brand */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }} onClick={onBack}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: "linear-gradient(135deg, #2347a0, #3b7cf4)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 12px rgba(35,71,160,0.25)" }}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 2L3 6v8l7 4 7-4V6L10 2z" stroke="#fff" strokeWidth="1.5" fill="rgba(255,255,255,0.15)" /><path d="M10 2v16M3 6l7 4 7-4" stroke="#fff" strokeWidth="1.5" /></svg>
          </div>
          <span style={{ fontFamily: "'Playfair Display', serif", fontWeight: 800, fontSize: 18, color: "#1a2540", letterSpacing: "-0.01em" }}>UniEdit</span>
        </div>

        <div className="sep" style={{ background: "#e4e9f5", height: 24, margin: "0 10px", width: 1 }} />

        {/* File info */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 16px", background: "#f5f7ff", borderRadius: 10, fontSize: 13, color: "#5a6a8a" }}>
          <span>📄</span>
          <span style={{ fontWeight: 600 }}>{file?.name}</span>
          <span style={{ color: "#b0bacc" }}>·</span>
          <span>{parsed?.numPages} page{parsed?.numPages !== 1 ? "s" : ""}</span>
        </div>

        <div style={{ flex: 1 }} />

        {/* Add text button */}
        {!disabled && (
          <div style={{ display: "flex", gap: 10, marginRight: 12 }}>
            <button className="btn btn-primary btn-sm" onClick={() => onAddBlock("paragraph")} style={{ padding: "6px 14px" }}>＋ Add Text</button>
          </div>
        )}

        {/* Undo/Redo */}
        <div style={{ display: "flex", gap: 4, marginRight: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={onUndo} disabled={!canUndo || disabled} title="Undo (Ctrl+Z)">↩ Undo</button>
          <button className="btn btn-ghost btn-sm" onClick={onRedo} disabled={!canRedo || disabled} title="Redo (Ctrl+Y)">↪ Redo</button>
        </div>

        {/* Save/Submit actions */}
        {hasOnSave && (
          <div style={{ display: "flex", gap: "8px" }}>
            {!disabled && (
              <>
                <button className="btn btn-outline btn-sm" style={{ background: "#fff", borderColor: "#a0b4d4", color: "#2347a0", gap: "6px" }} onClick={() => replaceFileRef.current?.click()}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                  Upload Replace
                </button>
                <input ref={replaceFileRef} type="file" accept=".pdf,.txt,.png,.jpg,.jpeg,.gif,.webp,.csv,.xlsx,.xls,.zip" style={{ display: "none" }} onChange={(e) => { handleUploadReplace(e); e.target.value = ""; }} />
                <button className="btn btn-sm" onClick={onFinishEditing} style={{ fontSize: 13, padding: "8px 20px", background: "linear-gradient(135deg, #2347a0, #3b7cf4)", boxShadow: "0 4px 12px rgba(35,71,160,0.25)", color: "#fff", border: "none" }}>
                  ✅ Finish Editing
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* ─── Confirmation Modal Overlay ─────────────────────────────── */}
      {showConfirmModal && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 10000,
          background: "rgba(0,0,0,0.6)",
          backdropFilter: "blur(4px)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            background: "#fff", borderRadius: 20, padding: "40px 36px",
            maxWidth: 480, width: "100%", textAlign: "center",
            boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
            animation: "fadeUp .3s ease both",
          }}>
            {/* Icon */}
            <div style={{ width: 64, height: 64, borderRadius: "50%", background: "linear-gradient(135deg, #2347a0, #3b7cf4)", margin: "0 auto 20px", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 8px 28px rgba(35,71,160,0.3)" }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            </div>

            <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 24, color: "#1a2540", marginBottom: 12 }}>
              Submit Final Document?
            </h2>
            <p style={{ fontSize: 14, color: "#5a6a8a", lineHeight: 1.7, marginBottom: 32 }}>
              This will finalize your edits and send the document to the owner for approval.
              You will not be able to make further changes until the owner responds.
            </p>

            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <button
                className="btn btn-outline"
                onClick={onCancelSubmission}
                style={{ padding: "12px 28px", fontSize: 14 }}
              >
                Cancel
              </button>
              <button
                className="btn"
                onClick={onSubmitFinal}
                style={{
                  padding: "12px 28px", fontSize: 14,
                  background: "linear-gradient(135deg, #2347a0, #3b7cf4)",
                  color: "#fff", border: "none",
                  boxShadow: "0 4px 16px rgba(35,71,160,0.3)",
                }}
              >
                Submit Final
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
});

export default Toolbar;
