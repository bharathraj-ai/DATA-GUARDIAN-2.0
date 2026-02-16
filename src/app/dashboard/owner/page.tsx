'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { getOwnedLinks, DashboardLink } from '@/actions/dashboard';

export default function OwnerDashboardPage() {
    const router = useRouter();
    const { data: session, status: sessionStatus } = useSession();
    const [links, setLinks] = useState<DashboardLink[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [filter, setFilter] = useState<'all' | 'active' | 'expired' | 'revoked' | 'used'>('all');

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

    const getStatusBadge = (status: string) => {
        const styles: Record<string, { bg: string; color: string; icon: string }> = {
            active: { bg: 'rgba(34, 197, 94, 0.15)', color: '#22c55e', icon: '🟢' },
            expired: { bg: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', icon: '🔴' },
            revoked: { bg: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', icon: '⛔' },
            used: { bg: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6', icon: '✅' },
        };
        const s = styles[status] || styles.expired;
        return (
            <span style={{
                padding: '4px 12px', borderRadius: '12px', fontSize: '0.75rem',
                fontWeight: '600', textTransform: 'uppercase', background: s.bg, color: s.color,
                display: 'inline-flex', alignItems: 'center', gap: '4px',
            }}>
                <span>{s.icon}</span> {status}
            </span>
        );
    };

    const handleCopy = (token: string, id: string) => {
        const url = `${window.location.origin}/share/${token}`;
        navigator.clipboard.writeText(url);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
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
            <section className="signup-section">
                <div className="container">
                    <div className="signup-container" style={{ maxWidth: '960px' }}>
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
                                { label: 'Active', value: counts.active, color: '#22c55e' },
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

                            {/* Filter Buttons */}
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
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                    {filteredLinks.map((link) => (
                                        <div
                                            key={link.id}
                                            style={{
                                                padding: '20px', borderRadius: '12px',
                                                background: 'rgba(255,255,255,0.02)',
                                                border: '1px solid rgba(255,255,255,0.06)',
                                                transition: 'all 0.2s ease',
                                            }}
                                            onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)')}
                                            onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)')}
                                        >
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                                                <div>
                                                    <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '4px' }}>
                                                        Created {formatDate(link.createdAt)}
                                                    </p>
                                                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                                                        Expires: {formatDate(link.expiresAt)}
                                                    </p>
                                                </div>
                                                {getStatusBadge(link.status)}
                                            </div>

                                            {link.allowedVendorEmail && (
                                                <div style={{
                                                    display: 'flex', alignItems: 'center', gap: '8px',
                                                    padding: '8px 12px', borderRadius: '8px',
                                                    background: 'rgba(14, 165, 233, 0.08)',
                                                    marginBottom: '12px', fontSize: '0.85rem',
                                                }}>
                                                    <span>📧</span>
                                                    <span style={{ color: 'var(--text-secondary)' }}>
                                                        Shared with: <strong style={{ color: 'var(--primary-blue)' }}>{link.allowedVendorEmail}</strong>
                                                    </span>
                                                </div>
                                            )}

                                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                                <Link
                                                    href={`/revoke/${link.ownerToken}`}
                                                    className="btn btn-secondary btn-sm"
                                                    style={{ fontSize: '0.75rem' }}
                                                >
                                                    ⚙️ Manage
                                                </Link>
                                                <button
                                                    onClick={() => handleCopy(link.token, link.id)}
                                                    className="btn btn-secondary btn-sm"
                                                    style={{ fontSize: '0.75rem' }}
                                                >
                                                    {copiedId === link.id ? '✅ Copied!' : '📋 Copy Link'}
                                                </button>
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
