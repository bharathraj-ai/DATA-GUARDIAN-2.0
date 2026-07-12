import React from 'react';
import { redirect } from 'next/navigation';
import { getUserData } from '@/actions/get-user';
import { CollaborationProvider } from '@/components/view/CollaborationProvider';
import { SessionTimer } from '@/components/view/SessionTimer';
import { ChatPanel } from '@/components/view/ChatPanel';
import { FileList } from '@/components/view/FileList';
import { SecureViewWrapper } from '@/components/view/SecureViewWrapper';
import { CompleteWorkButton } from '@/components/view/CompleteWorkButton';
import { BreakButton } from '@/components/view/BreakButton';
import { VendorAutoSave } from '@/components/view/VendorAutoSave';
import { DraftHydrator } from '@/components/view/DraftHydrator';

export const metadata = {
    title: 'Secure View | Data Guardian',
};

export default async function ViewPage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    const cleanToken = token.split('?')[0]; // Remove query params

    // 1. Initial Data Fetch (Server-Side)
    const result = await getUserData(cleanToken);

    if (!result.success || !result.data) {
        // Redirect unverified users to the OTP page — server-side, no client JS needed
        if (result.errorType === 'NOT_VERIFIED') {
            redirect(`/share/${cleanToken}`);
        }

        const title =
            result.errorType === 'REVOKED' ? 'Access Revoked' :
            result.errorType === 'EXPIRED' ? 'Session Expired' :
            'Access Denied';

        return (
            <main 
                className="profile-wrapper" 
                style={{ 
                    paddingTop: '120px', 
                    minHeight: '100vh', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center' 
                }}
            >
                <div className="profile-card" style={{ width: '100%', textAlign: 'center', padding: '60px 40px' }}>
                    <div style={{
                        width: '64px', height: '64px', borderRadius: '50%', background: '#FEE2E2',
                        color: '#EF4444', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '32px', margin: '0 auto 24px'
                    }}>
                        ⚠️
                    </div>
                    <h2 style={{ fontSize: '28px', fontWeight: 800, color: '#0F172A', marginBottom: '12px' }}>
                        {title}
                    </h2>
                    <p style={{ fontSize: '16px', color: '#475569', fontWeight: 500 }}>
                        {result.error}
                    </p>
                </div>
            </main>
        );
    }

    const { data } = result;

    return (
        // Seed Zustand store with server-fetched capabilities & remaining time
        // so PermissionGuard renders correctly on first paint without waiting for SSE
        <CollaborationProvider
            token={cleanToken}
            initialCapabilities={data.capabilities}
            initialRemainingSeconds={data.remainingSeconds}
        >
          <SecureViewWrapper token={cleanToken} viewerEmail={data.maskedEmail}>
            <main className="profile-wrapper" style={{ position: 'relative', paddingTop: '120px', paddingBottom: '60px' }}>
                <div className="bg-orb bg-orb-1" />
                <div className="bg-orb bg-orb-2" />
                <div className="bg-grid" />

                <div className="profile-card">
                    {/* Header */}
                    <div className="profile-header">
                        <div className="header-top">
                            <h1 className="profile-title" style={{ color: '#0F172A' }}>Secure Shared Profile</h1>
                            <div className="status-badges">
                                <span className="status-badge connected">
                                    <span className="status-dot" /> LIVE
                                </span>
                            </div>
                        </div>
                        <SessionTimer />
                    </div>

                    {/* Identity */}
                    <div className="identity-section">
                        <div className="avatar">
                            <span className="avatar-initials">
                                {data.firstName[0]}{data.lastName[0]}
                            </span>
                        </div>
                        <h2 className="identity-name" style={{ color: '#0F172A' }}>{data.firstName} {data.lastName}</h2>
                        <p className="identity-label" style={{ color: '#475569' }}>Shared securely for temporary access</p>
                    </div>

                    {/* Sender Context */}
                    {(data.ownerName || data.ownerEmail || data.purpose || data.purposeDetail) && (
                        <div style={{
                            background: 'linear-gradient(135deg, rgba(99,102,241,0.08), rgba(139,92,246,0.08))',
                            border: '1px solid rgba(99,102,241,0.2)',
                            borderRadius: '12px', padding: '16px 20px', margin: '0 0 4px 0',
                            display: 'flex', alignItems: 'flex-start', gap: '12px',
                        }}>
                            {(data.ownerName || data.ownerEmail) && (
                                <div style={{
                                    width: '36px', height: '36px', borderRadius: '50%',
                                    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    color: '#fff', fontSize: '14px', fontWeight: 700, flexShrink: 0,
                                }}>
                                    {(data.ownerName ? data.ownerName[0] : data.ownerEmail ? data.ownerEmail[0] : '?').toUpperCase()}
                                </div>
                            )}
                            <div style={{ flex: 1 }}>
                                {(data.ownerName || data.ownerEmail) && (
                                    <>
                                        <div style={{ fontSize: '11px', color: '#9CA3AF', textTransform: 'uppercase', fontWeight: 600 }}>Shared by</div>
                                        <div style={{ fontSize: '15px', fontWeight: 600 }}>{data.ownerName || data.ownerEmail}</div>
                                    </>
                                )}
                                {data.purpose && (
                                    <div style={{ marginTop: (data.ownerName || data.ownerEmail) ? '12px' : '0' }}>
                                        <div style={{ fontSize: '12px', fontWeight: 600, color: '#4F46E5', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Title</div>
                                        <div style={{ fontSize: '14px', fontWeight: 500, color: '#1F2937' }}>{data.purpose}</div>
                                    </div>
                                )}
                                {data.purposeDetail && (
                                    <div style={{ marginTop: '8px', background: '#F9FAFB', padding: '8px 12px', borderRadius: '6px', borderLeft: '3px solid #6366F1' }}>
                                        <div style={{ fontSize: '11px', color: '#6B7280', fontWeight: 600, textTransform: 'uppercase', marginBottom: '2px' }}>Message</div>
                                        <div style={{ fontSize: '13px', color: '#4B5563', whiteSpace: 'pre-wrap' }}>{data.purposeDetail}</div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* File List — Client Component: handles edit/preview interactions */}
                    <div className="data-section">
                        <div className="data-card">
                            <FileList 
                                token={cleanToken} 
                                files={data.files.map((f: any) => ({
                                    id: f.id,
                                    fileName: f.fileName,
                                    fileSize: f.fileSize,
                                    fileType: f.fileType,
                                    status: f.status
                                }))} 
                                isOwner={data.isOwner} 
                            />
                        </div>
                    </div>

                    {!data.isOwner && (
                        <>
                            <DraftHydrator lastSavedWork={data.lastSavedWork} resumePoint={data.resumePoint} />
                            <div style={{ padding: '0 24px', marginBottom: '24px', display: 'flex', flexDirection: 'column' }}>
                                <CompleteWorkButton token={cleanToken} />
                                <BreakButton token={cleanToken} />
                                <VendorAutoSave token={cleanToken} />
                            </div>
                        </>
                    )}

                    <div className="trust-footer">
                        <p className="trust-text">Protected by Data Guardian V2 (Enterprise)</p>
                    </div>
                </div>

                <ChatPanel />
            </main>
          </SecureViewWrapper>
        </CollaborationProvider>
    );
}
