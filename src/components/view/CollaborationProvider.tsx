'use client';

import React, { ReactNode, useEffect, useRef } from 'react';
import { useCollaborationStore, type EditLockEventPayload, type PublicEditLock } from '@/store/useCollaborationStore';
import { markInternalNavigation } from './sudden-exit-client';

interface Props {
    children: ReactNode;
    token: string;
    initialCapabilities: any;
    initialRemainingSeconds: number;
    initialMyLevel?: number;
}

const EDIT_LOCK_EVENT_TYPES = new Set([
    'priority_access_requested',
    'priority_access_accepted',
    'priority_takeover_started',
    'editing_lock_released',
    'editing_session_revoked',
    'document_version_created',
]);

export function CollaborationProvider({
    children,
    token,
    initialCapabilities,
    initialRemainingSeconds,
    initialMyLevel,
}: Props) {
    const initialized = useRef(false);

    useEffect(() => {
        if (!initialized.current) {
            const store = useCollaborationStore.getState();
            store.setToken(token);
            store.setCapabilities(initialCapabilities);
            store.updateRemainingSeconds(initialRemainingSeconds);
            if (typeof initialMyLevel === 'number') {
                store.setMyAssignedLevel(initialMyLevel);
            }
            initialized.current = true;
        }
    }, [token, initialCapabilities, initialRemainingSeconds, initialMyLevel]);

    // Presence heartbeat — keeps DocumentSession.lastSeenAt alive for SSE presence.
    useEffect(() => {
        let stopped = false;
        const beat = async () => {
            if (stopped) return;
            try {
                await fetch('/api/collaboration/heartbeat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token, displayName: undefined }),
                });
            } catch {
                /* ignore — SSE remains source for connection health */
            }
        };
        beat();
        const id = setInterval(beat, 25_000);
        return () => {
            stopped = true;
            clearInterval(id);
        };
    }, [token]);

    // Establish SSE connection to receive live updates (revocations, chats, heartbeats, edit locks)
    useEffect(() => {
        let eventSource: EventSource | null = null;
        let reconnectTimeout: ReturnType<typeof setTimeout> | undefined;
        let closed = false;

        const connect = () => {
            if (closed) return;
            if (eventSource) {
                eventSource.close();
                eventSource = null;
            }

            eventSource = new EventSource(`/api/stream/${token}`);

            eventSource.onopen = () => {
                useCollaborationStore.getState().setConnectionStatus('connected');
            };

            eventSource.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    const store = useCollaborationStore.getState();

                    if (data.type === 'data') {
                        store.updateRemainingSeconds(data.remainingSeconds);
                    } else if (data.type === 'heartbeat') {
                        store.updateRemainingSeconds(data.remainingSeconds);
                        if (typeof data.myLevel === 'number') {
                            store.setMyAssignedLevel(data.myLevel);
                        }
                        if (data.activeParticipants) {
                            store.updatePresence(data.activeParticipants, data.highestActiveLevel ?? null);
                        }
                        if (data.chats) {
                            store.addChats(data.chats);
                        }
                        if (data.latestFileInputTimestamp) {
                            store.setLatestFileInputTimestamp(data.latestFileInputTimestamp);
                        }
                        if (data.editLocks && typeof data.editLocks === 'object') {
                            store.setEditLocks(data.editLocks as Record<string, PublicEditLock>);
                        }
                    } else if (EDIT_LOCK_EVENT_TYPES.has(data.type)) {
                        const payload = data as EditLockEventPayload;
                        store.setEditLockEvent(payload);
                        const fileId = data.documentId || data.payload?.documentId;
                        if (typeof fileId === 'string' && data.type === 'editing_session_revoked') {
                            store.setEditLockUi(fileId, 'revoked');
                        }
                        if (typeof fileId === 'string' && data.type === 'priority_access_requested') {
                            const currentUi = store.editLockUiByFile[fileId];
                            if (currentUi !== 'takeover_warning' && currentUi !== 'waiting_takeover') {
                                store.setEditLockUi(fileId, 'takeover_warning');
                            }
                        }
                    } else if (data.type === 'revoked' || data.type === 'expired' || data.type === 'session_invalid') {
                        store.setAccessStatus(data.type);
                        eventSource?.close();

                        // After "Take Break", cookies are cleared on purpose — go to dashboard,
                        // do not reload /view (that shows Access Denied).
                        try {
                            if (sessionStorage.getItem('dg:post-break-redirect') === '1') {
                                sessionStorage.removeItem('dg:post-break-redirect');
                                markInternalNavigation();
                                window.location.replace('/dashboard/vendor');
                                return;
                            }
                        } catch {
                            /* ignore */
                        }

                        markInternalNavigation();
                        if (data.type === 'session_invalid') {
                            window.location.replace(`/share/${token}`);
                            return;
                        }

                        // Revoked / expired: reload so the server shows the error screen
                        window.location.reload();
                    }
                } catch (err) {
                    console.error('Failed to parse SSE data', err);
                }
            };

            eventSource.onerror = () => {
                useCollaborationStore.getState().setConnectionStatus('disconnected');
                eventSource?.close();
                eventSource = null;
                if (closed) return;
                if (reconnectTimeout) clearTimeout(reconnectTimeout);
                reconnectTimeout = setTimeout(connect, 3000);
            };
        };

        connect();

        return () => {
            closed = true;
            if (reconnectTimeout) clearTimeout(reconnectTimeout);
            if (eventSource) {
                eventSource.close();
            }
        };
    }, [token]);

    return <>{children}</>;
}
