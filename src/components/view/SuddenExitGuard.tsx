'use client';

import { useEffect, useRef } from 'react';
import {
    consumeInternalNavigation,
    consumeReloadShortcut,
    markReloadShortcut,
    parseEditorFileIdFromPath,
    readEditClientInstanceId,
} from './sudden-exit-client';

/**
 * On sudden tab/browser close: force draft save + rotate OTP + release edit lock.
 * Skips in-app navigation (view ↔ editor, take break) and F5 / Ctrl+R reload.
 */
export function SuddenExitGuard({ token }: { token: string }) {
    const firedRef = useRef(false);
    const skipRef = useRef(false);

    useEffect(() => {
        const fire = () => {
            if (firedRef.current || skipRef.current) return;
            if (consumeInternalNavigation() || consumeReloadShortcut()) {
                skipRef.current = true;
                return;
            }
            firedRef.current = true;

            window.dispatchEvent(
                new CustomEvent('dg:force-autosave', { detail: {} }),
            );

            const fileId = parseEditorFileIdFromPath(window.location.pathname, token);
            const payload = JSON.stringify({
                token,
                fileId: fileId || undefined,
                clientInstanceId: fileId ? readEditClientInstanceId(fileId) : undefined,
                lastSavedWork: (window as Window & { __VENDOR_DRAFT__?: unknown }).__VENDOR_DRAFT__ ?? undefined,
                resumePoint: {
                    path: window.location.pathname,
                    scroll: window.scrollY,
                },
                draftVersion: 999999,
            });

            const url = '/api/session/sudden-exit';
            const blob = new Blob([payload], { type: 'application/json' });
            navigator.sendBeacon?.(url, blob);
            void fetch(url, {
                method: 'POST',
                body: payload,
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                keepalive: true,
            }).catch(() => undefined);
        };

        const onKeyDown = (e: KeyboardEvent) => {
            const key = e.key.toLowerCase();
            if (key === 'f5' || ((e.ctrlKey || e.metaKey) && key === 'r')) {
                markReloadShortcut();
            }
        };

        const onPageHide = (e: PageTransitionEvent) => {
            if (e.persisted) return;
            fire();
        };

        window.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('pagehide', onPageHide);
        window.addEventListener('beforeunload', fire);
        return () => {
            window.removeEventListener('keydown', onKeyDown, true);
            window.removeEventListener('pagehide', onPageHide);
            window.removeEventListener('beforeunload', fire);
        };
    }, [token]);

    return null;
}
