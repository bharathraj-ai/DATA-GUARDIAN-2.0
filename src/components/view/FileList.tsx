'use client';

import React, { useState, useCallback, memo, useEffect } from 'react';
import { useCollaborationStore } from '@/store/useCollaborationStore';
import { PermissionGuard } from '@/components/view/PermissionGuard';
import { getFilePreview, FilePreviewResult } from '@/actions/get-file-preview';
import type { FileMetadata } from '@/actions/get-user';

import { useRouter } from 'next/navigation';

/** Convert a data: URI to a blob: URL for reliable PDF iframe embedding. */
function dataUriToBlobUrl(dataUri: string): string | null {
    try {
        const match = /^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,(.*)$/s.exec(dataUri);
        if (!match) return null;
        const mime = match[1] || 'application/octet-stream';
        const isBase64 = !!match[2];
        const data = match[3];
        const bytes = isBase64
            ? Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
            : new TextEncoder().encode(decodeURIComponent(data));
        return URL.createObjectURL(new Blob([bytes], { type: mime }));
    } catch {
        return null;
    }
}

interface FileListProps {
    token: string;
    files: FileMetadata[];
    isOwner: boolean;

}



export const FileList = memo(function FileList({ token, files, isOwner }: FileListProps) {
    const capabilities = useCollaborationStore((s) => s.capabilities);
    const router = useRouter();

    const [isEditLoading, setIsEditLoading] = useState<string | null>(null);
    const [previewData, setPreviewData] = useState<FilePreviewResult | null>(null);
    const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
    const [isPreviewLoading, setIsPreviewLoading] = useState(false);
    const [isDownloadLoading, setIsDownloadLoading] = useState<string | null>(null);

    const handleEdit = useCallback(async (fileId: string) => {
        if (!capabilities.canEdit) return;
        setIsEditLoading(fileId);
        router.push(`/editor/${token}/${fileId}`);
    }, [token, capabilities.canEdit, router]);

    const handlePreview = useCallback(async (fileId: string, fileType: string) => {
        if (!capabilities.canPreview) return;
        setIsPreviewLoading(true);
        try {
            // Revoke any previous blob preview URL
            setPdfBlobUrl((prev) => {
                if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
                return null;
            });

            // PDFs/images: stream via API → blob URL (avoids CSP/data-URI and server-action size limits)
            if (fileType === 'application/pdf' || fileType.startsWith('image/')) {
                const response = await fetch(`/api/stream/${token}/preview/${fileId}`);
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    alert(errorData.error || 'Failed to open preview');
                    return;
                }
                const blob = await response.blob();
                const blobUrl = URL.createObjectURL(blob);
                setPdfBlobUrl(blobUrl);
                setPreviewData({
                    success: true,
                    type: fileType === 'application/pdf' ? 'pdf' : 'image',
                    content: blobUrl,
                    restricted: false,
                });
                return;
            }

            const res = await getFilePreview(token, fileId);
            if (res.success) {
                setPreviewData(res);
            } else {
                alert(res.error || 'Failed to open preview');
            }
        } catch (error) {
            console.error('Preview error:', error);
            alert('An error occurred while opening preview.');
        } finally {
            setIsPreviewLoading(false);
        }
    }, [token, capabilities.canPreview]);

    // Convert legacy data: URI PDFs to blob: if needed; revoke blob URLs on close/change
    useEffect(() => {
        if (!previewData || previewData.type !== 'pdf' || typeof previewData.content !== 'string') {
            return;
        }
        const content = previewData.content;
        if (content.startsWith('blob:')) {
            setPdfBlobUrl(content);
            return;
        }
        if (content.startsWith('data:')) {
            const url = dataUriToBlobUrl(content);
            setPdfBlobUrl(url);
            return () => {
                if (url) URL.revokeObjectURL(url);
            };
        }
        setPdfBlobUrl(null);
    }, [previewData]);

    const closePreview = useCallback(() => {
        setPdfBlobUrl((prev) => {
            if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
            return null;
        });
        setPreviewData(null);
    }, []);

    const handleDownload = useCallback(async (fileId: string, fileName: string) => {
        if (!capabilities.canDownload) return;
        setIsDownloadLoading(fileId);
        try {
            const response = await fetch(`/api/stream/${token}/download/${fileId}`);
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                alert(errorData.error || 'Failed to download file');
                return;
            }
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (error) {
            console.error('Download error:', error);
            alert('An error occurred while downloading.');
        } finally {
            setIsDownloadLoading(null);
        }
    }, [token, capabilities.canDownload]);

    if (!files || files.length === 0) return null;

    return (
        <>
            <PermissionGuard requiredCapability="canPreview" fallback={
                <p style={{ color: '#9CA3AF', fontSize: '14px', textAlign: 'center', padding: '16px' }}>
                    You do not have permission to view files.
                </p>
            }>
                <div className="data-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                    <div className="data-label" style={{ marginBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>Attached Files ({files.length})</span>
                        {!capabilities.canDownload && (
                            <span style={{ fontSize: '12px', color: '#fbbf24', background: 'rgba(251, 191, 36, 0.1)', padding: '4px 8px', borderRadius: '4px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                🔒 File download has been disabled by the owner.
                            </span>
                        )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {files.map((file) => (
                            <div key={file.id} style={{
                                background: '#F8FAFC', padding: '10px', borderRadius: '8px',
                                border: '1px solid #E2E8F0',
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px'
                            }}>
                                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: '150px' }}>
                                    <span style={{ fontSize: '14px', color: '#0F172A', wordBreak: 'break-all', fontWeight: 600 }}>{file.fileName}</span>
                                    <span style={{ fontSize: '12px', color: '#64748B' }}>
                                        {file.fileType.split('/')[1]?.toUpperCase() || 'FILE'} • {(file.fileSize / 1024).toFixed(1)} KB
                                    </span>
                                    <div style={{ marginTop: '6px' }}>
                                        {file.fileType === 'application/pdf' ? (
                                            <span style={{ fontSize: '10px', background: 'rgba(239,68,68,0.1)', color: '#ef4444', padding: '3px 8px', borderRadius: '12px', border: '1px solid rgba(239,68,68,0.2)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                                🔒 View Only PDF
                                            </span>
                                        ) : (
                                            <span style={{ fontSize: '10px', background: 'rgba(34,197,94,0.1)', color: '#22c55e', padding: '3px 8px', borderRadius: '12px', border: '1px solid rgba(34,197,94,0.2)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                                ✍️ Editing Enabled
                                            </span>
                                        )}
                                        <span style={{ 
                                            fontSize: '10px', 
                                            background: file.status === 'submitted' ? 'rgba(59,130,246,0.1)' : 'rgba(100,116,139,0.1)', 
                                            color: file.status === 'submitted' ? '#3b82f6' : '#64748b', 
                                            padding: '3px 8px', borderRadius: '12px', 
                                            border: `1px solid ${file.status === 'submitted' ? 'rgba(59,130,246,0.2)' : 'rgba(100,116,139,0.2)'}`, 
                                            display: 'inline-flex', alignItems: 'center', gap: '4px', marginLeft: '6px' 
                                        }}>
                                            {file.status === 'submitted' ? '✅ Submitted' : '📄 Draft'}
                                        </span>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <PermissionGuard requiredCapability="canEdit">
                                        <button
                                            onClick={() => handleEdit(file.id)}
                                            disabled={!!isEditLoading}
                                            style={{
                                                background: file.fileType === 'application/pdf' ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)',
                                                border: file.fileType === 'application/pdf' ? '1px solid rgba(239,68,68,0.3)' : '1px solid rgba(34,197,94,0.3)',
                                                color: file.fileType === 'application/pdf' ? '#ef4444' : '#22c55e',
                                                padding: '4px 8px', fontSize: '12px',
                                                borderRadius: '4px', cursor: isEditLoading ? 'wait' : 'pointer',
                                                display: 'flex', alignItems: 'center', gap: '4px'
                                            }}
                                        >
                                            {isEditLoading === file.id ? '⏳' : file.fileType === 'application/pdf' ? '🔒 Secure Preview' : '✍️ Edit'}
                                        </button>
                                    </PermissionGuard>
                                    <PermissionGuard requiredCapability="canDownload">
                                        <button
                                            onClick={() => handleDownload(file.id, file.fileName)}
                                            disabled={isDownloadLoading === file.id}
                                            style={{
                                                background: 'rgba(168,85,247,0.2)', border: '1px solid rgba(168,85,247,0.4)',
                                                color: '#c084fc', padding: '4px 8px', fontSize: '12px',
                                                borderRadius: '4px', cursor: isDownloadLoading === file.id ? 'wait' : 'pointer',
                                                display: 'flex', alignItems: 'center', gap: '4px'
                                            }}
                                        >
                                            {isDownloadLoading === file.id ? '⏳ Downloading...' : '⬇️ Download'}
                                        </button>
                                    </PermissionGuard>
                                    <button
                                        onClick={() => handlePreview(file.id, file.fileType)}
                                        disabled={isPreviewLoading}
                                        style={{
                                            background: 'rgba(64,196,255,0.2)', border: '1px solid rgba(64,196,255,0.4)',
                                            color: '#40c4ff', padding: '4px 8px', fontSize: '12px',
                                            borderRadius: '4px', cursor: isPreviewLoading ? 'wait' : 'pointer',
                                        }}
                                    >
                                        {isPreviewLoading ? 'Loading...' : 'Preview'}
                                    </button>

                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </PermissionGuard>

            {/* Preview Modal */}
            {previewData && (
                <div style={{
                    position: 'fixed', inset: 0, zIndex: 1000,
                    background: 'rgba(0,0,0,0.9)', backdropFilter: 'blur(10px)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px'
                }}>
                    <div style={{
                        background: '#1a1a1a', border: '1px solid #333', borderRadius: '12px',
                        width: '100%', maxWidth: '800px', maxHeight: '90vh',
                        display: 'flex', flexDirection: 'column', overflow: 'hidden'
                    }}>
                        <div style={{
                            padding: '16px', borderBottom: '1px solid #333',
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                        }}>
                            <h3 style={{ margin: 0, color: '#fff' }}>Secure Preview</h3>
                            <button onClick={closePreview} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '20px' }}>×</button>
                        </div>
                        {previewData.restricted && previewData.restrictionType && (
                            <div style={{ background: 'rgba(234, 179, 8, 0.1)', borderBottom: '1px solid rgba(234, 179, 8, 0.3)', padding: '10px 16px', color: '#eab308', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                ⚠️ {previewData.restrictionType}
                            </div>
                        )}
                        <div style={{ padding: '20px', overflowY: 'auto', flex: 1, display: 'flex', justifyContent: 'center' }}>
                            {previewData.type === 'image' && (
                                <img
                                    src={(pdfBlobUrl || previewData.content) as string}
                                    alt="Preview"
                                    style={{ maxWidth: '100%', objectFit: 'contain' }}
                                />
                            )}
                            {previewData.type === 'pdf' && (
                                pdfBlobUrl ? (
                                    <iframe
                                        src={`${pdfBlobUrl}#toolbar=0&navpanes=0&scrollbar=1&view=FitH`}
                                        style={{ width: '100%', height: 'min(80vh, 900px)', border: 'none', minHeight: '70vh' }}
                                        title="PDF Preview"
                                    />
                                ) : (
                                    <p style={{ color: '#9CA3AF', fontSize: '14px' }}>Preparing PDF preview…</p>
                                )
                            )}
                            {previewData.type === 'text' && (
                                <pre style={{ color: '#ddd', fontSize: '14px', whiteSpace: 'pre-wrap', width: '100%' }}>{previewData.content as string}</pre>
                            )}
                            {previewData.type === 'spreadsheet' && Array.isArray(previewData.content) && (
                                <div style={{ width: '100%', overflowX: 'auto' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', color: '#fff', fontSize: '13px' }}>
                                        <tbody>
                                            {(previewData.content as unknown[][]).map((row: unknown[], i: number) => (
                                                <tr key={i} style={{ borderBottom: '1px solid #333', background: i === 0 ? '#222' : 'transparent', fontWeight: i === 0 ? 600 : 400 }}>
                                                    {row.map((cell: unknown, j: number) => (
                                                        <td key={j} style={{ padding: '8px 12px', whiteSpace: 'nowrap', borderRight: '1px solid #333' }}>
                                                            {cell !== null && cell !== undefined ? String(cell) : ''}
                                                        </td>
                                                    ))}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

        </>
    );
});
