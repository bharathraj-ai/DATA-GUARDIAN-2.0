'use client';

import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { secureFetch } from '@/lib/security/secure-fetch';
import { useCollaborationStore, type EditLockUiState, type PublicEditLock } from '@/store/useCollaborationStore';
import { CollaborationStatus } from './CollaborationStatus';

export function getEditClientInstanceId(fileId: string): string {
    const key = `dg:edit-client:${fileId}`;
    try {
        const existing = sessionStorage.getItem(key);
        if (existing) return existing;
        const id = `tab_${crypto.randomUUID()}`;
        sessionStorage.setItem(key, id);
        return id;
    } catch {
        return `tab_${fileId}`;
    }
}

interface EditLockContextValue {
    ui: EditLockUiState;
    isHolder: boolean;
    forceReadOnly: boolean;
    lock: PublicEditLock | null;
    graceRemaining: number;
    errorMessage: string | null;
    release: () => Promise<void>;
    acceptTakeover: () => Promise<void>;
    clientInstanceId: string;
}

const EditLockContext = createContext<EditLockContextValue | null>(null);

export function useEditLock() {
    return useContext(EditLockContext);
}

interface Props {
    token: string;
    fileId: string;
    myLevel: number;
    onAutoSave?: () => Promise<void> | void;
    onRevoked?: () => void;
    children: React.ReactNode;
}

