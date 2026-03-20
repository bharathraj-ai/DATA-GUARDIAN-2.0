'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { setUserRole } from '@/actions/set-role';
import Image from 'next/image';

export default function RoleSelectPage() {
    const router = useRouter();
    const { data: session, status: sessionStatus, update } = useSession();
    const [isLoading, setIsLoading] = useState(false);
    const [selected, setSelected] = useState<'OWNER' | 'VENDOR' | null>(null);
    const [error, setError] = useState('');

    // Redirect unauthenticated users
    useEffect(() => {
        if (sessionStatus === 'unauthenticated') {
            router.push('/auth/signin');
        }
    }, [sessionStatus, router]);

    // If user already selected a role, redirect them
    useEffect(() => {
        if (sessionStatus === 'authenticated' && (session?.user as any)?.roleSelected) {
            const role = (session?.user as any)?.role;
            router.push(role === 'OWNER' ? '/dashboard' : '/dashboard/vendor');
        }
    }, [sessionStatus, session, router]);

    const handleRoleSelect = async (role: 'OWNER' | 'VENDOR') => {
        setIsLoading(true);
        setError('');
        setSelected(role);

        try {
            const result = await setUserRole(role);

            if (result.success) {
                // Refresh the session to pick up the new role
                await update();
                // Redirect to appropriate dashboard
                router.push(role === 'OWNER' ? '/dashboard' : '/dashboard/vendor');
            } else {
                setError(result.error || 'Failed to set role');
                setSelected(null);
            }
        } catch (err) {
            setError('Something went wrong. Please try again.');
            setSelected(null);
        } finally {
            setIsLoading(false);
        }
    };

    if (sessionStatus === 'loading') {
        return (
            <main className="app-page">
                <section className="app-section">
                    <div className="container">
                        <div className="app-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
                            <div style={{ textAlign: 'center' }}>
                                <div className="button-spinner" style={{ width: '48px', height: '48px', margin: '0 auto 16px' }}></div>
                                <p style={{ color: 'var(--color-text-secondary)' }}>Loading...</p>
                            </div>
                        </div>
                    </div>
                </section>
            </main>
        );
    }

    return (
        <main className="app-page">
            <section className="app-section">
                <div className="container">
                    <div className="app-container" style={{ maxWidth: '640px' }}>
                        {/* Header */}
                        <div className="app-header">
                            <div className="brand-badge" style={{ marginBottom: '24px', justifyContent: 'center' }}>
                                <Image src="/logo.svg" alt="Secure Protocol" width={32} height={32} style={{ opacity: 0.9 }}/>
                                <span style={{ fontSize: '1.5rem', fontWeight: 600 }}>Secure Protocol</span>
                            </div>
                            <h1 className="app-page-title">
                                Choose Your <span className="gradient-text">Role</span>
                            </h1>
                            <p className="app-page-subtitle">
                                Welcome{session?.user?.name ? `, ${session.user.name}` : ''}! Select how you&apos;ll use Secure Protocol.
                            </p>
                        </div>

                        {/* Error */}
                        {error && (
                            <div className="status-message status-error" style={{ marginBottom: '24px' }}>
                                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                </svg>
                                <span>{error}</span>
                            </div>
                        )}

                        {/* Role Cards */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '32px' }}>
                            {/* Owner Card */}
                            <button
                                onClick={() => handleRoleSelect('OWNER')}
                                disabled={isLoading}
                                style={{
                                    background: selected === 'OWNER'
                                        ? 'linear-gradient(135deg, rgba(139,92,246,0.2), rgba(168,85,247,0.15))'
                                        : 'rgba(255,255,255,0.03)',
                                    border: selected === 'OWNER'
                                        ? '2px solid rgba(139,92,246,0.6)'
                                        : '2px solid rgba(255,255,255,0.08)',
                                    borderRadius: '16px',
                                    padding: '32px 24px',
                                    cursor: isLoading ? 'wait' : 'pointer',
                                    transition: 'all 0.3s ease',
                                    textAlign: 'center' as const,
                                    color: 'inherit',
                                    display: 'flex',
                                    flexDirection: 'column' as const,
                                    alignItems: 'center',
                                    gap: '16px',
                                    opacity: isLoading && selected !== 'OWNER' ? 0.5 : 1,
                                }}
                            >
                                <div style={{
                                    width: '64px',
                                    height: '64px',
                                    borderRadius: '16px',
                                    background: 'linear-gradient(135deg, rgba(139,92,246,0.2), rgba(168,85,247,0.1))',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                }}>
                                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                                    </svg>
                                </div>
                                <div>
                                    <h3 style={{
                                        fontSize: '1.25rem',
                                        fontWeight: '700',
                                        color: 'var(--color-text)',
                                        marginBottom: '8px',
                                    }}>Owner</h3>
                                    <p style={{
                                        fontSize: '0.875rem',
                                        color: 'var(--color-text-secondary)',
                                        lineHeight: '1.5',
                                    }}>
                                        Create &amp; share encrypted secure links. Control access with OTP, time limits, and kill switches.
                                    </p>
                                </div>
                                {isLoading && selected === 'OWNER' && (
                                    <div className="button-spinner" style={{ width: '24px', height: '24px' }}></div>
                                )}
                            </button>

                            {/* Vendor Card */}
                            <button
                                onClick={() => handleRoleSelect('VENDOR')}
                                disabled={isLoading}
                                style={{
                                    background: selected === 'VENDOR'
                                        ? 'linear-gradient(135deg, rgba(20,184,166,0.2), rgba(13,148,136,0.15))'
                                        : 'rgba(255,255,255,0.03)',
                                    border: selected === 'VENDOR'
                                        ? '2px solid rgba(20,184,166,0.6)'
                                        : '2px solid rgba(255,255,255,0.08)',
                                    borderRadius: '16px',
                                    padding: '32px 24px',
                                    cursor: isLoading ? 'wait' : 'pointer',
                                    transition: 'all 0.3s ease',
                                    textAlign: 'center' as const,
                                    color: 'inherit',
                                    display: 'flex',
                                    flexDirection: 'column' as const,
                                    alignItems: 'center',
                                    gap: '16px',
                                    opacity: isLoading && selected !== 'VENDOR' ? 0.5 : 1,
                                }}
                            >
                                <div style={{
                                    width: '64px',
                                    height: '64px',
                                    borderRadius: '16px',
                                    background: 'linear-gradient(135deg, rgba(20,184,166,0.2), rgba(13,148,136,0.1))',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                }}>
                                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#14b8a6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                                        <circle cx="12" cy="7" r="4"></circle>
                                    </svg>
                                </div>
                                <div>
                                    <h3 style={{
                                        fontSize: '1.25rem',
                                        fontWeight: '700',
                                        color: 'var(--color-text)',
                                        marginBottom: '8px',
                                    }}>Vendor</h3>
                                    <p style={{
                                        fontSize: '0.875rem',
                                        color: 'var(--color-text-secondary)',
                                        lineHeight: '1.5',
                                    }}>
                                        View shared data securely. Verify your identity with OTP to access encrypted information.
                                    </p>
                                </div>
                                {isLoading && selected === 'VENDOR' && (
                                    <div className="button-spinner" style={{ width: '24px', height: '24px' }}></div>
                                )}
                            </button>
                        </div>

                        {/* Info */}
                        <div className="app-form-card" style={{ padding: '20px 24px' }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2" style={{ flexShrink: 0, marginTop: '2px' }}>
                                    <circle cx="12" cy="12" r="10"></circle>
                                    <line x1="12" y1="16" x2="12" y2="12"></line>
                                    <line x1="12" y1="8" x2="12.01" y2="8"></line>
                                </svg>
                                <div>
                                    <p style={{ color: 'var(--color-text)', fontWeight: '500', marginBottom: '4px', fontSize: '0.9rem' }}>
                                        This choice is permanent
                                    </p>
                                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.8rem', lineHeight: '1.5' }}>
                                        Your role determines what features you can access. Owners create secure links, Vendors view shared data.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        </main>
    );
}
