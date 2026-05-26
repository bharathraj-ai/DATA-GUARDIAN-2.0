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
            onClick={handleBreak}
            disabled={isLoading}
            id="break-work-btn"
            style={{
                width: '100%',
                padding: '14px 20px',
                marginTop: '16px',
                borderRadius: '12px',
                border: '1px solid rgba(245,158,11,0.3)',
                background: isLoading
                    ? 'linear-gradient(135deg, #6b7280, #4b5563)'
                    : 'linear-gradient(135deg, rgba(245,158,11,0.1), rgba(217,119,6,0.1))',
                color: '#d97706',
                fontWeight: 600,
                fontSize: '15px',
                cursor: isLoading ? 'not-allowed' : 'pointer',
                opacity: isLoading ? 0.8 : 1,
                transition: 'all 0.3s ease',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
            }}
            onMouseOver={(e) => {
                if (!isLoading) {
                    e.currentTarget.style.background = 'linear-gradient(135deg, rgba(245,158,11,0.2), rgba(217,119,6,0.2))';
                }
            }}
            onMouseOut={(e) => {
                if (!isLoading) {
                    e.currentTarget.style.background = 'linear-gradient(135deg, rgba(245,158,11,0.1), rgba(217,119,6,0.1))';
                }
            }}
        >
            {isLoading ? (
                <>
                    <span style={{
                        width: '16px', height: '16px', border: '2px solid rgba(217,119,6,0.3)',
                        borderTopColor: '#d97706', borderRadius: '50%',
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
