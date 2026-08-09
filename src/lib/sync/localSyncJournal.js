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
const reconcileEquivalentConflicts = async conflicts => {
    const equivalent = [];
    for (const conflict of conflicts) {
        const stillConflicts = detectSyncConflict({
            remoteChange: conflict.remoteChange,
            pendingLocalChanges: conflict.localChanges || [],
            detectedAt: conflict.detectedAt,
        });
        if (stillConflicts) continue;
        equivalent.push(conflict);
    }
    if (equivalent.length === 0) return new Set();
    await localSyncJournal.markChangesApplied(
        equivalent.map(conflict => conflict.remoteChange)
    );
    await localSyncJournal.discardChanges(
        equivalent.flatMap(conflict => conflict.localChangeIds || [])
    );
    for (const conflict of equivalent) {
        await localSyncJournal.resolveConflict(conflict.conflictId, {
            choice: 'equivalent-values',
            automatic: true,
        });
    }
    return new Set(equivalent.map(conflict => conflict.conflictId));
};
export const reconcileEquivalentLocalSyncConflicts = async () => {
    const conflicts = await localSyncJournal.listConflicts();
    return (await reconcileEquivalentConflicts(conflicts)).size;
};
export const listLocalSyncConflicts = async options => {
    const conflicts = await localSyncJournal.listConflicts(options);
    if (options?.status && options.status !== 'pending') return conflicts;
    const resolvedIds = await reconcileEquivalentConflicts(conflicts);
    return resolvedIds.size > 0
        ? conflicts.filter(conflict => !resolvedIds.has(conflict.conflictId))
        : conflicts;
};
export const getLocalSyncJournalState = async () => {
    const [config, pullState] = await Promise.all([
        localSyncJournal.getConfig(),
        localSyncJournal.readPullState(),
    ]);
    const resolvedIds = await reconcileEquivalentConflicts(
        pullState.unresolvedConflicts
    );
    const conflicts = resolvedIds.size > 0
        ? pullState.unresolvedConflicts.filter(
            conflict => !resolvedIds.has(conflict.conflictId)
        )
        : pullState.unresolvedConflicts;
    return {
        config,
        pendingChanges: pullState.pendingLocalChanges,
        conflicts,
    };
};
export const resolveLocalSyncConflict = (conflictId, resolution) => (
    localSyncJournal.resolveConflict(conflictId, resolution)
);
export const listLocalSyncTombstones = () => localSyncJournal.listTombstones();
export const markLocalSyncReconciliationRequired = reason => (
    localSyncJournal.markReconciliationRequired(reason)
);
