'use client';

import React, { useState } from 'react';
import { completeWork } from '@/actions/complete-work';
import { CheckCircle2, Check, Loader2 } from 'lucide-react';
import styles from './vaultDock.module.css';
import { markInternalNavigation, markWorkCompleted } from './sudden-exit-client';

export function CompleteWorkButton({ token }: { token: string }) {
    const [isLoading, setIsLoading] = useState(false);
    const [isSuccess, setIsSuccess] = useState(false);

    const handleComplete = async () => {
        setIsLoading(true);
        // Pre-arm flags before network call so background SSE, blur, or visibility checks know work is completing
        markWorkCompleted();
        markInternalNavigation();

        try {
            const res = await completeWork(token);
            if (res.success) {
                markWorkCompleted();
                markInternalNavigation();
                setIsSuccess(true);
                window.dispatchEvent(new CustomEvent('dg:work-completed', { detail: { token } }));
            } else {
                try {
                    sessionStorage.removeItem('dg:work-completed');
                } catch {
                    /* ignore */
                }
                if (typeof window !== 'undefined') {
                    (window as Window & { __DG_WORK_COMPLETED__?: boolean }).__DG_WORK_COMPLETED__ = false;
                }
                alert(res.error || 'Failed to complete work.');
            }
        } catch (err) {
            console.error('Error completing work:', err);
            try {
                sessionStorage.removeItem('dg:work-completed');
            } catch {
                /* ignore */
            }
            if (typeof window !== 'undefined') {
                (window as Window & { __DG_WORK_COMPLETED__?: boolean }).__DG_WORK_COMPLETED__ = false;
            }
            alert('An error occurred.');
        } finally {
            setIsLoading(false);
        }
    };

    if (isSuccess) {
        return (
            <div className={styles.success}>
                <CheckCircle2 size={28} className={styles.successIcon} />
                <div>
                    <strong>Work delivered</strong>
                    <p>All files have been sent to the owner’s email.</p>
                </div>
            </div>
        );
    }

    return (
        <button
            className={styles.complete}
            onClick={handleComplete}
            disabled={isLoading}
            id="complete-work-btn"
        >
            {isLoading ? (
                <>
                    <Loader2 size={16} className={styles.spin} />
                    Delivering files to owner…
                </>
            ) : (
                <>
                    <Check size={16} /> Complete work & deliver files
                </>
            )}
        </button>
    );
}
