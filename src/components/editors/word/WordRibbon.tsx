'use client';

import type { ReactNode } from 'react';
import type { Editor } from '@tiptap/react';

const FONTS = ['Calibri', 'Times New Roman', 'Arial', 'Georgia', 'Inter', 'Courier New'];
const SIZES = ['10px', '11px', '12px', '14px', '16px', '18px', '20px', '24px', '28px', '36px'];

function Btn({
    on,
    disabled,
    title,
    onClick,
    children,
}: {
    on?: boolean;
    disabled?: boolean;
    title: string;
    onClick: () => void;
    children: ReactNode;
}) {
    return (
        <button type="button" className={`word-btn${on ? ' on' : ''}`} title={title} disabled={disabled} onClick={onClick}>
            {children}
        </button>
    );
}

export function WordRibbon({ editor, readOnly }: { editor: Editor | null; readOnly?: boolean }) {
    if (!editor) return null;
    const off = Boolean(readOnly);

    return (
        <div className="word-ribbon">
            <div className="word-group">
                <label>Clipboard</label>
                <div className="word-row">
                    <Btn title="Undo" disabled={off || !editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>Undo</Btn>
                    <Btn title="Redo" disabled={off || !editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>Redo</Btn>
                </div>
            </div>

            <div className="word-group">
                <label>Font</label>
                <div className="word-row">
                    <select
                        className="word-select"
                        disabled={off}
                        value={editor.getAttributes('textStyle').fontFamily || 'Calibri'}
                        onChange={(e) => editor.chain().focus().setFontFamily(e.target.value).run()}
                    >
                        {FONTS.map((font) => (
                            <option key={font} value={font} style={{ fontFamily: font }}>{font}</option>
                        ))}
                    </select>
                    <select
                        className="word-select"
                        disabled={off}
                        value={editor.getAttributes('textStyle').fontSize || '14px'}
                        onChange={(e) => editor.chain().focus().setFontSize(e.target.value).run()}
                    >
                        {SIZES.map((size) => (
                            <option key={size} value={size}>{size.replace('px', '')}</option>
                        ))}
                    </select>
                    <Btn on={editor.isActive('bold')} disabled={off} title="Bold" onClick={() => editor.chain().focus().toggleBold().run()}>B</Btn>
                    <Btn on={editor.isActive('italic')} disabled={off} title="Italic" onClick={() => editor.chain().focus().toggleItalic().run()}><em>I</em></Btn>
                    <Btn on={editor.isActive('underline')} disabled={off} title="Underline" onClick={() => editor.chain().focus().toggleUnderline().run()}><u>U</u></Btn>
                    <Btn on={editor.isActive('strike')} disabled={off} title="Strikethrough" onClick={() => editor.chain().focus().toggleStrike().run()}><s>S</s></Btn>
                    <label className="word-btn" title="Text color" style={{ padding: '0 6px' }}>
                        A
                        <input
                            className="word-color"
                            type="color"
                            disabled={off}
                            value={editor.getAttributes('textStyle').color || '#0f172a'}
                            onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
                        />
                    </label>
                    <label className="word-btn" title="Highlight" style={{ padding: '0 6px' }}>
                        H
                        <input
                            className="word-color"
                            type="color"
                            disabled={off}
                            value={editor.getAttributes('highlight').color || '#fde68a'}
                            onChange={(e) => editor.chain().focus().toggleHighlight({ color: e.target.value }).run()}
                        />
                    </label>
                </div>
            </div>

            <div className="word-group">
                <label>Paragraph</label>
                <div className="word-row">
                    <Btn on={editor.isActive({ textAlign: 'left' })} disabled={off} title="Align left" onClick={() => editor.chain().focus().setTextAlign('left').run()}>Left</Btn>
                    <Btn on={editor.isActive({ textAlign: 'center' })} disabled={off} title="Center" onClick={() => editor.chain().focus().setTextAlign('center').run()}>Center</Btn>
                    <Btn on={editor.isActive({ textAlign: 'right' })} disabled={off} title="Align right" onClick={() => editor.chain().focus().setTextAlign('right').run()}>Right</Btn>
                    <Btn on={editor.isActive({ textAlign: 'justify' })} disabled={off} title="Justify" onClick={() => editor.chain().focus().setTextAlign('justify').run()}>Justify</Btn>
                    <Btn on={editor.isActive('bulletList')} disabled={off} title="Bullets" onClick={() => editor.chain().focus().toggleBulletList().run()}>• List</Btn>
                    <Btn on={editor.isActive('orderedList')} disabled={off} title="Numbering" onClick={() => editor.chain().focus().toggleOrderedList().run()}>1. List</Btn>
                </div>
            </div>

            <div className="word-group">
                <label>Styles</label>
                <div className="word-row">
                    <Btn on={editor.isActive('paragraph')} disabled={off} title="Normal" onClick={() => editor.chain().focus().setParagraph().run()}>Normal</Btn>
                    <Btn on={editor.isActive('heading', { level: 1 })} disabled={off} title="Heading 1" onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>H1</Btn>
                    <Btn on={editor.isActive('heading', { level: 2 })} disabled={off} title="Heading 2" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</Btn>
                    <Btn on={editor.isActive('heading', { level: 3 })} disabled={off} title="Heading 3" onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>H3</Btn>
                </div>
            </div>

            <div className="word-group">
                <label>Insert</label>
                <div className="word-row">
                    <Btn disabled={off} title="Insert table" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>Table</Btn>
                    <label className="word-btn" title="Insert image">
                        Image
                        <input
                            type="file"
                            accept="image/*"
                            disabled={off}
                            style={{ display: 'none' }}
                            onChange={(e) => {
                                const file = e.target.files?.[0];
                                e.target.value = '';
                                if (!file) return;
                                const reader = new FileReader();
                                reader.onload = () => {
                                    if (typeof reader.result === 'string') {
                                        editor.chain().focus().setImage({ src: reader.result }).run();
                                    }
                                };
                                reader.readAsDataURL(file);
                            }}
                        />
                    </label>
                    <Btn disabled={off || !editor.can().addColumnAfter()} title="Add column" onClick={() => editor.chain().focus().addColumnAfter().run()}>+ Col</Btn>
                    <Btn disabled={off || !editor.can().addRowAfter()} title="Add row" onClick={() => editor.chain().focus().addRowAfter().run()}>+ Row</Btn>
                </div>
            </div>
        </div>
    );
}
