export const SYNC_SCHEMA_VERSION = 1;
export const MAX_SYNC_CHANGE_BYTES = 32 * 1024 * 1024;
export const MAX_SYNC_ID_LENGTH = 2048;
export const MAX_SYNC_FIELDS_PER_CHANGE = 256;
export const MAX_SYNC_BLOB_REFS_PER_CHANGE = 256;

export const SYNC_ENTITY_TYPES = Object.freeze({
    EXAM: 'exam',
    QUESTION: 'question',
    PROGRESS: 'progress',
    IMAGE: 'image',
    PDF: 'pdf',
    PREFERENCE: 'preference',
});

export const SYNC_OPERATIONS = Object.freeze({
    UPSERT: 'upsert',
    DELETE: 'delete',
});

export const SYNC_PROVIDERS = Object.freeze({
    GOOGLE_DRIVE: 'google-drive',
    ONE_DRIVE: 'one-drive',
});

export const QUESTION_SYNC_FIELDS = Object.freeze([
    'id',
    'year',
    'questionNumber',
    'question',
    'answer',
    'explanation',
    'genre',
    'images',
    'sourcePages',
]);

const isPlainObject = value => (
    value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
);

const sortForComparison = value => {
    if (Array.isArray(value)) return value.map(sortForComparison);
    if (!isPlainObject(value)) return value;
    return Object.keys(value).sort().reduce((result, key) => {
        result[key] = sortForComparison(value[key]);
        return result;
    }, {});
};

const valuesEqual = (left, right) => (
    JSON.stringify(sortForComparison(left)) === JSON.stringify(sortForComparison(right))
);

const cloneSyncValue = value => {
    if (value === undefined) return undefined;
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
};

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const UNSAFE_PATH_PARTS = new Set(['__proto__', 'prototype', 'constructor']);

const assertSafeFieldPath = path => {
    const parts = String(path).split('.');
    if (parts.some(part => !part || UNSAFE_PATH_PARTS.has(part))) {
        throw new Error(`安全でない同期フィールドです: ${path}`);
    }
    return String(path);
};

const setPath = (target, path, value) => {
    const parts = path.split('.');
    let current = target;
    for (let index = 0; index < parts.length - 1; index += 1) {
        const part = parts[index];
        if (!isPlainObject(current[part])) current[part] = {};
        current = current[part];
    }
    current[parts.at(-1)] = cloneSyncValue(value);
};

const deletePath = (target, path) => {
    const parts = path.split('.');
    let current = target;
    for (let index = 0; index < parts.length - 1; index += 1) {
        current = current?.[parts[index]];
        if (!isPlainObject(current)) return;
    }
    delete current[parts.at(-1)];
};

const readPath = (source, path) => (
    path.split('.').reduce((value, part) => value?.[part], source)
);

const uniqueSortedStrings = values => (
    [...new Set((values || []).map(value => String(value)).filter(Boolean))].sort()
);

export const buildQuestionEntityId = (examId, questionId) => (
    `${String(examId)}::${String(questionId)}`
);

export const diffEntityFields = (previousValue = {}, nextValue = {}, fields) => {
    const candidateFields = fields || uniqueSortedStrings([
        ...Object.keys(previousValue || {}),
        ...Object.keys(nextValue || {}),
    ]);
    const changedFields = [];
    const unsetFields = [];
    const payload = {};

    for (const field of candidateFields) {
        const previousHasField = hasOwn(previousValue, field);
        const nextHasField = hasOwn(nextValue, field);
        if (previousHasField === nextHasField && valuesEqual(previousValue?.[field], nextValue?.[field])) {
            continue;
        }

        changedFields.push(field);
        if (!nextHasField) {
            unsetFields.push(field);
            continue;
        }
        payload[field] = cloneSyncValue(nextValue[field]);
    }

    return {
        changedFields: uniqueSortedStrings(changedFields),
        unsetFields: uniqueSortedStrings(unsetFields),
        payload,
    };
};

