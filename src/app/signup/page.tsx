'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createSecureLinkWithFiles } from '@/actions/create-link-with-files';
import QRCode from 'qrcode';

interface FormDataState {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    gender: string;
    age: string;
    validityMinutes: string;
}

export default function SignupPage() {
    const router = useRouter();
    const [formData, setFormData] = useState<FormDataState>({
        firstName: '',
        lastName: '',
        email: '',
        phone: '',
        gender: '',
        age: '',
        validityMinutes: '',
    });
    const [files, setFiles] = useState<FileList | null>(null);
    const [generatedLink, setGeneratedLink] = useState('');
    const [otp, setOtp] = useState('');
    const [ownerUrl, setOwnerUrl] = useState('');
    const [status, setStatus] = useState({ message: '', type: '' });
    const [isLoading, setIsLoading] = useState(false);
    const [qrDataUrl, setQrDataUrl] = useState('');
    const [countdown, setCountdown] = useState<number | null>(null);
    const countdownRef = useRef<NodeJS.Timeout | null>(null);

    // Force refresh on mount to clear any cached data
    useEffect(() => {
        router.refresh();
    }, [router]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFiles(e.target.files);
    };

    const validateForm = (): string | null => {
        if (!formData.firstName) return 'First name is required';
        if (!formData.lastName) return 'Last name is required';
        if (!formData.email) return 'Email is required';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) return 'Invalid email format';
        if (!formData.phone) return 'Phone number is required';
        if (!/^\d{10}$/.test(formData.phone)) return 'Phone must be 10 digits';
        if (!formData.gender) return 'Gender is required';
        if (!formData.age) return 'Age is required';
        if (!formData.validityMinutes) return 'Time in minutes is required';
        const minutes = parseInt(formData.validityMinutes);
        if (isNaN(minutes) || minutes <= 0) return 'Time must be a positive number';
        return null;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setStatus({ message: '', type: '' });

        const error = validateForm();
        if (error) {
            setStatus({ message: error, type: 'error' });
            return;
        }

        setIsLoading(true);

        try {
            const data = new FormData();
            Object.entries(formData).forEach(([key, value]) => {
                data.append(key, value);
            });

            if (files) {
                for (let i = 0; i < files.length; i++) {
                    data.append('files', files[i]);
                }
            }

            const result = await createSecureLinkWithFiles(data);

            if (result.success && result.shareUrl && result.otp) {
                // Refresh router cache to ensure fresh data on next navigation
                router.refresh();
                
                // Add timestamp to share URL to prevent caching
                const shareUrlWithTimestamp = `${result.shareUrl}${result.shareUrl.includes('?') ? '&' : '?'}t=${Date.now()}`;
                
                setGeneratedLink(shareUrlWithTimestamp);
                setOtp(result.otp);
                setOwnerUrl(result.ownerUrl || '');
                setStatus({ message: 'Link generated successfully! OTP shown below.', type: 'success' });

                // Generate QR code
                const qr = await QRCode.toDataURL(result.shareUrl);
                setQrDataUrl(qr);

                // Start countdown
                if (result.expiresAt) {
                    startCountdown(new Date(result.expiresAt));
                }
            } else {
                setStatus({ message: result.error || 'Failed to generate link', type: 'error' });
            }
        } catch (err: any) {
            console.error('Upload Error:', err);
            setStatus({
                message: err?.message || 'Request failed. Please check your connection or file size.',
                type: 'error'
            });
        } finally {
            setIsLoading(false);
        }
    };

    const startCountdown = (expiryDate: Date) => {
        if (countdownRef.current) {
            clearInterval(countdownRef.current);
        }

        const updateCountdown = () => {
            const now = Date.now();
            const diff = expiryDate.getTime() - now;

            if (diff <= 0) {
                setCountdown(0);
                if (countdownRef.current) {
                    clearInterval(countdownRef.current);
                }
                return;
            }

            setCountdown(Math.floor(diff / 1000));
        };

        updateCountdown();
        countdownRef.current = setInterval(updateCountdown, 1000);
    };

    const formatCountdown = (seconds: number): string => {
        if (seconds <= 0) return 'Expired';
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}m ${secs.toString().padStart(2, '0')}s`;
    };

    const copyToClipboard = async () => {
        if (!generatedLink) return;
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(generatedLink);
            } else {
                const textArea = document.createElement('textarea');
                textArea.value = generatedLink;
                textArea.style.position = 'fixed';
                textArea.style.left = '-999999px';
                textArea.style.top = '-999999px';
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
            }
            setStatus({ message: 'Link copied!', type: 'success' });
            setTimeout(() => {
                if (otp) {
                    setStatus({ message: 'Link generated successfully! OTP shown below.', type: 'success' });
                }
            }, 1500);
        } catch (err) {
            console.error('Copy failed:', err);
            setStatus({ message: 'Failed to copy. Please select and copy manually.', type: 'error' });
        }
    };

    useEffect(() => {
        return () => {
            if (countdownRef.current) {
                clearInterval(countdownRef.current);
            }
        };
    }, []);

    return (
        <main className="signup-page">
            <section className="signup-section">
                <div className="container">
                    <div className="signup-container">
                        {/* Header */}
                        <div className="signup-header">
                            <h1 className="signup-page-title">
                                Create <span className="gradient-text">Secure Link</span>
                            </h1>
                            <p className="signup-page-subtitle">
                                Fill in the details below to generate an encrypted, time-limited link
                            </p>
                        </div>

                        {/* Form Card */}
                        <div className="signup-form-card">
                            <form onSubmit={handleSubmit} className="signup-form">
                                {/* Personal Information Section */}
                                <div className="form-section">
                                    <h3 className="form-section-title">
                                        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                                            <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                                        </svg>
                                        <span>Personal Information</span>
                                    </h3>

                                    <div className="form-row">
                                        <div className="form-group">
                                            <label className="form-label">First Name</label>
                                            <input
                                                type="text"
                                                name="firstName"
                                                value={formData.firstName}
                                                onChange={handleChange}
                                                className="form-input"
                                                placeholder="John"
                                            />
                                        </div>

                                        <div className="form-group">
                                            <label className="form-label">Last Name</label>
                                            <input
                                                type="text"
                                                name="lastName"
                                                value={formData.lastName}
                                                onChange={handleChange}
                                                className="form-input"
                                                placeholder="Doe"
                                            />
                                        </div>
                                    </div>

                                    <div className="form-group">
                                        <label className="form-label">Email Address</label>
                                        <input
                                            type="email"
                                            name="email"
                                            value={formData.email}
                                            onChange={handleChange}
                                            className="form-input"
                                            placeholder="john.doe@example.com"
                                        />
                                    </div>

                                    <div className="form-row">
                                        <div className="form-group">
                                            <label className="form-label">Phone Number</label>
                                            <input
                                                type="tel"
                                                name="phone"
                                                value={formData.phone}
                                                onChange={handleChange}
                                                className="form-input"
                                                placeholder="1234567890"
                                                maxLength={10}
                                            />
                                        </div>

                                        <div className="form-group">
                                            <label className="form-label">Age</label>
                                            <input
                                                type="number"
                                                name="age"
                                                value={formData.age}
                                                onChange={handleChange}
                                                className="form-input"
                                                placeholder="25"
                                                min={1}
                                            />
                                        </div>
                                    </div>

                                    <div className="form-group">
                                        <label className="form-label">Gender</label>
                                        <select
                                            name="gender"
                                            value={formData.gender}
                                            onChange={handleChange}
                                            className="form-select"
                                        >
                                            <option value="" disabled>Select gender</option>
                                            <option value="male">Male</option>
                                            <option value="female">Female</option>
                                            <option value="other">Other</option>
                                        </select>
                                    </div>
                                </div>

                                {/* Security Settings Section */}
                                <div className="form-section">
                                    <h3 className="form-section-title">
                                        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                                            <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                                        </svg>
                                        <span>Security Settings</span>
                                    </h3>

                                    <div className="form-group">
                                        <label className="form-label">Link Expiration (Minutes)</label>
                                        <input
                                            type="number"
                                            name="validityMinutes"
                                            value={formData.validityMinutes}
                                            onChange={handleChange}
                                            className="form-input"
                                            placeholder="15"
                                            min={1}
                                        />
                                        <small className="form-hint">
                                            Link will automatically expire after this duration
                                        </small>
                                    </div>

                                    <div className="form-group">
                                        <label className="form-label">Attach Files (Optional)</label>
                                        <div className="file-upload-wrapper">
                                            <input
                                                type="file"
                                                multiple
                                                onChange={handleFileChange}
                                                className="file-input"
                                                accept=".xls,.xlsx,.csv,.png,.jpg,.jpeg,.pdf,.txt"
                                                id="file-upload"
                                            />
                                            <label htmlFor="file-upload" className="file-upload-label">
                                                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                                                    <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                                                </svg>
                                                <span>{files && files.length > 0 ? `${files.length} file(s) selected` : 'Choose files to upload'}</span>
                                            </label>
                                        </div>
                                        <small className="form-hint">
                                            Max 15MB per file. Supported: Images, PDF, Excel, CSV, Text
                                        </small>
                                    </div>
                                </div>

                                {/* Status Message */}
                                {status.message && (
                                    <div className={`status-message status-${status.type}`}>
                                        {status.type === 'success' ? (
                                            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                            </svg>
                                        ) : (
                                            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                            </svg>
                                        )}
                                        <span>{status.message}</span>
                                    </div>
                                )}

                                {/* Submit Button */}
                                <button
                                    type="submit"
                                    disabled={isLoading}
                                    className="btn btn-primary btn-large btn-full"
                                >
                                    {isLoading ? (
                                        <>
                                            <div className="button-spinner"></div>
                                            <span>Generating Secure Link...</span>
                                        </>
                                    ) : (
                                        <>
                                            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                                                <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                                            </svg>
                                            <span>Generate Secure Link</span>
                                        </>
                                    )}
                                </button>
                            </form>

                            {/* Results Section */}
                            {generatedLink && (
                                <div className="results-section">
                                    {/* Generated Link */}
                                    <div className="result-card">
                                        <div className="result-header">
                                            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                                                <path fillRule="evenodd" d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z" clipRule="evenodd" />
                                            </svg>
                                            <h4>Secure Link</h4>
                                        </div>
                                        <div className="link-display">
                                            <input
                                                type="text"
                                                value={generatedLink}
                                                readOnly
                                                className="link-input"
                                            />
                                            <button onClick={copyToClipboard} className="btn btn-secondary">
                                                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                                    <path d="M4 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V2Z" />
                                                    <path d="M2 5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-1h1v1a3 3 0 0 1-3 3H2a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h1v1H2Z" />
                                                </svg>
                                                Copy
                                            </button>
                                        </div>
                                    </div>

                                    {/* OTP Display */}
                                    {otp && (
                                        <div className="result-card result-card-success">
                                            <div className="result-header">
                                                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                                                    <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                                                </svg>
                                                <h4>One-Time Password (OTP)</h4>
                                            </div>
                                            <div className="otp-display">
                                                {otp}
                                            </div>
                                            <p className="result-hint">
                                                Share this OTP separately with the recipient (not with the link)
                                            </p>
                                        </div>
                                    )}

                                    {/* QR Code */}
                                    {qrDataUrl && (
                                        <div className="result-card">
                                            <div className="result-header">
                                                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                                                    <path fillRule="evenodd" d="M3 4a1 1 0 011-1h3a1 1 0 011 1v3a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm2 2V5h1v1H5zM3 13a1 1 0 011-1h3a1 1 0 011 1v3a1 1 0 01-1 1H4a1 1 0 01-1-1v-3zm2 2v-1h1v1H5zM13 3a1 1 0 00-1 1v3a1 1 0 001 1h3a1 1 0 001-1V4a1 1 0 00-1-1h-3zm1 2v1h1V5h-1z" clipRule="evenodd" />
                                                    <path d="M11 4a1 1 0 10-2 0v1a1 1 0 002 0V4zM10 7a1 1 0 011 1v1h2a1 1 0 110 2h-3a1 1 0 01-1-1V8a1 1 0 011-1zM16 9a1 1 0 100 2 1 1 0 000-2zM9 13a1 1 0 011-1h1a1 1 0 110 2v2a1 1 0 11-2 0v-3zM7 11a1 1 0 100-2H4a1 1 0 100 2h3zM17 13a1 1 0 01-1 1h-2a1 1 0 110-2h2a1 1 0 011 1zM16 17a1 1 0 100-2h-3a1 1 0 100 2h3z" />
                                                </svg>
                                                <h4>QR Code</h4>
                                            </div>
                                            <div className="qr-display">
                                                <img src={qrDataUrl} alt="QR Code" />
                                            </div>
                                        </div>
                                    )}

                                    {/* Countdown Timer */}
                                    {countdown !== null && (
                                        <div className={`result-card ${countdown <= 0 ? 'result-card-danger' : countdown < 300 ? 'result-card-warning' : ''}`}>
                                            <div className="result-header">
                                                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                                                </svg>
                                                <h4>{countdown <= 0 ? 'Link Expired' : 'Time Remaining'}</h4>
                                            </div>
                                            <div className="countdown-display">
                                                {formatCountdown(countdown)}
                                            </div>
                                            {countdown <= 0 && (
                                                <p className="result-hint">
                                                    This link has expired. Generate a new one if needed.
                                                </p>
                                            )}
                                        </div>
                                    )}

                                    {/* Owner Dashboard Link */}
                                    {ownerUrl && (
                                        <div className="result-card result-card-warning">
                                            <div className="result-header">
                                                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                                                    <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
                                                </svg>
                                                <h4>Owner Dashboard (Kill Switch)</h4>
                                            </div>
                                            <p className="result-hint" style={{ marginBottom: '12px' }}>
                                                Save this link to revoke access anytime:
                                            </p>
                                            <a href={ownerUrl} target="_blank" className="dashboard-link">
                                                {ownerUrl}
                                            </a>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Back Button */}
                        <div className="signup-footer">
                            {generatedLink ? (
                                <button
                                    onClick={() => {
                                        // Clear all state
                                        setGeneratedLink('');
                                        setOtp('');
                                        setOwnerUrl('');
                                        setQrDataUrl('');
                                        setCountdown(null);
                                        setStatus({ message: '', type: '' });
                                        setFormData({
                                            firstName: '',
                                            lastName: '',
                                            email: '',
                                            phone: '',
                                            gender: '',
                                            age: '',
                                            validityMinutes: '',
                                        });
                                        setFiles(null);
                                        // Force full page reload to clear all caches
                                        window.location.href = `/signup?t=${Date.now()}`;
                                    }}
                                    className="btn btn-primary"
                                >
                                    <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                                        <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                                    </svg>
                                    <span>Create Another Secure Link</span>
                                </button>
                            ) : (
                                <Link href="/services" className="btn btn-secondary">
                                    <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                                        <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
                                    </svg>
                                    <span>Back to Services</span>
                                </Link>
                            )}
                        </div>
                    </div>
                </div>
            </section>
        </main>
    );
}
