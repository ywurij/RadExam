import assert from 'node:assert/strict';
import test from 'node:test';
import {
    applySyncFieldDelta,
    buildQuestionSyncChangeInput,
    SYNC_ENTITY_TYPES,
} from '../src/lib/sync/syncProtocol.mjs';
import { SyncJournal } from '../src/lib/sync/syncJournal.mjs';
import {
    createInMemorySyncCloud,
    InMemorySyncProvider,
} from '../src/lib/sync/inMemorySyncProvider.mjs';
import {
    checkSyncUpdates,
    runSyncCycle,
    runSyncPull,
    runSyncPush,
} from '../src/lib/sync/syncEngine.mjs';

class MemoryStorage {
    constructor() {
        this.values = new Map();
    }

    async getItem(key) {
        return this.values.get(key) ?? null;
    }

    async setItem(key, value) {
        this.values.set(key, structuredClone(value));
        return value;
    }

    async removeItem(key) {
        this.values.delete(key);
    }

    async iterate(iterator) {
        for (const [key, value] of this.values) {
            iterator(structuredClone(value), key);
        }
    }
}

class MemoryEntityStore {
    constructor() {
        this.entities = new Map();
        this.blobs = new Map();
    }

    key(entityType, entityId) {
        return `${entityType}:${entityId}`;
    }

    get(entityType, entityId) {
        return this.entities.get(this.key(entityType, entityId));
    }

    set(entityType, entityId, value) {
        this.entities.set(this.key(entityType, entityId), structuredClone(value));
    }

    async applyChange(change, { blob } = {}) {
        const key = this.key(change.entityType, change.entityId);
        if (change.operation === 'delete') {
            this.entities.delete(key);
            this.blobs.delete(key);
            return;
        }
        const current = this.entities.get(key) || {};
        this.entities.set(key, applySyncFieldDelta(current, change));
        if (blob) this.blobs.set(key, blob);
    }
}

const createDevice = async (deviceId, provider) => {
    const journal = new SyncJournal(new MemoryStorage(), {
        uuid: (() => {
            let index = 0;
            return () => `${deviceId}-change-${++index}`;
        })(),
        now: () => '2026-07-26T00:00:00.000Z',
    });
    await journal.configure({
        enabled: true,
        bootstrapCompleted: true,
        deviceId,
        provider: 'google-drive',
        accountId: 'test-account',
    });
    return {
        journal,
        provider,
        dataStore: new MemoryEntityStore(),
    };
};

const syncDevice = device => runSyncCycle({
    provider: device.provider,
    journal: device.journal,
    dataStore: device.dataStore,
    getLocalBlob: ref => {
        const blob = device.dataStore.blobs.get(
            device.dataStore.key(ref.kind, ref.localKey)
        );
        return { blob, contentHash: ref.contentHash };
    },
});

test('checks cloud updates without applying or sending data', async () => {
    const cloud = createInMemorySyncCloud();
    const source = await createDevice('device-a', new InMemorySyncProvider(cloud));
    const target = await createDevice('device-b', new InMemorySyncProvider(cloud));
    await source.journal.recordChanges([{
        entityType: SYNC_ENTITY_TYPES.PROGRESS,
        entityId: 'check-only',
        changedFields: ['status'],
        payload: { status: 'correct' },
    }]);
    await syncDevice(source);
    await target.journal.recordChanges([{
        entityType: SYNC_ENTITY_TYPES.PROGRESS,
        entityId: 'local-only',
        changedFields: ['status'],
        payload: { status: 'review' },
    }]);

    const result = await checkSyncUpdates({ provider: target.provider, journal: target.journal });

    assert.equal(result.updatesAvailable, true);
    assert.equal(result.remoteChangeCount, 1);
    assert.equal(target.dataStore.get(SYNC_ENTITY_TYPES.PROGRESS, 'check-only'), undefined);
    assert.equal((await target.journal.listPendingChanges()).length, 1);
    assert.equal(cloud.manifest.batches.length, 1);
});

