'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { verifyOTP } from '@/actions/verify-otp';
import { validateShareAccess } from '@/actions/validate-share-access';
import { sendVendorOTP } from '@/actions/send-vendor-otp';
import { useSession, signIn } from 'next-auth/react';
import { logger, redactToken } from '@/lib/logger';
import { Lock, Shield, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
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
    const [cellsVisible, setCellsVisible] = useState(true);
    const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [accessState, setAccessState] = useState<AccessState>('checking');
    const [needsFreshOtp, setNeedsFreshOtp] = useState(false);

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
                setNeedsFreshOtp(Boolean(result.needsFreshOtp));
                if (result.needsFreshOtp) {
                    setError(
                        'This link was already opened elsewhere (e.g. localhost). Tap "Send a new code" and use the latest OTP from your email.',
                    );
                }
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
        const digit = value.replace(/\D/g, '').slice(-1);
        if (value && !digit) return;

        const newOtp = [...otp];
        newOtp[index] = digit;
        setOtp(newOtp);
        setError('');
        setActiveIndex(digit && index < 5 ? index + 1 : index);

        if (digit && index < 5) {
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
            setActiveIndex(5);
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
                setNeedsFreshOtp(false);
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
            const result = await verifyOTP({
                token,
                otp: otpString,
                email: (email || sessionData?.user?.email || '').trim() || undefined,
            });

            if (result.success) {
                setState('success');
                window.setTimeout(() => {
                    window.location.assign(`/view/${token}?t=${Date.now()}`);
                }, 450);
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

    // OTP cells: visible while entering (1s after verify starts), then hide during processing
    useEffect(() => {
        if (state !== 'loading' || step !== 'otp') {
            setCellsVisible(true);
            return;
        }

        setCellsVisible(true);
        const timer = window.setTimeout(() => setCellsVisible(false), 1000);
        return () => window.clearTimeout(timer);
    }, [state, step]);

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

    // SECURITY: Requires authentication — match /auth/signin card design
    if (accessState === 'requires_auth') {
        return (
            <main className={`${styles.page} ${styles.pageSignin}`}>
                <article className={styles.signinCard}>
                    <p className={styles.kicker}>Share session</p>
                    <h1 className={styles.signinTitle}>Welcome back</h1>
                    <p className={styles.signinSub}>
                        This share is locked to an authorized recipient. Sign in with Google to continue.
                    </p>

                    <button
                        type="button"
                        onClick={() => signIn('google', { callbackUrl: `/share/${token}` })}
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

                    <div className={styles.trust}>
                        <Shield size={16} strokeWidth={2} />
                        <span>Only the named vendor can open this link.</span>
                    </div>

                    <div className={styles.signinFoot}>
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

    // SECURITY: Access denied — wrong email or link issues
    if (accessState === 'denied') {
        const isRevoked = accessError.includes('revoked');
        const isExpired = accessError.includes('expired');
        const isEmailMismatch = accessError.includes('different recipient');
        const title = isRevoked
            ? 'Access revoked'
            : isExpired
                ? 'Link expired'
                : isEmailMismatch
                    ? 'Wrong account'
                    : 'Access denied';
        const tone = isRevoked || isEmailMismatch ? 'hot' : isExpired ? 'ash' : 'cool';

        const toneClass =
            tone === 'hot' ? styles.gate_hot : tone === 'ash' ? styles.gate_ash : styles.gate_cool;

        return (
            <main className={`${styles.page} ${styles.pageSignin}`}>
                <article className={`${styles.gateCard} ${toneClass}`}>
                    <p className={styles.kicker}>OTP gate</p>

                    <div className={styles.deadSeal} aria-hidden="true">
                        <span className={styles.deadRipple} />
                        <span className={styles.deadRipple} />
                        <span className={styles.deadRing} />
                        <span className={styles.deadCrack} />
                        <span className={styles.deadCore}>
                            <Lock size={22} strokeWidth={2.25} />
                        </span>
                        {Array.from({ length: 8 }).map((_, i) => (
                            <span
                                key={i}
                                className={styles.deadAsh}
                                style={{ ['--i' as string]: i }}
                            />
                        ))}
                    </div>

                    <h1 className={styles.signinTitle}>{title}</h1>
                    <p className={styles.signinSub}>{accessError}</p>

                    {isEmailMismatch ? (
                        <div className={styles.gateWarn}>
                            <Shield size={18} strokeWidth={2} />
                            <div>
                                <strong>Security notice</strong>
                                <p>
                                    This link was created for a specific vendor. Ask the sender to issue a
                                    new share to your email if this looks wrong.
                                </p>
                            </div>
                        </div>
                    ) : null}

                    <Link href="/" className={styles.gateHome}>
                        Return Home
                    </Link>

                    <div className={styles.trust}>
                        <Shield size={16} strokeWidth={2} />
                        <span>
                            {isExpired
                                ? 'Expired shares wipe payload and OTP — nothing left to reopen.'
                                : isRevoked
                                    ? 'The owner closed this vault. A fresh link is required.'
                                    : 'Only the named vendor can open a Secure Protocol share.'}
                        </span>
                    </div>
                </article>
            </main>
        );
    }

    // Dynamic Step Resolver to prevent rendering flash/race conditions
    const isStepOtp = step === 'otp';

    const meterOffset = 100.53 * (1 - Math.max(0, countdown) / 300);
    const meterTone = countdown <= 30 ? styles.meterHot : countdown <= 60 ? styles.meterWarn : '';

    return (
        <main className={state === 'success' ? `${styles.page} ${styles.pageSignin}` : styles.page}>
            {state !== 'success' ? <div className={styles.wash} /> : null}
            {state === 'success' ? (
                <article className={`${styles.gateCard} ${styles.gate_open}`}>
                    <p className={styles.kicker}>OTP gate</p>

                    <div className={styles.openSeal} aria-hidden="true">
                        <span className={styles.openRipple} />
                        <span className={styles.openRipple} />
                        <span className={styles.openRipple} />
                        <span className={styles.openRing} />
                        <span className={styles.openHalo} />
                        <span className={styles.openCore}>
                            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <path
                                    className={styles.openCheck}
                                    d="M5 12.5l4.2 4.2L19 7"
                                    stroke="currentColor"
                                    strokeWidth="2.6"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                />
                            </svg>
                        </span>
                        {Array.from({ length: 6 }).map((_, i) => (
                            <span
                                key={i}
                                className={styles.openSat}
                                style={{ ['--i' as string]: i }}
                            />
                        ))}
                        {Array.from({ length: 10 }).map((_, i) => (
                            <span
                                key={`spark-${i}`}
                                className={styles.openSpark}
                                style={{ ['--i' as string]: i }}
                            />
                        ))}
                    </div>

                    <h1 className={styles.signinTitle}>Share unlocked</h1>
                    <p className={styles.signinSub}>Vault open — taking you in…</p>

                    <div className={styles.openBar} aria-hidden="true">
                        <span className={styles.openBarFill} />
                    </div>

                    <div className={styles.trust}>
                        <Shield size={16} strokeWidth={2} />
                        <span>Seals matched. Routing you into the secure viewer.</span>
                    </div>
                </article>
            ) : (
            <div className={styles.card}>
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
                                    className={[
                                        styles.vault,
                                        state === 'loading' ? styles.vaultChecking : '',
                                        shake || state === 'error' ? styles.vaultBad : '',
                                        otp.every((d) => d) && state === 'idle' ? styles.vaultReady : '',
                                    ].filter(Boolean).join(' ')}
                                >
                                    <div
                                        className={styles.sealOrb}
                                        aria-hidden="true"
                                        style={{ ['--filled' as string]: otp.filter(Boolean).length }}
                                    >
                                        <span className={styles.orbRipple} />
                                        <span className={styles.orbRipple} />
                                        <span className={styles.orbCore}>
                                            <span className={styles.orbCount}>{otp.filter(Boolean).length}</span>
                                            <span className={styles.orbOf}>/6</span>
                                        </span>
                                        {Array.from({ length: 6 }).map((_, i) => (
                                            <span
                                                key={i}
                                                className={[
                                                    styles.orbSat,
                                                    otp[i] ? styles.orbSatOn : '',
                                                ].filter(Boolean).join(' ')}
                                                style={{ ['--i' as string]: i }}
                                            />
                                        ))}
                                    </div>

                                    <div
                                        className={[
                                            styles.cells,
                                            !cellsVisible ? styles.cellsHidden : '',
                                        ].filter(Boolean).join(' ')}
                                        aria-hidden={!cellsVisible}
                                    >
                                        {otp.map((digit, index) => (
                                            <label
                                                key={index}
                                                className={[
                                                    styles.cell,
                                                    digit ? styles.cellFilled : '',
                                                    activeIndex === index && state !== 'loading' ? styles.cellActive : '',
                                                ].filter(Boolean).join(' ')}
                                                style={{ ['--i' as string]: index }}
                                            >
                                                <span className={styles.cellRing} aria-hidden="true" />
                                                <input
                                                    ref={(el) => { inputRefs.current[index] = el; }}
                                                    type="text"
                                                    inputMode="numeric"
                                                    pattern="[0-9]*"
                                                    maxLength={1}
                                                    value={digit}
                                                    onChange={(e) => handleChange(index, e.target.value)}
                                                    onKeyDown={(e) => handleKeyDown(index, e)}
                                                    onPaste={handlePaste}
                                                    onFocus={() => setActiveIndex(index)}
                                                    className={styles.cellInput}
                                                    disabled={state === 'loading' || countdown <= 0 || !cellsVisible}
                                                    tabIndex={cellsVisible ? 0 : -1}
                                                    autoComplete={index === 0 ? 'one-time-code' : 'off'}
                                                    aria-label={`Digit ${index + 1}`}
                                                />
                                                {digit ? (
                                                    <span className={styles.cellDigit} aria-hidden="true">{digit}</span>
                                                ) : (
                                                    <span className={styles.cellGhost} aria-hidden="true">·</span>
                                                )}
                                            </label>
                                        ))}
                                    </div>

                                    <p className={styles.sealLabel}>
                                        {state === 'loading'
                                            ? 'Matching seals across the vault…'
                                            : state === 'error'
                                                ? 'Seal rejected — try again'
                                                : otp.every((d) => d)
                                                    ? 'All seals set — unlocking'
                                                    : `${otp.filter(Boolean).length} of 6 seals set`}
                                    </p>
                                </div>

                                {error ? <p className={styles.error}>{error}</p> : null}
                                <button
                                    type="button"
                                    onClick={handleSubmit}
                                    disabled={state === 'loading' || countdown <= 0 || otp.some((d) => !d)}
                                    className={`${styles.go} ${state === 'loading' ? styles.busy : ''}`}
                                >
                                    {state === 'loading' ? <span className={styles.spin} /> : <Lock size={16} />}
                                    {state === 'loading' ? 'Sealing…' : state === 'error' ? 'Try again' : 'Unlock'}
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
            </div>
            )}
        </main>
    );
}