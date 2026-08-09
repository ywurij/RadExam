"use client";

import { useEditor, EditorContent } from '@tiptap/react';

import StarterKit from '@tiptap/starter-kit';
import { CustomTable, CustomTableCell, CustomTableHeader } from './TableExtensions';
import { TableRow } from '@tiptap/extension-table-row';
import ImageExtension from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import TextAlign from '@tiptap/extension-text-align';
import Placeholder from '@tiptap/extension-placeholder';
import styles from './AnswerEditor.module.scss';

import { MathExtension } from './MathExtension';
import { IndentExtension } from './IndentExtension';
import { searchQuestions } from '@/lib/data';
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
    Trash: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>,
    Book: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></svg>,
    DownChevron: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>,
    Help: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
};


// LaTeX Cheat Sheet Data
const LATEX_CHEAT_SHEET = {
    '基本': [
        { label: '分数', code: '\\frac{a}{b}' },
        { label: '上付き', code: '^{2}' },
        { label: '下付き', code: '_{1}' },
        { label: 'ルート', code: '\\sqrt{x}' },
    ],
    '演算子': [
        { label: '×', code: '\\times' },
        { label: '÷', code: '\\div' },
        { label: '±', code: '\\pm' },
        { label: '≠', code: '\\neq' },
        { label: '≒', code: '\\approx' },
        { label: '≈', code: '\\approx' },
        { label: '≪', code: '\\ll' },
        { label: '≫', code: '\\gg' },
        { label: '≦', code: '\\leq' },
        { label: '≧', code: '\\geq' },
        { label: 'Σ', code: '\\sum' },
        { label: '∫', code: '\\int' },
    ],
    '矢印': [
        { label: '→', code: '\\rightarrow' },
        { label: '←', code: '\\leftarrow' },
        { label: '⇒', code: '\\Rightarrow' },
    ],
    'ギリシャ文字': [
        { label: 'α', code: '\\alpha' },
        { label: 'β', code: '\\beta' },
        { label: 'γ', code: '\\gamma' },
        { label: 'θ', code: '\\theta' },
        { label: 'λ', code: '\\lambda' },
        { label: 'π', code: '\\pi' },
        { label: 'μ', code: '\\mu' },
        { label: 'Ω', code: '\\Omega' },
    ]
};

const SHORTCUTS_DATA = [
    { name: '太字 (Bold)', mac: 'Cmd + B', win: 'Ctrl + B', md: '**テキスト**' },
    { name: '斜体 (Italic)', mac: 'Cmd + I', win: 'Ctrl + I', md: '*テキスト*' },
    { name: '下線 (Underline)', mac: 'Cmd + U', win: 'Ctrl + U', md: '' },
    { name: '打ち消し線 (Strike)', mac: 'Cmd + Shift + X', win: 'Ctrl + Shift + X', md: '~~テキスト~~' },
    { name: 'ハイライト (蛍光ペン)', mac: 'Cmd + Shift + H', win: 'Ctrl + Shift + H', md: '==テキスト==' },
    { name: '上付き文字 (Superscript)', mac: 'Cmd + .', win: 'Ctrl + .', md: '<sup>テキスト</sup>' },
    { name: '下付き文字 (Subscript)', mac: 'Cmd + ,', win: 'Ctrl + ,', md: '<sub>テキスト</sub>' },
    { name: '標準テキスト', mac: 'Cmd + Alt + 0', win: 'Ctrl + Alt + 0', md: '' },
    { name: '見出し 1', mac: 'Cmd + Alt + 1', win: 'Ctrl + Alt + 1', md: '# ' },
    { name: '見出し 2', mac: 'Cmd + Alt + 2', win: 'Ctrl + Alt + 2', md: '## ' },
    { name: '見出し 3', mac: 'Cmd + Alt + 3', win: 'Ctrl + Alt + 3', md: '### ' },
    { name: '箇条書きリスト', mac: 'Cmd + Shift + 8', win: 'Ctrl + Shift + 8', md: '* または -' },
    { name: '番号付きリスト', mac: 'Cmd + Shift + 7', win: 'Ctrl + Shift + 7', md: '1. ' },
    { name: '水平線 (境界線)', mac: '', win: '', md: '--- (改行)' },
    { name: 'インデントを増やす', mac: 'Tab', win: 'Tab', md: '' },
    { name: 'インデントを減らす', mac: 'Shift + Tab', win: 'Shift + Tab', md: '' },
];

