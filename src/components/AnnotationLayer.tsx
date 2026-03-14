'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { DocumentAnnotation } from '@/lib/documentModel';

interface AnnotationLayerProps {
  pageNumber: number;
  annotations: DocumentAnnotation[];
  activeTool: 'select' | 'highlight' | 'text' | 'draw' | 'comment' | 'signature';
  activeColor: string;
  readOnly?: boolean;
  onAdd: (ann: DocumentAnnotation) => void;
  onUpdate: (id: string, updates: Partial<DocumentAnnotation>) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string | null) => void;
  selectedId: string | null;
}

const uid = () => Math.random().toString(36).slice(2, 10);

export default function AnnotationLayer({
  pageNumber,
  annotations,
  activeTool,
  activeColor,
  readOnly = false,
  onAdd,
  onUpdate,
  onDelete,
  onSelect,
  selectedId,
}: AnnotationLayerProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [drawPoints, setDrawPoints] = useState<{ x: number; y: number }[]>([]);
  const [hlStart, setHlStart] = useState<{ x: number; y: number } | null>(null);
  const [hlPreview, setHlPreview] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [commentPos, setCommentPos] = useState<{ x: number; y: number } | null>(null);
  const [commentText, setCommentText] = useState('');

  const pageAnns = annotations.filter((a) => a.pageNumber === pageNumber);

  const getRelPos = useCallback((e: React.MouseEvent) => {
    const r = layerRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * 100,
      y: ((e.clientY - r.top) / r.height) * 100,
    };
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (readOnly || activeTool === 'select') return;
    e.preventDefault();
    const pos = getRelPos(e);
    const now = new Date().toISOString();

    if (activeTool === 'highlight') {
      setHlStart(pos);
      setHlPreview({ x: pos.x, y: pos.y, w: 0, h: 0 });
    } else if (activeTool === 'draw') {
      setDrawing(true);
      setDrawPoints([pos]);
    } else if (activeTool === 'text') {
      onAdd({
        id: uid(), type: 'text', pageNumber, rect: { x: pos.x, y: pos.y, width: 20, height: 5 },
        content: 'Click to edit', color: activeColor, fontSize: 14, opacity: 1,
        points: [], createdAt: now, updatedAt: now,
      });
    } else if (activeTool === 'comment') {
      setCommentPos(pos);
      setCommentText('');
    } else if (activeTool === 'signature') {
      setDrawing(true);
      setDrawPoints([pos]);
    }
  }, [readOnly, activeTool, getRelPos, onAdd, activeColor, pageNumber]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (readOnly) return;
    const pos = getRelPos(e);
    if (activeTool === 'highlight' && hlStart) {
      setHlPreview({
        x: Math.min(hlStart.x, pos.x), y: Math.min(hlStart.y, pos.y),
        w: Math.abs(pos.x - hlStart.x), h: Math.abs(pos.y - hlStart.y),
      });
    } else if ((activeTool === 'draw' || activeTool === 'signature') && drawing) {
      setDrawPoints((p) => [...p, pos]);
    }
  }, [readOnly, activeTool, hlStart, drawing, getRelPos]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (readOnly) return;
    const now = new Date().toISOString();

    if (activeTool === 'highlight' && hlPreview && hlPreview.w > 1 && hlPreview.h > 0.5) {
      onAdd({
        id: uid(), type: 'highlight', pageNumber,
        rect: { x: hlPreview.x, y: hlPreview.y, width: hlPreview.w, height: hlPreview.h },
        content: '', color: activeColor, fontSize: 12, opacity: 0.35,
        points: [], createdAt: now, updatedAt: now,
      });
    }
    if ((activeTool === 'draw' || activeTool === 'signature') && drawPoints.length > 2) {
      const xs = drawPoints.map((p) => p.x), ys = drawPoints.map((p) => p.y);
      onAdd({
        id: uid(),
        type: activeTool === 'signature' ? 'signature' : 'draw',
        pageNumber,
        rect: { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) },
        content: '', color: activeColor, fontSize: activeTool === 'signature' ? 1.5 : 2,
        opacity: 1, points: drawPoints, createdAt: now, updatedAt: now,
      });
    }
    setHlStart(null); setHlPreview(null);
    setDrawing(false); setDrawPoints([]);
  }, [readOnly, activeTool, hlPreview, drawPoints, onAdd, activeColor, pageNumber]);

  const cursor = activeTool === 'select' ? 'default'
    : activeTool === 'text' ? 'text'
    : 'crosshair';

  return (
    <div
      ref={layerRef}
      style={{ position: 'absolute', inset: 0, cursor, zIndex: 10 }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* Live highlight preview */}
      {hlPreview && (
        <div style={{
          position: 'absolute',
          left: `${hlPreview.x}%`, top: `${hlPreview.y}%`,
          width: `${hlPreview.w}%`, height: `${hlPreview.h}%`,
          background: activeColor, opacity: 0.3, pointerEvents: 'none',
        }} />
      )}

      {/* Live draw preview */}
      {drawing && drawPoints.length > 1 && (
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
          <polyline
            points={drawPoints.map((p) => `${p.x}%,${p.y}%`).join(' ')}
            fill="none" stroke={activeColor} strokeWidth={2}
            strokeLinecap="round" strokeLinejoin="round"
          />
        </svg>
      )}

      {/* Rendered annotations */}
      {pageAnns.map((ann) => {
        if (ann.type === 'highlight') return (
          <div key={ann.id}
            style={{
              position: 'absolute',
              left: `${ann.rect.x}%`, top: `${ann.rect.y}%`,
              width: `${ann.rect.width}%`, height: `${ann.rect.height}%`,
              background: ann.color, opacity: ann.opacity,
              border: selectedId === ann.id ? '2px solid #6366f1' : 'none',
              cursor: 'pointer',
            }}
            onClick={(e) => { e.stopPropagation(); onSelect(ann.id); }}
          />
        );

        if (ann.type === 'text') return (
          <div key={ann.id}
            style={{
              position: 'absolute',
              left: `${ann.rect.x}%`, top: `${ann.rect.y}%`,
              color: ann.color, fontSize: ann.fontSize,
              fontFamily: 'sans-serif', whiteSpace: 'nowrap',
              cursor: 'pointer',
              outline: selectedId === ann.id ? '2px solid #6366f1' : 'none',
            }}
            onClick={(e) => { e.stopPropagation(); onSelect(ann.id); }}
            onDoubleClick={() => setEditingId(ann.id)}
          >
            {editingId === ann.id ? (
              <input autoFocus value={ann.content}
                style={{ color: ann.color, fontSize: ann.fontSize, background: 'transparent', border: '1px dashed', outline: 'none' }}
                onChange={(e) => onUpdate(ann.id, { content: e.target.value, updatedAt: new Date().toISOString() })}
                onBlur={() => setEditingId(null)}
                onKeyDown={(e) => { if (e.key === 'Enter') setEditingId(null); }}
              />
            ) : ann.content}
          </div>
        );

        if ((ann.type === 'draw' || ann.type === 'signature') && ann.points.length > 1) return (
          <svg key={ann.id}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}
            onClick={(e) => { e.stopPropagation(); onSelect(ann.id); }}
          >
            <polyline
              points={ann.points.map((p) => `${p.x}%,${p.y}%`).join(' ')}
              fill="none" stroke={ann.color} strokeWidth={ann.fontSize}
              strokeLinecap="round" strokeLinejoin="round"
              style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
            />
          </svg>
        );

        if (ann.type === 'comment') return (
          <div key={ann.id}
            style={{ position: 'absolute', left: `${ann.rect.x}%`, top: `${ann.rect.y}%`, fontSize: 20, cursor: 'pointer' }}
            onClick={(e) => { e.stopPropagation(); onSelect(ann.id); }}
            title={ann.content}
          >
            💬
            {selectedId === ann.id && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, minWidth: 180,
                background: 'var(--card-bg, #1e293b)', border: '1px solid var(--border, #334155)',
                borderRadius: 8, padding: '8px 12px', fontSize: 12, color: 'var(--foreground, #e2e8f0)',
                zIndex: 20, boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
              }}>
                {ann.content}
              </div>
            )}
          </div>
        );

        return null;
      })}

      {/* Comment input dialog */}
      {commentPos && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={() => setCommentPos(null)}>
          <div style={{
            background: 'var(--card-bg, #1e293b)', border: '1px solid var(--border, #334155)',
            borderRadius: 12, padding: 24, minWidth: 320, boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          }} onClick={(e) => e.stopPropagation()}>
            <h4 style={{ margin: '0 0 12px', color: 'var(--foreground, #e2e8f0)' }}>Add Comment</h4>
            <textarea
              autoFocus value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="Enter your comment..."
              rows={3}
              style={{
                width: '100%', padding: '8px 12px', borderRadius: 8, resize: 'vertical',
                background: 'var(--background, #0f172a)', color: 'var(--foreground, #e2e8f0)',
                border: '1px solid var(--border, #334155)', outline: 'none', fontSize: 14,
              }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
              <button onClick={() => setCommentPos(null)}
                style={{ padding: '6px 16px', borderRadius: 6, border: '1px solid var(--border, #334155)', background: 'transparent', color: 'var(--foreground, #e2e8f0)', cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={() => {
                if (commentText.trim()) {
                  const now = new Date().toISOString();
                  onAdd({
                    id: uid(), type: 'comment', pageNumber,
                    rect: { x: commentPos.x, y: commentPos.y, width: 3, height: 3 },
                    content: commentText.trim(), color: '#FFEB3B', fontSize: 12,
                    opacity: 1, points: [], createdAt: now, updatedAt: now,
                  });
                }
                setCommentPos(null); setCommentText('');
              }}
                style={{ padding: '6px 16px', borderRadius: 6, background: '#6366f1', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                Add
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
