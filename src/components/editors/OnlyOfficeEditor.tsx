'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * OnlyOfficeEditor — Embeddable ONLYOFFICE editor for UniversalFileEditor.
 *
 * Works with the existing encrypted UserFile flow:
 *   1. Fetches config from /api/onlyoffice/editor-config/{fileId}?token={shareToken}
 *   2. Loads ONLYOFFICE JS API from the Document Server
 *   3. Initializes editor inline
 */

interface OnlyOfficeEditorProps {
  token: string;      // Share link token
  fileId: string;     // UserFile ID
  fileName: string;   // Display name
}

export default function OnlyOfficeEditor({ token, fileId, fileName }: OnlyOfficeEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const editorInstanceRef = useRef<unknown>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        // 1. Fetch editor config from our backend
        const res = await fetch(`/api/onlyoffice/editor-config/${fileId}?token=${encodeURIComponent(token)}`);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Config error (${res.status})`);
        }

        const { config, serverUrl } = await res.json();
        if (cancelled) return;

        // 2. Load ONLYOFFICE script
        await loadScript(serverUrl);
        if (cancelled) return;

        // 3. Initialize editor
        const DocsAPI = (window as unknown as {
          DocsAPI: { DocEditor: new (id: string, cfg: unknown) => unknown }
        }).DocsAPI;

        if (!DocsAPI) throw new Error('ONLYOFFICE API not available');

        editorInstanceRef.current = new DocsAPI.DocEditor('oo-inline-editor', {
          ...config,
          width: '100%',
          height: '100%',
          type: 'embedded',
          events: {
            onReady: () => {
              if (!cancelled) setStatus('ready');
            },
            onError: (evt: { data?: { errorDescription?: string } }) => {
              if (!cancelled) {
                setStatus('error');
                setErrorMsg(evt?.data?.errorDescription || 'Editor error');
              }
            },
          },
        });
      } catch (err) {
        if (!cancelled) {
          setStatus('error');
          setErrorMsg(err instanceof Error ? err.message : 'Failed to load editor');
        }
      }
    }

    init();

    return () => {
      cancelled = true;
      if (editorInstanceRef.current) {
        try {
          (editorInstanceRef.current as { destroyEditor?: () => void })?.destroyEditor?.();
        } catch { /* ignore */ }
      }
    };
  }, [fileId, token]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: '#1e1e2e' }}>
      {status === 'loading' && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 12, zIndex: 5,
        }}>
          <div className="loading-spinner" />
          <p style={{ color: '#a1a1aa', fontSize: 14 }}>
            Opening <strong>{fileName}</strong> in ONLYOFFICE...
          </p>
          <p style={{ color: '#52525b', fontSize: 12 }}>
            Decrypting and establishing secure connection
          </p>
        </div>
      )}

      {status === 'error' && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 10, zIndex: 5,
        }}>
          <p style={{ color: '#f87171', fontSize: 16, fontWeight: 600 }}>Editor Error</p>
          <p style={{ color: '#a1a1aa', fontSize: 13, maxWidth: 360, textAlign: 'center' }}>
            {errorMsg}
          </p>
          <p style={{ color: '#52525b', fontSize: 12, marginTop: 8 }}>
            Ensure the ONLYOFFICE Document Server is running (docker compose up)
          </p>
        </div>
      )}

      <div
        id="oo-inline-editor"
        ref={editorRef}
        style={{
          width: '100%',
          height: '100%',
          display: status === 'error' ? 'none' : 'block',
        }}
      />
    </div>
  );
}

// ── Load ONLYOFFICE JS API script ───────────────────────────────────
function loadScript(serverUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.getElementById('oo-api-script')) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.id = 'oo-api-script';
    s.src = `${serverUrl}/web-apps/apps/api/documents/api.js`;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(
      'Cannot reach ONLYOFFICE at ' + serverUrl + '. Is Docker running?'
    ));
    document.head.appendChild(s);
  });
}
