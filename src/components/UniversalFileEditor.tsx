'use client';

import {
    useState,
    useEffect,
    useCallback,
    useRef,
    useMemo,
} from 'react';
import dynamic from 'next/dynamic';
import { getFileForEdit, FileEditData } from '@/actions/get-file-edit';
import { saveEditedText, saveEditedSpreadsheet, saveEditedImage, saveEditedRichText, saveEditedPdf } from '@/actions/save-file-edit';
import { updateFile } from '@/actions/update-file';
import { detectEditorType, getEditorLabel, EditorType } from '@/lib/file-type-utils';
import './editors/editors.css';

const MonacoTextEditor = dynamic(() => import('./editors/MonacoTextEditor'), { 
    ssr: false, 
    loading: () => <div className="editor-loading"><div className="loading-spinner" /><p>Loading Text Editor...</p></div> 
});
const SpreadsheetEditor = dynamic(() => import('./editors/SpreadsheetEditor'), { 
    ssr: false, 
    loading: () => <div className="editor-loading"><div className="loading-spinner" /><p>Loading Spreadsheet...</p></div> 
});
const RichTextEditor = dynamic(() => import('./editors/RichTextEditor'), { 
    ssr: false, 
    loading: () => <div className="editor-loading"><div className="loading-spinner" /><p>Loading Rich Text Editor...</p></div> 
});
const ImageEditor = dynamic(() => import('./editors/ImageEditor'), { 
    ssr: false, 
    loading: () => <div className="editor-loading"><div className="loading-spinner" /><p>Loading Image Editor...</p></div> 
});
const PdfViewer = dynamic(() => import('./editors/PdfViewer'), { 
    ssr: false, 
    loading: () => <div className="editor-loading"><div className="loading-spinner" /><p>Loading PDF viewer...</p></div> 
});

interface UniversalFileEditorProps {
    token: string;
    fileId: string;
    fileName: string;
    remainingSeconds: number;
    connectionStatus: 'connecting' | 'connected' | 'disconnected';
    onClose: () => void;
    onSaved: (fileId: string, newData?: { fileName: string; fileSize: number; fileType: string }) => void;
    preemptionCountdown?: number | null;
}

