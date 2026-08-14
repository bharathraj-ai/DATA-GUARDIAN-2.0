'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { takeBreak } from '@/actions/break-session';
import { Ban, CheckCircle2, Info, Coffee, Loader2 } from 'lucide-react';
import styles from './vaultDock.module.css';
import { markInternalNavigation } from './sudden-exit-client';

type ToastType = 'error' | 'success' | 'info';

interface ToastState {
    visible: boolean;
    type: ToastType;
    title: string;
    message: string;
}

const NO_BREAK_TITLE = "You don't have a break";
const NO_BREAK_MESSAGE =
    'This session has no remaining breaks. Stay in the vault and continue your work, or complete and deliver the files.';

export function BreakButton({
    token,
    allowedBreaks = 0,
    breaksUsed = 0,
}: {
    token: string;
    allowedBreaks?: number;
    breaksUsed?: number;
}) {
    const [isLoading, setIsLoading] = useState(false);
    const [mounted, setMounted] = useState(false);
    const [remaining, setRemaining] = useState(() => Math.max(0, allowedBreaks - breaksUsed));
    const [toast, setToast] = useState<ToastState>({ visible: false, type: 'error', title: '', message: '' });

    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        setRemaining(Math.max(0, allowedBreaks - breaksUsed));
    }, [allowedBreaks, breaksUsed]);

    const showToast = (type: ToastType, title: string, message: string) => {
        setToast({ visible: true, type, title, message });
    };

    const showNoBreakNotice = (used = breaksUsed, allowed = allowedBreaks) => {
        const usedLabel = allowed > 0 ? ` You have used ${used} of ${allowed}.` : '';
        showToast('error', NO_BREAK_TITLE, `${NO_BREAK_MESSAGE}${usedLabel}`);
    };

    const handleBreak = async () => {
        if (remaining <= 0) {
            showNoBreakNotice();
            return;
        }

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

            try {
                sessionStorage.setItem('dg:post-break-redirect', '1');
            } catch {
                /* ignore */
            }

            const res = await takeBreak(token, payload);
            if (res.success) {
                markInternalNavigation();
                window.location.replace('/dashboard/vendor');
                return;
            }

            if (typeof res.breaksRemaining === 'number') {
                setRemaining(Math.max(0, res.breaksRemaining));
            }

            if (res.errorType === 'NO_BREAKS') {
                showNoBreakNotice(res.breaksUsed ?? breaksUsed, allowedBreaks);
            } else {
                showToast('error', 'Break failed', res.error || 'Failed to take a break. Please try again.');
            }
        } catch (err) {
            console.error('Error taking break:', err);
            showToast('error', 'Error', 'An unexpected error occurred. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    const toastConfig: Record<ToastType, { icon: React.ReactNode; bg: string; border: string; accent: string }> = {
        error: { icon: <Ban size={20} color="#ef4444" />, bg: 'rgba(239, 68, 68, 0.08)', border: 'rgba(239, 68, 68, 0.3)', accent: '#ef4444' },
        success: { icon: <CheckCircle2 size={20} color="#22c55e" />, bg: 'rgba(34, 197, 94, 0.08)', border: 'rgba(34, 197, 94, 0.3)', accent: '#22c55e' },
        info: { icon: <Info size={20} color="#3b82f6" />, bg: 'rgba(59, 130, 246, 0.08)', border: 'rgba(59, 130, 246, 0.3)', accent: '#3b82f6' },
    };

    const cfg = toastConfig[toast.type];

    const notice = toast.visible && mounted
        ? createPortal(
            <div
                id="break-toast-overlay"
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="break-toast-title"
                aria-describedby="break-toast-message"
                style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    backgroundColor: 'rgba(15, 23, 42, 0.55)',
                    backdropFilter: 'blur(6px)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 2147483647,
                    animation: 'dgBreakFadeIn 0.2s ease-out',
                }}
                onClick={() => setToast((prev) => ({ ...prev, visible: false }))}
            >
                <div
                    id="break-toast-popup"
                    style={{
                        background: '#ffffff',
                        border: `1px solid ${cfg.border}`,
                        borderRadius: '18px',
                        padding: '28px 32px',
                        maxWidth: '440px',
                        width: 'min(90%, calc(100% - 24px))',
                        maxHeight: 'min(92dvh, 90vh)',
                        overflowY: 'auto',
                        boxShadow: `0 24px 64px rgba(15, 23, 42, 0.28), 0 0 0 1px ${cfg.accent}22`,
                        animation: 'dgBreakPopIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
                    }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                        <div
                            style={{
                                width: '44px',
                                height: '44px',
                                borderRadius: '12px',
                                background: cfg.bg,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                            }}
                        >
                            {cfg.icon}
                        </div>
                        <h3
                            id="break-toast-title"
                            style={{
                                margin: 0,
                                color: '#0f172a',
                                fontSize: '18px',
                                fontWeight: 700,
                                letterSpacing: '-0.01em',
                            }}
                        >
                            {toast.title}
                        </h3>
                    </div>

                    <p
                        id="break-toast-message"
                        style={{
                            margin: '0 0 20px',
                            color: '#475569',
                            fontSize: '15px',
                            lineHeight: 1.6,
                        }}
                    >
                        {toast.message}
                    </p>

                    <button
                        id="break-toast-close"
                        type="button"
                        onClick={() => setToast((prev) => ({ ...prev, visible: false }))}
                        style={{
                            width: '100%',
                            padding: '12px 20px',
                            borderRadius: '10px',
                            border: `1px solid ${cfg.border}`,
                            background: cfg.bg,
                            color: cfg.accent,
                            fontWeight: 700,
                            fontSize: '14px',
                            cursor: 'pointer',
                        }}
                    >
                        OK
                    </button>
                </div>

                <style>{`
                    @keyframes dgBreakFadeIn {
                        from { opacity: 0; }
                        to { opacity: 1; }
                    }
                    @keyframes dgBreakPopIn {
                        from { opacity: 0; transform: scale(0.9) translateY(10px); }
                        to { opacity: 1; transform: scale(1) translateY(0); }
                    }
                `}</style>
            </div>,
            document.body,
        )
        : null;

    return (
        <>
            <button
                className={styles.break}
                onClick={handleBreak}
                disabled={isLoading}
                id="break-work-btn"
                type="button"
                title={remaining <= 0 ? "You don't have a break left" : `${remaining} break${remaining === 1 ? '' : 's'} remaining`}
            >
                {isLoading ? (
                    <>
                        <Loader2 size={16} className={styles.spin} />
                        Saving session…
                    </>
                ) : (
                    <>
                        <Coffee size={16} />
                        Take a break{remaining > 0 ? ` (${remaining} left)` : ''}
                    </>
                )}
            </button>
            {notice}
        </>
    );
}
