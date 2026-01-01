"use client";

import { useEditor, EditorContent } from '@tiptap/react';
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from '@/lib/firebase';

import StarterKit from '@tiptap/starter-kit';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import ImageExtension from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import TextAlign from '@tiptap/extension-text-align';
import styles from './AnswerEditor.module.scss';

import { MathExtension } from './MathExtension';
import { IndentExtension } from './IndentExtension';
import { HtmlTagExtension } from './HtmlTagExtension';
import { useState, useEffect, useRef } from 'react';
// ... (imports remain same)

// Simple SVG Icons
const Icons = {
    Bold: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" /><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" /></svg>,
    Italic: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="4" x2="10" y2="4" /><line x1="14" y1="20" x2="5" y2="20" /><line x1="15" y1="4" x2="9" y2="20" /></svg>,
    Underline: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3v7a6 6 0 0 0 6 6 6 6 0 0 0 6-6V3" /><line x1="4" y1="21" x2="20" y2="21" /></svg>,
    Highlight: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 11-6 6v3h9l3-3" /><path d="m22 2-2.3 2.3c-.6.6-1.5.6-2.1 0l-3-3c-.6-.6-.6-1.5 0-2.1l2.3-2.3" /><line x1="16" y1="5" x2="19" y2="8" /></svg>,
    Left: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="17" y1="10" x2="3" y2="10" /><line x1="21" y1="6" x2="3" y2="6" /><line x1="21" y1="14" x2="3" y2="14" /><line x1="17" y1="18" x2="3" y2="18" /></svg>,
    Center: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="10" x2="6" y2="10" /><line x1="21" y1="6" x2="3" y2="6" /><line x1="21" y1="14" x2="3" y2="14" /><line x1="18" y1="18" x2="6" y2="18" /></svg>,
    Right: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="21" y1="10" x2="7" y2="10" /><line x1="21" y1="6" x2="3" y2="6" /><line x1="21" y1="14" x2="3" y2="14" /><line x1="21" y1="18" x2="7" y2="18" /></svg>,
    Bullet: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>,
    Ordered: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="10" y1="6" x2="21" y2="6" /><line x1="10" y1="12" x2="21" y2="12" /><line x1="10" y1="18" x2="21" y2="18" /><path d="M4 6h1v4" /><path d="M4 10h2" /><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" /></svg>,
    Indent: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 8 7 12 3 16" /><line x1="21" y1="12" x2="7" y2="12" /><line x1="21" y1="6" x2="11" y2="6" /><line x1="21" y1="18" x2="11" y2="18" /></svg>,
    Outdent: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="11 8 7 12 11 16" /><line x1="21" y1="12" x2="7" y2="12" /><line x1="21" y1="6" x2="11" y2="6" /><line x1="21" y1="18" x2="11" y2="18" /></svg>,
    Image: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>,
    Math: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 16.5h3L11 5l5 14h4" /></svg>, // Simple Sigma-ish or generic
    Table: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 9h18" /><path d="M3 15h18" /><path d="M9 3v18" /><path d="M15 3v18" /></svg>,
    // Table Operations
    ColBefore: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M9 3v18" /><path d="M3 9h18" /><path d="M3 15h18" /><path d="M12 9l3 3l-3 3" /><line x1="15" y1="12" x2="19" y2="12" /></svg>,
    ColAfter: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M15 3v18" /><path d="M3 9h18" /><path d="M3 15h18" /><path d="M12 9l-3 3l3 3" /><line x1="9" y1="12" x2="5" y2="12" /></svg>,
    RowBefore: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 9h18" /><path d="M9 3v18" /><path d="M15 3v18" /><path d="M9 12l3 3l3-3" /><line x1="12" y1="15" x2="12" y2="19" /></svg>,
    RowAfter: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 15h18" /><path d="M9 3v18" /><path d="M15 3v18" /><path d="M9 12l3-3l3 3" /><line x1="12" y1="9" x2="12" y2="5" /></svg>,
    Merge: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 19h8a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2z" /><path d="M8 11h8" /></svg>,
    Split: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="12" y1="3" x2="12" y2="21" /><line x1="3" y1="12" x2="21" y2="12" /></svg>,
    DeleteCol: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3v18" /><path d="M15 3v18" /><line x1="3" y1="3" x2="21" y2="21" /><line x1="21" y1="3" x2="3" y2="21" /></svg>,
    DeleteRow: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9h18" /><path d="M3 15h18" /><line x1="3" y1="3" x2="21" y2="21" /><line x1="21" y1="3" x2="3" y2="21" /></svg>,
    Trash: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
};


