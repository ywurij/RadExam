export const SYNC_SCHEMA_VERSION = 1;

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

    return {
        schemaVersion: SYNC_SCHEMA_VERSION,
        changeId: String(changeId),
        deviceId: String(deviceId),
        sequence,
        entityType: String(entityType),
        entityId: String(entityId),
        operation,
        baseVersion: baseVersion || null,
        changedFields: uniqueSortedStrings(changedFields),
        unsetFields: uniqueSortedStrings(unsetFields),
        payload: operation === SYNC_OPERATIONS.DELETE ? null : cloneSyncValue(payload),
        blobRefs: cloneSyncValue(blobRefs || []),
        createdAt: createdAt || new Date().toISOString(),
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

    return changes.filter(Boolean);
};
