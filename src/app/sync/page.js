"use client";

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isMobileTarget } from '@/lib/appTarget';
import {
    connectGoogleDriveSync,
    disconnectGoogleDriveSync,
    getGoogleDriveSyncState,
    runGoogleDriveSync,
} from '@/lib/sync/googleDriveBrowserSync';
import styles from './sync.module.scss';

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';

const formatDateTime = value => {
    if (!value) return '未実行';
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? '未実行'
        : new Intl.DateTimeFormat('ja-JP', {
            dateStyle: 'medium',
            timeStyle: 'short',
        }).format(date);
};

const describeSyncResult = result => {
    if (!result || result.status !== 'completed') return '同期状態を更新しました。';
    return [
        `受信 ${result.appliedChanges || 0}件`,
        `送信 ${result.pushedChanges || 0}件`,
        `競合 ${result.conflicts || 0}件`,
    ].join('・');
};

export default function CloudSyncPage() {
    const router = useRouter();
    const [syncState, setSyncState] = useState(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    const refreshState = useCallback(async () => {
        setSyncState(await getGoogleDriveSyncState());
    }, []);

    useEffect(() => {
        refreshState().catch(loadError => {
            setError(loadError.message || '同期状態を読み出せませんでした。');
        });
    }, [refreshState]);

    const runAction = async action => {
        setBusy(true);
        setMessage('');
        setError('');
        try {
            const actionResult = await action();
            await refreshState();
            return actionResult;
        } catch (actionError) {
            console.error('Cloud sync action failed:', actionError);
            setError(actionError.message || 'クラウド同期に失敗しました。');
            await refreshState().catch(() => {});
            return null;
        } finally {
            setBusy(false);
        }
    };

    const handleConnect = async () => {
        const response = await runAction(() => connectGoogleDriveSync({
            clientId: GOOGLE_CLIENT_ID,
        }));
        if (response) {
            setMessage(`Google Driveへ接続しました。${describeSyncResult(response.result)}`);
        }
    };

    const handleSync = async () => {
        const response = await runAction(() => runGoogleDriveSync({
            clientId: GOOGLE_CLIENT_ID,
        }));
        if (response) setMessage(describeSyncResult(response.result));
    };

    const handleDisconnect = async () => {
        const pendingCount = syncState?.pendingCount || 0;
        const discardPending = pendingCount > 0;
        if (discardPending && !window.confirm(
            `未同期の変更が${pendingCount}件あります。接続情報を解除しますか？\n`
            + '端末内の試験データは消えません。再接続時に全データを登録し直します。'
        )) {
            return;
        }
        const response = await runAction(() => disconnectGoogleDriveSync({
            discardPending,
        }));
        if (response) setMessage('Google Driveとの接続を解除しました。端末内のデータはそのままです。');
    };

    const connected = Boolean(syncState?.connected);
    const mobileUnavailable = !isMobileTarget;
    const configurationMissing = !GOOGLE_CLIENT_ID;
    const unavailable = mobileUnavailable || configurationMissing;

    return (
        <main className={styles.container}>
            <header className={styles.header}>
                <button type="button" onClick={() => router.push('/')} className={styles.backButton}>← 戻る</button>
                <div>
                    <span className={styles.eyebrow}>CLOUD SYNC</span>
                    <h1>クラウド同期</h1>
                    <p>端末内のデータを本体として保ち、Google Driveのアプリ専用領域を介して差分を同期します。</p>
                </div>
            </header>

            <section className={styles.localFirst}>
                <strong>オフラインでも利用できます</strong>
                <p>同期できない間も問題演習や編集は端末内へ保存され、次回の同期時に送信されます。</p>
            </section>

            <section className={styles.card}>
                <div className={styles.providerHeader}>
                    <div className={styles.driveMark} aria-hidden="true">G</div>
                    <div>
                        <h2>Google Drive</h2>
                        <p>{connected ? '接続済み' : '未接続'}</p>
                    </div>
                    <span className={`${styles.statusBadge} ${connected ? styles.connected : ''}`}>
                        {connected ? '同期利用中' : '未接続'}
                    </span>
                </div>

                {mobileUnavailable && (
                    <p className={styles.notice}>
                        Mac/PC版のGoogle認証は準備中です。現在はモバイル／Web版から接続できます。
                    </p>
                )}
                {!mobileUnavailable && configurationMissing && (
                    <p className={styles.notice}>
                        このビルドにはGoogle OAuthクライアントIDが設定されていません。
                    </p>
                )}

                {connected && (
                    <>
                        {!syncState.hasSessionToken && !mobileUnavailable && (
                            <p className={styles.reauthNotice}>
                                安全のため認証情報は保存していません。同期するときにGoogleアカウントを再認証してください。
                            </p>
                        )}
                        <dl className={styles.details}>
                            <div><dt>アカウント</dt><dd>{syncState.config.accountLabel || 'Google Drive'}</dd></div>
                            <div><dt>最終同期</dt><dd>{formatDateTime(syncState.config.lastSyncAt)}</dd></div>
                            <div><dt>未送信</dt><dd>{syncState.pendingCount}件</dd></div>
                            <div><dt>競合</dt><dd>{syncState.conflictCount}件</dd></div>
                        </dl>
                    </>
                )}

                <div className={styles.actions}>
                    {!connected ? (
                        <button
                            type="button"
                            className={styles.primaryButton}
                            onClick={handleConnect}
                            disabled={busy || unavailable}
                        >
                            {busy ? '接続中…' : 'Google Driveへ接続'}
                        </button>
                    ) : (
                        <>
                            <button
                                type="button"
                                className={styles.primaryButton}
                                onClick={handleSync}
                                disabled={busy || unavailable}
                            >
                                {busy
                                    ? '同期中…'
                                    : syncState.hasSessionToken
                                        ? '今すぐ同期'
                                        : '再認証して同期'}
                            </button>
                            <button
                                type="button"
                                className={styles.secondaryButton}
                                onClick={handleDisconnect}
                                disabled={busy}
                            >
                                接続を解除
                            </button>
                        </>
                    )}
                </div>
            </section>

            {message && <p className={styles.success} role="status">{message}</p>}
            {error && <p className={styles.error} role="alert">{error}</p>}

            <aside className={styles.note}>
                <strong>手動バックアップも引き続き利用できます</strong>
                <p>従来の.radexamファイルは、緊急復旧やクラウドを使わないデータ移動用として維持されます。</p>
            </aside>
        </main>
    );
}
