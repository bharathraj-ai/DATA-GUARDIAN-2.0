export const uid = () => Math.random().toString(36).slice(2, 10);

export const FONTS = [
  "Georgia", "Times New Roman", "Palatino", "Garamond", "Arial", 
  "Helvetica", "Verdana", "Tahoma", "Trebuchet MS", "Courier New", 
  "Lucida Console", "Monaco", "Impact", "Comic Sans MS"
];

export const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72];

export const FILE_ICONS: Record<string, string> = { 
  pdf: "📄", txt: "📝", xlsx: "📊", xls: "📊", csv: "📊", 
  png: "🖼️", jpg: "🖼️", jpeg: "🖼️", gif: "🖼️", webp: "🖼️", 
  zip: "🗜️", doc: "📃", docx: "📃", default: "📁" 
};

export const getFileIcon = (name: string = "") => { 
  const ext = name.split(".").pop()?.toLowerCase() || ""; 
  return FILE_ICONS[ext] || FILE_ICONS.default; 
};

export function loadScript(src: string, id: string, globalName: string): Promise<void> {
  return new Promise((res, rej) => {
    if (globalName && ((window as any)[globalName] || (window as any)["pdfjs-dist/build/pdf"])) { res(); return; }
    if (document.getElementById(id)) {
      const wait = () => {
        if ((window as any)[globalName] || (window as any)["pdfjs-dist/build/pdf"]) res();
        else setTimeout(wait, 50);
      };
      wait();
      return;
    }
    const s = document.createElement("script");
    s.id = id; s.src = src;
    s.onload = () => {
      const wait = () => {
        if ((window as any)[globalName] || (window as any)["pdfjs-dist/build/pdf"]) res();
        else setTimeout(wait, 50);
      };
      wait();
    };
    s.onerror = rej;
    document.head.appendChild(s);
  });
}