export const diffQuestionFields = (previousQuestion = {}, nextQuestion = {}) => {
    const questionFields = uniqueSortedStrings([
        ...QUESTION_SYNC_FIELDS,
        ...Object.keys(previousQuestion || {}),
        ...Object.keys(nextQuestion || {}),
    ]).filter(field => field !== 'options');
    const baseDiff = diffEntityFields(previousQuestion, nextQuestion, questionFields);
    const previousOptions = isPlainObject(previousQuestion?.options) ? previousQuestion.options : {};
    const nextOptions = isPlainObject(nextQuestion?.options) ? nextQuestion.options : {};
    const optionKeys = uniqueSortedStrings([
        ...Object.keys(previousOptions),
        ...Object.keys(nextOptions),
    ]);
    const payload = cloneSyncValue(baseDiff.payload);
    const changedFields = [...baseDiff.changedFields];
    const unsetFields = [...baseDiff.unsetFields];

    for (const optionKey of optionKeys) {
        const previousHasOption = hasOwn(previousOptions, optionKey);
        const nextHasOption = hasOwn(nextOptions, optionKey);
        if (previousHasOption === nextHasOption && valuesEqual(previousOptions[optionKey], nextOptions[optionKey])) {
            continue;
        }

        const fieldPath = `options.${optionKey}`;
        changedFields.push(fieldPath);
        if (!nextHasOption) {
            unsetFields.push(fieldPath);
            continue;
        }
        if (!payload.options) payload.options = {};
        payload.options[optionKey] = cloneSyncValue(nextOptions[optionKey]);
    }

    return {
        changedFields: uniqueSortedStrings(changedFields),
        unsetFields: uniqueSortedStrings(unsetFields),
        payload,
    };
};

export const applySyncFieldDelta = (currentValue = {}, change) => {
    if (change?.operation === SYNC_OPERATIONS.DELETE) return null;
    const nextValue = cloneSyncValue(currentValue) || {};

    for (const field of change?.changedFields || []) {
        if ((change?.unsetFields || []).includes(field)) continue;
        setPath(nextValue, field, readPath(change?.payload, field));
    }
    for (const field of change?.unsetFields || []) {
        deletePath(nextValue, field);
    }

    return nextValue;
};

