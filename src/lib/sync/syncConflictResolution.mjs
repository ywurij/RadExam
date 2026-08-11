import {
    findOverlappingSyncFields,
} from './syncConflict.mjs';
import { SYNC_OPERATIONS } from './syncProtocol.mjs';

export const SYNC_CONFLICT_RESOLUTIONS = Object.freeze({
    KEEP_LOCAL: 'keep-local',
    KEEP_CLOUD: 'keep-cloud',
});

const changeFields = change => [
    ...(change?.changedFields || []),
    ...(change?.unsetFields || []),
];

const hasNonConflictingLocalFields = conflict => {
    const remote = conflict.remoteChange;
    if (
        remote?.operation === SYNC_OPERATIONS.DELETE
        || (conflict.localChanges || []).some(
            change => change.operation === SYNC_OPERATIONS.DELETE
        )
    ) {
        return false;
    }
    const remoteFields = changeFields(remote);
    return (conflict.localChanges || []).some(localChange => (
        changeFields(localChange).some(localField => (
            findOverlappingSyncFields([localField], remoteFields).length === 0
        ))
    ));
};

const resolveRemoteBlob = async (change, resolveBlob) => {
    if (change?.operation === SYNC_OPERATIONS.DELETE) return null;
    const blobRef = (change?.blobRefs || []).find(ref => (
        ref?.kind === change.entityType
        && String(ref?.localKey) === String(change.entityId)
    ));
    if (!blobRef) return null;
    if (typeof resolveBlob !== 'function') {
        throw new Error('クラウド側のファイルを取得できません。');
    }
    const blob = await resolveBlob(blobRef, change);
    if (!blob) throw new Error('クラウド側のファイルが見つかりません。');
    return blob;
};

export const resolveStoredSyncConflict = async ({
    conflictId,
    resolution,
    journal,
    dataStore,
    buildLocalResolutionChange,
    resolveBlob,
}) => {
    if (!Object.values(SYNC_CONFLICT_RESOLUTIONS).includes(resolution)) {
        throw new Error(`未対応の競合解決方法です: ${resolution || '未指定'}`);
    }
    if (!journal || !dataStore?.applyChange) {
        throw new Error('競合解決に必要なローカルデータ機能がありません。');
    }
    const conflict = (await journal.listConflicts()).find(
        item => String(item.conflictId) === String(conflictId)
    );
    if (!conflict) throw new Error('解決対象の競合が見つかりません。');

    const config = await journal.getConfig();
    const baseVersion = `generation:${Math.max(
        Number(config.lastPulledGeneration) || 0,
        Number(config.lastPushedGeneration) || 0
    )}`;
    const shouldPublishLocal = (
        resolution === SYNC_CONFLICT_RESOLUTIONS.KEEP_LOCAL
        || hasNonConflictingLocalFields(conflict)
    );

    let resolutionChange = null;
    if (resolution === SYNC_CONFLICT_RESOLUTIONS.KEEP_LOCAL) {
        resolutionChange = await buildLocalResolutionChange(conflict, { baseVersion });
    } else {
        const blob = await resolveRemoteBlob(conflict.remoteChange, resolveBlob);
        await dataStore.applyChange(conflict.remoteChange, { blob });
        if (shouldPublishLocal) {
            resolutionChange = await buildLocalResolutionChange(conflict, { baseVersion });
        }
    }

    await journal.markChangeApplied(conflict.remoteChange);
    await journal.discardChanges(conflict.localChangeIds);
    const recorded = resolutionChange
        ? await journal.recordChanges([resolutionChange])
        : [];
    const resolved = await journal.resolveConflict(conflict.conflictId, {
        choice: resolution,
        resolutionChangeIds: recorded.map(change => change.changeId),
    });
    return { conflict: resolved, recordedChanges: recorded };
};
