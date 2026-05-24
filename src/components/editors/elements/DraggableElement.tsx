import React, { useState, ReactNode } from "react";
import { EditorElement } from "../types";

interface DraggableElementProps {
  el: EditorElement;
  scale: number;
  onUpdate: (patch: Partial<EditorElement>) => void;
  onDelete: () => void;
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
}

export const DraggableElement: React.FC<DraggableElementProps> = ({ el, scale, onUpdate, onDelete, children, selected, onSelect }) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const startDrag = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-nondrag]")) return;
    e.stopPropagation(); 
    onSelect();
    setIsDragging(true);
    const sx = e.clientX, sy = e.clientY, ox = el.x, oy = el.y;
    const onMove = (me: MouseEvent) => onUpdate({ x: ox + (me.clientX - sx) / scale, y: oy + (me.clientY - sy) / scale });
    const up = () => { setIsDragging(false); window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", onMove); 
    window.addEventListener("mouseup", up);
  };

  const startResize = (e: React.MouseEvent) => {
    e.stopPropagation();
    const sx = e.clientX, sy = e.clientY, ow = el.width || 200, oh = el.height || 100;
    const onMove = (me: MouseEvent) => onUpdate({ width: Math.max(60, ow + (me.clientX - sx) / scale), height: Math.max(30, oh + (me.clientY - sy) / scale) });
    const up = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", onMove); 
    window.addEventListener("mouseup", up);
  };

  return (
    <div 
      onMouseDown={startDrag} 
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{ position: "absolute", left: el.x * scale, top: el.y * scale, cursor: isDragging ? "grabbing" : "grab", userSelect: "none" }}
    >
      {children}
      
      {/* Top-Left Selection/Drag Handle */}
      <div 
        style={{ 
          position: "absolute", 
          top: -4, 
          left: -4, 
          width: 8, 
          height: 8, 
          borderRadius: 2, 
          background: isDragging ? "#09090b" : selected ? "#3f3f46" : "#ffffff", 
          border: "1px solid #18181b",
          opacity: (selected || isHovered || isDragging) ? 1 : 0,
          transition: "all 0.15s ease",
          zIndex: 10,
          pointerEvents: "none",
          boxShadow: selected || isDragging ? "0 1px 3px rgba(0,0,0,0.2)" : "none"
        }} 
      />

      {/* Bottom-Right Resize Handle */}
      {selected && (
        <div 
          data-nondrag="1" 
          onMouseDown={startResize} 
          style={{ 
            position: "absolute", 
            bottom: -4, 
            right: -4, 
            width: 8, 
            height: 8, 
            borderRadius: 2, 
            background: "#ffffff", 
            cursor: "se-resize", 
            zIndex: 10, 
            border: "1px solid #18181b",
            boxShadow: "0 1px 3px rgba(0,0,0,0.2)"
          }} 
        />
      )}
    </div>
  );
};
