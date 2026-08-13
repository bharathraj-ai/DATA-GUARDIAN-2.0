'use client';

import React, { useState } from 'react';
import { takeBreak } from '@/actions/break-session';
import { Ban, CheckCircle2, Info, Coffee, Loader2 } from 'lucide-react';
import styles from './vaultDock.module.css';

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

    const showToast = (type: ToastType, title: string, message: string) => {
        setToast({ visible: true, type, title, message });
        setTimeout(() => setToast(prev => ({ ...prev, visible: false })), 5000);
    };

    const handleBreak = async () => {
        setIsLoading(true);
        try {
            // Do NOT ship the full draft blob on break — that is what made "Saving Session" slow.
            // Background autosave already persists work; we only send a tiny resume pointer.
            const payload = {
                resumePoint: {
                    path: window.location.pathname,
                    scroll: window.scrollY,
                },
                draftVersion: 999999,
            };

            const res = await takeBreak(token, payload);
            if (res.success) {
                try {
                    sessionStorage.setItem('dg:post-break-redirect', '1');
                } catch {
                    /* ignore */
                }
                window.location.replace('/dashboard/vendor');
                return;
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
    const toastConfig: Record<ToastType, { icon: React.ReactNode; bg: string; border: string; accent: string }> = {
        error: { icon: <Ban size={20} color="#ef4444" />, bg: 'rgba(239, 68, 68, 0.08)', border: 'rgba(239, 68, 68, 0.3)', accent: '#ef4444' },
        success: { icon: <CheckCircle2 size={20} color="#22c55e" />, bg: 'rgba(34, 197, 94, 0.08)', border: 'rgba(34, 197, 94, 0.3)', accent: '#22c55e' },
        info: { icon: <Info size={20} color="#3b82f6" />, bg: 'rgba(59, 130, 246, 0.08)', border: 'rgba(59, 130, 246, 0.3)', accent: '#3b82f6' },
    };

    const cfg = toastConfig[toast.type];

    return (
        <>
            <button
                className={styles.break}
                onClick={handleBreak}
                disabled={isLoading}
                id="break-work-btn"
            >
                {isLoading ? (
                    <>
                        <Loader2 size={16} className={styles.spin} />
                        Saving session…
                    </>
                ) : (
                    <>
                        <Coffee size={16} /> Take a break
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
