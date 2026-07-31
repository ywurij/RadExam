"use client";

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isMobileTarget } from '@/lib/appTarget';
import { createBackupArchiveBlob } from '@/lib/backupArchive.mjs';
import {
    clearLocalAppDataForDevelopment,
    exportAllLocalData,
} from '@/lib/localDb';
import { refreshLocalExamData } from '@/lib/data';
import {
    connectGoogleDriveSync,
    disconnectGoogleDriveSync,
    getGoogleDriveSyncState,
    resetGoogleDriveSync,
    resolveGoogleDriveSyncConflict,
    runGoogleDriveSync,
} from '@/lib/sync/googleDriveBrowserSync';
import {
    connectGoogleDriveDesktopSync,
    disconnectGoogleDriveDesktopSync,
    getGoogleDriveDesktopSyncState,
    resetGoogleDriveDesktopSync,
    resolveGoogleDriveDesktopSyncConflict,
    runGoogleDriveDesktopSync,
} from '@/lib/sync/googleDriveDesktopSync';
import {
    connectOneDriveSync,
    disconnectOneDriveSync,
    getOneDriveSyncState,
    resetOneDriveSync,
    resolveOneDriveSyncConflict,
    runOneDriveSync,
} from '@/lib/sync/oneDriveBrowserSync';
import {
    connectOneDriveDesktopSync,
    disconnectOneDriveDesktopSync,
    getOneDriveDesktopSyncState,
    resetOneDriveDesktopSync,
    resolveOneDriveDesktopSyncConflict,
    runOneDriveDesktopSync,
} from '@/lib/sync/oneDriveDesktopSync';
import { SYNC_PROVIDERS } from '@/lib/sync/syncProtocol.mjs';
import styles from './sync.module.scss';

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';
const GOOGLE_DESKTOP_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_DESKTOP_CLIENT_ID || '';
const MICROSOFT_CLIENT_ID = process.env.NEXT_PUBLIC_MICROSOFT_CLIENT_ID || '';
const MICROSOFT_DESKTOP_CLIENT_ID = process.env.NEXT_PUBLIC_MICROSOFT_DESKTOP_CLIENT_ID || '';
const IS_DEVELOPMENT = process.env.NODE_ENV === 'development';

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

