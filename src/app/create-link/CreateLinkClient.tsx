'use client';
import { useState, DragEvent, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { CreateSecureLinkResult } from '@/lib/create-link-result';
import type { CreateLinkJson } from '@/lib/create-link-payload';
import type { VendorOption } from '@/lib/vendor-options';
import styles from './page.module.css';
import { 
    Shield, 
    Calendar, 
    Clock,
    Info,
    User, 
    Users, 
    Building2, 
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
    ChevronUp,
    Search,
} from 'lucide-react';

type ExpiryMode = 'time' | 'days' | 'months';

function fileKey(file: File) {
    return `${file.name}:${file.size}:${file.lastModified}`;
}

interface FormDataState {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    gender: string;
    age: string;
    expiryMode: ExpiryMode;
    expiryAmount: string;
    validityUnit: 'minutes' | 'hours';
    vendors: { email: string; level: number }[]; // Multi-vendor with levels
    vendorEmail: string; 
    vendorName?: string;
    topic: string; // Mandatory: describe what data is being shared
    message: string; // Optional message to the vendor
    allowEditing: boolean;
    allowDownload: boolean;
}

interface CreateLinkClientProps {
    initialVendors: VendorOption[];
    hasActiveLink: boolean;
}

export default function CreateLinkClient({ initialVendors, hasActiveLink }: CreateLinkClientProps) {
    const router = useRouter();
    const [formData, setFormData] = useState<FormDataState>({
        firstName: '',
        lastName: '',
        email: '',
        phone: '',
        gender: '',
        age: '',
        expiryMode: 'time',
        expiryAmount: '15',
        validityUnit: 'minutes',
        vendors: [{ email: '', level: 1 }],
        vendorEmail: '',
        topic: '',
        message: '',
        allowEditing: false,
        allowDownload: false,
    });
    const [files, setFiles] = useState<FileList | null>(null);
    const [stageStatus, setStageStatus] = useState<
        Record<string, { status: 'preparing' | 'ready' | 'error'; gridFSId?: string; error?: string }>
    >({});
    const stagePromises = useRef(new Map<string, Promise<string>>());
    const [linkSent, setLinkSent] = useState(false);
    const [status, setStatus] = useState({ message: '', type: '' });
    const [isLoading, setIsLoading] = useState(false);
    const [vendors] = useState<VendorOption[]>(initialVendors);
    const [sharingMode, setSharingMode] = useState<'individual' | 'group'>('individual');
    const [selectedVendors, setSelectedVendors] = useState<{email: string, level: number}[]>([]);
    const [isVendorDropdownOpen, setIsVendorDropdownOpen] = useState(false);
    const [vendorSearch, setVendorSearch] = useState('');
    
    // Drag and Drop state
    const [isDragging, setIsDragging] = useState(false);

    useEffect(() => {
        router.prefetch('/dashboard/owner');
        fetch('/api/create-link', { method: 'GET', credentials: 'same-origin' }).catch(() => {});
    }, [router]);

    const filteredVendors = vendors.filter((vendor) => {
        const q = vendorSearch.trim().toLowerCase();
        if (!q) return true;
        const name = (vendor.name || '').toLowerCase();
        const email = vendor.email.toLowerCase();
        return name.includes(q) || email.includes(q);
    });

    const toggleVendorDropdown = () => {
        setIsVendorDropdownOpen((open) => {
            if (open) setVendorSearch('');
            return !open;
        });
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const value = e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value;
        setFormData({ ...formData, [e.target.name]: value });
    };

    const queueStaging = (list: FileList | File[]) => {
        Array.from(list).forEach((file) => {
            const key = fileKey(file);
            if (stagePromises.current.has(key)) return;
            setStageStatus((prev) => ({ ...prev, [key]: { status: 'preparing' } }));
            const promise = (async () => {
                const postOnce = async () => {
                    const res = await fetch('/api/create-link/stage', {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: { 'X-File-Name': encodeURIComponent(file.name) },
                        body: file,
                    });
                    const json = (await res.json().catch(() => ({}))) as {
                        success?: boolean;
                        gridFSId?: string;
                        error?: string;
                    };
                    return { res, json };
                };

                let { res, json } = await postOnce();
                if ((!json.success || !json.gridFSId) && res.status >= 500) {
                    ({ res, json } = await postOnce());
                }
                if (!json.success || !json.gridFSId) {
                    throw new Error(json.error || `Failed to prepare "${file.name}".`);
                }
                setStageStatus((prev) => ({
                    ...prev,
                    [key]: { status: 'ready', gridFSId: json.gridFSId },
                }));
                return json.gridFSId;
            })().catch((err: unknown) => {
                stagePromises.current.delete(key);
                const raw = err instanceof Error ? err.message : `Failed to prepare "${file.name}".`;
                const message = /mongodb\.net|server monitor|ECONNRESET|ETIMEDOUT/i.test(raw)
                    ? 'Could not reach file storage. Please attach the file again.'
                    : raw;
                setStageStatus((prev) => ({ ...prev, [key]: { status: 'error', error: message } }));
                throw new Error(message);
            });
            stagePromises.current.set(key, promise);
        });
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            setFiles(e.target.files);
            queueStaging(e.target.files);
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
            queueStaging(e.dataTransfer.files);
        }
    };

    const removeFile = (index: number) => {
        if (!files) return;
        const removed = files[index];
        if (removed) {
            const key = fileKey(removed);
            stagePromises.current.delete(key);
            setStageStatus((prev) => {
                const next = { ...prev };
                delete next[key];
                return next;
            });
        }
        const dt = new DataTransfer();
        for (let i = 0; i < files.length; i++) {
            if (i !== index) dt.items.add(files[i]);
        }
        setFiles(dt.files.length > 0 ? dt.files : null);
    };

    const validateForm = (): string | null => {
        const amount = parseInt(formData.expiryAmount, 10);
        if (!formData.expiryAmount || isNaN(amount) || amount <= 0) {
            return 'Expiration value must be a positive number';
        }
        if (formData.expiryMode === 'time') {
            const totalMinutes = formData.validityUnit === 'hours' ? amount * 60 : amount;
            if (totalMinutes > 10080) return 'Time-based validity cannot exceed 7 days';
        }
        if (formData.expiryMode === 'days' && amount > 365) {
            return 'Day count cannot exceed 365 days';
        }
        if (formData.expiryMode === 'months' && amount > 12) {
            return 'Month period cannot exceed 12 months';
        }

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
        e.stopPropagation();
        setStatus({ message: '', type: '' });

        const error = validateForm();
        if (error) {
            setStatus({ message: error, type: 'error' });
            return;
        }

        setIsLoading(true);

        try {
            const amount = parseInt(formData.expiryAmount, 10);
            const resolvedExpiry =
                formData.expiryMode === 'time' && formData.validityUnit === 'hours'
                    ? amount * 60
                    : amount;

            const vendors =
                sharingMode === 'individual' && formData.vendorEmail
                    ? [{ email: formData.vendorEmail.toLowerCase(), level: 1 }]
                    : selectedVendors.map((v, index) => ({ email: v.email.toLowerCase(), level: index + 1 }));

            const selected = files ? Array.from(files) : [];
            for (const file of selected) {
                if (!stagePromises.current.has(fileKey(file))) {
                    queueStaging([file]);
                }
            }
            const stagedGridFsIds = await Promise.all(
                selected.map((file) => {
                    const key = fileKey(file);
                    const staged = stageStatus[key];
                    if (staged?.status === 'error') {
                        return Promise.reject(new Error(staged.error || `Failed to prepare "${file.name}".`));
                    }
                    if (staged?.gridFSId) return Promise.resolve(staged.gridFSId);
                    const pending = stagePromises.current.get(key);
                    if (!pending) {
                        return Promise.reject(new Error(`Failed to prepare "${file.name}".`));
                    }
                    return pending;
                }),
            );

            const payload: CreateLinkJson = {
                firstName: formData.firstName,
                lastName: formData.lastName,
                email: formData.email,
                phone: formData.phone,
                gender: formData.gender,
                age: Number(formData.age) || 0,
                expiryMode: formData.expiryMode,
                expiryAmount: resolvedExpiry,
                purpose: formData.topic,
                purposeDetail: formData.message,
                allowEditing: formData.allowEditing,
                allowDownload: formData.allowDownload,
                vendors,
                stagedGridFsIds,
            };

            const response = await fetch('/api/create-link', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const result = (await response.json().catch(() => ({}))) as CreateSecureLinkResult;

            if (result.success) {
                setLinkSent(true);
                setStatus({
                    message: 'The secure link has been sent to the vendor. They will receive the OTP by email.',
                    type: 'success',
                });
                requestAnimationFrame(() => {
                    document.getElementById('generated-link-result')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                });
                return;
            }
            setStatus({ message: result.error || 'Failed to generate link', type: 'error' });
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
                            <p className={styles.stepSubtitle} style={{ marginLeft: 0, marginBottom: '0.75rem' }}>
                                Choose how long this link stays valid. After that, access is broken and the link expires.
                            </p>
                            <div className={styles.expiryModeSelection}>
                                <button
                                    type="button"
                                    className={`${styles.expiryModeCard} ${formData.expiryMode === 'time' ? styles.expiryModeCardActive : ''}`}
                                    onClick={() => setFormData((prev) => ({ ...prev, expiryMode: 'time', expiryAmount: '15', validityUnit: 'minutes' }))}
                                >
                                    <Clock size={18} />
                                    <span>Time</span>
                                    <small>Minutes or hours</small>
                                </button>
                                <button
                                    type="button"
                                    className={`${styles.expiryModeCard} ${formData.expiryMode === 'days' ? styles.expiryModeCardActive : ''}`}
                                    onClick={() => setFormData((prev) => ({ ...prev, expiryMode: 'days', expiryAmount: '7' }))}
                                >
                                    <Calendar size={18} />
                                    <span>Days</span>
                                    <small>Expires after N days</small>
                                </button>
                                <button
                                    type="button"
                                    className={`${styles.expiryModeCard} ${formData.expiryMode === 'months' ? styles.expiryModeCardActive : ''}`}
                                    onClick={() => setFormData((prev) => ({ ...prev, expiryMode: 'months', expiryAmount: '1' }))}
                                >
                                    <Calendar size={18} />
                                    <span>Months</span>
                                    <small>Expires after N months</small>
                                </button>
                            </div>
                            <div className={styles.gridSettings}>
                                <div className={styles.expiryAmountRow}>
                                    <div className={styles.inputWrapper} style={{ flex: 1 }}>
                                        {formData.expiryMode === 'time' ? (
                                            <Clock className={styles.inputIcon} size={18} />
                                        ) : (
                                            <Calendar className={styles.inputIcon} size={18} />
                                        )}
                                        <input
                                            type="number"
                                            name="expiryAmount"
                                            value={formData.expiryAmount}
                                            onChange={handleChange}
                                            className={styles.input}
                                            style={{ paddingLeft: '2.75rem' }}
                                            min="1"
                                            max={
                                                formData.expiryMode === 'months'
                                                    ? 12
                                                    : formData.expiryMode === 'days'
                                                      ? 365
                                                      : formData.validityUnit === 'hours'
                                                        ? 168
                                                        : 10080
                                            }
                                            required
                                        />
                                    </div>
                                    {formData.expiryMode === 'time' ? (
                                        <div className={styles.inputWrapper} style={{ flex: 1 }}>
                                            <select
                                                name="validityUnit"
                                                value={formData.validityUnit}
                                                onChange={handleChange}
                                                className={styles.input}
                                                style={{ paddingLeft: '1rem' }}
                                            >
                                                <option value="minutes">Minutes</option>
                                                <option value="hours">Hours</option>
                                            </select>
                                        </div>
                                    ) : (
                                        <div className={styles.inputWrapper} style={{ flex: 1 }}>
                                            <input
                                                className={styles.input}
                                                style={{ paddingLeft: '1rem', background: '#f9fafb' }}
                                                value={formData.expiryMode === 'days' ? 'Days' : 'Months'}
                                                readOnly
                                                tabIndex={-1}
                                            />
                                        </div>
                                    )}
                                </div>
                                <div className={styles.infoBox}>
                                    <Info className={styles.infoBoxIcon} size={16} />
                                    <span>
                                        {formData.expiryMode === 'time' &&
                                            'The link expires after the selected time (minutes or hours).'}
                                        {formData.expiryMode === 'days' &&
                                            'The link expires after the selected number of days. Access is then broken.'}
                                        {formData.expiryMode === 'months' &&
                                            'The link expires after the selected number of months. Access is then broken.'}
                                    </span>
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
                                        setVendorSearch('');
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
                                        setVendorSearch('');
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
                                onClick={toggleVendorDropdown}
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
                                <div className={styles.vendorList} style={{ marginTop: '8px', border: '1px solid #e5e7eb', borderRadius: '6px', maxHeight: '280px', overflowY: 'auto' }}>
                                    <div
                                        className={styles.vendorSearch}
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <Search size={16} color="#6b7280" aria-hidden="true" />
                                        <input
                                            type="search"
                                            value={vendorSearch}
                                            onChange={(e) => setVendorSearch(e.target.value)}
                                            placeholder="Search by name or email..."
                                            aria-label="Search vendors"
                                            autoFocus
                                        />
                                    </div>
                                    {vendors.length === 0 ? (
                                        <p style={{ color: '#6b7280', textAlign: 'center', margin: '20px 0' }}>No vendors available</p>
                                    ) : filteredVendors.length === 0 ? (
                                        <p style={{ color: '#6b7280', textAlign: 'center', margin: '20px 0', fontSize: '0.875rem' }}>
                                            No vendors match “{vendorSearch.trim()}”
                                        </p>
                                    ) : filteredVendors.map((vendor) => {
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
                                                                setIsVendorDropdownOpen(false);
                                                                setVendorSearch('');
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
                            <div className={styles.permHeader}>
                                <Building2 size={20} color="#3b82f6" style={{ flexShrink: 0, marginTop: 2 }} />
                                <div className={styles.permText}>
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
                                accept=".xls,.xlsx,.csv,.png,.jpg,.jpeg,.pdf,.txt,.doc,.docx,.odt"
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
                            Max 128MB per file • Supported: Word, PDF, Excel, CSV, Images, Text
                        </div>
                        {files && files.length > 0 && (
                            <div className={styles.fileList}>
                                {Array.from(files).map((file, index) => (
                                    <div key={index} className={styles.fileCard}>
                                        <div className={styles.fileInfo}>
                                            <FileText className={styles.fileIcon} size={18} />
                                            <div>
                                                <div className={styles.fileName}>{file.name}</div>
                                                <div className={styles.fileSize}>
                                                    {formatBytes(file.size)}
                                                    {stageStatus[fileKey(file)]?.status === 'preparing'
                                                        ? ' · Preparing…'
                                                        : stageStatus[fileKey(file)]?.status === 'ready'
                                                          ? ' · Ready'
                                                          : stageStatus[fileKey(file)]?.status === 'error'
                                                            ? ` · ${stageStatus[fileKey(file)]?.error || 'Failed'}`
                                                            : ''}
                                                </div>
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

                        {status.message && (!linkSent || status.type === 'error') && (
                            <div className={`${styles.statusMessage} ${status.type === 'error' ? styles.statusError : styles.statusSuccess}`}>
                                {status.type === 'success' ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
                                {status.message}
                            </div>
                        )}
                        <div style={{ marginTop: '2rem' }}>
                            <button type="submit" disabled={isLoading} className={styles.submitBtn}>
                                {isLoading ? (
                                    <span>
                                        {files &&
                                        Array.from(files).some(
                                            (file) => stageStatus[fileKey(file)]?.status === 'preparing',
                                        )
                                            ? 'Preparing files...'
                                            : 'Generating Link...'}
                                    </span>
                                ) : (
                                    <>
                                        <Lock size={18} />
                                        {hasActiveLink || linkSent ? 'Get Another Link' : 'Generate Secure Link'}
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                    {/* Results Section */}
                    {linkSent && (
                        <div id="generated-link-result" className={styles.resultsSection}>
                            <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', padding: '1.5rem', borderRadius: '8px', marginBottom: '1.5rem' }}>
                                <h3 style={{ color: '#047857', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', fontSize: '1rem' }}>
                                    <CheckCircle2 size={18} />
                                    Link sent to the vendor
                                </h3>
                                <p style={{ margin: 0, color: '#065f46', fontSize: '0.875rem', lineHeight: 1.5 }}>
                                    The secure link has been sent to the vendor. They will receive the OTP by email — you do not need to share anything yourself.
                                </p>
                                <p style={{ margin: '12px 0 0' }}>
                                    <Link href="/dashboard/owner" style={{ color: '#047857', fontSize: '0.875rem', fontWeight: 600 }}>
                                        Open owner dashboard
                                    </Link>
                                </p>
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
