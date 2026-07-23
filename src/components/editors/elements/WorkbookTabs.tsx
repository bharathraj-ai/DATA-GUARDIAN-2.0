import React from "react";

interface WorkbookTabsProps {
  sheets: string[];
  activeSheet: number;
  onTabChange: (idx: number) => void;
  onTabDoubleClick?: (idx: number) => void;
}

export function WorkbookTabs({ sheets, activeSheet, onTabChange, onTabDoubleClick }: WorkbookTabsProps) {
  return (
    <div style={{ display: "flex", borderBottom: "1px solid #333", background: "#1a1a1a", overflowX: "auto", flexShrink: 0 }}>
      {sheets.map((sheet, idx) => (
        <div
          key={idx}
          onClick={() => onTabChange(idx)}
          onDoubleClick={() => onTabDoubleClick?.(idx)}
          style={{
            padding: "8px 16px",
            fontSize: "13px",
            cursor: "pointer",
            color: activeSheet === idx ? "#fff" : "#888",
            borderBottom: activeSheet === idx ? "2px solid #3b82f6" : "2px solid transparent",
            backgroundColor: activeSheet === idx ? "#2a2a2a" : "transparent",
            whiteSpace: "nowrap",
            userSelect: "none"
          }}
        >
          {sheet}
        </div>
      ))}
    </div>
  );
}
