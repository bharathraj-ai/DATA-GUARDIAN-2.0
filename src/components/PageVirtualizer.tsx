'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

interface PageVirtualizerProps {
  totalPages: number;
  pageWidth: number;   // px (after zoom)
  pageHeight: number;  // px (after zoom)
  overscan?: number;   // pages to keep rendered above/below viewport (default 2)
  renderPage: (pageNumber: number, containerEl: HTMLDivElement) => void;
  onVisiblePageChange?: (page: number) => void;
}

/**
 * High-performance virtual scroller for 100–500+ page documents.
 * Only renders pages that are ±overscan pages from the current viewport.
 * Uses IntersectionObserver for efficient visibility detection.
 */
export default function PageVirtualizer({
  totalPages,
  pageWidth,
  pageHeight,
  overscan = 2,
  renderPage,
  onVisiblePageChange,
}: PageVirtualizerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const renderedPages = useRef<Set<number>>(new Set());
  const [visiblePage, setVisiblePage] = useState(1);

  // Re-renders when zoom changes (pageWidth/pageHeight change)
  useEffect(() => {
    renderedPages.current.clear();
  }, [pageWidth, pageHeight]);

  useEffect(() => {
    if (totalPages === 0 || !containerRef.current) return;

    const obs = new IntersectionObserver(
      (entries) => {
        const visible: number[] = [];
        entries.forEach((entry) => {
          const pg = parseInt(entry.target.getAttribute('data-page') ?? '0');
          if (!pg) return;
          if (entry.isIntersecting) {
            visible.push(pg);
            // Render this page and its neighbours
            for (let i = Math.max(1, pg - overscan); i <= Math.min(totalPages, pg + overscan); i++) {
              if (!renderedPages.current.has(i)) {
                const el = pageRefs.current.get(i);
                if (el) {
                  renderedPages.current.add(i);
                  renderPage(i, el);
                }
              }
            }
          }
        });
        if (visible.length > 0) {
          const first = Math.min(...visible);
          setVisiblePage(first);
          onVisiblePageChange?.(first);
        }
      },
      {
        root: containerRef.current,
        rootMargin: `${overscan * pageHeight}px 0px`,
        threshold: 0.01,
      },
    );

    // Small delay for refs to settle
    const t = setTimeout(() => {
      pageRefs.current.forEach((el) => obs.observe(el));
    }, 50);

    return () => {
      clearTimeout(t);
      obs.disconnect();
    };
  }, [totalPages, pageWidth, pageHeight, overscan, renderPage, onVisiblePageChange]);

  const scrollToPage = useCallback((page: number) => {
    const el = pageRefs.current.get(Math.max(1, Math.min(page, totalPages)));
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [totalPages]);

  return (
    <div
      ref={containerRef}
      style={{
        overflowY: 'auto',
        overflowX: 'auto',
        flex: 1,
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        padding: '12px 0',
        scrollBehavior: 'smooth',
      }}
    >
      {Array.from({ length: totalPages }, (_, i) => i + 1).map((pg) => (
        <div
          key={pg}
          data-page={pg}
          ref={(el) => { if (el) pageRefs.current.set(pg, el); }}
          style={{
            position: 'relative',
            width: pageWidth,
            height: pageHeight,
            background: '#fff',
            boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
            borderRadius: 4,
            overflow: 'hidden',
            flexShrink: 0,
          }}
        />
      ))}
    </div>
  );
}
