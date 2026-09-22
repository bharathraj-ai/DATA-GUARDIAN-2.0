'use client';

import { useEffect, useState } from 'react';
import { isMarketingPath } from '@/lib/marketing-paths';

type DeferredSession = {
    user?: {
        name?: string | null;
        image?: string | null;
        role?: string | null;
        onboardingStep?: string | null;
        roleSelected?: boolean | null;
    } | null;
} | null;

let inflight: Promise<DeferredSession> | null = null;

function loadMarketingSession(): Promise<DeferredSession> {
    if (inflight) return inflight;
    inflight = fetch('/api/auth/session', { credentials: 'same-origin' })
        .then((r) => r.json())
        .then((data) => (data?.user ? data : null))
        .catch(() => null);
    return inflight;
}

/**
 * Marketing chrome should not block first paint on /api/auth/session.
 * One shared fetch after idle, reused by navbar + hero.
 */
export function useDeferredMarketingSession(pathname: string | null) {
    const marketing = isMarketingPath(pathname);
    const [session, setSession] = useState<DeferredSession>(null);
    const [status, setStatus] = useState<'loading' | 'authenticated' | 'unauthenticated'>(
        marketing ? 'unauthenticated' : 'loading',
    );

    useEffect(() => {
        if (!marketing) return;
        let cancelled = false;
        const run = () => {
            void loadMarketingSession().then((s) => {
                if (cancelled) return;
                setSession(s);
                setStatus(s?.user ? 'authenticated' : 'unauthenticated');
            });
        };
        const w = window as Window & {
            requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
            cancelIdleCallback?: (id: number) => void;
        };
        const idle = w.requestIdleCallback
            ? w.requestIdleCallback(run, { timeout: 1200 })
            : window.setTimeout(run, 400);
        return () => {
            cancelled = true;
            if (w.cancelIdleCallback) w.cancelIdleCallback(idle as number);
            else clearTimeout(idle as number);
        };
    }, [marketing, pathname]);

    return { session, status, marketing };
}
