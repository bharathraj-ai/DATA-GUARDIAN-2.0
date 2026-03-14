'use client';

import {
  useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense,
} from 'react';
import type { DocumentAnnotation, AgentEvent, CursorPosition } from '@/lib/documentModel';
import { CollaborationClient, nextCursorColor } from '@/lib/collaborationEngine';
import { AgentOrchestrator } from '@/agents/AgentOrchestrator';
import { SecurityAgent } from '@/agents/SecurityAgent';
import { ComplianceAgent } from '@/agents/ComplianceAgent';
import { DocumentAnalysisAgent } from '@/agents/DocumentAnalysisAgent';
import { CollaborationAgent } from '@/agents/CollaborationAgent';
import { MonitoringAgent } from '@/agents/MonitoringAgent';
import type { UserRole } from '@/agents/ComplianceAgent';
import AIAssistantPanel from './AIAssistantPanel';
import VersionHistoryPanel from './VersionHistoryPanel';
import CommentSystem from './CommentSystem';

// Lazy-load heavy sub-editors
const PdfViewer = lazy(() => import('./editors/PdfViewer'));
const MonacoTextEditor = lazy(() => import('./editors/MonacoTextEditor'));
const SpreadsheetEditor = lazy(() => import('./editors/SpreadsheetEditor'));
const RichTextEditor = lazy(() => import('./editors/RichTextEditor'));
const ImageEditor = lazy(() => import('./editors/ImageEditor'));

// ─── Types ────────────────────────────────────────────────────────────────────
interface UniversalEditorProps {
  token: string;
  fileId: string;
  fileName: string;
  fileType?: string;
  userRole?: UserRole;
  displayName?: string;
  remainingSeconds: number;
  onClose: () => void;
  onSaved?: (fileId: string) => void;
}

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

type EditorSubtype =
  | 'pdf' | 'richtext' | 'text' | 'json' | 'markdown'
  | 'csv' | 'spreadsheet' | 'image' | 'unsupported';

function detectSubtype(fileType: string, fileName: string): EditorSubtype {
  const name = fileName.toLowerCase();
  const mime = fileType.toLowerCase();
  if (mime.includes('pdf') || name.endsWith('.pdf')) return 'pdf';
  if (mime.includes('word') || name.endsWith('.docx') || name.endsWith('.doc')) return 'richtext';
  if (mime.includes('csv') || name.endsWith('.csv')) return 'csv';
  if (mime.includes('spreadsheet') || name.endsWith('.xlsx') || name.endsWith('.xls')) return 'spreadsheet';
  if (mime.startsWith('image/')) return 'image';
  if (name.endsWith('.json')) return 'json';
  if (name.endsWith('.md')) return 'markdown';
  if (mime.startsWith('text/') || name.endsWith('.txt')) return 'text';
  return 'unsupported';
}

const ACCEPT_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