test('pull applies remote changes without sending local changes', async () => {
    const cloud = createInMemorySyncCloud();
    const source = await createDevice('device-a', new InMemorySyncProvider(cloud));
    const target = await createDevice('device-b', new InMemorySyncProvider(cloud));
    await source.journal.recordChanges([{
        entityType: SYNC_ENTITY_TYPES.PROGRESS,
        entityId: 'remote-change',
        changedFields: ['status'],
        payload: { status: 'correct' },
    }]);
    await syncDevice(source);
    await target.journal.recordChanges([{
        entityType: SYNC_ENTITY_TYPES.PROGRESS,
        entityId: 'local-change',
        changedFields: ['status'],
        payload: { status: 'review' },
    }]);

    const result = await runSyncPull({
        provider: target.provider,
        journal: target.journal,
        dataStore: target.dataStore,
    });

    assert.equal(result.appliedChanges, 1);
    assert.equal(target.dataStore.get(SYNC_ENTITY_TYPES.PROGRESS, 'remote-change').status, 'correct');
    assert.equal((await target.journal.listPendingChanges()).length, 1);
    assert.equal(cloud.manifest.batches.length, 1);
});

test('pull uses one batch marker without per-change history writes', async () => {
    const cloud = createInMemorySyncCloud();
    const source = await createDevice('device-a', new InMemorySyncProvider(cloud));
    const target = await createDevice('device-b', new InMemorySyncProvider(cloud));
    await source.journal.recordChanges(Array.from({ length: 5 }, (_, index) => ({
        entityType: SYNC_ENTITY_TYPES.PROGRESS,
        entityId: `batched-${index}`,
        changedFields: ['status'],
        payload: { status: 'correct' },
    })));
    await syncDevice(source);
    let beginCount = 0;
    let endCount = 0;
    let bulkAppliedLookupCount = 0;
    let singleAppliedLookupCount = 0;
    const findAppliedChangeIds = target.journal.findAppliedChangeIds.bind(target.journal);
    const hasAppliedChange = target.journal.hasAppliedChange.bind(target.journal);
    target.journal.findAppliedChangeIds = async changeIds => {
        bulkAppliedLookupCount += 1;
        return findAppliedChangeIds(changeIds);
    };
    target.journal.hasAppliedChange = async changeId => {
        singleAppliedLookupCount += 1;
        return hasAppliedChange(changeId);
    };
    const applied = [];
    const dataStore = {
        beginBatch() { beginCount += 1; },
        async applyChange(change) { applied.push(change); },
        async endBatch() { endCount += 1; },
        cancelBatch() {},
    };

    const result = await runSyncPull({
        provider: target.provider,
        journal: target.journal,
        dataStore,
    });

    assert.equal(result.appliedChanges, 5);
    assert.equal(beginCount, 1);
    assert.equal(endCount, 1);
    assert.equal(applied.length, 5);
    assert.equal(bulkAppliedLookupCount, 0);
    assert.equal(singleAppliedLookupCount, 0);
    assert.equal(await target.journal.hasAppliedChange(applied[0].changeId), false);
    assert.equal(await target.journal.hasAppliedBatch(cloud.manifest.batches[0].batchId), true);
});

test('pull skips redundant history writes for an already-sent echoed batch', async () => {
    const cloud = createInMemorySyncCloud();
    const device = await createDevice('device-a', new InMemorySyncProvider(cloud));
    await device.journal.recordChanges(Array.from({ length: 20 }, (_, index) => ({
        entityType: SYNC_ENTITY_TYPES.PROGRESS,
        entityId: `echoed-${index}`,
        changedFields: ['status'],
        payload: { status: 'correct' },
    })));
    await runSyncPush({ provider: device.provider, journal: device.journal });
    let bulkMarkCount = 0;
    let acknowledgeCount = 0;
    const markChangesApplied = device.journal.markChangesApplied.bind(device.journal);
    const acknowledgeChanges = device.journal.acknowledgeChanges.bind(device.journal);
    device.journal.markChangesApplied = async (...args) => {
        bulkMarkCount += 1;
        return markChangesApplied(...args);
    };
    device.journal.acknowledgeChanges = async (...args) => {
        acknowledgeCount += 1;
        return acknowledgeChanges(...args);
    };

    const result = await runSyncPull({
        provider: device.provider,
        journal: device.journal,
        dataStore: {
            beginBatch() {},
            async applyChange() {},
            async endBatch() {},
            cancelBatch() {},
        },
    });

    assert.equal(result.acknowledgedChanges, 20);
    assert.equal(bulkMarkCount, 0);
    assert.equal(acknowledgeCount, 0);
});

