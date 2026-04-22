'use client';

import { useEffect, useRef } from 'react';
import type { CursorPosition } from '@/lib/documentModel';

interface CursorTrackerProps {
  cursors: CursorPosition[];
  currentPage: number;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Renders floating colored name-badge cursors for all remote collaborators
 * on the currently visible page.
 */
export default function CursorTracker({ cursors, currentPage, containerRef }: CursorTrackerProps) {
  const activeCursors = cursors.filter((c) => c.page === currentPage);

  if (activeCursors.length === 0) return null;

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 50, overflow: 'hidden' }}>
      {activeCursors.map((cursor) => (
        <RemoteCursor key={cursor.sessionId} cursor={cursor} />
      ))}
    </div>
  );
}

function RemoteCursor({ cursor }: { cursor: CursorPosition }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: `${cursor.x}%`,
        top: `${cursor.y}%`,
        transform: 'translate(-2px, -2px)',
        pointerEvents: 'none',
        zIndex: 50,
        transition: 'left 0.05s linear, top 0.05s linear',
      }}
    >
      {/* Cursor arrow */}
      <svg width={16} height={20} viewBox="0 0 16 20" style={{ display: 'block' }}>
        <path
          d="M0 0 L0 16 L4 12 L7 19 L9 18 L6 11 L11 11 Z"
          fill={cursor.color}
          stroke="white"
          strokeWidth={1}
        />
      </svg>
      {/* Name badge */}
      <div
        style={{
          position: 'absolute',
          left: 14,
          top: 2,
          background: cursor.color,
          color: '#fff',
          fontSize: 11,
          fontWeight: 700,
          fontFamily: 'system-ui, sans-serif',
          padding: '2px 8px',
          borderRadius: 8,
          whiteSpace: 'nowrap',
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
          letterSpacing: '0.02em',
        }}
      >
        {cursor.displayName}
      </div>
    </div>
  );
}
