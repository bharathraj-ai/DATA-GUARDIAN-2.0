import React from 'react';
import { redirect } from 'next/navigation';
import { getUserData } from '@/actions/get-user';
import { CollaborationProvider } from '@/components/view/CollaborationProvider';
import { SessionTimer } from '@/components/view/SessionTimer';
import { ChatPanel } from '@/components/view/ChatPanel';
import { FileList } from '@/components/view/FileList';
import { SecureViewWrapper } from '@/components/view/SecureViewWrapper';
import { CompleteWorkButton } from '@/components/view/CompleteWorkButton';

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
            <main className="profile-wrapper">
                <div className="bg-orb bg-orb-1" />
                <div className="bg-orb bg-orb-2" />
                <div className="bg-grid" />
                <div className="profile-card">
                    <div className="error-container">
                        <h2 className="error-title">{title}</h2>
                        <p className="error-message">{result.error}</p>
                    </div>
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
            <main className="profile-wrapper" style={{ position: 'relative' }}>
                <div className="bg-orb bg-orb-1" />
                <div className="bg-orb bg-orb-2" />
                <div className="bg-grid" />

                <div className="profile-card">
                    {/* Header */}
                    <div className="profile-header">
                        <div className="header-top">
                            <h1 className="profile-title">Secure Shared Profile</h1>
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
                        <h2 className="identity-name">{data.firstName} {data.lastName}</h2>
                        <p className="identity-label">Shared securely for temporary access</p>
                    </div>

                    {/* Sender Context */}
                    {data.ownerName && (
                        <div style={{
                            background: 'linear-gradient(135deg, rgba(99,102,241,0.08), rgba(139,92,246,0.08))',
                            border: '1px solid rgba(99,102,241,0.2)',
                            borderRadius: '12px', padding: '16px 20px', margin: '0 0 4px 0',
                            display: 'flex', alignItems: 'center', gap: '10px',
                        }}>
                            <div style={{
                                width: '36px', height: '36px', borderRadius: '50%',
                                background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                color: '#fff', fontSize: '14px', fontWeight: 700, flexShrink: 0,
                            }}>
                                {data.ownerName[0]?.toUpperCase() || '?'}
                            </div>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: '11px', color: '#9CA3AF', textTransform: 'uppercase', fontWeight: 600 }}>Shared by</div>
                                <div style={{ fontSize: '15px', fontWeight: 600 }}>{data.ownerName}</div>
                                {data.purpose && <div style={{ fontSize: '13px', color: '#6B7280', marginTop: '2px' }}>{data.purpose}</div>}
                            </div>
                        </div>
                    )}

                    {/* File List — Client Component: handles edit/preview interactions */}
                    <div className="data-section">
                        <div className="data-card">
                            <FileList token={cleanToken} files={data.files} isOwner={data.isOwner} />
                        </div>
                    </div>

                    {!data.isOwner && (
                        <div style={{ padding: '0 24px', marginBottom: '24px' }}>
                            <CompleteWorkButton token={cleanToken} />
                        </div>
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