export const collectQuestionBlobRefs = question => {
    const refs = [];
    for (const image of question?.images || []) {
        const localKey = image?.storageKey
            || (typeof image?.path === 'string' && image.path.startsWith('local-image://')
                ? image.path.slice('local-image://'.length)
                : '');
        if (localKey) {
            refs.push({
                kind: SYNC_ENTITY_TYPES.IMAGE,
                localKey,
                ...(image?.contentHash ? { contentHash: image.contentHash } : {}),
            });
        }
    }
    for (const sourcePage of question?.sourcePages || []) {
        if (sourcePage?.pdfKey) {
            refs.push({
                kind: SYNC_ENTITY_TYPES.PDF,
                localKey: sourcePage.pdfKey,
                ...(sourcePage?.contentHash ? { contentHash: sourcePage.contentHash } : {}),
            });
        }
    }

    const seen = new Set();
    return refs.filter(ref => {
        const key = `${ref.kind}:${ref.localKey}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

export const createSyncChange = ({
    changeId,
    deviceId,
    sequence,
    entityType,
    entityId,
    operation = SYNC_OPERATIONS.UPSERT,
    baseVersion = null,
    changedFields = [],
    unsetFields = [],
    payload = {},
    blobRefs = [],
    createdAt,
}) => {
    if (!changeId || !deviceId || !entityType || !entityId) {
        throw new Error('同期変更にはchangeId、deviceId、entityType、entityIdが必要です。');
    }
    if (!Number.isSafeInteger(sequence) || sequence < 1) {
        throw new Error('同期変更のsequenceは1以上の整数である必要があります。');
    }
    if (!Object.values(SYNC_OPERATIONS).includes(operation)) {
        throw new Error(`未対応の同期操作です: ${operation}`);
    }

    const normalizedChangedFields = uniqueSortedStrings(changedFields).map(assertSafeFieldPath);
    const normalizedUnsetFields = uniqueSortedStrings(unsetFields).map(assertSafeFieldPath);

    return {
        schemaVersion: SYNC_SCHEMA_VERSION,
        changeId: String(changeId),
        deviceId: String(deviceId),
        sequence,
        entityType: String(entityType),
        entityId: String(entityId),
        operation,
        baseVersion: baseVersion || null,
        changedFields: normalizedChangedFields,
        unsetFields: normalizedUnsetFields,
        payload: operation === SYNC_OPERATIONS.DELETE ? null : cloneSyncValue(payload),
        blobRefs: cloneSyncValue(blobRefs || []),
        createdAt: createdAt || new Date().toISOString(),
    };
};

export const validateIncomingSyncChange = change => {
    if (!change || typeof change !== 'object') {
        throw new Error('受信した同期変更の形式が不正です。');
    }
    if (Number(change.schemaVersion) !== SYNC_SCHEMA_VERSION) {
        throw new Error(`未対応の同期スキーマです: ${change.schemaVersion}`);
    }
    if (!Object.values(SYNC_ENTITY_TYPES).includes(change.entityType)) {
        throw new Error(`未対応の同期データ種別です: ${change.entityType}`);
    }
    const normalized = createSyncChange(change);
    if (
        normalized.changeId.length > MAX_SYNC_ID_LENGTH
        || normalized.deviceId.length > MAX_SYNC_ID_LENGTH
        || normalized.entityId.length > MAX_SYNC_ID_LENGTH
    ) {
        throw new Error('受信した同期変更のIDが長すぎます。');
    }
    if (
        normalized.changedFields.length > MAX_SYNC_FIELDS_PER_CHANGE
        || normalized.unsetFields.length > MAX_SYNC_FIELDS_PER_CHANGE
        || normalized.changedFields.some(field => field.length > 256)
        || normalized.unsetFields.some(field => field.length > 256)
    ) {
        throw new Error('受信した同期変更のフィールド数または名前が上限を超えています。');
    }
    if (!Array.isArray(normalized.blobRefs) || normalized.blobRefs.length > MAX_SYNC_BLOB_REFS_PER_CHANGE) {
        throw new Error('受信した同期変更の添付ファイル参照が上限を超えています。');
    }
    if (new TextEncoder().encode(JSON.stringify(normalized)).byteLength > MAX_SYNC_CHANGE_BYTES) {
        throw new Error('受信した同期変更のサイズが上限を超えています。');
    }
    if (normalized.operation === SYNC_OPERATIONS.UPSERT) {
        if (!isPlainObject(normalized.payload)) {
            throw new Error('更新変更のpayloadはオブジェクトである必要があります。');
        }
        const unsetFields = new Set(normalized.unsetFields);
        for (const field of unsetFields) {
            if (!normalized.changedFields.includes(field)) {
                throw new Error(`unsetFieldsがchangedFieldsに含まれていません: ${field}`);
            }
        }
        for (const field of normalized.changedFields) {
            if (!unsetFields.has(field) && readPath(normalized.payload, field) === undefined) {
                throw new Error(`同期変更のpayloadにフィールドがありません: ${field}`);
            }
        }
    }
    return normalized;
};

export const parseQuestionEntityId = entityId => {
    const value = String(entityId || '');
    const separatorIndex = value.lastIndexOf('::');
    if (separatorIndex < 1 || separatorIndex === value.length - 2) {
        throw new Error(`問題の同期IDが不正です: ${value}`);
    }
    return {
        examId: value.slice(0, separatorIndex),
        questionId: value.slice(separatorIndex + 2),
    };
};

export const buildQuestionSyncChangeInput = ({
    examId,
    previousQuestion,
    nextQuestion,
    baseVersion = null,
}) => {
    if (!nextQuestion?.id) return null;
    const diff = diffQuestionFields(previousQuestion || {}, nextQuestion);
    if (diff.changedFields.length === 0) return null;

    return {
        entityType: SYNC_ENTITY_TYPES.QUESTION,
        entityId: buildQuestionEntityId(examId, nextQuestion.id),
        operation: SYNC_OPERATIONS.UPSERT,
        baseVersion,
        ...diff,
        blobRefs: diff.changedFields.includes('images')
            || diff.changedFields.includes('sourcePages')
            ? collectQuestionBlobRefs(nextQuestion)
            : [],
    };
};

export const buildUpsertSyncChangeInput = ({
    entityType,
    entityId,
    previousValue = {},
    nextValue = {},
    fields,
    baseVersion = null,
    blobRefs = [],
}) => {
    const diff = diffEntityFields(previousValue, nextValue, fields);
    if (diff.changedFields.length === 0) return null;
    return {
        entityType,
        entityId,
        operation: SYNC_OPERATIONS.UPSERT,
        baseVersion,
        ...diff,
        blobRefs: cloneSyncValue(blobRefs),
    };
};

export const buildDeleteSyncChangeInput = ({
    entityType,
    entityId,
    baseVersion = null,
}) => ({
    entityType,
    entityId,
    operation: SYNC_OPERATIONS.DELETE,
    baseVersion,
    changedFields: [],
    unsetFields: [],
    payload: null,
    blobRefs: [],
});

export const buildInitialSyncChangeInputs = ({
    exams = {},
    progress = {},
    images = {},
    pdfs = {},
    preferences = {},
}) => {
    const changes = [];

    for (const [examId, exam] of Object.entries(exams || {})) {
        changes.push(buildUpsertSyncChangeInput({
            entityType: SYNC_ENTITY_TYPES.EXAM,
            entityId: examId,
            nextValue: exam,
            fields: ['name', 'years', 'genres'],
        }));
        for (const question of exam?.questions || []) {
            changes.push(buildQuestionSyncChangeInput({
                examId,
                nextQuestion: question,
            }));
        }
    }

    for (const [questionId, value] of Object.entries(progress || {})) {
        changes.push(buildUpsertSyncChangeInput({
            entityType: SYNC_ENTITY_TYPES.PROGRESS,
            entityId: questionId,
            nextValue: value,
            fields: Object.keys(value || {}).filter(field => field !== 'updatedAt'),
        }));
    }

    for (const [localKey, descriptor] of Object.entries(images || {})) {
        const nextValue = {
            localKey,
            ...(descriptor?.contentHash ? { contentHash: descriptor.contentHash } : {}),
        };
        changes.push(buildUpsertSyncChangeInput({
            entityType: SYNC_ENTITY_TYPES.IMAGE,
            entityId: localKey,
            nextValue,
            fields: ['localKey', 'contentHash'],
            blobRefs: [{
                kind: SYNC_ENTITY_TYPES.IMAGE,
                localKey,
                ...(descriptor?.contentHash ? { contentHash: descriptor.contentHash } : {}),
            }],
        }));
    }

    for (const [localKey, value] of Object.entries(pdfs || {})) {
        changes.push(buildUpsertSyncChangeInput({
            entityType: SYNC_ENTITY_TYPES.PDF,
            entityId: localKey,
            nextValue: value,
            fields: ['examId', 'year', 'name', 'type', 'size', 'contentHash'],
            blobRefs: [{
                kind: SYNC_ENTITY_TYPES.PDF,
                localKey,
                ...(value?.contentHash ? { contentHash: value.contentHash } : {}),
            }],
        }));
    }

    for (const [preferenceId, value] of Object.entries(preferences || {})) {
        changes.push(buildUpsertSyncChangeInput({
            entityType: SYNC_ENTITY_TYPES.PREFERENCE,
            entityId: preferenceId,
            nextValue: value,
            fields: Object.keys(value || {}),
        }));
    }

    return changes.filter(Boolean);
};
