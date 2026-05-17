/**
 * PreviewPanel Component
 * 
 * Left sidebar showing rendered PDF page images with pagination controls.
 * Memoized — only re-renders when page data or active page changes.
 *
 * @module pdf/ui/PreviewPanel
 */

import { memo } from "react";

/**
 * @param {Object} props
 * @param {{numPages: number, pages: Array}} props.parsed - Parsed PDF data
 * @param {number} props.previewPage - Currently visible page index
 * @param {(fn: (p: number) => number) => void} props.setPreviewPage
 */
const PreviewPanel = memo(function PreviewPanel({ parsed, previewPage, setPreviewPage }) {
  return (
    <div style={{ width: 380, background: "#fff", borderRight: "1px solid #e4e9f5", display: "flex", flexDirection: "column", flexShrink: 0 }}>
      {/* Header with pagination */}
      <div style={{ padding: "14px 16px", borderBottom: "1px solid #f0f4fb", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#1a2540", textTransform: "uppercase", letterSpacing: "0.06em" }}>PDF Preview</span>
        {parsed && (
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <button className="btn btn-ghost btn-sm" disabled={previewPage === 0} onClick={() => setPreviewPage(p => p - 1)} style={{ padding: "3px 8px" }}>‹</button>
            <span style={{ fontSize: 11, color: "#8896b0" }}>{previewPage + 1} / {parsed.numPages}</span>
            <button className="btn btn-ghost btn-sm" disabled={previewPage >= parsed.numPages - 1} onClick={() => setPreviewPage(p => p + 1)} style={{ padding: "3px 8px" }}>›</button>
          </div>
        )}
      </div>

      {/* Page image */}
      <div style={{ flex: 1, overflow: "auto", padding: "16px", display: "flex", justifyContent: "center", background: "#8896b0" }}>
        {parsed?.pages[previewPage]?.pageImg && (
          <img
            src={parsed.pages[previewPage].pageImg}
            alt={`Page ${previewPage + 1}`}
            style={{ maxWidth: "100%", boxShadow: "0 4px 20px rgba(0,0,0,0.3)", borderRadius: 4 }}
            draggable={false}
          />
        )}
      </div>
    </div>
  );
});

export default PreviewPanel;
