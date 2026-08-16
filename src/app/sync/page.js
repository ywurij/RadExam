"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isMobileTarget } from '@/lib/appTarget';
import { createBackupArchiveBlob } from '@/lib/backupArchive.mjs';
import {
    clearLocalAppDataForDevelopment,
    exportAllLocalData,
} from '@/lib/localDb';
import { refreshLocalExamData } from '@/lib/data';
import {
    checkGoogleDriveUpdates,
    connectGoogleDriveSync,
    disconnectGoogleDriveSync,
    getGoogleDriveSyncState,
    resetGoogleDriveSync,
    resolveGoogleDriveSyncConflict,
    pullGoogleDriveUpdates,
    pushGoogleDriveChanges,
    unlockGoogleDriveEncryption,
} from '@/lib/sync/googleDriveBrowserSync';
import {
    checkGoogleDriveDesktopUpdates,
    connectGoogleDriveDesktopSync,
    disconnectGoogleDriveDesktopSync,
    getGoogleDriveDesktopSyncState,
    resetGoogleDriveDesktopSync,
    resolveGoogleDriveDesktopSyncConflict,
    pullGoogleDriveDesktopUpdates,
    pushGoogleDriveDesktopChanges,
    unlockGoogleDriveDesktopEncryption,
} from '@/lib/sync/googleDriveDesktopSync';
import {
    checkOneDriveUpdates,
    connectOneDriveSync,
    disconnectOneDriveSync,
    getOneDriveSyncState,
    resetOneDriveSync,
    resolveOneDriveSyncConflict,
    pullOneDriveUpdates,
    pushOneDriveChanges,
    unlockOneDriveEncryption,
} from '@/lib/sync/oneDriveBrowserSync';
import {
    checkOneDriveDesktopUpdates,
    connectOneDriveDesktopSync,
    disconnectOneDriveDesktopSync,
    getOneDriveDesktopSyncState,
    resetOneDriveDesktopSync,
    resolveOneDriveDesktopSyncConflict,
    pullOneDriveDesktopUpdates,
    pushOneDriveDesktopChanges,
    unlockOneDriveDesktopEncryption,
} from '@/lib/sync/oneDriveDesktopSync';
import { SYNC_PROVIDERS } from '@/lib/sync/syncProtocol.mjs';
import { hasPendingMicrosoftAuthorizationRedirect } from '@/lib/sync/microsoftIdentityWebAuth';
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

const describeDataStatus = state => {
    if (!state) return '確認中';
    if (state.config?.remoteChangesAvailable) {
        if (state.config.remoteSnapshotAvailable) {
            return 'クラウドに未取得の初回全体データあり';
        }
        return `クラウドに未取得が${state.config.remoteChangeCount || 0}件`;
    }
    if (state.dataStatus === 'verified') return '前回確認時点でクラウドと一致';
    if (state.dataStatus === 'local-changes') return `この端末に未送信が${state.pendingCount}件`;
    if (state.dataStatus === 'conflict') return `確認が必要な競合が${state.conflictCount}件`;
    if (state.dataStatus === 'error') return '前回の確認に失敗';
    return 'まだクラウドとの差を確認していません';
};

