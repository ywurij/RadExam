import { detectSyncConflict } from './syncConflict.mjs';
import {
    SYNC_ENTITY_TYPES,
    SYNC_OPERATIONS,
    validateIncomingSyncChange,
} from './syncProtocol.mjs';

const BLOB_ENTITY_TYPES = new Set([
    SYNC_ENTITY_TYPES.IMAGE,
    SYNC_ENTITY_TYPES.PDF,
]);

const findPrimaryBlobRef = change => (
    (change.blobRefs || []).find(ref => (
        ref?.kind === change.entityType
        && String(ref?.localKey) === String(change.entityId)
    ))
    || null
);

export const processIncomingSyncChange = async ({
    change,
    journal,
    dataStore,
    resolveBlob,
}) => {
    if (!journal || !dataStore?.applyChange) {
        throw new Error('受信変更の処理にはjournalとdataStoreが必要です。');
    }
    const normalizedChange = validateIncomingSyncChange(change);

    if (await journal.hasAppliedChange(normalizedChange.changeId)) {
        await journal.acknowledgeChanges([normalizedChange.changeId]);
        return { status: 'duplicate', change: normalizedChange };
    }

    const config = await journal.getConfig();
    if (config.deviceId && normalizedChange.deviceId === config.deviceId) {
        await journal.markChangeApplied(normalizedChange);
        await journal.acknowledgeChanges([normalizedChange.changeId]);
        return { status: 'acknowledged', change: normalizedChange };
    }

    const pendingLocalChanges = await journal.listPendingChanges();
    const conflict = detectSyncConflict({
        remoteChange: normalizedChange,
        pendingLocalChanges,
    });
    if (conflict) {
        const storedConflict = await journal.recordConflict(conflict);
        return {
            status: 'conflict',
            change: normalizedChange,
            conflict: storedConflict,
        };
    }

    let blob = null;
    if (
        normalizedChange.operation === SYNC_OPERATIONS.UPSERT
        && BLOB_ENTITY_TYPES.has(normalizedChange.entityType)
    ) {
        const blobRef = findPrimaryBlobRef(normalizedChange);
        if (!blobRef?.contentHash) {
            throw new Error(`同期ファイルの内容ハッシュがありません: ${normalizedChange.entityId}`);
        }
        if (typeof resolveBlob !== 'function') {
            return {
                status: 'needs-blob',
                change: normalizedChange,
                blobRef,
            };
        }
        blob = await resolveBlob(blobRef, normalizedChange);
        if (!blob) {
            return {
                status: 'needs-blob',
                change: normalizedChange,
                blobRef,
            };
        }
    }

    await dataStore.applyChange(normalizedChange, { blob });
    await journal.markChangeApplied(normalizedChange);
    return { status: 'applied', change: normalizedChange };
};
