'use client';

import { useState, useEffect } from 'react';

interface FileVersionEntry {
  id: string;
  versionNumber: number;
  fileSize: number;
  changeType: string;
  changeDescription: string | null;
  createdAt: string;
}

interface VersionHistoryPanelProps {
  fileId: string;
  token: string;
  isOpen: boolean;
  onClose: () => void;
  onRestored: () => void;
}

const CHANGE_TYPE_ICONS: Record<string, string> = {
  collaborative_edit: '✏️',
  annotation: '🖍️',
  page_replace: '📄',
  restore: '⏪',
  upload: '📤',
};

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

export default function VersionHistoryPanel({
  fileId, token, isOpen, onClose, onRestored,
}: VersionHistoryPanelProps) {
  const [versions, setVersions] = useState<FileVersionEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setError(null);
    fetch(`/api/documents/${fileId}/versions?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((data) => { setVersions(data.versions || []); })
      .catch(() => setError('Failed to load version history.'))
      .finally(() => setLoading(false));
  }, [isOpen, fileId, token]);

  const handleRestore = async (versionId: string) => {
    if (confirmed !== versionId) { setConfirmed(versionId); return; }
    setRestoring(versionId);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${fileId}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, versionId }),
      });
      const data = await res.json();
      if (data.success) { onRestored(); onClose(); }
      else setError(data.error || 'Restore failed');
    } catch {
      setError('Failed to restore version.');
    } finally {
      setRestoring(null);
      setConfirmed(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 500,
      background: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'flex-end',
    }} onClick={onClose}>
      <div style={{
        width: 400, height: '100%', background: 'var(--card-bg, #1e293b)',
        borderLeft: '1px solid var(--border, #334155)',
        display: 'flex', flexDirection: 'column',
        boxShadow: '-8px 0 40px rgba(0,0,0,0.5)',
        animation: 'slideInPanel 0.25s ease-out',
      }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border, #334155)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--foreground, #e2e8f0)' }}>🕐 Version History</h3>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--muted, #94a3b8)' }}>
              {versions.length} saved version{versions.length !== 1 ? 's' : ''}
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: 'var(--muted, #94a3b8)', lineHeight: 1 }}>×</button>
        </div>

        {/* Error */}
        {error && (
          <div style={{ margin: '12px 20px', padding: '10px 14px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', fontSize: 13, color: '#ef4444' }}>
            {error}
          </div>
        )}

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 0' }}>
          {loading && (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted, #94a3b8)', fontSize: 13 }}>
              Loading versions…
            </div>
          )}
          {!loading && versions.length === 0 && (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted, #94a3b8)', fontSize: 13 }}>
              No saved versions yet. Versions appear after saving or page replacement.
            </div>
          )}
          {versions.map((v, idx) => {
            const isRestoring = restoring === v.id;
            const needsConfirm = confirmed === v.id;
            const isCurrentEdit = idx === 0;
            return (
              <div key={v.id} style={{
                margin: '0 12px 8px', borderRadius: 10, padding: '12px 14px',
                background: isCurrentEdit ? 'rgba(99,102,241,0.1)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${isCurrentEdit ? 'rgba(99,102,241,0.3)' : 'var(--border, #334155)'}`,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span style={{ fontSize: 18 }}>{CHANGE_TYPE_ICONS[v.changeType] || '📄'}</span>
                      <div>
                        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--foreground, #e2e8f0)' }}>
                          Version {v.versionNumber}
                        </span>
                        {isCurrentEdit && (
                          <span style={{ marginLeft: 8, fontSize: 10, background: '#6366f1', color: '#fff', padding: '1px 6px', borderRadius: 10 }}>Latest</span>
                        )}
                      </div>
                    </div>
                    <p style={{ margin: '0 0 4px', fontSize: 12, color: 'var(--foreground, #e2e8f0)', opacity: 0.8 }}>
                      {v.changeDescription || v.changeType}
                    </p>
                    <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--muted, #94a3b8)' }}>
                      <span>📦 {formatBytes(v.fileSize)}</span>
                      <span>🕐 {new Date(v.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </div>
                </div>

                {/* Restore button */}
                {!isCurrentEdit && (
                  <button
                    onClick={() => handleRestore(v.id)}
                    disabled={isRestoring}
                    style={{
                      marginTop: 10, width: '100%', padding: '7px 14px', borderRadius: 8,
                      fontSize: 12, fontWeight: 600, cursor: isRestoring ? 'wait' : 'pointer',
                      background: needsConfirm ? '#ef4444' : 'rgba(99,102,241,0.15)',
                      color: needsConfirm ? '#fff' : '#6366f1',
                      border: `1px solid ${needsConfirm ? '#ef4444' : 'rgba(99,102,241,0.4)'}`,
                      transition: 'all 0.2s',
                    }}
                  >
                    {isRestoring ? '⏳ Restoring…' : needsConfirm ? '⚠ Click again to confirm restore' : '⏪ Restore this version'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <style>{`
        @keyframes slideInPanel {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
