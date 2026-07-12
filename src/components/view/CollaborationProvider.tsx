'use client';

import React, { ReactNode, useEffect, useRef } from 'react';
import { useCollaborationStore } from '@/store/useCollaborationStore';

interface Props {
    children: ReactNode;
    token: string;
    initialCapabilities: any;
    initialRemainingSeconds: number;
}

export function CollaborationProvider({ children, token, initialCapabilities, initialRemainingSeconds }: Props) {
    const initialized = useRef(false);

    useEffect(() => {
        if (!initialized.current) {
            useCollaborationStore.getState().setToken(token);
            useCollaborationStore.getState().setCapabilities(initialCapabilities);
            useCollaborationStore.getState().updateRemainingSeconds(initialRemainingSeconds);
            initialized.current = true;
        }
    }, [token, initialCapabilities, initialRemainingSeconds]);

    // Establish SSE connection to receive live updates (revocations, chats, heartbeats)
    useEffect(() => {
        let eventSource: EventSource | null = null;
        let reconnectTimeout: ReturnType<typeof setTimeout>;

        const connect = () => {
            if (eventSource) {
                eventSource.close();
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
                        if (data.activeParticipants) {
                            store.updatePresence(data.activeParticipants, data.highestActiveLevel ?? null);
                        }
                        if (data.chats) {
                            store.addChats(data.chats);
                        }
                        if (data.latestFileInputTimestamp) {
                            store.setLatestFileInputTimestamp(data.latestFileInputTimestamp);
                        }
                    } else if (data.type === 'revoked' || data.type === 'expired' || data.type === 'session_invalid') {
                        store.setAccessStatus(data.type);
                        eventSource?.close();
                        // Force a reload so the server component catches the revoked/expired state and shows the error screen
                        window.location.reload();
                    }
                } catch (err) {
                    console.error('Failed to parse SSE data', err);
                }
            };

            eventSource.onerror = () => {
                useCollaborationStore.getState().setConnectionStatus('disconnected');
                eventSource?.close();
                // Attempt to reconnect after 3 seconds
                reconnectTimeout = setTimeout(connect, 3000);
            };
        };

        connect();

        return () => {
            clearTimeout(reconnectTimeout);
            if (eventSource) {
                eventSource.close();
            }
        };
    }, [token]);

    return <>{children}</>;
}
