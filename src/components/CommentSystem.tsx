'use client';

import { useState, useCallback } from 'react';
import type { DocumentAnnotation } from '@/lib/documentModel';

interface CommentThread {
  id: string;
  pageNumber: number;
  content: string;
  authorName?: string;
  createdAt: string;
  resolved: boolean;
  replies: Reply[];
}

interface Reply {
  id: string;
  content: string;
  authorName?: string;
  createdAt: string;
}

interface CommentSystemProps {
  annotations: DocumentAnnotation[];
  currentPage: number;
  readOnly?: boolean;
  onResolve: (id: string) => void;
  onReply: (parentId: string, content: string, authorName?: string) => void;
  onNavigate: (pageNumber: number) => void;
}

export default function CommentSystem({
  annotations,
  currentPage,
  readOnly = false,
  onResolve,
  onReply,
  onNavigate,
}: CommentSystemProps) {
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [filter, setFilter] = useState<'all' | 'unresolved' | 'current'>('all');

  // Build threaded view from annotations
  const rawComments = annotations.filter((a) => a.type === 'comment');
  const roots = rawComments.filter((a) => !a.parentId);
  const replies: Record<string, DocumentAnnotation[]> = {};
  rawComments.filter((a) => a.parentId).forEach((a) => {
    const pid = a.parentId!;
    if (!replies[pid]) replies[pid] = [];
    replies[pid].push(a);
  });

  let filtered = roots;
  if (filter === 'unresolved') filtered = roots.filter((c) => !c.resolved);
  if (filter === 'current') filtered = roots.filter((c) => c.pageNumber === currentPage);

  const handleReply = useCallback((parentId: string) => {
    if (!replyText.trim()) return;
    onReply(parentId, replyText.trim());
    setReplyText('');
    setReplyingTo(null);
  }, [replyText, onReply]);

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { return iso; }
  };

  return (
    <div style={{
      width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column',
      background: 'var(--card-bg, #1e293b)', borderLeft: '1px solid var(--border, #334155)',
      height: '100%', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border, #334155)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--foreground, #e2e8f0)' }}>
            💬 Comments ({roots.length})
          </span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['all', 'unresolved', 'current'] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              style={{
                padding: '3px 10px', borderRadius: 20, fontSize: 11, cursor: 'pointer', border: 'none',
                background: filter === f ? '#6366f1' : 'rgba(255,255,255,0.05)',
                color: filter === f ? '#fff' : 'var(--muted, #94a3b8)',
                fontWeight: filter === f ? 700 : 400,
              }}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Thread list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {filtered.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted, #94a3b8)', fontSize: 13 }}>
            No comments yet.
          </div>
        )}
        {filtered.map((comment) => (
          <div key={comment.id} style={{
            margin: '4px 12px', borderRadius: 10,
            background: comment.resolved ? 'rgba(255,255,255,0.03)' : 'rgba(99,102,241,0.08)',
            border: `1px solid ${comment.resolved ? 'var(--border, #334155)' : 'rgba(99,102,241,0.3)'}`,
            overflow: 'hidden',
          }}>
            {/* Root comment */}
            <div style={{ padding: '10px 12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <div style={{
                      width: 24, height: 24, borderRadius: '50%', background: '#6366f1',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 10, color: '#fff', fontWeight: 700, flexShrink: 0,
                    }}>
                      {(comment.authorName || 'U')[0].toUpperCase()}
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--foreground, #e2e8f0)' }}>
                      {comment.authorName || 'User'}
                    </span>
                    <button onClick={() => onNavigate(comment.pageNumber)}
                      style={{ marginLeft: 'auto', fontSize: 10, color: '#6366f1', background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px' }}>
                      p.{comment.pageNumber}
                    </button>
                  </div>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--foreground, #e2e8f0)', lineHeight: 1.5, opacity: comment.resolved ? 0.5 : 1 }}>
                    {comment.content}
                  </p>
                  <span style={{ fontSize: 10, color: 'var(--muted, #94a3b8)', marginTop: 4, display: 'block' }}>
                    {formatDate(comment.createdAt)}
                  </span>
                </div>
              </div>
            </div>

            {/* Replies */}
            {(replies[comment.id] || []).map((r) => (
              <div key={r.id} style={{ padding: '8px 12px 8px 24px', borderTop: '1px solid var(--border, #334155)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <div style={{
                    width: 18, height: 18, borderRadius: '50%', background: '#10b981',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 9, color: '#fff', fontWeight: 700, flexShrink: 0,
                  }}>
                    {(r.authorName || 'U')[0].toUpperCase()}
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--foreground, #e2e8f0)' }}>
                    {r.authorName || 'User'}
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--foreground, #e2e8f0)', lineHeight: 1.5 }}>
                  {r.content}
                </p>
              </div>
            ))}

            {/* Actions */}
            {!readOnly && (
              <div style={{ padding: '6px 12px', borderTop: '1px solid var(--border, #334155)', display: 'flex', gap: 8 }}>
                {!comment.resolved && (
                  <button onClick={() => setReplyingTo(replyingTo === comment.id ? null : comment.id)}
                    style={{ fontSize: 11, color: '#6366f1', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                    ↩ Reply
                  </button>
                )}
                {!comment.resolved && (
                  <button onClick={() => onResolve(comment.id)}
                    style={{ fontSize: 11, color: '#10b981', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginLeft: 'auto' }}>
                    ✓ Resolve
                  </button>
                )}
                {comment.resolved && (
                  <span style={{ fontSize: 11, color: '#10b981', marginLeft: 'auto' }}>✓ Resolved</span>
                )}
              </div>
            )}

            {/* Reply input */}
            {replyingTo === comment.id && (
              <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border, #334155)' }}>
                <textarea
                  autoFocus value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Write a reply..."
                  rows={2}
                  style={{
                    width: '100%', padding: '6px 10px', borderRadius: 6, resize: 'none', fontSize: 12,
                    background: 'var(--background, #0f172a)', color: 'var(--foreground, #e2e8f0)',
                    border: '1px solid var(--border, #334155)', outline: 'none',
                  }}
                />
                <div style={{ display: 'flex', gap: 6, marginTop: 6, justifyContent: 'flex-end' }}>
                  <button onClick={() => setReplyingTo(null)}
                    style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border, #334155)', background: 'transparent', color: 'var(--muted, #94a3b8)', cursor: 'pointer' }}>
                    Cancel
                  </button>
                  <button onClick={() => handleReply(comment.id)}
                    style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, background: '#6366f1', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                    Reply
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
