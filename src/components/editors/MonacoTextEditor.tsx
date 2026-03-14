'use client';

import { useRef, useCallback } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import { getMonacoLanguage, EditorType } from '@/lib/file-type-utils';

interface MonacoTextEditorProps {
    content: string;
    onChange: (value: string) => void;
    editorType: EditorType;
    fileName?: string;
    readOnly?: boolean;
}

export default function MonacoTextEditor({
    content,
    onChange,
    editorType,
    fileName,
    readOnly = false,
}: MonacoTextEditorProps) {
    const editorRef = useRef<any>(null);

    const language = getMonacoLanguage(editorType, fileName);

    const handleMount: OnMount = useCallback((editor) => {
        editorRef.current = editor;
        editor.focus();
    }, []);

    const handleChange = useCallback(
        (value: string | undefined) => {
            onChange(value ?? '');
        },
        [onChange]
    );

    return (
        <div className="monaco-editor-wrapper">
            <Editor
                height="100%"
                language={language}
                value={content}
                onChange={handleChange}
                onMount={handleMount}
                theme="vs-dark"
                options={{
                    readOnly,
                    minimap: { enabled: false },
                    fontSize: 14,
                    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
                    lineNumbers: 'on',
                    wordWrap: 'on',
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    padding: { top: 16 },
                    contextmenu: false, // Security: disable right-click menu
                    copyWithSyntaxHighlighting: false,
                    domReadOnly: readOnly,
                    renderWhitespace: 'selection',
                    bracketPairColorization: { enabled: true },
                    smoothScrolling: true,
                    cursorBlinking: 'smooth',
                    cursorSmoothCaretAnimation: 'on',
                }}
            />
        </div>
    );
}
