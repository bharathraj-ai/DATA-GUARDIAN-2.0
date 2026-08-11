import React from 'react';
import { redirect } from 'next/navigation';
import { getUserData } from '@/actions/get-user';
import { AlertTriangle } from 'lucide-react';
import { CollaborationProvider } from '@/components/view/CollaborationProvider';
import { SessionTimer } from '@/components/view/SessionTimer';
import { ChatPanel } from '@/components/view/ChatPanel';
import { FileList } from '@/components/view/FileList';
import { SecureViewWrapper } from '@/components/view/SecureViewWrapper';
import { CompleteWorkButton } from '@/components/view/CompleteWorkButton';
import { BreakButton } from '@/components/view/BreakButton';
import { VendorAutoSave } from '@/components/view/VendorAutoSave';
import { DraftHydrator } from '@/components/view/DraftHydrator';
import styles from './view.module.css';

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
            <main className={styles.desk}>
                <div className={styles.denied}>
                    <div style={{
                        width: 56, height: 56, borderRadius: '50%', background: '#FEE2E2',
                        color: '#EF4444', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        margin: '0 auto 16px',
                    }}>
                        <AlertTriangle size={28} />
                    </div>
                    <h2>{title}</h2>
                    <p>{result.error}</p>
                </div>
            </main>
        );
    }

    const { data } = result;
    const sharedBy = data.ownerName || data.ownerEmail || null;
    const initial = sharedBy ? sharedBy[0].toUpperCase() : (data.firstName?.[0] || 'S');

    return (
        // Seed Zustand store with server-fetched capabilities & remaining time
        // so PermissionGuard renders correctly on first paint without waiting for SSE
        <CollaborationProvider
            token={cleanToken}
            initialCapabilities={data.capabilities}
            initialRemainingSeconds={data.remainingSeconds}
        >
          <SecureViewWrapper token={cleanToken} viewerEmail={data.maskedEmail}>
            <main className={styles.desk}>
                <header className={styles.top}>
                    <div>
                        <p className={styles.kicker}>Live session</p>
                        <h1 className={styles.title}>Shared vault</h1>
                    </div>
                    <div className={styles.meta}>
                        <span className={styles.live}>
                            <span className={styles.dot} />
                            LIVE
                        </span>
                        <div className={styles.chip}>
                            <SessionTimer />
                        </div>
                    </div>
                </header>

                <div className={styles.grid}>
                    <aside className={styles.brief}>
                        {sharedBy ? (
                            <div className={styles.who}>
                                <span className={styles.avatar}>{initial}</span>
                                <div>
                                    <small>From</small>
                                    <strong>{sharedBy}</strong>
                                </div>
                            </div>
                        ) : (
                            <div className={styles.who}>
                                <span className={styles.avatar}>{initial}</span>
                                <div>
                                    <small>Recipient</small>
                                    <strong>{data.firstName} {data.lastName}</strong>
                                </div>
                            </div>
                        )}

                        {data.purpose ? (
                            <div className={styles.field}>
                                <small>Title</small>
                                <p>{data.purpose}</p>
                            </div>
                        ) : null}

                        {data.purposeDetail ? (
                            <div className={styles.field}>
                                <small>Note</small>
                                <p>{data.purposeDetail}</p>
                            </div>
                        ) : null}
                    </aside>

                    <section className={styles.work}>
                        <div className={styles.files}>
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

                        {!data.isOwner && (
                            <div className={styles.actions}>
                                <DraftHydrator lastSavedWork={data.lastSavedWork} resumePoint={data.resumePoint} />
                                <CompleteWorkButton token={cleanToken} />
                                <BreakButton token={cleanToken} />
                                <VendorAutoSave token={cleanToken} />
                            </div>
                        )}
                    </section>
                </div>

                <ChatPanel />
            </main>
          </SecureViewWrapper>
        </CollaborationProvider>
    );
}