const MenuBar = ({ editor }) => {
    // ... (state hooks) ...
    const [modalType, setModalType] = useState(null);
    const [inputValue, setInputValue] = useState("");

    const fileInputRef = useRef(null);
    const [isUploading, setIsUploading] = useState(false);

    if (!editor) { return null; }

    const openModal = (type) => { setModalType(type); setInputValue(type === 'math' ? 'E = mc^2' : ''); };
    const closeModal = () => { setModalType(null); setInputValue(""); setIsUploading(false); };
    const handleInsert = () => {
        if (!inputValue) { closeModal(); return; }
        if (modalType === 'image') { editor.chain().focus().setImage({ src: inputValue }).run(); }
        else if (modalType === 'math') { editor.chain().focus().insertMath(inputValue).run(); }
        closeModal();
    };

    const handleFileUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsUploading(true);

        try {
            // Create a unique filename
            const timestamp = Date.now();
            const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '');
            const filename = `uploads/${timestamp}_${safeName}`;

            // Create storage ref
            const storageRef = ref(storage, filename);

            // Upload
            await uploadBytes(storageRef, file);

            // Get URL
            const url = await getDownloadURL(storageRef);
            setInputValue(url);

        } catch (err) {
            console.error(err);
            alert('画像のアップロードに失敗しました。\nFirebase Storageの設定(CORS/Rules)を確認してください。');
        } finally {
            setIsUploading(false);
        }
    };

    // Helper functions (Indent/Outdent)
    const handleIndent = () => { if (editor.isActive('bulletList') || editor.isActive('orderedList')) { editor.chain().focus().sinkListItem('listItem').run(); } else { editor.chain().focus().indent().run(); } };
    const handleOutdent = () => { if (editor.isActive('bulletList') || editor.isActive('orderedList')) { editor.chain().focus().liftListItem('listItem').run(); } else { editor.chain().focus().outdent().run(); } };

    return (
        <div className={styles.menubar}>
            {/* ... Existing Groups ... */}
            <div className={styles.group}>
                <button type="button" onClick={() => editor.chain().focus().toggleBold().run()} className={editor.isActive('bold') ? styles.active : ''} title="太字"><Icons.Bold /></button>
                <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()} className={editor.isActive('italic') ? styles.active : ''} title="斜体"><Icons.Italic /></button>
                <button type="button" onClick={() => editor.chain().focus().toggleUnderline().run()} className={editor.isActive('underline') ? styles.active : ''} title="下線"><Icons.Underline /></button>
                <button type="button" onClick={() => editor.chain().focus().toggleHighlight().run()} className={editor.isActive('highlight') ? styles.active : ''} title="ハイライト"><Icons.Highlight /></button>
            </div>

            <div className={styles.group}>
                <button type="button" onClick={() => editor.chain().focus().setTextAlign('left').run()} className={editor.isActive({ textAlign: 'left' }) ? styles.active : ''} title="左揃え"><Icons.Left /></button>
                <button type="button" onClick={() => editor.chain().focus().setTextAlign('center').run()} className={editor.isActive({ textAlign: 'center' }) ? styles.active : ''} title="中央揃え"><Icons.Center /></button>
                <button type="button" onClick={() => editor.chain().focus().setTextAlign('right').run()} className={editor.isActive({ textAlign: 'right' }) ? styles.active : ''} title="右揃え"><Icons.Right /></button>
            </div>

            <div className={styles.group}>
                <button type="button" onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} className={editor.isActive('heading', { level: 1 }) ? styles.active : ''} title="大見出し">H1</button>
                <button type="button" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} className={editor.isActive('heading', { level: 2 }) ? styles.active : ''} title="中見出し">H2</button>
                <button type="button" onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} className={editor.isActive('heading', { level: 3 }) ? styles.active : ''} title="小見出し">H3</button>
            </div>

            <div className={styles.group}>
                <button type="button" onClick={() => editor.chain().focus().toggleBulletList().run()} className={editor.isActive('bulletList') ? styles.active : ''} title="箇条書き"><Icons.Bullet /></button>
                <button type="button" onClick={() => editor.chain().focus().toggleOrderedList().run()} className={editor.isActive('orderedList') ? styles.active : ''} title="番号付リスト"><Icons.Ordered /></button>
                <button type="button" onClick={handleIndent} title="インデント増"><Icons.Indent /></button>
                <button type="button" onClick={handleOutdent} title="インデント減"><Icons.Outdent /></button>
            </div>

            <div className={styles.group}>
                <button type="button" onClick={() => editor.chain().focus().toggleSubscript().run()} className={editor.isActive('subscript') ? styles.active : ''} title="下付き">sub</button>
                <button type="button" onClick={() => editor.chain().focus().toggleSuperscript().run()} className={editor.isActive('superscript') ? styles.active : ''} title="上付き">sup</button>
            </div>

            <div className={styles.group}>
                <button type="button" onClick={() => openModal('math')} title="数式挿入"><Icons.Math /></button>
                <button type="button" onClick={() => openModal('image')} title="画像挿入"><Icons.Image /></button>
                <button type="button" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} title="表挿入"><Icons.Table /></button>
            </div>

            {editor.isActive('table') && (
                <div className={styles.tableControls}>
                    <button type="button" onClick={() => editor.chain().focus().addColumnBefore().run()} title="左に列追加"><Icons.ColBefore /></button>
                    <button type="button" onClick={() => editor.chain().focus().addColumnAfter().run()} title="右に列追加"><Icons.ColAfter /></button>
                    <button type="button" onClick={() => editor.chain().focus().deleteColumn().run()} title="列削除" className={styles.deleteAction}><Icons.DeleteCol /></button>
                    <div className={styles.divider} />
                    <button type="button" onClick={() => editor.chain().focus().addRowBefore().run()} title="上に行追加"><Icons.RowBefore /></button>
                    <button type="button" onClick={() => editor.chain().focus().addRowAfter().run()} title="下に行追加"><Icons.RowAfter /></button>
                    <button type="button" onClick={() => editor.chain().focus().deleteRow().run()} title="行削除" className={styles.deleteAction}><Icons.DeleteRow /></button>
                    <div className={styles.divider} />
                    <button type="button" onClick={() => editor.chain().focus().mergeCells().run()} title="セル結合"><Icons.Merge /></button>
                    <button type="button" onClick={() => editor.chain().focus().splitCell().run()} title="セル分割"><Icons.Split /></button>
                    <button type="button" onClick={() => editor.chain().focus().deleteTable().run()} title="表全体削除" className={styles.deleteAction}><Icons.Trash /></button>
                </div>
            )}

            {/* Simple Modal Overlay */}
            {modalType && (
                <div className={styles.modalOverlay}>
                    <div className={styles.modalContent}>
                        <h4>{modalType === 'math' ? '数式を入力 (LaTeX)' : '画像のURLを入力'}</h4>
                        {modalType === 'image' && (
                            <div style={{ marginBottom: '1rem' }}>
                                <label style={{ display: 'block', fontSize: '0.8rem', color: '#666', marginBottom: '0.5rem' }}>
                                    ローカル画像をアップロード:
                                </label>
                                <input
                                    type="file"
                                    accept="image/*"
                                    onChange={handleFileUpload}
                                    disabled={isUploading}
                                    style={{ fontSize: '0.9rem' }}
                                />
                                {isUploading && <span style={{ marginLeft: '0.5rem', fontSize: '0.8rem' }}>アップロード中...</span>}
                            </div>
                        )}
                        <input
                            type="text"
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleInsert(); }}
                            placeholder={modalType === 'image' ? "またはURLを直接入力" : ""}
                            autoFocus
                        />
                        <div className={styles.modalActions}>
                            <button onClick={closeModal} className={styles.cancelBtn}>キャンセル</button>
                            <button onClick={handleInsert} className={styles.insertBtn}>挿入</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
