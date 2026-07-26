import {
    disconnectLocalSyncTracking,
    initializeLocalSyncTracking,
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

const createSession = clientId => {
    if (activeSession?.clientId === clientId) return activeSession;
    const tokenManager = new GoogleDriveWebTokenManager({ clientId });
    const client = new GoogleDriveAppDataClient({
        getAccessToken: () => tokenManager.getAccessToken(),
    });
    activeSession = {
        clientId,
        tokenManager,
        client,
        provider: new GoogleDriveSyncProvider({ client }),
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
    return {
        config,
        connected: Boolean(
            config.enabled
            && config.provider === SYNC_PROVIDERS.GOOGLE_DRIVE
            && config.bootstrapCompleted
        ),
        pendingCount: pendingChanges.length,
        conflictCount: conflicts.length,
        hasSessionToken: Boolean(activeSession?.tokenManager?.hasValidToken()),
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

        await initializeLocalSyncTracking({
            provider: SYNC_PROVIDERS.GOOGLE_DRIVE,
            accountId,
            accountLabel,
            deviceName: getDeviceName(),
        });
        const result = await synchronizeLocalData(session.provider);
        return {
            result,
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
        const result = await synchronizeLocalData(session.provider);
        return {
            result,
            state: await getGoogleDriveSyncState(),
        };
    });
};

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
