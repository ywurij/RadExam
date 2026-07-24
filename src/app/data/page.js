"use client";

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getAllLocalExams, exportAllLocalData, importLocalData } from '@/lib/localDb';
import { createBackupArchiveBlob, readBackupFile } from '@/lib/backupArchive.mjs';
import { initializeLocalExams } from '@/lib/data';
import styles from './data.module.scss';

const getBackupSummary = (backup) => {
    if (!backup || typeof backup !== 'object' || !backup.exams || typeof backup.exams !== 'object') {
        throw new Error('RadExamのバックアップファイルではありません。');
    }

    const exams = Object.values(backup.exams);
    const questionCount = exams.reduce((total, exam) => total + (Array.isArray(exam?.questions) ? exam.questions.length : 0), 0);
    if (exams.length === 0 || questionCount === 0) {
        throw new Error('試験問題が含まれていません。');
    }

    return { examCount: exams.length, questionCount };
};

export default function DataTransferPage() {
    const router = useRouter();
    const inputRef = useRef(null);
    const [exams, setExams] = useState([]);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    const refresh = async () => setExams(await getAllLocalExams());

    useEffect(() => {
        refresh();
    }, []);

    const handleImport = async (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;

        setBusy(true);
        setMessage('');
        setError('');
        try {
            const backup = await readBackupFile(file);
            const summary = getBackupSummary(backup);
            const shouldImport = window.confirm(
                `${summary.examCount}件の試験（全${summary.questionCount}問）を登録します。\n現在の試験データと学習履歴は置き換えられます。続行しますか？`
            );
            if (!shouldImport) return;

            await importLocalData(backup, 'overwrite');
            localStorage.removeItem('radexam_sessions');
            localStorage.removeItem('radexam_last_settings');
            await initializeLocalExams(true);
            await refresh();
            setMessage(`${summary.examCount}件の試験、全${summary.questionCount}問を登録しました。`);
        } catch (importError) {
            console.error('Failed to import mobile backup:', importError);
            setError(importError instanceof SyntaxError
                ? 'バックアップファイルを読み取れませんでした。'
                : importError.message || 'データの登録に失敗しました。');
        } finally {
            setBusy(false);
        }
    };

    const handleExport = async () => {
        setBusy(true);
        setMessage('');
        setError('');
        try {
            const backup = await exportAllLocalData();
            const summary = getBackupSummary(backup);
            const blob = await createBackupArchiveBlob(backup);
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            const date = new Date().toISOString().slice(0, 10);
            link.href = url;
            link.download = `radexam-mobile-${date}.radexam`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
            setMessage(`${summary.examCount}件の試験と学習履歴を書き出しました。`);
        } catch (exportError) {
            console.error('Failed to export mobile backup:', exportError);
            setError(exportError.message || 'データの書き出しに失敗しました。');
        } finally {
            setBusy(false);
        }
    };

    const questionCount = exams.reduce((total, exam) => total + exam.count, 0);

    return (
        <main className={styles.container}>
            <header className={styles.header}>
                <button type="button" onClick={() => router.push('/')} className={styles.backButton}>← 戻る</button>
                <div>
                    <span className={styles.eyebrow}>MOBILE DATA</span>
                    <h1>試験データ転送</h1>
                    <p>Mac/PC版で書き出したRadExamバックアップ（.radexam）を、この端末へ手動登録します。</p>
                </div>
            </header>

            <section className={styles.summary} aria-label="登録済みデータ">
                <div><strong>{exams.length}</strong><span>試験</span></div>
                <div><strong>{questionCount}</strong><span>問題</span></div>
                <div><strong>端末内</strong><span>保存先</span></div>
            </section>

            <section className={styles.card}>
                <div className={styles.step}>1</div>
                <div className={styles.cardBody}>
                    <h2>この端末へ登録</h2>
                    <p>バックアップ内の試験、画像、学習履歴、問題に紐づく参照PDFを登録します。</p>
                    <input ref={inputRef} type="file" accept=".radexam,.json,application/json,application/x-radexam-backup" onChange={handleImport} hidden />
                    <button type="button" className={styles.primaryButton} onClick={() => inputRef.current?.click()} disabled={busy}>
                        {busy ? '処理中…' : 'バックアップファイルを選択'}
                    </button>
                </div>
            </section>

            <section className={styles.card}>
                <div className={styles.step}>2</div>
                <div className={styles.cardBody}>
                    <h2>編集・学習結果を持ち出す</h2>
                    <p>この端末で編集した解説・ジャンルと、正誤・お気に入りをRadExamバックアップ（.radexam）に保存します。</p>
                    <button type="button" className={styles.secondaryButton} onClick={handleExport} disabled={busy || exams.length === 0}>
                        モバイルデータを書き出す
                    </button>
                </div>
            </section>

            {message && <p className={styles.success} role="status">{message}</p>}
            {error && <p className={styles.error} role="alert">{error}</p>}

            <aside className={styles.note}>
                <strong>端末変更・アプリ削除の前に</strong>
                <p>データはこのブラウザ内だけに保存されます。定期的に書き出して保管してください。</p>
            </aside>
        </main>
    );
}
