export const uid = () => Math.random().toString(36).slice(2, 10);

/** Touch / stylus — single-tap edit, no hover. */
export function isCoarsePointer(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(hover: none) and (pointer: coarse)").matches;
}

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

/**
 * Polls for a global variable to become available.
 * Times out after ~5 seconds (100 iterations × 50ms).
 */
function waitForGlobal(globalName: string, maxPolls = 100): Promise<void> {
  return new Promise((resolve, reject) => {
    let polls = 0;
    const check = () => {
      if ((window as any)[globalName] || (window as any)["pdfjs-dist/build/pdf"]) {
        resolve();
      } else if (++polls >= maxPolls) {
        reject(new Error(`Timed out waiting for global: ${globalName}`));
      } else {
        setTimeout(check, 50);
      }
    };
    check();
  });
}

export function loadScript(src: string, id: string, globalName: string): Promise<void> {
  return new Promise((res, rej) => {
    // Already loaded
    if (globalName && ((window as any)[globalName] || (window as any)["pdfjs-dist/build/pdf"])) {
      res();
      return;
    }

    // Script tag exists but global not yet available — wait for it
    if (document.getElementById(id)) {
      waitForGlobal(globalName).then(res, rej);
      return;
    }

    // Create and inject script tag
    const s = document.createElement("script");
    s.id = id;
    s.src = src;
    s.onload = () => waitForGlobal(globalName).then(res, rej);
    s.onerror = rej;
    document.head.appendChild(s);
  });
}
