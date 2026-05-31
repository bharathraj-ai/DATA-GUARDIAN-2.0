'use client';

import React, { useEffect, useState, useRef, useCallback, memo, useMemo } from 'react';

// ─── Types ──────────────────────────────────────────────────────────
interface SecurityShieldProps {
    token: string;
    /** Email of the current viewer (for watermark) */
    viewerEmail?: string;
    /** Called when the user switches tabs — parent can decide to revoke */
    onTabSwitch?: (count: number) => void;
    /** Called when session should be terminated due to security violations */
    onSessionTerminate?: (reason: string) => void;
    /** Max tab switches before session termination (default: 3) */
    maxTabSwitches?: number;
    /** Whether to show the dynamic watermark overlay (default: true) */
    enableWatermark?: boolean;
    /** Children to wrap with security protections */
    children?: React.ReactNode;
}

type SecurityEvent =
    | 'COPY_ATTEMPT' | 'CUT_ATTEMPT' | 'PASTE_ATTEMPT'
    | 'PRINT_ATTEMPT' | 'SAVE_ATTEMPT' | 'SELECT_ALL_ATTEMPT'
    | 'VIEW_SOURCE_ATTEMPT' | 'SCREENSHOT_ATTEMPT'
    | 'DEVTOOLS_SHORTCUT' | 'DEVTOOLS_DETECTED'
    | 'CONTEXT_MENU_ATTEMPT' | 'DRAG_ATTEMPT'
    | 'TAB_SWITCH' | 'SESSION_TERMINATED'
    | 'FOCUS_LOST' | 'FOCUS_REGAINED';

// ─── Blocked Key Combinations ───────────────────────────────────────
const BLOCKED_SHORTCUTS: Array<{
    ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean;
    key: string; event: SecurityEvent; message: string;
}> =
    [
        { ctrl: true, key: 'c', event: 'COPY_ATTEMPT', message: 'Copy is disabled for security' },
        { ctrl: true, key: 'x', event: 'CUT_ATTEMPT', message: 'Cut is disabled for security' },
        { ctrl: true, key: 'p', event: 'PRINT_ATTEMPT', message: 'Printing is disabled for security' },
        { ctrl: true, key: 's', event: 'SAVE_ATTEMPT', message: 'Saving is disabled — files are view-only' },
        { ctrl: true, key: 'a', event: 'SELECT_ALL_ATTEMPT', message: 'Select all is disabled for security' },
        { ctrl: true, key: 'u', event: 'VIEW_SOURCE_ATTEMPT', message: 'Viewing source is restricted' },
        { ctrl: true, shift: true, key: 'i', event: 'DEVTOOLS_SHORTCUT', message: 'Developer tools are restricted' },
        { ctrl: true, shift: true, key: 'j', event: 'DEVTOOLS_SHORTCUT', message: 'Developer tools are restricted' },
        { ctrl: true, shift: true, key: 'c', event: 'DEVTOOLS_SHORTCUT', message: 'Developer tools are restricted' },
        { ctrl: true, shift: true, key: 's', event: 'SCREENSHOT_ATTEMPT', message: 'Screenshot is disabled for security' },
        { meta: true, key: 'c', event: 'COPY_ATTEMPT', message: 'Copy is disabled for security' },
        { meta: true, key: 'x', event: 'CUT_ATTEMPT', message: 'Cut is disabled for security' },
        { meta: true, key: 'p', event: 'PRINT_ATTEMPT', message: 'Printing is disabled for security' },
        { meta: true, key: 's', event: 'SAVE_ATTEMPT', message: 'Saving is disabled for security' },
        { meta: true, key: 'a', event: 'SELECT_ALL_ATTEMPT', message: 'Select all is disabled for security' },
        { meta: true, key: 'u', event: 'VIEW_SOURCE_ATTEMPT', message: 'Viewing source is restricted' },
        { meta: true, shift: true, key: 'i', event: 'DEVTOOLS_SHORTCUT', message: 'Developer tools are restricted' },
        { ctrl: true, shift: true, key: 's', event: 'SCREENSHOT_ATTEMPT', message: 'Screenshot is disabled for security' },
        { meta: true, shift: true, key: 's', event: 'SCREENSHOT_ATTEMPT', message: 'Screenshot is disabled for security' },
        { key: 'PrintScreen', event: 'SCREENSHOT_ATTEMPT', message: 'Screenshots are restricted for security' },
        { alt: true, key: 'PrintScreen', event: 'SCREENSHOT_ATTEMPT', message: 'Screenshots are restricted for security' },
        
        { key: 'F12', event: 'DEVTOOLS_SHORTCUT', message: 'Developer tools are restricted' },
    ];

