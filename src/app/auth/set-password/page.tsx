'use client';

import { useState, useMemo, useEffect, Suspense } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Shield, Eye, EyeOff, AlertCircle, CheckCircle2, Lock, UserCheck } from 'lucide-react';
import { validatePasswordStrength } from '@/lib/security/password-strength';
import styles from '../auth.module.css';

function SetPasswordContent() {
    const router = useRouter();
    const { data: session, status: sessionStatus, update: updateSession } = useSession();

    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const strength = useMemo(() => {
        return validatePasswordStrength(password);
    }, [password]);

    const passwordsMatch = Boolean(password && confirmPassword && password === confirmPassword);

    useEffect(() => {
        if (sessionStatus === 'loading') return;

        // Must have an active session to set password
        if (sessionStatus !== 'authenticated' || !session?.user) {
            router.replace('/auth/signin');
            return;
        }

        // If user already has a password established, proceed to continue
        if (session.user.hasPassword) {
            router.replace('/auth/continue');
        }
    }, [sessionStatus, session, router]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setErrorMessage(null);

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
            const res = await fetch('/api/auth/set-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password, confirmPassword }),
            });

            const data = await res.json();

            if (!res.ok) {
                setErrorMessage(data.error || 'Failed to establish password.');
                setLoading(false);
                return;
            }

            // Refresh session token so hasPassword becomes true in client context
            await updateSession();
            router.replace('/auth/continue');
        } catch {
            setErrorMessage('Network error occurred. Please try again.');
            setLoading(false);
        }
    };

    if (sessionStatus === 'loading') {
        return (
            <main className={styles.page}>
                <div className={styles.wait}>
                    <div className="button-spinner" style={{ width: 44, height: 44 }} />
                    <p>Verifying authentication session...</p>
                </div>
            </main>
        );
    }

    const userEmail = session?.user?.email || 'Google User';

    return (
        <main className={styles.page}>
            <article className={styles.card}>
                <div className={styles.header}>
                    <p className={styles.kicker}>Required Security Step</p>
                    <h1 className={styles.title}>Set Local Password</h1>
                    <p className={styles.sub}>
                        Establish a password to secure your account and enable email/password login.
                    </p>
                </div>

                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 14px',
                    borderRadius: 12,
                    background: '#e0f2fe',
                    border: '1px solid #bae6fd',
                    color: '#0369a1',
                    fontSize: 13,
                    fontWeight: 600,
                    marginBottom: 20,
                }}>
                    <UserCheck size={16} style={{ flexShrink: 0 }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        Authenticated: <strong>{userEmail}</strong>
                    </span>
                </div>

                {errorMessage ? (
                    <div className={styles.errorAlert} role="alert">
                        <AlertCircle size={18} strokeWidth={2} style={{ flexShrink: 0 }} />
                        <span>{errorMessage}</span>
                    </div>
                ) : null}

                <form onSubmit={handleSubmit} className={styles.form}>
                    <div className={styles.field}>
                        <label htmlFor="set-password" className={styles.label}>
                            Create Password
                        </label>
                        <div className={styles.inputWrapper}>
                            <input
                                id="set-password"
                                type={showPassword ? 'text' : 'password'}
                                required
                                autoComplete="new-password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Min 8 chars with uppercase, digit, symbol"
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
                                        {strength.score <= 1 && 'Weak'}
                                        {strength.score === 2 && 'Fair'}
                                        {strength.score === 3 && 'Good'}
                                        {strength.score >= 4 && 'Strong'}
                                    </span>
                                </div>
                            </div>
                        ) : null}
                    </div>

                    <div className={styles.field}>
                        <label htmlFor="set-confirm-password" className={styles.label}>
                            Confirm Password
                        </label>
                        <div className={styles.inputWrapper}>
                            <input
                                id="set-confirm-password"
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

                    <button
                        type="submit"
                        className={styles.submitBtn}
                        disabled={loading || !passwordsMatch || !strength.isValid}
                    >
                        {loading ? (
                            <>
                                <span className="button-spinner" style={{ width: 16, height: 16 }} />
                                Saving Password...
                            </>
                        ) : (
                            <>
                                <Lock size={15} />
                                Save Password &amp; Continue
                            </>
                        )}
                    </button>
                </form>

                <div className={styles.trust}>
                    <Shield size={16} strokeWidth={2} />
                    <span>Argon2id Hashed · Enables Independent Login</span>
                </div>
            </article>
        </main>
    );
}

export default function SetPasswordPage() {
    return (
        <Suspense fallback={
            <main className={styles.page}>
                <div className={styles.wait}>
                    <div className="button-spinner" style={{ width: 44, height: 44 }} />
                    <p>Loading...</p>
                </div>
            </main>
        }>
            <SetPasswordContent />
        </Suspense>
    );
}

