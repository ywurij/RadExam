import {
    checkLocalDataSyncUpdates,
    connectLocalSyncTracking,
    disconnectLocalSyncTracking,
    initializeLocalSyncTracking,
    pullLocalDataFromCloud,
    pushLocalDataToCloud,
    resolveLocalDataSyncConflicts,
    synchronizeLocalData,
} from '@/lib/localDb';
import { getLocalSyncJournalState } from './localSyncJournal';
import { MicrosoftOneDriveWebTokenManager } from './microsoftIdentityWebAuth';
import {
    OneDriveAppFolderClient,
    OneDriveSyncProvider,
} from './oneDriveSyncProvider.mjs';
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
    const tokenManager = new MicrosoftOneDriveWebTokenManager({ clientId });
    const client = new OneDriveAppFolderClient({
        getAccessToken: () => tokenManager.getAccessToken(),
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
        tokenManager,
        client,
        provider: new OneDriveSyncProvider({ client, onProgress: publishProgress }),
    };
    return activeSession;
};

const getSessionUser = async (session, { refresh = false } = {}) => {
    if (!refresh && session.user) return session.user;
    session.user = await session.client.getCurrentUser();
    return session.user;
};

const getDeviceName = () => {
    const platform = globalThis.navigator?.userAgentData?.platform
        || globalThis.navigator?.platform
        || 'Mobile/Web';
    return `RadExam ${platform}`;
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

export const getOneDriveSyncState = async () => {
    const { config, pendingChanges, conflicts } = await getLocalSyncJournalState();
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
        hasSessionToken: Boolean(activeSession?.tokenManager?.hasValidToken()),
        cloudEncryption: activeSession?.provider?.encryptionStatus?.() || {
            enabled: Boolean(config.cloudEncryptionEnabled),
            unlocked: false,
        },
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

export const unlockOneDriveEncryption = async ({ clientId, passphrase }) => (
    runExclusive(async () => {
        const state = await getOneDriveSyncState();
        if (!state.connected) throw new Error('先にOneDriveへ接続してください。');
        const session = await authorizeSession(clientId, { interactive: true });
        await session.provider.ensureActiveSyncSpace();
        await session.provider.unlockEncryption(passphrase);
        await connectLocalSyncTracking({
            ...state.config,
            cloudEncryptionEnabled: true,
        });
        return { state: await getOneDriveSyncState() };
    })
);

export const enableOneDriveEncryption = async ({ clientId, passphrase }) => (
    runExclusive(async () => {
        const state = await getOneDriveSyncState();
        if (!state.connected) throw new Error('先にOneDriveへ接続してください。');
        const session = await authorizeSession(clientId, { interactive: true });
        const user = await getSessionUser(session);
        const { accountId, accountLabel } = verifyAccount(user, state);
        const encryption = await session.provider.prepareEncryption(passphrase);
        await session.provider.deleteAllCloudSyncData();
        await session.provider.ensureActiveSyncSpace();
        const root = await session.provider.rotateSyncSpace({ encryption });
        await disconnectLocalSyncTracking({ discardPending: true });
        await connectLocalSyncTracking({
            provider: SYNC_PROVIDERS.ONE_DRIVE,
            accountId,
            accountLabel,
            deviceName: getDeviceName(),
            cloudSyncId: root.activeSyncId,
            cloudEncryptionEnabled: true,
        });
        return { root, state: await getOneDriveSyncState() };
    })
);

const authorizeSession = async (clientId, { interactive }) => {
    if (!clientId) throw new Error('Microsoft OAuthクライアントIDが設定されていません。');
    const session = createSession(clientId);
    let token = await session.tokenManager.getAccessToken();
    if (!token) {
        if (!interactive) {
            const error = new Error('OneDriveへの再認証が必要です。');
            error.requiresReauth = true;
            throw error;
        }
        token = await session.tokenManager.requestAccessToken();
        session.user = null;
    }
    return session;
};

const accountDetails = user => ({
    accountId: user?.id,
    accountLabel: user?.mail || user?.userPrincipalName || user?.displayName || 'OneDrive',
});

const verifyAccount = (user, state) => {
    const { accountId } = accountDetails(user);
    if (!accountId) throw new Error('Microsoftアカウント情報を確認できませんでした。');
    if (state && String(accountId) !== String(state.config.accountId)) {
        throw new Error('接続済みとは別のMicrosoftアカウントです。正しいアカウントで再認証してください。');
    }
    return accountDetails(user);
};

export const connectOneDriveSync = async ({ clientId }) => (
    runExclusive(async () => {
        const session = await authorizeSession(clientId, { interactive: true });
        const [user, root] = await Promise.all([
            getSessionUser(session, { refresh: true }),
            session.provider.ensureActiveSyncSpace(),
        ]);
        const { accountId, accountLabel } = verifyAccount(user);
        await connectLocalSyncTracking({
            provider: SYNC_PROVIDERS.ONE_DRIVE,
            accountId,
            accountLabel,
            deviceName: getDeviceName(),
            cloudSyncId: root.activeSyncId,
            cloudEncryptionEnabled: Boolean(root.encryption),
        });
        return {
            result: { status: 'connected' },
            user,
            state: await getOneDriveSyncState(),
        };
    })
);

export const runOneDriveSync = async ({
    clientId,
    interactive = true,
} = {}) => (
    runExclusive(async () => {
        const state = await getOneDriveSyncState();
        if (!state.connected) throw new Error('先にOneDriveへ接続してください。');
        const session = await authorizeSession(clientId, { interactive });
        const user = await getSessionUser(session);
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
                deviceName: getDeviceName(),
                cloudSyncId: root.activeSyncId,
            });
        }
        const result = await synchronizeLocalData(session.provider);
        return { result, state: await getOneDriveSyncState() };
    })
);

