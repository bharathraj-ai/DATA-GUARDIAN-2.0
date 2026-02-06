'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
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
                setGeneratedLink(result.shareUrl);
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
            // Try modern clipboard API first (requires HTTPS or localhost)
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(generatedLink);
            } else {
                // Fallback for HTTP: use textarea + execCommand
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
        <section className="signup-wrapper">
            <div className="signup-card">
                <h1 className="signup-title">Sign Up</h1>

                <form onSubmit={handleSubmit}>
                    <div className="mb-2">
                        <label className="form-label">First Name</label>
                        <input
                            type="text"
                            name="firstName"
                            value={formData.firstName}
                            onChange={handleChange}
                            className="form-input"
                            placeholder="Your first name"
                        />
                    </div>

                    <div className="mb-2">
                        <label className="form-label">Last Name</label>
                        <input
                            type="text"
                            name="lastName"
                            value={formData.lastName}
                            onChange={handleChange}
                            className="form-input"
                            placeholder="Your last name"
                        />
                    </div>

                    <div className="mb-2">
                        <label className="form-label">Email</label>
                        <input
                            type="email"
                            name="email"
                            value={formData.email}
                            onChange={handleChange}
                            className="form-input"
                            placeholder="you@example.com"
                        />
                    </div>

                    <div className="mb-2">
                        <label className="form-label">Mobile Number</label>
                        <input
                            type="tel"
                            name="phone"
                            value={formData.phone}
                            onChange={handleChange}
                            className="form-input"
                            placeholder="10-digit mobile number"
                            maxLength={10}
                        />
                    </div>

                    <div className="mb-2">
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

                    <div className="mb-2">
                        <label className="form-label">Age</label>
                        <input
                            type="number"
                            name="age"
                            value={formData.age}
                            onChange={handleChange}
                            className="form-input"
                            placeholder="Enter age"
                            min={1}
                        />
                    </div>

                    <div className="mb-2">
                        <label className="form-label">Time in Minutes</label>
                        <input
                            type="number"
                            name="validityMinutes"
                            value={formData.validityMinutes}
                            onChange={handleChange}
                            className="form-input"
                            placeholder="Link expiry time"
                            min={1}
                        />
                    </div>

                    <div className="mb-3">
                        <label className="form-label">Attach Files (Optional)</label>
                        <div className="file-input-wrapper" style={{ position: 'relative' }}>
                            <input
                                type="file"
                                multiple
                                onChange={handleFileChange}
                                className="form-input"
                                style={{ padding: '10px' }}
                                accept=".xls,.xlsx,.csv,.png,.jpg,.jpeg,.pdf,.txt"
                            />
                        </div>
                        <small style={{ color: '#aaa', fontSize: '12px', display: 'block', marginTop: '5px' }}>
                            Max 15MB per file. Images, PDF, Excel, CSV, Text.
                        </small>
                        {files && files.length > 0 && (
                            <div style={{ marginTop: '5px', fontSize: '12px', color: '#fff' }}>
                                {files.length} file(s) selected
                            </div>
                        )}
                    </div>

                    {/* Generated Link */}
                    <div className="mb-3">
                        <label className="form-label">Generated Link</label>
                        <div className="d-flex gap-2">
                            <input
                                type="text"
                                value={generatedLink}
                                readOnly
                                className="form-input"
                                placeholder="Auto-generated link"
                                style={{ flex: 1 }}
                            />
                            <button
                                type="button"
                                onClick={copyToClipboard}
                                className="btn btn-outline-light"
                            >
                                Copy
                            </button>
                        </div>

                        {status.message && (
                            <div
                                style={{
                                    marginTop: '10px',
                                    fontSize: '14px',
                                    color: status.type === 'success' ? '#28a745' : '#dc3545',
                                }}
                            >
                                {status.message}
                            </div>
                        )}
                    </div>

                    {/* OTP Display */}
                    {otp && (
                        <div className="mb-3" style={{
                            background: 'rgba(40, 167, 69, 0.2)',
                            padding: '15px',
                            borderRadius: '8px',
                            border: '1px solid #28a745'
                        }}>
                            <label className="form-label" style={{ color: '#28a745' }}>
                                🔐 One-Time Password (OTP)
                            </label>
                            <div style={{
                                fontSize: '32px',
                                fontFamily: 'monospace',
                                letterSpacing: '8px',
                                fontWeight: 'bold',
                                color: '#28a745'
                            }}>
                                {otp}
                            </div>
                            <p style={{ fontSize: '12px', marginTop: '8px', opacity: 0.8 }}>
                                Share this OTP separately with the recipient (not with the link)
                            </p>
                        </div>
                    )}

                    {/* Owner Dashboard Link */}
                    {ownerUrl && (
                        <div className="mb-3" style={{
                            background: 'rgba(255, 193, 7, 0.2)',
                            padding: '15px',
                            borderRadius: '8px',
                            border: '1px solid #ffc107'
                        }}>
                            <label className="form-label" style={{ color: '#ffc107' }}>
                                🛡️ Owner Dashboard (Kill Switch)
                            </label>
                            <p style={{ fontSize: '12px', marginBottom: '8px' }}>
                                Save this link to revoke access anytime:
                            </p>
                            <a
                                href={ownerUrl}
                                target="_blank"
                                style={{
                                    color: '#ffc107',
                                    wordBreak: 'break-all',
                                    fontSize: '12px'
                                }}
                            >
                                {ownerUrl}
                            </a>
                        </div>
                    )}

                    {/* QR Code */}
                    {qrDataUrl && (
                        <div className="mb-3 text-center">
                            <label className="form-label">QR Code</label>
                            <div className="qr-container" style={{ margin: '0 auto' }}>
                                <img src={qrDataUrl} alt="QR Code" style={{ width: '180px', height: '180px' }} />
                            </div>
                        </div>
                    )}

                    {/* Countdown */}
                    {countdown !== null && (
                        <div className="mb-3 text-center">
                            <label className="form-label">
                                {countdown <= 0 ? 'Link Status' : 'Link expires in'}
                            </label>
                            <div className="countdown" style={{
                                color: countdown <= 0 ? '#dc3545' : '#ffc107'
                            }}>
                                {formatCountdown(countdown)}
                            </div>
                            {countdown <= 0 && (
                                <p style={{ fontSize: '12px', color: '#dc3545', marginTop: '8px' }}>
                                    This link has expired. Generate a new one if needed.
                                </p>
                            )}
                        </div>
                    )}

                    {/* Submit Button */}
                    <button
                        type="submit"
                        disabled={isLoading}
                        className="btn btn-primary"
                        style={{ width: '100%', marginBottom: '15px' }}
                    >
                        {isLoading ? 'Generating...' : 'Generate Secure Link'}
                    </button>
                </form>

                {/* Back Button */}
                <div className="text-center">
                    <Link href="/services" className="btn btn-warning">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                            <path fillRule="evenodd" d="M15 8a.5.5 0 0 0-.5-.5H2.707l3.147-3.146a.5.5 0 1 0-.708-.708l-4 4a.5.5 0 0 0 0 .708l4 4a.5.5 0 0 0 .708-.708L2.707 8.5H14.5A.5.5 0 0 0 15 8" />
                        </svg>
                        Back
                    </Link>
                </div>
            </div>
        </section>
    );
}
