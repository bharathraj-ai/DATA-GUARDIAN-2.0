'use client';

import { useState, useEffect } from 'react';
import { getLinkStatus, revokeAccess, RevokeAccessResult } from '@/actions/revoke-access';

interface RevokePageProps {
    params: Promise<{ ownerToken: string }>;
}

interface LinkStatus {
    isUsed: boolean;
    isRevoked: boolean;
    isExpired: boolean;
    expiresAt: Date;
    createdAt: Date;
}

export default function RevokePage({ params }: RevokePageProps) {
    const [ownerToken, setOwnerToken] = useState<string>('');
    const [status, setStatus] = useState<LinkStatus | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isRevoking, setIsRevoking] = useState(false);
    const [revokeResult, setRevokeResult] = useState<RevokeAccessResult | null>(null);
    const [showConfirm, setShowConfirm] = useState(false);
    const [deleteData, setDeleteData] = useState(false);

    useEffect(() => {
        params.then(async (p) => {
            // Remove any query parameters (like timestamp) from token
            const cleanToken = p.ownerToken.split('?')[0];
            setOwnerToken(cleanToken);
            const result = await getLinkStatus(cleanToken);
            if (result.success && result.status) {
                setStatus({
                    ...result.status,
                    expiresAt: new Date(result.status.expiresAt),
                    createdAt: new Date(result.status.createdAt),
                });
            } else {
                setError(result.error || 'Failed to get link status');
            }
            setIsLoading(false);
        });
    }, [params]);

    async function handleRevoke() {
        setIsRevoking(true);
        const result = await revokeAccess(ownerToken, deleteData);
        setRevokeResult(result);
        setShowConfirm(false);
        setIsRevoking(false);

        if (result.success) {
            const statusResult = await getLinkStatus(ownerToken);
            if (statusResult.success && statusResult.status) {
                setStatus({
                    ...statusResult.status,
                    expiresAt: new Date(statusResult.status.expiresAt),
                    createdAt: new Date(statusResult.status.createdAt),
                });
            }
        }
    }

    function formatDateTime(date: Date): string {
        return date.toLocaleString('en-US', {
            dateStyle: 'medium',
            timeStyle: 'short',
        });
    }

    function getRemainingTime(): string {
        if (!status) return '';
        const now = new Date();
        const remaining = status.expiresAt.getTime() - now.getTime();
        if (remaining <= 0) return 'Expired';

        const hours = Math.floor(remaining / (1000 * 60 * 60));
        const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));

        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        }
        return `${minutes}m`;
    }

    function getStatusInfo() {
        if (!status) return { class: '', label: '', icon: null };

        if (status.isRevoked) {
            return {
                class: 'revoked',
                label: 'Revoked',
                icon: (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                    </svg>
                ),
            };
        }
        if (status.isExpired) {
            return {
                class: 'expired',
                label: 'Expired',
                icon: (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                    </svg>
                ),
            };
        }
        if (status.isUsed) {
            return {
                class: 'active',
                label: 'Being Viewed',
                icon: (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                    </svg>
                ),
            };
        }
        return {
            class: 'live',
            label: 'Active',
            icon: (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
            ),
        };
    }

    const statusInfo = getStatusInfo();

    // Loading State
    if (isLoading) {
        return (
            <main className="revoke-wrapper">
                <div className="bg-orb bg-orb-1" />
                <div className="bg-orb bg-orb-2" />
                <div className="bg-grid" />
                <div className="revoke-card">
                    <div className="loading-container">
                        <div className="loading-spinner" />
                        <p className="loading-text">Loading dashboard...</p>
                    </div>
                </div>
            </main>
        );
    }

    // Error State
    if (error) {
        return (
            <main className="revoke-wrapper">
                <div className="bg-orb bg-orb-1" />
                <div className="bg-orb bg-orb-2" />
                <div className="bg-grid" />
                <div className="revoke-card">
                    <div className="error-container">
                        <div className="error-icon expired">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="12" cy="12" r="10" />
                                <line x1="12" y1="8" x2="12" y2="12" />
                                <line x1="12" y1="16" x2="12.01" y2="16" />
                            </svg>
                        </div>
                        <h2 className="error-title">Invalid Link</h2>
                        <p className="error-message">{error}</p>
                        <a href="/" className="return-button">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M3 12l9-9 9 9M5 10v10a2 2 0 002 2h10a2 2 0 002-2V10" />
                            </svg>
                            Return to Home
                        </a>
                    </div>
                </div>
            </main>
        );
    }

    return (
        <main className="revoke-wrapper">
            {/* Background Effects */}
            <div className="bg-orb bg-orb-1" />
            <div className="bg-orb bg-orb-2" />
            <div className="bg-grid" />

            <div className="revoke-card">
                {/* Header */}
                <div className="revoke-header">
                    <div className="header-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                            <path d="M9 12l2 2 4-4" />
                        </svg>
                    </div>
                    <h1 className="revoke-title">Owner Dashboard</h1>
                    <p className="revoke-subtitle">Manage your shared data link</p>
                </div>

                {/* Status Card */}
                <div className="status-section">
                    <div className="status-header">
                        <h2 className="section-title">Link Status</h2>
                        <span className={`status-pill ${statusInfo.class}`}>
                            <span className="status-dot" />
                            {statusInfo.label}
                        </span>
                    </div>

                    <div className="status-details">
                        <div className="detail-row">
                            <span className="detail-label">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <circle cx="12" cy="12" r="10" />
                                    <polyline points="12 6 12 12 16 14" />
                                </svg>
                                Created
                            </span>
                            <span className="detail-value">{status && formatDateTime(status.createdAt)}</span>
                        </div>
                        <div className="detail-row">
                            <span className="detail-label">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                                    <line x1="16" y1="2" x2="16" y2="6" />
                                    <line x1="8" y1="2" x2="8" y2="6" />
                                    <line x1="3" y1="10" x2="21" y2="10" />
                                </svg>
                                Expires
                            </span>
                            <span className="detail-value">{status && formatDateTime(status.expiresAt)}</span>
                        </div>
                        {status && !status.isRevoked && !status.isExpired && (
                            <div className="detail-row">
                                <span className="detail-label">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <circle cx="12" cy="12" r="10" />
                                        <polyline points="12 6 12 12 16 14" />
                                    </svg>
                                    Time Left
                                </span>
                                <span className="detail-value highlight">{getRemainingTime()}</span>
                            </div>
                        )}
                        <div className="detail-row">
                            <span className="detail-label">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                    <circle cx="12" cy="12" r="3" />
                                </svg>
                                OTP Verified
                            </span>
                            <span className={`detail-value ${status?.isUsed ? 'verified' : 'pending'}`}>
                                {status?.isUsed ? 'Yes' : 'No'}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Revoke Result */}
                {revokeResult && (
                    <div className={`result-banner ${revokeResult.success ? 'success' : 'error'}`}>
                        {revokeResult.success ? (
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M9 12l2 2 4-4" />
                                <circle cx="12" cy="12" r="10" />
                            </svg>
                        ) : (
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="12" cy="12" r="10" />
                                <line x1="15" y1="9" x2="9" y2="15" />
                                <line x1="9" y1="9" x2="15" y2="15" />
                            </svg>
                        )}
                        <span>{revokeResult.success ? revokeResult.message : revokeResult.error}</span>
                    </div>
                )}

                {/* Kill Switch Section */}
                {status && !status.isRevoked && !status.isExpired && (
                    <div className="killswitch-section">
                        <div className="killswitch-header">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="12" cy="12" r="10" />
                                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                            </svg>
                            <h2 className="section-title">Emergency Kill Switch</h2>
                        </div>

                        {!showConfirm ? (
                            <div className="killswitch-content">
                                <p className="killswitch-description">
                                    Immediately revoke access to your shared data. Active viewers will be disconnected instantly.
                                </p>
                                <button onClick={() => setShowConfirm(true)} className="revoke-btn">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <circle cx="12" cy="12" r="10" />
                                        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                                    </svg>
                                    Revoke Access Now
                                </button>
                            </div>
                        ) : (
                            <div className="confirm-dialog">
                                <div className="warning-box">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                                        <line x1="12" y1="9" x2="12" y2="13" />
                                        <line x1="12" y1="17" x2="12.01" y2="17" />
                                    </svg>
                                    <div>
                                        <p className="warning-title">This action cannot be undone</p>
                                        <p className="warning-text">The recipient will immediately lose access to all shared data.</p>
                                    </div>
                                </div>

                                <label className="delete-option">
                                    <input
                                        type="checkbox"
                                        checked={deleteData}
                                        onChange={(e) => setDeleteData(e.target.checked)}
                                    />
                                    <span className="checkbox-custom" />
                                    <span>Also delete encrypted data immediately</span>
                                </label>

                                <div className="confirm-actions">
                                    <button onClick={() => setShowConfirm(false)} className="cancel-btn">
                                        Cancel
                                    </button>
                                    <button onClick={handleRevoke} disabled={isRevoking} className="confirm-btn">
                                        {isRevoking ? (
                                            <>
                                                <span className="button-spinner" />
                                                Revoking...
                                            </>
                                        ) : (
                                            'Confirm Revoke'
                                        )}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Already Revoked/Expired */}
                {status && (status.isRevoked || status.isExpired) && (
                    <div className="inactive-section">
                        <div className={`inactive-icon ${status.isRevoked ? 'revoked' : 'expired'}`}>
                            {statusInfo.icon}
                        </div>
                        <p className="inactive-text">
                            {status.isRevoked
                                ? 'This link has been revoked. No further action needed.'
                                : 'This link has expired. Data is automatically cleaned up.'}
                        </p>
                    </div>
                )}

                {/* Trust Footer */}
                <div className="revoke-footer">
                    <div className="footer-badges">
                        <div className="footer-badge">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                            </svg>
                            <span>Full Control</span>
                        </div>
                        <div className="footer-badge">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                            </svg>
                            <span>Zero Trust</span>
                        </div>
                        <div className="footer-badge">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                            <span>Auto-Destruct</span>
                        </div>
                    </div>
                    <a href="/" className="back-link">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="15 18 9 12 15 6" />
                        </svg>
                        Back to Home
                    </a>
                </div>
            </div>
        </main>
    );
}
