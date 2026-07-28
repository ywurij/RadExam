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
    GoogleDriveAppDataClient,
    GoogleDriveSyncProvider,
} from './googleDriveSyncProvider.mjs';
import { GoogleDriveWebTokenManager } from './googleIdentityWebAuth';
import { SYNC_PROVIDERS } from './syncProtocol.mjs';

let activeSession = null;
let activeSync = null;
const publishProgress = detail => {
    globalThis.window?.dispatchEvent(new CustomEvent('radexam-cloud-sync-progress', {
        detail,
    }));
};

const createSession = clientId => {
    if (activeSession?.clientId === clientId) return activeSession;
    const tokenManager = new GoogleDriveWebTokenManager({ clientId });
    const client = new GoogleDriveAppDataClient({
        getAccessToken: () => tokenManager.getAccessToken(),
        onUploadProgress: progress => publishProgress({
            phase: progress.progressPhase || (
                String(progress.path || '').startsWith('snapshots/')
                ? 'uploading-snapshot'
                : 'uploading-changes'
            ),
            ...progress,
        }),
    });
    activeSession = {
        clientId,
        tokenManager,
        client,
        provider: new GoogleDriveSyncProvider({ client, onProgress: publishProgress }),
    };
    return activeSession;
};

const getDeviceName = () => {
    const platform = globalThis.navigator?.userAgentData?.platform
        || globalThis.navigator?.platform
        || 'Mobile/Web';
    return `RadExam ${platform}`;
};

