'use client';

import React, { useState } from 'react';
import { takeBreak } from '@/actions/break-session';
import { useRouter } from 'next/navigation';

export function BreakButton({ token }: { token: string }) {
    const [isLoading, setIsLoading] = useState(false);
    const router = useRouter();

    const handleBreak = async () => {
        setIsLoading(true);
        try {
            // Collect draft state if any
            const lastSavedWork = (window as any).__VENDOR_DRAFT__ || null;
            const resumePoint = {
                path: window.location.pathname,
                scroll: window.scrollY
            };

            const payload = {
                lastSavedWork,
                resumePoint,
                // Typically we'd read current version from a ref/context, 
                // but passing 1 forces at least a baseline save. 
                // A better approach couples this button with the autosave context.
                draftVersion: 999999, // Force save for break
            };

            const res = await takeBreak(token, payload);
            if (res.success) {
                // Redirect to login page
                router.push(`/share/${token}?status=break`);
                router.refresh();
            } else {
                alert(res.error || 'Failed to take break.');
            }
        } catch (err) {
            console.error('Error taking break:', err);
            alert('An error occurred.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <button
            className="btn btn-secondary"
            onClick={handleBreak}
            disabled={isLoading}
            id="break-work-btn"
            style={{
                width: '100%',
                padding: '16px 20px',
                marginTop: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '10px',
                opacity: isLoading ? 0.8 : 1,
                cursor: isLoading ? 'not-allowed' : 'pointer'
            }}
        >
            {isLoading ? (
                <>
                    <span style={{
                        width: '16px', height: '16px', border: '2px solid rgba(17, 24, 39, 0.3)',
                        borderTopColor: '#111827', borderRadius: '50%',
                        animation: 'spin 0.8s linear infinite',
                    }} />
                    Saving Session...
                </>
            ) : (
                <>
                    ⏸️ Take a Break (Save & Logout)
                </>
            )}
        </button>
    );
}
