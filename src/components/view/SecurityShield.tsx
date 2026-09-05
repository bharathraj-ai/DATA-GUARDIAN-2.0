'use client';

/**
 * SecurityShield — strongest practical browser-side privacy deterrence.
 *
 * ⚠️ LIMITATION (do not advertise as absolute screenshot prevention):
 * A normal browser page cannot reliably intercept OS-level capture before it runs:
 *   - Win + Shift + S (Snipping Tool)
 *   - Ubuntu/GNOME PrtSc / Shift+PrtSc / Alt+PrtSc (Wayland often never delivers the key)
 *   - GPU/driver capture, remote desktop tools, phone cameras
 * The compositor may grab the frame buffer without focusing away from the page.
 *
 * What we CAN do:
 *   - Body-owned blank cover the instant we see PrtSc / Super / screenshot chords
 *   - On the FIRST screenshot, copy, print, tab-hide, or similar suspicious action:
 *     terminate the vendor session immediately (no warning strikes), revoke the
 *     share, and email the data owner
 *   - Super/Alt alone and ordinary window blur still only hide content
 */

import React, {
    useEffect,
    useState,
    useRef,
    useCallback,
    memo,
    useMemo,
} from 'react';
import {
    FORENSIC_WATERMARK_ROWS,
    buildForensicWatermark,
} from '@/lib/security/forensic-watermark';

interface SecurityShieldProps {
    token: string;
    viewerEmail?: string;
    /** Short device fingerprint for forensic watermark attribution. */
    deviceHash?: string;
    onTabSwitch?: (count: number) => void;
    onSessionTerminate?: (reason: string) => void;
    maxTabSwitches?: number;
    enableWatermark?: boolean;
    /**
     * When true, ordinary window blur also triggers first-hit revoke
     * (high-sensitivity shares). Default false — blur still hides content.
     */
    strictCaptureMode?: boolean;
    /** Blank cover after this many ms idle (0 disables). Default 45000. */
    idleCoverMs?: number;
    children?: React.ReactNode;
}

type SecurityEvent =
    | 'COPY_ATTEMPT'
    | 'CUT_ATTEMPT'
    | 'PASTE_ATTEMPT'
    | 'PRINT_ATTEMPT'
    | 'SAVE_ATTEMPT'
    | 'SELECT_ALL_ATTEMPT'
    | 'VIEW_SOURCE_ATTEMPT'
    | 'SCREENSHOT_ATTEMPT'
    | 'DEVTOOLS_SHORTCUT'
    | 'DEVTOOLS_DETECTED'
    | 'CONTEXT_MENU_ATTEMPT'
    | 'DRAG_ATTEMPT'
    | 'TAB_SWITCH'
    | 'SESSION_TERMINATED'
    | 'FOCUS_LOST'
    | 'FOCUS_REGAINED';

const BLOCKED_SHORTCUTS: Array<{
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
    meta?: boolean;
    key: string;
    event: SecurityEvent;
    message: string;
}> = [
    { ctrl: true, key: 'c', event: 'COPY_ATTEMPT', message: 'Copy is disabled for security' },
    { ctrl: true, key: 'x', event: 'CUT_ATTEMPT', message: 'Cut is disabled for security' },
    { ctrl: true, key: 'p', event: 'PRINT_ATTEMPT', message: 'Printing is disabled for security' },
    { ctrl: true, key: 's', event: 'SAVE_ATTEMPT', message: 'Saving is disabled — files are view-only' },
    { ctrl: true, key: 'a', event: 'SELECT_ALL_ATTEMPT', message: 'Select all is disabled for security' },
    { ctrl: true, key: 'u', event: 'VIEW_SOURCE_ATTEMPT', message: 'Viewing source is restricted' },
    { ctrl: true, shift: true, key: 'i', event: 'DEVTOOLS_SHORTCUT', message: 'Developer tools are restricted' },
    { ctrl: true, shift: true, key: 'j', event: 'DEVTOOLS_SHORTCUT', message: 'Developer tools are restricted' },
    { ctrl: true, shift: true, key: 'c', event: 'DEVTOOLS_SHORTCUT', message: 'Developer tools are restricted' },
    { meta: true, key: 'c', event: 'COPY_ATTEMPT', message: 'Copy is disabled for security' },
    { meta: true, key: 'x', event: 'CUT_ATTEMPT', message: 'Cut is disabled for security' },
    { meta: true, key: 'p', event: 'PRINT_ATTEMPT', message: 'Printing is disabled for security' },
    { meta: true, key: 's', event: 'SAVE_ATTEMPT', message: 'Saving is disabled for security' },
    { meta: true, key: 'a', event: 'SELECT_ALL_ATTEMPT', message: 'Select all is disabled for security' },
    { meta: true, key: 'u', event: 'VIEW_SOURCE_ATTEMPT', message: 'Viewing source is restricted' },
    { meta: true, shift: true, key: 'i', event: 'DEVTOOLS_SHORTCUT', message: 'Developer tools are restricted' },
    { meta: true, shift: true, key: '3', event: 'SCREENSHOT_ATTEMPT', message: 'Screenshot is restricted for security' },
    { meta: true, shift: true, key: '4', event: 'SCREENSHOT_ATTEMPT', message: 'Screenshot is restricted for security' },
    { meta: true, shift: true, key: '5', event: 'SCREENSHOT_ATTEMPT', message: 'Screenshot is restricted for security' },
    { key: 'f12', event: 'DEVTOOLS_SHORTCUT', message: 'Developer tools are restricted' },
];

function isApplePlatform(): boolean {
    if (typeof navigator === 'undefined') return false;
    return /Mac|iPhone|iPad|iPod/.test(navigator.platform || '')
        || /Mac OS X|iPhone|iPad/.test(navigator.userAgent || '');
}