test('push requires remote changes to be pulled first', async () => {
    const cloud = createInMemorySyncCloud();
    const source = await createDevice('device-a', new InMemorySyncProvider(cloud));
    const target = await createDevice('device-b', new InMemorySyncProvider(cloud));
    await source.journal.recordChanges([{
        entityType: SYNC_ENTITY_TYPES.PROGRESS,
        entityId: 'remote-first',
        changedFields: ['status'],
        payload: { status: 'correct' },
    }]);
    await syncDevice(source);
    await target.journal.recordChanges([{
        entityType: SYNC_ENTITY_TYPES.PROGRESS,
        entityId: 'local-second',
        changedFields: ['status'],
        payload: { status: 'review' },
    }]);

    await assert.rejects(
        runSyncPush({ provider: target.provider, journal: target.journal }),
        error => error.code === 'REMOTE_UPDATES_REQUIRED'
    );
    await runSyncPull({
        provider: target.provider,
        journal: target.journal,
        dataStore: target.dataStore,
    });
    const result = await runSyncPush({ provider: target.provider, journal: target.journal });
    assert.equal(result.pushedChanges, 1);
    assert.equal(cloud.manifest.batches.length, 2);
});

test('syncs creation and deletion of a resumable session between devices', async () => {
    const cloud = createInMemorySyncCloud();
    const deviceA = await createDevice('device-a', new InMemorySyncProvider(cloud));
    const deviceB = await createDevice('device-b', new InMemorySyncProvider(cloud));
    const entityId = 'resumable-session:session-1';

    await deviceA.journal.recordChanges([{
        entityType: SYNC_ENTITY_TYPES.PREFERENCE,
        entityId,
        changedFields: ['id', 'examId', 'currentIndex', 'interrupted'],
        payload: {
            id: 'session-1',
            examId: 'exam',
            currentIndex: 12,
            interrupted: true,
        },
    }]);
    await syncDevice(deviceA);
    await syncDevice(deviceB);

    assert.deepEqual(
        deviceB.dataStore.get(SYNC_ENTITY_TYPES.PREFERENCE, entityId),
        {
            id: 'session-1',
            examId: 'exam',
            currentIndex: 12,
            interrupted: true,
        }
    );

    await deviceA.journal.recordChanges([{
        entityType: SYNC_ENTITY_TYPES.PREFERENCE,
        entityId,
        operation: 'delete',
    }]);
    await syncDevice(deviceA);
    await syncDevice(deviceB);

    assert.equal(
        deviceB.dataStore.get(SYNC_ENTITY_TYPES.PREFERENCE, entityId),
        undefined
    );
});

