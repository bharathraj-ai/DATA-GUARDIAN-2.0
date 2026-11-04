'use client';

import { useState, Suspense } from 'react';
import Link from 'next/link';
import { ArrowLeft, Shield, AlertCircle, CheckCircle2, Mail } from 'lucide-react';
import styles from '../auth.module.css';

function ForgotPasswordContent() {
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [submitted, setSubmitted] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setErrorMessage(null);

        if (!email.trim()) {
            setErrorMessage('Please enter your email address.');
            return;
        }

        setLoading(true);

        try {
            const res = await fetch('/api/auth/forgot-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: email.trim().toLowerCase() }),
            });

            const data = await res.json();

            if (!res.ok) {
                setErrorMessage(data.error || 'Failed to process request. Please try again.');
                setLoading(false);
                return;
            }

            setSubmitted(true);
            setLoading(false);
        } catch {
            setErrorMessage('An unexpected network error occurred. Please try again.');
            setLoading(false);
        }
    };

    return (
        <main className={styles.page}>
            <article className={styles.card}>
                <div className={styles.header}>
                    <p className={styles.kicker}>Password Recovery</p>
                    <h1 className={styles.title}>Forgot Password</h1>
                    <p className={styles.sub}>
                        Enter your registered email and we&apos;ll send a secure password reset link.
                    </p>
                </div>

                {errorMessage ? (
                    <div className={styles.errorAlert} role="alert">
                        <AlertCircle size={18} strokeWidth={2} style={{ flexShrink: 0 }} />
                        <span>{errorMessage}</span>
                    </div>
                ) : null}

                {submitted ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <div className={styles.successAlert} role="status">
                            <CheckCircle2 size={20} strokeWidth={2} style={{ flexShrink: 0, marginTop: 1 }} />
                            <div>
                                <p style={{ margin: '0 0 6px', fontWeight: 700 }}>Reset link dispatched</p>
                                <p style={{ margin: 0, fontSize: 13, color: '#166534', lineHeight: 1.5 }}>
                                    If an account exists for <strong>{email}</strong>, a secure password reset link has been sent. Please check your inbox and spam folder.
                                </p>
                            </div>
                        </div>

                        <p style={{ fontSize: 13, color: '#64748b', textAlign: 'center', margin: '8px 0' }}>
                            The reset link expires in 1 hour and can only be used once.
                        </p>

                        <Link href="/auth/signin" className={styles.submitBtn} style={{ textDecoration: 'none' }}>
                            Return to Sign In
                        </Link>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className={styles.form}>
                        <div className={styles.field}>
                            <label htmlFor="forgot-email" className={styles.label}>
                                Registered Email Address
                            </label>
                            <div className={styles.inputWrapper}>
                                <input
                                    id="forgot-email"
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
                        </div>

                        <button
                            type="submit"
                            className={styles.submitBtn}
                            disabled={loading}
                        >
                            {loading ? (
                                <>
                                    <span className="button-spinner" style={{ width: 16, height: 16 }} />
                                    Sending Link...
                                </>
                            ) : (
                                <>
                                    <Mail size={16} />
                                    Send Reset Link
                                </>
                            )}
                        </button>

                        <div className={styles.switchAuth} style={{ marginTop: 12 }}>
                            Remembered your password?{' '}
                            <Link href="/auth/signin" className={styles.switchAuthLink}>
                                Sign in
                            </Link>
                        </div>
                    </form>
                )}

                <div className={styles.trust}>
                    <Shield size={16} strokeWidth={2} />
                    <span>Cryptographic Verification · Generic Enumeration Defense</span>
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

export default function ForgotPasswordPage() {
    return (
        <Suspense fallback={
            <main className={styles.page}>
                <div className={styles.wait}>
                    <div className="button-spinner" style={{ width: 44, height: 44 }} />
                    <p>Loading...</p>
                </div>
            </main>
        }>
            <ForgotPasswordContent />
        </Suspense>
    );
}

