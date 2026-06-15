'use client';

import { signIn, useSession } from 'next-auth/react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';

function SignInContent() {
    const router = useRouter();
    const { data: session, status: sessionStatus } = useSession();
    const searchParams = useSearchParams();
    // Ensure callbackUrl is a valid relative path to prevent OAuth errors
    const rawCallbackUrl = searchParams.get('callbackUrl');
    const callbackUrl = rawCallbackUrl && rawCallbackUrl.startsWith('/')
        ? rawCallbackUrl
        : '/auth/role-select';
    const error = searchParams.get('error');

    // If user is already signed in, redirect them away
    useEffect(() => {
        if (sessionStatus === 'authenticated') {
            const userRole = (session?.user as any)?.role;
            const roleSelected = (session?.user as any)?.roleSelected;

            if (!roleSelected) {
                // User hasn't selected a role yet
                router.push('/auth/role-select');
            } else if (rawCallbackUrl && rawCallbackUrl.startsWith('/')) {
                // Redirect to intended destination
                router.push(rawCallbackUrl);
            } else {
                // Redirect to dashboard (auto-routes by role)
                router.push('/dashboard');
            }
        }
    }, [sessionStatus, session, router, rawCallbackUrl]);

    if (sessionStatus === 'authenticated') {
        return (
            <main className="app-page">
                <section className="app-section">
                    <div className="container">
                        <div className="app-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
                            <div style={{ textAlign: 'center' }}>
                                <div className="button-spinner" style={{ width: '48px', height: '48px', margin: '0 auto 16px' }}></div>
                                <p style={{ color: 'var(--color-text-secondary)' }}>Completing sign in...</p>
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
                    <div className="app-container" style={{ maxWidth: '480px' }}>
                        {/* Header */}
                        <div className="app-header">
                            <div className="brand-badge" style={{ marginBottom: '24px', justifyContent: 'center', background: 'transparent' }}>
                                <Image src="/logo.jpg" alt="Secure Protocol" width={36} height={36} style={{ opacity: 0.9, borderRadius: '4px' }}/>
                                <span style={{ fontSize: '1.5rem', fontWeight: 600 }}>Secure Protocol</span>
                            </div>
                            <h1 className="app-page-title">
                                <span>Sign In</span>
                            </h1>
                            <p className="app-page-subtitle">
                                Use your Google account to continue
                            </p>
                        </div>

                        {/* Error Message */}
                        {error && (
                            <div className="status-message status-error" style={{ marginBottom: '24px' }}>
                                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                </svg>
                                <span>
                                    {error === 'AccessDenied'
                                        ? 'Access denied. Please use an authorized account.'
                                        : 'Authentication failed. Please try again.'}
                                </span>
                            </div>
                        )}

                        {/* Sign In Card */}
                        <div className="app-form-card">
                            {/* Google Sign In Button */}
                            <button
                                onClick={() => signIn('google', { callbackUrl })}
                                className="btn btn-google btn-full"
                                suppressHydrationWarning
                            >
                                <svg width="20" height="20" viewBox="0 0 24 24">
                                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                                </svg>
                                Continue with Google
                            </button>

                            {/* Security Notice */}
                            <div className="form-section" style={{ marginTop: '32px', paddingTop: '24px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#111111" strokeWidth="2" style={{ flexShrink: 0 }}>
                                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                                    </svg>
                                    <div>
                                        <p style={{ color: '#111111', fontWeight: '500', marginBottom: '4px' }}>Zero Trust Security</p>
                                        <p style={{ color: '#6B7280', fontSize: '0.875rem' }}>
                                            Your identity is verified server-side. We never store passwords.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="app-footer" style={{ marginTop: '24px' }}>
                            <Link href="/" className="btn btn-secondary">
                                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
                                </svg>
                                <span>Back to Home</span>
                            </Link>
                        </div>

                        <p style={{ textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.75rem', marginTop: '24px' }}>
                            By signing in, you agree to our security policies
                        </p>
                    </div>
                </div>
            </section>
        </main>
    );
}

export default function SignInPage() {
    return (
        <Suspense fallback={
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
        }>
            <SignInContent />
        </Suspense>
    );
}