test('syncs two devices and merges edits to different options', async () => {
    const cloud = createInMemorySyncCloud();
    const deviceA = await createDevice('device-a', new InMemorySyncProvider(cloud));
    const deviceB = await createDevice('device-b', new InMemorySyncProvider(cloud));
    const original = {
        id: '2025001',
        year: 2025,
        questionNumber: 1,
        question: '問題文',
        options: { a: '選択肢A', b: '選択肢B' },
    };
    deviceA.dataStore.set(SYNC_ENTITY_TYPES.QUESTION, 'exam::2025001', original);
    await deviceA.journal.recordChanges([
        buildQuestionSyncChangeInput({
            examId: 'exam',
            nextQuestion: original,
        }),
    ]);

    assert.equal((await syncDevice(deviceA)).pushedChanges, 1);
    assert.equal((await syncDevice(deviceB)).appliedChanges, 1);
    assert.deepEqual(
        deviceB.dataStore.get(SYNC_ENTITY_TYPES.QUESTION, 'exam::2025001'),
        original
    );

    const editedA = {
        ...original,
        options: { ...original.options, a: 'Macで修正した選択肢A' },
    };
    const editedB = {
        ...original,
        options: { ...original.options, b: 'モバイルで修正した選択肢B' },
    };
    deviceA.dataStore.set(SYNC_ENTITY_TYPES.QUESTION, 'exam::2025001', editedA);
    deviceB.dataStore.set(SYNC_ENTITY_TYPES.QUESTION, 'exam::2025001', editedB);
    await deviceA.journal.recordChanges([
        buildQuestionSyncChangeInput({
            examId: 'exam',
            previousQuestion: original,
            nextQuestion: editedA,
        }),
    ]);
    await deviceB.journal.recordChanges([
        buildQuestionSyncChangeInput({
            examId: 'exam',
            previousQuestion: original,
            nextQuestion: editedB,
        }),
    ]);

    await syncDevice(deviceA);
    const deviceBResult = await syncDevice(deviceB);
    const deviceAResult = await syncDevice(deviceA);
    const expected = {
        ...original,
        options: {
            a: 'Macで修正した選択肢A',
            b: 'モバイルで修正した選択肢B',
        },
    };

    assert.equal(deviceBResult.conflicts, 0);
    assert.equal(deviceAResult.conflicts, 0);
    assert.deepEqual(
        deviceA.dataStore.get(SYNC_ENTITY_TYPES.QUESTION, 'exam::2025001'),
        expected
    );
    assert.deepEqual(
        deviceB.dataStore.get(SYNC_ENTITY_TYPES.QUESTION, 'exam::2025001'),
        expected
    );
    assert.equal(cloud.manifest.batches.length, 3);
});

test('uploads identical binary content only once', async () => {
    const cloud = createInMemorySyncCloud();
    const device = await createDevice('device-a', new InMemorySyncProvider(cloud));
    const contentHash = 'sha256:same-content';
    const blob = new Blob(['same-content'], { type: 'image/png' });

    for (const localKey of ['image-a', 'image-b']) {
        device.dataStore.blobs.set(
            device.dataStore.key(SYNC_ENTITY_TYPES.IMAGE, localKey),
            blob
        );
    }
    await device.journal.recordChanges(['image-a', 'image-b'].map(localKey => ({
        entityType: SYNC_ENTITY_TYPES.IMAGE,
        entityId: localKey,
        changedFields: ['contentHash', 'localKey'],
        payload: { contentHash, localKey },
        blobRefs: [{
            kind: SYNC_ENTITY_TYPES.IMAGE,
            localKey,
            contentHash,
        }],
    })));

    const result = await syncDevice(device);

    assert.equal(result.pushedChanges, 2);
    assert.equal(result.uploadedBlobs, 1);
    assert.equal(cloud.stats.blobUploads, 1);
    assert.equal(cloud.blobs.size, 1);
});

test('keeps both devices safe when they edit the same option concurrently', async () => {
    const cloud = createInMemorySyncCloud();
    const deviceA = await createDevice('device-a', new InMemorySyncProvider(cloud));
    const deviceB = await createDevice('device-b', new InMemorySyncProvider(cloud));
    const original = {
        id: '2025001',
        year: 2025,
        questionNumber: 1,
        question: '問題文',
        options: { a: '変更前' },
    };
    deviceA.dataStore.set(SYNC_ENTITY_TYPES.QUESTION, 'exam::2025001', original);
    await deviceA.journal.recordChanges([
        buildQuestionSyncChangeInput({
            examId: 'exam',
            nextQuestion: original,
        }),
    ]);
    await syncDevice(deviceA);
    await syncDevice(deviceB);

    const editedA = { ...original, options: { a: 'Macでの修正' } };
    const editedB = { ...original, options: { a: 'モバイルでの修正' } };
    deviceA.dataStore.set(SYNC_ENTITY_TYPES.QUESTION, 'exam::2025001', editedA);
    deviceB.dataStore.set(SYNC_ENTITY_TYPES.QUESTION, 'exam::2025001', editedB);
    await deviceA.journal.recordChanges([
        buildQuestionSyncChangeInput({
            examId: 'exam',
            previousQuestion: original,
            nextQuestion: editedA,
        }),
    ]);
    await deviceB.journal.recordChanges([
        buildQuestionSyncChangeInput({
            examId: 'exam',
            previousQuestion: original,
            nextQuestion: editedB,
        }),
    ]);

    await syncDevice(deviceA);
    const resultB = await syncDevice(deviceB);
    const resultA = await syncDevice(deviceA);

    assert.equal(resultB.conflicts, 1);
    assert.equal(resultA.conflicts, 1);
    assert.equal(
        deviceA.dataStore.get(SYNC_ENTITY_TYPES.QUESTION, 'exam::2025001').options.a,
        'Macでの修正'
    );
    assert.equal(
        deviceB.dataStore.get(SYNC_ENTITY_TYPES.QUESTION, 'exam::2025001').options.a,
        'モバイルでの修正'
    );
    assert.equal((await deviceA.journal.listConflicts()).length, 1);
    assert.equal((await deviceB.journal.listConflicts()).length, 1);
});

