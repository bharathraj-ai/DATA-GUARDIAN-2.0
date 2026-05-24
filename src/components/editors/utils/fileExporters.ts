import { DocumentData, TableElementData, TextElementData, ImageElementData } from "../types";

export async function exportDocument(currentDoc: DocumentData): Promise<File> {
  if (currentDoc.type === 'pdf') {
    const { PDFDocument, rgb, StandardFonts } = await import("pdf-lib");
    const pdfDoc = await PDFDocument.create();
    for (const page of currentDoc.pages) {
      const pdfPage = pdfDoc.addPage([page.width, page.height]);
      pdfPage.drawRectangle({ x: 0, y: 0, width: page.width, height: page.height, color: rgb(1, 1, 1) });
      for (const el of page.elements) {
        if (el.type === "text") {
          const textEl = el as TextElementData;
          try { 
            const font = await pdfDoc.embedFont(textEl.bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica); 
            const fs = textEl.size || 12; 
            pdfPage.drawText(textEl.content || "", { x: textEl.x, y: Math.max(0, page.height - textEl.y - fs), size: fs, font, color: rgb(0, 0, 0) }); 
          } catch { }
        } else if (el.type === "image" && (el as ImageElementData).src) {
          const imgEl = el as ImageElementData;
          try { 
            const b64 = imgEl.src.split(",")[1]; 
            const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); 
            const img = imgEl.src.includes("image/png") ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes); 
            pdfPage.drawImage(img, { x: imgEl.x, y: page.height - imgEl.y - imgEl.height, width: imgEl.width, height: imgEl.height }); 
          } catch { }
        } else if (el.type === "table") {
          const tableEl = el as TableElementData;
          try { 
            const font = await pdfDoc.embedFont(StandardFonts.Helvetica); 
            const { rows = [], colW = 100, rowH = 24 } = tableEl; 
            for (let r = 0; r < rows.length; r++) {
              for (let c = 0; c < (rows[r] || []).length; c++) { 
                const cx = tableEl.x + c * colW;
                const cy = page.height - tableEl.y - (r + 1) * rowH; 
                const cell = rows[r][c]; 
                const cellVal = typeof cell === 'object' && cell !== null ? cell.value : cell; 
                pdfPage.drawRectangle({ x: cx, y: cy, width: colW, height: rowH, borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 0.5, color: r === 0 ? rgb(0.88, 0.88, 0.95) : rgb(1, 1, 1) }); 
                pdfPage.drawText(String(cellVal || ""), { x: cx + 4, y: cy + 6, size: 9, font, color: rgb(0, 0, 0) }); 
              }
            } 
          } catch { }
        }
      }
    }
    const pdfBytes = await pdfDoc.save();
    return new File([pdfBytes as any], currentDoc.name || "document.pdf", { type: "application/pdf" });

  } else if (currentDoc.type === "csv" || currentDoc.type === "xlsx" || currentDoc.type === "xls") {
    const allRows: any[] = [];
    for (const page of currentDoc.pages) {
      for (const el of page.elements) {
        if (el.type === "table" && (el as TableElementData).rows) {
          const plainRows = (el as TableElementData).rows.map(row => row.map(cell => typeof cell === 'object' && cell !== null ? cell.value : cell));
          allRows.push(...plainRows);
        }
      }
    }

    if (allRows.length > 0) {
      const XLSX = await import("xlsx");
      const worksheet = XLSX.utils.aoa_to_sheet(allRows);
      if (currentDoc.type === "csv") {
        const csvStr = XLSX.utils.sheet_to_csv(worksheet);
        return new File([csvStr], currentDoc.name || "edited.csv", { type: "text/csv" });
      } else {
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
        const buf = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
        return new File([buf], currentDoc.name || "edited.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      }
    } else {
      return new File([""], currentDoc.name || "edited.csv", { type: currentDoc.type === "csv" ? "text/csv" : "text/plain" });
    }

  } else if (currentDoc.type === "image") {
    const imgEl = currentDoc.pages.flatMap(p => p.elements).find(e => e.type === "image" && (e as ImageElementData).src) as ImageElementData;
    if (imgEl && imgEl.src && imgEl.src.startsWith("data:")) {
      const matches = imgEl.src.match(/^data:([^;]+);base64,(.+)$/);
      if (matches) {
        const mimeType = matches[1];
        const b64Data = matches[2];
        const bytes = Uint8Array.from(atob(b64Data), c => c.charCodeAt(0));
        return new File([bytes as any], currentDoc.name || "edited.png", { type: mimeType });
      }
    }
    return new File([""], currentDoc.name || "edited.png", { type: "image/png" });

  } else {
    const textChunks = currentDoc.pages.flatMap(p => p.elements.map(e => {
      if (e.type === "text") return (e as TextElementData).content || "";
      if (e.type === "table" && (e as TableElementData).rows) {
        return (e as TableElementData).rows.map(row => row.map(cell => typeof cell === 'object' && cell !== null ? cell.value : cell).join("\t")).join("\n");
      }
      return "";
    }).filter(Boolean));
    const text = textChunks.join("\n\n");
    return new File([text], currentDoc.name || "edited.txt", { type: "text/plain" });
  }
}
