'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { getReceivedLinks, DashboardLink } from '@/actions/dashboard';

interface Props {
    initialLinks: DashboardLink[];
    initialEmail: string;
}

export default function VendorDashboardClient({ initialLinks, initialEmail }: Props) {
    const router = useRouter();
    const { data: session, status: sessionStatus } = useSession();
    const [links, setLinks] = useState<DashboardLink[]>(initialLinks);
    const [isLoading, setIsLoading] = useState(false);
    const [filter, setFilter] = useState<'all' | 'active' | 'expired' | 'revoked' | 'used' | 'break'>('all');

    // Redirect to sign-in if not authenticated
    useEffect(() => {
        if (sessionStatus === 'unauthenticated') {
            router.push('/auth/signin?callbackUrl=/dashboard/vendor');
        }
    }, [sessionStatus, router]);

    // Soft refresh + light polling (initial data already server-prefetched)
    useEffect(() => {
        async function fetchLinks() {
            const target = session?.user?.email || initialEmail;
            if (!target) return;
            try {
                const received = await getReceivedLinks(target);
                setLinks(received);
            } catch (error) {
                console.error('Error fetching links:', error);
            }
        }
        if (sessionStatus === 'authenticated' || initialEmail) {
            // Skip immediate refetch — data came from the server page
            const interval = setInterval(fetchLinks, 30000);
            return () => clearInterval(interval);
        }
    }, [session?.user?.email, sessionStatus, initialEmail]);

    if (sessionStatus === 'unauthenticated') {
        return (
            <main className="app-page" style={{ background: '#FFFFFF', animation: 'none', minHeight: '100vh' }}>
                <section className="app-section">
                    <div className="container">
                        <div className="app-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
                            <div style={{ textAlign: 'center' }}>
                                <div className="button-spinner" style={{ width: '48px', height: '48px', margin: '0 auto 16px' }}></div>
                                <p style={{ color: '#64748B' }}>Redirecting to sign in...</p>
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

    const getStatusBadge = (status: string) => {
        const styles: Record<string, { bg: string; color: string; label: string }> = {
            active: { bg: 'rgba(34, 197, 94, 0.15)', color: '#22c55e', label: '🟢 Ready to View' },
            expired: { bg: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', label: '🔴 Expired' },
            revoked: { bg: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', label: '⛔ Revoked' },
            used: { bg: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6', label: '✅ Viewed' },
            break: { bg: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', label: '⏸️ On Break' },
        };
        const s = styles[status] || styles.expired;
        return (
            <span style={{
                padding: '4px 12px', borderRadius: '12px', fontSize: '0.75rem',
                fontWeight: '600', background: s.bg, color: s.color,
            }}>
                {s.label}
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
                        <div className="app-header">
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                                <div style={{
                                    width: '48px', height: '48px', borderRadius: '14px',
                                    background: 'linear-gradient(135deg, var(--accent-cyan), var(--success))',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem',
                                }}>
                                    📨
                                </div>
                                <div>
                                    <h1 className="app-page-title" style={{ marginBottom: '0' }}>
                                        <span className="gradient-text">Vendor Dashboard</span>
                                    </h1>
                                    <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                                        {session?.user?.email} • Links shared with you
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
                                { label: 'Total Received', value: counts.all, color: 'var(--accent-cyan)' },
                                { label: 'Ready to View', value: counts.active, color: '#22c55e' },
                                { label: 'On Break', value: counts.break, color: '#f59e0b' },
                                { label: 'Viewed', value: counts.used, color: '#3b82f6' },
                                { label: 'Expired', value: counts.expired, color: '#ef4444' },
                            ].map((stat) => (
                                <div key={stat.label} style={{
                                    padding: '16px', borderRadius: '12px',
                                    background: '#FFFFFF', border: '1px solid #E2E8F0',
                                    textAlign: 'center',
                                }}>
                                    <p style={{ fontSize: '1.75rem', fontWeight: '700', color: stat.color }}>{stat.value}</p>
                                    <p style={{ fontSize: '0.75rem', color: '#64748B', marginTop: '4px' }}>{stat.label}</p>
                                </div>
                            ))}
                        </div>

                        {/* Filter */}
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '24px' }}>
                            {(['all', 'active', 'break', 'used', 'expired', 'revoked'] as const).map((f) => (
                                <button
                                    key={f}
                                    onClick={() => setFilter(f)}
                                    style={{
                                        padding: '6px 14px', borderRadius: '8px', fontSize: '0.75rem',
                                        fontWeight: '500', border: '1px solid #E2E8F0', cursor: 'pointer',
                                        background: filter === f ? 'var(--accent-cyan)' : '#F8FAFC',
                                        color: filter === f ? '#fff' : '#475569',
                                        transition: 'all 0.2s ease',
                                    }}
                                >
                                    {f.charAt(0).toUpperCase() + f.slice(1)} ({counts[f]})
                                </button>
                            ))}
                        </div>

                        {/* Links List */}
                        <div className="app-form-card">
                            {isLoading ? (
                                <div style={{ textAlign: 'center', padding: '48px' }}>
                                    <div className="button-spinner" style={{ width: '32px', height: '32px', margin: '0 auto 12px' }}></div>
                                    <p style={{ color: 'var(--color-text-secondary)' }}>Loading shared links...</p>
                                </div>
                            ) : filteredLinks.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '48px' }}>
                                    <div style={{ fontSize: '3rem', marginBottom: '16px' }}>📭</div>
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
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                    {filteredLinks.map((link) => (
                                        <div
                                            key={link.id}
                                            style={{
                                                padding: '20px', borderRadius: '12px',
                                                background: '#F8FAFC',
                                                border: link.status === 'active'
                                                    ? '1px solid rgba(34, 197, 94, 0.25)'
                                                    : '1px solid #E2E8F0',
                                                transition: 'all 0.2s ease',
                                            }}
                                            onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#CBD5E1')}
                                            onMouseLeave={(e) => (e.currentTarget.style.borderColor = link.status === 'active' ? 'rgba(34, 197, 94, 0.25)' : '#E2E8F0')}
                                        >
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                                                <div>
                                                    <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '4px' }}>
                                                        Received {formatDate(link.createdAt)}
                                                    </p>
                                                    {link.status === 'active' && (
                                                        <p style={{
                                                            color: '#22c55e', fontSize: '0.85rem', fontWeight: '500',
                                                        }}>
                                                            ⏱️ {getTimeRemaining(link.expiresAt)}
                                                        </p>
                                                    )}
                                                    {link.status !== 'active' && (
                                                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                                            Expired: {formatDate(link.expiresAt)}
                                                        </p>
                                                    )}
                                                </div>
                                                {getStatusBadge(link.status)}
                                            </div>

                                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                                {link.status === 'active' ? (
                                                    <Link
                                                        href={`/share/${link.token}`}
                                                        className="btn btn-primary btn-sm"
                                                        style={{ fontSize: '0.8rem' }}
                                                    >
                                                        🔓 View Secure Data
                                                    </Link>
                                                ) : link.status === 'break' ? (
                                                    <Link
                                                        href={`/share/${link.token}`}
                                                        className="btn btn-primary btn-sm"
                                                        style={{ fontSize: '0.8rem', background: '#f59e0b', color: '#fff', border: 'none' }}
                                                    >
                                                        ▶️ Resume Work
                                                    </Link>
                                                ) : link.status === 'used' ? (
                                                    <span style={{
                                                        padding: '6px 14px', borderRadius: '8px',
                                                        fontSize: '0.8rem', color: 'var(--text-muted)',
                                                        background: '#F1F5F9',
                                                    }}>
                                                        Data was accessed on {formatDate(link.expiresAt)}
                                                    </span>
                                                ) : (
                                                    <span style={{
                                                        padding: '6px 14px', borderRadius: '8px',
                                                        fontSize: '0.8rem', color: 'var(--text-muted)',
                                                        background: '#F1F5F9',
                                                    }}>
                                                        This link is no longer accessible
                                                    </span>
                                                )}
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
