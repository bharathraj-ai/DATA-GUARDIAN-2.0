'use client';

import {
    useState, useEffect, useRef, useCallback, useMemo,
    forwardRef, useImperativeHandle,
} from 'react';

// ============================================
// Types
// ============================================
type ToolType = 'select' | 'text' | 'highlight' | 'draw' | 'comment';
interface Point { x: number; y: number }

interface Annotation {
    id: string;
    type: 'text' | 'highlight' | 'draw' | 'comment';
    page: number;
    x: number; y: number;       // % of page
    width: number; height: number; // % of page
    content: string;
    color: string;
    fontSize: number;
    points: Point[];
    opacity: number;
}

interface HistoryEntry {
    action: 'add' | 'remove' | 'modify';
    annotation: Annotation;
    previous?: Annotation;
}

interface PdfViewerProps {
    content: string; // base64 data URL
    onChange?: (hasChanges: boolean) => void;
}

export interface PdfViewerRef {
    getModifiedPdf: () => Promise<string>;
}

// ============================================
// Helpers
// ============================================
const uid = () => Math.random().toString(36).slice(2, 10);

function hexToRgb01(hex: string): [number, number, number] {
    const h = hex.replace('#', '');
    return [
        parseInt(h.slice(0, 2), 16) / 255,
        parseInt(h.slice(2, 4), 16) / 255,
        parseInt(h.slice(4, 6), 16) / 255,
    ];
}

function base64ToBytes(dataUrl: string): Uint8Array {
    const b64 = dataUrl.split(',')[1] || dataUrl;
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
}

const COLORS = ['#FFEB3B', '#4CAF50', '#2196F3', '#F44336', '#FF9800', '#E91E63', '#9C27B0', '#FFFFFF', '#000000'];
const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

