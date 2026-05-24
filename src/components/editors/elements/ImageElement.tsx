import React from "react";
import { ImageElementData } from "../types";

interface ImageElementProps {
  el: ImageElementData;
  scale: number;
  selected: boolean;
  onSelect: () => void;
}

export const ImageElement = React.memo(({ el, scale, selected, onSelect }: ImageElementProps) => {
  return (
    <div 
      style={{ 
        position: "relative", 
        width: (el.width || 200) * scale, 
        height: (el.height || 150) * scale, 
        border: selected ? "2px solid #fff" : "1px solid transparent", 
        cursor: "move", 
        overflow: "hidden" 
      }} 
      onClick={e => { e.stopPropagation(); onSelect(); }}
    >
      <img src={el.src} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
    </div>
  );
});
