import {
    connectLocalSyncTracking,
    disconnectLocalSyncTracking,
    initializeLocalSyncTracking,
    resolveLocalDataSyncConflict,
    synchronizeLocalData,
} from '@/lib/localDb';
import {
    getLocalSyncJournalConfig,
    listLocalSyncConflicts,
    listPendingLocalSyncChanges,
} from './localSyncJournal';
import {
    OneDriveAppFolderClient,
    OneDriveSyncProvider,
} from './oneDriveSyncProvider.mjs';
import { SYNC_PROVIDERS } from './syncProtocol.mjs';

let activeSession = null;
let activeSync = null;

const getBridge = () => globalThis.window?.radexamCloudSync?.oneDrive || null;
const publishProgress = detail => {
    globalThis.window?.dispatchEvent(new CustomEvent('radexam-cloud-sync-progress', {
        detail,
    }));
};

export const isOneDriveDesktopBridgeAvailable = () => Boolean(getBridge());

const createSession = clientId => {
    if (activeSession?.clientId === clientId) return activeSession;
    const bridge = getBridge();
    if (!bridge) throw new Error('Mac/PC版アプリのMicrosoft認証機能を利用できません。');
    const client = new OneDriveAppFolderClient({
        getAccessToken: () => bridge.getAccessToken(clientId),
        onUploadProgress: progress => publishProgress({
            phase: progress.progressPhase || (
                String(progress.path || '').includes('/snapshots/')
                    || String(progress.path || '').startsWith('snapshots/')
                    ? 'uploading-snapshot'
                    : 'uploading-changes'
            ),
            ...progress,
        }),
    });
    activeSession = {
        clientId,
        bridge,
        client,
        provider: new OneDriveSyncProvider({ client, onProgress: publishProgress }),
    };
    return activeSession;
};

const runExclusive = task => {
    if (activeSync) return activeSync;
    activeSync = Promise.resolve()
        .then(task)
        .finally(() => {
            activeSync = null;
        });
    return activeSync;
};

const accountDetails = user => ({
    accountId: user?.id,
    accountLabel: user?.mail || user?.userPrincipalName || user?.displayName || 'OneDrive',
});

const verifyAccount = (user, state) => {
    const details = accountDetails(user);
    if (!details.accountId) throw new Error('Microsoftアカウント情報を確認できませんでした。');
    if (state && String(details.accountId) !== String(state.config.accountId)) {
        throw new Error('接続済みとは別のMicrosoftアカウントです。接続を解除してから再接続してください。');
    }
    return details;
};

export const getOneDriveDesktopSyncState = async ({ clientId } = {}) => {
    const bridge = getBridge();
    const [config, pendingChanges, conflicts, credentialStatus] = await Promise.all([
        getLocalSyncJournalConfig(),
        listPendingLocalSyncChanges(),
        listLocalSyncConflicts(),
        bridge && clientId
            ? bridge.getStatus(clientId).catch(() => null)
            : Promise.resolve(null),
    ]);
    const connected = Boolean(
        config.enabled
        && config.provider === SYNC_PROVIDERS.ONE_DRIVE
    );
    return {
        config,
        connected,
        initialSyncCompleted: Boolean(config.bootstrapCompleted && config.lastVerifiedAt),
        pendingCount: pendingChanges.length,
        conflictCount: conflicts.length,
        conflicts,
        hasSessionToken: Boolean(credentialStatus?.hasCredentials),
        bridgeAvailable: Boolean(bridge),
        encryptionAvailable: credentialStatus?.encryptionAvailable !== false,
        dataStatus: !connected
            ? 'not-connected'
            : config.lastSyncError
                ? 'error'
                : conflicts.length > 0
                    ? 'conflict'
                    : pendingChanges.length > 0
                        ? 'local-changes'
                        : config.lastVerifiedAt
                            ? 'verified'
                            : 'not-verified',
    };
};

export const connectOneDriveDesktopSync = async ({ clientId }) => (
    runExclusive(async () => {
        if (!clientId) {
            throw new Error('デスクトップ版のMicrosoft OAuthクライアントIDが設定されていません。');
        }
        const session = createSession(clientId);
        await session.bridge.authorize(clientId);
        const user = await session.client.getCurrentUser();
        const { accountId, accountLabel } = verifyAccount(user);
        const root = await session.provider.ensureActiveSyncSpace();
        await connectLocalSyncTracking({
            provider: SYNC_PROVIDERS.ONE_DRIVE,
            accountId,
            accountLabel,
            deviceName: `RadExam ${globalThis.navigator?.platform || 'Mac/PC'}`,
            cloudSyncId: root.activeSyncId,
        });
        return {
            result: { status: 'connected' },
            user,
            state: await getOneDriveDesktopSyncState({ clientId }),
        };
    })
);