const formatBytes = value => {
    const bytes = Math.max(0, Number(value) || 0);
    if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDuration = value => {
    const milliseconds = Number(value);
    if (!Number.isFinite(milliseconds) || milliseconds < 0) return '未計測';
    if (milliseconds < 1000) return `${milliseconds}ミリ秒`;
    return `${(milliseconds / 1000).toFixed(1)}秒`;
};

const describeDataStatus = state => {
    if (!state) return '確認中';
    if (state.dataStatus === 'verified') return '前回確認時点でクラウドと一致';
    if (state.dataStatus === 'local-changes') return `この端末に未送信が${state.pendingCount}件`;
    if (state.dataStatus === 'conflict') return `確認が必要な競合が${state.conflictCount}件`;
    if (state.dataStatus === 'error') return '前回の確認に失敗';
    return 'まだクラウドとの差を確認していません';
};

const describeProgress = progress => {
    if (!progress) return '';
    if (progress.phase === 'preparing-local-data') {
        return '接続は完了しています。端末内のデータを初回同期用に準備しています';
    }
    if (progress.phase === 'preparing-snapshot') {
        return `初回同期データを準備しています（${progress.totalChanges || 0}件）`;
    }
    if (progress.phase === 'uploading-snapshot') {
        return `初回同期データを送信中: ${formatBytes(progress.uploadedBytes)} / ${formatBytes(progress.totalBytes)}`;
    }
    if (progress.phase === 'uploading-changes') {
        return `変更された画像・PDFを送信中: ${formatBytes(progress.uploadedBytes)} / ${formatBytes(progress.totalBytes)}`;
    }
    if (progress.phase === 'uploading-files') {
        return `変更された画像・PDFを送信中: ${progress.uploadedFiles || 0} / ${progress.totalFiles || 0}件`;
    }
    if (progress.phase === 'committing-snapshot') return '初回同期データを確定しています';
    if (progress.phase === 'finalizing-local-changes') {
        return `送信済みデータを端末内で整理しています（${progress.totalChanges || 0}件）`;
    }
    if (progress.phase === 'downloading-snapshot') return '初回同期データを受信しています';
    if (progress.phase === 'restoring-snapshot') return '受信したデータを端末へ保存しています';
    if (progress.phase === 'applying-changes') {
        return `受信した変更を端末へ反映中: ${progress.processedChanges || 0} / ${progress.totalChanges || 0}件`;
    }
    if (progress.phase === 'preparing-checkpoint') {
        return `復旧用データを準備しています（前回から${progress.totalChanges || 0}件変更）`;
    }
    if (progress.phase === 'uploading-checkpoint') {
        return `復旧用データを送信中: ${formatBytes(progress.uploadedBytes)} / ${formatBytes(progress.totalBytes)}`;
    }
    if (progress.phase === 'deleting-cloud-data') {
        return `クラウドデータを削除中: ${progress.deletedFiles || 0} / ${progress.totalFiles || 0}件`;
    }
    return '';
};

const describeSyncResult = result => {
    if (!result || result.status !== 'completed') return '同期状態を更新しました。';
    const sentChanges = result.sentChanges
        ?? ((result.coveredChanges || 0) + (result.pushedChanges || 0));
    return [
        `受信 ${result.appliedChanges || 0}件`,
        `送信 ${sentChanges}件${result.createdSnapshot ? '（初回全体データ）' : ''}`,
        `競合 ${result.conflicts || 0}件`,
    ].join('・');
};

const ENTITY_LABELS = {
    exam: '試験',
    question: '問題',
    progress: '学習進捗',
    image: '画像',
    pdf: 'PDF',
    preference: '中断・再開履歴',
};
const FIELD_LABELS = {
    question: '問題文',
    answer: '正答',
    explanation: '解説',
    genre: 'ジャンル',
    status: '正誤',
    isLiked: 'お気に入り',
    currentIndex: '再開位置',
    '*': '削除と編集',
};
const readChangeField = (change, path) => (
    String(path).split('.').reduce((value, part) => value?.[part], change?.payload)
);
const formatConflictValue = value => {
    if (value === undefined) return '値を削除';
    if (value === null) return 'なし';
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return text.length > 240 ? `${text.slice(0, 240)}…` : text;
};
const describeConflictChange = change => {
    if (change?.operation === 'delete') return [{ field: 'データ全体', value: '削除' }];
    return (change?.changedFields || []).map(field => ({
        field: FIELD_LABELS[field] || field.replace(/^options\./, '選択肢 '),
        value: (change?.unsetFields || []).includes(field)
            ? '値を削除'
            : formatConflictValue(readChangeField(change, field)),
    }));
};

export default function CloudSyncPage() {
    const router = useRouter();
    const [selectedProvider, setSelectedProvider] = useState(SYNC_PROVIDERS.GOOGLE_DRIVE);
    const [syncState, setSyncState] = useState(null);
    const [busyPhase, setBusyPhase] = useState('');
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [progress, setProgress] = useState(null);
    const provider = syncState?.connected
        ? syncState.config.provider
        : selectedProvider;
    const isOneDrive = provider === SYNC_PROVIDERS.ONE_DRIVE;
    const providerName = isOneDrive ? 'OneDrive' : 'Google Drive';
    const clientId = isOneDrive
        ? (isMobileTarget ? MICROSOFT_CLIENT_ID : MICROSOFT_DESKTOP_CLIENT_ID)
        : (isMobileTarget ? GOOGLE_CLIENT_ID : GOOGLE_DESKTOP_CLIENT_ID);

    const refreshState = useCallback(async () => {
        const readState = async targetProvider => {
            const targetClientId = targetProvider === SYNC_PROVIDERS.ONE_DRIVE
                ? (isMobileTarget ? MICROSOFT_CLIENT_ID : MICROSOFT_DESKTOP_CLIENT_ID)
                : (isMobileTarget ? GOOGLE_CLIENT_ID : GOOGLE_DESKTOP_CLIENT_ID);
            if (targetProvider === SYNC_PROVIDERS.ONE_DRIVE) {
                return isMobileTarget
                    ? getOneDriveSyncState()
                    : getOneDriveDesktopSyncState({ clientId: targetClientId });
            }
            return isMobileTarget
                ? getGoogleDriveSyncState()
                : getGoogleDriveDesktopSyncState({ clientId: targetClientId });
        };
        let nextState = await readState(selectedProvider);
        if (
            nextState.config.enabled
            && nextState.config.provider
            && nextState.config.provider !== selectedProvider
        ) {
            setSelectedProvider(nextState.config.provider);
            nextState = await readState(nextState.config.provider);
        }
        setSyncState(nextState);
    }, [selectedProvider]);

    useEffect(() => {
        refreshState().catch(loadError => {
            setError(loadError.message || '同期状態を読み出せませんでした。');
        });
        window.addEventListener('radexam-cloud-sync-completed', refreshState);
        const handleProgress = event => setProgress(event.detail || null);
        window.addEventListener('radexam-cloud-sync-progress', handleProgress);
        return () => {
            window.removeEventListener('radexam-cloud-sync-completed', refreshState);
            window.removeEventListener('radexam-cloud-sync-progress', handleProgress);
        };
    }, [refreshState]);

    const runAction = async (
        action,
        phase = 'syncing',
        { refreshExams = false } = {}
    ) => {
        setBusyPhase(phase);
        setMessage('');
        setError('');
        setProgress(null);
        try {
            const actionResult = await action();
            if (refreshExams) await refreshLocalExamData();
            await refreshState();
            return actionResult;
        } catch (actionError) {
            console.error('Cloud sync action failed:', actionError);
            setError(actionError.message || 'クラウド同期に失敗しました。');
            await refreshState().catch(() => {});
            return null;
        } finally {
            setBusyPhase('');
            setProgress(null);
        }
    };

    const handleConnect = async () => {
        const response = await runAction(() => (
            isOneDrive
                ? isMobileTarget
                    ? connectOneDriveSync({ clientId })
                    : connectOneDriveDesktopSync({ clientId })
                : isMobileTarget
                    ? connectGoogleDriveSync({ clientId })
                    : connectGoogleDriveDesktopSync({ clientId })
        ), 'connecting');
        if (response) {
            setMessage(`${providerName}への接続が完了しました。初回同期を開始します。`);
            await new Promise(resolve => window.requestAnimationFrame(resolve));
            const syncResponse = await runAction(() => (
                isOneDrive
                    ? isMobileTarget
                        ? runOneDriveSync({ clientId })
                        : runOneDriveDesktopSync({ clientId })
                    : isMobileTarget
                        ? runGoogleDriveSync({ clientId })
                        : runGoogleDriveDesktopSync({ clientId })
            ), 'initial-sync', { refreshExams: true });
            if (syncResponse) {
                setMessage(`接続と初回同期が完了しました。${describeSyncResult(syncResponse.result)}`);
            }
        }
    };

    const handleSync = async () => {
        const response = await runAction(() => (
            isOneDrive
                ? isMobileTarget
                    ? runOneDriveSync({ clientId })
                    : runOneDriveDesktopSync({ clientId })
                : isMobileTarget
                    ? runGoogleDriveSync({ clientId })
                    : runGoogleDriveDesktopSync({ clientId })
        ), syncState?.initialSyncCompleted ? 'syncing' : 'initial-sync', {
            refreshExams: true,
        });
        if (response) setMessage(describeSyncResult(response.result));
    };

    const handleResolveConflict = async (conflict, resolution) => {
        const choiceLabel = resolution === 'keep-local'
            ? 'この端末の内容'
            : 'クラウドの内容';
        if (!window.confirm(
            `${choiceLabel}を採用します。\n`
            + '採用しなかった側の競合部分は元に戻せません。続けますか？'
        )) {
            return;
        }
        const response = await runAction(() => (
            isOneDrive
                ? isMobileTarget
                    ? resolveOneDriveSyncConflict({
                        clientId,
                        conflictId: conflict.conflictId,
                        resolution,
                    })
                    : resolveOneDriveDesktopSyncConflict({
                        clientId,
                        conflictId: conflict.conflictId,
                        resolution,
                    })
                : isMobileTarget
                    ? resolveGoogleDriveSyncConflict({
                        clientId,
                        conflictId: conflict.conflictId,
                        resolution,
                    })
                    : resolveGoogleDriveDesktopSyncConflict({
                        clientId,
                        conflictId: conflict.conflictId,
                        resolution,
                    })
        ), 'resolving-conflict', { refreshExams: true });
        if (response) {
            setMessage(`${choiceLabel}を採用し、解決結果を同期しました。`);
        }
    };

    const saveEmergencyBackup = async (
        filenamePrefix = 'radexam-before-cloud-reset'
    ) => {
        setBusyPhase('backup');
        const backup = await exportAllLocalData();
        const blob = await createBackupArchiveBlob(backup);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.radexam`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    const handleLocalDevelopmentReset = async () => {
        if (!window.confirm(
            'この端末内の試験、学習履歴、画像、PDF、同期履歴を削除します。\n'
            + `${providerName}上のデータは削除されません。\n\n`
            + '実行前に.radexamバックアップを保存します。続けますか？'
        )) {
            return;
        }
        setMessage('');
        setError('');
        try {
            await saveEmergencyBackup('radexam-before-local-development-reset');
            setBusyPhase('resetting-local');
            await clearLocalAppDataForDevelopment();
            await refreshLocalExamData();
            await refreshState();
            setMessage(
                'この端末内のデータを削除しました。'
                + `${providerName}へ再接続すると、クラウドの全体データを受信できます。`
            );
        } catch (resetError) {
            console.error('Failed to reset local development data:', resetError);
            setError(resetError.message || '端末内データの削除に失敗しました。');
        } finally {
            setBusyPhase('');
        }
    };

    const handleReset = async hard => {
        const warning = hard
            ? `開発用完全リセットでは、${providerName}上のRadExam同期データを完全に削除します。`
            : '新しい同期領域へ切り替えます。別端末では再接続が必要になります。';
        if (!window.confirm(
            `${warning}\n\n端末内データは削除せず、実行前に.radexamバックアップを保存します。続けますか？`
        )) {
            return;
        }
        setMessage('');
        setError('');
        try {
            await saveEmergencyBackup();
        } catch (backupError) {
            setBusyPhase('');
            setError(`リセット前のバックアップを作成できなかったため中止しました: ${backupError.message}`);
            return;
        }
        const response = await runAction(() => (
            isOneDrive
                ? isMobileTarget
                    ? resetOneDriveSync({ clientId, hard })
                    : resetOneDriveDesktopSync({ clientId, hard })
                : isMobileTarget
                    ? resetGoogleDriveSync({ clientId, hard })
                    : resetGoogleDriveDesktopSync({ clientId, hard })
        ), 'resetting');
        if (!response) return;
        setMessage(hard
            ? `クラウド上の同期データ${response.deletedFiles}件を削除しました。初回同期を開始します。`
            : '新しいクラウド同期領域へ切り替えました。初回同期を開始します。');
        await new Promise(resolve => window.requestAnimationFrame(resolve));
        const syncResponse = await runAction(() => (
            isOneDrive
                ? isMobileTarget
                    ? runOneDriveSync({ clientId })
                    : runOneDriveDesktopSync({ clientId })
                : isMobileTarget
                    ? runGoogleDriveSync({ clientId })
                    : runGoogleDriveDesktopSync({ clientId })
        ), 'initial-sync', { refreshExams: true });
        if (syncResponse) {
            setMessage(`クラウド同期のリセットが完了しました。${describeSyncResult(syncResponse.result)}`);
        }
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
        const response = await runAction(() => (
            isOneDrive
                ? isMobileTarget
                    ? disconnectOneDriveSync({ discardPending })
                    : disconnectOneDriveDesktopSync({
                        clientId,
                        discardPending,
                    })
                : isMobileTarget
                    ? disconnectGoogleDriveSync({ discardPending })
                    : disconnectGoogleDriveDesktopSync({
                        clientId,
                        discardPending,
                    })
        ));
        if (response) setMessage(`${providerName}との接続を解除しました。端末内のデータはそのままです。`);
    };

    const connected = Boolean(syncState?.connected);
    const desktopBridgeUnavailable = !isMobileTarget && syncState && !syncState.bridgeAvailable;
    const configurationMissing = !clientId;
    const unavailable = desktopBridgeUnavailable || configurationMissing;
    const busy = Boolean(busyPhase);

    return (
        <main className={styles.container}>
            <header className={styles.header}>
                <button type="button" onClick={() => router.push('/')} className={styles.backButton}>← 戻る</button>
                <div>
                    <span className={styles.eyebrow}>CLOUD SYNC</span>
                    <h1>クラウド同期</h1>
                    <p>端末内のデータを本体として保ち、選択したクラウドのアプリ専用領域を介して差分を同期します。</p>
                </div>
            </header>

            <section className={styles.localFirst}>
                <strong>オフラインでも利用できます</strong>
                <p>同期できない間も問題演習や編集は端末内へ保存され、次回の同期時に送信されます。</p>
            </section>

            <section className={styles.card}>
                {!connected && (
                    <div className={styles.providerChoice} aria-label="同期先を選択">
                        <button
                            type="button"
                            className={selectedProvider === SYNC_PROVIDERS.GOOGLE_DRIVE
                                ? styles.providerChoiceActive
                                : ''}
                            onClick={() => setSelectedProvider(SYNC_PROVIDERS.GOOGLE_DRIVE)}
                            disabled={busy}
                        >
                            Google Drive
                        </button>
                        <button
                            type="button"
                            className={selectedProvider === SYNC_PROVIDERS.ONE_DRIVE
                                ? styles.providerChoiceActive
                                : ''}
                            onClick={() => setSelectedProvider(SYNC_PROVIDERS.ONE_DRIVE)}
                            disabled={busy}
                        >
                            OneDrive
                        </button>
                    </div>
                )}
                <div className={styles.providerHeader}>
                    <div className={styles.driveMark} aria-hidden="true">{isOneDrive ? 'O' : 'G'}</div>
                    <div>
                        <h2>{providerName}</h2>
                        <p>{connected ? '接続済み' : '未接続'}</p>
                    </div>
                    <span className={`${styles.statusBadge} ${connected ? styles.connected : ''}`}>
                        {connected
                            ? syncState.initialSyncCompleted
                                ? '同期利用中'
                                : '接続済み・初回同期待ち'
                            : '未接続'}
                    </span>
                </div>

                {desktopBridgeUnavailable && (
                    <p className={styles.notice}>
                        {providerName}への接続は、ブラウザ版ではなくインストールしたMac/PC版アプリから実行してください。
                    </p>
                )}
                {!desktopBridgeUnavailable && configurationMissing && (
                    <p className={styles.notice}>
                        このビルドには{isMobileTarget ? 'Web版' : 'デスクトップ版'}の
                        {isOneDrive ? 'Microsoft' : 'Google'} OAuthクライアントIDが設定されていません。
                    </p>
                )}

                {connected && (
                    <>
                        {!syncState.initialSyncCompleted && (
                            <p className={styles.reauthNotice}>
                                {providerName}への接続は完了しています。端末データの初回同期はまだ完了していません。
                            </p>
                        )}
                        {!syncState.hasSessionToken && isMobileTarget && (
                            <p className={styles.reauthNotice}>
                                安全のため認証情報は長期保存していません。
                                同期するときに{isOneDrive ? 'Microsoft' : 'Google'}アカウントを再認証してください。
                            </p>
                        )}
                        {!syncState.encryptionAvailable && !isMobileTarget && (
                            <p className={styles.reauthNotice}>
                                この環境ではOSの暗号化保存を利用できないため、アプリ再起動後に再認証が必要です。
                            </p>
                        )}
                        <dl className={styles.details}>
                            <div><dt>アカウント</dt><dd>{syncState.config.accountLabel || providerName}</dd></div>
                            <div><dt>最終同期</dt><dd>{formatDateTime(syncState.config.lastSyncAt)}</dd></div>
                            <div><dt>データ状態</dt><dd>{describeDataStatus(syncState)}</dd></div>
                            <div><dt>未送信（残り）</dt><dd>{syncState.pendingCount}件</dd></div>
                            <div><dt>競合</dt><dd>{syncState.conflictCount}件</dd></div>
                            <div>
                                <dt>初回全体データ</dt>
                                <dd>{syncState.config.lastAppliedSnapshotId ? '登録済み' : '未登録'}</dd>
                            </div>
                            <div>
                                <dt>クラウド更新番号</dt>
                                <dd>{syncState.config.lastKnownCloudGeneration ?? '未確認'}</dd>
                            </div>
                            <div>
                                <dt>前回の送受信</dt>
                                <dd>
                                    送信 {syncState.config.lastSyncSentChanges || 0}件・
                                    受信 {syncState.config.lastSyncReceivedChanges || 0}件
                                </dd>
                            </div>
                            <div>
                                <dt>前回の所要時間</dt>
                                <dd>{formatDuration(syncState.config.lastSyncDurationMs)}</dd>
                            </div>
                        </dl>
                        <p className={styles.statusHelp}>
                            「未送信（残り）0件」は、送るデータが残っていない状態です。
                            各端末で0件かつクラウド更新番号が同じなら、
                            同じクラウド変更まで反映されています。
                        </p>
                        {syncState.config.lastSyncError && (
                            <p className={styles.syncError}>
                                前回の同期エラー: {syncState.config.lastSyncError}
                            </p>
                        )}
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
                            {busy ? '接続中…' : `${providerName}へ接続`}
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
                                    ? busyPhase === 'connecting'
                                        ? '接続中…'
                                        : busyPhase === 'initial-sync'
                                            ? '初回同期中…'
                                            : busyPhase === 'backup'
                                                ? 'バックアップ作成中…'
                                                : busyPhase === 'resetting'
                                                    ? 'リセット中…'
                                                    : '同期中…'
                                    : !syncState.initialSyncCompleted
                                        ? '初回同期を開始'
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
                {busy && describeProgress(progress) && (
                    <div className={styles.progress} role="status">
                        <span>{describeProgress(progress)}</span>
                        {['uploading-snapshot', 'uploading-checkpoint'].includes(progress?.phase)
                            && progress.totalBytes > 0 && (
                            <progress
                                max={progress.totalBytes}
                                value={progress.uploadedBytes || 0}
                            />
                        )}
                    </div>
                )}
                {connected && (
                    <div className={styles.resetArea}>
                        <strong>同期を最初からやり直す</strong>
                        <p>
                            端末内データをバックアップしてから、新しいクラウド同期領域へ切り替えます。
                            別端末では再接続が必要です。
                        </p>
                        <button
                            type="button"
                            className={styles.resetButton}
                            onClick={() => handleReset(false)}
                            disabled={busy}
                        >
                            クラウド同期をリセット
                        </button>
                        {IS_DEVELOPMENT && (
                            <button
                                type="button"
                                className={styles.hardResetButton}
                                onClick={() => handleReset(true)}
                                disabled={busy}
                            >
                                開発用：クラウドデータを完全削除
                            </button>
                        )}
                    </div>
                )}
                {IS_DEVELOPMENT && isMobileTarget && (
                    <div className={styles.resetArea}>
                        <strong>モバイル版の受信テスト</strong>
                        <p>
                            {providerName}上のバックアップは残したまま、この端末内のデータと同期履歴だけを空にします。
                            再接続後の初回同期で、クラウドから復元できるか確認できます。
                        </p>
                        <button
                            type="button"
                            className={styles.hardResetButton}
                            onClick={handleLocalDevelopmentReset}
                            disabled={busy}
                        >
                            開発用：この端末のデータを削除
                        </button>
                    </div>
                )}
            </section>

            {(syncState?.conflicts || []).length > 0 && (
                <section className={styles.conflictSection}>
                    <div className={styles.conflictHeader}>
                        <div>
                            <span className={styles.eyebrow}>CONFLICTS</span>
                            <h2>確認が必要な競合</h2>
                        </div>
                        <strong>{syncState.conflicts.length}件</strong>
                    </div>
                    <p className={styles.conflictIntro}>
                        同じ項目が複数端末で変更されました。比較して残す内容を選んでください。
                    </p>
                    <div className={styles.conflictList}>
                        {syncState.conflicts.map(conflict => (
                            <article className={styles.conflictCard} key={conflict.conflictId}>
                                <div className={styles.conflictTitle}>
                                    <div>
                                        <strong>{ENTITY_LABELS[conflict.entityType] || conflict.entityType}</strong>
                                        <span>{conflict.entityId}</span>
                                    </div>
                                    <span>
                                        {conflict.reason === 'delete-versus-change'
                                            ? '削除と編集が競合'
                                            : '同じ項目を編集'}
                                    </span>
                                </div>
                                <p className={styles.conflictingFields}>
                                    対象：{(conflict.conflictingFields || [])
                                        .map(field => FIELD_LABELS[field] || field.replace(/^options\./, '選択肢 '))
                                        .join('、')}
                                </p>
                                <div className={styles.conflictComparison}>
                                    <div>
                                        <h3>この端末</h3>
                                        {(conflict.localChanges || []).flatMap(describeConflictChange)
                                            .map((item, index) => (
                                                <dl key={`${item.field}-${index}`}>
                                                    <dt>{item.field}</dt>
                                                    <dd>{item.value}</dd>
                                                </dl>
                                            ))}
                                    </div>
                                    <div>
                                        <h3>クラウド</h3>
                                        {describeConflictChange(conflict.remoteChange).map((item, index) => (
                                            <dl key={`${item.field}-${index}`}>
                                                <dt>{item.field}</dt>
                                                <dd>{item.value}</dd>
                                            </dl>
                                        ))}
                                    </div>
                                </div>
                                <div className={styles.conflictActions}>
                                    <button
                                        type="button"
                                        onClick={() => handleResolveConflict(conflict, 'keep-local')}
                                        disabled={busy}
                                    >
                                        この端末を採用
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleResolveConflict(conflict, 'keep-cloud')}
                                        disabled={busy}
                                    >
                                        クラウドを採用
                                    </button>
                                </div>
                            </article>
                        ))}
                    </div>
                </section>
            )}

            {message && <p className={styles.success} role="status">{message}</p>}
            {error && <p className={styles.error} role="alert">{error}</p>}

            <aside className={styles.note}>
                <strong>手動バックアップも引き続き利用できます</strong>
                <p>従来の.radexamファイルは、緊急復旧やクラウドを使わないデータ移動用として維持されます。</p>
            </aside>
        </main>
    );
}
