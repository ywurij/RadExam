import assert from 'node:assert/strict';
import test from 'node:test';
import {
    applySyncFieldDelta,
    buildDeleteSyncChangeInput,
    buildQuestionSyncChangeInput,
    collectQuestionBlobRefs,
    createSyncChange,
    diffQuestionFields,
    SYNC_ENTITY_TYPES,
    SYNC_OPERATIONS,
} from '../src/lib/sync/syncProtocol.mjs';
import { SyncJournal } from '../src/lib/sync/syncJournal.mjs';

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

test('records question text and each option as independent changed fields', () => {
    const previous = {
        id: '2025001',
        question: '<p>変更前の問題文</p>',
        options: { a: '選択肢A', b: '選択肢B', c: '選択肢C' },
        explanation: '<p>解説</p>',
    };
    const next = {
        ...previous,
        question: '<p>変更後の問題文</p>',
        options: { ...previous.options, c: '修正した選択肢C' },
    };

    const delta = diffQuestionFields(previous, next);

    assert.deepEqual(delta.changedFields, ['options.c', 'question']);
    assert.deepEqual(delta.unsetFields, []);
    assert.deepEqual(delta.payload, {
        question: '<p>変更後の問題文</p>',
        options: { c: '修正した選択肢C' },
    });
    assert.deepEqual(applySyncFieldDelta(previous, {
        operation: SYNC_OPERATIONS.UPSERT,
        ...delta,
    }), next);
});

test('represents a removed option as an unset field', () => {
    const previous = {
        id: '2025001',
        question: '問題文',
        options: { a: 'A', b: 'B', c: 'C' },
    };
    const next = {
        ...previous,
        options: { a: 'A', b: 'B' },
    };

    const delta = diffQuestionFields(previous, next);

    assert.deepEqual(delta.changedFields, ['options.c']);
    assert.deepEqual(delta.unsetFields, ['options.c']);
    assert.deepEqual(applySyncFieldDelta(previous, {
        operation: SYNC_OPERATIONS.UPSERT,
        ...delta,
    }), next);
});

test('includes the full question and all options when a question is first created', () => {
    const next = {
        id: '2025001',
        year: 2025,
        questionNumber: 1,
        question: '<p>新しい問題文</p>',
        options: { a: '選択肢A', b: '選択肢B', c: '選択肢C' },
        answer: 'b',
        explanation: '<p>解説</p>',
        genre: '物理',
    };

    const change = buildQuestionSyncChangeInput({
        examId: 'exam',
        nextQuestion: next,
    });

    assert.deepEqual(change.changedFields, [
        'answer',
        'explanation',
        'genre',
        'id',
        'options.a',
        'options.b',
        'options.c',
        'question',
        'questionNumber',
        'year',
    ]);
    assert.deepEqual(applySyncFieldDelta({}, change), next);
});

test('builds a question change with image and PDF references only when relevant fields change', () => {
    const previous = {
        id: '2025001',
        question: '問題文',
        options: { a: 'A' },
        images: [],
        sourcePages: [],
    };
    const next = {
        ...previous,
        images: [{
            path: 'local-image://exam::2025001::0::image',
            contentHash: 'image-hash',
        }],
        sourcePages: [{
            pdfKey: 'exam::2025::source.pdf',
            contentHash: 'pdf-hash',
            pageNumber: 1,
        }],
    };

    const change = buildQuestionSyncChangeInput({
        examId: 'exam',
        previousQuestion: previous,
        nextQuestion: next,
    });

    assert.equal(change.entityType, SYNC_ENTITY_TYPES.QUESTION);
    assert.equal(change.entityId, 'exam::2025001');
    assert.deepEqual(change.changedFields, ['images', 'sourcePages']);
    assert.deepEqual(change.blobRefs, [
        {
            kind: SYNC_ENTITY_TYPES.IMAGE,
            localKey: 'exam::2025001::0::image',
            contentHash: 'image-hash',
        },
        {
            kind: SYNC_ENTITY_TYPES.PDF,
            localKey: 'exam::2025::source.pdf',
            contentHash: 'pdf-hash',
        },
    ]);
});

