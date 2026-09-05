'use client';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense } from 'react';

function ErrorContent() {
    const searchParams = useSearchParams();
    const error = searchParams.get('error');

    const errorMessages: Record<string, { title: string; description: string }> = {
        Configuration: {
            title: 'Configuration Error',
            description: 'There is a problem with the server configuration. Please contact support.',
        },
        HostMismatch: {
            title: 'Open the app on port 3000',
            description:
                'Google sign-in is bound to http://localhost:3000, but this tab used a different port. Another local app was occupying 3000. Restart Secure Protocol, then sign in at http://localhost:3000.',
        },
        AccessDenied: {
            title: 'Access Denied',
            description: 'You do not have permission to access this resource. Use an authorized company account if SSO or a hosted domain is required.',
        },
        Verification: {
            title: 'Verification Error',
            description: 'The verification link may have expired or already been used.',
        },
        Default: {
            title: 'Authentication Error',
            description: 'An error occurred during authentication. Please try again.',
        },
    };

    const { title, description } = errorMessages[error || 'Default'] || errorMessages.Default;

    return (
        <main
            style={{
                minHeight: '100dvh',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '24px 16px',
                background: '#f4f7fb',
            }}
        >
            <div
                style={{
                    width: '100%',
                    maxWidth: 420,
                    padding: '36px 24px',
                    textAlign: 'center',
                    background: '#fff',
                    border: '1px solid #bae6fd',
                    borderRadius: 20,
                    boxShadow: '0 24px 48px rgba(2, 132, 199, 0.12)',
                }}
            >
                <div
                    style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 56,
                        height: 56,
                        borderRadius: '50%',
                        background: '#fef2f2',
                        border: '1px solid #fecaca',
                        marginBottom: 20,
                    }}
                    aria-hidden="true"
                >
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                </div>

                <h1 style={{ margin: '0 0 8px', fontSize: 'clamp(20px, 5vw, 26px)', fontWeight: 800, color: '#0f172a' }}>
                    {title}
                </h1>
                <p style={{ margin: '0 0 24px', color: '#64748b', lineHeight: 1.55 }}>{description}</p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <Link href="/auth/signin" className="btn btn-primary btn-full">
                        Try Again
                    </Link>
                    <Link href="/" className="btn btn-secondary btn-full">
                        Go Home
                    </Link>
                </div>
            </div>
        </main>
    );
}

export default function AuthErrorPage() {
    return (
        <Suspense
            fallback={
                <main
                    style={{
                        minHeight: '100dvh',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: '#f4f7fb',
                        color: '#0f172a',
                    }}
                >
                    Loading...
                </main>
            }
        >
            <ErrorContent />
        </Suspense>
    );
}
