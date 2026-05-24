import React, { useRef, useState, useEffect } from "react";
import { TextElementData } from "../types";

interface TextElementProps {
  el: TextElementData;
  scale: number;
  onUpdate: (patch: Partial<TextElementData>) => void;
  selected: boolean;
  onSelect: () => void;
}

export const TextElement = React.memo(({ el, scale, onUpdate, selected, onSelect }: TextElementProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const lastUpdateContent = useRef(el.content);

  useEffect(() => {
    if (!editing && ref.current && ref.current.innerText !== el.content) {
      ref.current.innerText = el.content || "";
      lastUpdateContent.current = el.content;
    }
  }, [el.content, editing]);

  return (
    <div 
      ref={ref} 
      style={{ 
        position: "relative", 
        width: (el.width || 200) * scale, 
        minHeight: (el.height || 20) * scale, 
        fontFamily: el.font || "Georgia", 
        fontSize: (el.size || 12) * scale, 
        fontWeight: el.bold ? "bold" : "normal", 
        fontStyle: el.italic ? "italic" : "normal", 
        textDecoration: el.underline ? "underline" : "none", 
        color: el.color || "#000", 
        border: selected ? "2px solid #fff" : editing ? "1px dashed #71717a" : "1px solid transparent", 
        borderRadius: 2, 
        padding: 0, 
        cursor: editing ? "text" : "move", 
        outline: "none", 
        background: "#fff", 
        lineHeight: 1.2, 
        wordBreak: "break-word", 
        whiteSpace: "pre-wrap", 
        boxSizing: "border-box", 
        zIndex: selected ? 100 : 1 
      }}
      contentEditable={editing} 
      suppressContentEditableWarning
      onClick={e => { e.stopPropagation(); onSelect(); }}
      onDoubleClick={e => { e.stopPropagation(); setEditing(true); ref.current?.focus(); }}
      onBlur={e => {
        setEditing(false);
        const newText = (e.target as HTMLElement).innerText;
        if (newText !== lastUpdateContent.current) {
          lastUpdateContent.current = newText;
          onUpdate({ content: newText });
        }
      }}
    />
  );
}, (prevProps, nextProps) => {
  return prevProps.el === nextProps.el &&
         prevProps.scale === nextProps.scale &&
         prevProps.selected === nextProps.selected;
});