export const runOneDriveDesktopSync = async ({
    clientId,
    interactive = true,
} = {}) => (
    runExclusive(async () => {
        const state = await getOneDriveDesktopSyncState({ clientId });
        if (!state.connected) throw new Error('先にOneDriveへ接続してください。');
        const session = createSession(clientId);
        if (!state.hasSessionToken) {
            if (!interactive) {
                const error = new Error('OneDriveへの再認証が必要です。');
                error.requiresReauth = true;
                throw error;
            }
            await session.bridge.authorize(clientId);
        }
        const user = await session.client.getCurrentUser();
        const { accountId, accountLabel } = verifyAccount(user, state);
        const root = await session.provider.ensureActiveSyncSpace();
        if (state.config.cloudSyncId && state.config.cloudSyncId !== root.activeSyncId) {
            const error = new Error(
                'クラウド同期が別の端末でリセットされました。この端末を再接続してください。'
            );
            error.code = 'CLOUD_SYNC_RESET';
            throw error;
        }
        if (!state.config.cloudSyncId) {
            await connectLocalSyncTracking({
                provider: SYNC_PROVIDERS.ONE_DRIVE,
                accountId,
                cloudSyncId: root.activeSyncId,
            });
        }
        if (!state.config.bootstrapCompleted) {
            session.provider.reportProgress({ phase: 'preparing-local-data' });
            await initializeLocalSyncTracking({
                provider: SYNC_PROVIDERS.ONE_DRIVE,
                accountId,
                accountLabel,
                deviceName: `RadExam ${globalThis.navigator?.platform || 'Mac/PC'}`,
                cloudSyncId: root.activeSyncId,
            });
        }
        const result = await synchronizeLocalData(session.provider);
        return {
            result,
            state: await getOneDriveDesktopSyncState({ clientId }),
        };
    })
);

export const resolveOneDriveDesktopSyncConflict = async ({
    clientId,
    conflictId,
    resolution,
} = {}) => (
    runExclusive(async () => {
        const state = await getOneDriveDesktopSyncState({ clientId });
        if (!state.connected) throw new Error('先にOneDriveへ接続してください。');
        const session = createSession(clientId);
        if (!state.hasSessionToken) await session.bridge.authorize(clientId);
        const user = await session.client.getCurrentUser();
        verifyAccount(user, state);
        const root = await session.provider.ensureActiveSyncSpace();
        if (state.config.cloudSyncId && state.config.cloudSyncId !== root.activeSyncId) {
            throw new Error('クラウド同期が別の端末でリセットされました。この端末を再接続してください。');
        }
        const resolved = await resolveLocalDataSyncConflict({
            conflictId,
            resolution,
            resolveBlob: ref => session.provider.downloadBlob(ref.contentHash),
        });
        const result = await synchronizeLocalData(session.provider);
        return {
            resolved,
            result,
            state: await getOneDriveDesktopSyncState({ clientId }),
        };
    })
);

export const resetOneDriveDesktopSync = async ({
    clientId,
    hard = false,
} = {}) => (
    runExclusive(async () => {
        const state = await getOneDriveDesktopSyncState({ clientId });
        if (!state.connected) throw new Error('先にOneDriveへ接続してください。');
        const session = createSession(clientId);
        if (!state.hasSessionToken) await session.bridge.authorize(clientId);
        const user = await session.client.getCurrentUser();
        const { accountId, accountLabel } = verifyAccount(user, state);
        let deletedFiles = 0;
        if (hard) {
            ({ deletedFiles } = await session.provider.deleteAllCloudSyncData());
            await session.provider.ensureActiveSyncSpace();
        }
        const root = await session.provider.rotateSyncSpace();
        await disconnectLocalSyncTracking({ discardPending: true });
        await connectLocalSyncTracking({
            provider: SYNC_PROVIDERS.ONE_DRIVE,
            accountId,
            accountLabel,
            deviceName: `RadExam ${globalThis.navigator?.platform || 'Mac/PC'}`,
            cloudSyncId: root.activeSyncId,
        });
        return {
            deletedFiles,
            root,
            state: await getOneDriveDesktopSyncState({ clientId }),
        };
    })
);

export const disconnectOneDriveDesktopSync = async ({
    clientId,
    discardPending = false,
} = {}) => {
    if (activeSync) await activeSync.catch(() => {});
    const config = await disconnectLocalSyncTracking({ discardPending });
    const bridge = getBridge();
    if (bridge && clientId) await bridge.clear(clientId);
    activeSession = null;
    return {
        config,
        state: await getOneDriveDesktopSyncState({ clientId }),
    };
};

export const runOneDriveDesktopBackgroundSync = async ({ clientId } = {}) => {
    const state = await getOneDriveDesktopSyncState({ clientId });
    if (!state.connected) return { status: 'skipped', reason: 'not-connected' };
    if (!state.bridgeAvailable) return { status: 'skipped', reason: 'bridge-unavailable' };
    if (!state.hasSessionToken) return { status: 'skipped', reason: 'reauth-required' };
    if (globalThis.navigator?.onLine === false) {
        return { status: 'skipped', reason: 'offline' };
    }
    const response = await runOneDriveDesktopSync({ clientId, interactive: false });
    return { status: 'completed', ...response };
};
