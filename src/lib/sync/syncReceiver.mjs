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

const parseBaseGeneration = baseVersion => {
    const match = /^generation:(\d+)$/.exec(String(baseVersion || ''));
    return match ? Number(match[1]) : 0;
};

const conflictEntityKey = change => (
    `${change.entityType}:${String(change.entityId)}`
);

const removeAcknowledgedPendingChange = (context, changeId) => {
    if (!context?.pendingLocalChanges) return null;
    const removed = context.pendingLocalChanges.find(
        change => change.changeId === changeId
    );
    context.pendingLocalChanges = context.pendingLocalChanges.filter(
        change => change.changeId !== changeId
    );
    if (removed && context.pendingChangesByEntity) {
        const key = conflictEntityKey(removed);
        const remaining = (context.pendingChangesByEntity.get(key) || []).filter(
            change => change.changeId !== changeId
        );
        if (remaining.length > 0) context.pendingChangesByEntity.set(key, remaining);
        else context.pendingChangesByEntity.delete(key);
    }
    return removed || null;
};

export const processIncomingSyncChange = async ({
    change,
    journal,
    dataStore,
    resolveBlob,
    context = null,
    deferAppliedMark = false,
}) => {
    if (!journal || !dataStore?.applyChange) {
        throw new Error('受信変更の処理にはjournalとdataStoreが必要です。');
    }
    const normalizedChange = validateIncomingSyncChange(change);

    const previouslyApplied = context?.appliedChangeIds
        ? context.appliedChangeIds.has(normalizedChange.changeId)
        : await journal.hasAppliedChange(normalizedChange.changeId);
    if (previouslyApplied) {
        if (!deferAppliedMark) {
            await journal.acknowledgeChanges([normalizedChange.changeId]);
        }
        const pendingChange = removeAcknowledgedPendingChange(
            context,
            normalizedChange.changeId
        );
        return { status: 'duplicate', change: normalizedChange, pendingChange };
    }

    const config = context?.config || await journal.getConfig();
    if (config.deviceId && normalizedChange.deviceId === config.deviceId) {
        if (!deferAppliedMark) {
            await journal.markChangeApplied(normalizedChange);
            await journal.acknowledgeChanges([normalizedChange.changeId]);
        }
        const pendingChange = removeAcknowledgedPendingChange(
            context,
            normalizedChange.changeId
        );
        return { status: 'acknowledged', change: normalizedChange, pendingChange };
    }

    if (context?.conflictsByEntity) {
        const unresolvedConflict = context.conflictsByEntity.get(
            conflictEntityKey(normalizedChange)
        );
        if (unresolvedConflict) {
            return {
                status: 'conflict',
                change: normalizedChange,
                conflict: unresolvedConflict,
            };
        }
    } else if (typeof journal.listConflicts === 'function') {
        const unresolvedConflict = (await journal.listConflicts()).find(conflict => (
            conflict.entityType === normalizedChange.entityType
            && String(conflict.entityId) === String(normalizedChange.entityId)
        ));
        if (unresolvedConflict) {
            return {
                status: 'conflict',
                change: normalizedChange,
                conflict: unresolvedConflict,
            };
        }
    }

    const entityKey = conflictEntityKey(normalizedChange);
    const pendingLocalChanges = context?.pendingChangesByEntity
        ? (context.pendingChangesByEntity.get(entityKey) || [])
        : context?.pendingLocalChanges || await journal.listPendingChanges();
    const baseGeneration = parseBaseGeneration(normalizedChange.baseVersion);
    const sentLocalChanges = context?.sentChangesByEntity
        ? (context.sentChangesByEntity.get(entityKey) || []).filter(change => (
            Number(change.committedGeneration) > baseGeneration
        ))
        : typeof journal.listSentChangesAfterGeneration === 'function'
            ? await journal.listSentChangesAfterGeneration(baseGeneration)
            : [];
    const conflict = detectSyncConflict({
        remoteChange: normalizedChange,
        pendingLocalChanges: [...pendingLocalChanges, ...sentLocalChanges],
    });
    if (conflict) {
        const storedConflict = await journal.recordConflict(conflict);
        context?.conflictsByEntity?.set(
            conflictEntityKey(normalizedChange),
            storedConflict
        );
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
    if (!deferAppliedMark) await journal.markChangeApplied(normalizedChange);
    return { status: 'applied', change: normalizedChange };
};
