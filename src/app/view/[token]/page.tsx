'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getUserData, MaskedUserData } from '@/actions/get-user';
import { getFilePreview, FilePreviewResult } from '@/actions/get-file-preview';
import { revokeOnScreenshot } from '@/actions/revoke-on-screenshot';
import { useSession } from 'next-auth/react';
import dynamic from 'next/dynamic';

import { getRawFileForEdit } from '@/actions/get-raw-file-for-edit';

// Lazy load the Universal File Editor from our unified codebase
const UniversalEditor = dynamic(() => import('@/components/editors/UniversalEditor'), {
    ssr: false,
    loading: () => <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>Loading Editor...</div>,
});

interface ViewPageProps {
    params: Promise<{ token: string }>;
}

interface SSEData {
    type: 'data' | 'heartbeat' | 'expired' | 'revoked';
    userData?: {
        firstName: string;
        lastName: string;
        email: string;
        phone: string;
        gender: string;
        age: number;
        myAssignedLevel?: number; // Backend provided via getUserData
    };
    remainingSeconds?: number;
    activeParticipants?: any[];
    highestActiveLevel?: number;
    highestAuthorityLevel?: number;
    chats?: any[];
    latestFileInputTimestamp?: number;
}

export default function ViewPage({ params }: ViewPageProps) {
    const router = useRouter();
    const { data: session } = useSession();
    const [token, setToken] = useState<string>('');
    const [userData, setUserData] = useState<MaskedUserData | null>(null);
    const [fullData, setFullData] = useState<SSEData['userData'] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [remainingSeconds, setRemainingSeconds] = useState(0);
    const [isRevealed, setIsRevealed] = useState(false);
    const [revealTimeout, setRevealTimeoutState] = useState<NodeJS.Timeout | null>(null);
    const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
    const eventSourceRef = useRef<EventSource | null>(null);

    // Presence & Chat State
    const [highestActiveLevel, setHighestActiveLevel] = useState<number | null>(null);
    const [highestAuthorityLevel, setHighestAuthorityLevel] = useState<number | null>(null);
    const [preemptionCountdown, setPreemptionCountdown] = useState<number | null>(null);
    const [activeParticipants, setActiveParticipants] = useState<SSEData['activeParticipants']>([]);
    const [chats, setChats] = useState<SSEData['chats']>([]);
    const [chatMessage, setChatMessage] = useState('');
    const [myAssignedLevel, setMyAssignedLevel] = useState<number>(2); // Default to member
    const chatEndRef = useRef<HTMLDivElement>(null);
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [unreadCount, setUnreadCount] = useState(0);
    const lastChatCountRef = useRef(0);

    // Preview State
    const [previewData, setPreviewData] = useState<FilePreviewResult | null>(null);
    const [showPreviewModal, setShowPreviewModal] = useState(false);
    const [isPreviewLoading, setIsPreviewLoading] = useState(false);

    // Security State
    const [warningCount, setWarningCount] = useState(0);
    const MAX_WARNINGS = 3;
    const lastEditTimestampRef = useRef<number | null>(null);

    // Inline Editor State
    const [isEditLoading, setIsEditLoading] = useState<string | null>(null);
    const [editingFile, setEditingFile] = useState<File | null>(null);
    const [editingFileId, setEditingFileId] = useState<string | null>(null);
    const [isFinished, setIsFinished] = useState(false);
    const [triggerFileReload, setTriggerFileReload] = useState<number>(0);
    const isEditingFile = editingFile !== null;
    const editFileId = editingFileId;
    const editFileName = editingFile?.name || '';
    const closeEditor = () => { setEditingFile(null); setEditingFileId(null); };
    const handleEditorSaved = () => { closeEditor(); };

    // Resolve params
    useEffect(() => {
        params.then((p) => {
            // Remove any query parameters (like timestamp) from token
            const cleanToken = p.token.split('?')[0];
            setToken(cleanToken);
        });
    }, [params]);

    // Screenshot Protection - Revoke access when window loses focus or visibility changes
    // Uses keyup (more reliable than keydown for PrintScreen), clipboard detection, and blur/visibility
    useEffect(() => {
        let isRevoking = false;
        let screenshotDetected = false; // Debounce: prevent blur from double-counting a PrintScreen

        const triggerSecurityViolation = async (reason: string, displayMessage?: string) => {
            if (isRevoking || !token) return;

            // Revoke access
            isRevoking = true;
            console.warn(`[SECURITY] ${reason}`);

            // Close any open SSE stream immediately
            if (eventSourceRef.current) {
                eventSourceRef.current.close();
            }

            // Clear visible data immediately
            setUserData(null);
            setFullData(null);
            setError(displayMessage || 'security violation: Access revoked due to tab switch or focus loss');
            setConnectionStatus('disconnected');

            // Close editor if open
            setEditingFile(null);
            setEditingFileId(null);

            // Call server to revoke access and notify owner
            await revokeOnScreenshot(token, displayMessage);
        };

        // Tab Switch Protection - Combine blur and visibilitychange
        let isHandlingTabSwitch = false;

        const handleTabSwitch = (reason: string) => {
            // Only debounce duplicate events — NEVER skip for editing state
            if (screenshotDetected || isHandlingTabSwitch) return;
            
            isHandlingTabSwitch = true;
            triggerSecurityViolation(reason, 'security violation: Access revoked due to tab switch');
            
            // Debounce to prevent immediate double-counting
            setTimeout(() => { isHandlingTabSwitch = false; }, 1500);
        };

        // Detect when tab/window loses visibility (e.g., snipping tool overlay, Alt+Tab)
        const handleVisibilityChange = () => {
            if (document.hidden) {
                handleTabSwitch('Tab hidden - possible screenshot or tab switch');
            }
        };

        // Detect when window loses focus (e.g., snipping tool opens, clicking outside browser)
        const handleBlur = () => {
            // Only fire blur if the document is NOT hidden already 
            // (If it's hidden, visibilitychange handles it. Blur handles cases like floating windows over the active tab)
            if (!document.hidden) {
                handleTabSwitch('Window lost focus - possible screenshot or tab switch');
            }
        };

        // Block dangerous keyboard shortcuts
        const handleKeyDown = (e: KeyboardEvent) => {
            // PrintScreen key
            if (e.key === 'PrintScreen') {
                e.preventDefault();
                screenshotDetected = true;
                triggerSecurityViolation('PrintScreen key detected', 'security violation: Access revoked due to screenshot attempt');
                setTimeout(() => { screenshotDetected = false; }, 1000);
            }
            // Ctrl+P (Print)
            if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {
                e.preventDefault();
                triggerSecurityViolation('Print shortcut (Ctrl+P) detected', 'security violation: Access revoked due to print attempt');
            }
            // Ctrl+S (Save)
            if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
                e.preventDefault();
                triggerSecurityViolation('Save shortcut (Ctrl+S) detected', 'security violation: Access revoked due to save attempt');
            }
            // Ctrl+C (Copy)
            if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
                e.preventDefault();
                triggerSecurityViolation('Copy shortcut (Ctrl+C) detected', 'security violation: Access revoked due to copying content');
            }
            // Ctrl+Shift+I (DevTools)
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'i' || e.key === 'I')) {
                e.preventDefault();
                triggerSecurityViolation('DevTools shortcut detected', 'security violation: Access revoked due to developer tools attempt');
            }
            // Ctrl+Shift+J (Console)
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'j' || e.key === 'J')) {
                e.preventDefault();
                triggerSecurityViolation('Console shortcut detected', 'security violation: Access revoked due to developer tools attempt');
            }
            // Ctrl+U (View Source)
            if ((e.ctrlKey || e.metaKey) && (e.key === 'u' || e.key === 'U')) {
                e.preventDefault();
                triggerSecurityViolation('View source shortcut detected', 'security violation: Access revoked due to view source attempt');
            }
            // F12 (DevTools)
            if (e.key === 'F12') {
                e.preventDefault();
                triggerSecurityViolation('F12 DevTools shortcut detected', 'security violation: Access revoked due to developer tools attempt');
            }
            // Win+Shift (any combo — blocks Snipping Tool, screen recording, etc.)
            if (e.metaKey && e.shiftKey) {
                e.preventDefault();
                screenshotDetected = true;
                triggerSecurityViolation('Win+Shift shortcut detected', 'security violation: Access revoked due to screenshot attempt');
                setTimeout(() => { screenshotDetected = false; }, 1000);
            }
        };

        // Detect PrintScreen key (keyup — fires more reliably than keydown on most browsers)
        const handleKeyUp = (e: KeyboardEvent) => {
            if (e.key === 'PrintScreen') {
                e.preventDefault();
                screenshotDetected = true;
                triggerSecurityViolation('PrintScreen key detected', 'security violation: Access revoked due to screenshot attempt');
                setTimeout(() => { screenshotDetected = false; }, 1000);
            }
        };


        // Detect any copy action (selection + copy)
        const handleCopy = (e: ClipboardEvent) => {
            e.preventDefault();
            triggerSecurityViolation('Copy action detected', 'security violation: Access revoked due to copying content');
        };

        // Block drag events (prevent dragging text/images out)
        const handleDragStart = (e: DragEvent) => {
            e.preventDefault();
            triggerSecurityViolation('Drag detected', 'security violation: Access revoked due to data extraction attempt');
        };

        // Prevent right click
        const handleContextMenu = (e: MouseEvent) => {
            e.preventDefault();
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('blur', handleBlur);
        window.addEventListener('keydown', handleKeyDown, true); // Use capture phase to intercept before browser
        window.addEventListener('keyup', handleKeyUp);

        document.addEventListener('copy', handleCopy);
        document.addEventListener('dragstart', handleDragStart);
        document.addEventListener('contextmenu', handleContextMenu);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('blur', handleBlur);
            window.removeEventListener('keydown', handleKeyDown, true);
            window.removeEventListener('keyup', handleKeyUp);

            document.removeEventListener('copy', handleCopy);
            document.removeEventListener('dragstart', handleDragStart);
            document.removeEventListener('contextmenu', handleContextMenu);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token]);

    // Initial data fetch
    const fetchUserData = useCallback(async (t: string) => {
        const result = await getUserData(t);

        if (result.success && result.data) {
            setUserData(result.data);
            setRemainingSeconds(result.data.remainingSeconds);
            setMyAssignedLevel((result.data as any).myAssignedLevel || 2);
            startSSEStream(t);
        } else {
            setError(result.error || 'Failed to load data');
            if (result.errorType === 'NOT_VERIFIED') {
                router.push(`/share/${t}`);
            } else if (result.errorType === 'REVOKED') {
                setError('Access has been revoked by the data owner.');
            }
        }
        setIsLoading(false);
    }, [router]);

    // SSE Stream
    const startSSEStream = useCallback((t: string) => {
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
        }

        setConnectionStatus('connecting');
        const eventSource = new EventSource(`/api/stream/${t}`);
        eventSourceRef.current = eventSource;

        eventSource.onopen = () => {
            setConnectionStatus('connected');
        };

        eventSource.onmessage = (event) => {
            try {
                const data: SSEData = JSON.parse(event.data);

                switch (data.type) {
                    case 'data':
                        if (data.userData) {
                            setFullData(data.userData);
                        }
                        if (data.remainingSeconds !== undefined) {
                            setRemainingSeconds(data.remainingSeconds);
                        }
                        break;

                    case 'heartbeat':
                        if (data.remainingSeconds !== undefined) setRemainingSeconds(data.remainingSeconds);
                        if (data.highestActiveLevel !== undefined) setHighestActiveLevel(data.highestActiveLevel);
                        if (data.activeParticipants) setActiveParticipants(data.activeParticipants);
                        if (data.chats) {
                            setChats(prev => {
                                const newCount = (data.chats?.length || 0) - lastChatCountRef.current;
                                if (newCount > 0 && !isChatOpen) {
                                    setUnreadCount(c => c + newCount);
                                }
                                lastChatCountRef.current = data.chats?.length || 0;
                                return data.chats || [];
                            });
                        }
                        if (data.highestAuthorityLevel !== undefined) {
                            setHighestAuthorityLevel(data.highestAuthorityLevel);
                        }
                        if (data.latestFileInputTimestamp) {
                            if (lastEditTimestampRef.current !== null && lastEditTimestampRef.current !== data.latestFileInputTimestamp) {
                                // Another user updated the file! Trigger a reload.
                                setTriggerFileReload(data.latestFileInputTimestamp);
                            }
                            lastEditTimestampRef.current = data.latestFileInputTimestamp;
                        }
                        break;

                    case 'expired':
                        setError('Session expired. Data is no longer accessible.');
                        setUserData(null);
                        setFullData(null);
                        eventSource.close();
                        setConnectionStatus('disconnected');
                        break;

                    case 'revoked':
                        setError('Access has been revoked by the data owner.');
                        setUserData(null);
                        setFullData(null);
                        eventSource.close();
                        setConnectionStatus('disconnected');
                        break;
                }
            } catch (e) {
                console.error('SSE parse error:', e);
            }
        };

        eventSource.onerror = () => {
            setConnectionStatus('disconnected');
            eventSource.close();
        };
    }, []);

    useEffect(() => {
        if (token) {
            fetchUserData(token);
        }

        return () => {
            if (eventSourceRef.current) {
                eventSourceRef.current.close();
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token, fetchUserData]);

    // Heartbeat Sender
    useEffect(() => {
        if (!token || !session?.user?.email) return;

        const sendHeartbeat = () => {
            fetch('/api/collaboration/heartbeat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    token,
                    vendorEmail: session.user.email,
                    level: myAssignedLevel,
                    displayName: session.user.name || session.user.email?.split('@')[0],
                })
            }).catch(e => console.error('Heartbeat failed:', e));
        };

        sendHeartbeat();
        const interval = setInterval(sendHeartbeat, 5000);
        return () => clearInterval(interval);
    }, [token, session, myAssignedLevel]);

    // Scroll chat to bottom
    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [chats]);

    // Local countdown
    useEffect(() => {
        if (remainingSeconds <= 0) return;

        const timer = setInterval(() => {
            setRemainingSeconds((prev) => {
                if (prev <= 1) {
                    setError('Session expired. All data has been permanently deleted.');
                    setUserData(null);
                    setFullData(null);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(timer);
    }, [remainingSeconds]);

    const formatTime = (seconds: number): string => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    const getTimerClass = (): string => {
        if (remainingSeconds <= 30) return 'timer-critical';
        if (remainingSeconds <= 60) return 'timer-warning';
        return 'timer-safe';
    };

    const getInitials = (): string => {
        if (userData) {
            return `${userData.firstName[0]}${userData.lastName[0]}`.toUpperCase();
        }
        return '??';
    };

    const getDisplayName = (): string => {
        if (userData) {
            return `${userData.firstName} ${userData.lastName}`;
        }
        return 'Loading...';
    };

    const handlePreview = async (fileId: string) => {
        setIsPreviewLoading(true);
        const res = await getFilePreview(token, fileId);
        setIsPreviewLoading(false);

        if (res.success) {
            setPreviewData(res);
            setShowPreviewModal(true);
        } else {
            alert(res.error || 'Failed to open file');
        }
    };

    const closePreview = () => {
        setShowPreviewModal(false);
        setPreviewData(null);
    };

    const handleEdit = async (fileId: string) => {
        setIsEditLoading(fileId);
        try {
            const getFileResult = await getRawFileForEdit(token, fileId);
            if (getFileResult.success && getFileResult.base64Content) {
                const bstr = atob(getFileResult.base64Content);
                let n = bstr.length;
                const u8arr = new Uint8Array(n);
                while (n--) {
                    u8arr[n] = bstr.charCodeAt(n);
                }
                const newFile = new File([u8arr], getFileResult.fileName || 'document', { type: getFileResult.mimeType });
                setEditingFileId(fileId);
                setEditingFile(newFile);
            } else {
                alert(getFileResult.error || 'Failed to load file for editing');
            }
        } catch (err) {
            console.error(err);
            alert('Error loading file for edit');
        } finally {
            setIsEditLoading(null);
        }
    };

    // Auto-reload active file if another user saved it (detecting priority save from lower user)
    useEffect(() => {
        if (triggerFileReload > 0) {
            // Only alert and reload if the user is currently looking at *a* file, or looking at the list.
            if (editingFileId) {
                alert('A high-priority event occurred: The file was just saved by another user. Reloading the latest changes...');
                handleEdit(editingFileId);
            }
        }
    }, [triggerFileReload]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleSaveFile = async (editedFile: File) => {
        if (!editingFile || !editingFileId) return;
        try {
            const formData = new FormData();
            formData.append('file', editedFile);

            const { updateFile } = await import('@/actions/update-file');
            const res = await updateFile(token, editingFileId, formData);

            if (res.success) {
                alert('File saved securely.');
                setEditingFile(null);
                setEditingFileId(null);
            } else {
                alert(res.error || 'Failed to save file.');
            }
        } catch (err) {
            console.error('Save error:', err);
            alert('An error occurred while saving the file.');
        }
    };

    // ---- Preemption Logic ----
    useEffect(() => {
        const isCurrentlyRestricted = highestActiveLevel !== null && myAssignedLevel > highestActiveLevel;
        
        if (isCurrentlyRestricted && isEditingFile && preemptionCountdown === null) {
            setPreemptionCountdown(30);
        } else if (!isCurrentlyRestricted) {
            // Higher level user left, cancel countdown
            setPreemptionCountdown(null);
        }
    }, [highestActiveLevel, myAssignedLevel, isEditingFile]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (preemptionCountdown === null || preemptionCountdown <= 0) return;

        const timer = setInterval(() => {
            setPreemptionCountdown(prev => {
                if (prev === null || prev <= 1) return 0;
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(timer);
    }, [preemptionCountdown]);

    // ---- Finish & Close handler ----
    const handleFinish = useCallback(() => {
        // Close SSE stream
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
        }
        setConnectionStatus('disconnected');

        // Security wipe — clear all displayed data
        setUserData(null);
        setFullData(null);

        // Close editor if open
        setEditingFile(null);
        setEditingFileId(null);

        setIsFinished(true);
    }, []);

    const handleSendMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!chatMessage.trim() || !session?.user?.email) return;

        const msg = chatMessage;
        setChatMessage('');
        await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token,
                senderEmail: session.user.email,
                content: msg,
                receiverEmail: null // Group chat by default
            })
        });
    };

    // Access is restricted ONLY if they are not editing, OR if they were editing and the countdown has reached 0.
    const isRestricted = highestActiveLevel !== null && myAssignedLevel > highestActiveLevel;
    const isEditingRestricted = isRestricted && (preemptionCountdown === null || preemptionCountdown === 0);

    // Finished State
    if (isFinished) {
        return (
            <main className="profile-wrapper">
                <div className="bg-orb bg-orb-1" />
                <div className="bg-orb bg-orb-2" />
                <div className="bg-grid" />
                <div className="profile-card">
                    <div className="finished-container">
                        <div className="finished-icon">✅</div>
                        <h2 className="finished-title">Review Complete</h2>
                        <p className="finished-message">
                            You have finished reviewing the shared data. This session is now closed and all displayed data has been cleared from your browser.
                        </p>
                        <div className="finished-hint">
                            🔒 You can safely close this tab now.
                        </div>
                    </div>
                </div>
            </main>
        );
    }

    // Loading State
    if (isLoading) {
        return (
            <main className="profile-wrapper">
                <div className="profile-card">
                    <div className="loading-container">
                        <div className="loading-spinner" />
                        <p className="loading-text">Loading secure profile...</p>
                    </div>
                </div>
            </main>
        );
    }

    // Error State
    if (error) {
        const errorLower = error.toLowerCase();
        const isRevoked = errorLower.includes('revoked') || errorLower.includes('reveoke');
        const isExpired = errorLower.includes('expired');
        return (
            <main className="profile-wrapper">
                <div className="profile-card">
                    <div className="error-container">
                        <h2 className="error-title">
                            {isRevoked ? 'Access Revoked' : isExpired ? 'Session Expired' : 'Access Denied'}
                        </h2>
                        <p className="error-message">{error}</p>
                    </div>
                </div>
            </main>
        );
    }

    return (
        <main className="profile-wrapper" style={{ position: 'relative' }}>
            {/* Background Effects */}
            <div className="bg-orb bg-orb-1" />
            <div className="bg-orb bg-orb-2" />
            <div className="bg-grid" />

            <div className="profile-card">
                {/* Header Section */}
                <div className="profile-header">
                    <div className="header-top">
                        <h1 className="profile-title">Secure Shared Profile</h1>
                        <div className="status-badges">
                            <span className={`status-badge ${connectionStatus}`}>
                                <span className="status-dot" />
                                {connectionStatus === 'connected' ? 'LIVE' : 'OFFLINE'}
                            </span>
                        </div>
                    </div>

                    <div className={`countdown-bar ${getTimerClass()}`}>
                        <span className="countdown-label">Expires in</span>
                        <span className="countdown-time">{formatTime(remainingSeconds)}</span>
                    </div>

                    {isRestricted && (
                        <div style={{ marginTop: '10px', background: '#FEF2F2', border: '1px solid #EF4444', padding: '12px', borderRadius: '8px', color: '#B91C1C', fontSize: '14px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                            <span>A higher-level user (Level {highestActiveLevel}) is active. Your editing access is restricted to Read-Only.</span>
                        </div>
                    )}
                </div>

                {/* Identity Section */}
                <div className="identity-section">
                    <div className="avatar">
                        <span className="avatar-initials">{getInitials()}</span>
                    </div>
                    <h2 className="identity-name">{getDisplayName()}</h2>
                    <p className="identity-label">Shared securely for temporary access</p>
                </div>

                {/* Sender & Purpose Info Card */}
                {(userData?.ownerName || userData?.purpose) && (
                    <div style={{
                        background: 'linear-gradient(135deg, rgba(99,102,241,0.08), rgba(139,92,246,0.08))',
                        border: '1px solid rgba(99,102,241,0.2)',
                        borderRadius: '12px',
                        padding: '16px 20px',
                        margin: '0 0 4px 0',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '10px',
                    }}>
                        {userData?.ownerName && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <div style={{
                                    width: '36px', height: '36px', borderRadius: '50%',
                                    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    color: '#fff', fontSize: '14px', fontWeight: '700', flexShrink: 0,
                                }}>
                                    {userData.ownerName[0]?.toUpperCase() || '?'}
                                </div>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: '11px', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>Shared by</div>
                                    <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary, #111)' }}>{userData.ownerName}</div>
                                </div>
                            </div>
                        )}
                        {userData?.purpose && (
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                                <div style={{
                                    width: '36px', height: '36px', borderRadius: '50%',
                                    background: 'rgba(99,102,241,0.12)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: '16px', flexShrink: 0,
                                }}>
                                    📋
                                </div>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: '11px', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>Topic</div>
                                    <div style={{ fontSize: '15px', fontWeight: 500, color: 'var(--text-primary, #111)' }}>{userData.purpose}</div>
                                    {userData.purposeDetail && (
                                        <div style={{ fontSize: '13px', color: '#6B7280', marginTop: '2px' }}>{userData.purposeDetail}</div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Data Display */}
                <div className="data-section">
                    <div className="data-card">

                        {/* Files Section */}
                        {userData?.files && userData.files.length > 0 && (
                            <div className="data-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                                <div className="data-label" style={{ marginBottom: '10px' }}>
                                    Attached Files ({userData.files.length})
                                </div>
                                <div className="file-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    {userData.files.map((file) => (
                                        <div key={file.id} style={{
                                            background: 'rgba(255, 255, 255, 0.05)',
                                            padding: '10px',
                                            borderRadius: '6px',
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            flexWrap: 'wrap',
                                            gap: '10px'
                                        }}>
                                            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: '150px' }}>
                                                <span style={{ fontSize: '14px', color: '#fff', wordBreak: 'break-all' }}>{file.fileName}</span>
                                                <span style={{ fontSize: '12px', color: '#aaa' }}>{file.fileType.split('/')[1]?.toUpperCase() || 'FILE'} • {(file.fileSize / 1024).toFixed(1)} KB</span>
                                            </div>
                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                <button
                                                    onClick={() => handleEdit(file.id)}
                                                    style={{
                                                        background: 'rgba(34, 197, 94, 0.1)',
                                                        border: '1px solid rgba(34, 197, 94, 0.3)',
                                                        color: '#22c55e',
                                                        padding: '4px 8px',
                                                        fontSize: '12px',
                                                        borderRadius: '4px',
                                                        cursor: 'pointer',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '4px'
                                                    }}
                                                >
                                                    {isEditingFile && editFileId === file.id ? '⏳' : '✍️'} Edit
                                                </button>
                                                <button
                                                    onClick={() => handlePreview(file.id)}
                                                    disabled={isPreviewLoading}
                                                    style={{
                                                        background: 'rgba(64, 196, 255, 0.2)',
                                                        border: '1px solid rgba(64, 196, 255, 0.4)',
                                                        color: '#40c4ff',
                                                        padding: '4px 8px',
                                                        fontSize: '12px',
                                                        borderRadius: '4px',
                                                        cursor: 'pointer'
                                                    }}
                                                >
                                                    {isPreviewLoading ? 'Loading...' : 'Preview'}
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                            </div>
                        )}
                    </div>
                </div>

                {/* Finish & Close Button */}
                <div className="finish-section">
                    <button
                        className="finish-button"
                        onClick={handleFinish}
                    >
                        ✅ Finish & Close
                    </button>
                    <p className="finish-hint">Click when you are done reviewing</p>
                </div>

                {/* Footer */}
                <div className="trust-footer">
                    <p className="trust-text">Protected by Data Guardian V2</p>
                </div>
            </div>

            {/* Floating Chat Button + Panel */}
            <div style={{ position: 'fixed', bottom: '24px', right: '24px', zIndex: 900, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '12px' }}>
                {/* Chat Panel (slides up when open) */}
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
                            <button onClick={() => setIsChatOpen(false)} style={{
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
                                        background: p.email === session?.user?.email ? '#EEF2FF' : '#F3F4F6',
                                        color: p.email === session?.user?.email ? '#4F46E5' : '#6B7280',
                                        fontWeight: p.email === session?.user?.email ? 600 : 400,
                                    }}>
                                        {p.name}{p.email === session?.user?.email ? ' (You)' : ''} L{p.level}
                                    </span>
                                ))}
                            </div>
                        )}

                        {/* Chat Messages */}
                        <div style={{ flex: 1, padding: '12px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {chats?.length === 0 ? (
                                <div style={{ color: '#9CA3AF', fontSize: '12px', textAlign: 'center', margin: 'auto' }}>
                                    No messages yet.
                                </div>
                            ) : chats?.map((c) => {
                                const isMe = c.senderEmail === session?.user?.email;
                                return (
                                    <div key={c.id} style={{ alignSelf: isMe ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
                                        <div style={{ fontSize: '10px', color: '#9CA3AF', marginBottom: '2px', textAlign: isMe ? 'right' : 'left' }}>
                                            {isMe ? 'You' : c.senderEmail.split('@')[0]}
                                        </div>
                                        <div style={{
                                            background: isMe ? '#111111' : '#F3F4F6',
                                            color: isMe ? '#FFFFFF' : '#111111',
                                            padding: '8px 12px', borderRadius: '12px', fontSize: '13px',
                                            borderBottomRightRadius: isMe ? '4px' : '12px',
                                            borderBottomLeftRadius: isMe ? '12px' : '4px',
                                        }}>
                                            {c.content}
                                        </div>
                                    </div>
                                );
                            })}
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

                {/* Floating Chat Button */}
                <button
                    onClick={() => { setIsChatOpen(!isChatOpen); setUnreadCount(0); lastChatCountRef.current = chats?.length || 0; }}
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
                    {isChatOpen ? '✕' : '💬'}
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
            </div>

            {/* Animation keyframes */}
            <style>{`
                @keyframes slideUp {
                    from { opacity: 0; transform: translateY(20px); }
                    to { opacity: 1; transform: translateY(0); }
                }
            `}</style>

            {/* Preview Modal */}
            {showPreviewModal && previewData && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    width: '100vw',
                    height: '100vh',
                    background: 'rgba(0, 0, 0, 0.9)',
                    backdropFilter: 'blur(10px)',
                    zIndex: 1000,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '20px'
                }}>
                    <div style={{
                        background: '#1a1a1a',
                        border: '1px solid #333',
                        borderRadius: '12px',
                        width: '100%',
                        maxWidth: '800px',
                        maxHeight: '90vh',
                        display: 'flex',
                        flexDirection: 'column',
                        overflow: 'hidden'
                    }}>
                        {/* Modal Header */}
                        <div style={{
                            padding: '16px',
                            borderBottom: '1px solid #333',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                        }}>
                            <h3 style={{ margin: 0, color: '#fff' }}>Secure Preview (Read Only)</h3>
                            <button onClick={closePreview} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '20px' }}>&times;</button>
                        </div>

                        {/* Modal Body */}
                        <div style={{ padding: '20px', overflowY: 'auto', flex: 1, display: 'flex', justifyContent: 'center' }}>
                            {previewData.type === 'image' && (
                                <img src={previewData.content} alt="Secure Preview" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', pointerEvents: 'none' }} onContextMenu={(e) => e.preventDefault()} />
                            )}
                            {previewData.type === 'pdf' && (
                                <iframe src={`${previewData.content}#toolbar=0&navpanes=0`} style={{ width: '100%', height: '600px', border: 'none' }} title="PDF Preview" />
                            )}
                            {previewData.type === 'text' && (
                                <pre style={{ color: '#ddd', fontSize: '14px', whiteSpace: 'pre-wrap', width: '100%' }}>{previewData.content}</pre>
                            )}
                            {previewData.type === 'spreadsheet' && previewData.content && (
                                <div style={{ width: '100%', overflowX: 'auto' }}>
                                    <table style={{ borderCollapse: 'collapse', width: '100%', color: '#ddd' }}>
                                        <tbody>
                                            {Array.isArray(previewData.content) && previewData.content.map((row: any[], rowIndex: number) => (
                                                <tr key={rowIndex} style={{ borderBottom: '1px solid #333' }}>
                                                    {row.map((cell: any, cellIndex: number) => (
                                                        <td key={cellIndex} style={{ padding: '8px', borderRight: '1px solid #333' }}>{cell}</td>
                                                    ))}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>

                        <div style={{ padding: '10px', textAlign: 'center', borderTop: '1px solid #333', color: '#666', fontSize: '12px' }}>
                            Download and Right-Click disabled for security.
                        </div>
                    </div>
                </div>
            )}

            {/* Universal File Editor — Full-screen Modal Popup */}
            {isEditingFile && editFileId && (
                <div style={{
                    position: 'fixed',
                    inset: 0,
                    zIndex: 2000,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'rgba(0, 0, 0, 0.75)',
                    backdropFilter: 'blur(4px)',
                    animation: 'fadeIn 0.2s ease-out',
                }}>
                    <div style={{
                        position: 'relative',
                        width: '95vw',
                        maxWidth: '1200px',
                        height: '90vh',
                        background: '#fff',
                        borderRadius: '16px',
                        boxShadow: '0 24px 80px rgba(0,0,0,0.4)',
                        overflow: 'hidden',
                        display: 'flex',
                        flexDirection: 'column',
                    }}>
                        {/* Modal Header */}
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '14px 20px',
                            background: '#111',
                            color: '#fff',
                            flexShrink: 0,
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <span style={{ fontSize: '16px' }}>✍️</span>
                                <span style={{ fontSize: '14px', fontWeight: 600 }}>Editing: {editFileName}</span>
                            </div>
                            <button
                                onClick={closeEditor}
                                style={{
                                    background: 'rgba(255,255,255,0.15)',
                                    border: 'none',
                                    color: '#fff',
                                    width: '32px',
                                    height: '32px',
                                    borderRadius: '50%',
                                    cursor: 'pointer',
                                    fontSize: '16px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    transition: 'background 0.2s',
                                }}
                                onMouseOver={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.3)')}
                                onMouseOut={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.15)')}
                                title="Close Editor"
                            >
                                ✕
                            </button>
                        </div>

                        {/* Editor Content */}
                        <div style={{ flex: 1, overflow: 'auto' }}>
                            <UniversalEditor
                                token={token}
                                fileId={editFileId}
                                initialFileProp={editingFile}
                                currentUserLevel={myAssignedLevel || 2}
                                highestAuthorityLevel={highestActiveLevel !== null ? highestActiveLevel : 2}
                                onClose={closeEditor}
                                onSave={handleSaveFile}
                                forceAutoSave={preemptionCountdown === 1}
                                onAutoSaveComplete={closeEditor}
                            />
                        </div>
                    </div>
                </div>
            )}
        </main>
    );
}
