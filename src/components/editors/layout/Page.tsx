import React from "react";
import { PageData, EditorElement } from "../types";
import { DraggableElement } from "../elements/DraggableElement";
import { TextElement } from "../elements/TextElement";
import { ImageElement } from "../elements/ImageElement";
import { TableElement } from "../elements/TableElement";
import { ZipEntryElement } from "../elements/ZipEntryElement";

interface PageProps {
  page: PageData;
  scale: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onUpdate: (pageId: string, elements: EditorElement[]) => void;
  onDelete: (pageId: string, elId: string) => void;
  showBg: boolean;
}

export const Page = React.memo(({ page, scale, selectedId, onSelect, onUpdate, onDelete, showBg }: PageProps) => {
  const updateEl = (id: string, patch: Partial<EditorElement>) => {
    onUpdate(page.id, page.elements.map(e => e.id === id ? { ...e, ...patch } : e) as EditorElement[]);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / scale;
    const y = (e.clientY - rect.top) / scale;
    
    Array.from(e.dataTransfer.files).forEach(file => {
      if (file.type.startsWith("image/")) {
        const fr = new FileReader(); 
        fr.onload = ev => {
          onUpdate(page.id, [...page.elements, { 
            id: Math.random().toString(36).slice(2, 10), 
            type: "image", 
            src: ev.target?.result as string, 
            x, y, 
            width: 200, 
            height: 150, 
            selected: false 
          } as EditorElement]);
        };
        fr.readAsDataURL(file);
      }
    });
  };

  return (
    <div 
      style={{ 
        position: "relative", 
        width: page.width * scale, 
        height: page.height * scale, 
        background: "#ffffff", 
        boxShadow: "0 4px 12px rgba(0,0,0,0.05), 0 1px 3px rgba(0,0,0,0.1)", 
        marginBottom: 32, 
        flexShrink: 0, 
        overflow: "visible", 
        border: "1px solid #e4e4e7" 
      }} 
      onClick={() => onSelect(null)} 
      onDragOver={e => e.preventDefault()} 
      onDrop={handleDrop}
    >
      {page.bgImage && showBg && (
        <img src={page.bgImage} alt="" style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none", opacity: 0.4 }} />
      )}
      
      {page.elements.map(el => {
        const sel = selectedId === el.id;
        const upd = (patch: Partial<EditorElement>) => updateEl(el.id, patch);
        const del = () => onDelete(page.id, el.id);
        const sel2 = () => onSelect(el.id);
        
        if (el.type === "text") {
          return (
            <DraggableElement key={el.id} el={el} scale={scale} onUpdate={upd} onDelete={del} selected={sel} onSelect={sel2}>
              <TextElement el={el as any} scale={scale} onUpdate={upd as any} selected={sel} onSelect={sel2} />
            </DraggableElement>
          );
        }
        if (el.type === "image") {
          return (
            <DraggableElement key={el.id} el={el} scale={scale} onUpdate={upd} onDelete={del} selected={sel} onSelect={sel2}>
              <ImageElement el={el as any} scale={scale} selected={sel} onSelect={sel2} />
            </DraggableElement>
          );
        }
        if (el.type === "table") {
          return (
            <DraggableElement key={el.id} el={el} scale={scale} onUpdate={upd} onDelete={del} selected={sel} onSelect={sel2}>
              <TableElement el={el as any} scale={scale} onUpdate={upd as any} selected={sel} onSelect={sel2} />
            </DraggableElement>
          );
        }
        if (el.type === "zipentry") {
          return (
            <DraggableElement key={el.id} el={el} scale={scale} onUpdate={upd} onDelete={del} selected={sel} onSelect={sel2}>
              <ZipEntryElement el={el as any} scale={scale} selected={sel} onSelect={sel2} />
            </DraggableElement>
          );
        }
        return null;
      })}
    </div>
  );
}, (prevProps, nextProps) => {
  return prevProps.page === nextProps.page &&
         prevProps.scale === nextProps.scale &&
         prevProps.selectedId === nextProps.selectedId &&
         prevProps.showBg === nextProps.showBg;
});
