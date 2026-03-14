/**
 * Data Guardian 2.0 — Internal Document Model
 *
 * This is the canonical representation of any document opened inside the
 * platform.  Raw file bytes are decrypted once, parsed into this model,
 * and then all editing / collaboration operations work against this model.
 * Snapshots are re-serialised and re-encrypted for storage.
 */

// ─────────────────────────────────────────────
// Primitive geometry
// ─────────────────────────────────────────────
export interface Point {
  x: number; // % of page width
  y: number; // % of page height
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ─────────────────────────────────────────────
// Annotation types (stored separately from the doc)
// ─────────────────────────────────────────────
export type AnnotationType =
  | 'highlight'
  | 'text'
  | 'draw'
  | 'comment'
  | 'signature'
  | 'shape';

export interface DocumentAnnotation {
  id: string;
  type: AnnotationType;
  pageNumber: number;
  rect: Rect;           // bounding box in % coords
  content: string;      // text, comment body, etc.
  color: string;        // hex
  fontSize: number;
  opacity: number;
  points: Point[];      // for draw / polygon
  authorId?: string;
  authorName?: string;
  createdAt: string;    // ISO
  updatedAt: string;    // ISO
  parentId?: string;    // for threaded comments
  resolved?: boolean;
}

// ─────────────────────────────────────────────
// Block (paragraph / heading / table-cell …)
// ─────────────────────────────────────────────
export type BlockType =
  | 'paragraph'
  | 'heading1' | 'heading2' | 'heading3'
  | 'listItem'
  | 'tableRow'
  | 'image'
  | 'code';

export interface DocumentBlock {
  id: string;
  type: BlockType;
  content: string;  // plain text or HTML depending on editor
  attrs: Record<string, unknown>;
}

// ─────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────
export interface DocumentPage {
  pageNumber: number;     // 1-indexed
  width: number;          // pt
  height: number;         // pt
  blocks: DocumentBlock[];
  annotations: string[];  // annotation IDs (cross-ref to DocumentAnnotation)
}

// ─────────────────────────────────────────────
// Root document model
// ─────────────────────────────────────────────
export type DocumentFileType = 'pdf' | 'docx' | 'csv' | 'txt' | 'image';

export interface InternalDocument {
  id: string;           // same as UserFile.id
  fileId: string;       // UserFile.id  (alias kept for clarity)
  fileType: DocumentFileType;
  version: number;      // incremented on every save
  title: string;
  pages: DocumentPage[];
  createdAt: string;
  updatedAt: string;
}

// ─────────────────────────────────────────────
// Operations (used by the collaboration engine)
// ─────────────────────────────────────────────
export type OperationType =
  | 'insert'   // insert text/block
  | 'delete'   // delete text/block range
  | 'update'   // update block attrs / content
  | 'annotate' // add annotation
  | 'deleteAnnotation'
  | 'updateAnnotation'
  | 'cursor'   // cursor position broadcast (not persisted)
  | 'comment'  // threaded comment op (add/reply/resolve)
  | 'pageReplace'; // single page replacement

export interface DocumentOperation {
  id: string;           // unique op ID for ack/dedup
  fileId: string;
  sessionId: string;    // who sent it
  authorId?: string;
  type: OperationType;
  version: number;      // document version this op applies to
  timestamp: string;    // ISO
  payload: Record<string, unknown>; // op-specific data
}

// ─────────────────────────────────────────────
// Collaboration session / cursor
// ─────────────────────────────────────────────
export interface CursorPosition {
  sessionId: string;
  userId?: string;
  displayName: string;
  color: string;
  page: number;
  x: number; // % of page
  y: number; // % of page
  updatedAt: string;
}

// ─────────────────────────────────────────────
// Agent event payload
// ─────────────────────────────────────────────
export type AgentSeverity = 'info' | 'warning' | 'error';

export interface AgentEvent {
  id: string;
  agentName: string;
  severity: AgentSeverity;
  title: string;
  message: string;
  suggestion?: string;
  relatedOpId?: string;
  timestamp: string;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
export function createEmptyDocument(
  fileId: string,
  fileType: DocumentFileType,
  title: string,
): InternalDocument {
  const now = new Date().toISOString();
  return {
    id: fileId,
    fileId,
    fileType,
    version: 1,
    title,
    pages: [
      {
        pageNumber: 1,
        width: 612,
        height: 792,
        blocks: [],
        annotations: [],
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
}

export function applyOperation(
  doc: InternalDocument,
  op: DocumentOperation,
): InternalDocument {
  const now = new Date().toISOString();
  switch (op.type) {
    case 'insert': {
      const { pageNumber, block } = op.payload as {
        pageNumber: number;
        block: DocumentBlock;
      };
      const pages = doc.pages.map((p) => {
        if (p.pageNumber !== pageNumber) return p;
        return { ...p, blocks: [...p.blocks, block] };
      });
      return { ...doc, pages, version: doc.version + 1, updatedAt: now };
    }

    case 'delete': {
      const { pageNumber, blockId } = op.payload as {
        pageNumber: number;
        blockId: string;
      };
      const pages = doc.pages.map((p) => {
        if (p.pageNumber !== pageNumber) return p;
        return { ...p, blocks: p.blocks.filter((b) => b.id !== blockId) };
      });
      return { ...doc, pages, version: doc.version + 1, updatedAt: now };
    }

    case 'update': {
      const { pageNumber, blockId, content, attrs } = op.payload as {
        pageNumber: number;
        blockId: string;
        content?: string;
        attrs?: Record<string, unknown>;
      };
      const pages = doc.pages.map((p) => {
        if (p.pageNumber !== pageNumber) return p;
        return {
          ...p,
          blocks: p.blocks.map((b) => {
            if (b.id !== blockId) return b;
            return {
              ...b,
              content: content ?? b.content,
              attrs: { ...b.attrs, ...attrs },
            };
          }),
        };
      });
      return { ...doc, pages, version: doc.version + 1, updatedAt: now };
    }

    case 'annotate': {
      const { pageNumber, annotationId } = op.payload as {
        pageNumber: number;
        annotationId: string;
      };
      const pages = doc.pages.map((p) => {
        if (p.pageNumber !== pageNumber) return p;
        return {
          ...p,
          annotations: [...new Set([...p.annotations, annotationId])],
        };
      });
      return { ...doc, pages, version: doc.version + 1, updatedAt: now };
    }

    case 'deleteAnnotation': {
      const { pageNumber, annotationId } = op.payload as {
        pageNumber: number;
        annotationId: string;
      };
      const pages = doc.pages.map((p) => {
        if (p.pageNumber !== pageNumber) return p;
        return {
          ...p,
          annotations: p.annotations.filter((a) => a !== annotationId),
        };
      });
      return { ...doc, pages, version: doc.version + 1, updatedAt: now };
    }

    // cursor and comment ops don't mutate the document
    case 'cursor':
    case 'comment':
      return doc;

    default:
      return doc;
  }
}

/**
 * Lightweight Operational Transformation:
 * Transforms op1 assuming op2 has already been applied.
 * Only text-level insert/delete are transformed; everything else passes through.
 */
export function transformOp(
  op1: DocumentOperation,
  op2: DocumentOperation,
): DocumentOperation {
  if (op1.type !== 'insert' && op1.type !== 'delete') return op1;
  if (op2.type !== 'insert' && op2.type !== 'delete') return op1;

  const p1 = op1.payload as { pageNumber: number; offset: number; text?: string };
  const p2 = op2.payload as { pageNumber: number; offset: number; text?: string; length?: number };

  // Only transform ops on the same page
  if (p1.pageNumber !== p2.pageNumber) return op1;

  let newOffset = p1.offset;

  if (op2.type === 'insert' && p2.offset <= p1.offset) {
    newOffset += (p2.text?.length ?? 0);
  }
  if (op2.type === 'delete' && p2.offset < p1.offset) {
    newOffset -= Math.min(p2.length ?? 0, p1.offset - p2.offset);
  }

  return {
    ...op1,
    payload: { ...p1, offset: Math.max(0, newOffset) },
  };
}
