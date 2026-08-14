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

        const performAutosave = async () => {
            if (isSavingRef.current) return;
            isSavingRef.current = true;

            try {
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

                const res = await autosaveSession(token, payload);
                if (res.success && res.draftVersion) {
                    draftVersionRef.current = res.draftVersion;
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
            performAutosave();
        }, 60000);
        const first = window.setTimeout(() => {
            if (!(window as any).__VENDOR_DRAFT__) return;
            performAutosave();
        }, 45000);

        // Close/unload save is handled by SuddenExitGuard (draft + OTP rotation).

        // 2. Listen to major edit events from editor (debounced 300ms)
        const handleMajorEdit = () => {
            if (majorEditDebounce) clearTimeout(majorEditDebounce);
            majorEditDebounce = setTimeout(() => performAutosave(), 300);
        };
        window.addEventListener('vendor-major-edit', handleMajorEdit);

        return () => {
            clearInterval(timer);
            window.clearTimeout(first);
            if (majorEditDebounce) clearTimeout(majorEditDebounce);
            window.removeEventListener('vendor-major-edit', handleMajorEdit);
        };
    }, [token]);

    return null; // Invisible component
}
