'use client';

import React, { useState, useCallback, memo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useCollaborationStore } from '@/store/useCollaborationStore';
import { PermissionGuard } from '@/components/view/PermissionGuard';
import { getFilePreview, FilePreviewResult } from '@/actions/get-file-preview';
import type { FileMetadata } from '@/actions/get-user';
import { useRouter } from 'next/navigation';
import { Download, Eye, FileText, Loader2, Lock, Pencil, ShieldOff, X } from 'lucide-react';
import styles from './FileList.module.css';
import { markInternalNavigation } from './sudden-exit-client';

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

function formatPreviewCell(cell: unknown): string {
    if (cell === null || cell === undefined) return '';
    if (typeof cell === 'object') {
        const value = (cell as { value?: unknown }).value;
        if (value === null || value === undefined) return '';
        if (typeof value === 'object') return '';
        return String(value);
    }
    return String(cell);
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
    const [previewMeta, setPreviewMeta] = useState<{ fileName: string; fileType: string } | null>(null);
    const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
    const [pdfPage, setPdfPage] = useState(1);
    const [isPreviewLoading, setIsPreviewLoading] = useState(false);
    const [isDownloadLoading, setIsDownloadLoading] = useState<string | null>(null);
    const pdfBlobUrlRef = useRef<string | null>(null);
    useEffect(() => {
        pdfBlobUrlRef.current = pdfBlobUrl;
    }, [pdfBlobUrl]);

    useEffect(() => () => {
        const url = pdfBlobUrlRef.current;
        if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
    }, []);

    // Capture-resistant: drop in-memory preview blobs when the tab hides
    // so a snip/camera frame is less likely to include a lingering object URL.
    useEffect(() => {
        const onVis = () => {
            if (!document.hidden) return;
            const url = pdfBlobUrlRef.current;
            if (url?.startsWith('blob:')) {
                URL.revokeObjectURL(url);
                pdfBlobUrlRef.current = null;
            }
            setPdfBlobUrl(null);
            setPreviewData(null);
            setPreviewMeta(null);
        };
        document.addEventListener('visibilitychange', onVis);
        return () => document.removeEventListener('visibilitychange', onVis);
    }, []);

    const handleEdit = useCallback(async (fileId: string) => {
        if (!capabilities.canEdit) return;
        setIsEditLoading(fileId);
        markInternalNavigation();
        router.push(`/editor/${token}/${fileId}`);
    }, [token, capabilities.canEdit, router]);

    const handlePreview = useCallback(async (fileId: string, fileType: string, fileName: string) => {
        if (!capabilities.canPreview) return;
        setPreviewMeta({ fileName, fileType });
        setIsPreviewLoading(true);
        setPdfPage(1);
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
                    setPreviewMeta(null);
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
                void fetch('/api/analytics/view', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ token, fileId, pageNumber: 1 }),
                }).catch(() => undefined);
                return;
            }

            const res = await getFilePreview(token, fileId);
            if (res.success) {
                setPreviewData(res);
                void fetch('/api/analytics/view', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ token, fileId, pageNumber: 1 }),
                }).catch(() => undefined);
            } else {
                alert(res.error || 'Failed to open preview');
                setPreviewMeta(null);
            }
        } catch (error) {
            console.error('Preview error:', error);
            alert('An error occurred while opening preview.');
            setPreviewMeta(null);
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
        setPreviewMeta(null);
        setPdfPage(1);
    }, []);

    const previewOpen = Boolean(previewMeta);

    useEffect(() => {
        if (!previewOpen) return;
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') closePreview();
        };
        window.addEventListener('keydown', onKey);
        return () => {
            document.body.style.overflow = prevOverflow;
            window.removeEventListener('keydown', onKey);
        };
    }, [previewOpen, closePreview]);

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
                                            {!isPdf && (
                                                <button
                                                    type="button"
                                                    onClick={() => handleEdit(file.id)}
                                                    disabled={!!isEditLoading}
                                                    className={`${styles.btn} ${styles.btnGhost}`}
                                                >
                                                    {isEditLoading === file.id
                                                        ? 'Opening…'
                                                        : <><Pencil size={14} /> Edit</>}
                                                </button>
                                            )}
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
                                            onClick={() => handlePreview(file.id, file.fileType, file.fileName)}
                                            disabled={isPreviewLoading}
                                            className={`${styles.btn} ${styles.btnPreview}`}
                                        >
                                            {isPreviewLoading && previewMeta?.fileName === file.fileName
                                                ? 'Opening…'
                                                : isPdf
                                                    ? <><Lock size={14} /> View file</>
                                                    : <><Eye size={14} /> Preview</>}
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </PermissionGuard>

            {previewOpen && createPortal(
                <div
                    className={styles.viewer}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="secure-file-viewer-title"
                >
                    <div className={styles.viewerHead}>
                        <div className={styles.viewerTitle}>
                            <Lock size={16} />
                            <div>
                                <p className={styles.viewerKicker}>Owner file</p>
                                <h3 id="secure-file-viewer-title">{previewMeta?.fileName || 'Secure preview'}</h3>
                            </div>
                        </div>
                        <button type="button" className={styles.close} onClick={closePreview} aria-label="Close file viewer">
                            <X size={18} />
                        </button>
                    </div>
                    {previewData?.restricted && previewData.restrictionType && (
                        <div className={styles.restrict}>{previewData.restrictionType}</div>
                    )}
                    <div className={`${styles.viewerStage} ${previewData?.type === 'image' ? styles.viewerStageImage : ''}`}>
                        {isPreviewLoading && !previewData && (
                            <div className={styles.viewerLoading}>
                                <Loader2 size={22} className={styles.spin} />
                                Opening file…
                            </div>
                        )}
                        {previewData?.type === 'image' && (
                            <img
                                src={(pdfBlobUrl || previewData.content) as string}
                                alt={previewMeta?.fileName || 'Preview'}
                            />
                        )}
                        {previewData?.type === 'pdf' && (
                            pdfBlobUrl ? (
                                <>
                                    <div className={styles.pageBar}>
                                        <button
                                            type="button"
                                            className={styles.pageBtn}
                                            disabled={pdfPage <= 1}
                                            onClick={() => setPdfPage((p) => Math.max(1, p - 1))}
                                        >
                                            Previous page
                                        </button>
                                        <span className={styles.pageLabel}>Page {pdfPage}</span>
                                        <button
                                            type="button"
                                            className={styles.pageBtn}
                                            onClick={() => setPdfPage((p) => p + 1)}
                                        >
                                            Next page
                                        </button>
                                    </div>
                                    <iframe
                                        key={`${pdfBlobUrl}-p${pdfPage}`}
                                        src={`${pdfBlobUrl}#page=${pdfPage}&toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
                                        title={previewMeta?.fileName || 'PDF preview'}
                                    />
                                </>
                            ) : (
                                <div className={styles.viewerLoading}>Preparing PDF…</div>
                            )
                        )}
                        {previewData?.type === 'text' && (
                            <pre>{previewData.content as string}</pre>
                        )}
                        {previewData?.type === 'word' && typeof previewData.content === 'string' && (
                            <iframe
                                className={styles.wordFrame}
                                title={previewMeta?.fileName || 'Word preview'}
                                sandbox=""
                                srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><style>
                                  html,body{height:100%;margin:0}
                                  body{font-family:Calibri,'Segoe UI',Inter,sans-serif;font-size:15px;line-height:1.55;color:#0f172a;padding:28px 36px;background:#fff;box-sizing:border-box}
                                  p{margin:0 0 10px} h1,h2,h3{margin:16px 0 8px} table{border-collapse:collapse;width:100%}
                                  td,th{border:1px solid #cbd5e1;padding:6px 8px} img{max-width:100%;height:auto}
                                </style></head><body>${previewData.content}</body></html>`}
                            />
                        )}
                        {previewData?.type === 'spreadsheet' && Array.isArray(previewData.content) && (
                            <div className={styles.tableWrap}>
                                <table>
                                    <tbody>
                                        {(previewData.content as unknown[][]).map((row: unknown[], i: number) => (
                                            <tr key={i} style={{ fontWeight: i === 0 ? 700 : 400 }}>
                                                {row.map((cell: unknown, j: number) => (
                                                    <td key={j}>
                                                        {formatPreviewCell(cell)}
                                                    </td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>,
                document.body,
            )}
        </>
    );
});
