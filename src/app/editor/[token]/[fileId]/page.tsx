'use client';

import React, { useEffect, useState, useCallback, use, useRef } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { getRawFileForEdit } from '@/actions/get-raw-file-for-edit';
import { updateFile } from '@/actions/update-file';
import { submitFinal } from '@/actions/submit-final';
import { CollaborationProvider } from '@/components/view/CollaborationProvider';
import { EditLockProvider, getEditClientInstanceId, useEditLock } from '@/components/view/EditLockProvider';
import { useCollaborationStore } from '@/store/useCollaborationStore';
import { markInternalNavigation } from '@/components/view/sudden-exit-client';
import { isWordLikeFile } from '@/components/editors/word/isWordLikeFile';

const UniversalEditor = dynamic(() => import('@/components/editors/core/UniversalEditor'), {
    ssr: false,
    loading: () => <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: '#0F172A', background: '#f4f7fb' }}>Loading Editor...</div>,
});

const WordEditor = dynamic(() => import('@/components/editors/word/WordEditor'), {
    ssr: false,
    loading: () => <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: '#0F172A', background: '#f4f7fb' }}>Loading Word editor...</div>,
});

const SecureViewWrapper = dynamic<{ token: string; children: React.ReactNode }>(
    () => import('@/components/view/SecureViewWrapper').then(mod => mod.SecureViewWrapper),
    { ssr: false }
);

interface EditorPageProps {
    params: Promise<{
        token: string;
        fileId: string;
    }>;
}

function EditorWorkspace({
    token,
    fileId,
    file,
    version,
    setVersion,
    myLevel,
    handleClose,
    handleSubmitFinal,
}: {
    token: string;
    fileId: string;
    file: File;
    version: number;
    setVersion: React.Dispatch<React.SetStateAction<number>>;
    myLevel: number;
    handleClose: () => void;
    handleSubmitFinal: (editedFile: File) => Promise<void>;
}) {
    const editLock = useEditLock();
    const highestActiveLevel = useCollaborationStore((s) => s.highestActiveLevel);
    const clientInstanceId = editLock?.clientInstanceId || getEditClientInstanceId(fileId);
    const versionRef = useRef(version);
    versionRef.current = version;

    const handleSaveFile = useCallback(async (editedFile: File) => {
        const send = async (expected: number) => {
            const formData = new FormData();
            formData.append('file', editedFile);
            formData.append('expectedVersion', String(expected));
            formData.append('editClientInstanceId', clientInstanceId);
            return updateFile(token, fileId, formData);
        };

        let res = await send(versionRef.current);
        if (!res.success && res.conflict && typeof res.currentVersion === 'number') {
            versionRef.current = res.currentVersion;
            setVersion(res.currentVersion);
            res = await send(res.currentVersion);
        }

        if (res.success) {
            const next = typeof res.newVersion === 'number' ? res.newVersion : versionRef.current + 1;
            versionRef.current = next;
            setVersion(next);
            return;
        }
        throw new Error(res.error || 'Failed to save draft.');
    }, [token, fileId, clientInstanceId, setVersion]);

    const forceReadOnly = Boolean(editLock?.forceReadOnly);
    const wordLike = isWordLikeFile(file);

    return (
        <div style={{ width: '100vw', height: '100vh', background: '#f4f7fb', overflow: 'hidden', position: 'relative' }}>
            {wordLike ? (
                <WordEditor
                    token={token}
                    fileId={fileId}
                    initialFile={file}
                    forceReadOnly={forceReadOnly}
                    onClose={handleClose}
                    onSave={handleSaveFile}
                    onSubmit={handleSubmitFinal}
                />
            ) : (
                <div style={{ width: '100%', height: '100%', overflow: 'hidden', position: 'relative' }}>
                    <UniversalEditor
                        token={token}
                        fileId={fileId}
                        initialFileProp={file}
                        currentUserLevel={myLevel}
                        highestAuthorityLevel={highestActiveLevel ?? myLevel}
                        forceReadOnly={forceReadOnly}
                        onClose={handleClose}
                        onSave={handleSaveFile}
                        onSubmit={handleSubmitFinal}
                        forceAutoSave={false}
                        onAutoSaveComplete={handleClose}
                    />
                </div>
            )}
        </div>
    );
}

