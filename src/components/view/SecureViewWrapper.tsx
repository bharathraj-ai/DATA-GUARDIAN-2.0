'use client';

import React from 'react';
import { SecurityShield } from './SecurityShield';
import { SuddenExitGuard } from './SuddenExitGuard';

interface SecureViewWrapperProps {
    token: string;
    viewerEmail?: string;
    children: React.ReactNode;
}

/**
 * Wraps secure view/editor content with screenshot and session protections.
 * Suspicious activity terminates the vendor session inside SecurityShield
 * (no reload — that would restore decrypted data if revoke is still in flight).
 */
export function SecureViewWrapper({ token, viewerEmail, children }: SecureViewWrapperProps) {
    return (
        <SecurityShield
            token={token}
            viewerEmail={viewerEmail}
            enableWatermark={true}
        >
            <SuddenExitGuard token={token} />
            {children}
        </SecurityShield>
    );
}