const MenuBar = ({ editor }) => {
    // ... (state hooks) ...
    const [modalType, setModalType] = useState(null);
    const [inputValue, setInputValue] = useState("");
    const [searchResults, setSearchResults] = useState([]);
    const [isSearching, setIsSearching] = useState(false);

    const [filterYear, setFilterYear] = useState('all');
    const [sortOrder, setSortOrder] = useState('relevance');
    const [expandedIds, setExpandedIds] = useState(new Set()); // Track expanding items

    const fileInputRef = useRef(null);
    const [isUploading, setIsUploading] = useState(false);
    const [editingMathPos, setEditingMathPos] = useState(null); // Track math node being edited

    useEffect(() => {
        if (!editor || !editor.view || !editor.view.dom) return;

        const handleMathEdit = (e) => {
            const { pos, latex } = e.detail;
            setEditingMathPos(pos);
            setInputValue(latex);
            setModalType('math');
        };

        editor.view.dom.addEventListener('math-edit', handleMathEdit);
        return () => {
            editor.view.dom.removeEventListener('math-edit', handleMathEdit);
        };
    }, [editor]);

    if (!editor) { return null; }

    const openModal = (type) => {
        setModalType(type);
        setInputValue("");
        setSearchResults([]); // Reset search
        setFilterYear('all');
        setSortOrder('relevance');
        setExpandedIds(new Set());
        setEditingMathPos(null); // Reset edit state when opening normally
    };

    const toggleExpand = (id) => {
        setExpandedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            // If single expand only: 
            // const next = new Set();
            // if (!prev.has(id)) next.add(id);
            return next;
        });
    };

    const closeModal = () => {
        setModalType(null);
        setInputValue("");
        setIsUploading(false);
        setSearchResults([]);
        setEditingMathPos(null);
    };

    const handleSearch = async () => {
        if (!inputValue || inputValue.length < 2) return;
        setIsSearching(true);
        try {
            // Search explanation only
            const keys = ['explanation'];
            const results = await searchQuestions(inputValue, null, keys);
            setSearchResults(results.slice(0, 20)); // Limit 20
        } catch (e) {
            console.error(e);
        } finally {
            setIsSearching(false);
        }
    };

    const handleImportSelection = (item) => {
        if (item.explanation) {
            // Insert explanation at cursor
            editor.chain().focus().insertContent(item.explanation).run();
        }
        closeModal();
    };

    const handleInsert = () => {
        if (!inputValue && modalType !== 'import') { closeModal(); return; }

        if (modalType === 'image') { editor.chain().focus().setImage({ src: inputValue }).run(); }
        else if (modalType === 'math') {
            if (editingMathPos !== null) {
                // Update existing math node
                editor.chain().focus().command(({ tr }) => {
                    tr.setNodeMarkup(editingMathPos, undefined, { latex: inputValue });
                    return true;
                }).run();
            } else {
                // Insert new
                editor.chain().focus().insertMath(inputValue).run();
            }
        }
        // Import is handled by selection usually, but if enter is pressed with search box, we might default to search
        if (modalType === 'import') {
            handleSearch();
            return;
        }
        closeModal();
    };

    const handleCheatSheetClick = (code) => {
        setInputValue(prev => prev + code);
    };

    const handleFileUpload = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (readerEvent) => {
            const dataUrl = readerEvent.target?.result;
            if (dataUrl && typeof dataUrl === 'string') {
                editor.chain().focus().setImage({ src: dataUrl }).run();
                closeModal();
            }
        };
        reader.readAsDataURL(file);
    };

    // Helper functions (Indent/Outdent)
    const handleIndent = () => { if (editor.isActive('bulletList') || editor.isActive('orderedList')) { editor.chain().focus().sinkListItem('listItem').run(); } else { editor.chain().focus().indent().run(); } };
    const handleOutdent = () => { if (editor.isActive('bulletList') || editor.isActive('orderedList')) { editor.chain().focus().liftListItem('listItem').run(); } else { editor.chain().focus().outdent().run(); } };

    return (
        <div className={styles.menubar}>
            {/* ... Existing Groups ... */}
            <div className={styles.group}>
                <button type="button" onClick={() => editor.chain().focus().toggleBold().run()} className={editor.isActive('bold') ? styles.active : ''} title="太字 (Bold)"><Icons.Bold /></button>
                <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()} className={editor.isActive('italic') ? styles.active : ''} title="斜体 (Italic)"><Icons.Italic /></button>
                <button type="button" onClick={() => editor.chain().focus().toggleUnderline().run()} className={editor.isActive('underline') ? styles.active : ''} title="下線 (Underline)"><Icons.Underline /></button>
                <button type="button" onClick={() => editor.chain().focus().toggleHighlight().run()} className={editor.isActive('highlight') ? styles.active : ''} title="ハイライト (蛍光ペン)"><Icons.Highlight /></button>
                <button type="button" onClick={() => editor.chain().focus().toggleSuperscript().run()} className={editor.isActive('superscript') ? styles.active : ''} title="上付き文字 (Sup)"><span>X<sup>2</sup></span></button>
                <button type="button" onClick={() => editor.chain().focus().toggleSubscript().run()} className={editor.isActive('subscript') ? styles.active : ''} title="下付き文字 (Sub)"><span>X<sub>2</sub></span></button>
            </div>

            <div className={styles.group}>
                <button type="button" onClick={() => editor.chain().focus().setTextAlign('left').run()} className={editor.isActive({ textAlign: 'left' }) ? styles.active : ''} title="左揃え"><Icons.Left /></button>
                <button type="button" onClick={() => editor.chain().focus().setTextAlign('center').run()} className={editor.isActive({ textAlign: 'center' }) ? styles.active : ''} title="中央揃え"><Icons.Center /></button>
                <button type="button" onClick={() => editor.chain().focus().setTextAlign('right').run()} className={editor.isActive({ textAlign: 'right' }) ? styles.active : ''} title="右揃え"><Icons.Right /></button>
            </div>

            <div className={styles.group}>
                <button type="button" onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} className={editor.isActive('heading', { level: 1 }) ? styles.active : ''} title="見出し1 (大)">H1</button>
                <button type="button" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} className={editor.isActive('heading', { level: 2 }) ? styles.active : ''} title="見出し2 (中)">H2</button>
                <button type="button" onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} className={editor.isActive('heading', { level: 3 }) ? styles.active : ''} title="見出し3 (小)">H3</button>
            </div>

            <div className={styles.group}>
                <button type="button" onClick={() => editor.chain().focus().toggleBulletList().run()} className={editor.isActive('bulletList') ? styles.active : ''} title="箇条書き"><Icons.Bullet /></button>
                <button type="button" onClick={() => editor.chain().focus().toggleOrderedList().run()} className={editor.isActive('orderedList') ? styles.active : ''} title="番号付きリスト"><Icons.Ordered /></button>
                <button type="button" onClick={handleIndent} title="インデントを増やす"><Icons.Indent /></button>
                <button type="button" onClick={handleOutdent} title="インデントを減らす"><Icons.Outdent /></button>
            </div>

            <div className={styles.group}>
                <button type="button" onClick={() => openModal('math')} title="数式を挿入 (LaTeX)"><Icons.Math /></button>
                <button type="button" onClick={() => openModal('import')} title="他の解説を引用 (Import)"><Icons.Book /></button>
                <button type="button" onClick={() => openModal('image')} title="画像を追加 (アップロード/URL)"><Icons.Image /></button>
                <button type="button" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} title="表を挿入 (3x3)"><Icons.Table /></button>
                <button type="button" onClick={() => openModal('shortcuts')} title="キーボードショートカット一覧"><Icons.Help /></button>
            </div>

            {editor.isActive('table') && (
                <div className={styles.tableControls}>
                    <button type="button" onClick={() => editor.chain().focus().addColumnBefore().run()} title="左に列を挿入"><Icons.ColBefore /></button>
                    <button type="button" onClick={() => editor.chain().focus().addColumnAfter().run()} title="右に列を挿入"><Icons.ColAfter /></button>
                    <button type="button" onClick={() => editor.chain().focus().deleteColumn().run()} title="列を削除" className={styles.deleteAction}><Icons.DeleteCol /></button>
                    <div className={styles.divider} />
                    <button type="button" onClick={() => editor.chain().focus().addRowBefore().run()} title="上に行を挿入"><Icons.RowBefore /></button>
                    <button type="button" onClick={() => editor.chain().focus().addRowAfter().run()} title="下に行を挿入"><Icons.RowAfter /></button>
                    <button type="button" onClick={() => editor.chain().focus().deleteRow().run()} title="行を削除" className={styles.deleteAction}><Icons.DeleteRow /></button>
                    <div className={styles.divider} />
                    <button type="button" onClick={() => editor.chain().focus().mergeCells().run()} title="セルを結合"><Icons.Merge /></button>
                    <button type="button" onClick={() => editor.chain().focus().splitCell().run()} title="セルを分割"><Icons.Split /></button>
                    <button type="button" onClick={() => editor.chain().focus().deleteTable().run()} title="表全体を削除" className={styles.deleteAction}><Icons.Trash /></button>
                </div>
            )}

            {/* Simple Modal Overlay */}
            {modalType && (
                <div className={styles.modalOverlay}>
                    <div className={styles.modalContent}>
                        <h4>
                            {modalType === 'math' ? '数式を入力 (LaTeX)' :
                                modalType === 'import' ? '解説を検索・引用' :
                                modalType === 'shortcuts' ? 'キーボードショートカット一覧' :
                                    '画像のURLを入力'}
                        </h4>

                        {modalType === 'image' && (
                            <div style={{ marginBottom: '1rem' }}>
                                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                                    ローカル画像を挿入:
                                </label>
                                <input
                                    type="file"
                                    accept="image/*"
                                    onChange={handleFileUpload}
                                    style={{ fontSize: '0.9rem' }}
                                />
                            </div>
                        )}

                        {modalType !== 'shortcuts' && (
                            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                <input
                                    type="text"
                                    value={inputValue}
                                    onChange={(e) => setInputValue(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            if (modalType === 'import') handleSearch();
                                            else handleInsert();
                                        }
                                    }}
                                    placeholder={
                                        modalType === 'math' ? "例: E = mc^2" :
                                            modalType === 'import' ? "キーワード (2文字以上)" :
                                                "またはURLを直接入力"
                                    }
                                    autoFocus
                                    style={{ flex: 1 }}
                                />
                                {modalType === 'import' && (
                                    <button onClick={handleSearch} className={styles.cheatBtn} style={{ alignSelf: 'center' }}>検索</button>
                                )}
                            </div>
                        )}

                        {/* Keyboard Shortcuts list */}
                        {modalType === 'shortcuts' && (
                            <div className={styles.shortcutContainer}>
                                <table className={styles.shortcutTable}>
                                    <thead>
                                        <tr>
                                            <th>書式機能</th>
                                            <th>macOS</th>
                                            <th>Windows / Linux</th>
                                            <th>マークダウン風入力</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {SHORTCUTS_DATA.map(shortcut => (
                                            <tr key={shortcut.name}>
                                                <td><strong>{shortcut.name}</strong></td>
                                                <td>{shortcut.mac ? <code>{shortcut.mac}</code> : ''}</td>
                                                <td>{shortcut.win ? <code>{shortcut.win}</code> : ''}</td>
                                                <td>{shortcut.md ? <code>{shortcut.md}</code> : ''}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {/* Search Results */}
                        {modalType === 'import' && (
                            <div className={styles.searchResults}>
                                {isSearching && <div style={{ padding: '0.5rem', fontSize: '0.9rem' }}>検索中...</div>}

                                {!isSearching && searchResults.length > 0 && (
                                    <div className={styles.modalControls}>
                                        <select
                                            value={sortOrder}
                                            onChange={(e) => setSortOrder(e.target.value)}
                                            className={styles.modalSelect}
                                        >
                                            <option value="relevance">関連度順</option>
                                            <option value="newest">新しい順</option>
                                            <option value="id">ID順</option>
                                        </select>
                                        <select
                                            value={filterYear}
                                            onChange={(e) => setFilterYear(e.target.value)}
                                            className={styles.modalSelect}
                                        >
                                            <option value="all">全年度</option>
                                            {[...new Set(searchResults.map(q => q.year))].sort((a, b) => b - a).map(year => (
                                                <option key={year} value={year}>{year}年</option>
                                            ))}
                                        </select>
                                    </div>
                                )}

                                {!isSearching && searchResults.length === 0 && inputValue.length > 1 && (
                                    <div style={{ padding: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>結果なし</div>
                                )}

                                {searchResults
                                    .filter(q => filterYear === 'all' || q.year.toString() === filterYear)
                                    .sort((a, b) => {
                                        if (sortOrder === 'newest') return b.year - a.year || (parseInt(a.questionNumber || 0) - parseInt(b.questionNumber || 0));
                                        if (sortOrder === 'id') return String(a.id || '').localeCompare(String(b.id || ''), undefined, { numeric: true });
                                        return 0; // relevance
                                    })
                                    .map(res => {
                                        const isExpanded = expandedIds.has(res.id);
                                        return (
                                            <div key={res.id || Math.random()} className={styles.searchResultItem}>
                                                <div className={styles.resultHeader} onClick={() => toggleExpand(res.id)}>
                                                    <div className={styles.headerContent}>
                                                        <div className={styles.resultMeta}>{res.year} - {res.genre || 'その他'} (ID: {res.id})</div>
                                                        {isExpanded ? (
                                                            <div className={styles.expandedQuestion} dangerouslySetInnerHTML={{ __html: res.question }} onClick={(e) => e.stopPropagation() || toggleExpand(res.id)} />
                                                        ) : (
                                                            <div className={styles.previewText} title={res.question}>
                                                                {res.question.replace(/<[^>]+>/g, '').substring(0, 60)}...
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className={`${styles.expandIcon} ${isExpanded ? styles.expanded : ''}`}>
                                                        <Icons.DownChevron />
                                                    </div>
                                                </div>

                                                {/* Expanded Detail */}
                                                {isExpanded && (
                                                    <div className={styles.fullDetail}>
                                                        {/* Question displayed in header */}
                                                        {/* Options hidden as per user request */}

                                                        {res.explanation && (
                                                            <div className={styles.detailSection}>
                                                                <span className={styles.detailLabel}>解説:</span>
                                                                <div className={styles.detailContent} dangerouslySetInnerHTML={{ __html: res.explanation }} />
                                                            </div>
                                                        )}

                                                        <button className={styles.importActionBtn} onClick={() => handleImportSelection(res)}>
                                                            引用
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                            </div>
                        )}

                        {/* LaTeX Cheat Sheet */}
                        {modalType === 'math' && (
                            <div className={styles.cheatSheet}>
                                <div style={{ fontSize: '0.8rem', marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>よく使う記号 (クリックで挿入):</div>
                                {Object.entries(LATEX_CHEAT_SHEET).map(([category, items]) => (
                                    <div key={category} className={styles.cheatSheetGroup}>
                                        <span className={styles.cheatCategory}>{category}:</span>
                                        <div className={styles.cheatItems}>
                                            {items.map(item => (
                                                <button
                                                    key={item.label}
                                                    className={styles.cheatBtn}
                                                    onClick={() => handleCheatSheetClick(item.code)}
                                                    title={item.code}
                                                >
                                                    {item.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className={styles.modalActions}>
                            <button onClick={closeModal} className={styles.cancelBtn}>{modalType === 'shortcuts' ? '閉じる' : 'キャンセル'}</button>
                            {modalType !== 'import' && modalType !== 'shortcuts' && (
                                <button onClick={handleInsert} className={styles.insertBtn}>挿入</button>
                            )}
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
        TextAlign.configure({
            types: ['heading', 'paragraph', 'tableCell', 'tableHeader'],
        }),
        Placeholder.configure({
            placeholder: '解説を入力...',
        }),
    ];



    // Safely add Table extensions
    if (CustomTable && CustomTable.configure) {
        // Force the configuration explicitly
        const configuredTable = CustomTable.configure({
            resizable: true,
            renderWrapper: true,
            allowTableNodeSelection: true
        });
        console.log("Configuring CustomTable with:", configuredTable.options); // DEBUG

        extensionConfig.push(
            configuredTable,
            TableRow,
            CustomTableHeader,
            CustomTableCell
        );
    }

    // Add custom HTML parsing extension
    extensionConfig.push(HtmlTagExtension);

    const editor = useEditor({
        extensions: extensionConfig,
        content: content || '',
        immediatelyRender: false,
        onUpdate: ({ editor }) => {
            onChange(editor.getHTML());
        },
        editorProps: {
            handlePaste: (view, event) => {
                const items = event.clipboardData?.items;
                if (!items) return false;

                let handled = false;
                for (const item of items) {
                    if (item.type.indexOf("image") === 0) {
                        const file = item.getAsFile();
                        if (file) {
                            const reader = new FileReader();
                            reader.onload = (readerEvent) => {
                                const dataUrl = readerEvent.target?.result;
                                if (dataUrl && typeof dataUrl === 'string') {
                                    const { schema } = view.state;
                                    const node = schema.nodes.image.create({ src: dataUrl });
                                    const transaction = view.state.tr.replaceSelectionWith(node);
                                    view.dispatch(transaction);
                                }
                            };
                            reader.readAsDataURL(file);
                            handled = true;
                        }
                    }
                }
                return handled;
            },
            handleDrop: (view, event) => {
                const files = event.dataTransfer?.files;
                if (!files) return false;

                let handled = false;
                for (const file of files) {
                    if (file.type.indexOf("image") === 0) {
                        event.preventDefault();
                        const reader = new FileReader();
                        reader.onload = (readerEvent) => {
                            const dataUrl = readerEvent.target?.result;
                            if (dataUrl && typeof dataUrl === 'string') {
                                const { schema } = view.state;
                                const node = schema.nodes.image.create({ src: dataUrl });
                                const transaction = view.state.tr.replaceSelectionWith(node);
                                view.dispatch(transaction);
                            }
                        };
                        reader.readAsDataURL(file);
                        handled = true;
                    }
                }
                return handled;
            }
        }
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
