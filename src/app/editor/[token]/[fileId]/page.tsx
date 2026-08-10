'use client';

import React, { useEffect, useState, useCallback, use } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { getRawFileForEdit } from '@/actions/get-raw-file-for-edit';
import { updateFile } from '@/actions/update-file';
import { submitFinal } from '@/actions/submit-final';

const UniversalEditor = dynamic(() => import('@/components/editors/core/UniversalEditor'), {
    ssr: false,
    loading: () => <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: '#0F172A', background: '#FFFFFF' }}>Loading Editor...</div>,
});


const SecurePDFViewer = dynamic(() => import('@/components/editors/SecurePDFViewer'), {
    ssr: false,
    loading: () => <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: '#0F172A', background: '#FFFFFF' }}>Loading Secure Viewer...</div>,
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

export default function EditorPage({ params }: EditorPageProps) {
    const router = useRouter();
    const { token, fileId } = use(params);

    const [file, setFile] = useState<File | null>(null);
    const [version, setVersion] = useState<number>(1);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

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

    const handleClose = useCallback(() => {
        router.back();
    }, [router]);

    const handleSaveFile = useCallback(async (editedFile: File) => {
        try {
            const formData = new FormData();
            formData.append('file', editedFile);
            formData.append('expectedVersion', String(version));

            const res = await updateFile(token, fileId, formData);

            if (res.success) {
                // Keep the editor open after draft save
                setVersion(prev => prev + 1);
            } else {
                alert(res.error || 'Failed to save draft.');
            }
        } catch (err) {
            console.error('Save error:', err);
            alert('An error occurred while saving draft.');
        }
    }, [token, fileId, version]);

    const handleSubmitFinal = useCallback(async (editedFile: File) => {
        try {
            const formData = new FormData();
            formData.append('file', editedFile);

            const res = await submitFinal(token, fileId, formData);

            if (res.success) {
                window.location.assign(`/view/${token}`);
            } else {
                alert(res.error || 'Failed to submit final document.');
            }
        } catch (err) {
            console.error('Submit error:', err);
            alert('An error occurred while submitting final.');
        }
    }, [token, fileId, router]);

    if (loading) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#ffffff', color: '#000' }}>
                <div style={{ width: 40, height: 40, border: '3px solid rgba(99,102,241,0.2)', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                <div style={{ marginTop: 20 }}>Loading secure workspace...</div>
            </div>
        );
    }

    if (error || !file) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#ffffff', color: '#000' }}>
                <div style={{ padding: '20px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', color: '#f87171' }}>
                    {error || 'File not found'}
                </div>
                <button onClick={handleClose} style={{ marginTop: '20px', padding: '8px 16px', background: '#1e293b', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>
                    Go Back
                </button>
            </div>
        );
    }

    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

    return (
        <SecureViewWrapper token={token}>
            <div style={{ width: '100vw', height: '100vh', background: '#09090b', overflow: 'hidden', position: 'relative' }}>
                {isPdf ? (
                    <SecurePDFViewer
                        token={token}
                        file={file}
                        onClose={handleClose}
                    />
                ) : (
                    <div style={{ width: '100%', height: '100%', overflow: 'hidden', position: 'relative' }}>
                        <UniversalEditor
                            token={token}
                            fileId={fileId}
                            initialFileProp={file}
                            currentUserLevel={2}
                            highestAuthorityLevel={2}
                            onClose={handleClose}
                            onSave={handleSaveFile}
                            onSubmit={handleSubmitFinal}
                            forceAutoSave={false}
                            onAutoSaveComplete={handleClose}
                        />
                    </div>
                )}
            </div>
        </SecureViewWrapper>
    );
}
