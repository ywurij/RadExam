import { SYNC_SCHEMA_VERSION } from './syncProtocol.mjs';

export const SYNC_MANIFEST_VERSION = 1;
export const MAX_CHANGES_PER_BATCH = 100;
export const MAX_CHANGES_PER_BULK_PACKAGE = 2000;
export const SYNC_BATCH_FORMATS = Object.freeze({
    STANDARD: 'change-batch',
    BULK: 'bulk-delta',
});

export class SyncManifestConflictError extends Error {
    constructor(message = 'manifestが別端末で更新されました。') {
        super(message);
        this.name = 'SyncManifestConflictError';
        this.code = 'SYNC_MANIFEST_CONFLICT';
    }
}

const cloneValue = value => {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
};

export const createEmptySyncManifest = ({
    createdAt = new Date().toISOString(),
} = {}) => ({
    manifestVersion: SYNC_MANIFEST_VERSION,
    syncSchemaVersion: SYNC_SCHEMA_VERSION,
    generation: 0,
    batches: [],
    latestSnapshot: null,
    createdAt,
    updatedAt: createdAt,
});

const validateBatchDescriptor = batch => {
    const format = batch?.format || SYNC_BATCH_FORMATS.STANDARD;
    const maximumChanges = format === SYNC_BATCH_FORMATS.BULK
        ? MAX_CHANGES_PER_BULK_PACKAGE
        : MAX_CHANGES_PER_BATCH;
    if (
        !batch?.batchId
        || !batch?.deviceId
        || !batch?.objectKey
        || !Number.isSafeInteger(batch?.generation)
        || batch.generation < 1
        || !Number.isSafeInteger(batch?.fromSequence)
        || !Number.isSafeInteger(batch?.toSequence)
        || batch.fromSequence < 1
        || batch.toSequence < batch.fromSequence
        || !Number.isSafeInteger(batch?.changeCount)
        || batch.changeCount < 1
        || batch.changeCount > maximumChanges
        || !Object.values(SYNC_BATCH_FORMATS).includes(format)
    ) {
        throw new Error(`manifest内の変更バッチが不正です: ${batch?.batchId || 'IDなし'}`);
    }
    return batch;
};

const validateSnapshotDescriptor = snapshot => {
    if (snapshot == null) return null;
    if (
        !snapshot?.snapshotId
        || !snapshot?.deviceId
        || !snapshot?.objectKey
        || !Number.isSafeInteger(snapshot?.generation)
        || snapshot.generation < 0
        || !Number.isSafeInteger(snapshot?.cutoffSequence)
        || snapshot.cutoffSequence < 0
        || !Number.isSafeInteger(snapshot?.byteSize)
        || snapshot.byteSize < 0
        || !String(snapshot?.contentHash || '').startsWith('sha256:')
        || !snapshot?.createdAt
    ) {
        throw new Error(`manifest内のスナップショットが不正です: ${snapshot?.snapshotId || 'IDなし'}`);
    }
    return snapshot;
};

export const validateSyncManifest = manifest => {
    if (!manifest) return createEmptySyncManifest();
    if (manifest.manifestVersion !== SYNC_MANIFEST_VERSION) {
        throw new Error(`未対応のmanifest形式です: ${manifest.manifestVersion}`);
    }
    if (manifest.syncSchemaVersion !== SYNC_SCHEMA_VERSION) {
        throw new Error(`未対応の同期スキーマです: ${manifest.syncSchemaVersion}`);
    }
    if (!Number.isSafeInteger(manifest.generation) || manifest.generation < 0) {
        throw new Error('manifestのgenerationが不正です。');
    }
    if (!Array.isArray(manifest.batches)) {
        throw new Error('manifestのbatchesが不正です。');
    }

    const batchIds = new Set();
    let previousGeneration = 0;
    for (const batch of manifest.batches) {
        validateBatchDescriptor(batch);
        if (batchIds.has(batch.batchId)) {
            throw new Error(`manifestに重複したバッチがあります: ${batch.batchId}`);
        }
        if (batch.generation <= previousGeneration) {
            throw new Error('manifestのバッチ順序が不正です。');
        }
        batchIds.add(batch.batchId);
        previousGeneration = batch.generation;
    }
    if (previousGeneration > manifest.generation) {
        throw new Error('manifestのgenerationより新しいバッチがあります。');
    }
    validateSnapshotDescriptor(manifest.latestSnapshot);
    if (
        manifest.latestSnapshot
        && manifest.latestSnapshot.generation > manifest.generation
    ) {
        throw new Error('manifestより新しいスナップショットが登録されています。');
    }
    return cloneValue(manifest);
};

export const setLatestSyncSnapshot = (
    manifest,
    snapshot,
    { updatedAt = new Date().toISOString() } = {}
) => {
    const current = validateSyncManifest(manifest);
    const nextSnapshot = validateSnapshotDescriptor(cloneValue(snapshot));
    if (nextSnapshot.generation !== current.generation) {
        throw new Error('スナップショットの世代がmanifestと一致しません。');
    }
    if (current.latestSnapshot?.snapshotId === nextSnapshot.snapshotId) {
        return { manifest: current, snapshot: current.latestSnapshot, updated: false };
    }
    const nextManifest = {
        ...current,
        latestSnapshot: nextSnapshot,
        updatedAt,
    };
    return { manifest: nextManifest, snapshot: nextSnapshot, updated: true };
};

