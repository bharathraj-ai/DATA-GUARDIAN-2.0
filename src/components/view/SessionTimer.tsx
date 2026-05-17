'use client';

import React, { useEffect, useRef, memo } from 'react';
import { useCollaborationStore } from '@/store/useCollaborationStore';

/**
 * SessionTimer — isolated component that re-renders every second.
 * Separated from the main layout so countdown ticks never cause the
 * entire ViewPage tree to re-render.
 */
export const SessionTimer = memo(function SessionTimer() {
    const remainingSeconds = useCollaborationStore((s) => s.remainingSeconds);
    const updateRemainingSeconds = useCollaborationStore((s) => s.updateRemainingSeconds);
    const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Local countdown: ticks down every second between server heartbeats
    useEffect(() => {
        if (tickRef.current) clearInterval(tickRef.current);
        if (remainingSeconds <= 0) return;

        tickRef.current = setInterval(() => {
            updateRemainingSeconds(Math.max(0, remainingSeconds - 1));
        }, 1000);

        return () => {
            if (tickRef.current) clearInterval(tickRef.current);
        };
    }, [remainingSeconds]); // eslint-disable-line react-hooks/exhaustive-deps

    const mins = Math.floor(remainingSeconds / 60);
    const secs = remainingSeconds % 60;
    const formatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    const urgency =
        remainingSeconds <= 30 ? 'timer-critical' :
        remainingSeconds <= 60 ? 'timer-warning' :
        'timer-safe';

    return (
        <div className={`countdown-bar ${urgency}`} aria-live="polite" aria-atomic="true">
            <span className="countdown-label">Expires in</span>
            <span className="countdown-time">{formatted}</span>
        </div>
    );
});