export function EditLockProvider({
    token,
    fileId,
    onAutoSave,
    onRevoked,
    children,
}: Props) {
    const clientInstanceId = useMemo(() => getEditClientInstanceId(fileId), [fileId]);
    const [ui, setUi] = useState<EditLockUiState>('idle');
    const [lock, setLock] = useState<PublicEditLock | null>(null);
    const [isHolder, setIsHolder] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [graceRemaining, setGraceRemaining] = useState(0);
    const [revokedModal, setRevokedModal] = useState(false);
    const [warningHidden, setWarningHidden] = useState(false);
    const onAutoSaveRef = useRef(onAutoSave);
    const onRevokedRef = useRef(onRevoked);
    const savingRef = useRef(false);
    const holderRef = useRef(false);
    const lastPendingKeyRef = useRef<string | null>(null);
    const lastHandledEventIdRef = useRef<string | null>(null);

    useEffect(() => { onAutoSaveRef.current = onAutoSave; }, [onAutoSave]);
    useEffect(() => { onRevokedRef.current = onRevoked; }, [onRevoked]);
    useEffect(() => { holderRef.current = isHolder; }, [isHolder]);

    const applyStatus = useCallback((data: any) => {
        const nextLock = (data.lock || null) as PublicEditLock | null;
        if (nextLock) nextLock.documentId = nextLock.documentId || fileId;
        setLock(nextLock);
        if (nextLock) {
            useCollaborationStore.getState().upsertEditLock(fileId, nextLock);
        }
        const holder = Boolean(data.isHolder);
        setIsHolder(holder);
        if (typeof data.myUserId === 'string') {
            useCollaborationStore.getState().setMyUserId(data.myUserId);
        }
        if (typeof data.myPriority === 'number') {
            useCollaborationStore.getState().setMyAssignedLevel(data.myPriority);
        }

        const pending = nextLock?.pendingTakeover;
        if (data.status === 'duplicate_tab') {
            setUi('blocked');
            setErrorMessage(data.error || 'You are already editing this document in another tab.');
            useCollaborationStore.getState().setEditLockUi(fileId, 'blocked');
            return;
        }
        if (data.status === 'denied_higher_priority' || data.status === 'denied_same_priority') {
            if (nextLock?.pendingTakeover && data.isPendingRequester) {
                setUi('waiting_takeover');
                useCollaborationStore.getState().setEditLockUi(fileId, 'waiting_takeover');
                return;
            }
            setUi('blocked');
            setErrorMessage(data.error || 'Document is currently being edited by another user.');
            useCollaborationStore.getState().setEditLockUi(fileId, 'blocked');
            return;
        }
        if (data.status === 'takeover_pending' || data.isPendingRequester) {
            setUi('waiting_takeover');
            setGraceRemaining(pending?.graceRemainingSeconds ?? 0);
            useCollaborationStore.getState().setEditLockUi(fileId, 'waiting_takeover');
            return;
        }
        if (holder && pending) {
            const pendingKey = `${pending.requesterUserId}:${pending.requestedAt}:${pending.mode || 'takeover'}`;
            const isNewRequest = lastPendingKeyRef.current !== pendingKey;
            lastPendingKeyRef.current = pendingKey;
            setUi('takeover_warning');
            if (isNewRequest) setWarningHidden(false);
            setGraceRemaining(pending.graceRemainingSeconds ?? 0);
            useCollaborationStore.getState().setEditLockUi(fileId, 'takeover_warning');
            return;
        }
        if (holder) {
            lastPendingKeyRef.current = null;
            setWarningHidden(false);
            setUi('editing');
            setErrorMessage(null);
            useCollaborationStore.getState().setEditLockUi(fileId, 'editing');
            return;
        }
        if (useCollaborationStore.getState().editLockUiByFile[fileId] === 'revoked') {
            setUi('revoked');
            setRevokedModal(true);
            useCollaborationStore.getState().setEditLockUi(fileId, 'revoked');
            return;
        }
        if (nextLock?.holder) {
            setUi('can_request');
            useCollaborationStore.getState().setEditLockUi(fileId, 'can_request');
            return;
        }
        setUi('idle');
        useCollaborationStore.getState().setEditLockUi(fileId, 'idle');
    }, [fileId]);

    const requestLock = useCallback(async () => {
        const res = await secureFetch(`/api/documents/${fileId}/edit-lock/request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-edit-client-instance': clientInstanceId },
            body: JSON.stringify({ token, clientInstanceId }),
        });
        const data = await res.json().catch(() => ({}));
        applyStatus({ ...data, isHolder: data.isHolder, isPendingRequester: data.isPendingRequester });
        if (!res.ok && data.error) setErrorMessage(data.error);
        return data;
    }, [fileId, token, clientInstanceId, applyStatus]);

    const refreshStatus = useCallback(async () => {
        const res = await secureFetch(
            `/api/documents/${fileId}/edit-lock/status?token=${encodeURIComponent(token)}&clientInstanceId=${encodeURIComponent(clientInstanceId)}`,
        );
        const data = await res.json().catch(() => ({}));
        applyStatus(data);
        if (data.status === 'takeover_completed' && data.isHolder) {
            setUi('editing');
            setErrorMessage(null);
        }
        return data;
    }, [fileId, token, clientInstanceId, applyStatus]);

    const heartbeat = useCallback(async () => {
        const res = await secureFetch(`/api/documents/${fileId}/edit-lock/heartbeat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-edit-client-instance': clientInstanceId },
            body: JSON.stringify({ token, clientInstanceId }),
        });
        const data = await res.json().catch(() => ({}));
        applyStatus(data);
        return data;
    }, [fileId, token, clientInstanceId, applyStatus]);

    const release = useCallback(async () => {
        await secureFetch(`/api/documents/${fileId}/edit-lock/release`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-edit-client-instance': clientInstanceId },
            body: JSON.stringify({ token, clientInstanceId }),
        });
        setIsHolder(false);
        setUi('idle');
        useCollaborationStore.getState().setEditLockUi(fileId, 'idle');
    }, [fileId, token, clientInstanceId]);

    const acceptTakeover = useCallback(async () => {
        try {
            if (!savingRef.current && onAutoSaveRef.current) {
                savingRef.current = true;
                await onAutoSaveRef.current();
                savingRef.current = false;
            }
        } catch {
            savingRef.current = false;
        }
        await secureFetch(`/api/documents/${fileId}/edit-lock/takeover`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-edit-client-instance': clientInstanceId },
            body: JSON.stringify({ token, clientInstanceId, action: 'accept' }),
        });
        await release();
    }, [fileId, token, clientInstanceId, release]);

    const refreshStatusRef = useRef(refreshStatus);
    const requestLockRef = useRef(requestLock);
    useEffect(() => {
        refreshStatusRef.current = refreshStatus;
        requestLockRef.current = requestLock;
    }, [refreshStatus, requestLock]);

    // Acquire only if the document is free (or we already hold/requested it).
    // Do not notify the current editor until the user clicks "Request to edit".
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const data = await refreshStatusRef.current();
                if (cancelled) return;
                const otherHolder = Boolean(data?.lock?.holder) && !data?.isHolder && !data?.isPendingRequester;
                if (!otherHolder) await requestLockRef.current();
            } catch {
                if (!cancelled) setErrorMessage('Could not reach the editing lock service.');
            }
        })();
        return () => { cancelled = true; };
    }, [fileId, token, clientInstanceId]);

    const openChatWith = useCallback((targetUserId?: string, targetName?: string) => {
        window.dispatchEvent(new CustomEvent('dg:open-chat', {
            detail: { fileId, targetUserId, targetName },
        }));
    }, [fileId]);

    const sseConnected = useCollaborationStore((s) => s.connectionStatus === 'connected');

    // SSE is primary; poll only while disconnected. Never poll when SSE is healthy.
    useEffect(() => {
        if (sseConnected) return;
        if (ui !== 'editing' && ui !== 'takeover_warning' && ui !== 'waiting_takeover' && ui !== 'can_request') return;
        const id = setInterval(async () => {
            const data = await refreshStatus().catch(() => null);
            if (ui === 'can_request' && data && !data.lock?.holder && !data.isHolder) {
                await requestLock().catch(() => undefined);
            }
        }, 15_000);
        return () => clearInterval(id);
    }, [ui, sseConnected, refreshStatus, requestLock]);

    // Only the lock holder (or waiting requester) needs a Redis heartbeat.
    useEffect(() => {
        if (ui !== 'editing' && ui !== 'takeover_warning' && ui !== 'waiting_takeover') return;
        const beatId = setInterval(() => { heartbeat().catch(() => undefined); }, 45_000);
        return () => clearInterval(beatId);
    }, [ui, heartbeat]);

    // Snapshot once when an access request arrives — do not loop (OCC + no countdown timers).
    useEffect(() => {
        if (ui !== 'takeover_warning') return;
        if (savingRef.current || !onAutoSaveRef.current) return;
        savingRef.current = true;
        void Promise.resolve(onAutoSaveRef.current())
            .catch(() => undefined)
            .finally(() => { savingRef.current = false; });
    }, [ui]);

    const forceTakeover = useCallback(async () => {
        const res = await secureFetch(`/api/documents/${fileId}/edit-lock/takeover`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-edit-client-instance': clientInstanceId },
            body: JSON.stringify({ token, clientInstanceId, action: 'force' }),
        });
        const data = await res.json().catch(() => ({}));
        applyStatus(data);
        if (data.success) {
            setUi('editing');
            setErrorMessage(null);
        }
    }, [fileId, token, clientInstanceId, applyStatus]);

    // SSE-driven revocation
    const lastEvent = useCollaborationStore((s) => s.lastEditLockEvent);
    useEffect(() => {
        if (!lastEvent) return;
        const eventId = lastEvent.id || `${lastEvent.type}:${lastEvent.documentId}:${lastEvent.payload?.requestedAt || ''}`;
        if (lastHandledEventIdRef.current === eventId) return;
        lastHandledEventIdRef.current = eventId;
        const docId = lastEvent.documentId || (lastEvent.payload?.documentId as string | undefined);
        if (docId && docId !== fileId) return;
        if (lastEvent.type === 'priority_access_requested' && holderRef.current) {
            const requesterId = String(
                lastEvent.requester?.userId
                || (lastEvent.payload?.requester as { userId?: string } | undefined)?.userId
                || '',
            );
            const requestedAt = String(lastEvent.payload?.requestedAt ?? '');
            const pendingKey = `${requesterId}:${requestedAt}`;
            const isNewRequest = !lastPendingKeyRef.current || !lastPendingKeyRef.current.startsWith(pendingKey);
            setUi('takeover_warning');
            if (isNewRequest) setWarningHidden(false);
            const grace = Number(lastEvent.gracePeriodSeconds ?? lastEvent.payload?.gracePeriodSeconds ?? 0);
            setGraceRemaining(grace);
            useCollaborationStore.getState().setEditLockUi(fileId, 'takeover_warning');
            refreshStatus().catch(() => undefined);
        }
        if (lastEvent.type === 'editing_session_revoked' || lastEvent.type === 'priority_takeover_started') {
            const prevSession = (lastEvent.payload?.previousEditor as { sessionId?: string } | undefined)?.sessionId;
            // If we were the previous editor, drop to read-only.
            if (!holderRef.current || prevSession) {
                setIsHolder(false);
                setUi('revoked');
                setRevokedModal(true);
                useCollaborationStore.getState().setEditLockUi(fileId, 'revoked');
                onRevokedRef.current?.();
                refreshStatus().catch(() => undefined);
            }
        }
        if (lastEvent.type === 'priority_access_accepted' || lastEvent.type === 'editing_lock_released') {
            refreshStatus().catch(() => undefined);
        }
    }, [lastEvent, fileId, refreshStatus]);

    // Tab close: SuddenExitGuard releases the lock (and rotates OTP). Do not
    // beacon /edit-lock/release here — sendBeacon cannot send nonce headers.

    const pending = lock?.pendingTakeover;
    const holder = lock?.holder;

    const ctx: EditLockContextValue = {
        ui,
        isHolder,
        // Holder stays writable during the grace period; everyone else is read-only.
        forceReadOnly: ui !== 'editing' && ui !== 'takeover_warning',
        lock,
        graceRemaining,
        errorMessage,
        release,
        acceptTakeover,
        clientInstanceId,
    };

    return (
        <EditLockContext.Provider value={ctx}>
            <div className="edit-lock-status" style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, pointerEvents: 'none' }}>
                <div
                    style={{
                        pointerEvents: 'auto',
                        cursor: warningHidden && (ui === 'takeover_warning' || ui === 'waiting_takeover' || ui === 'can_request') ? 'pointer' : undefined,
                    }}
                    onClick={() => {
                        if (warningHidden && (ui === 'takeover_warning' || ui === 'waiting_takeover' || ui === 'can_request')) {
                            setWarningHidden(false);
                        }
                    }}
                    title={warningHidden ? 'Show access request' : undefined}
                >
                    <CollaborationStatus state={ui} />
                </div>
            </div>

            {ui === 'takeover_warning' && pending && !warningHidden && (
                <div style={bannerWrap}>
                    <div style={warnBanner}>
                        <span>
                            {pending.requesterUserName} (P{pending.requesterPriority}) is waiting
                        </span>
                        <button type="button" onClick={() => acceptTakeover()} style={bannerBtn}>Allow</button>
                        <button type="button" onClick={() => openChatWith(pending.requesterUserId, pending.requesterUserName)} style={bannerBtn}>Chat</button>
                        <button
                            type="button"
                            aria-label="Dismiss"
                            onClick={() => setWarningHidden(true)}
                            style={bannerCloseBtn}
                        >
                            ×
                        </button>
                    </div>
                </div>
            )}

            {ui === 'can_request' && holder && !warningHidden && (
                <div style={bannerWrap}>
                    <div style={waitBanner}>
                        <span>
                            {holder.userName} (P{holder.priority}) is editing.
                        </span>
                        <button type="button" onClick={() => requestLock()} style={bannerBtn}>
                            Request to edit
                        </button>
                        <button
                            type="button"
                            onClick={() => openChatWith(holder.userId, holder.userName)}
                            style={bannerBtn}
                        >
                            Chat
                        </button>
                        <button
                            type="button"
                            aria-label="Dismiss"
                            onClick={() => setWarningHidden(true)}
                            style={bannerCloseBtn}
                        >
                            ×
                        </button>
                    </div>
                </div>
            )}

            {ui === 'waiting_takeover' && holder && !warningHidden && (
                <div style={bannerWrap}>
                    <div style={waitBanner}>
                        <span>
                            {holder.userName} (P{holder.priority}) is editing. They were notified.
                        </span>
                        <button
                            type="button"
                            onClick={() => openChatWith(holder.userId, holder.userName)}
                            style={bannerBtn}
                        >
                            Chat with {holder.userName}
                        </button>
                        {pending?.mode !== 'request' && (
                            <button type="button" onClick={() => forceTakeover()} style={bannerBtn}>
                                Take over now
                            </button>
                        )}
                        <button
                            type="button"
                            aria-label="Dismiss"
                            onClick={() => setWarningHidden(true)}
                            style={bannerCloseBtn}
                        >
                            ×
                        </button>
                    </div>
                </div>
            )}

            {ui === 'blocked' && errorMessage && (
                <div style={bannerWrap}>
                    <div style={blockBanner}>
                        {errorMessage.split('\n').map((line, i) => (
                            <div key={i}>{line}</div>
                        ))}
                    </div>
                </div>
            )}

            {revokedModal && (
                <div style={overlayCardWrap}>
                    <div style={overlayCard}>
                        <h2 style={overlayTitle}>Your editing session has ended.</h2>
                        <p style={overlayBody}>
                            A higher-priority collaborator has taken control.
                        </p>
                        <p style={overlayMuted}>
                            Your latest changes were automatically saved.<br />
                            You can continue in read-only mode.
                        </p>
                        <button type="button" onClick={() => setRevokedModal(false)} style={primaryBtn}>
                            Continue read-only
                        </button>
                    </div>
                </div>
            )}

            {children}
        </EditLockContext.Provider>
    );
}

