'use client';

import { useState, useMemo, Suspense } from 'react';
import { signIn } from 'next-auth/react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Shield, Eye, EyeOff, AlertCircle, CheckCircle2 } from 'lucide-react';
import { validatePasswordStrength } from '@/lib/security/password-strength';
import styles from '../auth.module.css';

function SignUpContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const rawCallbackUrl = searchParams.get('callbackUrl');
    const callbackUrl = rawCallbackUrl && rawCallbackUrl.startsWith('/') && !rawCallbackUrl.startsWith('//')
        ? rawCallbackUrl
        : '/auth/continue';

    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [terms, setTerms] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const strength = useMemo(() => {
        return validatePasswordStrength(password);
    }, [password]);

    const passwordsMatch = Boolean(password && confirmPassword && password === confirmPassword);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setErrorMessage(null);

        if (!name.trim()) {
            setErrorMessage('Please enter your full name.');
            return;
        }

        if (!email.trim()) {
            setErrorMessage('Please enter a valid email address.');
            return;
        }

        if (!strength.isValid) {
            setErrorMessage(strength.errors[0] || 'Password does not meet complexity requirements.');
            return;
        }

        if (password !== confirmPassword) {
            setErrorMessage('Passwords do not match.');
            return;
        }

        if (!terms) {
            setErrorMessage('You must accept the Terms and Conditions to create an account.');
            return;
        }

        setLoading(true);

        try {
            const res = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: name.trim(),
                    email: email.trim().toLowerCase(),
                    password,
                    confirmPassword,
                    terms,
                }),
            });

            const data = await res.json();

            if (!res.ok) {
                setErrorMessage(data.error || 'Registration failed. Please try again.');
                setLoading(false);
                return;
            }

            // Redirect to verify email notice
            router.push(`/auth/verify-email?email=${encodeURIComponent(email.trim().toLowerCase())}`);
        } catch {
            setErrorMessage('An unexpected network error occurred. Please try again.');
            setLoading(false);
        }
    };

    return (
        <main className={styles.page}>
            <article className={styles.card}>
                <div className={styles.header}>
                    <p className={styles.kicker}>Create Account</p>
                    <h1 className={styles.title}>Join Data Guardian</h1>
                    <p className={styles.sub}>
                        Register with high-grade cryptographic security.
                    </p>
                </div>

                {errorMessage ? (
                    <div className={styles.errorAlert} role="alert">
                        <AlertCircle size={18} strokeWidth={2} style={{ flexShrink: 0 }} />
                        <span>{errorMessage}</span>
                    </div>
                ) : null}

                <form onSubmit={handleSubmit} className={styles.form}>
                    <div className={styles.field}>
                        <label htmlFor="signup-name" className={styles.label}>
                            Full Name
                        </label>
                        <input
                            id="signup-name"
                            type="text"
                            required
                            autoComplete="name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Alex Morgan"
                            className={styles.input}
                            disabled={loading}
                        />
                    </div>

                    <div className={styles.field}>
                        <label htmlFor="signup-email" className={styles.label}>
                            Email Address
                        </label>
                        <input
                            id="signup-email"
                            type="email"
                            required
                            autoComplete="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="name@company.com"
                            className={styles.input}
                            disabled={loading}
                        />
                    </div>

                    <div className={styles.field}>
                        <label htmlFor="signup-password" className={styles.label}>
                            Password
                        </label>
                        <div className={styles.inputWrapper}>
                            <input
                                id="signup-password"
                                type={showPassword ? 'text' : 'password'}
                                required
                                autoComplete="new-password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Min 8 characters with symbol"
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

                        {password ? (
                            <div className={styles.strengthContainer}>
                                <div className={styles.strengthBarTrack}>
                                    <div className={`${styles.strengthBarStep} ${strength.score >= 1 ? (strength.score >= 3 ? styles.stepStrong : strength.score === 2 ? styles.stepMedium : styles.stepWeak) : ''}`} />
                                    <div className={`${styles.strengthBarStep} ${strength.score >= 2 ? (strength.score >= 3 ? styles.stepStrong : styles.stepMedium) : ''}`} />
                                    <div className={`${styles.strengthBarStep} ${strength.score >= 3 ? styles.stepStrong : ''}`} />
                                    <div className={`${styles.strengthBarStep} ${strength.score >= 4 ? styles.stepStrong : ''}`} />
                                </div>
                                <div className={styles.strengthLabel}>
                                    <span>Strength:</span>
                                    <span>
                                        {strength.score <= 1 && 'Weak (8+ chars, upper, lower, number, symbol)'}
                                        {strength.score === 2 && 'Fair (add length or variety)'}
                                        {strength.score === 3 && 'Good'}
                                        {strength.score >= 4 && 'Strong'}
                                    </span>
                                </div>
                            </div>
                        ) : null}
                    </div>

                    <div className={styles.field}>
                        <label htmlFor="signup-confirm-password" className={styles.label}>
                            Confirm Password
                        </label>
                        <div className={styles.inputWrapper}>
                            <input
                                id="signup-confirm-password"
                                type={showConfirmPassword ? 'text' : 'password'}
                                required
                                autoComplete="new-password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                placeholder="Re-enter password"
                                className={`${styles.input} ${styles.inputWithToggle}`}
                                disabled={loading}
                            />
                            <button
                                type="button"
                                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                className={styles.toggleBtn}
                                aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                                tabIndex={-1}
                            >
                                {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                        </div>
                        {confirmPassword && passwordsMatch ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#10b981', fontSize: 11, fontWeight: 600, marginTop: 2 }}>
                                <CheckCircle2 size={12} />
                                Passwords match
                            </div>
                        ) : null}
                    </div>

                    <label className={styles.checkboxContainer} style={{ alignItems: 'flex-start', marginTop: 4 }}>
                        <input
                            type="checkbox"
                            checked={terms}
                            onChange={(e) => setTerms(e.target.checked)}
                            className={styles.checkbox}
                            style={{ marginTop: 2 }}
                            disabled={loading}
                        />
                        <span className={styles.checkboxLabel}>
                            I agree to the{' '}
                            <Link href="/legal/terms" target="_blank" rel="noopener noreferrer">
                                Terms and Conditions
                            </Link>{' '}
                            and{' '}
                            <Link href="/legal/privacy" target="_blank" rel="noopener noreferrer">
                                Privacy Policy
                            </Link>.
                        </span>
                    </label>

                    <button
                        type="submit"
                        className={styles.submitBtn}
                        disabled={loading || !terms}
                    >
                        {loading ? (
                            <>
                                <span className="button-spinner" style={{ width: 16, height: 16 }} />
                                Creating account...
                            </>
                        ) : (
                            'Create Account'
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
                    Already have an account?{' '}
                    <Link href={`/auth/signin${rawCallbackUrl ? `?callbackUrl=${encodeURIComponent(rawCallbackUrl)}` : ''}`} className={styles.switchAuthLink}>
                        Sign in
                    </Link>
                </div>

                <div className={styles.trust}>
                    <Shield size={16} strokeWidth={2} />
                    <span>Zero Knowledge Token Hashing</span>
                </div>

                <div className={styles.foot}>
                    <Link href="/" className={styles.back}>
                        <ArrowLeft size={14} />
                        Back to Home
                    </Link>
                </div>
            </article>
        </main>
    );
}

export default function SignUpPage() {
    return (
        <Suspense fallback={
            <main className={styles.page}>
                <div className={styles.wait}>
                    <div className="button-spinner" style={{ width: 44, height: 44 }} />
                    <p>Loading...</p>
                </div>
            </main>
        }>
            <SignUpContent />
        </Suspense>
    );
}

