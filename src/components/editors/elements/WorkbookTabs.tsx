import React from "react";

interface WorkbookTabsProps {
  sheets: string[];
  activeSheet: number;
  onTabChange: (idx: number) => void;
  onTabDoubleClick?: (idx: number) => void;
}

export function WorkbookTabs({ sheets, activeSheet, onTabChange, onTabDoubleClick }: WorkbookTabsProps) {
  return (
    <div className="workbook-tabs" style={{ display: "flex", borderBottom: "1px solid #e5e7eb", background: "#f8fafc", overflowX: "auto", flexShrink: 0, maxWidth: "100%" }}>
      {sheets.map((sheet, idx) => (
        <div
          key={idx}
          onClick={() => onTabChange(idx)}
          onDoubleClick={() => onTabDoubleClick?.(idx)}
          style={{
            padding: "8px 16px",
            fontSize: "13px",
            cursor: "pointer",
            color: activeSheet === idx ? "#0284c7" : "#64748b",
            borderBottom: activeSheet === idx ? "2px solid #0284c7" : "2px solid transparent",
            backgroundColor: activeSheet === idx ? "#ffffff" : "transparent",
            fontWeight: activeSheet === idx ? 700 : 500,
            whiteSpace: "nowrap",
            userSelect: "none",
            fontFamily: "Inter, system-ui, sans-serif",
          }}
        >
          {sheet}
        </div>
      ))}
    </div>
  );
}