const describeProgressDetails = progress => {
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
        return `変更内容を送信中: ${formatBytes(progress.uploadedBytes)} / ${formatBytes(progress.totalBytes)}`;
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
    if (progress.phase === 'preparing-received-changes') {
        return `受信した変更${progress.totalChanges || 0}件の反映準備をしています`;
    }
    if (progress.phase === 'downloading-change-batch') {
        return `変更データを受信しています: ${progress.batchIndex || 0} / ${progress.totalBatches || 0}グループ`;
    }
    if (progress.phase === 'checking-received-history') {
        return `反映済みの変更を確認しています（${progress.batchChanges || 0}件）`;
    }
    if (progress.phase === 'downloading-received-files') {
        return `変更された画像・PDFを受信しています: ${progress.downloadedFiles || 0} / ${progress.totalFiles || 0}件`;
    }
    if (progress.phase === 'checking-received-changes') {
        return `変更内容と競合を確認しています: ${progress.processedChanges || 0} / ${progress.totalChanges || 0}件`;
    }
    if (progress.phase === 'saving-received-changes') {
        return `確認済みの変更を端末へ保存しています（${progress.changeCount || 0}件）`;
    }
    if (progress.phase === 'recording-received-history') {
        return `同期履歴をまとめて整理しています（${progress.changeCount || 0}件）`;
    }
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

const describeProgress = (progress, now) => {
    const details = describeProgressDetails(progress);
    if (!details || !progress?.phaseStartedAt || !now) return details;
    const elapsedSeconds = Math.max(
        0,
        Math.floor((now - progress.phaseStartedAt) / 1000)
    );
    return `${details}（この処理: ${elapsedSeconds}秒）`;
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

export default function CloudSyncPage({ embedded = false }) {
    const router = useRouter();
    const [selectedProvider, setSelectedProvider] = useState(SYNC_PROVIDERS.GOOGLE_DRIVE);
    const [syncState, setSyncState] = useState(null);
    const [busyPhase, setBusyPhase] = useState('');
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [progress, setProgress] = useState(null);
    const [progressClock, setProgressClock] = useState(0);
    const [encryptionPassphrase, setEncryptionPassphrase] = useState('');
    const oauthResumeStarted = useRef(false);
    const progressPhase = progress?.phase || '';
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
        window.addEventListener('radexam-cloud-update-status', refreshState);
        window.addEventListener('radexam-local-sync-change', refreshState);
        const handleProgress = event => {
            const detail = event.detail || null;
            const receivedAt = Date.now();
            setProgress(current => detail ? {
                ...detail,
                phaseStartedAt: current?.phase === detail.phase
                    ? current.phaseStartedAt
                    : receivedAt,
            } : null);
            setProgressClock(receivedAt);
        };
        window.addEventListener('radexam-cloud-sync-progress', handleProgress);
        return () => {
            window.removeEventListener('radexam-cloud-sync-completed', refreshState);
            window.removeEventListener('radexam-cloud-update-status', refreshState);
            window.removeEventListener('radexam-local-sync-change', refreshState);
            window.removeEventListener('radexam-cloud-sync-progress', handleProgress);
        };
    }, [refreshState]);

    useEffect(() => {
        if (
            !isMobileTarget
            || oauthResumeStarted.current
            || !hasPendingMicrosoftAuthorizationRedirect()
        ) return undefined;
        oauthResumeStarted.current = true;
        let cancelled = false;
        setSelectedProvider(SYNC_PROVIDERS.ONE_DRIVE);
        setBusyPhase('connecting');
        setMessage('');
        setError('');
        connectOneDriveSync({ clientId: MICROSOFT_CLIENT_ID })
            .then(async () => {
                if (cancelled) return;
                setSyncState(await getOneDriveSyncState());
                setMessage('OneDriveへの接続が完了しました。取得または送信する操作を選んでください。');
                router.replace('/data');
            })
            .catch(authError => {
                if (!cancelled) setError(authError.message || 'OneDriveへ接続できませんでした。');
            })
            .finally(() => {
                if (!cancelled) setBusyPhase('');
            });
        return () => {
            cancelled = true;
        };
    }, [router]);

    useEffect(() => {
        if (!busyPhase || !progressPhase) return undefined;
        const timer = window.setInterval(() => setProgressClock(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [busyPhase, progressPhase]);

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
            setMessage(`${providerName}への接続が完了しました。取得または送信する操作を選んでください。`);
        }
        return response;
    };

    const directionalAction = direction => {
        if (isOneDrive && isMobileTarget) {
            return direction === 'check' ? checkOneDriveUpdates
                : direction === 'pull' ? pullOneDriveUpdates : pushOneDriveChanges;
        }
        if (isOneDrive) {
            return direction === 'check' ? checkOneDriveDesktopUpdates
                : direction === 'pull' ? pullOneDriveDesktopUpdates : pushOneDriveDesktopChanges;
        }
        if (isMobileTarget) {
            return direction === 'check' ? checkGoogleDriveUpdates
                : direction === 'pull' ? pullGoogleDriveUpdates : pushGoogleDriveChanges;
        }
        return direction === 'check' ? checkGoogleDriveDesktopUpdates
            : direction === 'pull' ? pullGoogleDriveDesktopUpdates : pushGoogleDriveDesktopChanges;
    };

    const handleCheck = async () => {
        const response = await runAction(
            () => directionalAction('check')({ clientId }),
            'checking'
        );
        if (response) setMessage(response.result.updatesAvailable
            ? `クラウドに未取得の更新があります（${response.result.remoteChangeCount || 0}件）。`
            : '更新を確認しました。クラウドに未取得の更新はありません。');
    };

    const handlePull = async () => {
        const response = await runAction(() => (
            directionalAction('pull')({ clientId })
        ), 'pulling', {
            refreshExams: true,
        });
        if (response) setMessage(`クラウドから更新を取得しました。受信 ${response.result.appliedChanges || 0}件。`);
    };

    const handlePush = async () => {
        const response = await runAction(
            () => directionalAction('push')({ clientId }),
            'pushing'
        );
        if (response) setMessage(`この端末の変更を送信しました。送信 ${response.result.sentChanges || 0}件。`);
    };

    const encryptionAction = () => {
        if (isOneDrive && isMobileTarget) {
            return unlockOneDriveEncryption;
        }
        if (isOneDrive) {
            return unlockOneDriveDesktopEncryption;
        }
        if (isMobileTarget) {
            return unlockGoogleDriveEncryption;
        }
        return unlockGoogleDriveDesktopEncryption;
    };

    const handleUnlockEncryption = async () => {
        const response = await runAction(
            () => encryptionAction()({ clientId, passphrase: encryptionPassphrase }),
            'unlocking-encryption'
        );
        if (response) {
            setEncryptionPassphrase('');
            setMessage('クラウド暗号化を解除しました。このアプリを終了するまで同期できます。');
        }
    };

    const handleResolveConflicts = async (conflicts, resolution) => {
        const targets = (conflicts || []).filter(conflict => conflict?.conflictId);
        if (targets.length === 0) return;
        const choiceLabel = resolution === 'keep-local'
            ? 'この端末の内容'
            : 'クラウドの内容';
        const targetLabel = targets.length === 1
            ? 'この競合'
            : `競合${targets.length}件すべて`;
        if (!window.confirm(
            `${targetLabel}に${choiceLabel}を採用します。\n`
            + '採用しなかった側の競合部分は元に戻せません。続けますか？'
        )) {
            return;
        }
        const conflictArguments = targets.length === 1
            ? { conflictId: targets[0].conflictId }
            : { conflictIds: targets.map(conflict => conflict.conflictId) };
        const response = await runAction(() => (
            isOneDrive
                ? isMobileTarget
                    ? resolveOneDriveSyncConflict({
                        clientId,
                        ...conflictArguments,
                        resolution,
                    })
                    : resolveOneDriveDesktopSyncConflict({
                        clientId,
                        ...conflictArguments,
                        resolution,
                    })
                : isMobileTarget
                    ? resolveGoogleDriveSyncConflict({
                        clientId,
                        ...conflictArguments,
                        resolution,
                    })
                    : resolveGoogleDriveDesktopSyncConflict({
                        clientId,
                        ...conflictArguments,
                        resolution,
                    })
        ), targets.length === 1 ? 'resolving-conflict' : 'resolving-conflicts', { refreshExams: true });
        if (response) {
            setMessage(
                `${targets.length}件の競合に${choiceLabel}を採用し、解決結果を同期しました。`
            );
        }
    };

    const handleResolveConflict = (conflict, resolution) => (
        handleResolveConflicts([conflict], resolution)
    );

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
            ? `クラウド上の同期データ${response.deletedFiles}件を削除しました。この端末から初回データを送信します。`
            : '新しいクラウド同期領域へ切り替えました。この端末から初回データを送信します。');
        await new Promise(resolve => window.requestAnimationFrame(resolve));
        const syncResponse = await runAction(
            () => directionalAction('push')({ clientId }),
            'pushing'
        );
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
    const cloudEncryptionEnabled = Boolean(syncState?.cloudEncryption?.enabled);
    const cloudEncryptionUnlocked = Boolean(syncState?.cloudEncryption?.unlocked);
    const encryptionLocked = cloudEncryptionEnabled && !cloudEncryptionUnlocked;
    const desktopBridgeUnavailable = !isMobileTarget && syncState && !syncState.bridgeAvailable;
    const configurationMissing = !clientId;
    const unavailable = desktopBridgeUnavailable || configurationMissing;
    const busy = Boolean(busyPhase);
    const Root = embedded ? 'section' : 'main';

    return (
        <Root className={`${styles.container} ${embedded ? styles.embedded : ''}`}>
            {!embedded && <header className={styles.header}>
                <button type="button" onClick={() => router.push('/')} className={styles.backButton}>← 戻る</button>
                <div>
                    <span className={styles.eyebrow}>CLOUD SYNC</span>
                    <h1>クラウド同期</h1>
                    <p>端末内のデータを本体として保ち、選択したクラウドのアプリ専用領域を介して差分を同期します。</p>
                </div>
            </header>}

            <section className={styles.localFirst}>
                <strong>端末内のデータが本体です</strong>
                <p>
                    オフラインでも利用できます。Mac/PC版で作成した内容は「送信」、
                    モバイル版で受け取るときは「取得」を押してください。
                </p>
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
                            <div><dt>最終確認</dt><dd>{formatDateTime(syncState.config.lastCheckedAt)}</dd></div>
                            <div><dt>データ状態</dt><dd>{describeDataStatus(syncState)}</dd></div>
                            <div><dt>未送信（残り）</dt><dd>{syncState.pendingCount}件</dd></div>
                            <div><dt>競合</dt><dd>{syncState.conflictCount}件</dd></div>
                        </dl>
                        <p className={styles.statusHelp}>
                            起動時・復帰時には更新の有無だけを確認します。
                            実際のデータは「取得」または「送信」を押したときに移動します。
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
                                onClick={handlePull}
                                disabled={busy || unavailable || encryptionLocked}
                            >
                                {busyPhase === 'pulling'
                                    ? '取得中…'
                                    : syncState.initialSyncCompleted
                                        ? '↓ クラウドから更新を取得'
                                        : '↓ クラウドから初回取得'}
                            </button>
                            <button
                                type="button"
                                className={styles.primaryButton}
                                onClick={handlePush}
                                disabled={busy || unavailable || encryptionLocked || syncState.config.remoteChangesAvailable}
                            >
                                {busyPhase === 'pushing'
                                    ? '送信中…'
                                    : `↑ この端末の変更を送信（${syncState.pendingCount || 0}件）`}
                            </button>
                            <button
                                type="button"
                                className={styles.secondaryButton}
                                onClick={handleCheck}
                                disabled={busy || unavailable || encryptionLocked}
                            >
                                {busyPhase === 'checking' ? '確認中…' : '更新だけ確認'}
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
                {connected && encryptionLocked && (
                    <div className={styles.encryptionArea}>
                        <strong>🔒 暗号化された同期データです</strong>
                        <p>この同期領域を作成したときと同じ同期パスフレーズを入力してください。入力内容は保存されません。</p>
                        <input
                            type="password"
                            autoComplete="current-password"
                            value={encryptionPassphrase}
                            onChange={event => setEncryptionPassphrase(event.target.value)}
                            placeholder="同期パスフレーズ"
                            disabled={busy}
                        />
                        <button type="button" className={styles.primaryButton} onClick={handleUnlockEncryption} disabled={busy || encryptionPassphrase.length < 12}>
                            暗号化を解除
                        </button>
                    </div>
                )}
                {connected && syncState.config.remoteChangesAvailable && (
                    <p className={styles.syncError}>
                        {syncState.config.remoteSnapshotAvailable
                            ? 'クラウドに別端末の初回全体データがあります。送信前に取得してください。'
                            : 'クラウドに未取得の更新があります。送信前に更新を取得してください。'}
                    </p>
                )}
                {busy && describeProgress(progress, progressClock) && (
                    <div className={styles.progress} role="status">
                        <span>{describeProgress(progress, progressClock)}</span>
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
                            disabled={busy || encryptionLocked}
                        >
                            クラウド同期をリセット
                        </button>
                        {IS_DEVELOPMENT && (
                            <button
                                type="button"
                                className={styles.hardResetButton}
                                onClick={() => handleReset(true)}
                                disabled={busy || encryptionLocked}
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
                    <div className={styles.conflictBulkActions}>
                        <strong>すべて同じ側を採用</strong>
                        <button
                            type="button"
                            onClick={() => handleResolveConflicts(syncState.conflicts, 'keep-local')}
                            disabled={busy}
                        >
                            全件、この端末を採用
                        </button>
                        <button
                            type="button"
                            onClick={() => handleResolveConflicts(syncState.conflicts, 'keep-cloud')}
                            disabled={busy}
                        >
                            全件、クラウドを採用
                        </button>
                    </div>
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
                <p>データ管理では、緊急復旧やクラウドを使わないデータ移動用に.radexamファイルを作成できます。クラウドのリセット前にも緊急バックアップを保存します。</p>
            </aside>
        </Root>
    );
}
