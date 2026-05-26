'use client';

import React, { useState } from 'react';
import { completeWork } from '@/actions/complete-work';

export function CompleteWorkButton({ token }: { token: string }) {
    const [isLoading, setIsLoading] = useState(false);
    const [isSuccess, setIsSuccess] = useState(false);

    const handleComplete = async () => {
        setIsLoading(true);
        try {
            const res = await completeWork(token);
            if (res.success) {
                setIsSuccess(true);
                // Brief delay to show success state before redirect
                setTimeout(() => {
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
            <div style={{
                width: '100%',
                padding: '16px',
                marginTop: '16px',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, rgba(16,185,129,0.15), rgba(5,150,105,0.15))',
                border: '1px solid rgba(16,185,129,0.3)',
                textAlign: 'center',
            }}>
                <div style={{ fontSize: '24px', marginBottom: '8px' }}>✅</div>
                <div style={{ color: '#10b981', fontWeight: 600, fontSize: '15px' }}>
                    Work Completed Successfully!
                </div>
                <div style={{ color: '#6ee7b7', fontSize: '13px', marginTop: '4px' }}>
                    All files have been delivered to the owner&apos;s email.
                </div>
            </div>
        );
    }

    return (
        <button
            onClick={handleComplete}
            disabled={isLoading}
            id="complete-work-btn"
            style={{
                width: '100%',
                padding: '14px 20px',
                marginTop: '16px',
                borderRadius: '12px',
                border: 'none',
                background: isLoading
                    ? 'linear-gradient(135deg, #6b7280, #4b5563)'
                    : 'linear-gradient(135deg, #10b981, #059669)',
                color: 'white',
                fontWeight: 600,
                fontSize: '15px',
                cursor: isLoading ? 'not-allowed' : 'pointer',
                opacity: isLoading ? 0.8 : 1,
                transition: 'all 0.3s ease',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                boxShadow: isLoading ? 'none' : '0 4px 14px rgba(16,185,129,0.3)',
            }}
            onMouseOver={(e) => {
                if (!isLoading) {
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.boxShadow = '0 6px 20px rgba(16,185,129,0.4)';
                }
            }}
            onMouseOut={(e) => {
                if (!isLoading) {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = '0 4px 14px rgba(16,185,129,0.3)';
                }
            }}
        >
            {isLoading ? (
                <>
                    <span style={{
                        width: '16px', height: '16px', border: '2px solid rgba(255,255,255,0.3)',
                        borderTopColor: '#fff', borderRadius: '50%',
                        animation: 'spin 0.8s linear infinite',
                    }} />
                    Delivering files to owner...
                </>
            ) : (
                <>
                    ✅ Complete Work & Deliver Files
                </>
            )}
        </button>
    );
}
