import React from 'react';
import dynamic from 'next/dynamic';
import { redirect } from 'next/navigation';
import { getUserData } from '@/actions/get-user';
import { AlertTriangle, Shield } from 'lucide-react';
import { CollaborationProvider } from '@/components/view/CollaborationProvider';
import { SessionTimer } from '@/components/view/SessionTimer';
import { SecureViewWrapper } from '@/components/view/SecureViewWrapper';
import { CompleteWorkButton } from '@/components/view/CompleteWorkButton';
import { BreakButton } from '@/components/view/BreakButton';
import { VendorAutoSave } from '@/components/view/VendorAutoSave';
import { DraftHydrator } from '@/components/view/DraftHydrator';
import styles from './view.module.css';

const FileList = dynamic(() => import('@/components/view/FileList').then((m) => m.FileList));
const ChatPanel = dynamic(() => import('@/components/view/ChatPanel').then((m) => m.ChatPanel));

export const metadata = {
    title: 'Secure View | Secure Protocol',
};

export default async function ViewPage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    const cleanToken = token.split('?')[0]; // Remove query params

    // 1. Initial Data Fetch (Server-Side)
    const result = await getUserData(cleanToken);

    if (!result.success || !result.data) {
        // Redirect unverified users to the OTP page — server-side, no client JS needed
        // Lost share session after OTP: back to the OTP gate (not dashboard).
        const isSessionGone =
            result.errorType === 'NOT_VERIFIED' ||
            result.errorType === 'SESSION_INVALID' ||
            (typeof result.error === 'string' &&
                /missing or invalid session|unauthorized|otp verification required/i.test(result.error));

        if (isSessionGone) {
            redirect(`/share/${cleanToken}`);
        }

        const title =
            result.errorType === 'REVOKED' ? 'Access Revoked' :
            result.errorType === 'EXPIRED' ? 'Session Expired' :
            'Access Denied';

        return (
            <main className={styles.desk}>
                <div className={styles.wash} />
                <div className={styles.deniedWrap}>
                    <div className={styles.denied}>
                        <div className={styles.deniedIcon}>
                            <AlertTriangle size={28} />
                        </div>
                        <h2>{title}</h2>
                        <p>{result.error}</p>
                    </div>
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
            initialMyLevel={data.myAssignedLevel}
        >
          <SecureViewWrapper
            token={cleanToken}
            viewerEmail={data.viewerEmail || data.maskedEmail}
            deviceHash={data.deviceHashFragment || undefined}
          >
            <main className={styles.desk}>
                <div className={styles.wash} />

                <header className={styles.hud}>
                    <div>
                        <p className={styles.kicker}>Live session</p>
                        <h1>Shared vault</h1>
                        <p className={styles.lede}>
                            {sharedBy
                                ? `Sealed drop from ${sharedBy}. Work stays inside this session.`
                                : 'Sealed drop for the named vendor. Work stays inside this session.'}
                        </p>
                    </div>
                    <div className={styles.hudMeta}>
                        <span className={styles.live}>
                            <span className={styles.dot} />
                            LIVE
                        </span>
                        <div className={styles.timer}>
                            <SessionTimer />
                        </div>
                    </div>
                </header>

                <div className={styles.console}>
                    <aside className={styles.spine}>
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
                            <div className={styles.metaBlock}>
                                <small>Title</small>
                                <p>{data.purpose}</p>
                            </div>
                        ) : null}

                        {data.purposeDetail ? (
                            <div className={styles.metaBlock}>
                                <small>Note</small>
                                <p>{data.purposeDetail}</p>
                            </div>
                        ) : null}

                        <p className={styles.policy}>
                            <Shield size={16} strokeWidth={2} />
                            <span>
                                Preview and edits stay in-session. Download follows the owner’s lock.
                            </span>
                        </p>
                    </aside>

                    <section className={styles.surface}>
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
                    </section>
                </div>

                {!data.isOwner && (
                    <div className={styles.dock}>
                        <DraftHydrator lastSavedWork={data.lastSavedWork} resumePoint={data.resumePoint} />
                        <CompleteWorkButton token={cleanToken} />
                        <BreakButton
                            token={cleanToken}
                            allowedBreaks={data.allowedBreaks ?? 0}
                            breaksUsed={data.breaksUsed ?? 0}
                        />
                        <VendorAutoSave token={cleanToken} />
                    </div>
                )}

                <ChatPanel />
            </main>
          </SecureViewWrapper>
        </CollaborationProvider>
    );
}
