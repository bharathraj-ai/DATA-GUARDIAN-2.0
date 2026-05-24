import React from "react";
import { ZipEntryElementData } from "../types";
import { FILE_ICONS } from "../utils/editorUtils";

interface ZipEntryElementProps {
  el: ZipEntryElementData;
  scale: number;
  selected: boolean;
  onSelect: () => void;
}

export const ZipEntryElement = React.memo(({ el, scale, selected, onSelect }: ZipEntryElementProps) => {
  const name = el.path.split("/").pop() || "File";
  const kb = (el.size / 1024).toFixed(1);
  const icon = FILE_ICONS[el.ext] || FILE_ICONS.default;

  return (
    <div 
      style={{ 
        position: "relative", 
        width: el.width * scale, 
        height: el.height * scale, 
        border: selected ? "2px solid #fff" : "1px solid #27272a", 
        borderRadius: 8 * scale, 
        background: "#18181b", 
        display: "flex", 
        flexDirection: "column", 
        alignItems: "center", 
        justifyContent: "center", 
        cursor: "pointer", 
        boxShadow: "0 1px 3px rgba(0,0,0,0.3)", 
        padding: 8 * scale, 
        gap: 4 * scale 
      }} 
      onClick={e => { e.stopPropagation(); onSelect(); }}
    >
      {el.preview ? (
        <img src={el.preview} alt={name} style={{ width: "80%", height: 80 * scale, objectFit: "cover", borderRadius: 4 }} />
      ) : (
        <div style={{ fontSize: 36 * scale }}>{icon}</div>
      )}
      <div style={{ fontSize: 10 * scale, textAlign: "center", wordBreak: "break-all", color: "#d4d4d8", fontWeight: 600, lineHeight: 1.3 }}>{name}</div>
      <div style={{ fontSize: 9 * scale, color: "#71717a" }}>{kb} KB</div>
    </div>
  );
});