test('deduplicates repeated question blob references', () => {
    assert.deepEqual(collectQuestionBlobRefs({
        images: [
            { path: 'local-image://same-image' },
            { storageKey: 'same-image' },
        ],
        sourcePages: [
            { pdfKey: 'same-pdf' },
            { pdfKey: 'same-pdf' },
        ],
    }), [
        { kind: SYNC_ENTITY_TYPES.IMAGE, localKey: 'same-image' },
        { kind: SYNC_ENTITY_TYPES.PDF, localKey: 'same-pdf' },
    ]);
});

test('creates validated, normalized sync changes', () => {
    const change = createSyncChange({
        changeId: 'change-1',
        deviceId: 'device-1',
        sequence: 2,
        entityType: SYNC_ENTITY_TYPES.PROGRESS,
        entityId: 'exam_2025001',
        changedFields: ['status', 'status'],
        payload: { status: 'correct' },
        createdAt: '2026-07-25T00:00:00.000Z',
    });

    assert.equal(change.schemaVersion, 1);
    assert.deepEqual(change.changedFields, ['status']);
    assert.throws(() => createSyncChange({
        ...change,
        sequence: 0,
    }), /sequence/);
});

test('keeps the sync journal disabled until a cloud account is configured', async () => {
    const journal = new SyncJournal(new MemoryStorage(), {
        uuid: () => 'generated-id',
        now: () => '2026-07-25T00:00:00.000Z',
    });

    const recorded = await journal.recordChanges([{
        entityType: SYNC_ENTITY_TYPES.PROGRESS,
        entityId: 'exam_2025001',
        changedFields: ['status'],
        payload: { status: 'correct' },
    }]);

    assert.deepEqual(recorded, []);
    assert.deepEqual(await journal.listPendingChanges(), []);
});

test('assigns monotonic sequences and keeps deletion tombstones', async () => {
    const storage = new MemoryStorage();
    let uuidIndex = 0;
    const journal = new SyncJournal(storage, {
        uuid: () => `uuid-${++uuidIndex}`,
        now: () => '2026-07-25T00:00:00.000Z',
    });
    await journal.configure({
        enabled: true,
        deviceId: 'device-1',
        provider: 'google-drive',
        accountId: 'account-1',
    });

    const changes = await journal.recordChanges([
        {
            entityType: SYNC_ENTITY_TYPES.PROGRESS,
            entityId: 'exam_2025001',
            changedFields: ['status'],
            payload: { status: 'correct' },
        },
        buildDeleteSyncChangeInput({
            entityType: SYNC_ENTITY_TYPES.QUESTION,
            entityId: 'exam::2025002',
        }),
    ]);

    assert.deepEqual(changes.map(change => change.sequence), [1, 2]);
    assert.deepEqual((await journal.listPendingChanges()).map(change => change.sequence), [1, 2]);
    assert.deepEqual(await journal.listTombstones(), [{
        entityType: SYNC_ENTITY_TYPES.QUESTION,
        entityId: 'exam::2025002',
        changeId: 'uuid-2',
        deviceId: 'device-1',
        sequence: 2,
        baseVersion: null,
        deletedAt: '2026-07-25T00:00:00.000Z',
    }]);

    assert.equal(await journal.acknowledgeChanges([changes[0].changeId]), 1);
    assert.deepEqual((await journal.listPendingChanges()).map(change => change.sequence), [2]);
});

test('remembers an applied remote change so retries are idempotent', async () => {
    const storage = new MemoryStorage();
    const journal = new SyncJournal(storage, {
        now: () => '2026-07-25T00:00:00.000Z',
    });
    const remoteChange = {
        changeId: 'remote-change-1',
        deviceId: 'remote-device',
        sequence: 42,
    };

    assert.equal(await journal.hasAppliedChange(remoteChange.changeId), false);
    const first = await journal.markChangeApplied(remoteChange);
    const second = await journal.markChangeApplied(remoteChange, '2099-01-01T00:00:00.000Z');

    assert.deepEqual(first, {
        ...remoteChange,
        appliedAt: '2026-07-25T00:00:00.000Z',
    });
    assert.deepEqual(second, first);
    assert.equal(await journal.hasAppliedChange(remoteChange.changeId), true);
});
