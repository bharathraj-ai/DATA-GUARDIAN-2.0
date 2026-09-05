'use client';

import { signIn, useSession } from 'next-auth/react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Shield } from 'lucide-react';
import styles from './signin.module.css';

function SignInContent() {
    const router = useRouter();
    const { data: session, status: sessionStatus } = useSession();
    const searchParams = useSearchParams();
    const rawCallbackUrl = searchParams.get('callbackUrl');
    const intent = searchParams.get('intent');
    const isJoinFlow = intent === 'join';
    const callbackUrl = rawCallbackUrl && rawCallbackUrl.startsWith('/') && !rawCallbackUrl.startsWith('//')
        ? rawCallbackUrl
        : '/auth/continue';
    const error = searchParams.get('error');

    useEffect(() => {
        if (sessionStatus === 'loading') return;
        if (sessionStatus !== 'authenticated' || !session?.user) return;

        const onboardingStep = session.user.onboardingStep
            ?? (session.user.roleSelected ? 'COMPLETE' : 'ROLE_SELECTION');
        const userRole = session.user.role;

        if (onboardingStep === 'ROLE_SELECTION') {
            const roleSelectUrl = rawCallbackUrl && rawCallbackUrl.startsWith('/') && !rawCallbackUrl.startsWith('//')
                ? `/auth/role-select?callbackUrl=${encodeURIComponent(rawCallbackUrl)}`
                : '/auth/role-select';
            router.replace(roleSelectUrl);
        } else if (rawCallbackUrl && rawCallbackUrl.startsWith('/') && !rawCallbackUrl.startsWith('//')) {
            router.replace(rawCallbackUrl);
        } else {
            router.replace(userRole === 'VENDOR' ? '/dashboard/vendor' : '/dashboard/owner');
        }
    }, [sessionStatus, session, router, rawCallbackUrl]);

    if (sessionStatus === 'loading' || sessionStatus === 'authenticated') {
        return (
            <main className={styles.page}>
                <div className={styles.wait}>
                    <div className="button-spinner" style={{ width: 48, height: 48 }} />
                    <p>{sessionStatus === 'loading' ? 'Loading...' : 'Completing sign in...'}</p>
                </div>
            </main>
        );
    }

    return (
        <main className={styles.page}>
            <article className={styles.card}>
                <p className={styles.kicker}>{isJoinFlow ? 'First session' : 'Returning session'}</p>

                <h1 className={styles.title}>
                    {isJoinFlow ? 'Start with Secure Protocol' : 'Welcome back'}
                </h1>

                <p className={styles.sub}>
                    {isJoinFlow
                        ? 'Sign in with Google, then choose Owner or Vendor for this account.'
                        : 'Sign in with Google to continue to your dashboard.'}
                </p>

                {error ? (
                    <div className={styles.error}>
                        {error === 'AccessDenied'
                            ? 'Access denied. Please use an authorized account.'
                            : 'Authentication failed. Please try again.'}
                    </div>
                ) : null}

                <button
                    type="button"
                    onClick={() => signIn('google', { callbackUrl })}
                    className={styles.google}
                    suppressHydrationWarning
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                    </svg>
                    Continue with Google
                </button>

                {process.env.NEXT_PUBLIC_SSO_NAME ? (
                    <button
                        type="button"
                        onClick={() => signIn('oidc', { callbackUrl })}
                        className={styles.google}
                        style={{ marginTop: 12 }}
                        suppressHydrationWarning
                    >
                        Continue with {process.env.NEXT_PUBLIC_SSO_NAME}
                    </button>
                ) : null}

                <div className={styles.trust}>
                    <Shield size={16} strokeWidth={2} />
                    <span>Verified server-side. We never store passwords.</span>
                </div>

                <div className={styles.foot}>
                    <Link href="/" className={styles.back}>
                        <ArrowLeft size={14} />
                        Back to Home
                    </Link>
                    <p className={styles.policy}>By signing in, you agree to our security policies.</p>
                </div>
            </article>
        </main>
    );
}

export default function SignInPage() {
    return (
        <Suspense fallback={
            <main className={styles.page}>
                <div className={styles.wait}>
                    <div className="button-spinner" style={{ width: 48, height: 48 }} />
                    <p>Loading...</p>
                </div>
            </main>
        }>
            <SignInContent />
        </Suspense>
    );
}
