'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { getOwnedLinks, DashboardLink } from '@/actions/dashboard';
import { revokeAccess } from '@/actions/revoke-access';

export default function OwnerDashboardPage() {
    const router = useRouter();
    const { data: session, status: sessionStatus } = useSession();
    const [links, setLinks] = useState<DashboardLink[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [filter, setFilter] = useState<'all' | 'active' | 'expired' | 'revoked' | 'used'>('all');
    const [revokingId, setRevokingId] = useState<string | null>(null);
    const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

    // Redirect to sign-in if not authenticated
    useEffect(() => {
        if (sessionStatus === 'unauthenticated') {
            router.push('/auth/signin?callbackUrl=/dashboard/owner');
        }
    }, [sessionStatus, router]);



    // Fetch owned links
    useEffect(() => {
        async function fetchLinks() {
            if (session?.user?.id) {
                setIsLoading(true);
                try {
                    const owned = await getOwnedLinks(session.user.id);
                    setLinks(owned);
                } catch (error) {
                    console.error('Error fetching links:', error);
                } finally {
                    setIsLoading(false);
                }
            }
        }
        if (sessionStatus === 'authenticated') {
            fetchLinks();
        }
    }, [session, sessionStatus]);

    // Auto-dismiss notification
    useEffect(() => {
        if (notification) {
            const timer = setTimeout(() => setNotification(null), 5000);
            return () => clearTimeout(timer);
        }
    }, [notification]);

    if (sessionStatus === 'loading' || sessionStatus === 'unauthenticated') {
        return (
            <main className="signup-page">
                <section className="signup-section">
                    <div className="container">
                        <div className="signup-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
                            <div style={{ textAlign: 'center' }}>
                                <div className="button-spinner" style={{ width: '48px', height: '48px', margin: '0 auto 16px' }}></div>
                                <p style={{ color: 'var(--color-text-secondary)' }}>
                                    {sessionStatus === 'loading' ? 'Loading...' : 'Redirecting to sign in...'}
                                </p>
                            </div>
                        </div>
                    </div>
                </section>
            </main>
        );
    }

    const formatDate = (date: Date) => {
        return new Date(date).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
    };

    const getTimeRemaining = (expiresAt: Date) => {
        const now = new Date();
        const expiry = new Date(expiresAt);
        const diff = expiry.getTime() - now.getTime();
        if (diff <= 0) return null;
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        if (hours > 24) return `${Math.floor(hours / 24)}d ${hours % 24}h left`;
        if (hours > 0) return `${hours}h ${minutes}m left`;
        return `${minutes}m left`;
    };

    const getDuration = (createdAt: Date, expiresAt: Date) => {
        const diff = new Date(expiresAt).getTime() - new Date(createdAt).getTime();
        const minutes = Math.floor(diff / (1000 * 60));
        if (minutes < 60) return `${minutes} min`;
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        if (hours < 24) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
        const days = Math.floor(hours / 24);
        return `${days}d ${hours % 24}h`;
    };

    const formatFileSize = (bytes: number) => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    const getStatusBadge = (status: string) => {
        const styles: Record<string, { bg: string; color: string; icon: string; label: string }> = {
            active: { bg: 'rgba(34, 197, 94, 0.15)', color: '#22c55e', icon: '🟢', label: 'LIVE' },
            expired: { bg: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', icon: '🔴', label: 'EXPIRED' },
            revoked: { bg: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', icon: '⛔', label: 'REVOKED' },
            used: { bg: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6', icon: '✅', label: 'VIEWED' },
        };
        const s = styles[status] || styles.expired;
        return (
            <span style={{
                padding: '4px 12px', borderRadius: '12px', fontSize: '0.75rem',
                fontWeight: '600', textTransform: 'uppercase', background: s.bg, color: s.color,
                display: 'inline-flex', alignItems: 'center', gap: '4px',
            }}>
                {status === 'active' && (
                    <span style={{
                        width: '8px', height: '8px', borderRadius: '50%', background: '#22c55e',
                        display: 'inline-block', animation: 'pulse 2s infinite',
                    }} />
                )}
                <span>{s.icon}</span> {s.label}
            </span>
        );
    };

    const getAuditIcon = (action: string) => {
        const icons: Record<string, string> = {
            CREATED: '🔗', ACCESSED: '👁️', REVOKED: '⛔', EXPIRED: '⏰',
            CLEANUP: '🧹', LOCKED: '🔒', DENIED: '🚫', NOTIFIED: '📧',
            SESSION_END: '🔚', PREVIEW_RESTRICTED: '🛡️',
        };
        return icons[action] || '📋';
    };

    const handleCopy = (token: string, id: string) => {
        const url = `${window.location.origin}/share/${token}`;
        navigator.clipboard.writeText(url);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
    };

    const handleRevoke = async (link: DashboardLink) => {
        setRevokingId(link.id);
        try {
            const result = await revokeAccess(link.ownerToken, false);
            if (result.success) {
                setLinks(prev => prev.map(l =>
                    l.id === link.id ? { ...l, isRevoked: true, status: 'revoked' as const } : l
                ));
                setNotification({
                    message: `🔒 Access revoked${link.allowedVendorEmail ? ` for ${link.allowedVendorEmail}` : ''}. The link is no longer accessible.`,
                    type: 'success',
                });
            } else {
                setNotification({ message: result.error || 'Failed to revoke access.', type: 'error' });
            }
        } catch {
            setNotification({ message: 'Failed to revoke access. Please try again.', type: 'error' });
        } finally {
            setRevokingId(null);
            setConfirmRevokeId(null);
        }
    };

    const filteredLinks = filter === 'all' ? links : links.filter(l => l.status === filter);
    const counts = {
        all: links.length,
        active: links.filter(l => l.status === 'active').length,
        expired: links.filter(l => l.status === 'expired').length,
        revoked: links.filter(l => l.status === 'revoked').length,
        used: links.filter(l => l.status === 'used').length,
    };

    return (
        <main className="signup-page">
            <style>{`
                @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.3; }
                }
                .detail-row {
                    display: flex; align-items: center; gap: 10px;
                    padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.04);
                    font-size: 0.8rem;
                }
                .detail-row:last-child { border-bottom: none; }
                .detail-label {
                    color: var(--text-muted); min-width: 120px; font-weight: 500;
                    display: flex; align-items: center; gap: 6px;
                }
                .detail-value { color: var(--color-text); flex: 1; }
                .expand-btn {
                    background: none; border: none; cursor: pointer; padding: 4px 8px;
                    color: var(--primary-blue); font-size: 0.75rem; font-weight: 600;
                    display: flex; align-items: center; gap: 4px; transition: all 0.2s;
                    border-radius: 6px;
                }
                .expand-btn:hover { background: rgba(59, 130, 246, 0.1); }
            `}</style>

            <section className="signup-section">
                <div className="container">
                    <div className="signup-container" style={{ maxWidth: '960px' }}>

                        {/* Notification Banner */}
                        {notification && (
                            <div style={{
                                padding: '14px 20px', borderRadius: '12px', marginBottom: '20px',
                                background: notification.type === 'success' ? 'rgba(34, 197, 94, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                                border: `1px solid ${notification.type === 'success' ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                                color: notification.type === 'success' ? '#22c55e' : '#ef4444',
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                animation: 'fadeIn 0.3s ease',
                            }}>
                                <span style={{ fontSize: '0.9rem', fontWeight: '500' }}>{notification.message}</span>
                                <button onClick={() => setNotification(null)} style={{
                                    background: 'none', border: 'none', color: 'inherit', cursor: 'pointer',
                                    fontSize: '1.2rem', padding: '0 4px',
                                }}>×</button>
                            </div>
                        )}

                        {/* Header */}
                        <div className="signup-header">
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                                <div style={{
                                    width: '48px', height: '48px', borderRadius: '14px',
                                    background: 'linear-gradient(135deg, var(--primary-blue), var(--accent-purple))',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem',
                                }}>
                                    🛡️
                                </div>
                                <div>
                                    <h1 className="signup-page-title" style={{ marginBottom: '0' }}>
                                        <span className="gradient-text">Owner Dashboard</span>
                                    </h1>
                                    <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                                        {session?.user?.name || session?.user?.email}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Stats Cards */}
                        <div style={{
                            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                            gap: '12px', marginBottom: '24px',
                        }}>
                            {[
                                { label: 'Total Links', value: counts.all, color: 'var(--primary-blue)' },
                                { label: 'Live', value: counts.active, color: '#22c55e' },
                                { label: 'Viewed', value: counts.used, color: '#3b82f6' },
                                { label: 'Expired', value: counts.expired, color: '#ef4444' },
                                { label: 'Revoked', value: counts.revoked, color: '#f59e0b' },
                            ].map((stat) => (
                                <div key={stat.label} style={{
                                    padding: '16px', borderRadius: '12px',
                                    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
                                    textAlign: 'center',
                                }}>
                                    <p style={{ fontSize: '1.75rem', fontWeight: '700', color: stat.color }}>{stat.value}</p>
                                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>{stat.label}</p>
                                </div>
                            ))}
                        </div>

                        {/* Actions Bar */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '24px' }}>
                            <Link href="/signup" className="btn btn-primary">
                                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                                </svg>
                                <span>Create New Link</span>
                            </Link>
                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                {(['all', 'active', 'used', 'expired', 'revoked'] as const).map((f) => (
                                    <button
                                        key={f}
                                        onClick={() => setFilter(f)}
                                        style={{
                                            padding: '6px 14px', borderRadius: '8px', fontSize: '0.75rem',
                                            fontWeight: '500', border: 'none', cursor: 'pointer',
                                            background: filter === f ? 'var(--primary-blue)' : 'rgba(255,255,255,0.06)',
                                            color: filter === f ? '#fff' : 'var(--text-secondary)',
                                            transition: 'all 0.2s ease',
                                        }}
                                    >
                                        {f.charAt(0).toUpperCase() + f.slice(1)} ({counts[f]})
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Links List */}
                        <div className="signup-form-card">
                            {isLoading ? (
                                <div style={{ textAlign: 'center', padding: '48px' }}>
                                    <div className="button-spinner" style={{ width: '32px', height: '32px', margin: '0 auto 12px' }}></div>
                                    <p style={{ color: 'var(--color-text-secondary)' }}>Loading your links...</p>
                                </div>
                            ) : filteredLinks.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '48px' }}>
                                    <div style={{ fontSize: '3rem', marginBottom: '16px' }}>
                                        {filter === 'all' ? '🔗' : '🔍'}
                                    </div>
                                    <p style={{ color: 'var(--text-secondary)', marginBottom: '16px' }}>
                                        {filter === 'all'
                                            ? "You haven't created any secure links yet."
                                            : `No ${filter} links found.`}
                                    </p>
                                    {filter === 'all' && (
                                        <Link href="/signup" className="btn btn-primary">
                                            Create Your First Link
                                        </Link>
                                    )}
                                </div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                    {filteredLinks.map((link) => (
                                        <div
                                            key={link.id}
                                            style={{
                                                padding: '20px', borderRadius: '12px',
                                                background: 'rgba(255,255,255,0.02)',
                                                border: link.status === 'active'
                                                    ? '1px solid rgba(34, 197, 94, 0.2)'
                                                    : '1px solid rgba(255,255,255,0.06)',
                                                transition: 'all 0.2s ease',
                                            }}
                                        >
                                            {/* Top Row: Status + Time */}
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                    {getStatusBadge(link.status)}
                                                    {link.status === 'active' && getTimeRemaining(link.expiresAt) && (
                                                        <span style={{
                                                            fontSize: '0.75rem', color: '#f59e0b', fontWeight: '500',
                                                            padding: '2px 8px', borderRadius: '6px',
                                                            background: 'rgba(245, 158, 11, 0.1)',
                                                        }}>
                                                            ⏱ {getTimeRemaining(link.expiresAt)}
                                                        </span>
                                                    )}
                                                    {link.lockedAt && (
                                                        <span style={{
                                                            fontSize: '0.75rem', color: '#ef4444', fontWeight: '500',
                                                            padding: '2px 8px', borderRadius: '6px',
                                                            background: 'rgba(239, 68, 68, 0.1)',
                                                        }}>
                                                            🔒 LOCKED
                                                        </span>
                                                    )}
                                                </div>
                                                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                                    {formatDate(link.createdAt)}
                                                </div>
                                            </div>

                                            {/* Vendor Recipient */}
                                            <div style={{
                                                display: 'flex', alignItems: 'center', gap: '10px',
                                                padding: '10px 14px', borderRadius: '10px',
                                                background: link.allowedVendorEmail
                                                    ? 'rgba(14, 165, 233, 0.08)'
                                                    : 'rgba(255, 255, 255, 0.03)',
                                                marginBottom: '12px',
                                            }}>
                                                <div style={{
                                                    width: '36px', height: '36px', borderRadius: '10px',
                                                    background: link.allowedVendorEmail
                                                        ? 'linear-gradient(135deg, rgba(14, 165, 233, 0.3), rgba(139, 92, 246, 0.3))'
                                                        : 'rgba(255,255,255,0.06)',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    fontSize: '1rem', flexShrink: 0,
                                                }}>
                                                    {link.allowedVendorEmail ? '👤' : '🌐'}
                                                </div>
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '2px' }}>
                                                        {link.allowedVendorEmail ? 'SENT TO VENDOR' : 'PUBLIC LINK'}
                                                    </p>
                                                    <p style={{
                                                        fontSize: '0.9rem', fontWeight: '600',
                                                        color: link.allowedVendorEmail ? 'var(--primary-blue)' : 'var(--text-secondary)',
                                                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                                    }}>
                                                        {link.allowedVendorEmail || 'Anyone with the link'}
                                                    </p>
                                                </div>
                                                {/* Quick info badges */}
                                                <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                                                    {link.fileCount > 0 && (
                                                        <span style={{
                                                            fontSize: '0.7rem', padding: '3px 8px', borderRadius: '6px',
                                                            background: 'rgba(139,92,246,0.1)', color: '#a78bfa',
                                                            fontWeight: '600',
                                                        }}>
                                                            📎 {link.fileCount} file{link.fileCount > 1 ? 's' : ''}
                                                        </span>
                                                    )}
                                                    {link.failedAttempts > 0 && (
                                                        <span style={{
                                                            fontSize: '0.7rem', padding: '3px 8px', borderRadius: '6px',
                                                            background: 'rgba(239,68,68,0.1)', color: '#ef4444',
                                                            fontWeight: '600',
                                                        }}>
                                                            ⚠️ {link.failedAttempts} failed
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Shareable Link URL */}
                                            <div style={{
                                                display: 'flex', alignItems: 'center', gap: '8px',
                                                padding: '8px 12px', borderRadius: '8px',
                                                background: 'rgba(14, 165, 233, 0.06)',
                                                border: '1px solid rgba(14, 165, 233, 0.12)',
                                                marginBottom: '14px',
                                            }}>
                                                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: '600', flexShrink: 0 }}>🔗 LINK:</span>
                                                <span style={{
                                                    fontSize: '0.8rem', color: 'var(--primary-blue)',
                                                    fontFamily: 'monospace', overflow: 'hidden',
                                                    textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
                                                }}>
                                                    {typeof window !== 'undefined' ? `${window.location.origin}/share/${link.token}` : `/share/${link.token}`}
                                                </span>
                                                <button
                                                    onClick={() => handleCopy(link.token, 'link-' + link.id)}
                                                    style={{
                                                        padding: '3px 10px', borderRadius: '6px', fontSize: '0.7rem',
                                                        fontWeight: '600', border: '1px solid rgba(255,255,255,0.1)',
                                                        background: copiedId === 'link-' + link.id ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.05)',
                                                        color: copiedId === 'link-' + link.id ? '#22c55e' : 'var(--text-secondary)',
                                                        cursor: 'pointer', flexShrink: 0,
                                                    }}
                                                >
                                                    {copiedId === 'link-' + link.id ? '✅' : '📋'}
                                                </button>
                                            </div>

                                            {/* Quick info row: Duration + Purpose */}
                                            <div style={{
                                                display: 'flex', gap: '16px', flexWrap: 'wrap',
                                                fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '14px',
                                            }}>
                                                <span>⏱ Duration: {getDuration(link.createdAt, link.expiresAt)}</span>
                                                <span>{link.status === 'expired' ? '🔴 Expired' : '📅 Expires'}: {formatDate(link.expiresAt)}</span>
                                                {link.purpose && <span>📋 {link.purpose}{link.purposeDetail ? `: ${link.purposeDetail}` : ''}</span>}
                                                {link.otpVerifiedAt && <span>✅ Verified: {formatDate(link.otpVerifiedAt)}</span>}
                                            </div>

                                            {/* Actions + Expand */}
                                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                                                <button
                                                    onClick={() => handleCopy(link.token, link.id)}
                                                    className="btn btn-secondary btn-sm"
                                                    style={{ fontSize: '0.75rem' }}
                                                >
                                                    {copiedId === link.id ? '✅ Copied!' : '📋 Copy Link'}
                                                </button>
                                                <Link
                                                    href={`/revoke/${link.ownerToken}`}
                                                    className="btn btn-secondary btn-sm"
                                                    style={{ fontSize: '0.75rem' }}
                                                >
                                                    ⚙️ Manage
                                                </Link>

                                                {/* Expand/Collapse for details */}
                                                <button
                                                    className="expand-btn"
                                                    onClick={() => setExpandedId(expandedId === link.id ? null : link.id)}
                                                >
                                                    {expandedId === link.id ? '▲ Less' : '▼ Details'}
                                                </button>

                                                {/* Inline Revoke */}
                                                {link.status === 'active' && (
                                                    <>
                                                        {confirmRevokeId === link.id ? (
                                                            <div style={{
                                                                display: 'flex', alignItems: 'center', gap: '6px',
                                                                padding: '4px 10px', borderRadius: '8px',
                                                                background: 'rgba(239, 68, 68, 0.1)',
                                                                border: '1px solid rgba(239, 68, 68, 0.2)',
                                                            }}>
                                                                <span style={{ fontSize: '0.75rem', color: '#ef4444' }}>Revoke access?</span>
                                                                <button
                                                                    onClick={() => handleRevoke(link)}
                                                                    disabled={revokingId === link.id}
                                                                    style={{
                                                                        padding: '3px 10px', borderRadius: '6px', fontSize: '0.7rem',
                                                                        fontWeight: '600', border: 'none', cursor: 'pointer',
                                                                        background: '#ef4444', color: '#fff',
                                                                        opacity: revokingId === link.id ? 0.6 : 1,
                                                                    }}
                                                                >
                                                                    {revokingId === link.id ? 'Revoking...' : 'Yes, Revoke'}
                                                                </button>
                                                                <button
                                                                    onClick={() => setConfirmRevokeId(null)}
                                                                    style={{
                                                                        padding: '3px 10px', borderRadius: '6px', fontSize: '0.7rem',
                                                                        fontWeight: '600', border: '1px solid rgba(255,255,255,0.1)',
                                                                        cursor: 'pointer', background: 'transparent', color: 'var(--text-secondary)',
                                                                    }}
                                                                >
                                                                    Cancel
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <button
                                                                onClick={() => setConfirmRevokeId(link.id)}
                                                                className="btn btn-sm"
                                                                style={{
                                                                    fontSize: '0.75rem', background: 'rgba(239, 68, 68, 0.1)',
                                                                    color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.2)',
                                                                    cursor: 'pointer', borderRadius: '8px', padding: '6px 12px',
                                                                }}
                                                            >
                                                                🔒 Revoke Access
                                                            </button>
                                                        )}
                                                    </>
                                                )}
                                            </div>

                                            {/* Expanded Details Panel */}
                                            {expandedId === link.id && (
                                                <div style={{
                                                    marginTop: '16px', paddingTop: '16px',
                                                    borderTop: '1px solid rgba(255,255,255,0.06)',
                                                }}>
                                                    {/* Details Grid */}
                                                    <div style={{
                                                        display: 'grid', gridTemplateColumns: '1fr 1fr',
                                                        gap: '0', marginBottom: '16px',
                                                    }}>
                                                        <div className="detail-row">
                                                            <span className="detail-label">📅 Created</span>
                                                            <span className="detail-value">{formatDate(link.createdAt)}</span>
                                                        </div>
                                                        <div className="detail-row">
                                                            <span className="detail-label">⏰ Expires</span>
                                                            <span className="detail-value">{formatDate(link.expiresAt)}</span>
                                                        </div>
                                                        <div className="detail-row">
                                                            <span className="detail-label">⏱ Duration</span>
                                                            <span className="detail-value">{getDuration(link.createdAt, link.expiresAt)}</span>
                                                        </div>
                                                        <div className="detail-row">
                                                            <span className="detail-label">🔑 OTP Status</span>
                                                            <span className="detail-value" style={{
                                                                color: link.otpVerifiedAt ? '#22c55e' : '#f59e0b',
                                                            }}>
                                                                {link.otpVerifiedAt
                                                                    ? `Verified at ${formatDate(link.otpVerifiedAt)}`
                                                                    : 'Not verified yet'}
                                                            </span>
                                                        </div>
                                                        {link.otp && (
                                                            <div className="detail-row" style={{ gridColumn: '1 / -1' }}>
                                                                <span className="detail-label">🔐 OTP Code</span>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                    <span className="detail-value" style={{
                                                                        fontFamily: 'monospace',
                                                                        fontSize: '1.1rem',
                                                                        letterSpacing: '4px',
                                                                        color: '#22d3ee',
                                                                        background: 'rgba(34, 211, 238, 0.08)',
                                                                        padding: '4px 12px',
                                                                        borderRadius: '8px',
                                                                        border: '1px solid rgba(34, 211, 238, 0.15)',
                                                                    }}>
                                                                        {link.otp}
                                                                    </span>
                                                                    <button
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            navigator.clipboard.writeText(link.otp!);
                                                                            setCopiedId('otp-' + link.id);
                                                                            setTimeout(() => setCopiedId(null), 2000);
                                                                        }}
                                                                        style={{
                                                                            padding: '4px 10px', borderRadius: '6px',
                                                                            fontSize: '0.7rem', fontWeight: '600',
                                                                            border: '1px solid rgba(255,255,255,0.1)',
                                                                            background: copiedId === 'otp-' + link.id ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.05)',
                                                                            color: copiedId === 'otp-' + link.id ? '#22c55e' : 'var(--text-secondary)',
                                                                            cursor: 'pointer',
                                                                        }}
                                                                    >
                                                                        {copiedId === 'otp-' + link.id ? '✅ Copied' : '📋 Copy'}
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        )}
                                                        {link.notificationEmail && (
                                                            <div className="detail-row">
                                                                <span className="detail-label">📧 Notify Email</span>
                                                                <span className="detail-value">{link.notificationEmail}</span>
                                                            </div>
                                                        )}
                                                        <div className="detail-row">
                                                            <span className="detail-label">⚠️ Failed OTPs</span>
                                                            <span className="detail-value" style={{
                                                                color: link.failedAttempts > 0 ? '#ef4444' : '#22c55e',
                                                            }}>
                                                                {link.failedAttempts} attempt{link.failedAttempts !== 1 ? 's' : ''}
                                                            </span>
                                                        </div>
                                                    </div>

                                                    {/* Files Section */}
                                                    {link.files.length > 0 && (
                                                        <div style={{ marginBottom: '16px' }}>
                                                            <h4 style={{
                                                                fontSize: '0.8rem', fontWeight: '600', color: 'var(--color-text)',
                                                                marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px',
                                                            }}>
                                                                📎 Attached Files ({link.files.length})
                                                            </h4>
                                                            <div style={{
                                                                display: 'flex', flexDirection: 'column', gap: '6px',
                                                                background: 'rgba(255,255,255,0.02)', borderRadius: '8px',
                                                                padding: '10px 14px',
                                                            }}>
                                                                {link.files.map((file, i) => (
                                                                    <div key={i} style={{
                                                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                                                        fontSize: '0.8rem', padding: '4px 0',
                                                                        borderBottom: i < link.files.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                                                                    }}>
                                                                        <span style={{ color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                                            <span style={{ opacity: 0.6 }}>
                                                                                {file.fileType.includes('image') ? '🖼️'
                                                                                    : file.fileType.includes('pdf') ? '📄'
                                                                                        : file.fileType.includes('sheet') || file.fileType.includes('csv') || file.fileType.includes('excel') ? '📊'
                                                                                            : '📁'}
                                                                            </span>
                                                                            {file.fileName}
                                                                        </span>
                                                                        <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                                                                            {formatFileSize(file.fileSize)}
                                                                        </span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* Audit Log Section */}
                                                    {link.auditLogs.length > 0 && (
                                                        <div>
                                                            <h4 style={{
                                                                fontSize: '0.8rem', fontWeight: '600', color: 'var(--color-text)',
                                                                marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px',
                                                            }}>
                                                                📜 Activity Log
                                                            </h4>
                                                            <div style={{
                                                                background: 'rgba(255,255,255,0.02)', borderRadius: '8px',
                                                                padding: '10px 14px',
                                                            }}>
                                                                {link.auditLogs.map((log, i) => (
                                                                    <div key={i} style={{
                                                                        display: 'flex', alignItems: 'center', gap: '10px',
                                                                        fontSize: '0.78rem', padding: '6px 0',
                                                                        borderBottom: i < link.auditLogs.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                                                                    }}>
                                                                        <span style={{ fontSize: '1rem', width: '24px', textAlign: 'center' }}>
                                                                            {getAuditIcon(log.action)}
                                                                        </span>
                                                                        <span style={{
                                                                            fontWeight: '600', fontSize: '0.7rem',
                                                                            padding: '2px 8px', borderRadius: '4px',
                                                                            background: 'rgba(255,255,255,0.05)',
                                                                            color: 'var(--color-text)',
                                                                            minWidth: '80px', textAlign: 'center',
                                                                        }}>
                                                                            {log.action}
                                                                        </span>
                                                                        <span style={{ color: 'var(--text-muted)', flex: 1 }}>
                                                                            {log.reason || '—'}
                                                                        </span>
                                                                        <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', flexShrink: 0 }}>
                                                                            {formatDate(log.timestamp)}
                                                                        </span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </section>
        </main>
    );
}
