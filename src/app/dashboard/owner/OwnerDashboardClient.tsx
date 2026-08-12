'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { DashboardLink, SendHistoryRecord, getLinkDetails } from '@/actions/dashboard';
import { getUnifiedAuditLogs, UnifiedAuditLog } from '@/actions/audit-logs';
import { revokeAccess } from '@/actions/revoke-access';
import dynamic from 'next/dynamic';
import { 
    Shield, 
    Link2, 
    History, 
    FileText, 
    Download, 
    Inbox, 
    Clock, 
    Calendar, 
    Check, 
    Settings, 
    ChevronDown, 
    ChevronUp, 
    Key, 
    Lock, 
    Mail, 
    AlertTriangle, 
    Paperclip, 
    FileImage, 
    FileSpreadsheet, 
    Folder, 
    Eye, 
    Ban, 
    Trash2, 
    LogOut, 
    Coffee,
    User,
    Globe,
    Loader2
} from 'lucide-react';

const LiveActivityModal = dynamic(() => import('@/components/LiveActivityModal'), {
    ssr: false,
});

interface OwnerDashboardClientProps {
    initialLinks: DashboardLink[];
    initialHistory: SendHistoryRecord[];
    userId: string;
    userLabel: string;
}

export default function OwnerDashboardClient({
    initialLinks,
    initialHistory,
    userLabel,
}: OwnerDashboardClientProps) {
    const [links, setLinks] = useState<DashboardLink[]>(initialLinks);
    const [sendHistory] = useState<SendHistoryRecord[]>(initialHistory);
    const [isLoading] = useState(false);
    const [revokingId, setRevokingId] = useState<string | null>(null);
    const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [detailsLoadingId, setDetailsLoadingId] = useState<string | null>(null);
    const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const [activeTab, setActiveTab] = useState<'links' | 'history' | 'audit'>('links');
    const [liveActivityLink, setLiveActivityLink] = useState<{token: string, topic: string} | null>(null);
    const [auditLogs, setAuditLogs] = useState<UnifiedAuditLog[]>([]);
    const [auditLoaded, setAuditLoaded] = useState(false);
    const [auditLoading, setAuditLoading] = useState(false);
    const [auditFilter, setAuditFilter] = useState({ search: '', type: 'ALL', severity: 'ALL' });

    // Lazy-load the heavy audit query only when that tab is opened
    useEffect(() => {
        if (activeTab !== 'audit' || auditLoaded) return;
        let cancelled = false;
        setAuditLoading(true);
        getUnifiedAuditLogs()
            .then((audits) => {
                if (!cancelled) {
                    setAuditLogs(audits);
                    setAuditLoaded(true);
                }
            })
            .catch((error) => console.error('Error fetching audit logs:', error))
            .finally(() => {
                if (!cancelled) setAuditLoading(false);
            });
        return () => { cancelled = true; };
    }, [activeTab, auditLoaded]);

    // Auto-dismiss notification
    useEffect(() => {
        if (notification) {
            const timer = setTimeout(() => setNotification(null), 5000);
            return () => clearTimeout(timer);
        }
    }, [notification]);

    /** Expand card and lazy-load files/audits (slim list payload from server). */
    const handleExpand = async (linkId: string) => {
        if (expandedId === linkId) {
            setExpandedId(null);
            return;
        }
        setExpandedId(linkId);
        const link = links.find((l) => l.id === linkId);
        if (link?.detailsLoaded) return;
        setDetailsLoadingId(linkId);
        try {
            const res = await getLinkDetails(linkId);
            if (res.success) {
                setLinks((prev) =>
                    prev.map((l) =>
                        l.id === linkId
                            ? {
                                  ...l,
                                  files: res.files || [],
                                  auditLogs: res.auditLogs || [],
                                  fileCount: res.files?.length ?? l.fileCount,
                                  detailsLoaded: true,
                              }
                            : l
                    )
                );
            }
        } finally {
            setDetailsLoadingId(null);
        }
    };

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
        const styles: Record<string, { bg: string; color: string; label: string }> = {
            active: { bg: 'rgba(34, 197, 94, 0.15)', color: '#22c55e', label: 'LIVE' },
            expired: { bg: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', label: 'EXPIRED' },
            revoked: { bg: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', label: 'REVOKED' },
            used: { bg: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6', label: 'VIEWED' },
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
                return <Check size={12} />;
            }
            if (status === 'revoked') {
                return <Ban size={12} />;
            }
            return <Clock size={12} />;
        };

        return (
            <span style={{
                padding: '4px 12px', borderRadius: '12px', fontSize: '0.75rem',
                fontWeight: '600', textTransform: 'uppercase', background: s.bg, color: s.color,
                display: 'inline-flex', alignItems: 'center', gap: '6px',
            }}>
                {renderIcon()}
                <span>{s.label}</span>
            </span>
        );
    };

    const getAuditIcon = (action: string) => {
        const icons: Record<string, React.ReactNode> = {
            CREATED: <Link2 size={16} />,
            ACCESSED: <Eye size={16} />,
            REVOKED: <Ban size={16} />,
            EXPIRED: <Clock size={16} />,
            CLEANUP: <Trash2 size={16} />,
            LOCKED: <Lock size={16} />,
            DENIED: <Ban size={16} />,
            NOTIFIED: <Mail size={16} />,
            SESSION_END: <LogOut size={16} />,
            PREVIEW_RESTRICTED: <Shield size={16} />,
            SESSION_ENDED: <LogOut size={16} />,
            BREAK: <Coffee size={16} />,
            LOGOUT: <LogOut size={16} />,
            LOG_OUT: <LogOut size={16} />
        };
        return icons[action] || <FileText size={16} />;
    };

    const handleRevoke = async (link: DashboardLink) => {
        setRevokingId(link.id);
        try {
            const result = await revokeAccess(link.ownerToken!, true);
            if (result.success) {
                setLinks(prev => prev.filter(l => l.id !== link.id));
                setNotification({
                    message: `Access revoked${link.allowedVendorEmail ? ` for ${link.allowedVendorEmail}` : ''} and all shared data permanently deleted.`,
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


    const exportAuditCSV = () => {
        const headers = ['Timestamp', 'Type', 'Action', 'Severity', 'Actor', 'IP', 'Description'];
        const rows = filteredAuditLogs.map(log => [
            new Date(log.timestamp).toISOString(),
            log.type,
            log.action,
            log.severity,
            log.actor,
            log.ipAddress || 'Unknown',
            `"${log.description.replace(/"/g, '""')}"`
        ]);
        const csvContent = "data:text/csv;charset=utf-8," + [headers.join(','), ...rows.map(e => e.join(','))].join("\n");
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `audit_logs_${new Date().toISOString().slice(0,10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const filteredAuditLogs = auditLogs.filter(log => {
        if (auditFilter.type !== 'ALL' && log.type !== auditFilter.type) return false;
        if (auditFilter.severity !== 'ALL' && log.severity !== auditFilter.severity) return false;
        if (auditFilter.search) {
            const term = auditFilter.search.toLowerCase();
            return log.actor.toLowerCase().includes(term) || log.action.toLowerCase().includes(term) || log.description.toLowerCase().includes(term);
        }
        return true;
    });

    // Combined stats: links (active data) + sendHistory (preserved records)
    // sendHistory only contains expired/revoked/cleaned records
    // links contains currently active/used records that haven't been cleaned yet
    const historyCounts = {
        total: sendHistory.length,
        expired: sendHistory.filter(r => r.status === 'expired').length,
        revoked: sendHistory.filter(r => r.status === 'revoked').length,
        cleaned: sendHistory.filter(r => r.status === 'cleaned').length,
    };
    const counts = {
        all: links.length + historyCounts.total,
        active: links.filter(l => l.status === 'active').length,
        expired: links.filter(l => l.status === 'expired').length + historyCounts.expired,
        revoked: links.filter(l => l.status === 'revoked').length + historyCounts.revoked,
        used: links.filter(l => l.status === 'used').length,
    };

    return (
        <main className="app-page">
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

            <section className="app-section">
                <div className="container">
                    <div className="app-container" style={{ maxWidth: '960px' }}>

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
                        <div className="dashboard-header-container">
                            <div className="dashboard-profile">
                                <div className="dashboard-avatar">
                                    <Shield size={26} />
                                </div>
                                <div className="dashboard-title-group">
                                    <h1 style={{ margin: 0 }}>Owner Dashboard</h1>
                                    <p style={{ margin: 0 }}>{userLabel}</p>
                                </div>
                            </div>
                        </div>

                        {/* Stats Cards */}
                        <div className="stats-container-grid">
                            {[
                                { label: 'Total Links', value: counts.all, iconClass: 'stat-icon-total', icon: <Link2 size={20} /> },
                                { label: 'Live', value: counts.active, iconClass: 'stat-icon-live', icon: <Clock size={20} /> },
                                { label: 'Viewed', value: counts.used, iconClass: 'stat-icon-viewed', icon: <Eye size={20} /> },
                                { label: 'Expired', value: counts.expired, iconClass: 'stat-icon-expired', icon: <Clock size={20} /> },
                                { label: 'Revoked', value: counts.revoked, iconClass: 'stat-icon-revoked', icon: <Ban size={20} /> },
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

                        <div className="action-filter-wrapper">
                            <Link href="/create-link" className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 24px', borderRadius: '12px' }}>
                                <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                                </svg>
                                <span style={{ fontWeight: 600 }}>Create New Link</span>
                            </Link>
                        </div>

                        {/* Tab Switcher */}
                        <div style={{
                            display: 'flex', gap: '4px', marginBottom: '20px',
                            background: 'rgba(255,255,255,0.03)', borderRadius: '12px',
                            padding: '4px', border: '1px solid rgba(255,255,255,0.06)',
                        }}>
                            <button
                                onClick={() => setActiveTab('links')}
                                style={{
                                    flex: 1, padding: '10px 16px', borderRadius: '10px',
                                    fontSize: '0.85rem', fontWeight: '600', border: 'none', cursor: 'pointer',
                                    background: activeTab === 'links' ? 'var(--primary-blue)' : 'transparent',
                                    color: activeTab === 'links' ? '#fff' : 'var(--text-muted)',
                                    transition: 'all 0.2s ease',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
                                }}
                            >
                                <Link2 size={16} />
                                <span>Active Links ({links.length})</span>
                            </button>
                            <button
                                onClick={() => setActiveTab('history')}
                                style={{
                                    flex: 1, padding: '10px 16px', borderRadius: '10px',
                                    fontSize: '0.85rem', fontWeight: '600', border: 'none', cursor: 'pointer',
                                    background: activeTab === 'history' ? 'var(--primary-blue)' : 'transparent',
                                    color: activeTab === 'history' ? '#fff' : 'var(--text-muted)',
                                    transition: 'all 0.2s ease',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
                                }}
                            >
                                <History size={16} />
                                <span>Send History ({sendHistory.length})</span>
                            </button>
                            <button
                                onClick={() => setActiveTab('audit')}
                                style={{
                                    flex: 1, padding: '10px 16px', borderRadius: '10px',
                                    fontSize: '0.85rem', fontWeight: '600', border: 'none', cursor: 'pointer',
                                    background: activeTab === 'audit' ? 'var(--primary-blue)' : 'transparent',
                                    color: activeTab === 'audit' ? '#fff' : 'var(--text-muted)',
                                    transition: 'all 0.2s ease',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
                                }}
                            >
                                <FileText size={16} />
                                <span>Audit Trails</span>
                            </button>
                        </div>

                        {/* Audit Logs Tab */}
                        {activeTab === 'audit' && (
                            <div className="app-form-card">
                                {auditLoading ? (
                                    <div style={{ textAlign: 'center', padding: '48px' }}>
                                        <div className="button-spinner" style={{ width: '32px', height: '32px', margin: '0 auto 12px' }}></div>
                                        <p style={{ color: 'var(--color-text-secondary)' }}>Loading audit trails...</p>
                                    </div>
                                ) : (
                                    <div>
                                        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '20px', background: 'rgba(255,255,255,0.02)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                                            <input
                                                type="text"
                                                placeholder="Search logs..."
                                                value={auditFilter.search}
                                                onChange={(e) => setAuditFilter({ ...auditFilter, search: e.target.value })}
                                                style={{ flex: 1, minWidth: '200px', padding: '8px 12px', borderRadius: '8px', background: 'rgba(0,0,0,0.2)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)' }}
                                            />
                                            <select
                                                value={auditFilter.type}
                                                onChange={(e) => setAuditFilter({ ...auditFilter, type: e.target.value })}
                                                style={{ padding: '8px 12px', borderRadius: '8px', background: 'rgba(0,0,0,0.2)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)' }}
                                            >
                                                <option value="ALL">All Types</option>
                                                <option value="SECURITY">Security</option>
                                                <option value="DOCUMENT">Document</option>
                                            </select>
                                            <select
                                                value={auditFilter.severity}
                                                onChange={(e) => setAuditFilter({ ...auditFilter, severity: e.target.value })}
                                                style={{ padding: '8px 12px', borderRadius: '8px', background: 'rgba(0,0,0,0.2)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)' }}
                                            >
                                                <option value="ALL">All Severities</option>
                                                <option value="INFO">Info</option>
                                                <option value="WARNING">Warning</option>
                                                <option value="CRITICAL">Critical</option>
                                            </select>
                                            <button onClick={exportAuditCSV} className="btn btn-secondary btn-sm" style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                <Download size={14} /> Export CSV
                                            </button>
                                        </div>

                                        {filteredAuditLogs.length === 0 ? (
                                            <div style={{ textAlign: 'center', padding: '48px' }}>
                                                <div style={{ color: 'var(--text-muted)', marginBottom: '12px' }}>
                                                    <FileText size={40} style={{ margin: '0 auto' }} />
                                                </div>
                                                <p style={{ color: 'var(--text-muted)' }}>No audit logs matching criteria.</p>
                                            </div>
                                        ) : (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                {filteredAuditLogs.map(log => {
                                                    const isCritical = log.severity === 'CRITICAL';
                                                    const isWarning = log.severity === 'WARNING';
                                                    return (
                                                        <div key={log.id} style={{
                                                            display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 0', borderBottom: '1px solid rgba(255,255,255,0.06)'
                                                        }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                                                <div style={{ fontSize: '1.25rem', flexShrink: 0, color: 'var(--text-muted)' }}>
                                                                    {getAuditIcon(log.action)}
                                                                </div>
                                                                <div>
                                                                    <span style={{ fontWeight: '600', fontSize: '0.9rem', color: isCritical ? '#ef4444' : isWarning ? '#f59e0b' : 'var(--color-text)', marginRight: '8px' }}>
                                                                        {log.action}
                                                                    </span>
                                                                    <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                                                        {log.description}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', textAlign: 'right' }}>
                                                                {formatDate(log.timestamp)}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Send History Tab */}
                        {activeTab === 'history' && (
                            <div className="app-form-card">
                                {isLoading ? (
                                    <div style={{ textAlign: 'center', padding: '48px' }}>
                                        <div className="button-spinner" style={{ width: '32px', height: '32px', margin: '0 auto 12px' }}></div>
                                        <p style={{ color: 'var(--color-text-secondary)' }}>Loading send history...</p>
                                    </div>
                                ) : sendHistory.length === 0 ? (
                                    <div style={{ textAlign: 'center', padding: '48px' }}>
                                        <div style={{ color: 'var(--text-muted)', marginBottom: '12px' }}>
                                            <Inbox size={40} style={{ margin: '0 auto' }} />
                                        </div>
                                        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                                            No send history yet. Create your first secure link!
                                        </p>
                                    </div>
                                ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', padding: '0 4px', marginBottom: '4px' }}>
                                            📌 This history is preserved even after data is deleted from the database.
                                        </p>
                                        {sendHistory.map((record) => {
                                            // Calculate time ago
                                            const createdDate = new Date(record.createdAt);
                                            const now = new Date();
                                            const diffMs = now.getTime() - createdDate.getTime();
                                            const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
                                            const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
                                            const diffMins = Math.floor(diffMs / (1000 * 60));
                                            const timeAgo = diffDays > 0 ? `${diffDays}d ago`
                                                : diffHours > 0 ? `${diffHours}h ago`
                                                    : `${diffMins}m ago`;
                                            return (
                                                <div key={record.id} style={{
                                                    padding: '20px',
                                                    borderRadius: '14px',
                                                    background: '#FFFFFF',
                                                    border: '1px solid #E5E7EB',
                                                    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)',
                                                    transition: 'all 0.2s ease',
                                                }}>
                                                    {/* Row 1: Topic + Status */}
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                                                        <div style={{ flex: 1, minWidth: 0 }}>
                                                            <p style={{
                                                                fontWeight: '700', fontSize: '1rem',
                                                                color: '#111827',
                                                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                                                display: 'flex', alignItems: 'center', gap: '8px',
                                                            }}>
                                                                <FileText size={16} style={{ color: '#4B5563' }} /> {record.topic}
                                                            </p>
                                                            <p style={{ fontSize: '0.78rem', color: '#6B7280', marginTop: '4px' }}>
                                                                Sent on {formatDate(record.createdAt)} · {timeAgo}
                                                            </p>
                                                        </div>
                                                        <span style={{
                                                            fontSize: '0.75rem', padding: '4px 12px',
                                                            borderRadius: '8px', fontWeight: '600',
                                                            textTransform: 'uppercase', flexShrink: 0, marginLeft: '12px',
                                                            background: record.status === 'active'
                                                                ? '#DCFCE7'
                                                                : record.status === 'revoked'
                                                                    ? '#FEE2E2'
                                                                    : '#F3F4F6',
                                                            color: record.status === 'active'
                                                                ? '#15803D'
                                                                : record.status === 'revoked'
                                                                    ? '#B91C1C'
                                                                    : '#4B5563',
                                                        }}>
                                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                                                {record.status === 'active' ? (
                                                                    <span style={{
                                                                        width: '6px', height: '6px', borderRadius: '50%', background: '#15803D',
                                                                        display: 'inline-block'
                                                                    }} />
                                                                ) : record.status === 'revoked' ? (
                                                                    <Ban size={10} />
                                                                ) : (
                                                                    <Clock size={10} />
                                                                )}
                                                                {record.status}
                                                            </span>
                                                        </span>
                                                    </div>

                                                    {/* Row 2: Details Grid */}
                                                    <div style={{
                                                        display: 'grid',
                                                        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                                                        gap: '16px',
                                                        padding: '14px 18px',
                                                        borderRadius: '10px',
                                                        background: '#F9FAFB',
                                                        border: '1px solid #E5E7EB',
                                                        marginTop: '12px'
                                                    }}>
                                                        {/* Recipient */}
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                            <span style={{ fontSize: '0.7rem', color: '#9CA3AF', textTransform: 'uppercase', fontWeight: '700', letterSpacing: '0.05em' }}>
                                                                Sent To
                                                            </span>
                                                            <span style={{
                                                                fontSize: '0.85rem',
                                                                color: '#111827',
                                                                fontWeight: '600',
                                                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                                                display: 'inline-flex',
                                                                alignItems: 'center',
                                                                gap: '6px'
                                                            }}>
                                                                {record.vendorEmail ? (
                                                                    <>
                                                                        <Mail size={13} style={{ color: '#4F46E5' }} />
                                                                        <span>{record.vendorEmail}</span>
                                                                    </>
                                                                ) : (
                                                                    <>
                                                                        <Globe size={13} style={{ color: '#6B7280' }} />
                                                                        <span>Anyone with link</span>
                                                                    </>
                                                                )}
                                                            </span>
                                                        </div>

                                                        {/* Files */}
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                            <span style={{ fontSize: '0.7rem', color: '#9CA3AF', textTransform: 'uppercase', fontWeight: '700', letterSpacing: '0.05em' }}>
                                                                Files
                                                            </span>
                                                            <div>
                                                                {record.fileCount > 0 ? (
                                                                    <span style={{
                                                                        fontSize: '0.75rem', color: '#7C3AED', fontWeight: '600',
                                                                        padding: '2px 8px', borderRadius: '12px',
                                                                        background: '#F5F3FF', border: '1px solid #E9D5FF',
                                                                        display: 'inline-flex', alignItems: 'center', gap: '4px'
                                                                    }}>
                                                                        <Paperclip size={12} /> {record.fileCount} file{record.fileCount > 1 ? 's' : ''} Included
                                                                    </span>
                                                                ) : (
                                                                    <span style={{ fontSize: '0.85rem', fontWeight: '600', color: '#9CA3AF' }}>— No files</span>
                                                                )}
                                                            </div>
                                                        </div>

                                                        {/* Expired At */}
                                                        {record.expiredAt && (
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                                <span style={{ fontSize: '0.7rem', color: '#9CA3AF', textTransform: 'uppercase', fontWeight: '700', letterSpacing: '0.05em' }}>
                                                                    {record.status === 'revoked' ? 'Revoked At' : 'Expired At'}
                                                                </span>
                                                                <span style={{ fontSize: '0.85rem', fontWeight: '600', color: '#4B5563', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                                                    <Clock size={12} style={{ color: '#9CA3AF' }} /> {formatDate(record.expiredAt)}
                                                                </span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Links List */}
                        {activeTab === 'links' && (
                            <div style={{ background: 'transparent', border: 'none', padding: 0 }}>
                                {isLoading ? (
                                    <div style={{ textAlign: 'center', padding: '48px' }}>
                                        <div className="button-spinner" style={{ width: '32px', height: '32px', margin: '0 auto 12px' }}></div>
                                        <p style={{ color: 'var(--color-text-secondary)' }}>Loading your links...</p>
                                    </div>
                                ) : links.length === 0 ? (
                                    <div className="app-form-card" style={{ textAlign: 'center', padding: '48px' }}>
                                        <div style={{ fontSize: '3rem', marginBottom: '16px' }}>
                                            <Link2 size={48} style={{ margin: '0 auto' }} />
                                        </div>
                                        <p style={{ color: 'var(--text-secondary)', marginBottom: '16px' }}>
                                            You haven't created any secure links yet.
                                        </p>
                                        <Link href="/create-link" className="btn btn-primary">
                                            Create Your First Link
                                        </Link>
                                    </div>

                                ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                        {links.map((link) => (
                                            <div key={link.id} className="premium-link-card">
                                                {/* Top Row: Avatar Circle, Vendor info, Status badges */}
                                                <div className="card-header-flex">
                                                    <div className="recipient-avatar-group">
                                                        <div className={`recipient-avatar-circle ${link.allowedVendorEmail ? 'vendor' : ''}`}>
                                                            {link.allowedVendorEmail ? <User size={20} /> : <Globe size={20} />}
                                                        </div>
                                                        <div className="recipient-info">
                                                            <span className="recipient-subtitle">
                                                                {link.allowedVendorEmail ? 'Sent To Vendor' : (link.vendorAccess && link.vendorAccess.length > 0) ? 'Sent To Group' : 'Public Access'}
                                                            </span>
                                                            <span className="recipient-title" title={link.allowedVendorEmail || 'Public Link'}>
                                                                {link.allowedVendorEmail || ((link.vendorAccess && link.vendorAccess.length > 0) ? `${link.vendorAccess.length} Vendors (Group)` : 'Anyone with the link')}
                                                            </span>
                                                        </div>
                                                    </div>

                                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                            {getStatusBadge(link.status)}
                                                            {link.status === 'active' && getTimeRemaining(link.expiresAt) && (
                                                                <span style={{
                                                                    fontSize: '0.72rem', color: '#d97706', fontWeight: '600',
                                                                    padding: '2px 8px', borderRadius: '6px',
                                                                    background: '#fef3c7', border: '1px solid #fde68a',
                                                                    display: 'inline-flex', alignItems: 'center', gap: '4px'
                                                                }}>
                                                                    <Clock size={10} />
                                                                    <span>{getTimeRemaining(link.expiresAt)}</span>
                                                                </span>
                                                            )}
                                                            {link.lockedAt && (
                                                                <span style={{
                                                                    fontSize: '0.72rem', color: '#dc2626', fontWeight: '600',
                                                                    padding: '2px 8px', borderRadius: '6px',
                                                                    background: '#fef2f2', border: '1px solid #fca5a5',
                                                                    display: 'inline-flex', alignItems: 'center', gap: '4px'
                                                                }}>
                                                                    <Lock size={10} /> LOCKED
                                                                </span>
                                                            )}
                                                        </div>
                                                        <span style={{ fontSize: '0.72rem', color: '#9CA3AF', fontWeight: '500' }}>
                                                            {formatDate(link.createdAt)}
                                                        </span>
                                                    </div>
                                                </div>

                                                <p className="premium-url-sent">
                                                    Link and OTP sent to the vendor
                                                    {link.allowedVendorEmail ? ` (${link.allowedVendorEmail})` : ''}.
                                                </p>

                                                {/* Properties Detail Grid */}
                                                <div style={{
                                                    display: 'grid',
                                                    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                                                    gap: '16px',
                                                    background: '#F9FAFB',
                                                    border: '1px solid #E5E7EB',
                                                    borderRadius: '12px',
                                                    padding: '16px 20px',
                                                    marginBottom: '20px',
                                                    marginTop: '12px'
                                                }}>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                        <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '4px' }}><Clock size={12} /> Duration</span>
                                                        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#1F2937' }}>{getDuration(link.createdAt, link.expiresAt)}</span>
                                                    </div>

                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                        <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '4px' }}><Calendar size={12} /> {link.status === 'expired' ? 'Expired' : 'Expires'}</span>
                                                        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#1F2937' }}>{formatDate(link.expiresAt)}</span>
                                                    </div>

                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                        <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '4px' }}><FileText size={12} /> Title</span>
                                                        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#1F2937', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={link.purpose || 'None'}>
                                                            {link.purpose || 'None'}
                                                        </span>
                                                    </div>

                                                    {link.fileCount > 0 && (
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '4px' }}><Paperclip size={12} /> Files</span>
                                                            <div>
                                                                <span style={{
                                                                    fontSize: '0.75rem', color: '#7C3AED', fontWeight: '600',
                                                                    padding: '2px 8px', borderRadius: '12px',
                                                                    background: '#F5F3FF', border: '1px solid #E9D5FF',
                                                                    display: 'inline-flex', alignItems: 'center', gap: '4px'
                                                                }}>
                                                                    {link.fileCount} file{link.fileCount > 1 ? 's' : ''} Included
                                                                </span>
                                                            </div>
                                                        </div>
                                                    )}

                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                        <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '4px' }}><Check size={12} /> OTP Verification</span>
                                                        <span style={{
                                                            fontSize: '0.85rem', fontWeight: 600,
                                                            color: link.otpVerifiedAt ? '#16A34A' : '#D97706'
                                                        }}>
                                                            {link.otpVerifiedAt ? `Verified (${formatDate(link.otpVerifiedAt)})` : 'Pending'}
                                                        </span>
                                                    </div>

                                                    {link.failedAttempts > 0 && (
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#DC2626', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '4px' }}><AlertTriangle size={12} /> Failed Attempts</span>
                                                            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#DC2626' }}>{link.failedAttempts} attempts</span>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Details Box */}
                                                {link.purposeDetail && (
                                                    <div style={{
                                                        fontSize: '0.82rem', color: '#4B5563', marginBottom: '18px',
                                                        background: '#F9FAFB', border: '1px solid #E5E7EB',
                                                        borderRadius: '8px', padding: '10px 14px',
                                                        display: 'flex', alignItems: 'flex-start', gap: '8px',
                                                        lineHeight: 1.5, marginTop: '12px'
                                                    }}>
                                                        <FileText size={14} style={{ color: '#9CA3AF', marginTop: '3px', flexShrink: 0 }} />
                                                        <div>
                                                            <span style={{ fontWeight: 700, color: '#4B5563', display: 'block', marginBottom: '2px', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Details Description</span>
                                                            <span>{link.purposeDetail}</span>
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Actions Footer */}
                                                <div className="premium-card-footer">
                                                    <div className="premium-actions-left">
                                                                                         <Link
                                                             href={`/revoke/${link.ownerToken!}`}
                                                             className="premium-btn-action secondary"
                                                             style={{ textDecoration: 'none' }}
                                                         >
                                                             <Settings size={14} /> Manage
                                                         </Link>

                                                        {/* Inline actions for Active Links */}
                                                        {link.status === 'active' && (
                                                            <>
                                                                <button
                                                                    onClick={() => setLiveActivityLink({ token: link.token, topic: link.purpose || 'Shared Document' })}
                                                                    className="premium-btn-action success-outline"
                                                                >
                                                                    <span style={{
                                                                        width: '6px', height: '6px', borderRadius: '50%', background: '#16a34a',
                                                                        display: 'inline-block', animation: 'pulse 2s infinite',
                                                                    }} />
                                                                    <span>Live Activity</span>
                                                                </button>

                                                                {confirmRevokeId === link.id ? (
                                                                    <div style={{
                                                                        display: 'flex', alignItems: 'center', gap: '6px',
                                                                        padding: '6px 12px', borderRadius: '10px',
                                                                        background: '#fef2f2', border: '1px solid #fca5a5',
                                                                    }}>
                                                                        <span style={{ fontSize: '0.75rem', color: '#dc2626', fontWeight: 600 }}>Revoke?</span>
                                                                        <button
                                                                            onClick={() => handleRevoke(link)}
                                                                            disabled={revokingId === link.id}
                                                                            style={{
                                                                                padding: '4px 10px', borderRadius: '6px', fontSize: '0.72rem',
                                                                                fontWeight: '700', border: 'none', cursor: 'pointer',
                                                                                background: '#dc2626', color: '#fff',
                                                                                opacity: revokingId === link.id ? 0.6 : 1,
                                                                            }}
                                                                        >
                                                                            {revokingId === link.id ? 'Revoking...' : 'Yes'}
                                                                        </button>
                                                                        <button
                                                                            onClick={() => setConfirmRevokeId(null)}
                                                                            style={{
                                                                                padding: '4px 10px', borderRadius: '6px', fontSize: '0.72rem',
                                                                                fontWeight: '700', border: '1px solid #d1d5db',
                                                                                cursor: 'pointer', background: '#fff', color: '#4b5563',
                                                                            }}
                                                                        >
                                                                            No
                                                                        </button>
                                                                    </div>
                                                                ) : (
                                                                    <button
                                                                        onClick={() => setConfirmRevokeId(link.id)}
                                                                        className="premium-btn-action danger-outline"
                                                                    >
                                                                        <Lock size={14} /> Revoke Access
                                                                    </button>
                                                                )}
                                                            </>
                                                        )}
                                                    </div>

                                                    {/* Expand/Collapse for details */}
                                                    <button
                                                        className="premium-expand-btn"
                                                        onClick={() => void handleExpand(link.id)}
                                                    >
                                                        <span>Details</span>
                                                        {expandedId === link.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                                    </button>
                                                </div>

                                                {/* Expanded Details Panel */}
                                                {expandedId === link.id && (
                                                    <div className="expanded-details-container" style={{ padding: '16px 20px', background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '12px', marginTop: '12px' }}>
                                                        {/* Link Settings Summary Banner */}
                                                        <div style={{
                                                            display: 'flex',
                                                            flexDirection: 'column',
                                                            gap: '10px',
                                                            background: '#F9FAFB',
                                                            border: '1px solid #E5E7EB',
                                                            borderRadius: '10px',
                                                            padding: '12px 16px',
                                                            marginBottom: '16px',
                                                            fontSize: '0.8rem',
                                                            lineHeight: 1.4,
                                                            color: '#4B5563'
                                                        }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                                <Calendar size={13} style={{ color: '#9CA3AF' }} />
                                                                <span><strong>Created On:</strong> {formatDate(link.createdAt)}</span>
                                                            </div>
                                                            {link.notificationEmail && (
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                                    <Mail size={13} style={{ color: '#9CA3AF' }} />
                                                                    <span><strong>Notification Alert Email:</strong> {link.notificationEmail}</span>
                                                                </div>
                                                            )}
                                                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', borderTop: '1px solid #E5E7EB', paddingTop: '8px', marginTop: '4px' }}>
                                                                <Lock size={13} style={{ color: '#9CA3AF', marginTop: '2px', flexShrink: 0 }} />
                                                                <span>
                                                                    <strong style={{ color: '#374151' }}>OTP Security Policy:</strong> OTPs are hashed and delivered only by email at link creation. They are not stored in the database for security compliance.
                                                                </span>
                                                            </div>
                                                        </div>

                                                        {detailsLoadingId === link.id && (
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#6B7280', fontSize: '0.85rem', marginBottom: '12px' }}>
                                                                <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                                                                Loading files &amp; activity…
                                                            </div>
                                                        )}

                                                        {/* Files Section */}
                                                        {link.files.length > 0 && (
                                                            <div style={{ marginBottom: '16px', borderTop: '1px solid #E5E7EB', paddingTop: '16px' }}>
                                                                <h4 style={{
                                                                    fontSize: '0.82rem', fontWeight: '700', color: '#111827',
                                                                    marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px',
                                                                }}>
                                                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                                                        <Paperclip size={14} /> Attached Files ({link.files.length})
                                                                    </span>
                                                                </h4>
                                                                <div style={{
                                                                    display: 'flex', flexDirection: 'column', gap: '6px',
                                                                    background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '10px',
                                                                    padding: '12px 16px',
                                                                }}>
                                                                    {link.files.map((file, i) => (
                                                                        <div key={i} style={{
                                                                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                                                            fontSize: '0.8rem', padding: '6px 0',
                                                                            borderBottom: i < link.files.length - 1 ? '1px solid #F3F4F6' : 'none',
                                                                        }}>
                                                                            <span style={{ color: '#111827', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                                <span style={{ opacity: 0.8, display: 'flex', alignItems: 'center' }}>
                                                                                    {file.fileType.includes('image') ? <FileImage size={14} />
                                                                                        : file.fileType.includes('pdf') ? <FileText size={14} />
                                                                                            : file.fileType.includes('sheet') || file.fileType.includes('csv') || file.fileType.includes('excel') ? <FileSpreadsheet size={14} />
                                                                                                : <Folder size={14} />}
                                                                                </span>
                                                                                {file.fileName}
                                                                            </span>
                                                                            <span style={{ color: '#6B7280', fontSize: '0.72rem' }}>
                                                                                {formatFileSize(file.fileSize)}
                                                                            </span>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}

                                                        {/* Audit Log Section */}
                                                        {link.auditLogs.length > 0 && (
                                                            <div style={{ borderTop: '1px solid #E5E7EB', paddingTop: '16px' }}>
                                                                <h4 style={{
                                                                    fontSize: '0.82rem', fontWeight: '700', color: '#111827',
                                                                    marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px',
                                                                }}>
                                                                    <History size={14} /> Activity Log
                                                                </h4>
                                                                <div style={{
                                                                    background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: '10px',
                                                                    padding: '12px 16px',
                                                                }}>
                                                                    {link.auditLogs.map((log, i) => (
                                                                        <div key={i} style={{
                                                                            display: 'flex', alignItems: 'center', gap: '10px',
                                                                            fontSize: '0.8rem', padding: '8px 0',
                                                                            borderBottom: i < link.auditLogs.length - 1 ? '1px solid #F3F4F6' : 'none',
                                                                        }}>
                                                                            <span style={{ display: 'flex', alignItems: 'center', width: '20px', justifyContent: 'center' }}>
                                                                                {getAuditIcon(log.action)}
                                                                            </span>
                                                                            <span style={{
                                                                                fontWeight: '700', fontSize: '0.72rem',
                                                                                padding: '3px 8px', borderRadius: '6px',
                                                                                background: '#F3F4F6',
                                                                                color: '#4B5563',
                                                                                minWidth: '85px', textAlign: 'center',
                                                                            }}>
                                                                                {log.action}
                                                                            </span>
                                                                            <span style={{ color: '#4B5563', flex: 1, wordBreak: 'break-word' }}>
                                                                                {log.reason || '—'}
                                                                            </span>
                                                                            <span style={{ color: '#9CA3AF', fontSize: '0.72rem', flexShrink: 0 }}>
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
                        )}
                    </div>
                </div>
            </section>

            {liveActivityLink && (
                <LiveActivityModal
                    token={liveActivityLink.token}
                    topic={liveActivityLink.topic}
                    onClose={() => setLiveActivityLink(null)}
                />
            )}
        </main>
    );
}
