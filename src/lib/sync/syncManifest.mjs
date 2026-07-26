import { SYNC_SCHEMA_VERSION } from './syncProtocol.mjs';

export const SYNC_MANIFEST_VERSION = 1;
export const MAX_CHANGES_PER_BATCH = 100;

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
        || batch.changeCount > MAX_CHANGES_PER_BATCH
    ) {
        throw new Error(`manifest内の変更バッチが不正です: ${batch?.batchId || 'IDなし'}`);
    }
    return batch;
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
    return cloneValue(manifest);
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
        ];
        if (comparableFields.some(field => existing[field] !== batch[field])) {
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
    if (
        batch?.batchVersion !== 1
        || !batch?.batchId
        || !batch?.deviceId
        || !Array.isArray(batch?.changes)
        || batch.changes.length === 0
        || batch.changes.length > MAX_CHANGES_PER_BATCH
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
        )
    ) {
        throw new Error(`manifestと変更バッチの内容が一致しません: ${batch.batchId}`);
    }
    return cloneValue(batch);
};