// ─── Component ──────────────────────────────────────────────────────
/**
 * SecurityShield — Enterprise-Grade Client-Side Security Deterrent
 *
 * ⚠️  IMPORTANT SECURITY DISCLAIMER:
 *     This is a DETERRENCE layer, NOT a security boundary.
 *     A determined attacker can bypass all client-side protections.
 *     True security is enforced server-side (RBAC, encrypted streams, audit logs).
 *
 * Protection Layers:
 *   1. Keyboard shortcut interception (Copy/Paste/Print/Save/DevTools/Source)
 *   2. Context menu (right-click) blocking
 *   3. Tab switch detection with configurable limit + session termination
 *   4. PrintScreen key detection with content blurring
 *   5. Clipboard API interception (copy/cut/paste events)
 *   6. Text selection disabled (CSS user-select: none)
 *   7. Drag-and-drop prevention
 *   8. Print media query blocking (CSS @media print)
 *   9. Dynamic watermark overlay (email + timestamp, moving position)
 *  10. DevTools detection (window size heuristic)
 *  11. Focus/blur tracking with content protection
 *  12. All events logged to server audit trail
 */
export const SecurityShield = memo(function SecurityShield({
    token,
    viewerEmail,
    onTabSwitch,
    onSessionTerminate,
    maxTabSwitches = 3,
    enableWatermark = true,
    children,
}: SecurityShieldProps) {
    const [tabSwitchCount, setTabSwitchCount] = useState(0);
    const [showWarning, setShowWarning] = useState(false);
    const [warningMessage, setWarningMessage] = useState('');
    const [warningLevel, setWarningLevel] = useState<'info' | 'warning' | 'critical'>('info');
    const [isBlurred, setIsBlurred] = useState(false);
    const [sessionTerminated, setSessionTerminated] = useState(false);
    const [watermarkOffset, setWatermarkOffset] = useState({ x: 0, y: 0 });
    const warningTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const eventQueueRef = useRef<Array<{ action: string; timestamp: number; metadata?: Record<string, unknown> }>>([]);
    const flushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // ── Flash Warning Banner ──
    const flashWarning = useCallback((msg: string, level: 'info' | 'warning' | 'critical' = 'info', durationMs = 3000) => {
        setWarningMessage(msg);
        setWarningLevel(level);
        setShowWarning(true);
        if (warningTimeoutRef.current) clearTimeout(warningTimeoutRef.current);
        warningTimeoutRef.current = setTimeout(() => setShowWarning(false), durationMs);
    }, []);

    // ── Temporary Content Blur (for screenshot deterrence) ──
    const blurContent = useCallback((durationMs = 2000) => {
        // Direct DOM manipulation for maximum speed
        const el = document.getElementById('security-content-wrapper');
        if (el) {
            el.classList.add('security-content-blur');
            el.classList.remove('security-content-normal');
        }
        
        setIsBlurred(true);
        if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
        blurTimeoutRef.current = setTimeout(() => {
            const el = document.getElementById('security-content-wrapper');
            if (el) {
                el.classList.remove('security-content-blur');
                el.classList.add('security-content-normal');
            }
            setIsBlurred(false);
        }, durationMs);
    }, []);

    // ── Batched Event Logging (debounced to reduce server load) ──
    const flushEvents = useCallback(async () => {
        const events = eventQueueRef.current.splice(0);
        if (events.length === 0) return;

        try {
            // Batch all events into a single POST request
            await fetch('/api/audit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, events }),
            }).catch(() => { }); // Silent fail — audit logging must never break UX
        } catch {
            // Silent fail — audit logging must never break UX
        }
    }, [token]);

    const logSecurityEvent = useCallback((action: SecurityEvent, metadata?: Record<string, unknown>) => {
        eventQueueRef.current.push({ action, timestamp: Date.now(), metadata });
        // Debounce flush: wait 500ms for more events before sending
        if (flushTimeoutRef.current) clearTimeout(flushTimeoutRef.current);
        flushTimeoutRef.current = setTimeout(flushEvents, 500);
    }, [flushEvents]);

    // ── Terminate Session ──
    const terminateSession = useCallback((reason: string) => {
        setSessionTerminated(true);
        logSecurityEvent('SESSION_TERMINATED', { reason });
        flashWarning(` Session terminated: ${reason}`, 'critical', 999999);
        onSessionTerminate?.(reason);
        // Flush immediately on termination
        setTimeout(flushEvents, 100);
    }, [logSecurityEvent, flashWarning, onSessionTerminate, flushEvents]);

    // ═══════════════════════════════════════════════════════════════
    // 1. KEYBOARD SHORTCUT INTERCEPTION
    // ═══════════════════════════════════════════════════════════════
    useEffect(() => {
        if (sessionTerminated) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            const key = e.key.toLowerCase();

            // INSTANT DOM BLUR for Meta/OS key to beat the OS screenshot tool
            if (e.metaKey || key === 'meta' || key === 'os') {
                const el = document.getElementById('security-content-wrapper');
                if (el) {
                    el.classList.add('security-content-blur');
                    el.classList.remove('security-content-normal');
                }
            }

            // F12 — DevTools
            if (key === 'f12') {
                e.preventDefault();
                e.stopPropagation();
                flashWarning(' Developer tools are restricted', 'warning');
                logSecurityEvent('DEVTOOLS_SHORTCUT');
                return;
            }

            // PrintScreen
            if (key === 'printscreen' || e.key === 'PrintScreen') {
                e.preventDefault();
                e.stopPropagation();
                blurContent(3000);
                flashWarning(' Screenshots are not permitted — content has been hidden', 'critical');
                logSecurityEvent('SCREENSHOT_ATTEMPT');
                try {
                    navigator.clipboard.writeText('Screenshots are disabled for security reasons.');
                } catch (err) { }
                return;
            }

            // Check blocked shortcut combinations
            for (const shortcut of BLOCKED_SHORTCUTS) {
                const ctrlMatch = shortcut.ctrl ? (e.ctrlKey || e.metaKey) : true;
                const metaMatch = shortcut.meta ? e.metaKey : true;
                const shiftMatch = shortcut.shift ? e.shiftKey : !e.shiftKey || shortcut.shift === undefined;

                if (ctrlMatch && metaMatch && shiftMatch && key === shortcut.key) {
                    // Make sure it's actually the right combo
                    if ((shortcut.ctrl && (e.ctrlKey || e.metaKey)) || (shortcut.meta && e.metaKey)) {
                        if (shortcut.shift && !e.shiftKey) continue;
                        if (!shortcut.shift && e.shiftKey && shortcut.key !== 'i' && shortcut.key !== 'j' && shortcut.key !== 'c') continue;

                        e.preventDefault();
                        e.stopPropagation();
                        flashWarning(` ${shortcut.message}`, 'warning');
                        logSecurityEvent(shortcut.event);
                        return;
                    }
                }
            }
        };

        const handleKeyUp = (e: KeyboardEvent) => {
            const key = e.key.toLowerCase();
            
            // Unblur if Meta is released and we still have focus
            if (key === 'meta' || key === 'os') {
                if (!document.hidden && document.hasFocus()) {
                    const el = document.getElementById('security-content-wrapper');
                    if (el) {
                        el.classList.remove('security-content-blur');
                        el.classList.add('security-content-normal');
                    }
                }
            }
            
            // Windows takes the screenshot and puts it in the clipboard on keyup
            // Overwrite the clipboard if they hit printscreen
            if (key === 'printscreen' || e.key === 'PrintScreen') {
                try {
                    navigator.clipboard.writeText('Screenshots are disabled for security reasons.');
                } catch (err) { }
                blurContent(3000);
                flashWarning(' Screenshots are not permitted. Clipboard cleared.', 'critical');
            }
        };

        document.addEventListener('keydown', handleKeyDown, { capture: true });
        document.addEventListener('keyup', handleKeyUp, { capture: true });
        return () => {
            document.removeEventListener('keydown', handleKeyDown, { capture: true });
            document.removeEventListener('keyup', handleKeyUp, { capture: true });
        };
    }, [sessionTerminated, flashWarning, logSecurityEvent, blurContent]);

    // ═══════════════════════════════════════════════════════════════
    // 2. CONTEXT MENU (RIGHT-CLICK) BLOCKING
    // ═══════════════════════════════════════════════════════════════
    useEffect(() => {
        if (sessionTerminated) return;

        const handleContextMenu = (e: MouseEvent) => {
            e.preventDefault();
            flashWarning(' Right-click is disabled for security', 'info');
            logSecurityEvent('CONTEXT_MENU_ATTEMPT');
        };

        document.addEventListener('contextmenu', handleContextMenu, { capture: true });
        return () => document.removeEventListener('contextmenu', handleContextMenu, { capture: true });
    }, [sessionTerminated, flashWarning, logSecurityEvent]);

    // ═══════════════════════════════════════════════════════════════
    // 3. TAB SWITCH DETECTION WITH SESSION TERMINATION
    // ═══════════════════════════════════════════════════════════════
    useEffect(() => {
        if (sessionTerminated) return;

        const handleVisibilityChange = () => {
            if (document.hidden) {
                // Direct DOM manipulation for maximum speed
                const el = document.getElementById('security-content-wrapper');
                if (el) {
                    el.classList.add('security-content-blur');
                    el.classList.remove('security-content-normal');
                }
                
                // Tab switched away — blur content immediately
                setIsBlurred(true);

                setTabSwitchCount((prev) => {
                    const next = prev + 1;
                    logSecurityEvent('TAB_SWITCH', { count: next, max: maxTabSwitches });
                    onTabSwitch?.(next);

                    if (next >= maxTabSwitches) {
                        terminateSession(`Maximum tab switches exceeded (${next}/${maxTabSwitches})`);
                    } else if (next === maxTabSwitches - 1) {
                        flashWarning(
                            ` WARNING: Tab switch ${next}/${maxTabSwitches}. ONE more switch will terminate your session!`,
                            'critical', 6000,
                        );
                    } else {
                        flashWarning(
                            `Tab switch detected (${next}/${maxTabSwitches}). Please stay on this page.`,
                            'warning', 4000,
                        );
                    }
                    return next;
                });
            } else {
                // Tab returned — unblur if session is still active
                if (!sessionTerminated) {
                    const el = document.getElementById('security-content-wrapper');
                    if (el) {
                        el.classList.remove('security-content-blur');
                        el.classList.add('security-content-normal');
                    }
                    setIsBlurred(false);
                    logSecurityEvent('FOCUS_REGAINED');
                }
            }
        };

        // Also track window blur/focus for more aggressive detection
        const handleBlur = () => {
            if (!document.hidden) {
                // Direct DOM manipulation for maximum speed
                const el = document.getElementById('security-content-wrapper');
                if (el) {
                    el.classList.add('security-content-blur');
                    el.classList.remove('security-content-normal');
                }

                // Window lost focus but tab not hidden (e.g., alt-tab)
                setIsBlurred(true);
                logSecurityEvent('FOCUS_LOST');
            }
        };

        const handleFocus = () => {
            if (!sessionTerminated) {
                const el = document.getElementById('security-content-wrapper');
                if (el) {
                    el.classList.remove('security-content-blur');
                    el.classList.add('security-content-normal');
                }
                setIsBlurred(false);
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('blur', handleBlur);
        window.addEventListener('focus', handleFocus);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('blur', handleBlur);
            window.removeEventListener('focus', handleFocus);
        };
    }, [maxTabSwitches, sessionTerminated, onTabSwitch, flashWarning, logSecurityEvent, terminateSession]);

    // ═══════════════════════════════════════════════════════════════
    // 5. CLIPBOARD API INTERCEPTION
    // ═══════════════════════════════════════════════════════════════
    useEffect(() => {
        if (sessionTerminated) return;

        const handleCopy = (e: ClipboardEvent) => {
            e.preventDefault();
            e.clipboardData?.setData('text/plain', '');
            flashWarning(' Copy is disabled for security', 'warning');
            logSecurityEvent('COPY_ATTEMPT');
        };

        const handleCut = (e: ClipboardEvent) => {
            e.preventDefault();
            flashWarning(' Cut is disabled for security', 'warning');
            logSecurityEvent('CUT_ATTEMPT');
        };

        const handlePaste = (e: ClipboardEvent) => {
            e.preventDefault();
            flashWarning(' Paste is disabled for security', 'warning');
            logSecurityEvent('PASTE_ATTEMPT');
        };

        document.addEventListener('copy', handleCopy, { capture: true });
        document.addEventListener('cut', handleCut, { capture: true });
        document.addEventListener('paste', handlePaste, { capture: true });

        return () => {
            document.removeEventListener('copy', handleCopy, { capture: true });
            document.removeEventListener('cut', handleCut, { capture: true });
            document.removeEventListener('paste', handlePaste, { capture: true });
        };
    }, [sessionTerminated, flashWarning, logSecurityEvent]);

    // ═══════════════════════════════════════════════════════════════
    // 7. DRAG-AND-DROP PREVENTION
    // ═══════════════════════════════════════════════════════════════
    useEffect(() => {
        if (sessionTerminated) return;

        const handleDrag = (e: DragEvent) => {
            e.preventDefault();
            logSecurityEvent('DRAG_ATTEMPT');
        };

        const handleDrop = (e: DragEvent) => {
            e.preventDefault();
        };

        document.addEventListener('dragstart', handleDrag, { capture: true });
        document.addEventListener('drop', handleDrop, { capture: true });

        return () => {
            document.removeEventListener('dragstart', handleDrag, { capture: true });
            document.removeEventListener('drop', handleDrop, { capture: true });
        };
    }, [sessionTerminated, logSecurityEvent]);

    // ═══════════════════════════════════════════════════════════════
    // 10. DEVTOOLS DETECTION (Window Size Heuristic)
    // ═══════════════════════════════════════════════════════════════
    useEffect(() => {
        if (sessionTerminated) return;

        let lastWidth = window.outerWidth;
        let lastHeight = window.outerHeight;
        let devtoolsWarned = false;

        const checkDevTools = () => {
            const widthDiff = window.outerWidth - window.innerWidth;
            const heightDiff = window.outerHeight - window.innerHeight;

            // DevTools typically adds >200px to one dimension
            const likelyOpen = widthDiff > 200 || heightDiff > 200;

            if (likelyOpen && !devtoolsWarned) {
                devtoolsWarned = true;
                flashWarning(' Developer tools detected — this activity has been logged', 'critical', 5000);
                logSecurityEvent('DEVTOOLS_DETECTED', {
                    widthDiff,
                    heightDiff,
                    outerWidth: window.outerWidth,
                    innerWidth: window.innerWidth,
                });
                blurContent(3000);
            } else if (!likelyOpen) {
                devtoolsWarned = false;
            }

            lastWidth = window.outerWidth;
            lastHeight = window.outerHeight;
        };

        const interval = setInterval(checkDevTools, 5000);
        window.addEventListener('resize', checkDevTools);

        return () => {
            clearInterval(interval);
            window.removeEventListener('resize', checkDevTools);
        };
    }, [sessionTerminated, flashWarning, logSecurityEvent, blurContent]);

    // ═══════════════════════════════════════════════════════════════
    // CSS: Activate security classes on body
    // ═══════════════════════════════════════════════════════════════
    useEffect(() => {
        document.body.classList.add('security-shield-active');
        return () => {
            document.body.classList.remove('security-shield-active');
        };
    }, []);

    // ── Cleanup all timers on unmount ──
    useEffect(() => {
        return () => {
            if (warningTimeoutRef.current) clearTimeout(warningTimeoutRef.current);
            if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
            if (flushTimeoutRef.current) clearTimeout(flushTimeoutRef.current);
            // Final flush
            flushEvents();
        };
    }, [flushEvents]);

    // ── Watermark text ──
    const watermarkText = useMemo(() => {
        const email = viewerEmail || 'Protected Session';
        const time = new Date().toISOString().split('T')[0];
        return `${email} • ${time} • ${token.substring(0, 8)}`;
    }, [viewerEmail, token]);

    // ── Warning banner gradient ──
    const warningGradient = warningLevel === 'critical'
        ? 'linear-gradient(135deg, #991b1b, #dc2626)'
        : warningLevel === 'warning'
            ? 'linear-gradient(135deg, #92400e, #d97706)'
            : 'linear-gradient(135deg, #1e1e2e, #2d2d44)';

    const warningBorder = warningLevel === 'critical'
        ? '1px solid rgba(248,113,113,0.5)'
        : warningLevel === 'warning'
            ? '1px solid rgba(251,191,36,0.4)'
            : '1px solid rgba(99,102,241,0.3)';

    return (
        <>
            {/* ═══ Security CSS ═══ */}
            <style>{`
                .security-shield-active {
                    -webkit-user-select: none !important;
                    -moz-user-select: none !important;
                    -ms-user-select: none !important;
                    user-select: none !important;
                    -webkit-touch-callout: none !important;
                }
                .security-shield-active img,
                .security-shield-active canvas,
                .security-shield-active video {
                    pointer-events: none;
                    -webkit-user-drag: none;
                }
                @media print {
                    body * {
                        display: none !important;
                        visibility: hidden !important;
                    }
                    body::after {
                        content: ' PRINTING IS DISABLED — This document is protected by Data Guardian.';
                        display: block !important;
                        visibility: visible !important;
                        font-size: 24px;
                        text-align: center;
                        margin-top: 200px;
                        color: #999;
                    }
                }
                .security-content-blur {
                    filter: blur(20px) !important;
                    opacity: 0.05 !important;
                    pointer-events: none !important;
                    /* No transition here! We want instant blur when focus is lost to beat the OS screenshot freeze */
                }
                .security-content-normal {
                    filter: none;
                    opacity: 1;
                    transition: filter 0.3s ease, opacity 0.3s ease; /* Smooth un-blur only */
                }
                @keyframes shieldSlideIn {
                    from { opacity: 0; transform: translateX(-50%) translateY(-20px); }
                    to { opacity: 1; transform: translateX(-50%) translateY(0); }
                }
                @keyframes shieldFadeOut {
                    from { opacity: 1; }
                    to { opacity: 0; }
                }
            `}</style>

            {/* ═══ Content Wrapper with blur protection ═══ */}
            <div 
                id="security-content-wrapper" 
                className={isBlurred || sessionTerminated ? 'security-content-blur' : 'security-content-normal'}
            >
                {children}
            </div>

            {/* ═══ Session Terminated Overlay ═══ */}
            {sessionTerminated && (
                <div style={{
                    position: 'fixed', inset: 0, zIndex: 100000,
                    background: 'rgba(0,0,0,0.9)',
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    color: '#fff', textAlign: 'center',
                    backdropFilter: 'blur(20px)',
                }}>
                    <div style={{
                        width: '80px', height: '80px', borderRadius: '50%',
                        background: 'linear-gradient(135deg, #991b1b, #dc2626)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '36px', marginBottom: '24px',
                        boxShadow: '0 0 40px rgba(220,38,38,0.4)',
                    }}>

                    </div>
                    <h2 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 12px' }}>
                        Session Terminated
                    </h2>
                    <p style={{ fontSize: '15px', color: '#9CA3AF', maxWidth: '400px', lineHeight: 1.6 }}>
                        Your secure viewing session has been terminated due to security policy violations.
                        This event has been logged. Please contact the data owner for a new access link.
                    </p>
                </div>
            )}

            {/* ═══ Dynamic Watermark Overlay ═══ */}
            {enableWatermark && !sessionTerminated && (
                <div
                    aria-hidden="true"
                    style={{
                        position: 'fixed', inset: 0, zIndex: 99998,
                        pointerEvents: 'none',
                        overflow: 'hidden',
                    }}
                >
                    {/* Tiled watermark pattern */}
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} style={{
                            position: 'absolute',
                            top: `${(i * 18) + watermarkOffset.y}%`,
                            left: `${((i % 2) * 15) + watermarkOffset.x}px`,
                            width: '100%',
                            transform: 'rotate(-25deg)',
                            whiteSpace: 'nowrap',
                            color: 'rgba(255,255,255,0.04)',
                            fontSize: '13px',
                            fontWeight: 600,
                            letterSpacing: '1px',
                            fontFamily: 'monospace',
                            userSelect: 'none',
                            transition: 'top 2s ease, left 2s ease',
                        }}>
                            {watermarkText}
                            <span style={{ margin: '0 60px' }}>{watermarkText}</span>
                            <span style={{ margin: '0 60px' }}>{watermarkText}</span>
                        </div>
                    ))}
                </div>
            )}

            {/* ═══ Warning Toast Banner ═══ */}
            {showWarning && !sessionTerminated && (
                <div
                    role="alert"
                    aria-live="assertive"
                    style={{
                        position: 'fixed',
                        top: '20px',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        zIndex: 99999,
                        background: warningGradient,
                        color: '#fff',
                        padding: '14px 28px',
                        borderRadius: '12px',
                        fontSize: '14px',
                        fontWeight: 600,
                        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                        border: warningBorder,
                        backdropFilter: 'blur(12px)',
                        animation: 'shieldSlideIn 0.3s ease-out',
                        maxWidth: 'calc(100vw - 40px)',
                        textAlign: 'center',
                    }}
                >
                    {warningMessage}
                </div>
            )}
        </>
    );
});
