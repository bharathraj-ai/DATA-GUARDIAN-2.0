'use client';

import React, { useState, useRef, useEffect, memo } from 'react';
import { useCollaborationStore } from '@/store/useCollaborationStore';
import { MessageSquare, X } from 'lucide-react';

export const ChatPanel = memo(function ChatPanel() {
    const isChatOpen = useCollaborationStore((s) => s.isChatOpen);
    const setChatOpen = useCollaborationStore((s) => s.setChatOpen);
    const chats = useCollaborationStore((s) => s.chats);
    const unreadCount = useCollaborationStore((s) => s.unreadCount);
    const activeParticipants = useCollaborationStore((s) => s.activeParticipants);
    const token = useCollaborationStore((s) => s.token);

    const [chatMessage, setChatMessage] = useState('');
    const chatEndRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom when new messages arrive
    useEffect(() => {
        if (isChatOpen) {
            chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [chats, isChatOpen]);

    const handleSendMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!chatMessage.trim() || !token) return;

        const msg = chatMessage;
        setChatMessage('');

        // Optimistic UI update could go here
        
        try {
            await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, content: msg, receiverEmail: null })
            });
        } catch (error) {
            console.error('Failed to send message', error);
        }
    };

    return (
        <div style={{ position: 'fixed', bottom: '24px', right: '24px', zIndex: 900, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '12px' }}>
            {isChatOpen && (
                <div style={{
                    width: '360px', maxWidth: 'calc(100vw - 48px)',
                    height: '450px', maxHeight: 'calc(100vh - 120px)',
                    background: '#FFFFFF',
                    borderRadius: '16px',
                    boxShadow: '0 8px 40px rgba(0,0,0,0.15), 0 2px 8px rgba(0,0,0,0.1)',
                    display: 'flex', flexDirection: 'column',
                    overflow: 'hidden',
                    animation: 'slideUp 0.25s ease-out',
                }}>
                    {/* Chat Header */}
                    <div style={{
                        padding: '14px 16px',
                        background: 'linear-gradient(135deg, #111, #1f2937)',
                        color: '#fff',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    }}>
                        <div>
                            <div style={{ fontSize: '14px', fontWeight: 700 }}>Team Chat</div>
                            <div style={{ fontSize: '11px', color: '#9CA3AF', marginTop: '2px' }}>
                                {activeParticipants?.length || 0} active • Messages deleted on expiry
                            </div>
                        </div>
                        <button onClick={() => setChatOpen(false)} style={{
                            background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff',
                            width: '28px', height: '28px', borderRadius: '50%', cursor: 'pointer',
                            fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>✕</button>
                    </div>

                    {/* Active Participants */}
                    {activeParticipants && activeParticipants.length > 0 && (
                        <div style={{ padding: '8px 12px', borderBottom: '1px solid #E5E7EB', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                            {activeParticipants.map((p, idx) => (
                                <span key={idx} style={{
                                    fontSize: '11px', padding: '2px 8px', borderRadius: '10px',
                                    background: '#F3F4F6', color: '#6B7280',
                                }}>
                                    {p.name || p.email?.split('@')[0] || 'Guest'}
                                </span>
                            ))}
                        </div>
                    )}

                    {/* Chat Messages */}
                    <div style={{ flex: 1, padding: '12px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {chats.length === 0 ? (
                            <div style={{ color: '#9CA3AF', fontSize: '12px', textAlign: 'center', margin: 'auto' }}>
                                No messages yet.
                            </div>
                        ) : chats.map((c) => (
                            <div key={c.id} style={{ alignSelf: 'flex-start', maxWidth: '85%' }}>
                                <div style={{ fontSize: '10px', color: '#9CA3AF', marginBottom: '2px', textAlign: 'left' }}>
                                    {c.senderEmail?.split('@')[0] || 'Unknown'}
                                </div>
                                <div style={{
                                    background: '#F3F4F6', color: '#111111',
                                    padding: '8px 12px', borderRadius: '12px', fontSize: '13px',
                                }}>
                                    {c.content}
                                </div>
                            </div>
                        ))}
                        <div ref={chatEndRef} />
                    </div>

                    {/* Chat Input */}
                    <form onSubmit={handleSendMessage} style={{
                        display: 'flex', borderTop: '1px solid #E5E7EB', padding: '10px 12px',
                        background: '#F9FAFB', gap: '8px',
                    }}>
                        <input
                            type="text"
                            value={chatMessage}
                            onChange={(e) => setChatMessage(e.target.value)}
                            placeholder="Type a message..."
                            style={{
                                flex: 1, border: '1px solid #E5E7EB', borderRadius: '20px',
                                padding: '8px 14px', fontSize: '13px', outline: 'none',
                                background: '#fff',
                            }}
                        />
                        <button type="submit" disabled={!chatMessage.trim()} style={{
                            width: '36px', height: '36px', borderRadius: '50%', border: 'none',
                            background: chatMessage.trim() ? '#111' : '#E5E7EB',
                            color: chatMessage.trim() ? '#fff' : '#9CA3AF',
                            cursor: chatMessage.trim() ? 'pointer' : 'not-allowed',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: '16px', flexShrink: 0,
                        }}>↑</button>
                    </form>
                </div>
            )}

            {/* Floating Toggle Button */}
            <button
                onClick={() => setChatOpen(!isChatOpen)}
                style={{
                    width: '56px', height: '56px', borderRadius: '50%',
                    background: isChatOpen ? '#374151' : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                    border: 'none', cursor: 'pointer',
                    boxShadow: '0 4px 20px rgba(99,102,241,0.4)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '24px', color: '#fff',
                    transition: 'all 0.2s ease',
                    position: 'relative',
                }}
                title={isChatOpen ? 'Close chat' : 'Open team chat'}
            >
                {isChatOpen ? <X size={24} /> : <MessageSquare size={24} />}
                {!isChatOpen && unreadCount > 0 && (
                    <span style={{
                        position: 'absolute', top: '-4px', right: '-4px',
                        background: '#EF4444', color: '#fff',
                        width: '22px', height: '22px', borderRadius: '50%',
                        fontSize: '11px', fontWeight: 700,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        border: '2px solid #fff',
                    }}>
                        {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                )}
            </button>
            <style>{`
                @keyframes slideUp {
                    from { opacity: 0; transform: translateY(20px); }
                    to { opacity: 1; transform: translateY(0); }
                }
            `}</style>
        </div>
    );
});
