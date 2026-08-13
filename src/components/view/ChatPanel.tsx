'use client';

import React, { useState, useRef, useEffect, memo } from 'react';
import { useCollaborationStore } from '@/store/useCollaborationStore';
import { MessageSquare, X } from 'lucide-react';
import styles from './ChatPanel.module.css';

export const ChatPanel = memo(function ChatPanel() {
    const isChatOpen = useCollaborationStore((s) => s.isChatOpen);
    const setChatOpen = useCollaborationStore((s) => s.setChatOpen);
    const chats = useCollaborationStore((s) => s.chats);
    const unreadCount = useCollaborationStore((s) => s.unreadCount);
    const activeParticipants = useCollaborationStore((s) => s.activeParticipants);
    const token = useCollaborationStore((s) => s.token);

    const [chatMessage, setChatMessage] = useState('');
    const chatEndRef = useRef<HTMLDivElement>(null);

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
        <div className={styles.wrap}>
            {isChatOpen && (
                <div className={styles.panel}>
                    <div className={styles.head}>
                        <div>
                            <div className={styles.title}>Team chat</div>
                            <div className={styles.sub}>
                                {activeParticipants?.length || 0} active · Messages die with the session
                            </div>
                        </div>
                        <button type="button" onClick={() => setChatOpen(false)} className={styles.close} aria-label="Close chat">
                            <X size={14} />
                        </button>
                    </div>

                    {activeParticipants && activeParticipants.length > 0 && (
                        <div className={styles.people}>
                            {activeParticipants.map((p, idx) => (
                                <span key={idx} className={styles.chip}>
                                    {p.name || p.email?.split('@')[0] || 'Guest'}
                                </span>
                            ))}
                        </div>
                    )}

                    <div className={styles.messages}>
                        {chats.length === 0 ? (
                            <div className={styles.empty}>No messages yet.</div>
                        ) : chats.map((c) => (
                            <div key={c.id} className={styles.msg}>
                                <div className={styles.sender}>
                                    {c.senderEmail?.split('@')[0] || 'Unknown'}
                                </div>
                                <div className={styles.bubble}>{c.content}</div>
                            </div>
                        ))}
                        <div ref={chatEndRef} />
                    </div>

                    <form onSubmit={handleSendMessage} className={styles.form}>
                        <input
                            type="text"
                            value={chatMessage}
                            onChange={(e) => setChatMessage(e.target.value)}
                            placeholder="Type a message…"
                            className={styles.input}
                        />
                        <button
                            type="submit"
                            disabled={!chatMessage.trim()}
                            className={`${styles.send} ${chatMessage.trim() ? styles.sendOn : ''}`}
                            aria-label="Send"
                        >
                            ↑
                        </button>
                    </form>
                </div>
            )}

            <button
                type="button"
                onClick={() => setChatOpen(!isChatOpen)}
                className={`${styles.fab} ${isChatOpen ? styles.fabOpen : ''}`}
                title={isChatOpen ? 'Close chat' : 'Open team chat'}
            >
                {isChatOpen ? <X size={22} /> : <MessageSquare size={22} />}
                {!isChatOpen && unreadCount > 0 && (
                    <span className={styles.badge}>
                        {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                )}
            </button>
        </div>
    );
});
