'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { createSecureLinkWithFiles } from '@/actions/create-link-with-files';
import { getAvailableVendors, VendorOption } from '@/actions/get-vendors';
import QRCode from 'qrcode';

interface FormDataState {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    gender: string;
    age: string;
    validityMinutes: string;
    validityUnit: 'minutes' | 'hours' | 'days';
    vendors: { email: string; level: number }[]; // Multi-vendor with levels
    vendorEmail: string; 
    topic: string; // Mandatory: describe what data is being shared
    allowEditing: boolean;
}

export default function SignupPage() {
    const router = useRouter();
    const { data: session, status: sessionStatus } = useSession();
    const [formData, setFormData] = useState<FormDataState>({
        firstName: '',
        lastName: '',
        email: '',
        phone: '',
        gender: '',
        age: '',
        validityMinutes: '',
        validityUnit: 'minutes',
        vendors: [{ email: '', level: 1 }],
        vendorEmail: '',
        topic: '',
        allowEditing: false,
    });
    const [files, setFiles] = useState<FileList | null>(null);
    const [generatedLink, setGeneratedLink] = useState('');
    const [ownerUrl, setOwnerUrl] = useState('');
    const [status, setStatus] = useState({ message: '', type: '' });
    const [vendorError, setVendorError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [qrDataUrl, setQrDataUrl] = useState('');
    const [countdown, setCountdown] = useState<number | null>(null);
    const countdownRef = useRef<NodeJS.Timeout | null>(null);
    const [vendors, setVendors] = useState<VendorOption[]>([]);
    const [sharingMode, setSharingMode] = useState<'individual' | 'group'>('individual');
    const [selectedVendors, setSelectedVendors] = useState<{email: string, level: number}[]>([]);
    const [tempVendorEmail, setTempVendorEmail] = useState('');

    // Fetch available vendors on mount
    useEffect(() => {
        async function fetchVendors() {
            const vendorList = await getAvailableVendors();
            setVendors(vendorList);
        }
        fetchVendors();
    }, []);

    // Redirect to sign-in if not authenticated
    useEffect(() => {
        if (sessionStatus === 'unauthenticated') {
            router.push('/auth/signin?callbackUrl=/create-link');
        }
    }, [sessionStatus, router]);

    const userRole = (session?.user as any)?.role as string | undefined;

    // Block VENDOR users from creating links
    useEffect(() => {
        if (sessionStatus === 'authenticated' && userRole === 'VENDOR') {
            router.push('/dashboard/vendor');
        }
    }, [sessionStatus, userRole, router]);

    // Force refresh on mount to clear any cached data
    useEffect(() => {
        router.refresh();
    }, [router]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const value = e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value;
        setFormData({ ...formData, [e.target.name]: value });
    };

    const handleVendorChange = (index: number, field: string, value: string | number) => {
        const newVendors = [...formData.vendors];
        newVendors[index] = { ...newVendors[index], [field]: value };
        setFormData({ ...formData, vendors: newVendors });
    };

    const addVendor = () => {
        setFormData({ ...formData, vendors: [...formData.vendors, { email: '', level: 2 }] });
    };

    const removeVendor = (index: number) => {
        const newVendors = [...formData.vendors];
        newVendors.splice(index, 1);
        setFormData({ ...formData, vendors: newVendors });
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFiles(e.target.files);
    };

    const validateForm = (): string | null => {
        if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) return 'Invalid email format';
        if (formData.phone && !/^\d{10,15}$/.test(formData.phone)) return 'Phone must be 10-15 digits';
        if (!formData.validityMinutes) return 'Time in minutes is required';
        if (!formData.topic.trim()) return 'Topic is required — describe what data you are sharing';
        const minutes = parseInt(formData.validityMinutes);
        if (isNaN(minutes) || minutes <= 0) return 'Time must be a positive number';
        
        // Check total minutes based on units
        let totalMinutes = minutes;
        if (formData.validityUnit === 'hours') totalMinutes *= 60;
        if (formData.validityUnit === 'days') totalMinutes *= 1440;
        
        if (totalMinutes > 10080) return 'Total validity cannot exceed 7 days (10,080 minutes)';

        if (sharingMode === 'individual') {
            if (!formData.vendorEmail) return 'Vendor email is required — specify who you are sending data to';
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.vendorEmail)) {
                return 'Invalid vendor email format';
            }
        } else {
            if (selectedVendors.length === 0) return 'At least one vendor must be selected for group sharing';
        }

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
                if (key === 'vendors' || key === 'vendorEmail' || key === 'validityUnit') {
                    return; // Skip — appended separately below with correct data
                } else if (key === 'validityMinutes') {
                    // Convert to total minutes based on selected unit
                    const mins = parseInt(formData.validityMinutes);
                    let totalMins = mins;
                    if (formData.validityUnit === 'hours') totalMins = mins * 60;
                    else if (formData.validityUnit === 'days') totalMins = mins * 1440;
                    data.append(key, totalMins.toString());
                } else {
                    data.append(key, value as string);
                }
            });
            // Also send topic as 'purpose' for backward compatibility with backend
            data.append('purpose', formData.topic);
            data.append('allowEditing', formData.allowEditing ? 'true' : 'false');
            


            // Backend requires a 'vendors' JSON array
            if (sharingMode === 'individual' && formData.vendorEmail) {
                // Must be level 1 because exactly one Team Leader is required
                data.append('vendors', JSON.stringify([{ email: formData.vendorEmail.toLowerCase(), level: 1 }]));
            } else if (sharingMode === 'group' && selectedVendors.length > 0) {
                // Assign level based on array order (index + 1)
                data.append('vendors', JSON.stringify(selectedVendors.map((v, index) => ({ email: v.email.toLowerCase(), level: index + 1 }))));
            }

            if (files) {
                for (let i = 0; i < files.length; i++) {
                    data.append('files', files[i]);
                }
            }

            const result = await createSecureLinkWithFiles(data);

            if (result.success && result.shareUrl) {
                // Refresh router cache to ensure fresh data on next navigation
                router.refresh();

                setGeneratedLink(result.shareUrl);
                setOwnerUrl(result.ownerUrl || '');
                setStatus({ message: 'Secure link created! OTP sent to vendor\'s email.', type: 'success' });

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
                setStatus({ message: 'Link generated successfully!', type: 'success' });
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
    // Authentication is optional for link creation
    // If signed in, we can pre-fill the notification email
    // Auth is required for VENDORS accessing links, not for OWNERS creating them

    return (
        <main className="app-page">
            <section className="app-section">
                <div className="container">
                    <div className="app-container">
                        {/* Header */}
                        <div className="app-header">
                            <h1 className="app-page-title">
                                Create <span className="gradient-text">Secure Link</span>
                            </h1>
                            <p className="app-page-subtitle">
                                Fill in the details below to generate an encrypted, time-limited link
                            </p>
                        </div>

                        {/* Form Card */}
                        <div className="app-form-card">
                            <form onSubmit={handleSubmit} className="app-form">
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
                                            <option value="">Not specified</option>
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
                                        <label className="form-label">Topic <span style={{ color: 'var(--danger)' }}>*</span></label>
                                        <input
                                            type="text"
                                            name="topic"
                                            value={formData.topic}
                                            onChange={handleChange}
                                            className="form-input"
                                            placeholder="e.g., Tax Documents, Medical Records, Contract Draft..."
                                            required
                                            maxLength={100}
                                        />
                                        <small className="form-hint">
                                            Describe what data you are sharing. This stays in your history even after data is deleted.
                                        </small>
                                    </div>

                                    <div className="form-group">
                                        <label className="form-label">Link Expiration</label>
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <input
                                                type="number"
                                                name="validityMinutes"
                                                value={formData.validityMinutes}
                                                onChange={handleChange}
                                                className="form-input"
                                                placeholder="15"
                                                min={1}
                                                style={{ flex: 1 }}
                                            />
                                            <select
                                                name="validityUnit"
                                                value={formData.validityUnit}
                                                onChange={handleChange}
                                                className="form-select"
                                                style={{ width: '120px' }}
                                            >
                                                <option value="minutes">Minutes</option>
                                                <option value="hours">Hours</option>
                                                <option value="days">Days</option>
                                            </select>
                                        </div>
                                        <small className="form-hint">
                                            Link will automatically expire after this duration (Max 7 days)
                                        </small>
                                    </div>

                                    <div className="form-group">
                                        <label className="form-label">Sharing Mode</label>
                                        <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                                            <button 
                                                type="button" 
                                                className={`btn ${sharingMode === 'individual' ? 'btn-primary' : 'btn-secondary'}`}
                                                onClick={() => setSharingMode('individual')}
                                                style={{ flex: 1, padding: '10px' }}
                                            >
                                                Individual
                                            </button>
                                            <button 
                                                type="button" 
                                                className={`btn ${sharingMode === 'group' ? 'btn-primary' : 'btn-secondary'}`}
                                                onClick={() => setSharingMode('group')}
                                                style={{ flex: 1, padding: '10px' }}
                                            >
                                                Group
                                            </button>
                                        </div>
                                    </div>

                                    {/* Zero Trust: Vendor Binding */}
                                    {sharingMode === 'individual' ? (
                                        <div className="form-group">
                                            <label className="form-label">Vendor Email <span style={{ color: 'var(--danger)' }}>*</span></label>
                                            <input
                                                type="email"
                                                name="vendorEmail"
                                                value={formData.vendorEmail}
                                                onChange={handleChange}
                                                className="form-input"
                                                placeholder="vendor@example.com"
                                                required={sharingMode === 'individual'}
                                                autoComplete="off"
                                                list="vendor-emails"
                                            />
                                            <datalist id="vendor-emails">
                                                {vendors.map((vendor) => (
                                                    <option key={vendor.email} value={vendor.email}>
                                                        {vendor.name || ''}
                                                    </option>
                                                ))}
                                            </datalist>
                                            <small className="form-hint">
                                                Only this email will be able to access the shared data.
                                            </small>
                                        </div>
                                    ) : (
                                        <div className="form-group">
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                                                <label className="form-label" style={{ marginBottom: 0 }}>Select Group Members <span style={{ color: 'var(--danger)' }}>*</span></label>
                                                <span style={{ backgroundColor: selectedVendors.length > 0 ? 'var(--primary)' : 'var(--bg-tertiary)', color: selectedVendors.length > 0 ? 'white' : 'var(--text-secondary)', padding: '2px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: 600 }}>
                                                    {selectedVendors.length} {selectedVendors.length === 1 ? 'Member' : 'Members'} Selected
                                                </span>
                                            </div>
                                            <div style={{ border: '1px solid var(--border)', borderRadius: '8px', padding: '12px', maxHeight: '250px', overflowY: 'auto' }}>
                                                {vendors.length === 0 ? (
                                                    <p style={{ color: 'var(--text-secondary)', textAlign: 'center', margin: '10px 0' }}>No vendors available</p>
                                                ) : vendors.map((vendor) => {
                                                    const isSelected = selectedVendors.some(v => v.email === vendor.email);
                                                    
                                                    return (
                                                        <div key={vendor.email} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px', borderBottom: '1px solid var(--border)', background: isSelected ? 'rgba(99, 102, 241, 0.05)' : 'transparent', borderRadius: '4px' }}>
                                                            <label style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', flex: 1 }}>
                                                                <input 
                                                                    type="checkbox" 
                                                                    checked={isSelected}
                                                                    onChange={(e) => {
                                                                        if (e.target.checked) {
                                                                            setSelectedVendors([...selectedVendors, { email: vendor.email, level: 2 }]);
                                                                        } else {
                                                                            setSelectedVendors(selectedVendors.filter(v => v.email !== vendor.email));
                                                                        }
                                                                    }}
                                                                    style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: 'var(--primary)' }}
                                                                />
                                                                <div>
                                                                    <div style={{ fontWeight: 500, color: 'var(--text-primary)', fontSize: '14px' }}>{vendor.name || vendor.email.split('@')[0]}</div>
                                                                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{vendor.email}</div>
                                                                </div>
                                                            </label>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                            
                                            {/* Arranged Hierarchy UI */}
                                            {selectedVendors.length > 0 && (
                                                <div style={{ marginTop: '16px', borderTop: '1px dashed var(--border)', paddingTop: '16px' }}>
                                                    <label className="form-label" style={{ marginBottom: '8px' }}>
                                                        Arranged Hierarchy <span style={{ color: 'var(--danger)' }}>*</span>
                                                    </label>
                                                    <small className="form-hint" style={{ marginBottom: '12px', display: 'block' }}>
                                                        Use arrows to arrange priority. The top person gets exclusive editing access (Level 1).
                                                    </small>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                        {selectedVendors.map((sv, index) => {
                                                            const vendorObj = vendors.find(v => v.email === sv.email);
                                                            const name = vendorObj?.name || sv.email.split('@')[0];
                                                            
                                                            const moveUp = () => {
                                                                if (index === 0) return;
                                                                const newArr = [...selectedVendors];
                                                                [newArr[index - 1], newArr[index]] = [newArr[index], newArr[index - 1]];
                                                                setSelectedVendors(newArr);
                                                            };
                                                            
                                                            const moveDown = () => {
                                                                if (index === selectedVendors.length - 1) return;
                                                                const newArr = [...selectedVendors];
                                                                [newArr[index + 1], newArr[index]] = [newArr[index], newArr[index + 1]];
                                                                setSelectedVendors(newArr);
                                                            };

                                                            return (
                                                                <div key={sv.email} style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'rgba(255,255,255,0.03)', padding: '10px 14px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)' }}>
                                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                                                        <button type="button" onClick={moveUp} disabled={index === 0} style={{ border: 'none', background: 'transparent', color: 'var(--color-text)', cursor: index === 0 ? 'not-allowed' : 'pointer', opacity: index === 0 ? 0.3 : 1, padding: 0, fontSize: '14px' }}>▲</button>
                                                                        <button type="button" onClick={moveDown} disabled={index === selectedVendors.length - 1} style={{ border: 'none', background: 'transparent', color: 'var(--color-text)', cursor: index === selectedVendors.length - 1 ? 'not-allowed' : 'pointer', opacity: index === selectedVendors.length - 1 ? 0.3 : 1, padding: 0, fontSize: '14px' }}>▼</button>
                                                                    </div>
                                                                    
                                                                    <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: index === 0 ? 'var(--primary)' : 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 'bold' }}>
                                                                        {index + 1}
                                                                    </div>
                                                                    
                                                                    <div style={{ flex: 1 }}>
                                                                        <p style={{ fontSize: '14px', fontWeight: 600, color: index === 0 ? '#60a5fa' : 'var(--text-primary)', margin: 0 }}>
                                                                            {name} {index === 0 ? '(Team Leader)' : ''}
                                                                        </p>
                                                                        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
                                                                            {sv.email}
                                                                        </p>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '16px' }}>
                                        <input
                                            type="checkbox"
                                            id="allowEditing"
                                            name="allowEditing"
                                            checked={formData.allowEditing}
                                            onChange={handleChange}
                                            style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                                        />
                                        <label htmlFor="allowEditing" style={{ cursor: 'pointer', margin: 0, fontSize: '14px', color: 'var(--text-primary)' }}>
                                            Allow vendor to edit files using Universal Editor
                                        </label>
                                    </div>

                                    <div className="form-group" style={{ marginTop: '16px' }}>
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
                                    <div className="result-card result-card-success">
                                        <div className="result-header">
                                            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                                                <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
                                                <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
                                            </svg>
                                            <h4>Link Generated and OTP Sent</h4>
                                        </div>
                                        
                                        <p style={{ color: 'var(--text-secondary)', fontSize: '15px', lineHeight: '1.6', margin: '0 0 16px' }}>
                                            The secure link and OTP have been emailed to:
                                        </p>
                                        <div style={{
                                            background: 'var(--bg-tertiary)',
                                            borderRadius: '8px',
                                            padding: '16px',
                                            textAlign: 'left',
                                            marginBottom: '16px',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: '8px'
                                        }}>
                                            {selectedVendors.length > 0 ? selectedVendors.map((v, idx) => (
                                                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: idx < selectedVendors.length - 1 ? '1px solid #E5E7EB' : 'none', paddingBottom: idx < selectedVendors.length - 1 ? '8px' : '0' }}>
                                                    <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>📧 {v.email}</span>
                                                    <span style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Level {v.level}</span>
                                                </div>
                                            )) : (
                                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                    <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>📧 {formData.vendorEmail}</span>
                                                    <span style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Level 1</span>
                                                </div>
                                            )}
                                        </div>

                                        <p style={{ color: 'var(--text-secondary)', fontSize: '15px', lineHeight: '1.6', margin: '0 0 16px' }}>
                                            Share this link with your vendors manually if needed:
                                        </p>
                                        
                                        <div className="link-display-box" style={{ 
                                            background: 'rgba(0,0,0,0.3)', 
                                            padding: '12px', 
                                            borderRadius: '8px',
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            marginBottom: '16px'
                                        }}>
                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '14px', color: 'var(--primary)' }}>
                                                {generatedLink}
                                            </span>
                                            <button type="button" onClick={copyToClipboard} className="btn-icon" style={{ padding: '6px', background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                                                Copy
                                            </button>
                                        </div>
                                    </div>

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
                        <div className="app-footer">
                            {generatedLink ? (
                                <button
                                    onClick={() => {
                                        // Clear all state
                                        setGeneratedLink('');
                                        setOwnerUrl('');
                                        setQrDataUrl('');
                                        setCountdown(null);
                                        setSelectedVendors([]);
                                        setStatus({ message: '', type: '' });
                                        setSharingMode('individual');
                                        setSelectedVendors([]);
                                        setFormData({
                                            firstName: '',
                                            lastName: '',
                                            email: '',
                                            phone: '',
                                            gender: '',
                                            age: '',
                                            validityMinutes: '',
                                            validityUnit: 'minutes',
                                            vendors: [{ email: '', level: 1 }],
                                            vendorEmail: '',
                                            topic: '',
                                            allowEditing: false,
                                        });
                                        setFiles(null);
                                        // Force full page reload to clear all caches
                                        window.location.href = `/create-link?t=${Date.now()}`;
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
