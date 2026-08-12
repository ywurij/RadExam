import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createEmptySyncManifest,
    MAX_SYNC_MANIFEST_BATCHES,
    validateSyncManifest,
} from '../src/lib/sync/syncManifest.mjs';

const descriptor = overrides => ({
    batchId: 'batch-1',
    deviceId: 'device-1',
    objectKey: 'changes/batch-1.json',
    generation: 1,
    fromSequence: 1,
    toSequence: 1,
    changeCount: 1,
    format: 'change-batch',
    ...overrides,
});

test('クラウドmanifestの異常に長い参照先を拒否する', () => {
    assert.throws(() => validateSyncManifest({
        ...createEmptySyncManifest(),
        generation: 1,
        batches: [descriptor({ objectKey: 'x'.repeat(4097) })],
    }), /変更バッチが不正/);
});

test('クラウドmanifestのバッチ件数に上限を設ける', () => {
    const batches = new Array(MAX_SYNC_MANIFEST_BATCHES + 1).fill(null);
    assert.throws(() => validateSyncManifest({
        ...createEmptySyncManifest(),
        generation: batches.length,
        batches,
    }), /batchesが不正/);
});
