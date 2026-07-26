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
import { SYNC_PROVIDERS } from './syncProtocol.mjs';

let activeSession = null;
let activeSync = null;

const getBridge = () => globalThis.window?.radexamCloudSync?.googleDrive || null;

export const isGoogleDriveDesktopBridgeAvailable = () => Boolean(getBridge());

const createSession = clientId => {
    if (activeSession?.clientId === clientId) return activeSession;
    const bridge = getBridge();
    if (!bridge) throw new Error('Mac/PC版アプリのGoogle認証機能を利用できません。');
    const client = new GoogleDriveAppDataClient({
        getAccessToken: () => bridge.getAccessToken(clientId),
    });
    activeSession = {
        clientId,
        bridge,
        client,
        provider: new GoogleDriveSyncProvider({ client }),
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

export const getGoogleDriveDesktopSyncState = async ({ clientId } = {}) => {
    const bridge = getBridge();
    const [config, pendingChanges, conflicts, credentialStatus] = await Promise.all([
        getLocalSyncJournalConfig(),
        listPendingLocalSyncChanges(),
        listLocalSyncConflicts(),
        bridge && clientId
            ? bridge.getStatus(clientId).catch(() => null)
            : Promise.resolve(null),
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
        hasSessionToken: Boolean(credentialStatus?.hasCredentials),
        bridgeAvailable: Boolean(bridge),
        encryptionAvailable: credentialStatus?.encryptionAvailable !== false,
    };
};

export const connectGoogleDriveDesktopSync = async ({ clientId }) => (
    runExclusive(async () => {
        if (!clientId) throw new Error('デスクトップ版のGoogle OAuthクライアントIDが設定されていません。');
        const session = createSession(clientId);
        await session.bridge.authorize(clientId);
        const user = await session.client.getCurrentUser();
        const accountId = user?.permissionId || user?.emailAddress;
        if (!accountId) throw new Error('Google Driveのアカウント情報を確認できませんでした。');
        const accountLabel = user?.emailAddress || user?.displayName || 'Google Drive';

        await initializeLocalSyncTracking({
            provider: SYNC_PROVIDERS.GOOGLE_DRIVE,
            accountId,
            accountLabel,
            deviceName: `RadExam ${globalThis.navigator?.platform || 'Mac/PC'}`,
        });
        const result = await synchronizeLocalData(session.provider);
        return {
            result,
            user,
            state: await getGoogleDriveDesktopSyncState({ clientId }),
        };
    })
);

export const runGoogleDriveDesktopSync = async ({
    clientId,
    interactive = true,
} = {}) => (
    runExclusive(async () => {
        const state = await getGoogleDriveDesktopSyncState({ clientId });
        if (!state.connected) throw new Error('先にGoogle Driveへ接続してください。');
        const session = createSession(clientId);
        if (!state.hasSessionToken) {
            if (!interactive) {
                const error = new Error('Google Driveへの再認証が必要です。');
                error.requiresReauth = true;
                throw error;
            }
            await session.bridge.authorize(clientId);
        }
        const user = await session.client.getCurrentUser();
        const accountId = user?.permissionId || user?.emailAddress;
        if (String(accountId) !== String(state.config.accountId)) {
            throw new Error('接続済みとは別のGoogleアカウントです。接続を解除してから再接続してください。');
        }
        const result = await synchronizeLocalData(session.provider);
        return {
            result,
            state: await getGoogleDriveDesktopSyncState({ clientId }),
        };
    })
);

export const disconnectGoogleDriveDesktopSync = async ({
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
        state: await getGoogleDriveDesktopSyncState({ clientId }),
    };
};

export const runGoogleDriveDesktopBackgroundSync = async ({ clientId } = {}) => {
    const state = await getGoogleDriveDesktopSyncState({ clientId });
    if (!state.connected) return { status: 'skipped', reason: 'not-connected' };
    if (!state.bridgeAvailable) return { status: 'skipped', reason: 'bridge-unavailable' };
    if (!state.hasSessionToken) return { status: 'skipped', reason: 'reauth-required' };
    if (globalThis.navigator?.onLine === false) {
        return { status: 'skipped', reason: 'offline' };
    }
    const response = await runGoogleDriveDesktopSync({
        clientId,
        interactive: false,
    });
    return { status: 'completed', ...response };
};
