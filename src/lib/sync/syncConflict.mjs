import { SYNC_OPERATIONS } from './syncProtocol.mjs';

const fieldsOverlap = (left, right) => (
    left === right
    || left.startsWith(`${right}.`)
    || right.startsWith(`${left}.`)
);

const uniqueSortedStrings = values => (
    [...new Set((values || []).map(String).filter(Boolean))].sort()
);

const changesTargetSameEntity = (left, right) => (
    left?.entityType === right?.entityType
    && String(left?.entityId) === String(right?.entityId)
);

export const findOverlappingSyncFields = (leftFields = [], rightFields = []) => {
    const overlaps = [];
    for (const left of leftFields) {
        for (const right of rightFields) {
            if (fieldsOverlap(String(left), String(right))) {
                overlaps.push(String(left) === String(right) ? String(left) : `${left} ↔ ${right}`);
            }
        }
    }
    return uniqueSortedStrings(overlaps);
};

export const detectSyncConflict = ({
    remoteChange,
    pendingLocalChanges = [],
    detectedAt = new Date().toISOString(),
}) => {
    if (!remoteChange?.changeId) {
        throw new Error('競合確認にはremoteChange.changeIdが必要です。');
    }

    const relevantLocalChanges = pendingLocalChanges.filter(localChange => (
        changesTargetSameEntity(localChange, remoteChange)
        && localChange.deviceId !== remoteChange.deviceId
    ));
    if (relevantLocalChanges.length === 0) return null;

    const conflictingLocalChanges = [];
    const conflictingFields = [];
    let reason = 'same-field-edited';

    for (const localChange of relevantLocalChanges) {
        const deletionConflict = (
            localChange.operation === SYNC_OPERATIONS.DELETE
            || remoteChange.operation === SYNC_OPERATIONS.DELETE
        );
        const overlaps = deletionConflict
            ? ['*']
            : findOverlappingSyncFields(
                [...(localChange.changedFields || []), ...(localChange.unsetFields || [])],
                [...(remoteChange.changedFields || []), ...(remoteChange.unsetFields || [])]
            );
        if (overlaps.length === 0) continue;
        if (deletionConflict) reason = 'delete-versus-change';
        conflictingLocalChanges.push(localChange);
        conflictingFields.push(...overlaps);
    }

    if (conflictingLocalChanges.length === 0) return null;

    const localChangeIds = uniqueSortedStrings(
        conflictingLocalChanges.map(change => change.changeId)
    );
    return {
        conflictId: [
            remoteChange.entityType,
            remoteChange.entityId,
            remoteChange.changeId,
            ...localChangeIds,
        ].map(encodeURIComponent).join(':'),
        status: 'pending',
        reason,
        entityType: remoteChange.entityType,
        entityId: String(remoteChange.entityId),
        conflictingFields: uniqueSortedStrings(conflictingFields),
        localChangeIds,
        localChanges: conflictingLocalChanges,
        remoteChange,
        detectedAt,
    };
};

export const canApplyRemoteChangeAutomatically = input => (
    detectSyncConflict(input) === null
);
