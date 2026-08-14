'use client';

import React, { useEffect, useRef, useState } from 'react';
import { completeWork } from '@/actions/complete-work';
import { CheckCircle2, Check, Loader2 } from 'lucide-react';
import styles from './vaultDock.module.css';
import { markInternalNavigation } from './sudden-exit-client';

export function CompleteWorkButton({ token }: { token: string }) {
    const [isLoading, setIsLoading] = useState(false);
    const [isSuccess, setIsSuccess] = useState(false);
    const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => () => {
        if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    }, []);

    const handleComplete = async () => {
        setIsLoading(true);
        try {
            const res = await completeWork(token);
            if (res.success) {
                setIsSuccess(true);
                markInternalNavigation();
                if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
                reloadTimerRef.current = setTimeout(() => {
                    window.location.reload();
                }, 2000);
            } else {
                alert(res.error || 'Failed to complete work.');
            }
        } catch (err) {
            console.error('Error completing work:', err);
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
