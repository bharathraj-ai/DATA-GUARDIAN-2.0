'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { useCallback } from 'react';

interface RichTextEditorProps {
    content: string; // HTML string
    onChange: (html: string) => void;
    readOnly?: boolean;
}

export default function RichTextEditor({
    content,
    onChange,
    readOnly = false,
}: RichTextEditorProps) {
    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                heading: { levels: [1, 2, 3] },
            }),
            Image,
        ],
        content,
        editable: !readOnly,
        onUpdate: ({ editor }) => {
            onChange(editor.getHTML());
        },
        editorProps: {
            attributes: {
                class: 'richtext-content',
            },
            handleDOMEvents: {
                contextmenu: (_view, event) => {
                    event.preventDefault();
                    return true;
                },
            },
        },
    });

    const toggleBold = useCallback(() => {
        editor?.chain().focus().toggleBold().run();
    }, [editor]);

    const toggleItalic = useCallback(() => {
        editor?.chain().focus().toggleItalic().run();
    }, [editor]);

    const toggleStrike = useCallback(() => {
        editor?.chain().focus().toggleStrike().run();
    }, [editor]);

    const toggleBulletList = useCallback(() => {
        editor?.chain().focus().toggleBulletList().run();
    }, [editor]);

    const toggleOrderedList = useCallback(() => {
        editor?.chain().focus().toggleOrderedList().run();
    }, [editor]);

    const toggleBlockquote = useCallback(() => {
        editor?.chain().focus().toggleBlockquote().run();
    }, [editor]);

    const setHeading = useCallback(
        (level: 1 | 2 | 3) => {
            editor?.chain().focus().toggleHeading({ level }).run();
        },
        [editor]
    );

    const toggleCode = useCallback(() => {
        editor?.chain().focus().toggleCodeBlock().run();
    }, [editor]);

    if (!editor) return null;

    return (
        <div className="richtext-editor">
            {/* Formatting Toolbar */}
            {!readOnly && (
                <div className="richtext-toolbar">
                    <div className="richtext-toolbar-group">
                        <button
                            onClick={() => setHeading(1)}
                            className={`richtext-btn ${editor.isActive('heading', { level: 1 }) ? 'active' : ''}`}
                            title="Heading 1"
                        >
                            H1
                        </button>
                        <button
                            onClick={() => setHeading(2)}
                            className={`richtext-btn ${editor.isActive('heading', { level: 2 }) ? 'active' : ''}`}
                            title="Heading 2"
                        >
                            H2
                        </button>
                        <button
                            onClick={() => setHeading(3)}
                            className={`richtext-btn ${editor.isActive('heading', { level: 3 }) ? 'active' : ''}`}
                            title="Heading 3"
                        >
                            H3
                        </button>
                    </div>

                    <div className="richtext-toolbar-divider" />

                    <div className="richtext-toolbar-group">
                        <button
                            onClick={toggleBold}
                            className={`richtext-btn ${editor.isActive('bold') ? 'active' : ''}`}
                            title="Bold"
                        >
                            <strong>B</strong>
                        </button>
                        <button
                            onClick={toggleItalic}
                            className={`richtext-btn ${editor.isActive('italic') ? 'active' : ''}`}
                            title="Italic"
                        >
                            <em>I</em>
                        </button>
                        <button
                            onClick={toggleStrike}
                            className={`richtext-btn ${editor.isActive('strike') ? 'active' : ''}`}
                            title="Strikethrough"
                        >
                            <s>S</s>
                        </button>
                    </div>

                    <div className="richtext-toolbar-divider" />

                    <div className="richtext-toolbar-group">
                        <button
                            onClick={toggleBulletList}
                            className={`richtext-btn ${editor.isActive('bulletList') ? 'active' : ''}`}
                            title="Bullet List"
                        >
                            • List
                        </button>
                        <button
                            onClick={toggleOrderedList}
                            className={`richtext-btn ${editor.isActive('orderedList') ? 'active' : ''}`}
                            title="Ordered List"
                        >
                            1. List
                        </button>
                        <button
                            onClick={toggleBlockquote}
                            className={`richtext-btn ${editor.isActive('blockquote') ? 'active' : ''}`}
                            title="Blockquote"
                        >
                            ❝ Quote
                        </button>
                        <button
                            onClick={toggleCode}
                            className={`richtext-btn ${editor.isActive('codeBlock') ? 'active' : ''}`}
                            title="Code Block"
                        >
                            {'</>'}
                        </button>
                    </div>
                </div>
            )}

            {/* Editor Area */}
            <div className="richtext-content-wrapper">
                <EditorContent editor={editor} />
            </div>
        </div>
    );
}
