'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type Health = {
  status?: string;
  checks?: Record<string, unknown>;
  error?: string;
};

export default function StatusPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/health', { cache: 'no-store' });
        const json = (await res.json().catch(() => ({}))) as Health;
        if (!cancelled) setHealth({ ...json, status: res.ok ? json.status || 'ok' : 'degraded' });
      } catch {
        if (!cancelled) setHealth({ status: 'unreachable', error: 'Could not reach /api/health' });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="container" style={{ padding: '3rem 1rem', maxWidth: 720 }}>
      <h1 style={{ fontSize: '2rem' }}>System status</h1>
      <p style={{ color: '#94a3b8' }}>
        Live readiness from this deployment. There is no historical uptime chart yet.
      </p>

      {loading ? (
        <p style={{ color: '#64748b' }}>Checking…</p>
      ) : (
        <div
          style={{
            border: '1px solid #1e293b',
            borderRadius: 12,
            padding: '1.25rem',
            background: '#0f172a',
            marginTop: '1rem',
          }}
        >
          <p style={{ margin: 0, fontSize: 18 }}>
            Status:{' '}
            <strong style={{ color: health?.status === 'ok' || health?.status === 'healthy' ? '#4ade80' : '#fbbf24' }}>
              {health?.status || 'unknown'}
            </strong>
          </p>
          {health?.error ? <p style={{ color: '#f87171' }}>{health.error}</p> : null}
          {health?.checks ? (
            <pre
              style={{
                marginTop: 12,
                fontSize: 12,
                color: '#94a3b8',
                overflow: 'auto',
                background: '#020617',
                padding: 12,
                borderRadius: 8,
              }}
            >
              {JSON.stringify(health.checks, null, 2)}
            </pre>
          ) : null}
        </div>
      )}

      <ul style={{ color: '#94a3b8', fontSize: 14, marginTop: '1.5rem', lineHeight: 1.7 }}>
        <li>App server (Next.js) — pages, sign-in, server actions</li>
        <li>PostgreSQL via Prisma — links, users, audit</li>
        <li>Redis — rate limits, sessions, revoke</li>
        <li>MongoDB GridFS — ciphertext object store</li>
        <li>Google OAuth — account sign-in</li>
      </ul>

      <p style={{ marginTop: '2rem' }}>
        <Link href="/help" style={{ color: '#38bdf8' }}>
          Help center
        </Link>
      </p>
    </main>
  );
}