test('retries a conditional manifest update after another writer wins', async () => {
    const cloud = createInMemorySyncCloud();
    const provider = new InMemorySyncProvider(cloud);
    const originalCommit = provider.commitManifest.bind(provider);
    let shouldConflict = true;
    provider.commitManifest = async (manifest, revision) => {
        if (shouldConflict) {
            shouldConflict = false;
            cloud.revision += 1;
        }
        return originalCommit(manifest, revision);
    };
    const device = await createDevice('device-a', provider);
    await device.journal.recordChanges([{
        entityType: SYNC_ENTITY_TYPES.PROGRESS,
        entityId: '2025001',
        changedFields: ['status'],
        payload: { status: 'correct' },
    }]);

    const result = await syncDevice(device);

    assert.equal(result.pushedChanges, 1);
    assert.equal(cloud.manifest.generation, 1);
    assert.deepEqual(await device.journal.listPendingChanges(), []);
});

test('uses one manifest read for a normal one-change sync', async () => {
    const cloud = createInMemorySyncCloud();
    const provider = new InMemorySyncProvider(cloud);
    const originalReadManifest = provider.readManifest.bind(provider);
    let manifestReads = 0;
    provider.readManifest = async options => {
        manifestReads += 1;
        return originalReadManifest(options);
    };
    const device = await createDevice('device-a', provider);
    await device.journal.recordChanges([{
        entityType: SYNC_ENTITY_TYPES.PROGRESS,
        entityId: 'one-change',
        changedFields: ['status'],
        payload: { status: 'correct' },
    }]);

    const result = await syncDevice(device);

    assert.equal(result.pushedChanges, 1);
    assert.equal(manifestReads, 1);
    assert.ok(result.durationMs >= 0);
    assert.equal((await device.journal.getConfig()).lastKnownCloudGeneration, 1);
});

test('packs more than 100 local changes into one bulk delta package', async () => {
    const cloud = createInMemorySyncCloud();
    const device = await createDevice('device-a', new InMemorySyncProvider(cloud));
    await device.journal.recordChanges(Array.from({ length: 205 }, (_, index) => ({
        entityType: SYNC_ENTITY_TYPES.PROGRESS,
        entityId: String(2025000 + index),
        changedFields: ['status'],
        payload: { status: 'correct' },
    })));

    const result = await syncDevice(device);
    const receivingDevice = await createDevice(
        'device-b',
        new InMemorySyncProvider(cloud)
    );
    let pendingScans = 0;
    let conflictScans = 0;
    let sentScans = 0;
    let combinedStateScans = 0;
    const originalListPending = receivingDevice.journal.listPendingChanges.bind(
        receivingDevice.journal
    );
    const originalListConflicts = receivingDevice.journal.listConflicts.bind(
        receivingDevice.journal
    );
    const originalListSent = receivingDevice.journal.listSentChangesAfterGeneration.bind(
        receivingDevice.journal
    );
    const originalReadPullState = receivingDevice.journal.readPullState.bind(
        receivingDevice.journal
    );
    receivingDevice.journal.listPendingChanges = async (...args) => {
        pendingScans += 1;
        return originalListPending(...args);
    };
    receivingDevice.journal.listConflicts = async (...args) => {
        conflictScans += 1;
        return originalListConflicts(...args);
    };
    receivingDevice.journal.listSentChangesAfterGeneration = async (...args) => {
        sentScans += 1;
        return originalListSent(...args);
    };
    receivingDevice.journal.readPullState = async (...args) => {
        combinedStateScans += 1;
        return originalReadPullState(...args);
    };
    const received = await syncDevice(receivingDevice);

    assert.equal(result.pushedBatches, 1);
    assert.equal(result.pushedChanges, 205);
    assert.equal(result.pushedBulkPackages, 1);
    assert.deepEqual(cloud.manifest.batches.map(batch => batch.changeCount), [205]);
    assert.equal(cloud.manifest.batches[0].format, 'bulk-delta');
    assert.equal(cloud.manifest.batches[0].entityCounts.progress, 205);
    assert.ok(cloud.manifest.batches[0].byteSize > 0);
    assert.equal(received.appliedChanges, 205);
    assert.ok(pendingScans < 10);
    assert.equal(conflictScans, 0);
    assert.equal(sentScans, 0);
    assert.equal(combinedStateScans, 1);
    assert.deepEqual(await device.journal.listPendingChanges(), []);
});

