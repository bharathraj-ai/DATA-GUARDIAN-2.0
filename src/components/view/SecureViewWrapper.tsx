'use client';

import React from 'react';
import { SecurityShield } from './SecurityShield';
import { SuddenExitGuard } from './SuddenExitGuard';

interface SecureViewWrapperProps {
    token: string;
    viewerEmail?: string;
    deviceHash?: string;
    /** High-sensitivity: blur also revokes. Default false. */
    strictCaptureMode?: boolean;
    children: React.ReactNode;
}

/**
 * Wraps secure view/editor content with screenshot deterrence, forensic
 * watermarking, idle cover, and session revoke. Does not claim absolute
 * OS/camera capture prevention.
 */
export function SecureViewWrapper({
    token,
    viewerEmail,
    deviceHash,
    strictCaptureMode = false,
    children,
}: SecureViewWrapperProps) {
    return (
        <SecurityShield
            token={token}
            viewerEmail={viewerEmail}
            deviceHash={deviceHash}
            enableWatermark={true}
            strictCaptureMode={strictCaptureMode}
            idleCoverMs={45_000}
        >
            <SuddenExitGuard token={token} />
            {children}
        </SecurityShield>
    );
}
