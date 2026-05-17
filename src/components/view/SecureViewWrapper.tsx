'use client';

import React, { useCallback } from 'react';
import { SecurityShield } from './SecurityShield';

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
    const handleSessionTerminate = useCallback((reason: string) => {
        // Force reload after short delay to show server-side error state
        setTimeout(() => {
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
            {children}
        </SecurityShield>
    );
}
