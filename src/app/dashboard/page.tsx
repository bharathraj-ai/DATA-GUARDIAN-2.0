'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useEffect } from 'react';

export default function DashboardPage() {
    const router = useRouter();
    const { data: session, status: sessionStatus } = useSession();

    // Redirect to sign-in if not authenticated
    useEffect(() => {
        if (sessionStatus === 'unauthenticated') {
            router.push('/auth/signin?callbackUrl=/dashboard');
        }
    }, [sessionStatus, router]);

    if (sessionStatus === 'loading' || sessionStatus === 'unauthenticated') {
        return (
            <main className="signup-page">
                <section className="signup-section">
                    <div className="container">
                        <div className="signup-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
                            <div style={{ textAlign: 'center' }}>
                                <div className="button-spinner" style={{ width: '48px', height: '48px', margin: '0 auto 16px' }}></div>
                                <p style={{ color: 'var(--text-secondary)' }}>
                                    {sessionStatus === 'loading' ? 'Loading...' : 'Redirecting to sign in...'}
                                </p>
                            </div>
                        </div>
                    </div>
                </section>
            </main>
        );
    }

    return (
        <main className="signup-page">
            <section className="signup-section">
                <div className="container">
                    <div className="signup-container" style={{ maxWidth: '700px' }}>
                        {/* Header */}
                        <div className="signup-header" style={{ textAlign: 'center', marginBottom: '40px' }}>
                            <h1 className="signup-page-title">
                                Welcome, <span className="gradient-text">{session?.user?.name?.split(' ')[0] || 'User'}</span>
                            </h1>
                            <p className="signup-page-subtitle">
                                Choose your dashboard view
                            </p>
                        </div>

                        {/* Dashboard Cards */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px' }}>
                            {/* Owner Card */}
                            <Link href="/dashboard/owner" style={{ textDecoration: 'none' }}>
                                <div style={{
                                    padding: '32px 24px', borderRadius: '16px',
                                    background: 'rgba(255,255,255,0.03)',
                                    border: '1px solid rgba(255,255,255,0.08)',
                                    cursor: 'pointer', transition: 'all 0.3s ease',
                                    textAlign: 'center',
                                }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.borderColor = 'var(--primary-blue)';
                                        e.currentTarget.style.transform = 'translateY(-4px)';
                                        e.currentTarget.style.boxShadow = '0 8px 30px rgba(14, 165, 233, 0.15)';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
                                        e.currentTarget.style.transform = 'translateY(0)';
                                        e.currentTarget.style.boxShadow = 'none';
                                    }}>
                                    <div style={{
                                        width: '64px', height: '64px', borderRadius: '16px',
                                        background: 'linear-gradient(135deg, var(--primary-blue), var(--accent-purple))',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontSize: '2rem', margin: '0 auto 20px',
                                    }}>
                                        🛡️
                                    </div>
                                    <h2 style={{ color: 'var(--text-primary)', fontSize: '1.25rem', fontWeight: '600', marginBottom: '8px' }}>
                                        Owner Dashboard
                                    </h2>
                                    <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', lineHeight: '1.5' }}>
                                        Create & manage secure links. Track who accessed your data, revoke access, view analytics.
                                    </p>
                                    <div style={{
                                        marginTop: '20px', padding: '8px 20px', borderRadius: '8px',
                                        background: 'rgba(14, 165, 233, 0.1)', color: 'var(--primary-blue)',
                                        fontSize: '0.85rem', fontWeight: '500', display: 'inline-block',
                                    }}>
                                        Open →
                                    </div>
                                </div>
                            </Link>

                            {/* Vendor Card */}
                            <Link href="/dashboard/vendor" style={{ textDecoration: 'none' }}>
                                <div style={{
                                    padding: '32px 24px', borderRadius: '16px',
                                    background: 'rgba(255,255,255,0.03)',
                                    border: '1px solid rgba(255,255,255,0.08)',
                                    cursor: 'pointer', transition: 'all 0.3s ease',
                                    textAlign: 'center',
                                }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.borderColor = 'var(--accent-cyan)';
                                        e.currentTarget.style.transform = 'translateY(-4px)';
                                        e.currentTarget.style.boxShadow = '0 8px 30px rgba(6, 182, 212, 0.15)';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
                                        e.currentTarget.style.transform = 'translateY(0)';
                                        e.currentTarget.style.boxShadow = 'none';
                                    }}>
                                    <div style={{
                                        width: '64px', height: '64px', borderRadius: '16px',
                                        background: 'linear-gradient(135deg, var(--accent-cyan), var(--success))',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontSize: '2rem', margin: '0 auto 20px',
                                    }}>
                                        📨
                                    </div>
                                    <h2 style={{ color: 'var(--text-primary)', fontSize: '1.25rem', fontWeight: '600', marginBottom: '8px' }}>
                                        Vendor Dashboard
                                    </h2>
                                    <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', lineHeight: '1.5' }}>
                                        View secure links shared with you. Access data securely with OTP verification.
                                    </p>
                                    <div style={{
                                        marginTop: '20px', padding: '8px 20px', borderRadius: '8px',
                                        background: 'rgba(6, 182, 212, 0.1)', color: 'var(--accent-cyan)',
                                        fontSize: '0.85rem', fontWeight: '500', display: 'inline-block',
                                    }}>
                                        Open →
                                    </div>
                                </div>
                            </Link>
                        </div>

                        {/* Quick Action */}
                        <div style={{ textAlign: 'center', marginTop: '32px' }}>
                            <Link href="/signup" className="btn btn-primary">
                                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                                </svg>
                                <span>Create New Secure Link</span>
                            </Link>
                        </div>

                        {/* User Info */}
                        <div style={{
                            marginTop: '32px', padding: '16px', borderRadius: '12px',
                            background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
                            display: 'flex', alignItems: 'center', gap: '12px',
                        }}>
                            {session?.user?.image && (
                                <img
                                    src={session.user.image}
                                    alt=""
                                    style={{ width: '40px', height: '40px', borderRadius: '50%' }}
                                />
                            )}
                            <div>
                                <p style={{ color: 'var(--text-primary)', fontWeight: '500', fontSize: '0.9rem' }}>
                                    {session?.user?.name}
                                </p>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                                    {session?.user?.email}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        </main>
    );
}
