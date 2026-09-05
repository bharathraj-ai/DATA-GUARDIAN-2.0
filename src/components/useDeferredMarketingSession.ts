'use client';

import { useEffect, useState } from 'react';

type MarketingUser = {
    name?: string | null;
    image?: string | null;
    role?: string | null;
    onboardingStep?: string | null;
    roleSelected?: boolean | null;
};

export type DeferredSession = {
    user?: MarketingUser;
} | null;

/**
 * After LCP, optionally hydrate marketing chrome from GET /api/auth/session.
 * Avoids wrapping the landing tree in SessionProvider.
 */
export function useDeferredMarketingSession() {
    const [session, setSession] = useState<DeferredSession>(null);
    const [status, setStatus] = useState<'loading' | 'authenticated' | 'unauthenticated'>('loading');

    useEffect(() => {
        let cancelled = false;
        const id = window.setTimeout(() => {
            fetch('/api/auth/session', { credentials: 'include' })
                .then((res) => (res.ok ? res.json() : null))
                .then((data: DeferredSession) => {
                    if (cancelled) return;
                    if (data?.user) {
                        setSession(data);
                        setStatus('authenticated');
                    } else {
                        setStatus('unauthenticated');
                    }
                })
                .catch(() => {
                    if (!cancelled) setStatus('unauthenticated');
                });
        }, 1200);
        return () => {
            cancelled = true;
            window.clearTimeout(id);
        };
    }, []);

    return { session, status };
}
