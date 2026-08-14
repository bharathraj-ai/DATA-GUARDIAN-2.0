'use client';

import React, { useCallback, useEffect, useRef } from 'react';
import { SecurityShield } from './SecurityShield';
import { SuddenExitGuard } from './SuddenExitGuard';

interface SecureViewWrapperProps {
    token: string;
    viewerEmail?: string;
    children: React.ReactNode;
}

/**
 * SecureViewWrapper — Wraps the secure view content with SecurityShield protections.
 * 
 * Handles:
 * - Tab switch limit enforcement
 * - Session termination callbacks
 * - Passes viewer identity to watermark
 */
export function SecureViewWrapper({ token, viewerEmail, children }: SecureViewWrapperProps) {
    const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => {
        if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    }, []);

    const handleSessionTerminate = useCallback((reason: string) => {
        if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
        reloadTimerRef.current = setTimeout(() => {
            window.location.reload();
        }, 5000);
    }, []);

    const handleTabSwitch = useCallback((count: number) => {
        // Parent can implement additional logic here
        // e.g., call a server action to flag the session
    }, []);

    return (
        <SecurityShield
            token={token}
            viewerEmail={viewerEmail}
            onTabSwitch={handleTabSwitch}
            onSessionTerminate={handleSessionTerminate}
            maxTabSwitches={3}
            enableWatermark={true}
        >
            <SuddenExitGuard token={token} />
            {children}
        </SecurityShield>
    );
}
