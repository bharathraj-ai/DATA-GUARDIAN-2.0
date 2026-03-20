'use client';

import { useState, useEffect, useRef } from 'react';

interface ActiveParticipant {
    email: string;
    name: string;
    level: number;
    color: string;
}

interface ChatMessage {
    id: string;
    senderEmail: string;
    content: string;
    timestamp: string;
}

interface LiveActivityModalProps {
    token: string;
    topic: string; // The topic of the shared link for the modal header
    onClose: () => void;
}

export default function LiveActivityModal({ token, topic, onClose }: LiveActivityModalProps) {
    const [status, setStatus] = useState<'connecting' | 'connected' | 'error' | 'disconnected'>('connecting');
    const [participants, setParticipants] = useState<ActiveParticipant[]>([]);
    const [chats, setChats] = useState<ChatMessage[]>([]);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    const chatEndRef = useRef<HTMLDivElement>(null);

    // Auto-scroll chats
    useEffect(() => {
        if (chatEndRef.current) {
            chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [chats]);

    useEffect(() => {
        let eventSource: EventSource | null = null;
        let isComponentMounted = true;

        const connect = () => {
            setStatus('connecting');
            setErrorMsg(null);

            eventSource = new EventSource(`/api/session-monitor?token=${token}`);

            eventSource.onopen = () => {
                if (isComponentMounted) setStatus('connected');
            };

            eventSource.onmessage = (event) => {
                if (!isComponentMounted) return;
                try {
                    const data = JSON.parse(event.data);
                    
                    if (data.type === 'heartbeat') {
                        if (data.activeParticipants) {
                            setParticipants(data.activeParticipants);
                        }
                        if (data.chats) {
                            setChats(data.chats);
                        }
                    } else if (data.type === 'revoked' || data.type === 'expired') {
                        setStatus('disconnected');
                        setErrorMsg(data.type === 'revoked' ? 'This link has been revoked.' : 'This link has expired.');
                        eventSource?.close();
                    } else if (data.type === 'error') {
                        setStatus('error');
                        setErrorMsg(data.message || 'Stream error');
                        eventSource?.close();
                    }
                } catch (e) {
                    console.error('Failed to parse SSE data', e);
                }
            };

            eventSource.onerror = () => {
                if (isComponentMounted) {
                    setStatus('error');
                    setErrorMsg('Lost connection to server. Automatically retrying...');
                    eventSource?.close();
                    
                    // Attempt reconnect after 5s
                    setTimeout(() => {
                        if (isComponentMounted) connect();
                    }, 5000);
                }
            };
        };

        connect();

        return () => {
            isComponentMounted = false;
            if (eventSource) {
                eventSource.close();
            }
        };
    }, [token]);

    const formatTime = (isoString: string) => {
        const d = new Date(isoString);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0, 0, 0, 0.7)', backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 9999, padding: '20px'
        }} onClick={onClose}>
            <div style={{
                background: '#111827',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '16px',
                width: '100%', maxWidth: '600px',
                maxHeight: '90vh',
                display: 'flex', flexDirection: 'column',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
                overflow: 'hidden'
            }} onClick={e => e.stopPropagation()}>
                
                {/* Header */}
                <div style={{
                    padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: 'rgba(255,255,255,0.02)'
                }}>
                    <div>
                        <h2 style={{ fontSize: '1.2rem', fontWeight: 600, color: 'white', display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <span style={{
                                width: '10px', height: '10px', borderRadius: '50%',
                                background: status === 'connected' ? '#22c55e' : status === 'connecting' ? '#f59e0b' : '#ef4444',
                                display: 'inline-block',
                                boxShadow: status === 'connected' ? '0 0 10px rgba(34,197,94,0.5)' : 'none',
                                animation: status === 'connected' ? 'pulse 2s infinite' : 'none'
                             }} />
                            Live Activity Monitor
                        </h2>
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                            {topic}
                        </p>
                    </div>
                    <button onClick={onClose} style={{
                        background: 'rgba(255,255,255,0.05)', border: 'none', color: 'var(--text-secondary)',
                        width: '32px', height: '32px', borderRadius: '8px', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem',
                    }}>×</button>
                </div>

                {errorMsg && (
                    <div style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', padding: '12px 24px', fontSize: '0.85rem', fontWeight: 500, borderBottom: '1px solid rgba(239, 68, 68, 0.2)' }}>
                        ⚠️ {errorMsg}
                    </div>
                )}

                <div style={{ display: 'flex', flex: 1, minHeight: '400px', flexDirection: 'row' }}>
                    
                    {/* Active Users Sidebar */}
                    <div style={{ width: '220px', borderRight: '1px solid rgba(255,255,255,0.06)', padding: '20px', overflowY: 'auto' }}>
                        <h3 style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.5px', marginBottom: '16px' }}>
                            Online Members ({participants.length})
                        </h3>
                        
                        {status === 'connecting' && participants.length === 0 ? (
                            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>Connecting...</p>
                        ) : participants.length === 0 ? (
                            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>No one is currently online.</p>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                {participants.map(p => (
                                    <div key={p.email} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <div style={{ 
                                            width: '32px', height: '32px', borderRadius: '50%', background: p.color, 
                                            display: 'flex', alignItems: 'center', justifyContent: 'center', 
                                            color: 'white', fontWeight: 600, fontSize: '0.8rem', flexShrink: 0 
                                        }}>
                                            {p.name.charAt(0).toUpperCase()}
                                        </div>
                                        <div style={{ overflow: 'hidden' }}>
                                            <p style={{ fontSize: '0.8rem', fontWeight: 500, color: 'white', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                                                {p.name}
                                            </p>
                                            <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                                                Level {p.level}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Chat Monitor */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'rgba(0,0,0,0.2)' }}>
                        <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                            <h3 style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                                Recent Chat Activity
                            </h3>
                        </div>
                        
                        <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {chats.length === 0 ? (
                                <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontStyle: 'italic' }}>No chat messages yet.</p>
                                </div>
                            ) : (
                                chats.map((chat) => {
                                    const participant = participants.find(p => p.email === chat.senderEmail);
                                    const fallbackColor = '#4b5563';
                                    
                                    return (
                                        <div key={chat.id} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                                                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: participant?.color || fallbackColor }}>
                                                    {participant?.name || chat.senderEmail.split('@')[0]}
                                                </span>
                                                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                                                    {formatTime(chat.timestamp)}
                                                </span>
                                            </div>
                                            <div style={{ 
                                                display: 'inline-block',
                                                background: 'rgba(255,255,255,0.05)',
                                                border: '1px solid rgba(255,255,255,0.08)',
                                                padding: '8px 12px',
                                                borderRadius: '0 12px 12px 12px',
                                                fontSize: '0.85rem',
                                                color: 'var(--color-text)',
                                                wordBreak: 'break-word',
                                                maxWidth: '95%'
                                            }}>
                                                {chat.content}
                                            </div>
                                        </div>
                                    )
                                })
                            )}
                            <div ref={chatEndRef} />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