test('uses a bulk delta package for many structural question edits below 100 changes', async () => {
    const cloud = createInMemorySyncCloud();
    const device = await createDevice('device-a', new InMemorySyncProvider(cloud));
    await device.journal.recordChanges(Array.from({ length: 25 }, (_, index) => ({
        entityType: SYNC_ENTITY_TYPES.QUESTION,
        entityId: `exam::${index}`,
        changedFields: ['question'],
        payload: { question: `修正した問題文${index}` },
    })));

    const result = await syncDevice(device);

    assert.equal(result.pushedChanges, 25);
    assert.equal(result.pushedBulkPackages, 1);
    assert.equal(cloud.manifest.batches[0].format, 'bulk-delta');
});

test('reuses one pending queue and prefetches multiple standard batches', async () => {
    const cloud = createInMemorySyncCloud();
    const source = await createDevice('device-a', new InMemorySyncProvider(cloud));
    source.provider.uploadBulkChangePackage = undefined;
    await source.journal.recordChanges(Array.from({ length: 205 }, (_, index) => ({
        entityType: SYNC_ENTITY_TYPES.PROGRESS,
        entityId: `standard-${index}`,
        changedFields: ['status'],
        payload: { status: 'correct' },
    })));
    let pendingScans = 0;
    const listPendingChanges = source.journal.listPendingChanges.bind(source.journal);
    source.journal.listPendingChanges = async (...args) => {
        pendingScans += 1;
        return listPendingChanges(...args);
    };

    const pushed = await runSyncPush({
        provider: source.provider,
        journal: source.journal,
        snapshotThreshold: Number.MAX_SAFE_INTEGER,
    });

    assert.equal(pushed.pushedBatches, 3);
    assert.equal(pushed.pushedChanges, 205);
    assert.equal(pendingScans, 1);
    assert.deepEqual(cloud.manifest.batches.map(batch => batch.changeCount), [100, 100, 5]);

    const target = await createDevice('device-b', new InMemorySyncProvider(cloud));
    let activeDownloads = 0;
    let maximumDownloads = 0;
    const downloadChangeBatch = target.provider.downloadChangeBatch.bind(target.provider);
    target.provider.downloadChangeBatch = async descriptor => {
        activeDownloads += 1;
        maximumDownloads = Math.max(maximumDownloads, activeDownloads);
        await new Promise(resolve => setTimeout(resolve, 5));
        try {
            return await downloadChangeBatch(descriptor);
        } finally {
            activeDownloads -= 1;
        }
    };
    const pulled = await runSyncPull({
        provider: target.provider,
        journal: target.journal,
        dataStore: target.dataStore,
    });

    assert.equal(pulled.appliedChanges, 205);
    assert.equal(maximumDownloads, 3);
});