/** PrintScreen detection — Ubuntu/Chrome may use key, code, or legacy keyCode 44 */
function isPrintScreenEvent(e: KeyboardEvent): boolean {
    const key = (e.key || '').toLowerCase();
    const code = e.code || '';
    const keyCode = e.keyCode || e.which || 0;
    return (
        key === 'printscreen' ||
        e.key === 'PrintScreen' ||
        code === 'PrintScreen' ||
        keyCode === 44
    );
}

function forcePrivacyPaint(cover: HTMLElement | null) {
    // Synchronous layout flush so compositor may pick up the blank frame
    if (cover) void cover.offsetHeight;
    void document.body.offsetHeight;
}

/** Map client events → /api/audit allowlist names */
function toAuditAction(action: SecurityEvent): string {
    switch (action) {
        case 'SCREENSHOT_ATTEMPT':
            return 'PRINT_SCREEN';
        case 'FOCUS_LOST':
            return 'FOCUS_LOSS';
        case 'FOCUS_REGAINED':
            return 'FOCUS_LOSS';
        case 'DEVTOOLS_SHORTCUT':
        case 'DEVTOOLS_DETECTED':
            return 'DEVTOOLS';
        case 'COPY_ATTEMPT':
        case 'CUT_ATTEMPT':
        case 'PASTE_ATTEMPT':
        case 'SELECT_ALL_ATTEMPT':
            return 'COPY';
        case 'CONTEXT_MENU_ATTEMPT':
            return 'CONTEXT_MENU';
        case 'TAB_SWITCH':
            return 'TAB_SWITCH';
        case 'SESSION_TERMINATED':
            return 'SESSION_TERMINATE';
        case 'PRINT_ATTEMPT':
        case 'SAVE_ATTEMPT':
        case 'VIEW_SOURCE_ATTEMPT':
        case 'DRAG_ATTEMPT':
            return 'KEY_BLOCK';
        default:
            return 'KEY_BLOCK';
    }
}

