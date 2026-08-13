'use client';

import React, { useState, useCallback, memo, useEffect } from 'react';
import { useCollaborationStore } from '@/store/useCollaborationStore';
import { PermissionGuard } from '@/components/view/PermissionGuard';
import { getFilePreview, FilePreviewResult } from '@/actions/get-file-preview';
import type { FileMetadata } from '@/actions/get-user';
import { useRouter } from 'next/navigation';
import { Download, Eye, FileText, Lock, Pencil, ShieldOff } from 'lucide-react';
import styles from './FileList.module.css';

/** Convert a data: URI to a blob: URL for reliable PDF iframe embedding. */
function dataUriToBlobUrl(dataUri: string): string | null {
    try {
        const match = /^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,([\s\S]*)$/.exec(dataUri);
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

function formatSize(bytes: number) {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / 1024).toFixed(1)} KB`;
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
            setPdfBlobUrl((prev) => {
                if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
                return null;
            });

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
                <p className={styles.denied}>You do not have permission to view files.</p>
            }>
                <div className={styles.wrap}>
                    <div className={styles.head}>
                        <div>
                            <p className={styles.kicker}>Attached files</p>
                            <p className={styles.count}>
                                {files.length} {files.length === 1 ? 'document' : 'documents'}
                            </p>
                        </div>
                        {!capabilities.canDownload && (
                            <span className={styles.lockNote}>
                                <ShieldOff size={14} />
                                Download locked by the owner
                            </span>
                        )}
                    </div>

                    <div className={styles.ledger}>
                        {files.map((file) => {
                            const isPdf = file.fileType === 'application/pdf';
                            const ext = file.fileType.split('/')[1]?.toUpperCase() || 'FILE';
                            return (
                                <div key={file.id} className={styles.row}>
                                    <div className={styles.icon} aria-hidden="true">
                                        {isPdf ? <Lock size={18} /> : <FileText size={18} />}
                                    </div>
                                    <div>
                                        <p className={styles.name}>{file.fileName}</p>
                                        <p className={styles.meta}>{ext} · {formatSize(file.fileSize)}</p>
                                        <div className={styles.flags}>
                                            {isPdf ? (
                                                <span className={`${styles.flag} ${styles.flagLock}`}>
                                                    <Lock size={11} /> View only
                                                </span>
                                            ) : (
                                                <span className={`${styles.flag} ${styles.flagEdit}`}>
                                                    <Pencil size={11} /> Editing enabled
                                                </span>
                                            )}
                                            <span className={`${styles.flag} ${file.status === 'submitted' ? styles.flagDone : styles.flagDraft}`}>
                                                {file.status === 'submitted' ? 'Submitted' : 'Draft'}
                                            </span>
                                        </div>
                                    </div>
                                    <div className={styles.actions}>
                                        <PermissionGuard requiredCapability="canEdit">
                                            <button
                                                type="button"
                                                onClick={() => handleEdit(file.id)}
                                                disabled={!!isEditLoading}
                                                className={`${styles.btn} ${isPdf ? styles.btnDanger : styles.btnGhost}`}
                                            >
                                                {isEditLoading === file.id
                                                    ? 'Opening…'
                                                    : isPdf
                                                        ? <><Lock size={14} /> Secure preview</>
                                                        : <><Pencil size={14} /> Edit</>}
                                            </button>
                                        </PermissionGuard>
                                        <PermissionGuard requiredCapability="canDownload">
                                            <button
                                                type="button"
                                                onClick={() => handleDownload(file.id, file.fileName)}
                                                disabled={isDownloadLoading === file.id}
                                                className={`${styles.btn} ${styles.btnGhost}`}
                                            >
                                                {isDownloadLoading === file.id
                                                    ? 'Downloading…'
                                                    : <><Download size={14} /> Download</>}
                                            </button>
                                        </PermissionGuard>
                                        <button
                                            type="button"
                                            onClick={() => handlePreview(file.id, file.fileType)}
                                            disabled={isPreviewLoading}
                                            className={`${styles.btn} ${styles.btnPreview}`}
                                        >
                                            {isPreviewLoading
                                                ? 'Loading…'
                                                : <><Eye size={14} /> Preview</>}
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </PermissionGuard>

            {previewData && (
                <div className={styles.modal} onClick={closePreview}>
                    <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
                        <div className={styles.modalHead}>
                            <h3>Secure preview</h3>
                            <button type="button" className={styles.close} onClick={closePreview} aria-label="Close preview">
                                ×
                            </button>
                        </div>
                        {previewData.restricted && previewData.restrictionType && (
                            <div className={styles.restrict}>{previewData.restrictionType}</div>
                        )}
                        <div className={styles.modalBody}>
                            {previewData.type === 'image' && (
                                <img
                                    src={(pdfBlobUrl || previewData.content) as string}
                                    alt="Preview"
                                />
                            )}
                            {previewData.type === 'pdf' && (
                                pdfBlobUrl ? (
                                    <iframe
                                        src={`${pdfBlobUrl}#toolbar=0&navpanes=0&scrollbar=1&view=FitH`}
                                        title="PDF Preview"
                                    />
                                ) : (
                                    <p>Preparing PDF preview…</p>
                                )
                            )}
                            {previewData.type === 'text' && (
                                <pre>{previewData.content as string}</pre>
                            )}
                            {previewData.type === 'spreadsheet' && Array.isArray(previewData.content) && (
                                <div className={styles.tableWrap}>
                                    <table>
                                        <tbody>
                                            {(previewData.content as unknown[][]).map((row: unknown[], i: number) => (
                                                <tr key={i} style={{ fontWeight: i === 0 ? 700 : 400 }}>
                                                    {row.map((cell: unknown, j: number) => (
                                                        <td key={j}>
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
