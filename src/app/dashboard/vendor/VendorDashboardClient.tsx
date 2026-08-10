'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { getReceivedLinks, DashboardLink } from '@/actions/dashboard';
import { Mail, Inbox, Clock, Eye, Ban, Coffee, Play, User, Calendar, Paperclip, FileText } from 'lucide-react';

interface VendorDashboardClientProps {
    initialLinks: DashboardLink[];
    userEmail: string;
}

export default function VendorDashboardClient({
    initialLinks,
    userEmail,
}: VendorDashboardClientProps) {
    const [links, setLinks] = useState<DashboardLink[]>(initialLinks);
    const [isLoading] = useState(false);
    const [filter, setFilter] = useState<'all' | 'active' | 'expired' | 'revoked' | 'used' | 'break'>('all');

    const fetchLinks = useCallback(async () => {
        try {
            const received = await getReceivedLinks(userEmail);
            setLinks(received);
        } catch (error) {
            console.error('Error fetching links:', error);
        }
    }, [userEmail]);

    // Poll every 20s only while the tab is visible (was 5s always-on)
    useEffect(() => {
        const POLL_MS = 20_000;

        const tick = () => {
            if (document.visibilityState === 'visible') {
                void fetchLinks();
            }
        };

        const interval = setInterval(tick, POLL_MS);
        const onVisibility = () => {
            if (document.visibilityState === 'visible') void fetchLinks();
        };
        document.addEventListener('visibilitychange', onVisibility);

        return () => {
            clearInterval(interval);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [fetchLinks]);

    const formatDate = (date: Date) => {
        return new Date(date).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
    };

    const getStatusBadge = (status: string) => {
        const styles: Record<string, { bg: string; color: string; label: string }> = {
            active: { bg: 'rgba(34, 197, 94, 0.15)', color: '#22c55e', label: 'Ready to View' },
            expired: { bg: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', label: 'Expired' },
            revoked: { bg: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', label: 'Revoked' },
            used: { bg: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6', label: 'Viewed' },
            break: { bg: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', label: 'On Break' },
        };
        const s = styles[status] || styles.expired;

        const renderIcon = () => {
            if (status === 'active') {
                return (
                    <span style={{
                        width: '8px', height: '8px', borderRadius: '50%', background: '#22c55e',
                        display: 'inline-block', animation: 'pulse 2s infinite',
                    }} />
                );
            }
            if (status === 'used') {
                return <Eye size={12} />;
            }
            if (status === 'revoked') {
                return <Ban size={12} />;
            }
            if (status === 'break') {
                return <Coffee size={12} />;
            }
            return <Clock size={12} />;
        };

        return (
            <span style={{
                padding: '4px 12px', borderRadius: '12px', fontSize: '0.75rem',
                fontWeight: '600', background: s.bg, color: s.color,
                display: 'inline-flex', alignItems: 'center', gap: '6px',
            }}>
                {renderIcon()}
                <span>{s.label}</span>
            </span>
        );
    };

    const getTimeRemaining = (expiresAt: Date) => {
        const now = new Date();
        const expiry = new Date(expiresAt);
        const diff = expiry.getTime() - now.getTime();
        if (diff <= 0) return 'Expired';
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        if (hours > 24) return `${Math.floor(hours / 24)}d ${hours % 24}h remaining`;
        if (hours > 0) return `${hours}h ${minutes}m remaining`;
        return `${minutes}m remaining`;
    };

    const filteredLinks = filter === 'all' ? links : links.filter(l => l.status === filter);
    const counts = {
        all: links.length,
        active: links.filter(l => l.status === 'active').length,
        expired: links.filter(l => l.status === 'expired').length,
        revoked: links.filter(l => l.status === 'revoked').length,
        used: links.filter(l => l.status === 'used').length,
        break: links.filter(l => l.status === 'break').length,
    };

    return (
        <main className="app-page">
            <section className="app-section">
                <div className="container">
                    <div className="app-container" style={{ maxWidth: '960px' }}>
                        {/* Header */}
                        <div className="dashboard-header-container">
                            <div className="dashboard-profile">
                                <div className="dashboard-avatar" style={{ background: 'linear-gradient(135deg, var(--accent-cyan) 0%, var(--success) 100%)' }}>
                                    <Mail size={26} style={{ color: '#fff' }} />
                                </div>
                                <div className="dashboard-title-group">
                                    <h1 style={{ margin: 0 }}>Vendor Dashboard</h1>
                                    <p style={{ margin: 0 }}>{userEmail} • Links shared with you</p>
                                </div>
                            </div>
                        </div>

                        {/* Stats Cards */}
                        <div className="stats-container-grid">
                            {[
                                { label: 'Total Received', value: counts.all, iconClass: 'stat-icon-total', icon: <Inbox size={20} /> },
                                { label: 'Ready to View', value: counts.active, iconClass: 'stat-icon-live', icon: <Play size={20} /> },
                                { label: 'On Break', value: counts.break, iconClass: 'stat-icon-revoked', icon: <Coffee size={20} /> },
                                { label: 'Viewed', value: counts.used, iconClass: 'stat-icon-viewed', icon: <Eye size={20} /> },
                                { label: 'Expired', value: counts.expired, iconClass: 'stat-icon-expired', icon: <Clock size={20} /> },
                            ].map((stat) => (
                                <div key={stat.label} className="stat-card-premium">
                                    <div className={`stat-icon-wrapper ${stat.iconClass}`}>
                                        {stat.icon}
                                    </div>
                                    <div className="stat-text-group">
                                        <span className="stat-value-premium">{stat.value}</span>
                                        <span className="stat-label-premium">{stat.label}</span>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Filter Segment Control */}
                        <div className="action-filter-wrapper">
                            <div className="segmented-filter-bar">
                                {(['all', 'active', 'break', 'used', 'expired', 'revoked'] as const).map((f) => (
                                    <button
                                        key={f}
                                        onClick={() => setFilter(f)}
                                        className={`segment-pill-btn ${filter === f ? 'active' : ''}`}
                                    >
                                        <span>{f.charAt(0).toUpperCase() + f.slice(1)}</span>
                                        <span className="segment-pill-count">{counts[f]}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Links List */}
                        <div style={{ background: 'transparent', border: 'none', padding: 0 }}>
                            {isLoading ? (
                                <div style={{ textAlign: 'center', padding: '48px' }}>
                                    <div className="button-spinner" style={{ width: '32px', height: '32px', margin: '0 auto 12px' }}></div>
                                    <p style={{ color: 'var(--color-text-secondary)' }}>Loading shared links...</p>
                                </div>
                            ) : filteredLinks.length === 0 ? (
                                <div className="app-form-card" style={{ textAlign: 'center', padding: '48px' }}>
                                    <div style={{ color: 'var(--text-muted)', marginBottom: '16px', display: 'flex', justifyContent: 'center' }}>
                                        <Inbox size={48} />
                                    </div>
                                    <p style={{ color: 'var(--text-secondary)', marginBottom: '8px', fontSize: '1.1rem' }}>
                                        {filter === 'all'
                                            ? 'No links have been shared with you yet'
                                            : `No ${filter} links found`}
                                    </p>
                                    <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                                        When someone creates a secure link for your email, it will appear here.
                                    </p>
                                </div>
                            ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                        {filteredLinks.map((link) => (
                                            <div key={link.id} className="premium-link-card">
                                                {/* Top Row: User Avatar, Sender info, Status badges */}
                                                <div className="card-header-flex">
                                                    <div className="recipient-avatar-group">
                                                        <div className="recipient-avatar-circle vendor" style={{ background: 'linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%)' }}>
                                                            <User size={20} />
                                                        </div>
                                                        <div className="recipient-info">
                                                            <span className="recipient-subtitle">
                                                                Shared By Owner
                                                            </span>
                                                            <span className="recipient-title" style={{ fontSize: '1.05rem', color: '#111827', fontWeight: 700 }}>
                                                                {link.purpose || 'Secure Shared Link'}
                                                            </span>
                                                        </div>
                                                    </div>

                                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                            {getStatusBadge(link.status)}
                                                            {link.status === 'active' && getTimeRemaining(link.expiresAt) && (
                                                                <span style={{
                                                                    fontSize: '0.72rem', color: '#16a34a', fontWeight: '600',
                                                                    padding: '2px 8px', borderRadius: '6px',
                                                                    background: '#f0fdf4', border: '1px solid #bbf7d0',
                                                                    display: 'inline-flex', alignItems: 'center', gap: '4px'
                                                                }}>
                                                                    <Clock size={10} />
                                                                    <span>{getTimeRemaining(link.expiresAt)}</span>
                                                                </span>
                                                            )}
                                                        </div>
                                                        <span style={{ fontSize: '0.72rem', color: '#9CA3AF', fontWeight: '500' }}>
                                                            Received {formatDate(link.createdAt)}
                                                        </span>
                                                    </div>
                                                </div>

                                                {/* Metadata Grid */}
                                                <div className="premium-metadata-grid" style={{ marginBottom: '14px', alignItems: 'center' }}>
                                                    <div className="metadata-item-flex" style={{ color: '#4B5563', fontWeight: 500 }}>
                                                        <Calendar size={14} style={{ color: '#9CA3AF' }} />
                                                        <span>{link.status === 'expired' ? 'Expired' : 'Expires'}: {formatDate(link.expiresAt)}</span>
                                                    </div>
                                                    {link.fileCount > 0 && (
                                                        <span style={{
                                                            fontSize: '0.75rem', color: '#7C3AED', fontWeight: '600',
                                                            padding: '3px 10px', borderRadius: '20px',
                                                            background: '#F5F3FF', border: '1px solid #E9D5FF',
                                                            display: 'inline-flex', alignItems: 'center', gap: '6px'
                                                        }}>
                                                            <Paperclip size={12} />
                                                            <span>{link.fileCount} file{link.fileCount > 1 ? 's' : ''} Included</span>
                                                        </span>
                                                    )}
                                                </div>

                                                {/* Details Box */}
                                                {link.purposeDetail && (
                                                    <div style={{
                                                        fontSize: '0.82rem', color: '#4B5563', marginBottom: '18px',
                                                        background: '#F9FAFB', border: '1px solid #E5E7EB',
                                                        borderRadius: '8px', padding: '10px 14px',
                                                        display: 'flex', alignItems: 'flex-start', gap: '8px',
                                                        lineHeight: 1.5
                                                    }}>
                                                        <FileText size={14} style={{ color: '#9CA3AF', marginTop: '3px', flexShrink: 0 }} />
                                                        <div>
                                                            <span style={{ fontWeight: 700, color: '#4B5563', display: 'block', marginBottom: '2px', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Details</span>
                                                            <span>{link.purposeDetail}</span>
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Actions Footer */}
                                                <div className="premium-card-footer" style={{ borderTop: 'none', paddingTop: 0 }}>
                                                    <div className="premium-actions-left">
                                                        {link.status === 'active' ? (
                                                            <Link
                                                                href={`/share/${link.token}`}
                                                                className="premium-btn-action primary"
                                                                style={{ textDecoration: 'none' }}
                                                            >
                                                                <Eye size={14} /> View Secure Data
                                                            </Link>
                                                        ) : link.status === 'break' ? (
                                                            <Link
                                                                href={`/share/${link.token}`}
                                                                className="premium-btn-action warning-outline"
                                                                style={{ textDecoration: 'none' }}
                                                            >
                                                                <Play size={14} /> Resume Work
                                                            </Link>
                                                        ) : link.status === 'used' ? (
                                                            <span style={{
                                                                padding: '6px 14px', borderRadius: '8px',
                                                                fontSize: '0.8rem', color: '#6B7280',
                                                                background: '#F9FAFB', border: '1px solid #E5E7EB',
                                                                fontWeight: 600
                                                            }}>
                                                                Data was accessed on {formatDate(link.expiresAt)}
                                                            </span>
                                                        ) : (
                                                            <span style={{
                                                                padding: '6px 14px', borderRadius: '8px',
                                                                fontSize: '0.8rem', color: '#EF4444',
                                                                background: '#FEF2F2', border: '1px solid #FCA5A5',
                                                                fontWeight: 600
                                                            }}>
                                                                This link is no longer accessible
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
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
