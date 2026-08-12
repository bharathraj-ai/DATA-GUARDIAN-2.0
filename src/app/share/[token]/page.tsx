'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { verifyOTP } from '@/actions/verify-otp';
import { validateShareAccess } from '@/actions/validate-share-access';
import { sendVendorOTP } from '@/actions/send-vendor-otp';
import { useSession, signIn } from 'next-auth/react';
import { logger, redactToken } from '@/lib/logger';
import { Lock } from 'lucide-react';
import styles from './otp.module.css';

interface SharePageProps {
    params: any;
}

type VerificationState = 'idle' | 'loading' | 'success' | 'error';
type AccessState = 'checking' | 'allowed' | 'denied' | 'requires_auth';

export default function SharePage({ params }: SharePageProps) {
    const router = useRouter();
    const { data: sessionData, status } = useSession();
    const [token, setToken] = useState<string>('');
    const [step, setStep] = useState<'email' | 'otp'>('otp');
    const [email, setEmail] = useState<string>('');
    const [otp, setOtp] = useState<string[]>(['', '', '', '', '', '']);
    const [state, setState] = useState<VerificationState>('idle');
    const [error, setError] = useState<string>('');
    const [accessError, setAccessError] = useState<string>('');
    const [remainingAttempts, setRemainingAttempts] = useState(1);
    const [countdown, setCountdown] = useState(300); // 5 minutes
    const [resendCooldown, setResendCooldown] = useState(0);
    const [resendMessage, setResendMessage] = useState('');
    const [isResending, setIsResending] = useState(false);
    const [shake, setShake] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);
    const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [accessState, setAccessState] = useState<AccessState>('checking');

    // Force refresh on mount to clear any cached data
    useEffect(() => {
        // Clear any browser cache for this page
        if (typeof window !== 'undefined') {
            // Force reload if coming from cache
            if (window.performance && window.performance.navigation.type === 2) {
                window.location.reload();
            }
        }
    }, []);

    // Auto-detect session email to auto-fill
    useEffect(() => {
        if (accessState === 'allowed' && sessionData?.user?.email) {
            setEmail(sessionData.user.email);
        }
    }, [accessState, sessionData]);

    useEffect(() => {
        params.then((p: any) => {
            logger.debug(`Token resolved: ${redactToken(p.token)}`);
            // Remove any query parameters (like timestamp) from token
            const cleanToken = p.token.split('?')[0];
            setToken(cleanToken);
        }).catch((err: any) => {
            logger.error('Failed to resolve params', err);
            setIsLoading(false);
        });
    }, [params]);

    // SECURITY: Validate access before showing OTP form
    useEffect(() => {
        if (!token) return;

        async function checkAccess() {
            setAccessState('checking');
            const result = await validateShareAccess(token);

            if (result.allowed) {
                setAccessState('allowed');
                setIsLoading(false);
            } else if (result.requiresAuth) {
                setAccessState('requires_auth');
                setAccessError(result.error || 'Authentication required.');
                setIsLoading(false);
            } else {
                setAccessState('denied');
                setAccessError(result.error || 'Access denied.');
                setIsLoading(false);
            }
        }

        checkAccess();
    }, [token]);

    // Countdown timer (OTP expiry UI)
    useEffect(() => {
        if (countdown <= 0 || accessState !== 'allowed') return;
        const timer = setInterval(() => {
            setCountdown((prev) => Math.max(0, prev - 1));
        }, 1000);
        return () => clearInterval(timer);
    }, [countdown, accessState]);

    // Resend cooldown timer
    useEffect(() => {
        if (resendCooldown <= 0) return;
        const timer = setInterval(() => {
            setResendCooldown((prev) => Math.max(0, prev - 1));
        }, 1000);
        return () => clearInterval(timer);
    }, [resendCooldown]);

    // Auto-focus first input
    useEffect(() => {
        if (token && accessState === 'allowed' && inputRefs.current[0]) {
            inputRefs.current[0].focus();
        }
    }, [token, accessState]);

    const formatTime = (seconds: number): string => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    const handleChange = (index: number, value: string) => {
        // Only allow digits
        if (value && !/^\d$/.test(value)) return;

        const newOtp = [...otp];
        newOtp[index] = value;
        setOtp(newOtp);
        setError('');

        // Auto-advance to next input
        if (value && index < 5) {
            inputRefs.current[index + 1]?.focus();
        }
    };

    const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Backspace' && !otp[index] && index > 0) {
            inputRefs.current[index - 1]?.focus();
        }
    };

    const handlePaste = (e: React.ClipboardEvent) => {
        e.preventDefault();
        const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
        if (pastedData.length === 6) {
            const newOtp = pastedData.split('');
            setOtp(newOtp);
            inputRefs.current[5]?.focus();
        }
    };

    const triggerShake = () => {
        setShake(true);
        setTimeout(() => setShake(false), 500);
    };

    const handleEmailSubmit = async () => {
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            setError('Please enter a valid email address');
            triggerShake();
            return;
        }

        setState('loading');
        setError('');

        try {
            const result = await sendVendorOTP({ token, email });

            if (result.success) {
                setState('idle');
                setStep('otp');
                setCountdown(300);
                setResendCooldown(60);
                setResendMessage('OTP sent to your email.');
                setOtp(['', '', '', '', '', '']);
            } else {
                setState('error');
                setError(result.error || 'Failed to request OTP');
                if (result.retryAfterSeconds) {
                    setResendCooldown(result.retryAfterSeconds);
                }
                triggerShake();
                setTimeout(() => setState('idle'), 2000);
            }
        } catch {
            setState('error');
            setError('Connection error. Please try again.');
            triggerShake();
            setTimeout(() => setState('idle'), 2000);
        }
    };

    const handleResendOTP = async () => {
        const targetEmail = (email || sessionData?.user?.email || '').trim();
        if (!targetEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
            setError('Sign in or enter your authorized email to resend the OTP.');
            triggerShake();
            return;
        }

        if (resendCooldown > 0 || isResending || state === 'loading') return;

        setIsResending(true);
        setError('');
        setResendMessage('');

        try {
            if (!email) setEmail(targetEmail);
            const result = await sendVendorOTP({ token, email: targetEmail });

            if (result.success) {
                setCountdown(300);
                setResendCooldown(60);
                setResendMessage('A new OTP has been sent to your email.');
                setOtp(['', '', '', '', '', '']);
                inputRefs.current[0]?.focus();
            } else {
                setError(result.error || 'Failed to resend OTP');
                if (result.retryAfterSeconds) {
                    setResendCooldown(result.retryAfterSeconds);
                }
                triggerShake();
            }
        } catch {
            setError('Connection error. Please try again.');
            triggerShake();
        } finally {
            setIsResending(false);
        }
    };

    const handleSubmit = useCallback(async () => {
        const otpString = otp.join('');

        if (otpString.length !== 6) {
            setError('Please enter all 6 digits');
            triggerShake();
            return;
        }

        if (countdown <= 0) {
            setError('OTP has expired. Please request a new link.');
            return;
        }

        setState('loading');
        setError('');
        setResendMessage('');

        try {
            const result = await verifyOTP({ token, otp: otpString, email: email || undefined });

            if (result.success) {
                setState('success');
                window.setTimeout(() => {
                    window.location.assign(`/view/${token}?t=${Date.now()}`);
                }, 1700);
                return;
            } else {
                setState('error');
                setError(result.error || 'Verification failed');
                triggerShake();

                if (result.errorType === 'INVALID_OTP') {
                    setRemainingAttempts((prev) => Math.max(0, prev - 1));
                }

                // Reset OTP inputs
                setOtp(['', '', '', '', '', '']);
                inputRefs.current[0]?.focus();

                setTimeout(() => setState('idle'), 2000);
            }
        } catch {
            setState('error');
            setError('Connection error. Please try again.');
            triggerShake();
            setTimeout(() => setState('idle'), 2000);
        }
    }, [otp, token, countdown, router, email]);

    // Auto-submit when all 6 digits entered
    useEffect(() => {
        if (otp.every((digit) => digit !== '') && state === 'idle' && accessState === 'allowed') {
            handleSubmit();
        }
    }, [otp, state, handleSubmit, accessState]);

    // Loading state
    if (isLoading || accessState === 'checking' || status === 'loading') {
        return (
            <main className={styles.page}>
                <div className={styles.wash} />
                <div className={styles.card}>
                    <div className={styles.wait}>
                        <div className={styles.spin} style={{ borderColor: 'rgba(2,132,199,0.25)', borderTopColor: '#0284c7', width: 28, height: 28 }} />
                        <p>Checking this share…</p>
                    </div>
                </div>
            </main>
        );
    }

    // SECURITY: Requires authentication — show sign-in prompt
    if (accessState === 'requires_auth') {
        return (
            <main className={styles.page}>
                <div className={styles.wash} />
                <div className={styles.card}>
                    <p className={styles.kicker}>OTP gate</p>
                    <h1 className={styles.title}>Sign in to continue</h1>
                    <p className={styles.sub}>
                        This share is locked to an authorized recipient. Sign in with Google to prove it.
                    </p>

                    <button
                        onClick={() => signIn('google', { callbackUrl: `/share/${token}` })}
                        className={styles.go}
                        style={{ marginTop: 20 }}
                    >
                        Sign in with Google
                    </button>
                    <p className={styles.hint}>Only the named vendor can open this link.</p>
                </div>
            </main>
        );
    }

    // SECURITY: Access denied — wrong email or link issues
    if (accessState === 'denied') {
        const isRevoked = accessError.includes('revoked');
        const isExpired = accessError.includes('expired');
        const isEmailMismatch = accessError.includes('different recipient');
        return (
            <main className={styles.page}>
                <div className={styles.wash} />
                <div className={styles.card}>
                    <p className={styles.kicker}>OTP gate</p>
                    <h1 className={styles.title}>
                        {isRevoked ? 'Access revoked' : isExpired ? 'Link expired' : isEmailMismatch ? 'Wrong account' : 'Access denied'}
                    </h1>
                    <p className={styles.sub}>{accessError}</p>

                    {isEmailMismatch && (
                        <div className="phishing-warning" style={{
                            background: 'rgba(239, 68, 68, 0.1)',
                            border: '1px solid rgba(239, 68, 68, 0.3)',
                            borderRadius: '8px',
                            padding: '12px 16px',
                            margin: '16px 0',
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: '10px'
                        }}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" style={{ width: '20px', height: '20px', flexShrink: 0, marginTop: '2px' }}>
                                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                            </svg>
                            <div style={{ fontSize: '12px', color: '#f87171', lineHeight: '1.4' }}>
                                <strong style={{ marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <Lock size={14} /> Security Notice
                                </strong>
                                This link was created for a specific vendor. If you believe this is an error,
                                contact the person who shared it with you and ask them to create a new link for your email.
                            </div>
                        </div>
                    )}

                    <button
                        onClick={() => {
                            window.location.href = `/create-link?t=${Date.now()}`;
                        }}
                        className={styles.go}
                        style={{ marginTop: 16 }}
                    >
                        Return Home
                    </button>
                </div>
            </main>
        );
    }

    // Dynamic Step Resolver to prevent rendering flash/race conditions
    const isStepOtp = step === 'otp';

    const meterOffset = 100.53 * (1 - Math.max(0, countdown) / 300);
    const meterTone = countdown <= 30 ? styles.meterHot : countdown <= 60 ? styles.meterWarn : '';

    return (
        <main className={styles.page}>
            <div className={styles.wash} />
            <div className={styles.card}>
                {state === 'success' ? (
                    <div className={styles.unlock}>
                        <svg className={styles.lock} viewBox="0 0 64 64" fill="none" aria-hidden="true">
                            <path
                                className={styles.shackle}
                                d="M20 28V22a12 12 0 0 1 24 0v6"
                                stroke="#0284c7"
                                strokeWidth="4"
                                strokeLinecap="round"
                            />
                            <rect className={styles.body} x="14" y="28" width="36" height="26" rx="8" fill="#0284c7" />
                            <circle cx="32" cy="41" r="3.5" fill="#e0f2fe" />
                        </svg>
                        <h2>Share unlocked</h2>
                        <p>Opening the vault…</p>
                    </div>
                ) : (
                    <>
                        <div className={styles.head}>
                            <div className={styles.copy}>
                                <p className={styles.kicker}>OTP gate</p>
                                <h1 className={styles.title}>Unlock this share</h1>
                                <p className={styles.sub}>
                                    Six digits from the email we sent. They die with the ring on the right.
                                </p>
                            </div>
                            <div className={styles.meter} aria-label={`Code expires in ${formatTime(countdown)}`}>
                                <svg className={styles.meterSvg} viewBox="0 0 40 40">
                                    <circle className={styles.meterTrack} cx="20" cy="20" r="16" />
                                    <circle
                                        className={`${styles.meterFill} ${meterTone}`}
                                        cx="20"
                                        cy="20"
                                        r="16"
                                        style={{ strokeDashoffset: meterOffset }}
                                    />
                                </svg>
                                <span className={styles.meterTime}>
                                    {countdown > 0 ? formatTime(countdown) : '00:00'}
                                </span>
                            </div>
                        </div>

                        {!isStepOtp ? (
                            <div>
                                <input
                                    type="email"
                                    value={email}
                                    onChange={(e) => {
                                        setEmail(e.target.value);
                                        setError('');
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleEmailSubmit();
                                    }}
                                    className={styles.email}
                                    placeholder="Authorized email"
                                    disabled={state === 'loading'}
                                    autoFocus
                                />
                                {error ? <p className={styles.error}>{error}</p> : null}
                                <button
                                    type="button"
                                    onClick={handleEmailSubmit}
                                    disabled={state === 'loading' || !email}
                                    className={`${styles.go} ${state === 'loading' ? styles.busy : ''}`}
                                >
                                    {state === 'loading' ? <span className={styles.spin} /> : null}
                                    {state === 'loading' ? 'Sending…' : 'Send the code'}
                                </button>
                            </div>
                        ) : (
                            <div>
                                <p className={styles.sent}>
                                    {email ? (
                                        <>Code sent to <strong>{email}</strong></>
                                    ) : (
                                        'Enter the six-digit code from your email'
                                    )}
                                </p>
                                <div
                                    className={`${styles.track} ${state === 'loading' ? styles.checking : ''} ${shake || state === 'error' ? styles.bad : ''}`}
                                >
                                    <span
                                        className={styles.scan}
                                        style={{ transform: state === 'loading' ? undefined : `translateX(${activeIndex * 100}%)` }}
                                    />
                                    {otp.map((digit, index) => (
                                        <input
                                            key={index}
                                            ref={(el) => { inputRefs.current[index] = el; }}
                                            type="password"
                                            inputMode="numeric"
                                            maxLength={1}
                                            value={digit}
                                            onChange={(e) => handleChange(index, e.target.value)}
                                            onKeyDown={(e) => handleKeyDown(index, e)}
                                            onPaste={handlePaste}
                                            onFocus={() => setActiveIndex(index)}
                                            className={styles.slot}
                                            disabled={state === 'loading' || countdown <= 0}
                                            autoComplete="one-time-code"
                                        />
                                    ))}
                                </div>
                                {error ? <p className={styles.error}>{error}</p> : null}
                                <button
                                    type="button"
                                    onClick={handleSubmit}
                                    disabled={state === 'loading' || countdown <= 0 || otp.some((d) => !d)}
                                    className={`${styles.go} ${state === 'loading' ? styles.busy : ''}`}
                                >
                                    {state === 'loading' ? <span className={styles.spin} /> : <Lock size={16} />}
                                    {state === 'loading' ? 'Matching code…' : state === 'error' ? 'Try again' : 'Unlock'}
                                </button>
                                {resendMessage ? <p className={styles.note}>{resendMessage}</p> : null}
                                <button
                                    type="button"
                                    className={styles.resend}
                                    onClick={handleResendOTP}
                                    disabled={isResending || resendCooldown > 0 || state === 'loading'}
                                >
                                    {isResending
                                        ? 'Sending a new code…'
                                        : resendCooldown > 0
                                            ? `New code in ${resendCooldown}s`
                                            : countdown <= 0
                                                ? 'Code expired — send a new one'
                                                : 'Send a new code'}
                                </button>
                            </div>
                        )}

                        <p className={styles.hint}>We only ask for this code on this page — never by email or phone.</p>
                    </>
                )}
            </div>
        </main>
    );
}