const runOneDriveDirection = ({ clientId, interactive = true, action }) => (
    runExclusive(async () => {
        const state = await getOneDriveSyncState();
        if (!state.connected) throw new Error('先にOneDriveへ接続してください。');
        const session = await authorizeSession(clientId, { interactive });
        const user = await getSessionUser(session);
        const { accountId, accountLabel } = verifyAccount(user, state);
        const root = await session.provider.ensureActiveSyncSpace();
        if (state.config.cloudSyncId && state.config.cloudSyncId !== root.activeSyncId) {
            const error = new Error('クラウド同期が別の端末でリセットされました。この端末を再接続してください。');
            error.code = 'CLOUD_SYNC_RESET';
            throw error;
        }
        if (!state.config.bootstrapCompleted) {
            session.provider.reportProgress({ phase: 'preparing-local-data' });
            await initializeLocalSyncTracking({
                provider: SYNC_PROVIDERS.ONE_DRIVE,
                accountId,
                accountLabel,
                deviceName: getDeviceName(),
                cloudSyncId: root.activeSyncId,
            });
        }
        const result = await action(session.provider);
        return { result, state: await getOneDriveSyncState() };
    })
);

export const checkOneDriveUpdates = options => runOneDriveDirection({
    ...options,
    action: checkLocalDataSyncUpdates,
});
export const pullOneDriveUpdates = options => runOneDriveDirection({
    ...options,
    action: pullLocalDataFromCloud,
});
export const pushOneDriveChanges = options => runOneDriveDirection({
    ...options,
    action: pushLocalDataToCloud,
});

export const resolveOneDriveSyncConflict = async ({
    clientId,
    conflictId,
    conflictIds,
    resolution,
} = {}) => (
    runExclusive(async () => {
        const state = await getOneDriveSyncState();
        if (!state.connected) throw new Error('先にOneDriveへ接続してください。');
        const session = await authorizeSession(clientId, { interactive: true });
        const user = await getSessionUser(session);
        verifyAccount(user, state);
        const root = await session.provider.ensureActiveSyncSpace();
        if (state.config.cloudSyncId && state.config.cloudSyncId !== root.activeSyncId) {
            throw new Error('クラウド同期が別の端末でリセットされました。この端末を再接続してください。');
        }
        const targetIds = conflictIds || [conflictId];
        const resolvedItems = await resolveLocalDataSyncConflicts({
            conflictIds: targetIds,
            resolution,
            resolveBlob: ref => session.provider.downloadBlob(ref.contentHash),
        });
        const result = await pushLocalDataToCloud(session.provider);
        return {
            resolved: conflictIds ? resolvedItems : resolvedItems[0],
            resolvedCount: resolvedItems.length,
            result,
            state: await getOneDriveSyncState(),
        };
    })
);

export const resetOneDriveSync = async ({
    clientId,
    hard = false,
} = {}) => (
    runExclusive(async () => {
        const state = await getOneDriveSyncState();
        if (!state.connected) throw new Error('先にOneDriveへ接続してください。');
        const session = await authorizeSession(clientId, { interactive: true });
        const user = await getSessionUser(session);
        const { accountId, accountLabel } = verifyAccount(user, state);
        let deletedFiles = 0;
        const preservedEncryption = session.provider.prepareRotationEncryption();
        if (hard) {
            ({ deletedFiles } = await session.provider.deleteAllCloudSyncData());
            await session.provider.ensureActiveSyncSpace();
        }
        const root = await session.provider.rotateSyncSpace({ encryption: preservedEncryption });
        await disconnectLocalSyncTracking({ discardPending: true });
        await connectLocalSyncTracking({
            provider: SYNC_PROVIDERS.ONE_DRIVE,
            accountId,
            accountLabel,
            deviceName: getDeviceName(),
            cloudSyncId: root.activeSyncId,
            cloudEncryptionEnabled: Boolean(root.encryption),
        });
        return { deletedFiles, root, state: await getOneDriveSyncState() };
    })
);

export const disconnectOneDriveSync = async ({ discardPending = false } = {}) => {
    if (activeSync) await activeSync.catch(() => {});
    const config = await disconnectLocalSyncTracking({ discardPending });
    activeSession?.tokenManager?.clear();
    activeSession = null;
    return { config, state: await getOneDriveSyncState() };
};

export const runOneDriveBackgroundSync = async ({ clientId } = {}) => {
    const state = await getOneDriveSyncState();
    if (!state.connected) return { status: 'skipped', reason: 'not-connected' };
    if (globalThis.navigator?.onLine === false) {
        return { status: 'skipped', reason: 'offline' };
    }
    if (!activeSession?.tokenManager?.hasValidToken()) {
        return { status: 'skipped', reason: 'reauth-required' };
    }
    if (state.cloudEncryption.enabled && !state.cloudEncryption.unlocked) {
        return { status: 'skipped', reason: 'encryption-locked' };
    }
    const response = await checkOneDriveUpdates({ clientId, interactive: false });
    return { status: 'completed', ...response };
};