export default function UniversalFileEditor({
    token,
    fileId,
    fileName,
    remainingSeconds,
    connectionStatus,
    onClose,
    onSaved,
    preemptionCountdown,
}: UniversalFileEditorProps) {
    // ---- State ----
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isBlurred, setIsBlurred] = useState(false);

    // Editor data
    const [editorType, setEditorType] = useState<EditorType>('unsupported');
    const [textContent, setTextContent] = useState('');
    const [spreadsheetRows, setSpreadsheetRows] = useState<any[][]>([]);
    const [binaryContent, setBinaryContent] = useState(''); // base64 data URL for image
    const [richTextHtml, setRichTextHtml] = useState('');
    const [imageDataUrl, setImageDataUrl] = useState(''); // edited image output

    const replaceInputRef = useRef<HTMLInputElement>(null);
    const pdfViewerRef = useRef<{ getModifiedPdf: () => Promise<string> } | null>(null);

    // ---- File icon based on type ----
    const fileIcon = useMemo(() => {
        const icons: Record<string, string> = {
            text: '📄', json: '{ }', markdown: '📝', csv: '📊',
            spreadsheet: '📊', richtext: '📘', image: '🖼️', pdf: '📕',
            unsupported: '❓',
        };
        return icons[editorType] || '📄';
    }, [editorType]);

    // ---- Load file for editing ----
    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            setIsLoading(true);
            setError(null);

            try {
                const data: FileEditData = await getFileForEdit(token, fileId);

                if (cancelled) return;

                if (!data.success) {
                    setError(data.error || 'Failed to load file');
                    setIsLoading(false);
                    return;
                }

                // Map server type to EditorType
                const serverType = data.type || 'unsupported';
                const mimeType = data.mimeType || '';

                let detectedType: EditorType;

                if (serverType === 'richtext') {
                    detectedType = 'richtext';
                } else if (serverType === 'image') {
                    detectedType = 'image';
                } else if (serverType === 'spreadsheet') {
                    detectedType = detectEditorType(mimeType || 'text/csv', fileName);
                    if (detectedType !== 'csv' && detectedType !== 'spreadsheet') {
                        detectedType = 'spreadsheet';
                    }
                } else if (serverType === 'text') {
                    detectedType = detectEditorType(mimeType || 'text/plain', fileName);
                    if (!['text', 'json', 'markdown'].includes(detectedType)) {
                        detectedType = 'text';
                    }
                } else if (serverType === 'pdf') {
                    detectedType = 'pdf';
                } else {
                    detectedType = 'unsupported';
                }

                setEditorType(detectedType);

                // Set data based on type
                if (['text', 'json', 'markdown'].includes(detectedType)) {
                    setTextContent(data.content || '');
                } else if (['csv', 'spreadsheet'].includes(detectedType)) {
                    setSpreadsheetRows(data.rows || []);
                } else if (detectedType === 'image') {
                    setBinaryContent(data.content || '');
                } else if (detectedType === 'richtext') {
                    setRichTextHtml(data.content || '');
                } else if (detectedType === 'pdf') {
                    setBinaryContent(data.content || '');
                }
            } catch (err) {
                if (!cancelled) {
                    setError('Failed to load file for editing');
                }
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };

        load();
        return () => { cancelled = true; };
    }, [token, fileId, fileName]);

    // ---- Security: Blur on tab switch ----
    useEffect(() => {
        const handleVisibility = () => {
            setIsBlurred(document.hidden);
        };
        const handleBlur = () => setIsBlurred(true);
        const handleFocus = () => setIsBlurred(false);

        document.addEventListener('visibilitychange', handleVisibility);
        window.addEventListener('blur', handleBlur);
        window.addEventListener('focus', handleFocus);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibility);
            window.removeEventListener('blur', handleBlur);
            window.removeEventListener('focus', handleFocus);
        };
    }, []);

    // ---- Security: Block right-click, copy, print ----
    useEffect(() => {
        const blockContextMenu = (e: Event) => e.preventDefault();
        const blockKeys = (e: KeyboardEvent) => {
            // Block Ctrl+P (print)
            if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {
                e.preventDefault();
            }
            // Block PrintScreen
            if (e.key === 'PrintScreen') {
                e.preventDefault();
            }
        };

        document.addEventListener('contextmenu', blockContextMenu);
        window.addEventListener('keydown', blockKeys);

        return () => {
            document.removeEventListener('contextmenu', blockContextMenu);
            window.removeEventListener('keydown', blockKeys);
        };
    }, []);

    // ---- Auto-close on session expiry ----
    useEffect(() => {
        if (remainingSeconds <= 0) {
            onClose();
        }
    }, [remainingSeconds, onClose]);

    // ---- Format time ----
    const formatTime = (seconds: number): string => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    const timerClass = remainingSeconds <= 30 ? 'critical' : remainingSeconds <= 60 ? 'warning' : 'safe';

    // ---- Save handler ----
    const handleSave = useCallback(async () => {
        setIsSaving(true);
        try {
            let result;

            if (['text', 'json', 'markdown'].includes(editorType)) {
                result = await saveEditedText(token, fileId, textContent);
            } else if (['csv', 'spreadsheet'].includes(editorType)) {
                result = await saveEditedSpreadsheet(token, fileId, spreadsheetRows);
            } else if (editorType === 'image') {
                if (imageDataUrl) {
                    result = await saveEditedImage(token, fileId, imageDataUrl);
                } else {
                    result = { success: true }; // No changes made
                }
            } else if (editorType === 'richtext') {
                result = await saveEditedRichText(token, fileId, richTextHtml);
            } else if (editorType === 'pdf') {
                if (pdfViewerRef.current) {
                    const pdfDataUrl = await pdfViewerRef.current.getModifiedPdf();
                    result = await saveEditedPdf(token, fileId, pdfDataUrl);
                } else {
                    result = { success: true }; // No changes
                }
            }

            if (result?.success) {
                onSaved(fileId);
                onClose();
            } else {
                setError(result?.error || 'Failed to save changes');
            }
        } catch {
            setError('An error occurred while saving');
        } finally {
            setIsSaving(false);
        }
    }, [editorType, token, fileId, textContent, spreadsheetRows, imageDataUrl, richTextHtml, onSaved, onClose]);

    // ---- Auto-save on preemption ----
    useEffect(() => {
        if (preemptionCountdown === 0 && !isSaving && !error) {
            handleSave();
        }
    }, [preemptionCountdown, isSaving, error, handleSave]);

    // ---- Replace file handler ----
    const handleReplace = useCallback(async () => {
        const file = replaceInputRef.current?.files?.[0];
        if (!file) return;

        setIsSaving(true);
        try {
            const formData = new FormData();
            formData.append('file', file);
            const result = await updateFile(token, fileId, formData);
            if (result?.success) {
                onSaved(fileId, { fileName: file.name, fileSize: file.size, fileType: file.type });
                onClose();
            } else {
                setError(result?.error || 'Failed to replace file');
            }
        } catch {
            setError('Failed to replace file');
        } finally {
            setIsSaving(false);
        }
    }, [token, fileId, onSaved, onClose]);

    // ---- Render the correct sub-editor ----
    const renderEditor = () => {
        if (isLoading) {
            return (
                <div className="editor-loading">
                    <div className="loading-spinner" />
                    <p>Decrypting and loading file...</p>
                </div>
            );
        }

        if (error) {
            return (
                <div className="editor-loading">
                    <p style={{ color: '#ef4444' }}>{error}</p>
                </div>
            );
        }

        return (
            <>
                {['text', 'json', 'markdown'].includes(editorType) && (
                    <MonacoTextEditor
                        content={textContent}
                        onChange={setTextContent}
                        editorType={editorType}
                        fileName={fileName}
                    />
                )}

                {['csv', 'spreadsheet'].includes(editorType) && (
                    <SpreadsheetEditor
                        rows={spreadsheetRows}
                        onChange={setSpreadsheetRows}
                    />
                )}


                {editorType === 'richtext' && (
                    <RichTextEditor
                        content={richTextHtml}
                        onChange={setRichTextHtml}
                    />
                )}

                {editorType === 'image' && (
                    <ImageEditor
                        content={binaryContent}
                        onChange={setImageDataUrl}
                    />
                )}

                {editorType === 'pdf' && (
                    <PdfViewer
                        ref={pdfViewerRef}
                        content={binaryContent}
                        onChange={() => {}}
                    />
                )}

                {editorType === 'unsupported' && (
                    <div className="editor-loading">
                        <p style={{ color: '#f59e0b' }}>
                            This file type is not supported for inline editing.
                            <br />
                            Use &quot;Replace&quot; to upload a new version.
                        </p>
                    </div>
                )}
            </>
        );
    };

    return (
        <div className="editor-overlay">
            <div className={`editor-shell ${isBlurred ? 'blurred' : ''}`}>
                {/* ---- Preemption Warning Banner ---- */}
                {preemptionCountdown !== undefined && preemptionCountdown !== null && preemptionCountdown > 0 && (
                    <div style={{
                        background: '#EF4444', 
                        color: '#ffffff', 
                        padding: '12px 20px', 
                        textAlign: 'center', 
                        fontSize: '14px', 
                        fontWeight: 600,
                        borderBottom: '1px solid #B91C1C',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        animation: preemptionCountdown <= 10 ? 'pulse 1s infinite' : 'none'
                    }}>
                        ⚠️ Higher-level user active. Editing will be restricted in {preemptionCountdown}s. 
                        Files will autosave automatically.
                    </div>
                )}
                
                {/* ---- Top Toolbar ---- */}
                <div className="editor-toolbar">
                    <div className="editor-toolbar-left">
                        <div className="editor-file-icon">{fileIcon}</div>
                        <div className="editor-file-info">
                            <span className="editor-file-name">{fileName}</span>
                            <span className="editor-file-type">{getEditorLabel(editorType)}</span>
                        </div>
                    </div>

                    <div className="editor-toolbar-actions">
                        {/* Save */}
                        <button
                            className="editor-btn primary"
                            onClick={handleSave}
                            disabled={isSaving || editorType === 'unsupported'}
                        >
                            {isSaving ? '⏳ Saving...' : '💾 Save'}
                        </button>

                        {/* Replace */}
                        <label className="editor-btn secondary" style={{ cursor: 'pointer' }}>
                            📎 Replace
                            <input
                                ref={replaceInputRef}
                                type="file"
                                className="editor-replace-input"
                                onChange={handleReplace}
                            />
                        </label>

                        {/* Version History (placeholder) */}
                        <button className="editor-btn secondary" disabled title="Coming soon">
                            🕐 History
                        </button>

                        {/* Close */}
                        <button className="editor-btn close" onClick={onClose} title="Close editor">
                            ×
                        </button>
                    </div>
                </div>

                {/* ---- Main Editor Area ---- */}
                <div className="editor-main">
                    {renderEditor()}
                </div>

                {/* ---- Footer ---- */}
                <div className="editor-footer">
                    <div className="editor-footer-left">
                        <div className={`editor-session-timer ${timerClass}`}>
                            ⏱ {formatTime(remainingSeconds)}
                        </div>
                        <div className={`editor-connection-badge ${connectionStatus}`}>
                            <span className="editor-connection-dot" />
                            {connectionStatus === 'connected' ? 'LIVE' : 'OFFLINE'}
                        </div>
                    </div>
                    <div className="editor-footer-right">
                        <div className="editor-security-badge">
                            🔒 AES-256 Encrypted
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
