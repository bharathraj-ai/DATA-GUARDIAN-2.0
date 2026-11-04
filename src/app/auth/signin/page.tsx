'use client';

import { useState, Suspense, useEffect } from 'react';
import { signIn, useSession } from 'next-auth/react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Shield, Eye, EyeOff, AlertCircle } from 'lucide-react';
import styles from '../auth.module.css';

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
    const errorParam = searchParams.get('error');

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [rememberMe, setRememberMe] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    // Initial query param error handling
    useEffect(() => {
        if (!errorParam) return;
        if (errorParam === 'OAuthAccountNotLinked') {
            setErrorMessage('An account with this email exists using password sign-in. Please enter your credentials below.');
        } else if (errorParam === 'AccessDenied') {
            setErrorMessage('Access denied. Please use an authorized account.');
        } else if (errorParam === 'CredentialsSignin') {
            setErrorMessage('Invalid email or password.');
        } else if (errorParam === 'EmailNotVerified') {
            setErrorMessage('Please verify your email address before signing in. Check your inbox for the link.');
        } else {
            setErrorMessage('Authentication failed. Please try again.');
        }
    }, [errorParam]);

    // Active session redirect
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

    const handleCredentialsSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setErrorMessage(null);

        if (!email.trim() || !password) {
            setErrorMessage('Please enter both email and password.');
            return;
        }

        setLoading(true);

        try {
            const res = await signIn('credentials', {
                email: email.trim().toLowerCase(),
                password,
                rememberMe,
                redirect: false,
                callbackUrl,
            });

            if (!res) {
                setErrorMessage('Unable to connect to authentication service.');
                setLoading(false);
                return;
            }

            if (res.status === 429) {
                setErrorMessage('Too many sign-in attempts. Please try again in 15 minutes.');
                setLoading(false);
                return;
            }

            if (res.error) {
                if (res.error === 'EMAIL_NOT_VERIFIED' || res.error.includes('EMAIL_NOT_VERIFIED')) {
                    setErrorMessage('Please verify your email address before signing in. Check your inbox for the activation link.');
                } else if (res.error === 'ACCOUNT_LOCKED' || res.error.includes('ACCOUNT_LOCKED')) {
                    setErrorMessage('Too many failed attempts. For your security, this account is temporarily locked. Please try again later.');
                } else if (res.error === 'TOO_MANY_ATTEMPTS' || res.error.includes('TOO_MANY_ATTEMPTS')) {
                    setErrorMessage('Too many sign-in attempts. Please try again in 15 minutes.');
                } else {
                    setErrorMessage('Invalid email or password.');
                }
                setLoading(false);
            } else {
                router.replace(callbackUrl);
            }
        } catch {
            setErrorMessage('An unexpected error occurred. Please try again.');
            setLoading(false);
        }
    };

    if (sessionStatus === 'loading' || sessionStatus === 'authenticated') {
        return (
            <main className={styles.page}>
                <div className={styles.wait}>
                    <div className="button-spinner" style={{ width: 44, height: 44 }} />
                    <p>{sessionStatus === 'loading' ? 'Loading...' : 'Completing sign in...'}</p>
                </div>
            </main>
        );
    }

    return (
        <main className={styles.page}>
            <article className={styles.card}>
                <div className={styles.header}>
                    <p className={styles.kicker}>{isJoinFlow ? 'First session' : 'Secure Protocol'}</p>
                    <h1 className={styles.title}>
                        {isJoinFlow ? 'Start with Data Guardian' : 'Welcome back'}
                    </h1>
                    <p className={styles.sub}>
                        Sign in to continue to your encrypted workspace.
                    </p>
                </div>

                {errorMessage ? (
                    <div className={styles.errorAlert} role="alert">
                        <AlertCircle size={18} strokeWidth={2} style={{ flexShrink: 0 }} />
                        <span>{errorMessage}</span>
                    </div>
                ) : null}

                <form onSubmit={handleCredentialsSubmit} className={styles.form}>
                    <div className={styles.field}>
                        <label htmlFor="signin-email" className={styles.label}>
                            Email Address
                        </label>
                        <input
                            id="signin-email"
                            type="email"
                            required
                            autoComplete="username"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="name@company.com"
                            className={styles.input}
                            disabled={loading}
                        />
                    </div>

                    <div className={styles.field}>
                        <div className={styles.labelRow}>
                            <label htmlFor="signin-password" className={styles.label}>
                                Password
                            </label>
                            <Link href="/auth/forgot-password" className={styles.forgotLink}>
                                Forgot password?
                            </Link>
                        </div>
                        <div className={styles.inputWrapper}>
                            <input
                                id="signin-password"
                                type={showPassword ? 'text' : 'password'}
                                required
                                autoComplete="current-password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="••••••••"
                                className={`${styles.input} ${styles.inputWithToggle}`}
                                disabled={loading}
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className={styles.toggleBtn}
                                aria-label={showPassword ? 'Hide password' : 'Show password'}
                                tabIndex={-1}
                            >
                                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                        </div>
                    </div>

                    <label className={styles.checkboxContainer}>
                        <input
                            type="checkbox"
                            checked={rememberMe}
                            onChange={(e) => setRememberMe(e.target.checked)}
                            className={styles.checkbox}
                            disabled={loading}
                        />
                        <span className={styles.checkboxLabel}>Remember me on this device</span>
                    </label>

                    <button
                        type="submit"
                        className={styles.submitBtn}
                        disabled={loading}
                    >
                        {loading ? (
                            <>
                                <span className="button-spinner" style={{ width: 16, height: 16 }} />
                                Signing in...
                            </>
                        ) : (
                            'Sign In'
                        )}
                    </button>
                </form>

                <div className={styles.divider}>or continue with</div>

                <button
                    type="button"
                    onClick={() => signIn('google', { callbackUrl })}
                    className={styles.googleBtn}
                    disabled={loading}
                >
                    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                    </svg>
                    Continue with Google
                </button>

                <div className={styles.switchAuth}>
                    Don&apos;t have an account?{' '}
                    <Link href={`/auth/signup${rawCallbackUrl ? `?callbackUrl=${encodeURIComponent(rawCallbackUrl)}` : ''}`} className={styles.switchAuthLink}>
                        Sign up
                    </Link>
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
                    <div className="button-spinner" style={{ width: 44, height: 44 }} />
                    <p>Loading...</p>
                </div>
            </main>
        }>
            <SignInContent />
        </Suspense>
    );
}
