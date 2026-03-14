'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getUserData, MaskedUserData } from '@/actions/get-user';
import { getFilePreview, FilePreviewResult } from '@/actions/get-file-preview';
import { revokeOnScreenshot } from '@/actions/revoke-on-screenshot';
import dynamic from 'next/dynamic';

// Lazy load the Universal File Editor to avoid loading heavy editor dependencies upfront
const UniversalFileEditor = dynamic(() => import('@/components/UniversalFileEditor'), {
    ssr: false,
    loading: () => null,
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
    };
    remainingSeconds?: number;
}

export default function ViewPage({ params }: ViewPageProps) {
    const router = useRouter();
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

    // Preview State
    const [previewData, setPreviewData] = useState<FilePreviewResult | null>(null);
    const [showPreviewModal, setShowPreviewModal] = useState(false);
    const [isPreviewLoading, setIsPreviewLoading] = useState(false);

    // Security State
    const [warningCount, setWarningCount] = useState(0);
    const MAX_WARNINGS = 3;

    // Inline Editor State
    const [isEditingFile, setIsEditingFile] = useState(false);
    const [editFileId, setEditFileId] = useState<string | null>(null);
    const [editFileName, setEditFileName] = useState('');
    const [isFinished, setIsFinished] = useState(false);

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

        const triggerSecurityViolation = async (reason: string, isImmediate: boolean = false) => {
            if (isRevoking || !token) return;

            if (!isImmediate && warningCount < MAX_WARNINGS - 1) {
                // Just a warning
                setWarningCount(prev => prev + 1);
                console.warn(`[SECURITY WARNING ${warningCount + 1}/${MAX_WARNINGS}] ${reason}`);
                return;
            }

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
            setError(isImmediate
                ? 'Security Violation: Access revoked due to screenshot attempt.'
                : `Security Violation: Access revoked after ${MAX_WARNINGS} tab switches or focus losses.`
            );
            setConnectionStatus('disconnected');

            // Call server to revoke access and notify owner
            await revokeOnScreenshot(token);
        };

        // Detect when tab/window loses visibility (e.g., snipping tool overlay)
        const handleVisibilityChange = () => {
            if (document.hidden && !isEditingFile && !screenshotDetected) {
                triggerSecurityViolation('Tab hidden - possible screenshot', false);
            }
        };

        // Detect when window loses focus (e.g., snipping tool opens)
        const handleBlur = () => {
            // Skip if editor is open or if PrintScreen was just detected
            if (!isEditingFile && !screenshotDetected) {
                triggerSecurityViolation('Window lost focus - possible screenshot', false);
            }
        };

        // Detect PrintScreen key (keydown — may not fire on all browsers)
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'PrintScreen') {
                e.preventDefault();
                screenshotDetected = true;
                triggerSecurityViolation('PrintScreen key detected', true);
                // Reset debounce after a short delay
                setTimeout(() => { screenshotDetected = false; }, 1000);
            }
            if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {
                e.preventDefault();
                triggerSecurityViolation('Print shortcut (Ctrl+P) detected', true);
            }
        };

        // Detect PrintScreen key (keyup — fires more reliably than keydown on most browsers)
        const handleKeyUp = (e: KeyboardEvent) => {
            if (e.key === 'PrintScreen') {
                e.preventDefault();
                screenshotDetected = true;
                triggerSecurityViolation('PrintScreen key detected', true);
                setTimeout(() => { screenshotDetected = false; }, 1000);
            }
        };

        // Detect screenshot images landing on the clipboard (Ctrl+V or paste after PrtSc)
        const handlePaste = (e: ClipboardEvent) => {
            if (e.clipboardData) {
                const items = Array.from(e.clipboardData.items);
                const hasImage = items.some(item => item.type.startsWith('image/'));
                if (hasImage) {
                    e.preventDefault();
                    triggerSecurityViolation('Screenshot image detected in clipboard', true);
                }
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('blur', handleBlur);
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        document.addEventListener('paste', handlePaste);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('blur', handleBlur);
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            document.removeEventListener('paste', handlePaste);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token, warningCount, revealTimeout, isEditingFile]);

    // Initial data fetch
    const fetchUserData = useCallback(async (t: string) => {
        const result = await getUserData(t);

        if (result.success && result.data) {
            setUserData(result.data);
            setRemainingSeconds(result.data.remainingSeconds);
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
                        if (data.remainingSeconds !== undefined) {
                            setRemainingSeconds(data.remainingSeconds);
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
        // Note: revealTimeout cleanup is handled separately in handleHide
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token, fetchUserData]);

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
        if (fullData && isRevealed) {
            return `${fullData.firstName[0]}${fullData.lastName[0]}`.toUpperCase();
        }
        if (userData) {
            return `${userData.firstName[0]}${userData.lastName[0]}`.toUpperCase();
        }
        return '??';
    };

    const getDisplayName = (): string => {
        if (fullData && isRevealed) {
            return `${fullData.firstName} ${fullData.lastName}`;
        }
        if (userData) {
            return `${userData.firstName} ${userData.lastName}`;
        }
        return 'Loading...';
    };

    const formatGender = (gender: string): string => {
        const map: Record<string, string> = {
            'male': 'Male',
            'female': 'Female',
            'other': 'Other',
            'prefer-not-to-say': 'Prefer not to say',
        };
        return map[gender] || gender;
    };

    const handleReveal = () => {
        if (!fullData) return;
        setIsRevealed(true);
        const timeout = setTimeout(() => {
            setIsRevealed(false);
        }, 10000);
        setRevealTimeoutState(timeout);
    };

    const handleHide = () => {
        setIsRevealed(false);
        if (revealTimeout) {
            clearTimeout(revealTimeout);
            setRevealTimeoutState(null);
        }
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

    const handleEditClick = (fileId: string, fileName: string) => {
        setEditFileId(fileId);
        setEditFileName(fileName);
        setIsEditingFile(true);
    };

    const closeEditor = () => {
        setIsEditingFile(false);
        setEditFileId(null);
        setEditFileName('');
    };

    const handleEditorSaved = (fileId: string, newData?: { fileName: string; fileSize: number; fileType: string }) => {
        if (newData) {
            setUserData(prev => {
                if (!prev) return prev;
                return {
                    ...prev,
                    files: prev.files?.map(file =>
                        file.id === fileId ? { ...file, ...newData } : file
                    )
                };
            });
        }
    };

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
        setIsRevealed(false);
        if (revealTimeout) {
            clearTimeout(revealTimeout);
            setRevealTimeoutState(null);
        }

        // Close editor if open
        setIsEditingFile(false);
        setEditFileId(null);
        setEditFileName('');

        setIsFinished(true);
    }, [revealTimeout]);

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
        const isRevoked = error.includes('revoked');
        const isExpired = error.includes('expired');
        return (
            <main className="profile-wrapper">
                <div className="profile-card">
                    <div className="error-container">
                        <h2 className="error-title">
                            {isRevoked ? 'Access Revoked' : isExpired ? 'Session Expired' : 'Access Denied'}
                        </h2>
                        <p className="error-message">{error}</p>
                        <button
                            onClick={() => {
                                // Clear any cached data
                                setUserData(null);
                                setFullData(null);
                                setError(null);
                                // Force full page navigation to bypass all caches
                                window.location.href = `/create-link?t=${Date.now()}`;
                            }}
                            className="return-button"
                        >
                            Create New Link
                        </button>
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
                            {warningCount > 0 && (
                                <span style={{
                                    background: 'rgba(255, 68, 68, 0.15)',
                                    color: '#ff4444',
                                    border: '1px solid rgba(255, 68, 68, 0.3)',
                                    padding: '4px 8px',
                                    borderRadius: '50px',
                                    fontSize: '11px',
                                    fontWeight: '600',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    animation: 'pulse 2s infinite'
                                }}>
                                    ⚠️ Tab Switches: {warningCount}/{MAX_WARNINGS}
                                </span>
                            )}
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
                </div>

                {/* Identity Section */}
                <div className="identity-section">
                    <div className="avatar">
                        <span className="avatar-initials">{getInitials()}</span>
                    </div>
                    <h2 className="identity-name">{getDisplayName()}</h2>
                    <p className="identity-label">Shared securely for temporary access</p>
                </div>

                {/* Data Display */}
                <div className="data-section">
                    <div className="data-card">
                        <div className="data-row">
                            <div className="data-label">Email</div>
                            <span className="data-value">
                                {isRevealed && fullData ? fullData.email : userData?.maskedEmail}
                            </span>
                        </div>
                        <div className="data-row">
                            <div className="data-label">Phone</div>
                            <span className="data-value">
                                {isRevealed && fullData ? fullData.phone : userData?.maskedPhone}
                            </span>
                        </div>
                        <div className="data-row">
                            <div className="data-label">Gender</div>
                            <span className="data-value">
                                {formatGender(isRevealed && fullData ? fullData.gender : userData?.gender || '')}
                            </span>
                        </div>
                        <div className="data-row">
                            <div className="data-label">Age</div>
                            <span className="data-value">
                                {isRevealed && fullData ? `${fullData.age} years` : `${userData?.age} years`}
                            </span>
                        </div>

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
                                                    onClick={() => handleEditClick(file.id, file.fileName)}
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

                    {fullData && (
                        <button
                            onClick={isRevealed ? handleHide : handleReveal}
                            className={`reveal-button ${isRevealed ? 'active' : ''}`}
                        >
                            {isRevealed ? 'Hide Data' : 'Temporarily Reveal'}
                        </button>
                    )}
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

            {/* Universal File Editor */}
            {isEditingFile && editFileId && (
                <UniversalFileEditor
                    token={token}
                    fileId={editFileId}
                    fileName={editFileName}
                    remainingSeconds={remainingSeconds}
                    connectionStatus={connectionStatus}
                    onClose={closeEditor}
                    onSaved={handleEditorSaved}
                />
            )}
        </main>
    );
}