test('update checks skip per-batch storage lookups for old generations', async () => {
    const cloud = createInMemorySyncCloud();
    const source = await createDevice('device-a', new InMemorySyncProvider(cloud));
    const target = await createDevice('device-b', new InMemorySyncProvider(cloud));
    await source.journal.recordChanges([{
        entityType: SYNC_ENTITY_TYPES.PROGRESS,
        entityId: 'already-pulled',
        changedFields: ['status'],
        payload: { status: 'correct' },
    }]);
    await syncDevice(source);
    await runSyncPull({
        provider: target.provider,
        journal: target.journal,
        dataStore: target.dataStore,
    });
    let batchLookups = 0;
    const hasAppliedBatch = target.journal.hasAppliedBatch.bind(target.journal);
    target.journal.hasAppliedBatch = async batchId => {
        batchLookups += 1;
        return hasAppliedBatch(batchId);
    };

    const checked = await checkSyncUpdates({
        provider: target.provider,
        journal: target.journal,
    });

    assert.equal(checked.updatesAvailable, false);
    assert.equal(batchLookups, 0);
});

test('uses one snapshot for a large initial sync and leaves later edits as deltas', async () => {
    const cloud = createInMemorySyncCloud();
    const device = await createDevice('device-a', new InMemorySyncProvider(cloud));
    await device.journal.recordChanges(Array.from({ length: 205 }, (_, index) => ({
        entityType: SYNC_ENTITY_TYPES.PROGRESS,
        entityId: String(2025000 + index),
        changedFields: ['status'],
        payload: { status: 'correct' },
    })));
    let createdSnapshots = 0;

    const result = await runSyncCycle({
        provider: device.provider,
        journal: device.journal,
        dataStore: device.dataStore,
        getLocalBlob: () => null,
        createLocalSnapshot: async () => {
            createdSnapshots += 1;
            await device.journal.recordChanges([{
                entityType: SYNC_ENTITY_TYPES.PROGRESS,
                entityId: 'edited-during-snapshot',
                changedFields: ['status'],
                payload: { status: 'review' },
            }]);
            return { blob: new Blob(['complete-local-data']) };
        },
    });

    assert.equal(createdSnapshots, 1);
    assert.equal(result.createdSnapshot, true);
    assert.equal(result.coveredChanges, 205);
    assert.equal(result.pushedChanges, 1);
    assert.equal(result.sentChanges, 206);
    assert.equal((await device.journal.getConfig()).lastSyncSentChanges, 206);
    assert.equal((await device.journal.getConfig()).lastSyncSnapshotChanges, 205);
    assert.equal(cloud.stats.snapshotUploads, 1);
    assert.equal(cloud.manifest.latestSnapshot.cutoffSequence, 205);
    assert.equal(cloud.manifest.batches.length, 1);
    assert.deepEqual(await device.journal.listPendingChanges(), []);
});

test('does not block sending when the only cloud snapshot was published by this device', async () => {
    const cloud = createInMemorySyncCloud();
    const device = await createDevice('device-a', new InMemorySyncProvider(cloud));
    await device.journal.recordChanges(Array.from({ length: 2 }, (_, index) => ({
        entityType: SYNC_ENTITY_TYPES.PROGRESS,
        entityId: `initial-${index}`,
        changedFields: ['status'],
        payload: { status: 'correct' },
    })));
    await runSyncPush({
        provider: device.provider,
        journal: device.journal,
        createLocalSnapshot: async () => ({ blob: new Blob(['snapshot-data']) }),
        snapshotThreshold: 2,
    });

    await device.journal.configure({
        lastAppliedSnapshotId: null,
        lastPushedGeneration: 0,
        lastPulledGeneration: 0,
    });
    await device.journal.recordChanges([{
        entityType: SYNC_ENTITY_TYPES.PROGRESS,
        entityId: 'after-reset',
        changedFields: ['status'],
        payload: { status: 'review' },
    }]);

    const checked = await checkSyncUpdates({
        provider: device.provider,
        journal: device.journal,
    });
    assert.equal(checked.remoteChangeCount, 0);
    assert.equal(checked.snapshotAvailable, false);
    assert.equal(checked.updatesAvailable, false);

    const result = await runSyncPush({
        provider: device.provider,
        journal: device.journal,
    });
    assert.equal(result.pushedChanges, 1);
    assert.equal((await device.journal.getConfig()).lastAppliedSnapshotId,
        cloud.manifest.latestSnapshot.snapshotId);
});