export const appendSyncManifestBatch = (
    manifest,
    batch,
    { updatedAt = new Date().toISOString() } = {}
) => {
    const current = validateSyncManifest(manifest);
    const existing = current.batches.find(item => item.batchId === batch?.batchId);
    if (existing) {
        const comparableFields = [
            'deviceId',
            'objectKey',
            'fromSequence',
            'toSequence',
            'changeCount',
            'format',
        ];
        if (comparableFields.some(field => (
            field === 'format'
                ? (existing[field] || SYNC_BATCH_FORMATS.STANDARD)
                    !== (batch[field] || SYNC_BATCH_FORMATS.STANDARD)
                : existing[field] !== batch[field]
        ))) {
            throw new Error(`同じIDで内容の異なる変更バッチがあります: ${batch.batchId}`);
        }
        return { manifest: current, batch: existing, appended: false };
    }

    const nextBatch = validateBatchDescriptor({
        ...cloneValue(batch),
        generation: current.generation + 1,
    });
    const nextManifest = {
        ...current,
        generation: nextBatch.generation,
        batches: [...current.batches, nextBatch],
        updatedAt,
    };
    return { manifest: nextManifest, batch: nextBatch, appended: true };
};

export const buildSyncChangeBatch = ({
    batchId,
    deviceId,
    changes,
    createdAt = new Date().toISOString(),
}) => {
    if (!batchId || !deviceId || !Array.isArray(changes) || changes.length === 0) {
        throw new Error('変更バッチにはbatchId、deviceId、changesが必要です。');
    }
    if (changes.length > MAX_CHANGES_PER_BATCH) {
        throw new Error(`1バッチは${MAX_CHANGES_PER_BATCH}変更までです。`);
    }
    const sequences = changes.map(change => change.sequence);
    if (changes.some(change => change.deviceId !== deviceId)) {
        throw new Error('1つの変更バッチに複数端末の変更は保存できません。');
    }
    return {
        batchVersion: 1,
        format: SYNC_BATCH_FORMATS.STANDARD,
        batchId: String(batchId),
        deviceId: String(deviceId),
        fromSequence: Math.min(...sequences),
        toSequence: Math.max(...sequences),
        changeCount: changes.length,
        createdAt,
        changes: cloneValue(changes),
    };
};

export const buildSyncBulkChangePackage = ({
    batchId,
    deviceId,
    changes,
    createdAt = new Date().toISOString(),
}) => {
    if (!batchId || !deviceId || !Array.isArray(changes) || changes.length === 0) {
        throw new Error('まとめ差分にはbatchId、deviceId、changesが必要です。');
    }
    if (changes.length > MAX_CHANGES_PER_BULK_PACKAGE) {
        throw new Error(`1つのまとめ差分は${MAX_CHANGES_PER_BULK_PACKAGE}変更までです。`);
    }
    const sequences = changes.map(change => change.sequence);
    if (changes.some(change => change.deviceId !== deviceId)) {
        throw new Error('1つのまとめ差分に複数端末の変更は保存できません。');
    }
    return {
        batchVersion: 1,
        format: SYNC_BATCH_FORMATS.BULK,
        batchId: String(batchId),
        deviceId: String(deviceId),
        fromSequence: Math.min(...sequences),
        toSequence: Math.max(...sequences),
        changeCount: changes.length,
        createdAt,
        changes: cloneValue(changes),
    };
};

export const validateSyncChangeBatch = (batch, descriptor) => {
    const format = batch?.format || descriptor?.format || SYNC_BATCH_FORMATS.STANDARD;
    const maximumChanges = format === SYNC_BATCH_FORMATS.BULK
        ? MAX_CHANGES_PER_BULK_PACKAGE
        : MAX_CHANGES_PER_BATCH;
    if (
        batch?.batchVersion !== 1
        || !batch?.batchId
        || !batch?.deviceId
        || !Array.isArray(batch?.changes)
        || batch.changes.length === 0
        || batch.changes.length > maximumChanges
        || !Object.values(SYNC_BATCH_FORMATS).includes(format)
    ) {
        throw new Error(`クラウド上の変更バッチが不正です: ${batch?.batchId || 'IDなし'}`);
    }
    const sequences = batch.changes.map(change => change.sequence);
    if (
        batch.changeCount !== batch.changes.length
        || batch.changes.some(change => change.deviceId !== batch.deviceId)
        || batch.fromSequence !== Math.min(...sequences)
        || batch.toSequence !== Math.max(...sequences)
    ) {
        throw new Error(`変更バッチの件数または連番が不正です: ${batch.batchId}`);
    }
    if (
        descriptor
        && (
            batch.batchId !== descriptor.batchId
            || batch.deviceId !== descriptor.deviceId
            || batch.fromSequence !== descriptor.fromSequence
            || batch.toSequence !== descriptor.toSequence
            || batch.changeCount !== descriptor.changeCount
            || format !== (descriptor.format || SYNC_BATCH_FORMATS.STANDARD)
        )
    ) {
        throw new Error(`manifestと変更バッチの内容が一致しません: ${batch.batchId}`);
    }
    return cloneValue(batch);
};
