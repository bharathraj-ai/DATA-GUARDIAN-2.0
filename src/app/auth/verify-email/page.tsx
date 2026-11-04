'use client';

import { useState, useEffect, Suspense, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Shield, AlertCircle, CheckCircle2, Mail, RefreshCw } from 'lucide-react';
import styles from '../auth.module.css';

function VerifyEmailContent() {
    const searchParams = useSearchParams();
    const token = searchParams.get('token');
    const initialEmail = searchParams.get('email') || '';

    const [verifying, setVerifying] = useState(Boolean(token));
    const [verified, setVerified] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [email, setEmail] = useState(initialEmail);
    const [resendLoading, setResendLoading] = useState(false);
    const [resendSuccess, setResendSuccess] = useState<string | null>(null);
    const [resendCooldown, setResendCooldown] = useState(0);

    const handleVerifyToken = useCallback(async (verifyToken: string) => {
        setVerifying(true);
        setError(null);

        try {
            const res = await fetch('/api/auth/verify-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: verifyToken.trim() }),
            });

            const data = await res.json();

            if (!res.ok) {
                setError(data.error || 'Verification link is invalid or has expired.');
                setVerifying(false);
                return;
            }

            setVerified(true);
            setVerifying(false);
        } catch {
            setError('A network error occurred while verifying your email.');
            setVerifying(false);
        }
    }, []);

    useEffect(() => {
        if (token) {
            handleVerifyToken(token);
        }
    }, [token, handleVerifyToken]);

    // Resend cooldown timer
    useEffect(() => {
        if (resendCooldown <= 0) return;
        const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
        return () => clearTimeout(timer);
    }, [resendCooldown]);

    const handleResend = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email.trim() || resendCooldown > 0) return;

        setResendLoading(true);
        setResendSuccess(null);
        setError(null);

        try {
            const res = await fetch('/api/auth/resend-verification', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: email.trim().toLowerCase() }),
            });

            const data = await res.json();

            if (!res.ok) {
                setError(data.error || 'Failed to resend verification email.');
                setResendLoading(false);
                return;
            }

            setResendSuccess('A new verification email has been dispatched. Please check your inbox.');
            setResendCooldown(60); // 60 seconds cooldown
            setResendLoading(false);
        } catch {
            setError('Network error while requesting verification email.');
            setResendLoading(false);
        }
    };

    return (
        <main className={styles.page}>
            <article className={styles.card}>
                <div className={styles.header}>
                    <p className={styles.kicker}>Account Activation</p>
                    <h1 className={styles.title}>Email Verification</h1>
                    <p className={styles.sub}>
                        Confirm your identity to enable encrypted document access.
                    </p>
                </div>

                {error ? (
                    <div className={styles.errorAlert} role="alert">
                        <AlertCircle size={18} strokeWidth={2} style={{ flexShrink: 0 }} />
                        <span>{error}</span>
                    </div>
                ) : null}

                {resendSuccess ? (
                    <div className={styles.successAlert} role="status">
                        <CheckCircle2 size={18} strokeWidth={2} style={{ flexShrink: 0, marginTop: 1 }} />
                        <span>{resendSuccess}</span>
                    </div>
                ) : null}

                {verifying ? (
                    <div className={styles.wait}>
                        <div className="button-spinner" style={{ width: 44, height: 44 }} />
                        <p>Verifying your cryptographic token...</p>
                    </div>
                ) : verified ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                        <div className={styles.successAlert} role="status">
                            <CheckCircle2 size={20} strokeWidth={2} style={{ flexShrink: 0, marginTop: 1 }} />
                            <div>
                                <p style={{ margin: '0 0 6px', fontWeight: 700 }}>Email verified successfully!</p>
                                <p style={{ margin: 0, fontSize: 13, color: '#166534', lineHeight: 1.5 }}>
                                    Your account is now fully active. You can sign in and choose your role.
                                </p>
                            </div>
                        </div>

                        <Link href="/auth/signin" className={styles.submitBtn} style={{ textDecoration: 'none' }}>
                            Proceed to Sign In
                        </Link>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <div style={{
                            padding: '16px',
                            background: '#f8fafc',
                            border: '1px solid #e2e8f0',
                            borderRadius: '12px',
                            display: 'flex',
                            gap: '12px',
                            alignItems: 'flex-start'
                        }}>
                            <Mail size={22} color="#0284c7" style={{ flexShrink: 0, marginTop: 2 }} />
                            <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.5 }}>
                                {initialEmail ? (
                                    <>
                                        We sent an activation link to <strong>{initialEmail}</strong>. Click the link in that email to activate your account.
                                    </>
                                ) : (
                                    'Please check your inbox for your account verification link.'
                                )}
                            </div>
                        </div>

                        <form onSubmit={handleResend} className={styles.form}>
                            <div className={styles.field}>
                                <label htmlFor="resend-email" className={styles.label}>
                                    Didn&apos;t receive it? Resend link
                                </label>
                                <input
                                    id="resend-email"
                                    type="email"
                                    required
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="your-email@domain.com"
                                    className={styles.input}
                                    disabled={resendLoading || resendCooldown > 0}
                                />
                            </div>

                            <button
                                type="submit"
                                className={styles.submitBtn}
                                disabled={resendLoading || resendCooldown > 0}
                            >
                                {resendLoading ? (
                                    <>
                                        <span className="button-spinner" style={{ width: 16, height: 16 }} />
                                        Sending...
                                    </>
                                ) : resendCooldown > 0 ? (
                                    `Resend available in ${resendCooldown}s`
                                ) : (
                                    <>
                                        <RefreshCw size={15} />
                                        Resend Verification Email
                                    </>
                                )}
                            </button>
                        </form>
                    </div>
                )}

                <div className={styles.trust}>
                    <Shield size={16} strokeWidth={2} />
                    <span>Cryptographic Verification · Single-use Token Hash</span>
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

export default function VerifyEmailPage() {
    return (
        <Suspense fallback={
            <main className={styles.page}>
                <div className={styles.wait}>
                    <div className="button-spinner" style={{ width: 44, height: 44 }} />
                    <p>Loading...</p>
                </div>
            </main>
        }>
            <VerifyEmailContent />
        </Suspense>
    );
}

