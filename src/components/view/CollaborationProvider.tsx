'use client';

import React, { useEffect, useRef } from 'react';
import { useCollaborationStore, CapabilityFlags } from '@/store/useCollaborationStore';

interface CollaborationProviderProps {
    token: string;
    children: React.ReactNode;
    /** Server-fetched capabilities to seed the store before SSE connects */
    initialCapabilities?: CapabilityFlags;
    /** Server-fetched remaining seconds to seed the countdown immediately */
    initialRemainingSeconds?: number;
}

export const CollaborationProvider: React.FC<CollaborationProviderProps> = ({
    token,
    children,
    initialCapabilities,
    initialRemainingSeconds,
}) => {
    const {
        setToken,
        setCapabilities,
        updateRemainingSeconds,
        setConnectionStatus,
        updatePresence,
        addChats,
    } = useCollaborationStore();
    const eventSourceRef = useRef<EventSource | null>(null);
    const seededRef = useRef(false);

    // Seed store with server-fetched data immediately (no SSE wait)
    useEffect(() => {
        if (seededRef.current) return;
        seededRef.current = true;
        setToken(token);
        if (initialCapabilities) setCapabilities(initialCapabilities);
        if (initialRemainingSeconds !== undefined) updateRemainingSeconds(initialRemainingSeconds);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Connect SSE stream for live updates
    useEffect(() => {
        let retryTimeout: ReturnType<typeof setTimeout>;
        let retryCount = 0;
        const MAX_RETRIES = 5;

        const connect = () => {
            setConnectionStatus('connecting');
            const es = new EventSource(`/api/stream/${token}`);
            eventSourceRef.current = es;

            es.onopen = () => {
                setConnectionStatus('connected');
                retryCount = 0;
            };

            es.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);

                    if (data.type === 'data' || data.type === 'heartbeat') {
                        if (data.remainingSeconds !== undefined) updateRemainingSeconds(data.remainingSeconds);
                        // Capabilities on heartbeat: server may update them (preemption changes)
                        if (data.capabilities) setCapabilities(data.capabilities);
                        if (data.activeParticipants) updatePresence(data.activeParticipants, data.highestActiveLevel ?? null);
                        if (data.chats) addChats(data.chats);
                    } else if (data.type === 'expired' || data.type === 'revoked' || data.type === 'session_invalid') {
                        setConnectionStatus('disconnected');
                        es.close();
                        // Hard reload to show the correct server-rendered error state
                        window.location.reload();
                    }
                } catch (e) {
                    console.error('SSE parse error:', e);
                }
            };

            es.onerror = () => {
                setConnectionStatus('disconnected');
                es.close();
                // Exponential backoff reconnect
                if (retryCount < MAX_RETRIES) {
                    const delay = Math.min(1000 * 2 ** retryCount, 30000);
                    retryCount++;
                    retryTimeout = setTimeout(connect, delay);
                }
            };
        };

        connect();

        return () => {
            clearTimeout(retryTimeout);
            if (eventSourceRef.current) {
                eventSourceRef.current.close();
            }
        };
    }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

    return <>{children}</>;
};
