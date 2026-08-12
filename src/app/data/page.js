"use client";

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
    clearAllLocalAppData,
    getAllLocalExams,
    exportAllLocalData,
    importLocalData,
} from '@/lib/localDb';
import {
    createBackupArchiveBlob,
    createEncryptedBackupArchiveBlob,
    readBackupFile,
} from '@/lib/backupArchive.mjs';
import { initializeLocalExams } from '@/lib/data';
import CloudSyncPage from '@/app/sync/page';
import ThemeController from '@/components/ThemeController';
import styles from './data.module.scss';

const getBackupSummary = (backup) => {
    if (!backup || typeof backup !== 'object' || !backup.exams || typeof backup.exams !== 'object') {
        throw new Error('RadExamのバックアップファイルではありません。');
    }

    const exams = Object.values(backup.exams);
    const questionCount = exams.reduce((total, exam) => total + (Array.isArray(exam?.questions) ? exam.questions.length : 0), 0);
    const sessionCount = Array.isArray(backup.sessions) ? backup.sessions.length : 0;
    if (exams.length === 0 || questionCount === 0) {
        throw new Error('試験問題が含まれていません。');
    }

    return { examCount: exams.length, questionCount, sessionCount };
};

export default function DataTransferPage() {
    const router = useRouter();
    const inputRef = useRef(null);
    const [exams, setExams] = useState([]);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [encryptBackup, setEncryptBackup] = useState(true);
    const [exportPassphrase, setExportPassphrase] = useState('');
    const [exportPassphraseConfirm, setExportPassphraseConfirm] = useState('');
    const [importPassphrase, setImportPassphrase] = useState('');

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
            const backup = await readBackupFile(file, { passphrase: importPassphrase });
            const summary = getBackupSummary(backup);
            const shouldImport = window.confirm(
                `${summary.examCount}件の試験（全${summary.questionCount}問）と`
                + `中断履歴${summary.sessionCount}件を登録します。\n`
                + '現在の試験データ、学習履歴、中断履歴は置き換えられます。続行しますか？'
            );
            if (!shouldImport) return;

            await importLocalData(backup, 'overwrite');
            localStorage.removeItem('radexam_last_settings');
            await initializeLocalExams(true);
            await refresh();
            setMessage(
                `${summary.examCount}件の試験、全${summary.questionCount}問、`
                + `中断履歴${summary.sessionCount}件を登録しました。`
            );
            setImportPassphrase('');
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
            if (encryptBackup) {
                if (exportPassphrase !== exportPassphraseConfirm) {
                    throw new Error('バックアップパスワードが一致しません。');
                }
                if (exportPassphrase.normalize('NFKC').length < 12) {
                    throw new Error('バックアップパスワードは12文字以上で入力してください。');
                }
            }
            const blob = encryptBackup
                ? await createEncryptedBackupArchiveBlob(backup, exportPassphrase)
                : await createBackupArchiveBlob(backup);
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            const date = new Date().toISOString().slice(0, 10);
            link.href = url;
            link.download = `radexam-mobile-${date}.radexam`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
            setMessage(
                `${encryptBackup ? 'パスワード付きで' : ''}${summary.examCount}件の試験、学習履歴、中断履歴`
                + `${summary.sessionCount}件を書き出しました。`
            );
            setExportPassphrase('');
            setExportPassphraseConfirm('');
        } catch (exportError) {
            console.error('Failed to export mobile backup:', exportError);
            setError(exportError.message || 'データの書き出しに失敗しました。');
        } finally {
            setBusy(false);
        }
    };

    const handleDeleteLocalData = async () => {
        const questionCount = exams.reduce((total, exam) => total + exam.count, 0);
        if (!window.confirm(
            `この端末内の試験${exams.length}件・問題${questionCount}問、学習履歴、画像、PDF、中断履歴をすべて削除します。\n\n`
            + 'クラウド上のデータは削除されませんが、クラウド同期の接続は解除されます。元に戻せません。続けますか？'
        )) {
            return;
        }
        setBusy(true);
        setMessage('');
        setError('');
        try {
            await clearAllLocalAppData();
            await initializeLocalExams(true);
            await refresh();
            setMessage('この端末内のデータをすべて削除しました。クラウド上のデータは残っています。');
        } catch (deleteError) {
            console.error('Failed to delete local mobile data:', deleteError);
            setError(deleteError.message || '端末内データの削除に失敗しました。');
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
                    <span className={styles.eyebrow}>DATA MANAGEMENT</span>
                    <h1>データ管理</h1>
                    <p>クラウドを使った端末間共有と、緊急復旧用のRadExamバックアップを管理します。</p>
                </div>
            </header>

            <section className={styles.summary} aria-label="登録済みデータ">
                <div><strong>{exams.length}</strong><span>試験</span></div>
                <div><strong>{questionCount}</strong><span>問題</span></div>
                <div><strong>端末内</strong><span>保存先</span></div>
            </section>

            <ThemeController />

            <CloudSyncPage embedded />

            <section className={styles.card}>
                <div className={styles.step}>1</div>
                <div className={styles.cardBody}>
                    <h2>バックアップから復元</h2>
                    <p>バックアップ内の試験、画像、学習履歴、問題に紐づく参照PDFを登録します。</p>
                    <label className={styles.fieldLabel}>
                        暗号化バックアップのパスワード
                        <input
                            type="password"
                            value={importPassphrase}
                            onChange={event => setImportPassphrase(event.target.value)}
                            autoComplete="current-password"
                            placeholder="暗号化されている場合のみ入力"
                            className={styles.passwordInput}
                            disabled={busy}
                        />
                    </label>
                    <input ref={inputRef} type="file" accept=".radexam,.json,application/json,application/x-radexam-backup,application/x-radexam-encrypted-backup" onChange={handleImport} hidden />
                    <button type="button" className={styles.primaryButton} onClick={() => inputRef.current?.click()} disabled={busy}>
                        {busy ? '処理中…' : 'バックアップファイルを選択'}
                    </button>
                </div>
            </section>

            <section className={styles.card}>
                <div className={styles.step}>2</div>
                <div className={styles.cardBody}>
                    <h2>緊急復旧用バックアップを保存</h2>
                    <p>この端末で編集した解説・ジャンルと、正誤・お気に入りをRadExamバックアップ（.radexam）に保存します。</p>
                    <label className={styles.checkboxLabel}>
                        <input
                            type="checkbox"
                            checked={encryptBackup}
                            onChange={event => setEncryptBackup(event.target.checked)}
                            disabled={busy}
                        />
                        パスワードで暗号化する（推奨）
                    </label>
                    {encryptBackup && (
                        <div className={styles.passwordGrid}>
                            <label className={styles.fieldLabel}>
                                バックアップパスワード
                                <input
                                    type="password"
                                    value={exportPassphrase}
                                    onChange={event => setExportPassphrase(event.target.value)}
                                    autoComplete="new-password"
                                    minLength={12}
                                    className={styles.passwordInput}
                                    disabled={busy}
                                />
                            </label>
                            <label className={styles.fieldLabel}>
                                パスワードの確認
                                <input
                                    type="password"
                                    value={exportPassphraseConfirm}
                                    onChange={event => setExportPassphraseConfirm(event.target.value)}
                                    autoComplete="new-password"
                                    minLength={12}
                                    className={styles.passwordInput}
                                    disabled={busy}
                                />
                            </label>
                        </div>
                    )}
                    {!encryptBackup && <p className={styles.warningText}>暗号化しないバックアップには、問題・履歴・画像・PDFがそのまま保存されます。</p>}
                    <button type="button" className={styles.secondaryButton} onClick={handleExport} disabled={busy || exams.length === 0}>
                        {encryptBackup ? 'パスワード付きで書き出す' : '暗号化せず書き出す'}
                    </button>
                </div>
            </section>

            <section className={`${styles.card} ${styles.dangerCard}`}>
                <div className={`${styles.step} ${styles.dangerStep}`}>3</div>
                <div className={styles.cardBody}>
                    <h2>この端末内のデータを削除</h2>
                    <p>
                        この端末に保存された試験、学習履歴、画像、PDF、中断履歴を削除します。
                        クラウド上のバックアップは削除されません。
                    </p>
                    <button
                        type="button"
                        className={styles.dangerButton}
                        onClick={handleDeleteLocalData}
                        disabled={busy}
                    >
                        端末内データをすべて削除
                    </button>
                </div>
            </section>

            {message && <p className={styles.success} role="status">{message}</p>}
            {error && <p className={styles.error} role="alert">{error}</p>}

            <aside className={styles.note}>
                <strong>端末変更・アプリ削除の前に</strong>
                <p>データはこのブラウザ内だけに保存されます。定期的にパスワード付きで書き出し、パスワードは別の安全な場所へ保管してください。</p>
            </aside>
        </main>
    );
}
