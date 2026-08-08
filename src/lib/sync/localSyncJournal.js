import localforage from 'localforage';
import { SyncJournal } from './syncJournal.mjs';
import { detectSyncConflict } from './syncConflict.mjs';

const syncJournalStore = localforage.createInstance({
    name: 'RadTestLocal',
    storeName: 'sync_journal',
    description: 'クラウドへ未送信の変更、削除通知、端末同期状態を保存するストア',
});

export const localSyncJournal = new SyncJournal(syncJournalStore);

export const configureLocalSyncJournal = updates => localSyncJournal.configure(updates);
export const disconnectLocalSyncJournal = options => localSyncJournal.disconnect(options);
export const getLocalSyncJournalConfig = () => localSyncJournal.getConfig();
export const recordLocalSyncChanges = changes => localSyncJournal.recordChanges(changes);
export const listPendingLocalSyncChanges = () => localSyncJournal.listPendingChanges();
export const acknowledgeLocalSyncChanges = (changeIds, options) => (
    localSyncJournal.acknowledgeChanges(changeIds, options)
);
export const hasAppliedLocalSyncChange = changeId => localSyncJournal.hasAppliedChange(changeId);
export const markLocalSyncChangeApplied = (change, appliedAt) => (
    localSyncJournal.markChangeApplied(change, appliedAt)
);
export const checkAndStoreLocalSyncConflict = async remoteChange => {
    const pendingLocalChanges = await localSyncJournal.listPendingChanges();
    const conflict = detectSyncConflict({ remoteChange, pendingLocalChanges });
    if (!conflict) return null;
    return localSyncJournal.recordConflict(conflict);
};
export const reconcileEquivalentLocalSyncConflicts = async () => {
    const conflicts = await localSyncJournal.listConflicts();
    let resolvedCount = 0;
    for (const conflict of conflicts) {
        const stillConflicts = detectSyncConflict({
            remoteChange: conflict.remoteChange,
            pendingLocalChanges: conflict.localChanges || [],
            detectedAt: conflict.detectedAt,
        });
        if (stillConflicts) continue;
        await localSyncJournal.markChangeApplied(conflict.remoteChange);
        await localSyncJournal.discardChanges(conflict.localChangeIds || []);
        await localSyncJournal.resolveConflict(conflict.conflictId, {
            choice: 'equivalent-values',
            automatic: true,
        });
        resolvedCount += 1;
    }
    return resolvedCount;
};
export const listLocalSyncConflicts = async options => {
    if (!options?.status || options.status === 'pending') {
        await reconcileEquivalentLocalSyncConflicts();
    }
    return localSyncJournal.listConflicts(options);
};
export const resolveLocalSyncConflict = (conflictId, resolution) => (
    localSyncJournal.resolveConflict(conflictId, resolution)
);
export const listLocalSyncTombstones = () => localSyncJournal.listTombstones();
export const markLocalSyncReconciliationRequired = reason => (
    localSyncJournal.markReconciliationRequired(reason)
);
