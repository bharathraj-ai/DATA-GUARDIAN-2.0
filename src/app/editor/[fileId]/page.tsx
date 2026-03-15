'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

/**
 * ONLYOFFICE Editor Page
 *
 * Loads the ONLYOFFICE Document Editor in a full-screen view.
 * The editor communicates ONLY with our backend — no external services.
 *
 * Flow:
 *   1. Fetch signed config from /api/onlyoffice/config/{fileId}
 *   2. Load ONLYOFFICE JS API script from the Document Server
 *   3. Initialize DocEditor with the signed config
 */

// ─── Types ──────────────────────────────────────────────────────────

interface EditorState {
  status: 'loading' | 'ready' | 'error';
  error?: string;
  documentName?: string;
}

// ─── Component ──────────────────────────────────────────────────────

export default function EditorPage() {
  const params = useParams();
  const router = useRouter();
  const fileId = params?.fileId as string;
  const editorRef = useRef<HTMLDivElement>(null);
  const editorInstanceRef = useRef<unknown>(null);
  const [state, setState] = useState<EditorState>({ status: 'loading' });

  useEffect(() => {
    if (!fileId) return;

    let cancelled = false;

    async function initEditor() {
      try {
        // 1. Fetch signed config from our backend
        const res = await fetch(`/api/onlyoffice/config/${fileId}`);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Failed to load editor config (${res.status})`);
        }

        const { config, serverUrl } = await res.json();
        if (cancelled) return;

        setState((s) => ({
          ...s,
          documentName: config.document?.title || 'Document',
        }));

        // 2. Load ONLYOFFICE JS API script
        await loadOnlyOfficeScript(serverUrl);
        if (cancelled) return;

        // 3. Initialize the editor
        const DocsAPI = (window as unknown as { DocsAPI: { DocEditor: new (id: string, config: unknown) => unknown } }).DocsAPI;
        if (!DocsAPI) {
          throw new Error('ONLYOFFICE API failed to load');
        }

        editorInstanceRef.current = new DocsAPI.DocEditor('onlyoffice-editor', {
          ...config,
          width: '100%',
          height: '100%',
          events: {
            onReady: () => {
              setState({ status: 'ready', documentName: config.document?.title });
            },
            onError: (event: { data?: { errorCode?: number; errorDescription?: string } }) => {
              console.error('[EDITOR] Error:', event);
              setState({
                status: 'error',
                error: event?.data?.errorDescription || 'Editor error',
              });
            },
            onRequestClose: () => {
              router.push('/dashboard');
            },
          },
        });
      } catch (err) {
        if (!cancelled) {
          setState({
            status: 'error',
            error: err instanceof Error ? err.message : 'Failed to initialize editor',
          });
        }
      }
    }

    initEditor();

    return () => {
      cancelled = true;
      // Cleanup editor on unmount
      if (editorInstanceRef.current) {
        try {
          (editorInstanceRef.current as { destroyEditor?: () => void })?.destroyEditor?.();
        } catch {
          // Ignore cleanup errors
        }
      }
    };
  }, [fileId, router]);

  return (
    <div className="editor-page">
      {/* ── Header Bar ──────────────────────────────────────── */}
      <header className="editor-header">
        <button
          onClick={() => router.push('/dashboard')}
          className="editor-back-btn"
          title="Back to Dashboard"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <div className="editor-title-area">
          <div className="editor-logo">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
              <path d="M2 17L12 22L22 17" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
              <path d="M2 12L12 17L22 12" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/>
            </svg>
            <span>Data Guardian</span>
          </div>
          {state.documentName && (
            <span className="editor-doc-name">{state.documentName}</span>
          )}
        </div>
        <div className="editor-status">
          {state.status === 'loading' && (
            <span className="status-badge loading">Loading...</span>
          )}
          {state.status === 'ready' && (
            <span className="status-badge ready">● Connected</span>
          )}
          {state.status === 'error' && (
            <span className="status-badge error">● Error</span>
          )}
        </div>
      </header>

      {/* ── Editor Container ────────────────────────────────── */}
      <main className="editor-container">
        {state.status === 'loading' && (
          <div className="editor-loading">
            <div className="loading-spinner" />
            <p>Initializing secure editor...</p>
            <p className="loading-sub">Establishing encrypted connection to document server</p>
          </div>
        )}

        {state.status === 'error' && (
          <div className="editor-error">
            <div className="error-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
                <path d="M12 8V12M12 16H12.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </div>
            <h2>Editor Error</h2>
            <p>{state.error}</p>
            <button
              onClick={() => window.location.reload()}
              className="retry-btn"
            >
              Retry
            </button>
          </div>
        )}

        <div
          id="onlyoffice-editor"
          ref={editorRef}
          className="editor-frame"
          style={{
            display: state.status === 'error' ? 'none' : 'block',
          }}
        />
      </main>

      <style jsx>{`
        .editor-page {
          height: 100vh;
          display: flex;
          flex-direction: column;
          background: #0a0a0f;
          color: #e4e4e7;
        }

        .editor-header {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 0 20px;
          height: 52px;
          background: rgba(15, 15, 25, 0.95);
          backdrop-filter: blur(12px);
          border-bottom: 1px solid rgba(99, 102, 241, 0.15);
          flex-shrink: 0;
          z-index: 100;
        }

        .editor-back-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 36px;
          height: 36px;
          border: 1px solid rgba(99, 102, 241, 0.2);
          border-radius: 8px;
          background: rgba(99, 102, 241, 0.05);
          color: #a5b4fc;
          cursor: pointer;
          transition: all 0.2s;
        }
        .editor-back-btn:hover {
          background: rgba(99, 102, 241, 0.15);
          border-color: rgba(99, 102, 241, 0.4);
        }

        .editor-title-area {
          display: flex;
          align-items: center;
          gap: 16px;
          flex: 1;
          min-width: 0;
        }

        .editor-logo {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #818cf8;
          font-weight: 600;
          font-size: 14px;
          white-space: nowrap;
        }

        .editor-doc-name {
          color: #a1a1aa;
          font-size: 14px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          padding-left: 16px;
          border-left: 1px solid rgba(99, 102, 241, 0.15);
        }

        .editor-status {
          flex-shrink: 0;
        }

        .status-badge {
          font-size: 12px;
          padding: 4px 12px;
          border-radius: 20px;
          font-weight: 500;
        }
        .status-badge.loading {
          background: rgba(234, 179, 8, 0.1);
          color: #fbbf24;
          border: 1px solid rgba(234, 179, 8, 0.2);
        }
        .status-badge.ready {
          background: rgba(34, 197, 94, 0.1);
          color: #4ade80;
          border: 1px solid rgba(34, 197, 94, 0.2);
        }
        .status-badge.error {
          background: rgba(239, 68, 68, 0.1);
          color: #f87171;
          border: 1px solid rgba(239, 68, 68, 0.2);
        }

        .editor-container {
          flex: 1;
          position: relative;
          overflow: hidden;
        }

        .editor-frame {
          width: 100%;
          height: 100%;
        }

        .editor-loading {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 16px;
          z-index: 10;
        }
        .editor-loading p {
          color: #a1a1aa;
          font-size: 16px;
        }
        .editor-loading .loading-sub {
          color: #52525b;
          font-size: 13px;
        }

        .loading-spinner {
          width: 40px;
          height: 40px;
          border: 3px solid rgba(99, 102, 241, 0.15);
          border-top-color: #6366f1;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .editor-error {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          z-index: 10;
        }
        .error-icon {
          color: #f87171;
          margin-bottom: 8px;
        }
        .editor-error h2 {
          color: #f4f4f5;
          font-size: 20px;
          font-weight: 600;
        }
        .editor-error p {
          color: #a1a1aa;
          font-size: 14px;
          max-width: 400px;
          text-align: center;
        }

        .retry-btn {
          margin-top: 8px;
          padding: 10px 24px;
          background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
          color: white;
          border: none;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }
        .retry-btn:hover {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4);
        }
      `}</style>
    </div>
  );
}

// ─── Helper: Load ONLYOFFICE Script ─────────────────────────────────

function loadOnlyOfficeScript(serverUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Don't load twice
    if (document.getElementById('onlyoffice-api-script')) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.id = 'onlyoffice-api-script';
    script.src = `${serverUrl}/web-apps/apps/api/documents/api.js`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(
      'Failed to load ONLYOFFICE editor. Ensure the Document Server is running at: ' + serverUrl
    ));
    document.head.appendChild(script);
  });
}