export default function EditorPage({ params }: EditorPageProps) {
    const router = useRouter();
    const { token, fileId } = use(params);

    const [file, setFile] = useState<File | null>(null);
    const [version, setVersion] = useState<number>(1);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [myLevel, setMyLevel] = useState(2);
    const [capabilities, setCapabilities] = useState({
        canEdit: true,
        canPreview: true,
        canComment: true,
        canDownload: false,
    });
    const [remainingSeconds, setRemainingSeconds] = useState(0);

    useEffect(() => {
        let isMounted = true;
        const loadFile = async () => {
            try {
                setLoading(true);
                const result = await getRawFileForEdit(token, fileId);
                if (!isMounted) return;

                if (!result.success || !result.base64Content) {
                    setError(result.error || 'Failed to load file for editing');
                    return;
                }

                // Decode base64 → Uint8Array using a streaming approach to avoid heap OOM
                const binaryString = atob(result.base64Content);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                const newFile = new File([bytes], result.fileName || 'document', { type: result.mimeType });

                setFile(newFile);
                setVersion(result.version ?? 1);
                if (typeof result.myAssignedLevel === 'number') setMyLevel(result.myAssignedLevel);
                if (result.capabilities) setCapabilities(result.capabilities);
                if (typeof result.remainingSeconds === 'number') setRemainingSeconds(result.remainingSeconds);
            } catch (err) {
                console.error('Edit load error:', err);
                if (isMounted) setError('Error loading file for edit');
            } finally {
                if (isMounted) setLoading(false);
            }
        };

        loadFile();
        return () => { isMounted = false; };
    }, [token, fileId]);

    const handleClose = useCallback(async () => {
        markInternalNavigation();
        try {
            const clientInstanceId = getEditClientInstanceId(fileId);
            await fetch(`/api/documents/${fileId}/edit-lock/release`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-edit-client-instance': clientInstanceId },
                body: JSON.stringify({ token, clientInstanceId }),
            });
        } catch {
            /* best-effort */
        }
        router.back();
    }, [router, token, fileId]);

    const handleSubmitFinal = useCallback(async (editedFile: File) => {
        const formData = new FormData();
        formData.append('file', editedFile);
        formData.append('editClientInstanceId', getEditClientInstanceId(fileId));

        const res = await submitFinal(token, fileId, formData);

        if (!res.success) {
            throw new Error(res.error || 'Failed to submit final document.');
        }

        const viewUrl = `/view/${token}`;
        markInternalNavigation();
        router.replace(viewUrl);
        window.location.assign(viewUrl);
    }, [token, fileId, router]);

    if (loading) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#f4f7fb', color: '#0f172a' }}>
                <div style={{ width: 40, height: 40, border: '3px solid rgba(2,132,199,0.2)', borderTopColor: '#0284c7', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                <div style={{ marginTop: 20 }}>Loading secure workspace...</div>
            </div>
        );
    }

    if (error || !file) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#f4f7fb', color: '#0f172a' }}>
                <div style={{ padding: '20px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '12px', color: '#b91c1c' }}>
                    {error || 'File not found'}
                </div>
                <button onClick={handleClose} style={{ marginTop: '20px', padding: '8px 16px', background: '#0284c7', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>
                    Go Back
                </button>
            </div>
        );
    }

    return (
        <CollaborationProvider
            token={token}
            initialCapabilities={capabilities}
            initialRemainingSeconds={remainingSeconds}
            initialMyLevel={myLevel}
        >
            <SecureViewWrapper token={token}>
                <EditLockProvider
                    token={token}
                    fileId={fileId}
                    myLevel={myLevel}
                    onAutoSave={async () => {
                        window.dispatchEvent(new CustomEvent('dg:force-autosave', { detail: { fileId } }));
                    }}
                >
                    <EditorWorkspace
                        token={token}
                        fileId={fileId}
                        file={file}
                        version={version}
                        setVersion={setVersion}
                        myLevel={myLevel}
                        handleClose={handleClose}
                        handleSubmitFinal={handleSubmitFinal}
                    />
                </EditLockProvider>
            </SecureViewWrapper>
        </CollaborationProvider>
    );
}