// ============================================
// Component
// ============================================
const PdfViewer = forwardRef<PdfViewerRef, PdfViewerProps>(function PdfViewer({ content, onChange }, ref) {
    // ---- State ----
    const [totalPages, setTotalPages] = useState(0);
    const [currentPage, setCurrentPage] = useState(1);
    const [zoom, setZoom] = useState(1.0);
    const [tool, setTool] = useState<ToolType>('select');
    const [color, setColor] = useState('#FFEB3B');
    const [annotations, setAnnotations] = useState<Annotation[]>([]);
    const [undoStack, setUndoStack] = useState<HistoryEntry[]>([]);
    const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [drawing, setDrawing] = useState(false);
    const [drawPts, setDrawPts] = useState<Point[]>([]);
    const [hlStart, setHlStart] = useState<Point | null>(null);
    const [hlRect, setHlRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
    const [editingTextId, setEditingTextId] = useState<string | null>(null);
    const [commentInput, setCommentInput] = useState<{ page: number; x: number; y: number } | null>(null);
    const [commentText, setCommentText] = useState('');
    const [showColors, setShowColors] = useState(false);
    const [pageInput, setPageInput] = useState('');

    // ---- Refs ----
    const pdfDocRef = useRef<any>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const pageWrappers = useRef<Map<number, HTMLDivElement>>(new Map());
    const canvases = useRef<Map<number, HTMLCanvasElement>>(new Map());
    const rendered = useRef<Set<number>>(new Set());
    const dims = useRef({ width: 612, height: 792 }); // US Letter default
    const rawBytes = useRef<Uint8Array | null>(null);
    const drawPageRef = useRef(0);
    const hlPageRef = useRef(0);

    // ---- Parse PDF bytes ----
    const pdfData = useMemo(() => {
        try { return base64ToBytes(content); }
        catch { return null; }
    }, [content]);

    // ---- Load PDF ----
    useEffect(() => {
        if (!pdfData) return;
        rawBytes.current = pdfData;
        let dead = false;

        (async () => {
            try {
                // Use require() to bypass Turbopack's ESM async loader which
                // causes "module factory not available" errors during HMR.
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const pdfjs = require('pdfjs-dist') as typeof import('pdfjs-dist');

                // Configure worker — disable it to avoid ArrayBuffer detach issues
                pdfjs.GlobalWorkerOptions.workerSrc = '';

                // Deep-copy the buffer so each Strict Mode mount gets
                // its own independent ArrayBuffer.
                const copy = new Uint8Array(pdfData.length);
                copy.set(pdfData);

                const doc = await pdfjs.getDocument({
                    data: copy,
                    isEvalSupported: false,
                } as any).promise;

                if (dead) { doc.destroy(); return; }
                pdfDocRef.current = doc;
                setTotalPages(doc.numPages);

                const p1 = await doc.getPage(1);
                const vp = p1.getViewport({ scale: 1 });
                dims.current = { width: vp.width, height: vp.height };
                setIsLoading(false);
            } catch (err: any) {
                if (dead) return;
                console.error('PDF load error:', err);
                setLoadError('Failed to load PDF');
                setIsLoading(false);
            }
        })();

        return () => {
            dead = true;
            if (pdfDocRef.current) {
                try { pdfDocRef.current.destroy(); } catch { }
                pdfDocRef.current = null;
            }
        };
    }, [pdfData]);

    // ---- Render page ----
    const renderPage = useCallback(async (pageNum: number) => {
        if (!pdfDocRef.current || rendered.current.has(pageNum)) return;
        const canvas = canvases.current.get(pageNum);
        if (!canvas) return;

        rendered.current.add(pageNum);
        try {
            const page = await pdfDocRef.current.getPage(pageNum);
            const dpr = window.devicePixelRatio || 1;
            const vp = page.getViewport({ scale: zoom * dpr });
            canvas.width = vp.width;
            canvas.height = vp.height;
            const ctx = canvas.getContext('2d');
            if (ctx) await page.render({ canvasContext: ctx, viewport: vp }).promise;
        } catch {
            rendered.current.delete(pageNum);
        }
    }, [zoom]);

    // ---- Virtualization ----
    useEffect(() => {
        if (totalPages === 0 || !scrollRef.current) return;
        rendered.current.clear();

        const obs = new IntersectionObserver(
            (entries) => {
                const vis: number[] = [];
                entries.forEach(e => {
                    const p = parseInt(e.target.getAttribute('data-page') || '0');
                    if (p > 0 && e.isIntersecting) { renderPage(p); vis.push(p); }
                });
                if (vis.length > 0) setCurrentPage(Math.min(...vis));
            },
            { root: scrollRef.current, rootMargin: '400px', threshold: 0.05 }
        );

        // Small delay to let refs populate
        const t = setTimeout(() => {
            pageWrappers.current.forEach(el => obs.observe(el));
        }, 100);

        return () => { clearTimeout(t); obs.disconnect(); };
    }, [totalPages, zoom, renderPage]);

    // ---- Annotation CRUD ----
    const addAnn = useCallback((a: Annotation) => {
        setAnnotations(p => [...p, a]);
        setUndoStack(p => [...p, { action: 'add', annotation: a }]);
        setRedoStack([]);
        onChange?.(true);
    }, [onChange]);

    const removeAnn = useCallback((id: string) => {
        setAnnotations(prev => {
            const found = prev.find(a => a.id === id);
            if (found) {
                setUndoStack(s => [...s, { action: 'remove', annotation: found }]);
                setRedoStack([]);
                onChange?.(true);
            }
            return prev.filter(a => a.id !== id);
        });
    }, [onChange]);

    const updateAnnContent = useCallback((id: string, newContent: string) => {
        setAnnotations(prev => prev.map(a => a.id === id ? { ...a, content: newContent } : a));
        onChange?.(true);
    }, [onChange]);

    // ---- Undo / Redo ----
    const undo = useCallback(() => {
        setUndoStack(prev => {
            if (!prev.length) return prev;
            const entry = prev[prev.length - 1];
            if (entry.action === 'add') setAnnotations(a => a.filter(x => x.id !== entry.annotation.id));
            else if (entry.action === 'remove') setAnnotations(a => [...a, entry.annotation]);
            setRedoStack(r => [...r, entry]);
            return prev.slice(0, -1);
        });
    }, []);

    const redo = useCallback(() => {
        setRedoStack(prev => {
            if (!prev.length) return prev;
            const entry = prev[prev.length - 1];
            if (entry.action === 'add') setAnnotations(a => [...a, entry.annotation]);
            else if (entry.action === 'remove') setAnnotations(a => a.filter(x => x.id !== entry.annotation.id));
            setUndoStack(u => [...u, entry]);
            return prev.slice(0, -1);
        });
    }, []);

    // ---- Mouse handlers ----
    const onLayerDown = useCallback((e: React.MouseEvent, pg: number) => {
        if (tool === 'select') return;
        const r = e.currentTarget.getBoundingClientRect();
        const x = ((e.clientX - r.left) / r.width) * 100;
        const y = ((e.clientY - r.top) / r.height) * 100;

        if (tool === 'highlight') { setHlStart({ x, y }); setHlRect({ x, y, w: 0, h: 0 }); hlPageRef.current = pg; }
        else if (tool === 'draw') { setDrawing(true); setDrawPts([{ x, y }]); drawPageRef.current = pg; }
        else if (tool === 'text') {
            const id = uid();
            addAnn({ id, type: 'text', page: pg, x, y, width: 20, height: 4, content: 'Text', color, fontSize: 14, points: [], opacity: 1 });
            setEditingTextId(id);
        }
        else if (tool === 'comment') { setCommentInput({ page: pg, x, y }); setCommentText(''); }
    }, [tool, color, addAnn]);

    const onLayerMove = useCallback((e: React.MouseEvent) => {
        const r = e.currentTarget.getBoundingClientRect();
        const x = ((e.clientX - r.left) / r.width) * 100;
        const y = ((e.clientY - r.top) / r.height) * 100;

        if (tool === 'highlight' && hlStart) {
            setHlRect({ x: Math.min(hlStart.x, x), y: Math.min(hlStart.y, y), w: Math.abs(x - hlStart.x), h: Math.abs(y - hlStart.y) });
        } else if (tool === 'draw' && drawing) {
            setDrawPts(p => [...p, { x, y }]);
        }
    }, [tool, hlStart, drawing]);

    const onLayerUp = useCallback((_e: React.MouseEvent, pg: number) => {
        if (tool === 'highlight' && hlRect && hlRect.w > 0.5 && hlRect.h > 0.5) {
            addAnn({ id: uid(), type: 'highlight', page: pg, x: hlRect.x, y: hlRect.y, width: hlRect.w, height: hlRect.h, content: '', color, fontSize: 14, points: [], opacity: 0.35 });
        }
        if (tool === 'draw' && drawing && drawPts.length > 1) {
            const xs = drawPts.map(p => p.x), ys = drawPts.map(p => p.y);
            addAnn({ id: uid(), type: 'draw', page: pg, x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys), content: '', color, fontSize: 2, points: drawPts, opacity: 1 });
        }
        setHlStart(null); setHlRect(null); setDrawing(false); setDrawPts([]);
    }, [tool, hlRect, drawing, drawPts, color, addAnn]);

    // ---- Keyboard shortcuts ----
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'c') { e.preventDefault(); return; } // Block copy
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
            if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
            if (e.key === 'Delete' && selectedId) { removeAnn(selectedId); setSelectedId(null); }
            if (e.key === 'Escape') { setTool('select'); setSelectedId(null); setEditingTextId(null); setCommentInput(null); }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [undo, redo, selectedId, removeAnn]);

    // ---- Save: embed annotations with pdf-lib ----
    useImperativeHandle(ref, () => ({
        getModifiedPdf: async () => {
            if (!rawBytes.current || annotations.length === 0) return content;
            const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');
            const doc = await PDFDocument.load(rawBytes.current);
            const font = await doc.embedFont(StandardFonts.Helvetica);

            for (const a of annotations) {
                const pg = doc.getPage(a.page - 1);
                const { width: pw, height: ph } = pg.getSize();
                const ax = (a.x / 100) * pw, ay = ph - (a.y / 100) * ph;

                if (a.type === 'text' && a.content) {
                    pg.drawText(a.content, { x: ax, y: ay - a.fontSize, size: a.fontSize, font, color: rgb(...hexToRgb01(a.color)) });
                } else if (a.type === 'highlight') {
                    const w = (a.width / 100) * pw, h = (a.height / 100) * ph;
                    pg.drawRectangle({ x: ax, y: ay - h, width: w, height: h, color: rgb(...hexToRgb01(a.color)), opacity: a.opacity });
                } else if (a.type === 'draw' && a.points.length > 1) {
                    for (let i = 1; i < a.points.length; i++) {
                        const p0 = a.points[i - 1], p1 = a.points[i];
                        pg.drawLine({
                            start: { x: (p0.x / 100) * pw, y: ph - (p0.y / 100) * ph },
                            end: { x: (p1.x / 100) * pw, y: ph - (p1.y / 100) * ph },
                            thickness: a.fontSize, color: rgb(...hexToRgb01(a.color)),
                        });
                    }
                } else if (a.type === 'comment' && a.content) {
                    pg.drawRectangle({ x: ax, y: ay - 20, width: Math.max(a.content.length * 6, 60), height: 18, color: rgb(1, 0.96, 0.8), opacity: 0.9 });
                    pg.drawText(a.content, { x: ax + 3, y: ay - 16, size: 10, font, color: rgb(0, 0, 0) });
                }
            }

            const bytes = await doc.save();
            let bin = '';
            for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
            return `data:application/pdf;base64,${btoa(bin)}`;
        },
    }), [annotations, content]);

    // ---- Navigation ----
    const goTo = useCallback((p: number) => {
        const c = Math.max(1, Math.min(p, totalPages));
        pageWrappers.current.get(c)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setCurrentPage(c);
    }, [totalPages]);

    const zoomIn = () => { const i = ZOOM_STEPS.findIndex(z => z >= zoom); setZoom(ZOOM_STEPS[Math.min(i + 1, ZOOM_STEPS.length - 1)]); rendered.current.clear(); };
    const zoomOut = () => { const i = ZOOM_STEPS.findIndex(z => z >= zoom); setZoom(ZOOM_STEPS[Math.max(i - 1, 0)]); rendered.current.clear(); };

    // ---- Cursor ----
    const cursor = tool === 'select' ? 'default' : tool === 'text' ? 'text' : 'crosshair';

    // ---- Render ----
    if (isLoading) return (<div className="pdf-editor-loading"><div className="loading-spinner" /><p>Loading PDF...</p></div>);
    if (loadError) return (<div className="pdf-editor-loading"><p style={{ color: '#ef4444' }}>{loadError}</p></div>);

    const pageW = dims.current.width * zoom;
    const pageH = dims.current.height * zoom;

    return (
        <div className="pdf-editor">
            {/* ===== TOOLBAR ===== */}
            <div className="pdf-editor-toolbar">
                <div className="pdf-toolbar-group">
                    {([['select', '🖱️', 'Select'], ['text', '✏️', 'Text'], ['highlight', '🖍️', 'Highlight'], ['draw', '🖊️', 'Draw'], ['comment', '💬', 'Comment']] as [ToolType, string, string][]).map(([t, icon, label]) => (
                        <button key={t} className={`pdf-tool-btn ${tool === t ? 'active' : ''}`} onClick={() => setTool(t)} title={label}>
                            {icon} <span className="pdf-tool-label">{label}</span>
                        </button>
                    ))}
                </div>

                <div className="pdf-toolbar-divider" />

                {/* Color */}
                <div className="pdf-toolbar-group" style={{ position: 'relative' }}>
                    <button className="pdf-tool-btn" onClick={() => setShowColors(!showColors)} title="Color">
                        <span style={{ display: 'inline-block', width: 16, height: 16, borderRadius: 4, background: color, border: '2px solid rgba(255,255,255,0.3)' }} />
                    </button>
                    {showColors && (
                        <div className="pdf-color-palette">
                            {COLORS.map(c => (
                                <button key={c} className={`pdf-color-swatch ${color === c ? 'active' : ''}`} style={{ background: c }}
                                    onClick={() => { setColor(c); setShowColors(false); }} />
                            ))}
                        </div>
                    )}
                </div>

                <div className="pdf-toolbar-divider" />

                {/* Undo / Redo */}
                <div className="pdf-toolbar-group">
                    <button className="pdf-tool-btn" onClick={undo} disabled={undoStack.length === 0} title="Undo (Ctrl+Z)">↩️</button>
                    <button className="pdf-tool-btn" onClick={redo} disabled={redoStack.length === 0} title="Redo (Ctrl+Y)">↪️</button>
                </div>

                <div className="pdf-toolbar-divider" />

                {/* Zoom */}
                <div className="pdf-toolbar-group">
                    <button className="pdf-tool-btn" onClick={zoomOut} title="Zoom Out">➖</button>
                    <span className="pdf-zoom-label">{Math.round(zoom * 100)}%</span>
                    <button className="pdf-tool-btn" onClick={zoomIn} title="Zoom In">➕</button>
                </div>

                <div className="pdf-toolbar-divider" />

                {/* Page Nav */}
                <div className="pdf-toolbar-group">
                    <button className="pdf-tool-btn" onClick={() => goTo(currentPage - 1)} disabled={currentPage <= 1}>◀</button>
                    <div className="pdf-page-indicator">
                        <input className="pdf-page-input" value={pageInput || currentPage} type="text"
                            onChange={e => setPageInput(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') { goTo(parseInt(pageInput) || 1); setPageInput(''); } }}
                            onBlur={() => setPageInput('')}
                        />
                        <span className="pdf-page-total">/ {totalPages}</span>
                    </div>
                    <button className="pdf-tool-btn" onClick={() => goTo(currentPage + 1)} disabled={currentPage >= totalPages}>▶</button>
                </div>

                {/* Delete selected */}
                {selectedId && (
                    <>
                        <div className="pdf-toolbar-divider" />
                        <button className="pdf-tool-btn danger" onClick={() => { removeAnn(selectedId); setSelectedId(null); }} title="Delete">🗑️</button>
                    </>
                )}
            </div>

            {/* ===== PAGES ===== */}
            <div className="pdf-editor-pages" ref={scrollRef} style={{ cursor }}>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(pg => (
                    <div key={pg} className="pdf-page-wrapper" data-page={pg}
                        ref={el => { if (el) pageWrappers.current.set(pg, el); }}
                        style={{ width: pageW, height: pageH }}
                    >
                        <canvas
                            ref={el => { if (el) canvases.current.set(pg, el); }}
                            className="pdf-page-canvas"
                            style={{ width: pageW, height: pageH }}
                        />

                        {/* Annotation overlay */}
                        <div className="pdf-annotation-layer"
                            onMouseDown={e => onLayerDown(e, pg)}
                            onMouseMove={onLayerMove}
                            onMouseUp={e => onLayerUp(e, pg)}
                        >
                            {/* Active highlight preview */}
                            {hlRect && hlPageRef.current === pg && (
                                <div className="pdf-hl-preview" style={{ left: `${hlRect.x}%`, top: `${hlRect.y}%`, width: `${hlRect.w}%`, height: `${hlRect.h}%`, background: color, opacity: 0.3 }} />
                            )}

                            {/* Active drawing preview */}
                            {drawing && drawPageRef.current === pg && drawPts.length > 1 && (
                                <svg className="pdf-draw-svg">
                                    <polyline
                                        points={drawPts.map(p => `${p.x}%,${p.y}%`).join(' ')}
                                        fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
                                    />
                                </svg>
                            )}

                            {/* Rendered annotations */}
                            {annotations.filter(a => a.page === pg).map(a => {
                                if (a.type === 'highlight') return (
                                    <div key={a.id} className={`pdf-ann pdf-ann-hl ${selectedId === a.id ? 'selected' : ''}`}
                                        style={{ left: `${a.x}%`, top: `${a.y}%`, width: `${a.width}%`, height: `${a.height}%`, background: a.color, opacity: a.opacity }}
                                        onClick={e => { e.stopPropagation(); setSelectedId(a.id); setTool('select'); }}
                                    />
                                );
                                if (a.type === 'text') return (
                                    <div key={a.id} className={`pdf-ann pdf-ann-text ${selectedId === a.id ? 'selected' : ''}`}
                                        style={{ left: `${a.x}%`, top: `${a.y}%`, color: a.color, fontSize: a.fontSize * zoom }}
                                        onClick={e => { e.stopPropagation(); setSelectedId(a.id); setTool('select'); }}
                                        onDoubleClick={() => setEditingTextId(a.id)}
                                    >
                                        {editingTextId === a.id ? (
                                            <input className="pdf-text-input" autoFocus value={a.content}
                                                onChange={e => updateAnnContent(a.id, e.target.value)}
                                                onBlur={() => setEditingTextId(null)}
                                                onKeyDown={e => { if (e.key === 'Enter') setEditingTextId(null); }}
                                                style={{ color: a.color, fontSize: a.fontSize * zoom }}
                                            />
                                        ) : a.content}
                                    </div>
                                );
                                if (a.type === 'draw' && a.points.length > 1) return (
                                    <svg key={a.id} className={`pdf-ann pdf-ann-draw ${selectedId === a.id ? 'selected' : ''}`}
                                        onClick={e => { e.stopPropagation(); setSelectedId(a.id); setTool('select'); }}
                                    >
                                        <polyline
                                            points={a.points.map(p => `${p.x}%,${p.y}%`).join(' ')}
                                            fill="none" stroke={a.color} strokeWidth={a.fontSize} strokeLinecap="round" strokeLinejoin="round"
                                        />
                                    </svg>
                                );
                                if (a.type === 'comment') return (
                                    <div key={a.id} className={`pdf-ann pdf-ann-comment ${selectedId === a.id ? 'selected' : ''}`}
                                        style={{ left: `${a.x}%`, top: `${a.y}%` }}
                                        onClick={e => { e.stopPropagation(); setSelectedId(a.id); setTool('select'); }}
                                        title={a.content}
                                    >
                                        💬
                                        {selectedId === a.id && (
                                            <div className="pdf-comment-popup">{a.content}</div>
                                        )}
                                    </div>
                                );
                                return null;
                            })}
                        </div>

                        {/* Page number label */}
                        <div className="pdf-page-label">Page {pg}</div>
                    </div>
                ))}
            </div>

            {/* Comment input dialog */}
            {commentInput && (
                <div className="pdf-comment-dialog">
                    <div className="pdf-comment-dialog-inner">
                        <h4>Add Comment</h4>
                        <textarea className="pdf-comment-textarea" autoFocus value={commentText}
                            onChange={e => setCommentText(e.target.value)}
                            placeholder="Enter your comment..."
                        />
                        <div className="pdf-comment-actions">
                            <button className="pdf-tool-btn" onClick={() => setCommentInput(null)}>Cancel</button>
                            <button className="pdf-tool-btn active" onClick={() => {
                                if (commentText.trim()) {
                                    addAnn({ id: uid(), type: 'comment', page: commentInput.page, x: commentInput.x, y: commentInput.y, width: 3, height: 3, content: commentText.trim(), color: '#FFEB3B', fontSize: 12, points: [], opacity: 1 });
                                }
                                setCommentInput(null); setCommentText('');
                            }}>Add</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
});

export default PdfViewer;