export const getGoogleDriveSyncState = async () => {
    const [config, pendingChanges, conflicts] = await Promise.all([
        getLocalSyncJournalConfig(),
        listPendingLocalSyncChanges(),
        listLocalSyncConflicts(),
    ]);
    const connected = Boolean(
        config.enabled
        && config.provider === SYNC_PROVIDERS.GOOGLE_DRIVE
    );
    return {
        config,
        connected,
        initialSyncCompleted: Boolean(config.bootstrapCompleted && config.lastVerifiedAt),
        pendingCount: pendingChanges.length,
        conflictCount: conflicts.length,
        conflicts,
        hasSessionToken: Boolean(activeSession?.tokenManager?.hasValidToken()),
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

const runExclusive = task => {
    if (activeSync) return activeSync;
    activeSync = Promise.resolve()
        .then(task)
        .finally(() => {
            activeSync = null;
        });
    return activeSync;
};

const authorizeSession = async (clientId, { prompt }) => {
    if (!clientId) throw new Error('Google OAuthクライアントIDが設定されていません。');
    const session = createSession(clientId);
    if (!session.tokenManager.hasValidToken()) {
        if (prompt === undefined) {
            const error = new Error('Google Driveへの再認証が必要です。');
            error.requiresReauth = true;
            throw error;
        }
        await session.tokenManager.requestAccessToken({ prompt });
    }
    return session;
};

export const connectGoogleDriveSync = async ({ clientId }) => {
    return runExclusive(async () => {
        const session = await authorizeSession(clientId, { prompt: 'consent' });
        const user = await session.client.getCurrentUser();
        const accountId = user?.permissionId || user?.emailAddress;
        if (!accountId) throw new Error('Google Driveのアカウント情報を確認できませんでした。');
        const accountLabel = user?.emailAddress || user?.displayName || 'Google Drive';
        const root = await session.provider.ensureActiveSyncSpace();

        await connectLocalSyncTracking({
            provider: SYNC_PROVIDERS.GOOGLE_DRIVE,
            accountId,
            accountLabel,
            deviceName: getDeviceName(),
            cloudSyncId: root.activeSyncId,
        });
        return {
            result: { status: 'connected' },
            user,
            state: await getGoogleDriveSyncState(),
        };
    });
};

export const runGoogleDriveSync = async ({
    clientId,
    interactive = true,
} = {}) => {
    return runExclusive(async () => {
        const state = await getGoogleDriveSyncState();
        if (!state.connected) throw new Error('先にGoogle Driveへ接続してください。');
        const session = await authorizeSession(clientId, {
            prompt: interactive ? '' : undefined,
        });
        const user = await session.client.getCurrentUser();
        const accountId = user?.permissionId || user?.emailAddress;
        if (String(accountId) !== String(state.config.accountId)) {
            throw new Error('接続済みとは別のGoogleアカウントです。正しいアカウントで再認証してください。');
        }
        const root = await session.provider.ensureActiveSyncSpace();
        if (
            state.config.cloudSyncId
            && state.config.cloudSyncId !== root.activeSyncId
        ) {
            const error = new Error(
                'クラウド同期が別の端末でリセットされました。この端末を再接続してください。'
            );
            error.code = 'CLOUD_SYNC_RESET';
            throw error;
        }
        if (!state.config.cloudSyncId) {
            await connectLocalSyncTracking({
                provider: SYNC_PROVIDERS.GOOGLE_DRIVE,
                accountId,
                cloudSyncId: root.activeSyncId,
            });
        }
        if (!state.config.bootstrapCompleted) {
            session.provider.reportProgress({ phase: 'preparing-local-data' });
            await initializeLocalSyncTracking({
                provider: SYNC_PROVIDERS.GOOGLE_DRIVE,
                accountId,
                accountLabel: user?.emailAddress || user?.displayName || 'Google Drive',
                deviceName: getDeviceName(),
                cloudSyncId: root.activeSyncId,
            });
        }
        const result = await synchronizeLocalData(session.provider);
        return {
            result,
            state: await getGoogleDriveSyncState(),
        };
    });
};

export const resolveGoogleDriveSyncConflict = async ({
    clientId,
    conflictId,
    resolution,
} = {}) => (
    runExclusive(async () => {
        const state = await getGoogleDriveSyncState();
        if (!state.connected) throw new Error('先にGoogle Driveへ接続してください。');
        const session = await authorizeSession(clientId, { prompt: '' });
        const user = await session.client.getCurrentUser();
        const accountId = user?.permissionId || user?.emailAddress;
        if (String(accountId) !== String(state.config.accountId)) {
            throw new Error('接続済みとは別のGoogleアカウントです。');
        }
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
            state: await getGoogleDriveSyncState(),
        };
    })
);

export const resetGoogleDriveSync = async ({
    clientId,
    hard = false,
} = {}) => (
    runExclusive(async () => {
        const state = await getGoogleDriveSyncState();
        if (!state.connected) throw new Error('先にGoogle Driveへ接続してください。');
        const session = await authorizeSession(clientId, { prompt: '' });
        const user = await session.client.getCurrentUser();
        const accountId = user?.permissionId || user?.emailAddress;
        if (String(accountId) !== String(state.config.accountId)) {
            throw new Error('接続済みとは別のGoogleアカウントです。');
        }
        let deletedFiles = 0;
        if (hard) {
            ({ deletedFiles } = await session.provider.deleteAllCloudSyncData());
            await session.provider.ensureActiveSyncSpace();
        }
        const root = await session.provider.rotateSyncSpace();
        await disconnectLocalSyncTracking({ discardPending: true });
        await connectLocalSyncTracking({
            provider: SYNC_PROVIDERS.GOOGLE_DRIVE,
            accountId,
            accountLabel: user?.emailAddress || user?.displayName || 'Google Drive',
            deviceName: getDeviceName(),
            cloudSyncId: root.activeSyncId,
        });
        return {
            deletedFiles,
            root,
            state: await getGoogleDriveSyncState(),
        };
    })
);

export const disconnectGoogleDriveSync = async ({ discardPending = false } = {}) => {
    if (activeSync) await activeSync.catch(() => {});
    const config = await disconnectLocalSyncTracking({ discardPending });
    activeSession?.tokenManager?.clear();
    activeSession = null;
    return {
        config,
        state: await getGoogleDriveSyncState(),
    };
};

export const runGoogleDriveBackgroundSync = async ({ clientId } = {}) => {
    const state = await getGoogleDriveSyncState();
    if (!state.connected) return { status: 'skipped', reason: 'not-connected' };
    if (globalThis.navigator?.onLine === false) {
        return { status: 'skipped', reason: 'offline' };
    }
    if (!activeSession?.tokenManager?.hasValidToken()) {
        return { status: 'skipped', reason: 'reauth-required' };
    }
    const response = await runGoogleDriveSync({ clientId, interactive: false });
    return { status: 'completed', ...response };
};
