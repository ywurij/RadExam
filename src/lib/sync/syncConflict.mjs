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

const readPath = (value, path) => String(path).split('.').reduce(
    (current, part) => current?.[part],
    value
);

const valuesEqual = (left, right) => {
    if (Object.is(left, right)) return true;
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
    if (Array.isArray(left) || Array.isArray(right)) {
        return Array.isArray(left)
            && Array.isArray(right)
            && left.length === right.length
            && left.every((value, index) => valuesEqual(value, right[index]));
    }
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length
        && leftKeys.every((key, index) => (
            key === rightKeys[index]
            && valuesEqual(left[key], right[key])
        ));
};

const changeValueAtPath = (change, path) => {
    const isUnset = (change?.unsetFields || []).some(field => (
        String(path) === String(field) || String(path).startsWith(`${field}.`)
    ));
    return isUnset
        ? { kind: 'unset' }
        : { kind: 'value', value: readPath(change?.payload, path) };
};

const changesAgreeOnFields = (left, right, leftField, rightField) => {
    const leftDeleted = left?.operation === SYNC_OPERATIONS.DELETE;
    const rightDeleted = right?.operation === SYNC_OPERATIONS.DELETE;
    if (leftDeleted || rightDeleted) return leftDeleted && rightDeleted;
    const path = String(leftField).length >= String(rightField).length
        ? String(leftField)
        : String(rightField);
    const leftValue = changeValueAtPath(left, path);
    const rightValue = changeValueAtPath(right, path);
    return leftValue.kind === rightValue.kind
        && (leftValue.kind === 'unset' || valuesEqual(leftValue.value, rightValue.value));
};

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
        const localFields = [
            ...(localChange.changedFields || []),
            ...(localChange.unsetFields || []),
        ];
        const remoteFields = [
            ...(remoteChange.changedFields || []),
            ...(remoteChange.unsetFields || []),
        ];
        const overlaps = [];
        if (deletionConflict) {
            if (!changesAgreeOnFields(localChange, remoteChange, '*', '*')) overlaps.push('*');
        } else {
            for (const localField of localFields) {
                for (const remoteField of remoteFields) {
                    if (
                        fieldsOverlap(String(localField), String(remoteField))
                        && !changesAgreeOnFields(
                            localChange,
                            remoteChange,
                            localField,
                            remoteField
                        )
                    ) {
                        overlaps.push(
                            String(localField) === String(remoteField)
                                ? String(localField)
                                : `${localField} ↔ ${remoteField}`
                        );
                    }
                }
            }
        }
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
