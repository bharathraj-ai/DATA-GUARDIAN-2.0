'use client';

import React, { useEffect, useRef } from 'react';
import { autosaveSession } from '@/actions/autosave';

interface VendorAutoSaveProps {
    token: string;
}

export function VendorAutoSave({ token }: VendorAutoSaveProps) {
    const draftVersionRef = useRef(1);

    useEffect(() => {
        const isSavingRef = { current: false };
        let majorEditDebounce: ReturnType<typeof setTimeout> | null = null;

        const performAutosave = async (isBeacon = false) => {
            if (isSavingRef.current) return;
            isSavingRef.current = true;

            try {
                // Collect state from wherever it's globally stored (e.g., window object, local storage)
                const lastSavedWork = (window as any).__VENDOR_DRAFT__ || null;
                const resumePoint = {
                    path: window.location.pathname,
                    scroll: window.scrollY
                };

                const payload = {
                    lastSavedWork,
                    resumePoint,
                    draftVersion: draftVersionRef.current,
                };

                if (isBeacon && typeof navigator.sendBeacon === 'function') {
                    // Optional: implementation of sendBeacon if we had a dedicated API route
                    // Since autosaveSession is a server action, it's easier to just fire and forget it,
                    // but beforeunload doesn't wait for promises. We'll just call it and hope it completes.
                    autosaveSession(token, payload).catch(console.error);
                } else {
                    const res = await autosaveSession(token, payload);
                    if (res.success && res.draftVersion) {
                        draftVersionRef.current = res.draftVersion;
                    }
                }
            } catch (error) {
                console.error('Autosave failed:', error);
            } finally {
                isSavingRef.current = false;
            }
        };

        // First save after 45s, then every 60s — skip empty drafts on mount
        const timer = setInterval(() => {
            if (!(window as any).__VENDOR_DRAFT__ && draftVersionRef.current <= 1) return;
            performAutosave(false);
        }, 60000);
        const first = window.setTimeout(() => {
            if (!(window as any).__VENDOR_DRAFT__) return;
            performAutosave(false);
        }, 45000);

        // 2. Auto-save on window close (best effort)
        const handleBeforeUnload = () => performAutosave(true);
        window.addEventListener('beforeunload', handleBeforeUnload);

        // 3. Listen to major edit events from editor (debounced 300ms)
        const handleMajorEdit = () => {
            if (majorEditDebounce) clearTimeout(majorEditDebounce);
            majorEditDebounce = setTimeout(() => performAutosave(false), 300);
        };
        window.addEventListener('vendor-major-edit', handleMajorEdit);

        return () => {
            clearInterval(timer);
            window.clearTimeout(first);
            if (majorEditDebounce) clearTimeout(majorEditDebounce);
            window.removeEventListener('beforeunload', handleBeforeUnload);
            window.removeEventListener('vendor-major-edit', handleMajorEdit);
        };
    }, [token]);

    return null; // Invisible component
}
