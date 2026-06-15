'use client';

import React, { useState } from 'react';
import { takeBreak } from '@/actions/break-session';
import { useRouter } from 'next/navigation';

type ToastType = 'error' | 'success' | 'info';

interface ToastState {
    visible: boolean;
    type: ToastType;
    title: string;
    message: string;
}

export function BreakButton({ token }: { token: string }) {
    const [isLoading, setIsLoading] = useState(false);
    const [toast, setToast] = useState<ToastState>({ visible: false, type: 'error', title: '', message: '' });
    const router = useRouter();

    const showToast = (type: ToastType, title: string, message: string) => {
        setToast({ visible: true, type, title, message });
        // Auto-dismiss after 5 seconds
        setTimeout(() => setToast(prev => ({ ...prev, visible: false })), 5000);
    };

    const handleBreak = async () => {
        setIsLoading(true);
        try {
            const lastSavedWork = (window as any).__VENDOR_DRAFT__ || null;
            const resumePoint = {
                path: window.location.pathname,
                scroll: window.scrollY
            };

            const payload = {
                lastSavedWork,
                resumePoint,
                draftVersion: 999999,
            };

            const res = await takeBreak(token, payload);
            if (res.success) {
                showToast('success', 'Break Started', res.message || 'New OTP sent to your email.');
                // Small delay so user sees the toast before redirect
                setTimeout(() => {
                    router.push(`/share/${token}?status=break`);
                    router.refresh();
                }, 1500);
            } else {
                showToast('error', 'Break Failed', res.error || 'Failed to take break.');
            }
        } catch (err) {
            console.error('Error taking break:', err);
            showToast('error', 'Error', 'An unexpected error occurred. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    // Toast icon based on type
    const toastConfig: Record<ToastType, { icon: string; bg: string; border: string; accent: string }> = {
        error: { icon: '🚫', bg: 'rgba(239, 68, 68, 0.08)', border: 'rgba(239, 68, 68, 0.3)', accent: '#ef4444' },
        success: { icon: '✅', bg: 'rgba(34, 197, 94, 0.08)', border: 'rgba(34, 197, 94, 0.3)', accent: '#22c55e' },
        info: { icon: 'ℹ️', bg: 'rgba(59, 130, 246, 0.08)', border: 'rgba(59, 130, 246, 0.3)', accent: '#3b82f6' },
    };

    const cfg = toastConfig[toast.type];

    return (
        <>
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

            {/* Toast Popup — replaces native alert() */}
            {toast.visible && (
                <div
                    id="break-toast-overlay"
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        width: '100vw',
                        height: '100vh',
                        backgroundColor: 'rgba(0, 0, 0, 0.4)',
                        backdropFilter: 'blur(4px)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 9999,
                        animation: 'fadeIn 0.2s ease-out',
                    }}
                    onClick={() => setToast(prev => ({ ...prev, visible: false }))}
                >
                    <div
                        id="break-toast-popup"
                        style={{
                            background: '#1a1a2e',
                            border: `1px solid ${cfg.border}`,
                            borderRadius: '16px',
                            padding: '28px 32px',
                            maxWidth: '420px',
                            width: '90%',
                            boxShadow: `0 20px 60px rgba(0,0,0,0.5), 0 0 30px ${cfg.accent}22`,
                            animation: 'popIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            marginBottom: '16px',
                        }}>
                            <div style={{
                                width: '44px',
                                height: '44px',
                                borderRadius: '12px',
                                background: cfg.bg,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '22px',
                                flexShrink: 0,
                            }}>
                                {cfg.icon}
                            </div>
                            <h3 style={{
                                margin: 0,
                                color: '#f1f5f9',
                                fontSize: '18px',
                                fontWeight: 600,
                                letterSpacing: '-0.01em',
                            }}>
                                {toast.title}
                            </h3>
                        </div>

                        {/* Message */}
                        <p style={{
                            margin: '0 0 20px',
                            color: '#94a3b8',
                            fontSize: '14px',
                            lineHeight: 1.6,
                        }}>
                            {toast.message}
                        </p>

                        {/* Close Button */}
                        <button
                            id="break-toast-close"
                            onClick={() => setToast(prev => ({ ...prev, visible: false }))}
                            style={{
                                width: '100%',
                                padding: '10px 20px',
                                borderRadius: '10px',
                                border: `1px solid ${cfg.border}`,
                                background: cfg.bg,
                                color: cfg.accent,
                                fontWeight: 600,
                                fontSize: '14px',
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.background = cfg.accent;
                                e.currentTarget.style.color = '#fff';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.background = cfg.bg;
                                e.currentTarget.style.color = cfg.accent;
                            }}
                        >
                            OK
                        </button>
                    </div>

                    {/* Animations */}
                    <style>{`
                        @keyframes fadeIn {
                            from { opacity: 0; }
                            to { opacity: 1; }
                        }
                        @keyframes popIn {
                            from { opacity: 0; transform: scale(0.9) translateY(10px); }
                            to { opacity: 1; transform: scale(1) translateY(0); }
                        }
                    `}</style>
                </div>
            )}
        </>
    );
}