export const SecurityShield = memo(function SecurityShield({
    token,
    viewerEmail,
    deviceHash,
    onTabSwitch,
    onSessionTerminate,
    maxTabSwitches = 1,
    enableWatermark = true,
    strictCaptureMode = false,
    idleCoverMs = 45_000,
    children,
}: SecurityShieldProps) {
    const [tabSwitchCount, setTabSwitchCount] = useState(0);
    const [showWarning, setShowWarning] = useState(false);
    const [warningMessage, setWarningMessage] = useState('');
    const [warningLevel, setWarningLevel] = useState<'info' | 'warning' | 'critical'>('info');
    const [isProtected, setIsProtected] = useState(false);
    const [sessionTerminated, setSessionTerminated] = useState(false);
    const [terminatedBecauseSuspicious, setTerminatedBecauseSuspicious] = useState(false);

    /** Cover lives on document.body — never a React-owned node (avoids insertBefore/removeChild races). */
    const coverRef = useRef<HTMLDivElement | null>(null);
    const protectionActiveRef = useRef(false);
    const sessionTerminatedRef = useRef(false);
    const restoreGenerationRef = useRef(0);
    const warningTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const eventQueueRef = useRef<
        Array<{ action: string; timestamp: number; metadata?: Record<string, unknown> }>
    >([]);
    const flushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    /** True only after real window blur / tab hide — not Alt/Super pre-arm */
    const leftWindowRef = useRef(false);
    const lastFocusLostAuditAtRef = useRef(0);
    const verifyInFlightRef = useRef(false);
    const restoreDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Stable refs so event-listener effects keep a fixed deps array length (avoids Fast Refresh warning)
    const activatePrivacyCoverRef = useRef<(reason: string) => void>(() => {});
    const deactivatePrivacyCoverRef = useRef<() => void>(() => {});
    const flashWarningRef = useRef<
        (msg: string, level?: 'info' | 'warning' | 'critical', durationMs?: number) => void
    >(() => {});
    const logSecurityEventRef = useRef<
        (action: SecurityEvent, metadata?: Record<string, unknown>) => void
    >(() => {});
    const validateAndRestoreRef = useRef<() => Promise<void>>(async () => {});
    const terminateSessionRef = useRef<(reason: string) => void>(() => {});
    const reportSuspiciousRevokeRef = useRef<
        (detail: string, reason?: 'screenshot' | 'devtools' | 'tab_switch' | 'copy') => void
    >(() => {});
    const onTabSwitchRef = useRef(onTabSwitch);
    onTabSwitchRef.current = onTabSwitch;
    const suspiciousRevokeSentRef = useRef(false);
    /** Win/Super+Shift — Snipping Tool often swallows the final S before the browser sees it */
    const osScreenshotChordArmedAtRef = useRef(0);
    /** Super/Win key — Snipping Tool starts with Win then steals the rest of the chord */
    const lastMetaKeyAtRef = useRef(0);

    const syncCoverCopy = useCallback((opts: { validating?: boolean; terminated?: boolean }) => {
        const cover = coverRef.current;
        if (!cover) return;
        const title = cover.querySelector('.security-privacy-cover-title');
        const sub = cover.querySelector('.security-privacy-cover-sub');
        if (!title || !sub) return;
        if (opts.terminated || sessionTerminatedRef.current) {
            title.textContent = 'Access Revoked';
            sub.textContent =
                'Suspicious activity was detected. Vendor access has been denied and the data owner has been notified.';
            return;
        }
        title.textContent = 'Protected Content Hidden';
        sub.textContent = opts.validating
            ? 'Re-validating your access session…'
            : 'Content is hidden. If this was a screenshot or capture attempt, access is being revoked.';
    }, []);

    // ── Instant DOM privacy cover (body-owned node; no React className fight) ──
    const activatePrivacyCover = useCallback(
        (reason: string) => {
            // Allow force-cover on terminate; otherwise ignore once session is dead
            if (sessionTerminatedRef.current && reason !== 'terminated') return;

            protectionActiveRef.current = true;
            restoreGenerationRef.current += 1;

            const cover = coverRef.current;
            document.body.classList.add('security-privacy-active');
            if (cover) {
                cover.classList.add('is-active');
                cover.style.opacity = '1';
                cover.style.visibility = 'visible';
                cover.style.pointerEvents = 'auto';
                cover.setAttribute('data-reason', reason);
                cover.setAttribute('aria-hidden', 'false');
            }
            forcePrivacyPaint(cover);
            syncCoverCopy({
                validating: false,
                terminated: reason === 'terminated' || sessionTerminatedRef.current,
            });

            // Soft React flag only (watermark opacity) — never drives cover/content classes
            setIsProtected(true);
        },
        [syncCoverCopy],
    );

    const deactivatePrivacyCover = useCallback(() => {
        if (sessionTerminatedRef.current) return;
        if (suspiciousRevokeSentRef.current) return;
        if (document.hidden || !document.hasFocus()) return;

        protectionActiveRef.current = false;

        const cover = coverRef.current;
        if (cover) {
            cover.classList.remove('is-active');
            cover.style.opacity = '0';
            cover.style.visibility = 'hidden';
            cover.style.pointerEvents = 'none';
            cover.removeAttribute('data-reason');
            cover.setAttribute('aria-hidden', 'true');
        }
        document.body.classList.remove('security-privacy-active');
        setIsProtected(false);
    }, []);

    const flashWarning = useCallback(
        (msg: string, level: 'info' | 'warning' | 'critical' = 'info', durationMs = 3000) => {
            setWarningMessage(msg);
            setWarningLevel(level);
            setShowWarning(true);
            if (warningTimeoutRef.current) clearTimeout(warningTimeoutRef.current);
            warningTimeoutRef.current = setTimeout(() => setShowWarning(false), durationMs);
        },
        [],
    );

    const flushEvents = useCallback(async () => {
        const events = eventQueueRef.current.splice(0);
        if (events.length === 0) return;

        // Coalesce noisy focus events — one audit POST max per flush for FOCUS_*
        const focusActions = new Set(['FOCUS_LOST', 'FOCUS_REGAINED']);
        const coalesced: typeof events = [];
        let lastFocus: (typeof events)[number] | null = null;
        for (const evt of events) {
            if (focusActions.has(evt.action)) {
                lastFocus = evt;
                continue;
            }
            coalesced.push(evt);
        }
        if (lastFocus) coalesced.push(lastFocus);

        await Promise.all(
            coalesced.map((evt) =>
                fetch('/api/audit', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        token,
                        action: toAuditAction(evt.action as SecurityEvent),
                        timestamp: evt.timestamp,
                        metadata: evt.metadata,
                    }),
                }).catch(() => {}),
            ),
        );
    }, [token]);

    const logSecurityEvent = useCallback(
        (action: SecurityEvent, metadata?: Record<string, unknown>) => {
            // Drop duplicate FOCUS_LOST while already away (blur + poll + visibility)
            if (action === 'FOCUS_LOST') {
                const now = Date.now();
                if (now - lastFocusLostAuditAtRef.current < 15_000) {
                    return;
                }
                lastFocusLostAuditAtRef.current = now;
            }
            // Never audit FOCUS_REGAINED — restore is local/verify only
            if (action === 'FOCUS_REGAINED') return;

            eventQueueRef.current.push({ action, timestamp: Date.now(), metadata });
            if (flushTimeoutRef.current) clearTimeout(flushTimeoutRef.current);
            flushTimeoutRef.current = setTimeout(flushEvents, 800);
        },
        [flushEvents],
    );

    const terminateSession = useCallback(
        (reason: string) => {
            sessionTerminatedRef.current = true;
            setSessionTerminated(true);
            activatePrivacyCover('terminated');
            logSecurityEvent('SESSION_TERMINATED', { reason });
            flashWarning(`Access revoked: ${reason}`, 'critical', 999999);
            onSessionTerminate?.(reason);
            setTimeout(flushEvents, 100);
        },
        [activatePrivacyCover, logSecurityEvent, flashWarning, onSessionTerminate, flushEvents],
    );

    /**
     * First suspicious action: blank the frame, end the vendor session immediately,
     * revoke the share, and notify the owner. No warning strikes.
     * Super/Alt alone and ordinary focus loss must NOT call this.
     */
    const reportSuspiciousActivityAndRevoke = useCallback(
        (detail: string, reason: 'screenshot' | 'devtools' | 'tab_switch' | 'copy' = 'screenshot') => {
            if (sessionTerminatedRef.current && suspiciousRevokeSentRef.current) return;

            setTerminatedBecauseSuspicious(true);
            activatePrivacyCover('suspicious-revoke');
            terminateSession(
                'Suspicious activity detected. This working session has been terminated and the data owner has been notified.',
            );

            if (suspiciousRevokeSentRef.current) return;
            suspiciousRevokeSentRef.current = true;

            const payload = JSON.stringify({ token, reason, detail });
            try {
                navigator.sendBeacon(
                    '/api/security/suspicious-activity',
                    new Blob([payload], { type: 'application/json' }),
                );
            } catch {
                /* fetch keepalive below is the primary path */
            }
            void fetch('/api/security/suspicious-activity', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                keepalive: true,
                body: payload,
            }).catch(() => {
                // Keep the local kill-switch. Never restore the file after first detection.
            });
        },
        [activatePrivacyCover, terminateSession, token],
    );

    /**
     * After a real focus leave: keep cover until access is confirmed.
     * Alt/Super pre-arm restores locally without hitting the API.
     */
    const validateAndRestore = useCallback(async () => {
        if (sessionTerminatedRef.current || suspiciousRevokeSentRef.current) return;
        if (document.hidden || !document.hasFocus()) return;

        // Local-only restore when we never left the window (modifier pre-arm)
        if (!leftWindowRef.current) {
            if (Date.now() - lastMetaKeyAtRef.current < 2800) return;
            if (Date.now() - osScreenshotChordArmedAtRef.current < 2800) return;
            deactivatePrivacyCover();
            return;
        }

        if (verifyInFlightRef.current) return;

        const generation = restoreGenerationRef.current;
        verifyInFlightRef.current = true;
        syncCoverCopy({ validating: true });

        try {
            const res = await fetch(
                `/api/verify-access?token=${encodeURIComponent(token)}`,
                { cache: 'no-store', credentials: 'same-origin' },
            );
            const data = (await res.json().catch(() => ({}))) as { type?: string };

            if (generation !== restoreGenerationRef.current) return;
            if (document.hidden || !document.hasFocus()) return;

            if (res.ok && data.type === 'active') {
                leftWindowRef.current = false;
                deactivatePrivacyCover();
                return;
            }

            if (data.type === 'revoked') {
                terminateSession('Share link was revoked');
                return;
            }
            if (data.type === 'expired') {
                terminateSession('Share link expired');
                return;
            }
            if (data.type === 'session_invalid' || res.status === 401) {
                terminateSession('Access session is no longer valid');
                return;
            }

            syncCoverCopy({ validating: false });
            flashWarning(
                'Unable to re-validate access. Protected content remains hidden.',
                'warning',
                4000,
            );
        } catch {
            if (generation !== restoreGenerationRef.current) return;
            syncCoverCopy({ validating: false });
            flashWarning(
                'Connection error while re-validating access. Content remains hidden.',
                'warning',
                4000,
            );
        } finally {
            verifyInFlightRef.current = false;
        }
    }, [
        token,
        deactivatePrivacyCover,
        terminateSession,
        flashWarning,
        syncCoverCopy,
    ]);

    const markWindowLeft = useCallback((via: string) => {
        activatePrivacyCoverRef.current(`leave:${via}`);
        const wasAway = leftWindowRef.current;
        leftWindowRef.current = true;
        if (!wasAway) {
            logSecurityEventRef.current('FOCUS_LOST', { via });
        }
    }, []);

    const strictCaptureModeRef = useRef(strictCaptureMode);
    strictCaptureModeRef.current = strictCaptureMode;

    activatePrivacyCoverRef.current = activatePrivacyCover;
    deactivatePrivacyCoverRef.current = deactivatePrivacyCover;
    flashWarningRef.current = flashWarning;
    logSecurityEventRef.current = logSecurityEvent;
    validateAndRestoreRef.current = validateAndRestore;
    terminateSessionRef.current = terminateSession;
    reportSuspiciousRevokeRef.current = reportSuspiciousActivityAndRevoke;

    // ═══════════════════════════════════════════════════════════════
    // KEYBOARD deterrents (Ubuntu PrtSc often intercepted by GNOME —
    // also pre-cover on Super/Alt which precede many screenshot chords)
    // ═══════════════════════════════════════════════════════════════
    useEffect(() => {
        if (sessionTerminated) return;

        const handleScreenshotKeys = (e: KeyboardEvent, phase: 'down' | 'up') => {
            if (isPrintScreenEvent(e)) {
                e.preventDefault();
                e.stopPropagation();
                activatePrivacyCoverRef.current(
                    phase === 'down' ? 'printscreen' : 'printscreen-up',
                );
                logSecurityEventRef.current('SCREENSHOT_ATTEMPT', {
                    phase,
                    key: e.key,
                    code: e.code,
                    keyCode: e.keyCode || e.which,
                    altKey: e.altKey,
                    shiftKey: e.shiftKey,
                    metaKey: e.metaKey,
                    ctrlKey: e.ctrlKey,
                });
                try {
                    void navigator.clipboard.writeText(
                        'Screenshots are disabled for security reasons.',
                    );
                } catch {
                    /* ignore */
                }
                if (phase === 'down') {
                    reportSuspiciousRevokeRef.current('printscreen', 'screenshot');
                }
                return true;
            }
            return false;
        };

        let chordReleaseTimer: ReturnType<typeof setTimeout> | null = null;
        const scheduleChordReleaseRestore = () => {
            if (chordReleaseTimer) clearTimeout(chordReleaseTimer);
            chordReleaseTimer = setTimeout(() => {
                if (sessionTerminatedRef.current || suspiciousRevokeSentRef.current) return;
                if (!document.hasFocus() || document.hidden) return;
                if (!protectionActiveRef.current) return;
                // Snipping Tool (Win+Shift+S) often swallows keys after Super —
                // keep the cover until the chord window expires. Do not restore.
                if (Date.now() - osScreenshotChordArmedAtRef.current < 2800) {
                    scheduleChordReleaseRestore();
                    return;
                }
                if (Date.now() - lastMetaKeyAtRef.current < 2800) {
                    scheduleChordReleaseRestore();
                    return;
                }
                if (leftWindowRef.current) {
                    void validateAndRestoreRef.current();
                    return;
                }
                deactivatePrivacyCoverRef.current();
            }, 450);
        };

        const handleKeyDown = (e: KeyboardEvent) => {
            const key = e.key.toLowerCase();
            const code = e.code || '';

            // Ubuntu/GNOME: Super / Alt often start screenshot shortcuts; cover early
            if (
                e.metaKey ||
                key === 'meta' ||
                key === 'os' ||
                code === 'MetaLeft' ||
                code === 'MetaRight' ||
                code === 'OSLeft' ||
                code === 'OSRight'
            ) {
                lastMetaKeyAtRef.current = Date.now();
                if (chordReleaseTimer) clearTimeout(chordReleaseTimer);
                activatePrivacyCoverRef.current('super-key');
            }
            if (e.altKey || key === 'alt' || code === 'AltLeft' || code === 'AltRight') {
                // Alt+PrtSc = window screenshot on Ubuntu — arm cover while Alt is held
                if (chordReleaseTimer) clearTimeout(chordReleaseTimer);
                activatePrivacyCoverRef.current('alt-key');
            }

            // Win/Super+Shift is Snipping Tool — OS often swallows "S". Revoke on first chord, no wait.
            if (!isApplePlatform() && e.metaKey && e.shiftKey) {
                e.preventDefault();
                e.stopPropagation();
                osScreenshotChordArmedAtRef.current = Date.now();
                activatePrivacyCoverRef.current('os-screenshot-chord');
                logSecurityEventRef.current('SCREENSHOT_ATTEMPT', { chord: 'meta-shift' });
                reportSuspiciousRevokeRef.current('win-shift-snip', 'screenshot');
                return;
            }

            if (handleScreenshotKeys(e, 'down')) return;

            if (key === 'f12') {
                e.preventDefault();
                e.stopPropagation();
                logSecurityEventRef.current('DEVTOOLS_SHORTCUT');
                reportSuspiciousRevokeRef.current('f12', 'devtools');
                return;
            }

            for (const shortcut of BLOCKED_SHORTCUTS) {
                const needsCtrl = Boolean(shortcut.ctrl);
                const needsMeta = Boolean(shortcut.meta);
                const needsShift = Boolean(shortcut.shift);
                if (needsCtrl && !(e.ctrlKey || e.metaKey)) continue;
                if (needsMeta && !e.metaKey) continue;
                if (needsShift && !e.shiftKey) continue;
                if (
                    !needsShift &&
                    e.shiftKey &&
                    !['i', 'j', 'c', '3', '4', '5'].includes(shortcut.key)
                ) {
                    continue;
                }
                if (key !== shortcut.key) continue;

                e.preventDefault();
                e.stopPropagation();
                activatePrivacyCoverRef.current('suspicious-shortcut');
                logSecurityEventRef.current(shortcut.event);
                if (shortcut.event === 'SCREENSHOT_ATTEMPT' || shortcut.event === 'PRINT_ATTEMPT') {
                    reportSuspiciousRevokeRef.current(shortcut.event, 'screenshot');
                    return;
                }
                if (shortcut.event === 'DEVTOOLS_SHORTCUT' || shortcut.event === 'VIEW_SOURCE_ATTEMPT') {
                    reportSuspiciousRevokeRef.current(shortcut.event, 'devtools');
                    return;
                }
                if (
                    shortcut.event === 'COPY_ATTEMPT' ||
                    shortcut.event === 'CUT_ATTEMPT' ||
                    shortcut.event === 'SAVE_ATTEMPT'
                ) {
                    reportSuspiciousRevokeRef.current(shortcut.event, 'copy');
                    return;
                }
                flashWarningRef.current(shortcut.message, 'warning');
                return;
            }
        };

        const handleKeyUp = (e: KeyboardEvent) => {
            if (handleScreenshotKeys(e, 'up')) return;

            const code = e.code || '';
            const key = e.key.toLowerCase();
            if (
                key === 'meta' ||
                key === 'os' ||
                key === 'alt' ||
                code === 'MetaLeft' ||
                code === 'MetaRight' ||
                code === 'OSLeft' ||
                code === 'OSRight' ||
                code === 'AltLeft' ||
                code === 'AltRight'
            ) {
                scheduleChordReleaseRestore();
            }
        };

        // Capture on both — some Linux browsers only deliver PrtSc on one target
        const opts: AddEventListenerOptions = { capture: true };
        window.addEventListener('keydown', handleKeyDown, opts);
        window.addEventListener('keyup', handleKeyUp, opts);
        document.addEventListener('keydown', handleKeyDown, opts);
        document.addEventListener('keyup', handleKeyUp, opts);
        return () => {
            if (chordReleaseTimer) clearTimeout(chordReleaseTimer);
            window.removeEventListener('keydown', handleKeyDown, opts);
            window.removeEventListener('keyup', handleKeyUp, opts);
            document.removeEventListener('keydown', handleKeyDown, opts);
            document.removeEventListener('keyup', handleKeyUp, opts);
        };
    }, [sessionTerminated]);

    // ═══════════════════════════════════════════════════════════════
    // BLUR / VISIBILITY — primary privacy path for OS screenshot UIs
    // Cover immediately; audit + verify-access are throttled (not every blur).
    // ═══════════════════════════════════════════════════════════════
    useEffect(() => {
        if (sessionTerminated) return;

        const handleVisibilityChange = () => {
            if (document.hidden) {
                const snipChord =
                    Date.now() - osScreenshotChordArmedAtRef.current < 2800
                    || Date.now() - lastMetaKeyAtRef.current < 2800;
                if (snipChord) {
                    logSecurityEventRef.current('SCREENSHOT_ATTEMPT', {
                        via: 'visibility-while-snip-chord',
                    });
                    reportSuspiciousRevokeRef.current('os-snip-visibility', 'screenshot');
                    return;
                }

                markWindowLeft('visibilitychange');
                logSecurityEventRef.current('TAB_SWITCH', { count: 1, max: 1 });
                onTabSwitchRef.current?.(1);
                reportSuspiciousRevokeRef.current('tab-switch', 'tab_switch');
            } else {
                if (sessionTerminatedRef.current || suspiciousRevokeSentRef.current) return;
                activatePrivacyCoverRef.current('visibility-return');
                if (restoreDebounceRef.current) clearTimeout(restoreDebounceRef.current);
                restoreDebounceRef.current = setTimeout(() => {
                    void validateAndRestoreRef.current();
                }, 350);
            }
        };

        const handleBlur = () => {
            if (
                Date.now() - osScreenshotChordArmedAtRef.current < 2800
                || Date.now() - lastMetaKeyAtRef.current < 2800
            ) {
                logSecurityEventRef.current('SCREENSHOT_ATTEMPT', {
                    via: 'blur-while-snip-chord',
                });
                reportSuspiciousRevokeRef.current('os-snip-blur', 'screenshot');
                return;
            }
            if (strictCaptureModeRef.current) {
                logSecurityEventRef.current('SCREENSHOT_ATTEMPT', { via: 'strict-blur' });
                reportSuspiciousRevokeRef.current('strict-blur', 'screenshot');
                return;
            }
            markWindowLeft('blur');
        };

        const handleFocus = () => {
            if (sessionTerminatedRef.current || suspiciousRevokeSentRef.current) return;
            if (!protectionActiveRef.current && !leftWindowRef.current) return;
            activatePrivacyCoverRef.current('window-focus');
            if (restoreDebounceRef.current) clearTimeout(restoreDebounceRef.current);
            restoreDebounceRef.current = setTimeout(() => {
                void validateAndRestoreRef.current();
            }, 350);
        };

        const handlePageHide = () => {
            markWindowLeft('pagehide');
        };

        // Focus poll — cover only; no audit (blur/visibility already cover that)
        let lastFocused = document.hasFocus() && !document.hidden;
        const focusPoll = window.setInterval(() => {
            const focused = document.hasFocus() && !document.hidden;
            const lostFocus = lastFocused && !focused;
            const regainedFocus = !lastFocused && focused && protectionActiveRef.current;

            if (lostFocus) {
                const snipChord =
                    Date.now() - osScreenshotChordArmedAtRef.current < 2800
                    || Date.now() - lastMetaKeyAtRef.current < 2800;
                if (snipChord) {
                    reportSuspiciousRevokeRef.current('os-snip-focus-poll', 'screenshot');
                } else {
                    activatePrivacyCoverRef.current('focus-poll-lost');
                    leftWindowRef.current = true;
                }
            }

            if (regainedFocus) {
                if (!sessionTerminatedRef.current && !suspiciousRevokeSentRef.current) {
                    if (restoreDebounceRef.current) clearTimeout(restoreDebounceRef.current);
                    restoreDebounceRef.current = setTimeout(() => {
                        void validateAndRestoreRef.current();
                    }, 350);
                }
            }

            lastFocused = focused;
        }, 100);

        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('blur', handleBlur);
        window.addEventListener('focus', handleFocus);
        window.addEventListener('pagehide', handlePageHide);

        return () => {
            clearInterval(focusPoll);
            if (restoreDebounceRef.current) clearTimeout(restoreDebounceRef.current);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('blur', handleBlur);
            window.removeEventListener('focus', handleFocus);
            window.removeEventListener('pagehide', handlePageHide);
        };
    }, [sessionTerminated, maxTabSwitches, markWindowLeft]);

    // Screen-share / getDisplayMedia — browsers cannot block OS capture, but if
    // the page itself is asked to share the display, treat it as capture intent.
    useEffect(() => {
        if (sessionTerminated) return;
        const md = navigator.mediaDevices;
        if (!md || typeof md.getDisplayMedia !== 'function') return;
        const original = md.getDisplayMedia.bind(md);
        md.getDisplayMedia = ((...args: Parameters<typeof md.getDisplayMedia>) => {
            logSecurityEventRef.current('SCREENSHOT_ATTEMPT', { via: 'getDisplayMedia' });
            reportSuspiciousRevokeRef.current('getDisplayMedia', 'screenshot');
            return Promise.reject(new DOMException('Screen capture is blocked by Secure Protocol.', 'NotAllowedError'));
        }) as typeof md.getDisplayMedia;
        return () => {
            md.getDisplayMedia = original;
        };
    }, [sessionTerminated]);

    // ═══════════════════════════════════════════════════════════════
    // CLIPBOARD
    // ═══════════════════════════════════════════════════════════════
    useEffect(() => {
        if (sessionTerminated) return;

        const handleCopy = (e: ClipboardEvent) => {
            e.preventDefault();
            e.clipboardData?.setData('text/plain', '');
            logSecurityEventRef.current('COPY_ATTEMPT');
            reportSuspiciousRevokeRef.current('copy', 'copy');
        };
        const handleCut = (e: ClipboardEvent) => {
            e.preventDefault();
            logSecurityEventRef.current('CUT_ATTEMPT');
            reportSuspiciousRevokeRef.current('cut', 'copy');
        };
        const handlePaste = (e: ClipboardEvent) => {
            e.preventDefault();
            flashWarningRef.current('Paste is disabled for security', 'warning');
            logSecurityEventRef.current('PASTE_ATTEMPT');
        };

        document.addEventListener('copy', handleCopy, { capture: true });
        document.addEventListener('cut', handleCut, { capture: true });
        document.addEventListener('paste', handlePaste, { capture: true });
        return () => {
            document.removeEventListener('copy', handleCopy, { capture: true });
            document.removeEventListener('cut', handleCut, { capture: true });
            document.removeEventListener('paste', handlePaste, { capture: true });
        };
    }, [sessionTerminated]);

    // ═══════════════════════════════════════════════════════════════
    // DRAG
    // ═══════════════════════════════════════════════════════════════
    useEffect(() => {
        if (sessionTerminated) return;
        const handleDrag = (e: DragEvent) => {
            e.preventDefault();
            logSecurityEventRef.current('DRAG_ATTEMPT');
        };
        const handleDrop = (e: DragEvent) => e.preventDefault();
        document.addEventListener('dragstart', handleDrag, { capture: true });
        document.addEventListener('drop', handleDrop, { capture: true });
        return () => {
            document.removeEventListener('dragstart', handleDrag, { capture: true });
            document.removeEventListener('drop', handleDrop, { capture: true });
        };
    }, [sessionTerminated]);

    // ═══════════════════════════════════════════════════════════════
    // DEVTOOLS heuristic
    // ═══════════════════════════════════════════════════════════════
    useEffect(() => {
        if (sessionTerminated) return;
        let warned = false;
        const check = () => {
            const widthDiff = window.outerWidth - window.innerWidth;
            const heightDiff = window.outerHeight - window.innerHeight;
            const likelyOpen = widthDiff > 200 || heightDiff > 200;
            if (likelyOpen && !warned) {
                warned = true;
                activatePrivacyCoverRef.current('devtools');
                flashWarningRef.current(
                    'Developer tools detected — activity logged',
                    'critical',
                    5000,
                );
                logSecurityEventRef.current('DEVTOOLS_DETECTED', { widthDiff, heightDiff });
            } else if (!likelyOpen) {
                warned = false;
            }
        };
        const interval = setInterval(check, 5000);
        window.addEventListener('resize', check);
        return () => {
            clearInterval(interval);
            window.removeEventListener('resize', check);
        };
    }, [sessionTerminated]);

    useEffect(() => {
        document.body.classList.add('security-shield-active');

        // Dedicated stylesheet on <head> so cover works even if React <style> is late
        const style = document.createElement('style');
        style.id = 'security-privacy-cover-style';
        style.textContent = `
            #security-privacy-cover {
                position: fixed !important;
                inset: 0 !important;
                z-index: 2147483646 !important;
                background: #ffffff !important;
                color: #111111 !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                opacity: 0;
                visibility: hidden;
                pointer-events: none;
            }
            #security-privacy-cover.is-active {
                opacity: 1 !important;
                visibility: visible !important;
                pointer-events: auto !important;
            }
            #security-privacy-cover .security-privacy-cover-inner {
                text-align: center;
                padding: 24px;
                max-width: 420px;
            }
            #security-privacy-cover .security-privacy-cover-title {
                font-size: 18px;
                font-weight: 700;
                margin: 0 0 8px;
            }
            #security-privacy-cover .security-privacy-cover-sub {
                font-size: 13px;
                color: #6b7280;
                margin: 0;
                line-height: 1.5;
            }
            /* Hide entire app chrome while covered (navbar/footer included) */
            body.security-privacy-active > *:not(#security-privacy-cover) {
                visibility: hidden !important;
            }
            body.security-privacy-active .security-content-surface,
            body.security-privacy-active #security-content-wrapper,
            body.security-privacy-active #main-content {
                visibility: hidden !important;
                opacity: 0 !important;
                pointer-events: none !important;
            }
        `;
        document.head.appendChild(style);

        const existing = document.getElementById('security-privacy-cover');
        if (existing) existing.remove();

        const cover = document.createElement('div');
        cover.id = 'security-privacy-cover';
        cover.className = 'security-privacy-cover';
        cover.setAttribute('role', 'presentation');
        cover.setAttribute('aria-hidden', 'true');
        cover.style.opacity = '0';
        cover.style.visibility = 'hidden';
        cover.style.pointerEvents = 'none';
        cover.innerHTML = `
            <div class="security-privacy-cover-inner">
                <p class="security-privacy-cover-title">Protected Content Hidden</p>
                <p class="security-privacy-cover-sub">Content is hidden. If this was a screenshot or capture attempt, access is being revoked.</p>
            </div>
        `;
        document.body.appendChild(cover);
        coverRef.current = cover;

        return () => {
            document.body.classList.remove('security-shield-active');
            document.body.classList.remove('security-privacy-active');
            style.remove();
            cover.remove();
            if (coverRef.current === cover) coverRef.current = null;
        };
    }, []);

    useEffect(() => {
        if (sessionTerminated) {
            syncCoverCopy({ terminated: true });
            activatePrivacyCover('terminated');
        }
    }, [sessionTerminated, syncCoverCopy, activatePrivacyCover]);

    useEffect(() => {
        return () => {
            if (warningTimeoutRef.current) clearTimeout(warningTimeoutRef.current);
            if (flushTimeoutRef.current) clearTimeout(flushTimeoutRef.current);
            flushEvents();
        };
    }, [flushEvents]);

    // Idle auto-cover — reduces phone-camera / unattended screen exposure
    useEffect(() => {
        if (sessionTerminated || idleCoverMs <= 0) return;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const arm = () => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                if (sessionTerminatedRef.current) return;
                activatePrivacyCoverRef.current('idle-timeout');
            }, idleCoverMs);
        };
        const opts: AddEventListenerOptions = { capture: true, passive: true };
        const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;
        for (const ev of events) window.addEventListener(ev, arm, opts);
        arm();
        return () => {
            if (timer) clearTimeout(timer);
            for (const ev of events) window.removeEventListener(ev, arm, opts);
        };
    }, [sessionTerminated, idleCoverMs]);

    const [watermarkTick, setWatermarkTick] = useState(0);
    useEffect(() => {
        if (!enableWatermark || sessionTerminated) return;
        const id = setInterval(() => setWatermarkTick((n) => n + 1), 60_000);
        return () => clearInterval(id);
    }, [enableWatermark, sessionTerminated]);

    const watermarkText = useMemo(() => {
        void watermarkTick;
        return buildForensicWatermark({
            viewerEmail,
            token,
            deviceHash,
            at: new Date(),
        }).line;
    }, [viewerEmail, token, deviceHash, watermarkTick]);

    const warningGradient =
        warningLevel === 'critical'
            ? 'linear-gradient(135deg, #991b1b, #dc2626)'
            : warningLevel === 'warning'
              ? 'linear-gradient(135deg, #92400e, #d97706)'
              : 'linear-gradient(135deg, #1e1e2e, #2d2d44)';

    const warningBorder =
        warningLevel === 'critical'
            ? '1px solid rgba(248,113,113,0.5)'
            : warningLevel === 'warning'
              ? '1px solid rgba(251,191,36,0.4)'
              : '1px solid rgba(99,102,241,0.3)';

    return (
        <>
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
                        content: 'PRINTING IS DISABLED — This document is protected by Secure Protocol.';
                        display: block !important;
                        visibility: visible !important;
                        font-size: 24px;
                        text-align: center;
                        margin-top: 200px;
                        color: #999;
                    }
                }
                /* Hide content via body flag — never classList on React-owned nodes */
                body.security-privacy-active .security-content-surface {
                    visibility: hidden !important;
                    opacity: 0 !important;
                    pointer-events: none !important;
                }
                /* Permanent privacy cover — always in DOM; toggle .is-active only */
                .security-privacy-cover {
                    position: fixed;
                    inset: 0;
                    z-index: 99990;
                    background: #ffffff;
                    color: #111111;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    opacity: 0;
                    visibility: hidden;
                    pointer-events: none;
                    /* Intentionally NO transition on show — must paint ASAP */
                }
                .security-privacy-cover.is-active {
                    opacity: 1;
                    visibility: visible;
                    pointer-events: auto;
                }
                .security-privacy-cover-inner {
                    text-align: center;
                    padding: 24px;
                    max-width: 420px;
                }
                .security-privacy-cover-title {
                    font-size: 18px;
                    font-weight: 700;
                    margin: 0 0 8px;
                }
                .security-privacy-cover-sub {
                    font-size: 13px;
                    color: #6b7280;
                    margin: 0;
                    line-height: 1.5;
                }
                @keyframes shieldSlideIn {
                    from { opacity: 0; transform: translateX(-50%) translateY(-20px); }
                    to { opacity: 1; transform: translateX(-50%) translateY(0); }
                }
            `}</style>

            {/* Content visibility driven by body.security-privacy-active CSS */}
            <div id="security-content-wrapper" className="security-content-surface">
                {children}
            </div>

            {sessionTerminated && (
                <div
                    style={{
                        position: 'fixed',
                        inset: 0,
                        zIndex: 100000,
                        background: 'rgba(0,0,0,0.92)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#fff',
                        textAlign: 'center',
                    }}
                >
                    <h2 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 12px' }}>
                        {terminatedBecauseSuspicious ? 'Access Revoked' : 'Session Terminated'}
                    </h2>
                    <p style={{ fontSize: '15px', color: '#9CA3AF', maxWidth: '420px', lineHeight: 1.6 }}>
                        {terminatedBecauseSuspicious
                            ? 'Suspicious activity was detected. This working session has been terminated, vendor access has been denied, and the data owner has been notified.'
                            : 'Your secure viewing session has been terminated due to security policy violations. This event has been logged.'}
                    </p>
                </div>
            )}

            {/* Keep watermark mounted — hide with opacity to avoid remount insertBefore races */}
            {enableWatermark && !sessionTerminated && (
                <div
                    aria-hidden="true"
                    style={{
                        position: 'fixed',
                        inset: 0,
                        zIndex: 99988,
                        pointerEvents: 'none',
                        overflow: 'hidden',
                        opacity: isProtected ? 0 : 1,
                    }}
                >
                    {Array.from({ length: FORENSIC_WATERMARK_ROWS }).map((_, i) => (
                        <div
                            key={i}
                            style={{
                                position: 'absolute',
                                top: `${(i * 100) / FORENSIC_WATERMARK_ROWS}%`,
                                left: `${(i % 3) * 8}px`,
                                width: '140%',
                                transform: 'rotate(-28deg)',
                                whiteSpace: 'nowrap',
                                color: 'rgba(15, 23, 42, 0.11)',
                                fontSize: '11px',
                                fontWeight: 600,
                                letterSpacing: '0.5px',
                                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                                userSelect: 'none',
                            }}
                        >
                            {watermarkText}
                            <span style={{ margin: '0 36px' }}>{watermarkText}</span>
                            <span style={{ margin: '0 36px' }}>{watermarkText}</span>
                            <span style={{ margin: '0 36px' }}>{watermarkText}</span>
                        </div>
                    ))}
                </div>
            )}

            {showWarning && !sessionTerminated && (
                <div
                    role="alert"
                    aria-live="assertive"
                    style={{
                        position: 'fixed',
                        top: '20px',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        zIndex: 100001,
                        background: warningGradient,
                        color: '#fff',
                        padding: '14px 28px',
                        borderRadius: '12px',
                        fontSize: '14px',
                        fontWeight: 600,
                        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                        border: warningBorder,
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