// ... (export default AnswerEditor remains same)

export default function AnswerEditor({ content, onChange }) {
    const extensionConfig = [
        StarterKit.configure({
            heading: {
                levels: [1, 2, 3], // Enable #, ##, ### shortcuts
            },
            bulletList: {
                keepMarks: true,
                keepAttributes: false, // Default
            },
            orderedList: {
                keepMarks: true,
                keepAttributes: false, // Default
            },
            // Bold, Italic input rules (markdown) are enabled by default
        }),
        ImageExtension,
        Link,
        Underline,
        TextStyle,
        Color,
        Highlight,
        Subscript,
        Superscript,
        MathExtension,
        IndentExtension, // Add Custom Indent
        IndentExtension, // Add Custom Indent
        TextAlign.configure({
            types: ['heading', 'paragraph', 'tableCell', 'tableHeader'],
        }),
    ];



    // Safely add Table extensions
    if (Table && Table.configure) {
        extensionConfig.push(
            Table.configure({ resizable: true }),
            TableRow,
            TableHeader,
            TableCell
        );
    }

    // Add custom HTML parsing extension
    extensionConfig.push(HtmlTagExtension);

    const editor = useEditor({
        extensions: extensionConfig,
        content: content || '<p>解説を入力...</p>',
        immediatelyRender: false,
        onUpdate: ({ editor }) => {
            onChange(editor.getHTML());
        },
    });

    // Sync content updates from parent (e.g. initial load)
    useEffect(() => {
        if (editor && content && editor.getHTML() !== content) {
            // Avoid resetting cursor or creating loop if content is essentially same
            // Simple check: if editor is empty or content changed significantly
            editor.commands.setContent(content);
        }
    }, [editor, content]);

    return (
        <div className={styles.editorWrapper}>
            <MenuBar editor={editor} />
            <EditorContent editor={editor} className={styles.content} />
        </div>
    );
}
