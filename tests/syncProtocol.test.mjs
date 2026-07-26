import assert from 'node:assert/strict';
import test from 'node:test';
import {
    applySyncFieldDelta,
    buildDeleteSyncChangeInput,
    buildInitialSyncChangeInputs,
    buildQuestionSyncChangeInput,
    collectQuestionBlobRefs,
    createSyncChange,
    diffQuestionFields,
    parseQuestionEntityId,
    SYNC_ENTITY_TYPES,
    SYNC_OPERATIONS,
    validateIncomingSyncChange,
} from '../src/lib/sync/syncProtocol.mjs';
import {
    canApplyRemoteChangeAutomatically,
    detectSyncConflict,
    findOverlappingSyncFields,
} from '../src/lib/sync/syncConflict.mjs';
import { SyncJournal } from '../src/lib/sync/syncJournal.mjs';
import { processIncomingSyncChange } from '../src/lib/sync/syncReceiver.mjs';

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

    async clear() {
        this.values.clear();
    }

    async iterate(iterator) {
        for (const [key, value] of this.values) {
            iterator(structuredClone(value), key);
        }
    }
}

test('does not disconnect while unsent changes remain unless explicitly confirmed', async () => {
    let uuidSequence = 0;
    const journal = new SyncJournal(new MemoryStorage(), {
        uuid: () => `uuid-${++uuidSequence}`,
    });
    const configured = await journal.configure({
        enabled: true,
        provider: 'google-drive',
        accountId: 'account-1',
    });
    await journal.recordChanges([{
        entityType: 'question',
        entityId: 'exam-1:question-1',
        operation: 'upsert',
        changedFields: ['question'],
        payload: { question: '変更後' },
    }]);

    await assert.rejects(
        () => journal.disconnect(),
        /未同期の変更が1件/
    );

    const disconnected = await journal.disconnect({ discardPending: true });

    assert.equal(disconnected.enabled, false);
    assert.equal(disconnected.provider, null);
    assert.notEqual(disconnected.deviceId, configured.deviceId);
    assert.deepEqual(await journal.listPendingChanges(), []);
});

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
        baseVersion: 'generation:0',
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

test('builds initial changes for existing questions, progress, images, and PDFs', () => {
    const changes = buildInitialSyncChangeInputs({
        exams: {
            exam: {
                name: '既存試験',
                years: [2025],
                genres: ['物理'],
                questions: [{
                    id: '2025001',
                    year: 2025,
                    questionNumber: 1,
                    question: '問題文',
                    options: { a: '選択肢A', b: '選択肢B' },
                }],
            },
        },
        progress: {
            2025001: { status: 'correct', updatedAt: 'ignored' },
        },
        images: {
            'image-key': { contentHash: 'sha256:image' },
        },
        pdfs: {
            'pdf-key': {
                examId: 'exam',
                year: 2025,
                name: 'source.pdf',
                type: 'application/pdf',
                size: 100,
                contentHash: 'sha256:pdf',
            },
        },
    });

    assert.deepEqual(changes.map(change => `${change.entityType}:${change.entityId}`), [
        'exam:exam',
        'question:exam::2025001',
        'progress:2025001',
        'image:image-key',
        'pdf:pdf-key',
    ]);
    assert.deepEqual(changes[1].changedFields, [
        'id',
        'options.a',
        'options.b',
        'question',
        'questionNumber',
        'year',
    ]);
    assert.deepEqual(changes[2].changedFields, ['status']);
    assert.deepEqual(changes[3].blobRefs, [{
        kind: SYNC_ENTITY_TYPES.IMAGE,
        localKey: 'image-key',
        contentHash: 'sha256:image',
    }]);
});

