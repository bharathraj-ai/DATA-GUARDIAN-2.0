'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TextStyleKit } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import { TableKit } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import { WordRibbon } from './WordRibbon';
import { parseWordFile } from './wordParsers';
import './word.css';

interface WordEditorProps {
    token?: string;
    fileId?: string;
    initialFile: File;
    forceReadOnly?: boolean;
    onClose?: () => void;
    onSave?: (file: File) => Promise<void>;
    onSubmit?: (file: File) => Promise<void>;
}

export default function WordEditor({
    token,
    fileId,
    initialFile,
    forceReadOnly,
    onClose,
    onSave,
    onSubmit,
}: WordEditorProps) {
    const [fileName, setFileName] = useState(initialFile.name);
    const [sourceExt, setSourceExt] = useState('.docx');
    const [loading, setLoading] = useState(true);
    const [loadingMsg, setLoadingMsg] = useState('Opening document…');
    const [error, setError] = useState<string | null>(null);
    const [confirmSubmit, setConfirmSubmit] = useState(false);
    const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const dirtyRef = useRef(false);
    const htmlRef = useRef('<p></p>');
    const sourceExtRef = useRef('.docx');
    const fileNameRef = useRef(initialFile.name);
    const savingRef = useRef(false);

    const editor = useEditor({
        immediatelyRender: false,
        shouldRerenderOnTransaction: false,
        editable: !forceReadOnly,
        extensions: [
            StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
            TextStyleKit,
            TextAlign.configure({ types: ['heading', 'paragraph'] }),
            Highlight.configure({ multicolor: true }),
            TableKit.configure({ table: { resizable: true } }),
            Image.configure({ allowBase64: true, inline: false }),
        ],
        content: '<p></p>',
        onUpdate: ({ editor: ed }) => {
            htmlRef.current = ed.getHTML();
            dirtyRef.current = true;
        },
    });

    useEffect(() => {
        editor?.setEditable(!forceReadOnly);
    }, [editor, forceReadOnly]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            setError(null);
            setLoadingMsg(`Opening ${initialFile.name}…`);
            try {
                const parsed = await parseWordFile(initialFile);
                if (cancelled) return;
                setFileName(parsed.name);
                setSourceExt(parsed.sourceExt);
                fileNameRef.current = parsed.name;
                sourceExtRef.current = parsed.sourceExt;
                htmlRef.current = parsed.html;
                editor?.commands.setContent(parsed.html || '<p></p>', { emitUpdate: false });
                dirtyRef.current = false;
            } catch (err) {
                if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to open document');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [initialFile, editor]);

    const persist = useCallback(async (submit: boolean) => {
        if (savingRef.current || forceReadOnly) return;
        const action = submit ? onSubmit : onSave;
        if (!action) return;
        savingRef.current = true;
        setSaveState('saving');
        try {
            const { exportWordHtml } = await import('./wordExporters');
            const file = await exportWordHtml(htmlRef.current, fileNameRef.current, sourceExtRef.current);
            await action(file);
            dirtyRef.current = false;
            setSaveState('saved');
            if (submit && token) {
                try { sessionStorage.setItem('dg:internal-nav', '1'); } catch { /* ignore */ }
                window.location.assign(`/view/${token}`);
            }
        } catch (err) {
            console.error(err);
            setSaveState('error');
            if (submit) alert(err instanceof Error ? err.message : 'Save failed');
        } finally {
            savingRef.current = false;
        }
    }, [forceReadOnly, onSave, onSubmit, token]);

    useEffect(() => {
        if (forceReadOnly) return;
        const timer = window.setInterval(() => {
            if (dirtyRef.current) void persist(false);
        }, 30_000);
        return () => window.clearInterval(timer);
    }, [forceReadOnly, persist]);

    useEffect(() => {
        const onForce = (ev: Event) => {
            const detail = (ev as CustomEvent).detail as { fileId?: string } | undefined;
            if (detail?.fileId && fileId && detail.fileId !== fileId) return;
            if (!dirtyRef.current) return;
            void persist(false);
        };
        window.addEventListener('dg:force-autosave', onForce as EventListener);
        return () => window.removeEventListener('dg:force-autosave', onForce as EventListener);
    }, [fileId, persist]);

    return (
        <div className="word-shell">
            <div className="word-topbar">
                {onClose && (
                    <button type="button" className="word-btn" onClick={onClose}>Back</button>
                )}
                <h1>{fileName}</h1>
                <span className="meta">{sourceExt.replace('.', '').toUpperCase()} · Word editor</span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                    {!forceReadOnly && (
                        <>
                            <button type="button" className="word-btn" onClick={() => void persist(false)} disabled={saveState === 'saving'}>
                                {saveState === 'saving' ? 'Saving…' : 'Save draft'}
                            </button>
                            <button
                                type="button"
                                className="word-btn"
                                style={{ background: '#0284c7', color: '#fff', borderColor: '#0284c7' }}
                                onClick={() => setConfirmSubmit(true)}
                            >
                                Commit
                            </button>
                        </>
                    )}
                </div>
            </div>

            <WordRibbon editor={editor} readOnly={forceReadOnly || loading} />

            <div className="word-stage">
                {loading ? (
                    <div className="word-page" style={{ minHeight: 240, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>
                        {loadingMsg}
                    </div>
                ) : error ? (
                    <div className="word-page" style={{ minHeight: 240, color: '#b91c1c' }}>{error}</div>
                ) : (
                    <div className="word-page">
                        <EditorContent editor={editor} />
                    </div>
                )}
            </div>

            <div className="word-status">
                <span>{forceReadOnly ? 'Read only' : 'Editing in session · autosave every 30s'}</span>
                <span>
                    {saveState === 'saved' ? 'Draft saved' : saveState === 'error' ? 'Save failed' : saveState === 'saving' ? 'Saving…' : 'Ready'}
                </span>
            </div>

            {confirmSubmit && (
                <div className="confirm-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
                    <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: 'min(420px, 92vw)', boxShadow: '0 20px 50px rgba(15,23,42,0.2)' }}>
                        <h2 style={{ margin: '0 0 10px', fontSize: 20 }}>Commit changes?</h2>
                        <p style={{ margin: '0 0 20px', color: '#64748b', fontSize: 14, lineHeight: 1.6 }}>
                            This saves the edited {sourceExt === '.pdf' ? 'PDF' : 'Word'} document into the secure link.
                        </p>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                            <button type="button" className="word-btn" onClick={() => setConfirmSubmit(false)}>Cancel</button>
                            <button
                                type="button"
                                className="word-btn"
                                style={{ background: '#0284c7', color: '#fff', borderColor: '#0284c7' }}
                                onClick={() => { setConfirmSubmit(false); void persist(true); }}
                            >
                                Commit changes
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
