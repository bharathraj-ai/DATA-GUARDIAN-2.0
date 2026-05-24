'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { verifyOTP } from '@/actions/verify-otp';
import { validateShareAccess } from '@/actions/validate-share-access';
import { sendVendorOTP } from '@/actions/send-vendor-otp';
import { useSession, signIn } from 'next-auth/react';

interface SharePageProps {
    params: any;
}

type VerificationState = 'idle' | 'loading' | 'success' | 'error';
type AccessState = 'checking' | 'allowed' | 'denied' | 'requires_auth';

export default function SharePage({ params }: SharePageProps) {
    const router = useRouter();
    const { data: sessionData, status } = useSession();
    const [token, setToken] = useState<string>('');
    const [step, setStep] = useState<'email' | 'otp'>('email');
    const [email, setEmail] = useState<string>('');
    const [otp, setOtp] = useState<string[]>(['', '', '', '', '', '']);
    const [state, setState] = useState<VerificationState>('idle');
    const [error, setError] = useState<string>('');
    const [accessError, setAccessError] = useState<string>('');
    const [remainingAttempts, setRemainingAttempts] = useState(1);
    const [countdown, setCountdown] = useState(300); // 5 minutes
    const [shake, setShake] = useState(false);
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

    // Auto-detect session email to auto-fill and skip to OTP step
    useEffect(() => {
        if (accessState === 'allowed' && sessionData?.user?.email) {
            setEmail(sessionData.user.email);
            setStep('otp');
        }
    }, [accessState, sessionData]);

    // Resolve params
    useEffect(() => {
        params.then((p: any) => {
            console.log('Token resolved:', p.token);
            // Remove any query parameters (like timestamp) from token
            const cleanToken = p.token.split('?')[0];
            setToken(cleanToken);
        }).catch((err: any) => {
            console.error('Failed to resolve params:', err);
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

    // Countdown timer
    useEffect(() => {
        if (countdown <= 0 || accessState !== 'allowed') return;
        const timer = setInterval(() => {
            setCountdown((prev) => Math.max(0, prev - 1));
        }, 1000);
        return () => clearInterval(timer);
    }, [countdown, accessState]);

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

    const getTimerClass = (): string => {
        if (countdown <= 30) return 'timer-danger';
        if (countdown <= 60) return 'timer-warning';
        return 'timer-safe';
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
                setCountdown(300); // 5 minutes fresh timer
            } else {
                setState('error');
                setError(result.error || 'Failed to request OTP');
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

        try {
            const result = await verifyOTP({ token, otp: otpString, email: email || undefined });

            if (result.success) {
                setState('success');
                // Force full page navigation to bypass all caches
                setTimeout(() => {
                    window.location.href = `/view/${token}?t=${Date.now()}`;
                }, 1200);
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
            <main className="otp-wrapper">
                <div className="otp-card">
                    <div className="loading-spinner" />
                    <p className="loading-text">Validating access permissions...</p>
                </div>
            </main>
        );
    }

    // SECURITY: Requires authentication — show sign-in prompt
    if (accessState === 'requires_auth') {
        return (
            <main className="otp-wrapper">
                <div className="bg-orb bg-orb-1" />
                <div className="bg-orb bg-orb-2" />
                <div className="bg-grid" />

                <div className="otp-card">
                    <div className="otp-header">
                        <div className="lock-icon">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                            </svg>
                        </div>
                        <h1 className="otp-title">Authentication Required</h1>
                        <p className="otp-subtitle">
                            This secure link is restricted to an authorized recipient.
                            Please sign in with Google to verify your identity.
                        </p>
                    </div>

                    <button
                        onClick={() => signIn('google', { callbackUrl: `/share/${token}` })}
                        className="otp-button idle"
                        style={{ marginTop: '24px' }}
                    >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: '20px', height: '20px' }}>
                            <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                            <polyline points="10 17 15 12 10 7" />
                            <line x1="15" y1="12" x2="3" y2="12" />
                        </svg>
                        Sign in with Google
                    </button>

                    <div className="security-badge" style={{ marginTop: '24px' }}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                        </svg>
                        <span>Only the authorized recipient can access this link</span>
                    </div>
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
            <main className="otp-wrapper">
                <div className="bg-orb bg-orb-1" />
                <div className="bg-orb bg-orb-2" />
                <div className="bg-grid" />

                <div className="otp-card">
                    <div className="otp-header">
                        <div className="lock-icon" style={{ color: '#ef4444' }}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                {isEmailMismatch ? (
                                    <><circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" /></>
                                ) : (
                                    <><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></>
                                )}
                            </svg>
                        </div>
                        <h1 className="otp-title" style={{ color: '#ef4444' }}>
                            {isRevoked ? 'Access Revoked' : isExpired ? 'Link Expired' : isEmailMismatch ? 'Unauthorized Access' : 'Access Denied'}
                        </h1>
                        <p className="otp-subtitle">{accessError}</p>
                    </div>

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
                                <strong style={{ display: 'block', marginBottom: '4px' }}>🔒 Security Notice</strong>
                                This link was created for a specific vendor. If you believe this is an error,
                                contact the person who shared it with you and ask them to create a new link for your email.
                            </div>
                        </div>
                    )}

                    <button
                        onClick={() => {
                            window.location.href = `/create-link?t=${Date.now()}`;
                        }}
                        className="otp-button idle"
                        style={{ marginTop: '16px' }}
                    >
                        Return Home
                    </button>

                    <div className="security-badge" style={{ marginTop: '24px' }}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </svg>
                        <span>Protected by Secure Protocol V2</span>
                    </div>
                </div>
            </main>
        );
    }

    // Dynamic Step Resolver to prevent rendering flash/race conditions
    const isStepOtp = step === 'otp' || (status === 'authenticated' && !!sessionData?.user?.email);

    // ACCESS GRANTED — Show OTP form (only reaches here if accessState === 'allowed')
    return (
        <main className="otp-wrapper">
            {/* Decorative Background Elements */}
            <div className="bg-orb bg-orb-1" />
            <div className="bg-orb bg-orb-2" />
            <div className="bg-grid" />

            <div className="otp-card">
                {/* Header */}
                <div className="otp-header">
                    <div className={`lock-icon ${state === 'success' ? 'unlocked' : ''}`}>
                        {state === 'success' ? (
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M9 12l2 2 4-4" />
                                <circle cx="12" cy="12" r="10" />
                            </svg>
                        ) : (
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                            </svg>
                        )}
                    </div>
                    <h1 className="otp-title">
                        {state === 'success' ? 'Access Granted' : 'Secure Verification'}
                    </h1>
                    <p className="otp-subtitle">
                        {state === 'success'
                            ? 'Redirecting to protected data...'
                            : 'Enter the 6-digit code to access protected information'
                        }
                    </p>
                </div>

                {/* Timer */}
                {state !== 'success' && (
                    <div className={`otp-timer ${getTimerClass()}`}>
                        <svg className="timer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" />
                            <polyline points="12 6 12 12 16 14" />
                        </svg>
                        <span>
                            {countdown > 0
                                ? `OTP expires in ${formatTime(countdown)}`
                                : 'OTP has expired'
                            }
                        </span>
                    </div>
                )}

                {/* Step 1: Email Input */}
                {!isStepOtp && state !== 'success' && (
                    <div className={`otp-input-container ${shake ? 'shake' : ''}`}>
                        <label className="otp-label">Email Address</label>
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
                            className={`otp-box filled ${error ? 'error' : ''}`}
                            style={{ width: '100%', marginBottom: '16px', fontSize: '16px', padding: '12px' }}
                            placeholder="Enter your email to receive OTP"
                            disabled={state === 'loading'}
                            autoFocus
                        />
                        <button
                            onClick={handleEmailSubmit}
                            disabled={state === 'loading' || !email}
                            className={`otp-button ${state}`}
                            style={{ margin: 0 }}
                        >
                            {state === 'loading' ? (
                                <>
                                    <span className="button-spinner" />
                                    Sending...
                                </>
                            ) : (
                                <>
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                                        <polyline points="22,6 12,13 2,6" />
                                    </svg>
                                    Send Verification Code
                                </>
                            )}
                        </button>
                    </div>
                )}

                {/* Step 2: OTP Input */}
                {isStepOtp && state !== 'success' && (
                    <div className={`otp-input-container ${shake ? 'shake' : ''}`}>
                        <label className="otp-label">{email ? `Enter OTP sent to ${email}` : 'Enter the 6-digit OTP from your email'}</label>
                        <div className="otp-boxes">
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
                                    className={`otp-box ${digit ? 'filled' : ''} ${error ? 'error' : ''}`}
                                    disabled={state === 'loading' || countdown <= 0}
                                    autoComplete="one-time-code"
                                />
                            ))}
                        </div>
                        
                        <button
                            onClick={handleSubmit}
                            disabled={state === 'loading' || countdown <= 0 || otp.some((d) => !d)}
                            className={`otp-button ${state}`}
                            style={{ marginTop: '24px' }}
                        >
                            {state === 'loading' ? (
                                <>
                                    <span className="button-spinner" />
                                    Verifying...
                                </>
                            ) : state === 'error' ? (
                                'Try Again'
                            ) : (
                                <>
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M9 12l2 2 4-4" />
                                        <circle cx="12" cy="12" r="10" />
                                    </svg>
                                    Verify Access
                                </>
                            )}
                        </button>
                    </div>
                )}

                {/* Trust Indicators */}
                <div className="trust-indicators">
                    <div className="trust-item">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                        </svg>
                        <span>Single-use access</span>
                    </div>
                    <div className="trust-item">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" />
                            <polyline points="12 6 12 12 16 14" />
                        </svg>
                        <span>Auto-expires after viewing</span>
                    </div>
                    <div className="trust-item">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                        <span>No data stored after expiry</span>
                    </div>
                </div>

                {/* Anti-Phishing Warning */}
                <div className="phishing-warning" style={{
                    background: 'rgba(251, 191, 36, 0.1)',
                    border: '1px solid rgba(251, 191, 36, 0.3)',
                    borderRadius: '8px',
                    padding: '12px 16px',
                    margin: '16px 0',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '10px'
                }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2" style={{ width: '20px', height: '20px', flexShrink: 0, marginTop: '2px' }}>
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                        <line x1="12" y1="9" x2="12" y2="13" />
                        <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    <div style={{ fontSize: '12px', color: '#fbbf24', lineHeight: '1.4' }}>
                        <strong style={{ display: 'block', marginBottom: '4px' }}>⚠️ Anti-Phishing Notice</strong>
                        We will <strong>never</strong> ask for your OTP via email, phone, or any website other than this page.
                        <br />
                        <span style={{ opacity: 0.8 }}>Verify you are on: <code style={{ background: 'rgba(0,0,0,0.3)', padding: '1px 4px', borderRadius: '3px' }}>{typeof window !== 'undefined' ? window.location.hostname : 'localhost'}</code></span>
                    </div>
                </div>

                {/* Security Badge */}
                <div className="security-badge">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                    <span>Protected by AES-256 encryption</span>
                </div>
            </div>
        </main>
    );
}