test('allows different question fields and different options to merge automatically', () => {
    const remoteQuestionText = {
        changeId: 'remote-1',
        deviceId: 'remote-device',
        entityType: SYNC_ENTITY_TYPES.QUESTION,
        entityId: 'exam::2025001',
        operation: SYNC_OPERATIONS.UPSERT,
        changedFields: ['question'],
    };
    const pending = [{
        changeId: 'local-1',
        deviceId: 'local-device',
        entityType: SYNC_ENTITY_TYPES.QUESTION,
        entityId: 'exam::2025001',
        operation: SYNC_OPERATIONS.UPSERT,
        changedFields: ['options.a'],
    }, {
        changeId: 'local-2',
        deviceId: 'local-device',
        entityType: SYNC_ENTITY_TYPES.QUESTION,
        entityId: 'exam::2025001',
        operation: SYNC_OPERATIONS.UPSERT,
        changedFields: ['options.b'],
    }];

    assert.equal(canApplyRemoteChangeAutomatically({
        remoteChange: remoteQuestionText,
        pendingLocalChanges: pending,
    }), true);
    assert.deepEqual(findOverlappingSyncFields(['options.a'], ['options.b']), []);
});

test('holds the same option edit as a conflict', () => {
    const remoteChange = {
        changeId: 'remote-1',
        deviceId: 'remote-device',
        entityType: SYNC_ENTITY_TYPES.QUESTION,
        entityId: 'exam::2025001',
        operation: SYNC_OPERATIONS.UPSERT,
        changedFields: ['options.c'],
        payload: { options: { c: 'リモートの文' } },
    };
    const localChange = {
        changeId: 'local-1',
        deviceId: 'local-device',
        entityType: SYNC_ENTITY_TYPES.QUESTION,
        entityId: 'exam::2025001',
        operation: SYNC_OPERATIONS.UPSERT,
        changedFields: ['options.c'],
        payload: { options: { c: 'ローカルの文' } },
    };

    const conflict = detectSyncConflict({
        remoteChange,
        pendingLocalChanges: [localChange],
        detectedAt: '2026-07-26T00:00:00.000Z',
    });

    assert.equal(conflict.reason, 'same-field-edited');
    assert.deepEqual(conflict.conflictingFields, ['options.c']);
    assert.deepEqual(conflict.localChangeIds, ['local-1']);
    assert.equal(conflict.remoteChange.changeId, 'remote-1');
});

test('holds delete versus edit as a conflict and stores its resolution', async () => {
    const remoteChange = {
        changeId: 'remote-delete',
        deviceId: 'remote-device',
        entityType: SYNC_ENTITY_TYPES.QUESTION,
        entityId: 'exam::2025001',
        operation: SYNC_OPERATIONS.DELETE,
        changedFields: [],
    };
    const localChange = {
        changeId: 'local-edit',
        deviceId: 'local-device',
        entityType: SYNC_ENTITY_TYPES.QUESTION,
        entityId: 'exam::2025001',
        operation: SYNC_OPERATIONS.UPSERT,
        changedFields: ['question'],
    };
    const conflict = detectSyncConflict({
        remoteChange,
        pendingLocalChanges: [localChange],
        detectedAt: '2026-07-26T00:00:00.000Z',
    });
    const journal = new SyncJournal(new MemoryStorage(), {
        now: () => '2026-07-26T01:00:00.000Z',
    });

    assert.equal(conflict.reason, 'delete-versus-change');
    assert.deepEqual(conflict.conflictingFields, ['*']);
    await journal.recordConflict(conflict);
    assert.equal((await journal.listConflicts()).length, 1);

    const resolved = await journal.resolveConflict(conflict.conflictId, 'keep-local');
    assert.equal(resolved.status, 'resolved');
    assert.equal(resolved.resolution, 'keep-local');
    assert.deepEqual(await journal.listConflicts(), []);
    assert.equal((await journal.listConflicts({ status: 'resolved' })).length, 1);
});

const buildIncomingChange = overrides => createSyncChange({
    changeId: 'remote-change',
    deviceId: 'remote-device',
    sequence: 1,
    entityType: SYNC_ENTITY_TYPES.QUESTION,
    entityId: 'exam::2025001',
    changedFields: ['question'],
    payload: { question: 'クラウドの問題文' },
    createdAt: '2026-07-26T00:00:00.000Z',
    ...overrides,
});

test('validates incoming schema and rejects unsafe field paths', () => {
    const valid = buildIncomingChange();

    assert.deepEqual(validateIncomingSyncChange(valid), valid);
    assert.throws(() => validateIncomingSyncChange({
        ...valid,
        schemaVersion: 99,
    }), /スキーマ/);
    assert.throws(() => validateIncomingSyncChange({
        ...valid,
        changedFields: ['__proto__.polluted'],
        payload: { __proto__: { polluted: true } },
    }), /安全でない/);
    assert.deepEqual(parseQuestionEntityId('exam::nested::2025001'), {
        examId: 'exam::nested',
        questionId: '2025001',
    });
});

