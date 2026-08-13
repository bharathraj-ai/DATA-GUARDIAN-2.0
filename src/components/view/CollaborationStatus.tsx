'use client';

import React from 'react';
import type { EditLockUiState } from '@/store/useCollaborationStore';

export function CollaborationStatus({ state }: { state: EditLockUiState }) {
    if (state === 'idle' || state === 'blocked' || state === 'can_request') {
        const busy = state === 'blocked' || state === 'can_request';
        return (
            <span style={pill(busy ? '#fef2f2' : '#f1f5f9', busy ? '#b91c1c' : '#64748b', busy ? '#fecaca' : '#e2e8f0')}>
                {busy ? 'View only' : 'Not editing'}
            </span>
        );
    }
    if (state === 'editing') {
        return <span style={pill('#ecfdf5', '#047857', '#a7f3d0')}>You are editing</span>;
    }
    if (state === 'takeover_warning') {
        return <span style={pill('#fffbeb', '#b45309', '#fde68a')}>Edit access requested</span>;
    }
    if (state === 'waiting_takeover') {
        return <span style={pill('#e0f2fe', '#0369a1', '#7dd3fc')}>Waiting for current editor</span>;
    }
    return <span style={pill('#fef2f2', '#b91c1c', '#fecaca')}>Editing access revoked</span>;
}

function pill(bg: string, color: string, border: string): React.CSSProperties {
    return {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 12px',
        borderRadius: 999,
        background: bg,
        color,
        border: `1px solid ${border}`,
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: '-0.01em',
        whiteSpace: 'nowrap',
        boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
    };
}