let SESSION_COLOR = '';
function getSessionColor() {
  if (!SESSION_COLOR) SESSION_COLOR = nextCursorColor();
  return SESSION_COLOR;
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function UniversalEditor({
  token, fileId, fileName, fileType = 'application/octet-stream',
  userRole = 'VENDOR', displayName = 'User',
  remainingSeconds, onClose, onSaved,
}: UniversalEditorProps) {
  // ── Loading / error ──
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Document data ──
  const [dataUrl, setDataUrl] = useState('');
  const [subtype, setSubtype] = useState<EditorSubtype>('unsupported');
  const [textContent, setTextContent] = useState('');
  const [spreadsheetRows, setSpreadsheetRows] = useState<unknown[][]>([]);
  const [richTextHtml, setRichTextHtml] = useState('');
  const [imageDataUrl, setImageDataUrl] = useState('');

  // ── Annotations ──
  const [annotations, setAnnotations] = useState<DocumentAnnotation[]>([]);

  // ── Security / UI ──
  const [isBlurred, setIsBlurred] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showVersions, setShowVersions] = useState(false);

  // ── Collaboration ──
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [cursors, setCursors] = useState<CursorPosition[]>([]);
  const collabRef = useRef<CollaborationClient | null>(null);
  const sessionId = useRef(Math.random().toString(36).slice(2));
  const cursorThrottle = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── AI Agent events ──
  const [agentEvents, setAgentEvents] = useState<AgentEvent[]>([]);
  const orchestratorRef = useRef<AgentOrchestrator | null>(null);

  // ── PDF ref for modified bytes ──
  const pdfRef = useRef<{ getModifiedPdf: () => Promise<string> } | null>(null);

  // ─── Helpers ──────────────────────────────────────────────────────────────
  const addAgentEvent = useCallback((ev: AgentEvent) => {
    setAgentEvents((prev) => [ev, ...prev].slice(0, 20));
  }, []);
  const dismissEvent = useCallback((id: string) => {
    setAgentEvents((prev) => prev.filter((e) => e.id !== id));
  }, []);

  // ─── Set up AI agent orchestrator ─────────────────────────────────────────
  useEffect(() => {
    const orc = new AgentOrchestrator();
    orc.registerAgent(new SecurityAgent());
    orc.registerAgent(new ComplianceAgent(userRole));
    orc.registerAgent(new DocumentAnalysisAgent());
    orc.registerAgent(new CollaborationAgent());
    orc.registerAgent(new MonitoringAgent());
    const unsub = orc.onAgentEvent(addAgentEvent);
    orchestratorRef.current = orc;
    return () => { unsub(); orc.destroy(); orchestratorRef.current = null; };
  }, [userRole, addAgentEvent]);

  // ─── Load document from server ────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    fetch(`/api/documents/${fileId}/stream?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (!data.success) { setError(data.error || 'Failed to load file'); return; }

        const detected = detectSubtype(data.fileType || fileType, data.fileName || fileName);
        setSubtype(detected);
        setDataUrl(data.dataUrl);

        if (detected === 'text' || detected === 'json' || detected === 'markdown') {
          const b64 = data.dataUrl.split(',')[1] ?? '';
          setTextContent(atob(b64));
        } else if (detected === 'richtext') {
          // mammoth conversion happens inside RichTextEditor's own loader
        } else if (detected === 'csv' || detected === 'spreadsheet') {
          // SpreadsheetEditor will parse from dataUrl
        }

        // Notify analysis agent
        orchestratorRef.current?.dispatch('doc:load', {
          fileName: data.fileName || fileName,
          fileType: detected,
        });
      })
      .catch(() => { if (!cancelled) setError('Failed to load document'); })
      .finally(() => { if (!cancelled) setIsLoading(false); });

    return () => { cancelled = true; };
  }, [token, fileId, fileName, fileType]);

  // ─── Load annotations ─────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`/api/documents/${fileId}/annotations?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success && data.annotations) {
          setAnnotations(data.annotations.map((a: { data: string; [k: string]: unknown }) => ({
            ...JSON.parse(a.data),
            id: a.id,
          })));
        }
      })
      .catch(() => { /* non-fatal */ });
  }, [token, fileId]);

  // ─── Collaboration WebSocket ───────────────────────────────────────────────
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/collaboration/${fileId}?token=${encodeURIComponent(token)}&sessionId=${sessionId.current}&displayName=${encodeURIComponent(displayName)}`;

    const client = new CollaborationClient(wsUrl);
    collabRef.current = client;

    const unsub = client.on((msg) => {
      if (msg.type === 'presence') {
        const status = (msg.payload as { status?: string })?.status;
        setConnectionStatus(status === 'connected' ? 'connected' : 'disconnected');
      }
      if (msg.type === 'cursor') {
        const c = msg.payload as CursorPosition;
        setCursors((prev) => {
          const filtered = prev.filter((x) => x.sessionId !== c.sessionId);
          return [...filtered, c];
        });
      }
      if (msg.type === 'session') {
        const ev = (msg.payload as { event: string }).event;
        if (ev === 'revoked' || ev === 'expired') onClose();
      }
      if (msg.type === 'op') {
        // remote ops — re-fetch annotations if collab annotation op
        const op = msg.payload as { type: string };
        if (op.type === 'annotate' || op.type === 'deleteAnnotation' || op.type === 'updateAnnotation') {
          fetch(`/api/documents/${fileId}/annotations?token=${encodeURIComponent(token)}`)
            .then((r) => r.json())
            .then((data) => {
              if (data.success) {
                setAnnotations(data.annotations.map((a: { data: string; [k: string]: unknown }) => ({
                  ...JSON.parse(a.data), id: a.id,
                })));
              }
            }).catch(() => {});
        }
      }
    });

    client.connect();
    setConnectionStatus('connecting');

    // Announce join
    orchestratorRef.current?.dispatch('session:join', { displayName, userId: sessionId.current });

    return () => {
      unsub();
      client.destroy();
      collabRef.current = null;
    };
  }, [token, fileId, displayName, onClose]);

  // ─── SSE session monitor ───────────────────────────────────────────────────
  useEffect(() => {
    const evtSource = new EventSource(`/api/session-monitor?token=${encodeURIComponent(token)}`);
    evtSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'revoked' || data.type === 'expired') onClose();
      } catch { /* ignore */ }
    };
    return () => evtSource.close();
  }, [token, onClose]);

  // ─── Security: blur on tab switch ─────────────────────────────────────────
  useEffect(() => {
    const handleVisibility = () => {
      const hidden = document.hidden;
      setIsBlurred(hidden);
      if (hidden) orchestratorRef.current?.dispatch('session:tabswitch', {});
    };
    const handleBlur = () => setIsBlurred(true);
    const handleFocus = () => setIsBlurred(false);
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  // ─── Security: block right-click, Ctrl+P, PrintScreen ────────────────────
  useEffect(() => {
    const blockCtx = (e: Event) => e.preventDefault();
    const blockKeys = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P' || e.key === 's' || e.key === 'S')) e.preventDefault();
      if (e.key === 'PrintScreen') e.preventDefault();
    };
    document.addEventListener('contextmenu', blockCtx);
    window.addEventListener('keydown', blockKeys);
    return () => {
      document.removeEventListener('contextmenu', blockCtx);
      window.removeEventListener('keydown', blockKeys);
    };
  }, []);

  // ─── Session expiry ────────────────────────────────────────────────────────
  useEffect(() => {
    if (remainingSeconds <= 0) onClose();
  }, [remainingSeconds, onClose]);

  // ─── Save ─────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setError(null);
    try {
      let finalDataUrl = dataUrl;
      if (subtype === 'pdf' && pdfRef.current) {
        finalDataUrl = await pdfRef.current.getModifiedPdf();
      } else if (subtype === 'image' && imageDataUrl) {
        finalDataUrl = imageDataUrl;
      } else if (subtype === 'text' || subtype === 'json' || subtype === 'markdown') {
        const b64 = btoa(unescape(encodeURIComponent(textContent)));
        const mime = subtype === 'json' ? 'application/json' : 'text/plain';
        finalDataUrl = `data:${mime};base64,${b64}`;
      }

      const res = await fetch(`/api/documents/${fileId}/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, dataUrl: finalDataUrl, changeType: 'collaborative_edit', changeDescription: 'Saved from editor' }),
      });
      const data = await res.json();
      if (data.success) {
        onSaved?.(fileId);
      } else {
        setError(data.error || 'Failed to save');
      }
    } catch {
      setError('An error occurred while saving');
    } finally {
      setIsSaving(false);
    }
  }, [token, fileId, dataUrl, subtype, imageDataUrl, textContent, onSaved]);

  // ─── Mouse cursor tracking ─────────────────────────────────────────────────
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!collabRef.current) return;
    if (cursorThrottle.current) return;
    cursorThrottle.current = setTimeout(() => { cursorThrottle.current = null; }, 50);
    const r = e.currentTarget.getBoundingClientRect();
    collabRef.current.sendCursor({
      sessionId: sessionId.current,
      displayName,
      color: getSessionColor(),
      page: 1,
      x: ((e.clientX - r.left) / r.width) * 100,
      y: ((e.clientY - r.top) / r.height) * 100,
      updatedAt: new Date().toISOString(),
    });
  }, [displayName]);

  // ─── Timer formatting ─────────────────────────────────────────────────────
  const formatTime = (s: number) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
  const timerClass = remainingSeconds <= 30 ? '#ef4444' : remainingSeconds <= 60 ? '#f59e0b' : '#10b981';

  // ─── Subtype icon ─────────────────────────────────────────────────────────
  const fileIcon = useMemo(() => {
    const m: Record<string, string> = { pdf: '📄', richtext: '📘', text: '📝', json: '{ }', markdown: '📝', csv: '📊', spreadsheet: '📊', image: '🖼️', unsupported: '❓' };
    return m[subtype] || '📄';
  }, [subtype]);

  // ─── Render sub-editor ────────────────────────────────────────────────────
  const renderSubEditor = () => {
    if (isLoading) return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, flexDirection: 'column', gap: 12, color: 'var(--muted, #94a3b8)' }}>
        <div style={{ width: 40, height: 40, border: '3px solid rgba(99,102,241,0.3)', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <p style={{ margin: 0, fontSize: 14 }}>Decrypting and loading document…</p>
      </div>
    );
    if (error) return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
        <p style={{ color: '#ef4444', fontSize: 14 }}>{error}</p>
      </div>
    );
    return (
      <Suspense fallback={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
          <div style={{ width: 32, height: 32, border: '3px solid rgba(99,102,241,0.3)', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        </div>
      }>
        {subtype === 'pdf' && (
          <PdfViewer ref={pdfRef} content={dataUrl} onChange={() => {}} />
        )}
        {(subtype === 'text' || subtype === 'json' || subtype === 'markdown') && (
          <MonacoTextEditor content={textContent} onChange={(v) => {
            setTextContent(v);
            orchestratorRef.current?.dispatch('op:insert', { text: v.slice(-200), opId: Date.now().toString() });
          }} editorType={subtype} fileName={fileName} />
        )}
        {(subtype === 'csv' || subtype === 'spreadsheet') && (
          <SpreadsheetEditor rows={spreadsheetRows} onChange={setSpreadsheetRows} />
        )}
        {subtype === 'richtext' && (
          <RichTextEditor content={richTextHtml} onChange={(v) => {
            setRichTextHtml(v);
            orchestratorRef.current?.dispatch('op:insert', { text: v.replace(/<[^>]+>/g, '').slice(-200) });
          }} />
        )}
        {subtype === 'image' && (
          <ImageEditor content={dataUrl} onChange={setImageDataUrl} />
        )}
        {subtype === 'unsupported' && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: '#f59e0b', fontSize: 14, flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 40 }}>❓</span>
            <p>This file type is not supported for inline editing.</p>
          </div>
        )}
      </Suspense>
    );
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 400,
      background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        width: '98vw', height: '96vh',
        background: 'var(--background, #0f172a)',
        border: '1px solid var(--border, #334155)',
        borderRadius: 16, overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 32px 80px rgba(0,0,0,0.8)',
        filter: isBlurred ? 'blur(12px)' : 'none',
        transition: 'filter 0.3s',
      }} onMouseMove={handleMouseMove}>

        {/* ── Toolbar ── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px',
          background: 'var(--card-bg, #1e293b)', borderBottom: '1px solid var(--border, #334155)',
          flexShrink: 0,
        }}>
          {/* File info */}
          <span style={{ fontSize: 20 }}>{fileIcon}</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--foreground, #e2e8f0)' }}>{fileName}</div>
            <div style={{ fontSize: 10, color: 'var(--muted, #94a3b8)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{subtype}</div>
          </div>

          {/* Collab presence badges */}
          <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
            {cursors.slice(0, 5).map((c) => (
              <div key={c.sessionId} title={c.displayName} style={{
                width: 28, height: 28, borderRadius: '50%', background: c.color,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, color: '#fff', fontWeight: 700, border: '2px solid var(--background, #0f172a)',
              }}>
                {c.displayName[0]?.toUpperCase()}
              </div>
            ))}
          </div>

          <div style={{ flex: 1 }} />

          {/* Action buttons */}
          {[
            { label: '💾 Save', onClick: handleSave, disabled: isSaving || subtype === 'unsupported', primary: true },
            { label: '💬 Comments', onClick: () => setShowComments((v) => !v), disabled: false, primary: false, active: showComments },
            { label: '🕐 History', onClick: () => setShowVersions(true), disabled: false, primary: false },
          ].map((btn) => (
            <button key={btn.label} onClick={btn.onClick} disabled={btn.disabled}
              style={{
                padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: btn.disabled ? 'not-allowed' : 'pointer',
                background: btn.primary ? '#6366f1' : ('active' in btn && btn.active) ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.05)',
                color: btn.primary ? '#fff' : 'var(--foreground, #e2e8f0)',
                border: btn.primary ? '1px solid #6366f1' : '1px solid var(--border, #334155)',
                opacity: btn.disabled ? 0.5 : 1,
                transition: 'all 0.15s',
              }}>
              {btn.primary && isSaving ? '⏳ Saving…' : btn.label}
            </button>
          ))}

          {/* Close */}
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 6, border: '1px solid var(--border, #334155)', background: 'transparent', color: 'var(--muted, #94a3b8)', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>

        {/* ── Main area ── */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* Editor */}
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {renderSubEditor()}
          </div>

          {/* Comment panel */}
          {showComments && (
            <CommentSystem
              annotations={annotations}
              currentPage={1}
              readOnly={userRole === 'VENDOR'}
              onResolve={(id) => {
                setAnnotations((prev) => prev.map((a) => a.id === id ? { ...a, resolved: true, updatedAt: new Date().toISOString() } : a));
                fetch(`/api/documents/${fileId}/annotations`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ token, annotation: { id, pageNumber: 1, type: 'comment', data: { resolved: true } } }),
                }).catch(() => {});
                orchestratorRef.current?.dispatch('op:comment', { commentId: id, resolved: true });
              }}
              onReply={(parentId, content) => {
                const now = new Date().toISOString();
                const newReply: DocumentAnnotation = {
                  id: Math.random().toString(36).slice(2), type: 'comment', pageNumber: 1,
                  rect: { x: 0, y: 0, width: 0, height: 0 }, content,
                  color: '#FFEB3B', fontSize: 12, opacity: 1, points: [],
                  createdAt: now, updatedAt: now, parentId, authorName: displayName,
                };
                setAnnotations((prev) => [...prev, newReply]);
                fetch(`/api/documents/${fileId}/annotations`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ token, annotation: { pageNumber: 1, type: 'comment', data: newReply } }),
                }).catch(() => {});
                orchestratorRef.current?.dispatch('op:comment', { commentId: newReply.id, parentId, content });
              }}
              onNavigate={() => {}}
            />
          )}
        </div>

        {/* ── Footer status bar ── */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '6px 16px', background: 'var(--card-bg, #1e293b)',
          borderTop: '1px solid var(--border, #334155)', flexShrink: 0, fontSize: 11,
        }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <span style={{ color: timerClass, fontWeight: 700, fontFamily: 'monospace' }}>⏱ {formatTime(remainingSeconds)}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: connectionStatus === 'connected' ? '#10b981' : connectionStatus === 'connecting' ? '#f59e0b' : '#ef4444' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />
              {connectionStatus === 'connected' ? 'LIVE' : connectionStatus === 'connecting' ? 'CONNECTING' : 'OFFLINE'}
            </span>
            <span style={{ color: 'var(--muted, #94a3b8)' }}>👤 {displayName}</span>
            {cursors.length > 0 && <span style={{ color: 'var(--muted, #94a3b8)' }}>+{cursors.length} collaborator{cursors.length !== 1 ? 's' : ''}</span>}
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', color: 'var(--muted, #94a3b8)' }}>
            <span>🔒 AES-256-GCM</span>
            <span>🤖 5 agents active</span>
          </div>
        </div>
      </div>

      {/* AI assistant panel (fixed, outside scroll) */}
      <AIAssistantPanel events={agentEvents} onDismiss={dismissEvent} />

      {/* Version history slide-over */}
      <VersionHistoryPanel
        fileId={fileId} token={token}
        isOpen={showVersions}
        onClose={() => setShowVersions(false)}
        onRestored={() => { setShowVersions(false); window.location.reload(); }}
      />

      {/* Blur overlay */}
      {isBlurred && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.95)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16,
        }}>
          <span style={{ fontSize: 48 }}>🔒</span>
          <p style={{ color: '#e2e8f0', fontSize: 18, fontWeight: 700 }}>Document Hidden</p>
          <p style={{ color: '#94a3b8', fontSize: 14 }}>Return to this tab to continue viewing the document.</p>
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
