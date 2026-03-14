'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { AgentEvent } from '@/lib/documentModel';

interface AIAssistantPanelProps {
  events: AgentEvent[];
  onDismiss: (id: string) => void;
}

const SEVERITY_CONFIG = {
  info: { icon: '🔵', color: '#3b82f6', bg: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.3)', label: 'Info' },
  warning: { icon: '🟡', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)', label: 'Warning' },
  error: { icon: '🔴', color: '#ef4444', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.3)', label: 'Alert' },
};

const AUTO_DISMISS_MS = 8000;

export default function AIAssistantPanel({ events, onDismiss }: AIAssistantPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const timerRefs = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Auto-dismiss info events after 8 s
  useEffect(() => {
    events.forEach((ev) => {
      if (!timerRefs.current.has(ev.id)) {
        if (ev.severity === 'info') {
          const t = setTimeout(() => {
            onDismiss(ev.id);
            timerRefs.current.delete(ev.id);
          }, AUTO_DISMISS_MS);
          timerRefs.current.set(ev.id, t);
        }
      }
    });

    return () => {
      // cleanup timers for dismissed events
      timerRefs.current.forEach((t, id) => {
        if (!events.find((e) => e.id === id)) {
          clearTimeout(t);
          timerRefs.current.delete(id);
        }
      });
    };
  }, [events, onDismiss]);

  if (events.length === 0) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: 20,
      right: 24,
      zIndex: 1000,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      maxWidth: 380,
      maxHeight: '60vh',
      overflowY: 'auto',
      pointerEvents: 'none',
    }}>
      {/* Header toggle */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'var(--card-bg, #1e293b)',
          border: '1px solid var(--border, #334155)',
          borderRadius: 10, padding: '6px 14px',
          cursor: 'pointer', pointerEvents: 'all',
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
        }}
        onClick={() => setCollapsed((c) => !c)}
      >
        <span style={{ fontSize: 14 }}>🤖</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--foreground, #e2e8f0)' }}>
          AI Agents ({events.length})
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted, #94a3b8)' }}>
          {collapsed ? '▲' : '▼'}
        </span>
      </div>

      {/* Event cards */}
      {!collapsed && events.map((ev) => {
        const cfg = SEVERITY_CONFIG[ev.severity];
        return (
          <div key={ev.id}
            style={{
              background: cfg.bg,
              border: `1px solid ${cfg.border}`,
              borderRadius: 12,
              padding: '12px 14px',
              pointerEvents: 'all',
              boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
              animation: 'slideInRight 0.25s ease-out',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <span style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>{cfg.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: cfg.color }}>
                    {ev.title}
                  </span>
                  <button
                    onClick={() => onDismiss(ev.id)}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--muted, #94a3b8)', fontSize: 16, padding: 0, lineHeight: 1, flexShrink: 0,
                    }}
                  >
                    ×
                  </button>
                </div>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--foreground, #e2e8f0)', lineHeight: 1.5 }}>
                  {ev.message}
                </p>
                {ev.suggestion && (
                  <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--muted, #94a3b8)', lineHeight: 1.5, fontStyle: 'italic' }}>
                    💡 {ev.suggestion}
                  </p>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                  <span style={{ fontSize: 10, color: 'var(--muted, #94a3b8)' }}>{ev.agentName}</span>
                  <span style={{ fontSize: 10, color: 'var(--muted, #94a3b8)' }}>
                    {new Date(ev.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            </div>
          </div>
        );
      })}

      <style>{`
        @keyframes slideInRight {
          from { opacity: 0; transform: translateX(20px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
