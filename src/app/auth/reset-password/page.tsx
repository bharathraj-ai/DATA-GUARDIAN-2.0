'use client';

import { useState, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Shield, Eye, EyeOff, AlertCircle, CheckCircle2, KeyRound } from 'lucide-react';
import { validatePasswordStrength } from '@/lib/security/password-strength';
import styles from '../auth.module.css';

function ResetPasswordContent() {
    const searchParams = useSearchParams();
    const token = searchParams.get('token');

    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    const strength = useMemo(() => {
        return validatePasswordStrength(password);
    }, [password]);

    const passwordsMatch = Boolean(password && confirmPassword && password === confirmPassword);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setErrorMessage(null);

        if (!token) {
            setErrorMessage('Invalid or missing password reset token.');
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

        setLoading(true);

        try {
            const res = await fetch('/api/auth/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    token: token.trim(),
                    password,
                    confirmPassword,
                }),
            });

            const data = await res.json();

            if (!res.ok) {
                setErrorMessage(data.error || 'Failed to reset password. The link may have expired.');
                setLoading(false);
                return;
            }

            setSuccess(true);
            setLoading(false);
        } catch {
            setErrorMessage('A network error occurred. Please try again.');
            setLoading(false);
        }
    };

    if (!token) {
        return (
            <main className={styles.page}>
                <article className={styles.card}>
                    <div className={styles.header}>
                        <p className={styles.kicker}>Error</p>
                        <h1 className={styles.title}>Invalid Link</h1>
                        <p className={styles.sub}>
                            This password reset link is invalid or incomplete.
                        </p>
                    </div>

                    <div className={styles.errorAlert} role="alert">
                        <AlertCircle size={18} strokeWidth={2} style={{ flexShrink: 0 }} />
                        <span>No reset token was provided in the URL. Please request a new link.</span>
                    </div>

                    <Link href="/auth/forgot-password" className={styles.submitBtn} style={{ textDecoration: 'none' }}>
                        Request New Reset Link
                    </Link>

                    <div className={styles.foot}>
                        <Link href="/auth/signin" className={styles.back}>
                            <ArrowLeft size={14} />
                            Back to Sign In
                        </Link>
                    </div>
                </article>
            </main>
        );
    }

    return (
        <main className={styles.page}>
            <article className={styles.card}>
                <div className={styles.header}>
                    <p className={styles.kicker}>New Credentials</p>
                    <h1 className={styles.title}>Reset Password</h1>
                    <p className={styles.sub}>
                        Choose a strong new password for your account.
                    </p>
                </div>

                {errorMessage ? (
                    <div className={styles.errorAlert} role="alert">
                        <AlertCircle size={18} strokeWidth={2} style={{ flexShrink: 0 }} />
                        <span>{errorMessage}</span>
                    </div>
                ) : null}

                {success ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                        <div className={styles.successAlert} role="status">
                            <CheckCircle2 size={20} strokeWidth={2} style={{ flexShrink: 0, marginTop: 1 }} />
                            <div>
                                <p style={{ margin: '0 0 6px', fontWeight: 700 }}>Password updated</p>
                                <p style={{ margin: 0, fontSize: 13, color: '#166534', lineHeight: 1.5 }}>
                                    Your password has been reset securely. You can now sign in with your new credentials.
                                </p>
                            </div>
                        </div>

                        <Link href="/auth/signin" className={styles.submitBtn} style={{ textDecoration: 'none' }}>
                            Proceed to Sign In
                        </Link>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className={styles.form}>
                        <div className={styles.field}>
                            <label htmlFor="reset-new-password" className={styles.label}>
                                New Password
                            </label>
                            <div className={styles.inputWrapper}>
                                <input
                                    id="reset-new-password"
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
                                            {strength.score === 2 && 'Fair'}
                                            {strength.score === 3 && 'Good'}
                                            {strength.score >= 4 && 'Strong'}
                                        </span>
                                    </div>
                                </div>
                            ) : null}
                        </div>

                        <div className={styles.field}>
                            <label htmlFor="reset-confirm-password" className={styles.label}>
                                Confirm New Password
                            </label>
                            <div className={styles.inputWrapper}>
                                <input
                                    id="reset-confirm-password"
                                    type={showConfirmPassword ? 'text' : 'password'}
                                    required
                                    autoComplete="new-password"
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    placeholder="Re-enter new password"
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

                        <button
                            type="submit"
                            className={styles.submitBtn}
                            disabled={loading || !passwordsMatch || !strength.isValid}
                        >
                            {loading ? (
                                <>
                                    <span className="button-spinner" style={{ width: 16, height: 16 }} />
                                    Updating Password...
                                </>
                            ) : (
                                <>
                                    <KeyRound size={16} />
                                    Reset Password
                                </>
                            )}
                        </button>
                    </form>
                )}

                <div className={styles.trust}>
                    <Shield size={16} strokeWidth={2} />
                    <span>Argon2id Hashing · Session Invalidation</span>
                </div>

                <div className={styles.foot}>
                    <Link href="/auth/signin" className={styles.back}>
                        <ArrowLeft size={14} />
                        Back to Sign In
                    </Link>
                </div>
            </article>
        </main>
    );
}

export default function ResetPasswordPage() {
    return (
        <Suspense fallback={
            <main className={styles.page}>
                <div className={styles.wait}>
                    <div className="button-spinner" style={{ width: 44, height: 44 }} />
                    <p>Loading...</p>
                </div>
            </main>
        }>
            <ResetPasswordContent />
        </Suspense>
    );
}