test('restores the latest snapshot before applying newer change batches', async () => {
    const cloud = createInMemorySyncCloud();
    const source = await createDevice('device-a', new InMemorySyncProvider(cloud));
    await source.journal.recordChanges(Array.from({ length: 101 }, (_, index) => ({
        entityType: SYNC_ENTITY_TYPES.PROGRESS,
        entityId: String(index),
        changedFields: ['status'],
        payload: { status: 'correct' },
    })));
    await runSyncCycle({
        provider: source.provider,
        journal: source.journal,
        dataStore: source.dataStore,
        getLocalBlob: () => null,
        createLocalSnapshot: async () => ({ blob: new Blob(['snapshot-data']) }),
    });
    await source.journal.recordChanges([{
        entityType: SYNC_ENTITY_TYPES.PROGRESS,
        entityId: 'after-snapshot',
        changedFields: ['status'],
        payload: { status: 'review' },
    }]);
    await syncDevice(source);

    const target = await createDevice('device-b', new InMemorySyncProvider(cloud));
    let restoredText = '';
    const result = await runSyncCycle({
        provider: target.provider,
        journal: target.journal,
        dataStore: target.dataStore,
        getLocalBlob: () => null,
        restoreLocalSnapshot: async blob => {
            restoredText = await blob.text();
        },
    });

    assert.equal(result.restoredSnapshot, true);
    assert.equal(restoredText, 'snapshot-data');
    assert.equal(result.appliedChanges, 1);
    assert.equal(
        target.dataStore.get(SYNC_ENTITY_TYPES.PROGRESS, 'after-snapshot').status,
        'review'
    );
});

test('creates a recovery checkpoint after 100 successfully synced changes', async () => {
    const cloud = createInMemorySyncCloud();
    const device = await createDevice('device-a', new InMemorySyncProvider(cloud));
    await device.journal.configure({
        lastSnapshotAt: '2026-07-26T00:00:00.000Z',
        changesSinceSnapshot: 99,
    });
    await device.journal.recordChanges([{
        entityType: SYNC_ENTITY_TYPES.PROGRESS,
        entityId: 'one-more-change',
        changedFields: ['status'],
        payload: { status: 'correct' },
    }]);

    const result = await runSyncCycle({
        provider: device.provider,
        journal: device.journal,
        dataStore: device.dataStore,
        getLocalBlob: () => null,
        createLocalSnapshot: async () => ({ blob: new Blob(['recovery-checkpoint']) }),
    });

    assert.equal(result.pushedChanges, 1);
    assert.equal(result.createdPeriodicSnapshot, true);
    assert.equal(cloud.manifest.latestSnapshot.purpose, 'checkpoint');
    assert.equal(cloud.manifest.latestSnapshot.generation, 1);
    assert.equal((await device.journal.getConfig()).changesSinceSnapshot, 0);
});

test('does not block a one-change sync with an old weekly checkpoint', async () => {
    const cloud = createInMemorySyncCloud();
    const device = await createDevice('device-a', new InMemorySyncProvider(cloud));
    await device.journal.configure({
        lastSnapshotAt: '2025-01-01T00:00:00.000Z',
        changesSinceSnapshot: 0,
    });
    await device.journal.recordChanges([{
        entityType: SYNC_ENTITY_TYPES.PROGRESS,
        entityId: 'small-change',
        changedFields: ['status'],
        payload: { status: 'correct' },
    }]);
    let snapshotCreations = 0;

    const result = await runSyncCycle({
        provider: device.provider,
        journal: device.journal,
        dataStore: device.dataStore,
        getLocalBlob: () => null,
        createLocalSnapshot: async () => {
            snapshotCreations += 1;
            return { blob: new Blob(['should-not-be-created']) };
        },
    });

    assert.equal(result.pushedChanges, 1);
    assert.equal(result.createdPeriodicSnapshot, false);
    assert.equal(snapshotCreations, 0);
});
