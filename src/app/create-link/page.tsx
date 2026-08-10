'use client';
import { useState, useEffect, useRef, DragEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { createSecureLinkWithFiles } from '@/actions/create-link-with-files';
import { getAvailableVendors, VendorOption } from '@/actions/get-vendors';
import styles from './page.module.css';
import { 
    Shield, 
    Calendar, 
    Info,
    User, 
    Users, 
    Building2, 
    Mail, 
    Edit3, 
    DownloadCloud, 
    Paperclip, 
    UploadCloud, 
    Lock, 
    ArrowLeft,
    CheckCircle2,
    XCircle,
    FileText,
    X,
    ChevronDown,
    ChevronUp
} from 'lucide-react';

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
    vendorName?: string;
    topic: string; // Mandatory: describe what data is being shared
    message: string; // Optional message to the vendor
    allowEditing: boolean;
    allowDownload: boolean;
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
        validityMinutes: '15',
        validityUnit: 'minutes',
        vendors: [{ email: '', level: 1 }],
        vendorEmail: '',
        topic: '',
        message: '',
        allowEditing: false,
        allowDownload: false,
    });
    const [files, setFiles] = useState<FileList | null>(null);
    const [generatedLink, setGeneratedLink] = useState('');
    const [ownerUrl, setOwnerUrl] = useState('');
    const [status, setStatus] = useState({ message: '', type: '' });
    const [isLoading, setIsLoading] = useState(false);
    const [countdown, setCountdown] = useState<number | null>(null);
    const countdownRef = useRef<NodeJS.Timeout | null>(null);
    const [vendors, setVendors] = useState<VendorOption[]>([]);
    const [sharingMode, setSharingMode] = useState<'individual' | 'group'>('individual');
    const [selectedVendors, setSelectedVendors] = useState<{email: string, level: number}[]>([]);
    const [isVendorDropdownOpen, setIsVendorDropdownOpen] = useState(false);
    
    // Drag and Drop state
    const [isDragging, setIsDragging] = useState(false);

    // Fetch vendors lazily when the dropdown is first opened (not on every page load)
    const ensureVendorsLoaded = async () => {
        if (vendors.length > 0) return;
        const vendorList = await getAvailableVendors();
        setVendors(vendorList);
    };

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

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const value = e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value;
        setFormData({ ...formData, [e.target.name]: value });
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            setFiles(e.target.files);
        }
    };
    
    const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const handleDrop = (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            setFiles(e.dataTransfer.files);
        }
    };

    const removeFile = (index: number) => {
        if (!files) return;
        const dt = new DataTransfer();
        for (let i = 0; i < files.length; i++) {
            if (i !== index) dt.items.add(files[i]);
        }
        setFiles(dt.files.length > 0 ? dt.files : null);
    };

    const validateForm = (): string | null => {
        if (!formData.validityMinutes) return 'Time is required';
        const minutes = parseInt(formData.validityMinutes);
        if (isNaN(minutes) || minutes <= 0) return 'Time must be a positive number';
        
        let totalMinutes = minutes;
        if (formData.validityUnit === 'hours') totalMinutes *= 60;
        if (formData.validityUnit === 'days') totalMinutes *= 1440;
        
        if (totalMinutes > 10080) return 'Total validity cannot exceed 7 days (10,080 minutes)';

        if (sharingMode === 'individual') {
            if (!formData.vendorEmail) return 'Vendor email is required';
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.vendorEmail)) {
                return 'Invalid vendor email format';
            }
        } else {
            if (selectedVendors.length === 0) return 'At least one vendor must be selected for group sharing';
        }

        return null;
    };

    const moveVendorUp = (index: number) => {
        if (index === 0) return;
        const newVendors = [...selectedVendors];
        const temp = newVendors[index - 1];
        newVendors[index - 1] = newVendors[index];
        newVendors[index] = temp;
        setSelectedVendors(newVendors);
    };

    const moveVendorDown = (index: number) => {
        if (index === selectedVendors.length - 1) return;
        const newVendors = [...selectedVendors];
        const temp = newVendors[index + 1];
        newVendors[index + 1] = newVendors[index];
        newVendors[index] = temp;
        setSelectedVendors(newVendors);
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
                    return; 
                } else if (key === 'validityMinutes') {
                    const mins = parseInt(formData.validityMinutes);
                    let totalMins = mins;
                    if (formData.validityUnit === 'hours') totalMins = mins * 60;
                    else if (formData.validityUnit === 'days') totalMins = mins * 1440;
                    data.append(key, totalMins.toString());
                } else {
                    data.append(key, value as string);
                }
            });
            data.append('purpose', formData.topic);
            data.append('purposeDetail', formData.message);
            data.append('allowEditing', formData.allowEditing ? 'true' : 'false');
            data.append('allowDownload', formData.allowDownload ? 'true' : 'false');
            
            if (sharingMode === 'individual' && formData.vendorEmail) {
                data.append('vendors', JSON.stringify([{ email: formData.vendorEmail.toLowerCase(), level: 1 }]));
            } else if (sharingMode === 'group' && selectedVendors.length > 0) {
                data.append('vendors', JSON.stringify(selectedVendors.map((v, index) => ({ email: v.email.toLowerCase(), level: index + 1 }))));
            }

            if (files) {
                for (let i = 0; i < files.length; i++) {
                    data.append('files', files[i]);
                }
            }

            const result = await createSecureLinkWithFiles(data);

            if (result.success && result.shareUrl) {
                router.refresh();
                setGeneratedLink(result.shareUrl);
                setOwnerUrl(result.ownerUrl || '');
                setStatus({ message: 'Secure link created successfully!', type: 'success' });
                if (result.expiresAt) {
                    startCountdown(new Date(result.expiresAt));
                }
            } else {
                setStatus({ message: result.error || 'Failed to generate link', type: 'error' });
            }
        } catch (err: any) {
            console.error('Upload Error:', err);
            setStatus({
                message: err?.message || 'Request failed. Please check your connection.',
                type: 'error'
            });
        } finally {
            setIsLoading(false);
        }
    };

    const startCountdown = (expiryDate: Date) => {
        if (countdownRef.current) clearInterval(countdownRef.current);
        const updateCountdown = () => {
            const now = Date.now();
            const diff = expiryDate.getTime() - now;
            if (diff <= 0) {
                setCountdown(0);
                if (countdownRef.current) clearInterval(countdownRef.current);
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
            await navigator.clipboard.writeText(generatedLink);
            setStatus({ message: 'Link copied to clipboard!', type: 'success' });
        } catch (err) {
            setStatus({ message: 'Failed to copy. Please select and copy manually.', type: 'error' });
        }
    };

    const formatBytes = (bytes: number) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    return (
        <div className={styles.container}>
            {/* Header */}
            <div className={styles.header}>
                <div className={styles.headerIcon}>
                    <Shield size={24} />
                </div>
                <h1 className={styles.title}>
                    Create <span className={styles.titleBlue}>Secure Link</span>
                </h1>
                <p className={styles.subtitle}>
                    Generate an encrypted, time-limited link to share your files securely.
                </p>
            </div>

            {/* Form Card */}
            <div className={styles.formCard}>
                <form onSubmit={handleSubmit}>
                    
                    {/* SECTION 1: LINK SETTINGS */}
                    <div className={styles.stepSection}>
                        <div className={styles.stepHeader}>
                            <div className={styles.stepIconContainer}>
                                <Shield size={20} />
                            </div>
                            <h2 className={styles.stepTitle}>2. Link Settings</h2>
                        </div>
                        <p className={styles.stepSubtitle}>Control access and expiration.</p>

                        <div className={styles.formGroup}>
                            <label className={styles.formLabel}>Link Expiration</label>
                            <div className={styles.gridSettings}>
                                <div style={{ display: 'flex', gap: '10px', flex: 1 }}>
                                    <div className={styles.inputWrapper} style={{ flex: 1 }}>
                                        <Calendar className={styles.inputIcon} size={18} />
                                        <input
                                            type="number"
                                            name="validityMinutes"
                                            value={formData.validityMinutes}
                                            onChange={handleChange}
                                            className={styles.input}
                                            style={{ paddingLeft: '2.75rem' }}
                                            min="1"
                                            required
                                        />
                                    </div>
                                    <div className={styles.inputWrapper} style={{ flex: 1 }}>
                                        <select
                                            name="validityUnit"
                                            value={formData.validityUnit}
                                            onChange={handleChange}
                                            className={styles.input}
                                        >
                                            <option value="minutes">Minutes</option>
                                            <option value="hours">Hours</option>
                                            <option value="days">Days</option>
                                        </select>
                                    </div>
                                </div>
                                <div className={styles.infoBox}>
                                    <Info className={styles.infoBoxIcon} size={16} />
                                    <span>The link will automatically expire after the selected time.</span>
                                </div>
                            </div>
                        </div>

                        <div className={styles.formGroup} style={{ marginTop: '2rem' }}>
                            <label className={styles.formLabel}>Title</label>
                            <p className={styles.stepSubtitle} style={{ marginLeft: 0, marginBottom: '0.5rem' }}>Provide a title for this secure link.</p>
                            <div className={styles.inputWrapper}>
                                <FileText className={styles.inputIcon} size={18} />
                                <input
                                    type="text"
                                    name="topic"
                                    value={formData.topic}
                                    onChange={handleChange}
                                    className={styles.input}
                                    placeholder="e.g. Q3 Financial Reports"
                                    required
                                    maxLength={100}
                                />
                            </div>
                        </div>

                        <div className={styles.formGroup} style={{ marginTop: '2rem' }}>
                            <label className={styles.formLabel}>Message to Vendor</label>
                            <p className={styles.stepSubtitle} style={{ marginLeft: 0, marginBottom: '0.5rem' }}>Add an optional message or instructions for the recipient.</p>
                            <div className={styles.inputWrapper}>
                                <FileText className={styles.inputIcon} size={18} style={{ top: '24px' }} />
                                <textarea
                                    name="message"
                                    value={formData.message}
                                    onChange={handleChange as any}
                                    className={styles.input}
                                    placeholder="e.g. Please review the attached files by Friday."
                                    rows={3}
                                    maxLength={500}
                                    style={{ padding: '12px 12px 12px 2.75rem', resize: 'vertical' }}
                                />
                            </div>
                        </div>
                    </div>

                    {/* SECTION 2: VENDOR DETAILS & PERMISSIONS */}
                    <div className={styles.stepSection}>
                        <div className={styles.stepHeader}>
                            <div className={styles.stepIconContainer}>
                                <Building2 size={20} />
                            </div>
                            <h2 className={styles.stepTitle}>3. Vendor Details</h2>
                        </div>
                        <p className={styles.stepSubtitle}>Provide vendor information for tracking and compliance.</p>

                        <div className={styles.formGroup} style={{ marginTop: '1rem', marginBottom: '2rem' }}>
                            <label className={styles.formLabel}>Sharing Mode</label>
                            <p className={styles.stepSubtitle} style={{ marginLeft: 0, marginBottom: '1rem' }}>Choose how the link can be used.</p>
                            <div className={styles.modeSelection}>
                                <div 
                                    className={`${styles.modeCard} ${sharingMode === 'individual' ? styles.modeCardActive : ''}`}
                                    onClick={() => {
                                        setSharingMode('individual');
                                        void ensureVendorsLoaded();
                                    }}
                                >
                                    <div className={styles.radioCircle}>
                                        <div className={styles.radioInner}></div>
                                    </div>
                                    <User className={styles.modeIcon} size={24} />
                                    <div>
                                        <div className={styles.modeTitle}>Individual</div>
                                        <div className={styles.modeDesc}>Only the recipient can access</div>
                                    </div>
                                </div>
                                <div 
                                    className={`${styles.modeCard} ${sharingMode === 'group' ? styles.modeCardActive : ''}`}
                                    onClick={() => {
                                        setSharingMode('group');
                                        void ensureVendorsLoaded();
                                    }}
                                >
                                    <div className={styles.radioCircle}>
                                        <div className={styles.radioInner}></div>
                                    </div>
                                    <Users className={styles.modeIcon} size={24} />
                                    <div>
                                        <div className={styles.modeTitle}>Group</div>
                                        <div className={styles.modeDesc}>Anyone with the link can access</div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className={styles.formGroup} style={{ marginTop: '2rem', marginBottom: '2rem' }}>
                            <label className={styles.formLabel}>
                                {sharingMode === 'individual' ? 'Select Vendor' : 'Select Group Members'}
                            </label>

                            <div 
                                onClick={() => {
                                    const next = !isVendorDropdownOpen;
                                    setIsVendorDropdownOpen(next);
                                    if (next) void ensureVendorsLoaded();
                                }}
                                style={{ 
                                    padding: '12px 16px', 
                                    border: '1px solid #d1d5db', 
                                    borderRadius: '6px', 
                                    display: 'flex', 
                                    justifyContent: 'space-between', 
                                    alignItems: 'center',
                                    cursor: 'pointer',
                                    backgroundColor: '#f9fafb'
                                }}
                            >
                                <span style={{ color: (sharingMode === 'individual' && (formData.vendorName || formData.vendorEmail)) || (sharingMode === 'group' && selectedVendors.length > 0) ? '#111827' : '#6b7280' }}>
                                    {sharingMode === 'individual' 
                                        ? (formData.vendorName || formData.vendorEmail || 'Select a vendor...') 
                                        : (selectedVendors.length > 0 ? `${selectedVendors.length} vendors selected` : 'Select vendors...')}
                                </span>
                                {isVendorDropdownOpen ? <ChevronUp size={20} color="#6b7280" /> : <ChevronDown size={20} color="#6b7280" />}
                            </div>

                            {isVendorDropdownOpen && (
                                <div className={styles.vendorList} style={{ marginTop: '8px', border: '1px solid #e5e7eb', borderRadius: '6px', maxHeight: '250px', overflowY: 'auto' }}>
                                    {vendors.length === 0 ? (
                                        <p style={{ color: '#6b7280', textAlign: 'center', margin: '20px 0' }}>No vendors available</p>
                                    ) : vendors.map((vendor) => {
                                        const isSelected = sharingMode === 'individual' 
                                            ? formData.vendorEmail === vendor.email 
                                            : selectedVendors.some(v => v.email === vendor.email);
                                        return (
                                            <div key={vendor.email} className={styles.vendorItem}>
                                                <label style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', flex: 1, margin: 0 }}>
                                                    <input 
                                                        type={sharingMode === 'individual' ? "radio" : "checkbox"}
                                                        name={sharingMode === 'individual' ? "vendorSelect" : `vendor_${vendor.email}`}
                                                        checked={isSelected}
                                                        onChange={(e) => {
                                                            if (sharingMode === 'individual') {
                                                                setFormData({ ...formData, vendorEmail: vendor.email, vendorName: vendor.name ?? undefined });
                                                                setIsVendorDropdownOpen(false); // Close on individual select
                                                            } else {
                                                                if (e.target.checked) {
                                                                    setSelectedVendors([...selectedVendors, { email: vendor.email, level: 2 }]);
                                                                } else {
                                                                    setSelectedVendors(selectedVendors.filter(v => v.email !== vendor.email));
                                                                }
                                                            }
                                                        }}
                                                        style={{ width: '16px', height: '16px', accentColor: '#2563eb' }}
                                                    />
                                                    <div>
                                                        <div style={{ fontWeight: 500, color: '#111827', fontSize: '0.875rem' }}>{vendor.name || vendor.email.split('@')[0]}</div>
                                                        <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>{vendor.email}</div>
                                                    </div>
                                                </label>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                            
                            {sharingMode === 'individual' && (
                                <p style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.5rem' }}>
                                    Only this vendor will be able to access the shared data.
                                </p>
                            )}

                            {sharingMode === 'group' && selectedVendors.length > 0 && (
                                <div style={{ marginTop: '1.5rem' }}>
                                    <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#374151', marginBottom: '0.75rem' }}>Hierarchical Order</p>
                                    <p style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '1rem', marginTop: '-0.5rem' }}>
                                        Adjust the order in which vendors receive access. Level 1 gets access first.
                                    </p>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        {selectedVendors.map((v, index) => {
                                            const vendorInfo = vendors.find(vend => vend.email === v.email);
                                            return (
                                                <div key={v.email} style={{ display: 'flex', alignItems: 'center', gap: '12px', background: '#f9fafb', padding: '8px 12px', borderRadius: '6px', border: '1px solid #e5e7eb' }}>
                                                    <div style={{ background: '#3b82f6', color: 'white', width: '24px', height: '24px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 'bold', flexShrink: 0 }}>
                                                        {index + 1}
                                                    </div>
                                                    <div style={{ flex: 1, overflow: 'hidden' }}>
                                                        <div style={{ fontSize: '0.875rem', fontWeight: 500, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                            {vendorInfo?.name || v.email.split('@')[0]}
                                                        </div>
                                                        <div style={{ fontSize: '0.75rem', color: '#6b7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                            {v.email}
                                                        </div>
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '2px' }}>
                                                        <button 
                                                            type="button" 
                                                            onClick={() => moveVendorUp(index)} 
                                                            disabled={index === 0}
                                                            style={{ padding: '4px', cursor: index === 0 ? 'default' : 'pointer', opacity: index === 0 ? 0.3 : 1, border: 'none', background: 'none', color: '#4b5563' }}
                                                            title="Move Up"
                                                        >
                                                            <ChevronUp size={18} />
                                                        </button>
                                                        <button 
                                                            type="button" 
                                                            onClick={() => moveVendorDown(index)} 
                                                            disabled={index === selectedVendors.length - 1}
                                                            style={{ padding: '4px', cursor: index === selectedVendors.length - 1 ? 'default' : 'pointer', opacity: index === selectedVendors.length - 1 ? 0.3 : 1, border: 'none', background: 'none', color: '#4b5563' }}
                                                            title="Move Down"
                                                        >
                                                            <ChevronDown size={18} />
                                                        </button>
                                                        <button 
                                                            type="button" 
                                                            onClick={() => setSelectedVendors(selectedVendors.filter((_, i) => i !== index))}
                                                            style={{ padding: '4px', cursor: 'pointer', border: 'none', background: 'none', color: '#ef4444', marginLeft: '4px' }}
                                                            title="Remove Vendor"
                                                        >
                                                            <X size={18} />
                                                        </button>
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Vendor Permissions Box */}
                        <div className={styles.permissionsBox} style={{ marginTop: '2rem' }}>
                            <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #e5e7eb', display: 'flex', gap: '12px', alignItems: 'center' }}>
                                <Building2 size={20} color="#3b82f6" />
                                <div>
                                    <div style={{ fontWeight: 600, color: '#111827', fontSize: '0.875rem' }}>Vendor Permissions</div>
                                    <div style={{ fontSize: '0.8125rem', color: '#6b7280' }}>Grant vendor specific permissions for shared files.</div>
                                </div>
                            </div>

                            <div className={styles.permissionRow}>
                                <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
                                    <div className={styles.permIconBox}>
                                        <Edit3 size={18} color="#3b82f6" />
                                    </div>
                                    <div className={styles.permContent}>
                                        <div className={styles.permTitle}>Allow vendor to edit files</div>
                                        <div className={styles.permDesc}>Enable vendor to edit files using Universal Editor.</div>
                                    </div>
                                </div>
                                <label className={styles.toggle}>
                                    <input 
                                        type="checkbox" 
                                        checked={formData.allowEditing}
                                        onChange={(e) => {
                                            const checked = e.target.checked;
                                            setFormData(prev => ({ 
                                                ...prev, 
                                                allowEditing: checked,
                                                allowDownload: checked ? false : prev.allowDownload
                                            }));
                                        }}
                                    />
                                    <span className={styles.slider}></span>
                                </label>
                            </div>

                            <div className={styles.permissionRow}>
                                <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
                                    <div className={styles.permIconBox}>
                                        <DownloadCloud size={18} color="#10b981" />
                                    </div>
                                    <div className={styles.permContent}>
                                        <div className={styles.permTitle}>Allow vendor to download files</div>
                                        <div className={styles.permDesc}>Enable vendor to download shared files.</div>
                                    </div>
                                </div>
                                <label className={styles.toggle}>
                                    <input 
                                        type="checkbox" 
                                        checked={formData.allowDownload}
                                        onChange={(e) => {
                                            const checked = e.target.checked;
                                            setFormData(prev => ({ 
                                                ...prev, 
                                                allowDownload: checked,
                                                allowEditing: checked ? false : prev.allowEditing
                                            }));
                                        }}
                                    />
                                    <span className={styles.slider}></span>
                                </label>
                            </div>

                            <div className={styles.permissionsFooter}>
                                <Info size={16} color="#3b82f6" />
                                You can enable either editing or downloading, but not both simultaneously.
                            </div>
                        </div>
                    </div>

                    {/* SECTION 3: FILES TO SHARE */}
                    <div className={styles.stepSection}>
                        <div className={styles.stepHeader}>
                            <div className={styles.stepIconContainer}>
                                <Paperclip size={20} />
                            </div>
                            <h2 className={styles.stepTitle}>4. Files to Share</h2>
                        </div>
                        <p className={styles.stepSubtitle}>Add files to include in this secure link.</p>

                        <div 
                            className={`${styles.dropzone} ${isDragging ? styles.dropzoneActive : ''}`}
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onDrop={handleDrop}
                        >
                            <input
                                type="file"
                                multiple
                                onChange={handleFileChange}
                                accept=".xls,.xlsx,.csv,.png,.jpg,.jpeg,.pdf,.txt"
                                id="file-upload"
                                style={{ display: 'none' }}
                            />
                            <div className={styles.dropzoneContent}>
                                <div className={styles.dropzoneText}>
                                    <UploadCloud size={18} />
                                    Drag and drop files here
                                </div>
                                <div className={styles.dropzoneOr}>or</div>
                                <button type="button" className={styles.chooseFilesBtn} onClick={() => document.getElementById('file-upload')?.click()}>
                                    Choose Files
                                </button>
                            </div>
                        </div>
                        <div className={styles.dropzoneHint}>
                            Max 128MB per file • Supported: Image, PDF, Excel, CSV, Text
                        </div>
                        {files && files.length > 0 && (
                            <div className={styles.fileList}>
                                {Array.from(files).map((file, index) => (
                                    <div key={index} className={styles.fileCard}>
                                        <div className={styles.fileInfo}>
                                            <FileText className={styles.fileIcon} size={18} />
                                            <div>
                                                <div className={styles.fileName}>{file.name}</div>
                                                <div className={styles.fileSize}>{formatBytes(file.size)}</div>
                                            </div>
                                        </div>
                                        <button 
                                            type="button" 
                                            className={styles.removeBtn}
                                            onClick={() => removeFile(index)}
                                        >
                                            <X size={16} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        {status.message && (
                            <div className={`${styles.statusMessage} ${status.type === 'error' ? styles.statusError : styles.statusSuccess}`}>
                                {status.type === 'success' ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
                                {status.message}
                            </div>
                        )}
                        <div style={{ marginTop: '2rem' }}>
                            <button type="submit" disabled={isLoading} className={styles.submitBtn}>
                                {isLoading ? (
                                    <span>Generating Link...</span>
                                ) : (
                                    <>
                                        <Lock size={18} />
                                        Generate Secure Link
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                    {/* Results Section */}
                    {generatedLink && (
                        <div className={styles.resultsSection}>
                            <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', padding: '1.5rem', borderRadius: '8px', marginBottom: '1.5rem' }}>
                                <h3 style={{ color: '#047857', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1rem', fontSize: '1rem' }}>
                                    <CheckCircle2 size={18} />
                                    Link Generated Successfully
                                </h3>
                                
                                <div style={{ display: 'flex', gap: '12px', background: '#ffffff', border: '1px solid #e5e7eb', padding: '12px', borderRadius: '6px', alignItems: 'center' }}>
                                    <div style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#2563eb', fontSize: '0.875rem' }}>
                                        {generatedLink}
                                    </div>
                                    <button type="button" onClick={copyToClipboard} style={{ background: '#2563eb', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontWeight: 500, fontSize: '0.8125rem' }}>
                                        Copy
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </form>
            </div>
            {/* Footer Back Button */}
            <div className={styles.backBtnWrapper}>
                <Link href="/services" className={styles.backBtn}>
                    <ArrowLeft size={16} />
                    Back to Services
                </Link>
            </div>
        </div>
    );
}