const overlayCardWrap: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    zIndex: 300,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(15, 23, 42, 0.45)',
    padding: 24,
};
const overlayCard: React.CSSProperties = {
    maxWidth: 460,
    width: '100%',
    background: '#fff',
    border: '1px solid #bae6fd',
    borderRadius: 20,
    padding: '28px 28px 24px',
    color: '#0f172a',
    textAlign: 'center',
    boxShadow: '0 24px 48px rgba(2, 132, 199, 0.18)',
};
const overlayTitle: React.CSSProperties = { fontSize: 20, fontWeight: 650, marginBottom: 12 };
const overlayBody: React.CSSProperties = { fontSize: 14, lineHeight: 1.6, color: '#334155', marginBottom: 8 };
const overlayMuted: React.CSSProperties = { fontSize: 13, lineHeight: 1.6, color: '#64748b', marginBottom: 8 };
const primaryBtn: React.CSSProperties = {
    marginTop: 8,
    padding: '10px 18px',
    borderRadius: 8,
    border: 'none',
    background: '#0284c7',
    color: '#fff',
    fontWeight: 600,
    cursor: 'pointer',
};
const bannerWrap: React.CSSProperties = {
    position: 'absolute',
    top: 52,
    left: 0,
    right: 0,
    zIndex: 180,
    display: 'flex',
    justifyContent: 'center',
    pointerEvents: 'none',
};
const waitBanner: React.CSSProperties = {
    pointerEvents: 'auto',
    background: '#e0f2fe',
    color: '#0369a1',
    border: '1px solid #7dd3fc',
    padding: '8px 14px',
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    maxWidth: '90vw',
    boxShadow: '0 8px 20px rgba(2, 132, 199, 0.12)',
};
const warnBanner: React.CSSProperties = {
    pointerEvents: 'auto',
    background: '#fffbeb',
    color: '#b45309',
    border: '1px solid #fde68a',
    padding: '8px 14px',
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    maxWidth: '90vw',
    boxShadow: '0 8px 20px rgba(245, 158, 11, 0.12)',
};
const bannerBtn: React.CSSProperties = {
    border: 'none',
    borderRadius: 999,
    padding: '4px 10px',
    background: '#0284c7',
    color: '#fff',
    fontWeight: 700,
    cursor: 'pointer',
    fontSize: 12,
};
const bannerCloseBtn: React.CSSProperties = {
    border: 'none',
    background: 'transparent',
    color: 'inherit',
    fontSize: 18,
    fontWeight: 700,
    lineHeight: 1,
    cursor: 'pointer',
    padding: '0 2px 2px',
    opacity: 0.85,
};
const blockBanner: React.CSSProperties = {
    pointerEvents: 'auto',
    background: '#fef2f2',
    color: '#b91c1c',
    border: '1px solid #fecaca',
    padding: '10px 14px',
    borderRadius: 12,
    fontSize: 13,
    fontWeight: 600,
    maxWidth: 560,
    textAlign: 'center',
    whiteSpace: 'pre-wrap',
};
