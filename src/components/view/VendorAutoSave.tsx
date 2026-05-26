'use client';

import React, { useEffect, useRef } from 'react';
import { autosaveSession } from '@/actions/autosave';

interface VendorAutoSaveProps {
    token: string;
}

export function VendorAutoSave({ token }: VendorAutoSaveProps) {
    const draftVersionRef = useRef(1);

    useEffect(() => {
        const performAutosave = async (isBeacon = false) => {
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
            }
        };

        // 1. Auto-save every 60 seconds
        const timer = setInterval(() => performAutosave(false), 60000);

        // 2. Auto-save on window close (best effort)
        const handleBeforeUnload = () => performAutosave(true);
        window.addEventListener('beforeunload', handleBeforeUnload);

        // 3. Listen to major edit events from editor
        const handleMajorEdit = () => performAutosave(false);
        window.addEventListener('vendor-major-edit', handleMajorEdit);

        return () => {
            clearInterval(timer);
            window.removeEventListener('beforeunload', handleBeforeUnload);
            window.removeEventListener('vendor-major-edit', handleMajorEdit);
        };
    }, [token]);

    return null; // Invisible component
}
