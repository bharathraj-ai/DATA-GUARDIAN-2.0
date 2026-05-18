/**
 * Document Structure Inference Engine
 * 
 * Converts raw PDF text lines into semantically classified blocks
 * (headings, paragraphs, lists, page breaks) by analyzing font size,
 * position gaps, and text patterns.
 *
 * @module pdf/inferStructure
 */

/* ─── Tiny unique ID generator ──────────────────────────────────────── */
export const uid = () => Math.random().toString(36).slice(2, 9);

/* ─── Pattern matchers ──────────────────────────────────────────────── */
const LIST_RE = /^(?:\d+[\.)\:]|[a-zA-Z][\.)]|[ivxlcdm]+[\.)]|[•\-\*\–\—]|\(?[a-zA-Z]\)|\(?\d+\))\s/i;
const SECTION_RE = /^(?:PART\s+[A-Z0-9]|SECTION\s+[A-Z0-9]|CHAPTER\s+[0-9])/i;

/**
 * Classify a single text line by its visual properties.
 *
 * @param {{text: string, fontSize: number, bold: boolean}} line
 * @param {number} medianSize - Median font size across all lines
 * @returns {'h1'|'h2'|'h3'|'paragraph'|'list'}
 */
function classifyLine(line, medianSize) {
  const t = (line.text || "").trim();
  if (!t) return "paragraph";
  // Section headers like "PART A(1 MARK)"
  if (SECTION_RE.test(t)) return "h2";
  // Large font → heading
  if (line.fontSize >= medianSize * 1.8) return "h1";
  if (line.fontSize >= medianSize * 1.4) return "h2";
  if (line.fontSize >= medianSize * 1.15 && line.bold) return "h3";
  // All-caps short lines are likely headings
  if (t === t.toUpperCase() && t.length < 60 && t.length > 2 && /[A-Z]/.test(t)) return "h3";
  // List patterns: 1. / a. / a) / (a) / • / - / i. / ii.
  if (LIST_RE.test(t)) return "list";
  return "paragraph";
}

/**
 * Infer document structure from parsed PDF data.
 * Groups raw text lines into semantic blocks with type classification.
 *
 * @param {{pages: Array<{width: number, height: number, lines: Array}>}} parsed
 * @returns {Array<{id: string, type: string, text?: string, fontSize?: number, bold?: boolean, italic?: boolean, pageWidth?: number}>}
 */
export function inferStructure(parsed) {
  const allLines = parsed.pages.flatMap(p => p.lines);
  if (!allLines.length) return [];

  const sizes = allLines.map(l => l.fontSize);
  const medianSize = [...sizes].sort((a, b) => a - b)[Math.floor(sizes.length / 2)];

  const blocks = [];

  for (const page of parsed.pages) {
    let accum = [];  // lines being accumulated for current block
    let accType = null;

    const flush = () => {
      if (!accum.length) return;
      const sample = accum[0];
      const text = accum.map(l => l.text).join(" ");
      blocks.push({
        id: uid(),
        type: accType || "paragraph",
        text,
        fontSize: sample.fontSize,
        bold: sample.bold || (accType || "").startsWith("h"),
        italic: sample.italic,
        pageWidth: page.width,
      });
      accum = [];
      accType = null;
    };

    let lastY = null;
    for (const line of page.lines) {
      const lineType = classifyLine(line, medianSize);
      const gap = lastY !== null ? Math.abs(line.y - lastY) : 0;
      const bigGap = gap > line.fontSize * 1.6;

      // Always flush before: a new list item, a heading, a section header, or a big gap
      if (
        (lineType === "list") ||
        (lineType.startsWith("h")) ||
        bigGap
      ) {
        flush();
      }

      // If accumulating a list and this line is NOT a list item, it's a continuation (sub-line)
      // unless there's a big gap
      if (accType === "list" && lineType === "paragraph" && !bigGap) {
        // continuation of the same list item text
        accum.push(line);
      } else {
        // If type changed from what we were accumulating, flush first
        if (accType && accType !== lineType && accum.length) {
          flush();
        }
        accum.push(line);
        accType = lineType;
      }

      lastY = line.y;
    }
    flush();
    blocks.push({ id: uid(), type: "pagebreak" });
  }

  // Remove trailing pagebreak if it's the last block
  if (blocks.length && blocks[blocks.length - 1].type === "pagebreak") {
    blocks.pop();
  }

  return blocks;
}

/**
 * Count block types for statistics display.
 * 
 * @param {Array<{type: string}>} blocks
 * @returns {{h1: number, h2: number, h3: number, paragraph: number, list: number, pagebreak: number}}
 */
export function countBlockTypes(blocks) {
  const c = { h1: 0, h2: 0, h3: 0, paragraph: 0, list: 0, pagebreak: 0 };
  if (!blocks || !Array.isArray(blocks)) return c;
  blocks.forEach(b => { if (c[b.type] !== undefined) c[b.type]++; });
  return c;
}