test('applies a non-conflicting incoming change and remembers it', async () => {
    const storage = new MemoryStorage();
    const journal = new SyncJournal(storage, {
        now: () => '2026-07-26T01:00:00.000Z',
    });
    await journal.configure({
        enabled: true,
        deviceId: 'local-device',
        provider: 'google-drive',
        accountId: 'account-1',
    });
    const applied = [];
    const dataStore = {
        async applyChange(change, options) {
            applied.push({ change, options });
        },
    };
    const change = buildIncomingChange();

    const result = await processIncomingSyncChange({
        change,
        journal,
        dataStore,
    });

    assert.equal(result.status, 'applied');
    assert.equal(applied.length, 1);
    assert.equal(await journal.hasAppliedChange(change.changeId), true);

    const duplicate = await processIncomingSyncChange({
        change,
        journal,
        dataStore,
    });
    assert.equal(duplicate.status, 'duplicate');
    assert.equal(applied.length, 1);
});

test('acknowledges an echoed local change without applying it again', async () => {
    const storage = new MemoryStorage();
    const journal = new SyncJournal(storage, {
        uuid: () => 'local-change',
    });
    await journal.configure({
        enabled: true,
        deviceId: 'local-device',
        provider: 'google-drive',
        accountId: 'account-1',
    });
    const [localChange] = await journal.recordChanges([{
        entityType: SYNC_ENTITY_TYPES.PROGRESS,
        entityId: '2025001',
        changedFields: ['status'],
        payload: { status: 'correct' },
    }]);
    let applyCount = 0;

    const result = await processIncomingSyncChange({
        change: localChange,
        journal,
        dataStore: {
            async applyChange() {
                applyCount += 1;
            },
        },
    });

    assert.equal(result.status, 'acknowledged');
    assert.equal(applyCount, 0);
    assert.deepEqual(await journal.listPendingChanges(), []);
});

test('returns needs-blob before applying image metadata without a downloaded file', async () => {
    const journal = new SyncJournal(new MemoryStorage());
    await journal.configure({
        enabled: true,
        deviceId: 'local-device',
        provider: 'google-drive',
        accountId: 'account-1',
    });
    const imageChange = buildIncomingChange({
        entityType: SYNC_ENTITY_TYPES.IMAGE,
        entityId: 'image-key',
        changedFields: ['contentHash', 'localKey'],
        payload: {
            contentHash: 'sha256:image',
            localKey: 'image-key',
        },
        blobRefs: [{
            kind: SYNC_ENTITY_TYPES.IMAGE,
            localKey: 'image-key',
            contentHash: 'sha256:image',
        }],
    });
    let applyCount = 0;

    const result = await processIncomingSyncChange({
        change: imageChange,
        journal,
        dataStore: {
            async applyChange() {
                applyCount += 1;
            },
        },
    });

    assert.equal(result.status, 'needs-blob');
    assert.equal(applyCount, 0);
    assert.equal(await journal.hasAppliedChange(imageChange.changeId), false);
});

test('stores a same-field incoming conflict without applying it', async () => {
    const journal = new SyncJournal(new MemoryStorage(), {
        uuid: () => 'local-change',
    });
    await journal.configure({
        enabled: true,
        deviceId: 'local-device',
        provider: 'google-drive',
        accountId: 'account-1',
    });
    await journal.recordChanges([{
        entityType: SYNC_ENTITY_TYPES.QUESTION,
        entityId: 'exam::2025001',
        changedFields: ['question'],
        payload: { question: 'ローカルの問題文' },
    }]);
    let applyCount = 0;

    const result = await processIncomingSyncChange({
        change: buildIncomingChange(),
        journal,
        dataStore: {
            async applyChange() {
                applyCount += 1;
            },
        },
    });

    assert.equal(result.status, 'conflict');
    assert.equal(applyCount, 0);
    assert.equal((await journal.listConflicts()).length, 1);
});
