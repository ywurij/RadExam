import localforage from 'localforage';
import {
    createBackupArchiveBlob,
    parseBackupArchiveBlob,
} from '@/lib/backupArchive.mjs';
import {
    collectReferencedImageKeys,
    collectReferencedPdfKeys,
    findMissingBackupImageKeys,
    findMissingBackupPdfKeys,
} from '@/lib/backupData.mjs';
import {
    buildDeleteSyncChangeInput,
    buildInitialSyncChangeInputs,
    buildQuestionEntityId,
    buildQuestionSyncChangeInput,
    buildUpsertSyncChangeInput,
    applySyncFieldDelta,
    parseQuestionEntityId,
    SYNC_ENTITY_TYPES,
    SYNC_OPERATIONS,
    SYNC_PROVIDERS,
} from '@/lib/sync/syncProtocol.mjs';
import {
    configureLocalSyncJournal,
    disconnectLocalSyncJournal,
    getLocalSyncJournalConfig,
    listPendingLocalSyncChanges,
    localSyncJournal,
    markLocalSyncReconciliationRequired,
    recordLocalSyncChanges,
} from '@/lib/sync/localSyncJournal';
import { processIncomingSyncChange } from '@/lib/sync/syncReceiver.mjs';
import { runSyncCycle } from '@/lib/sync/syncEngine.mjs';

// --- インスタンスの設定 ---

// 既存ユーザーのIndexedDBを引き続き読めるよう、内部DB名は旧名称のまま維持する。
// この値は画面表示やエクスポートファイル名には使用しない。

// カスタム試験データを保存するためのストア
const examsStore = localforage.createInstance({
    name: 'RadTestLocal',
    storeName: 'custom_exams',
    description: 'ユーザーが独自に追加した試験データを保存するストア'
});

// ユーザーの回答状況、いいね、メモ（ノート）を保存するためのストア
const progressStore = localforage.createInstance({
    name: 'RadTestLocal',
    storeName: 'user_progress',
    description: 'ユーザーの演習進捗、お気に入り、ノートを保存するストア'
});

// 画像データを問題JSONから分離して保存するためのストア
const imageStore = localforage.createInstance({
    name: 'RadTestLocal',
    storeName: 'exam_images',
    description: 'ローカル試験画像を保存するストア'
});

const pdfStore = localforage.createInstance({
    name: 'RadTestLocal',
    storeName: 'exam_pdfs',
    description: '試験登録に使用したPDFを保存するストア'
});

const LOCAL_IMAGE_PREFIX = 'local-image://';
const RESUMABLE_SESSIONS_KEY = 'radexam_sessions';
const LEGACY_RESUMABLE_SESSION_KEY = 'radexam_session';
const RESUMABLE_SESSION_ENTITY_PREFIX = 'resumable-session:';
const MAX_RESUMABLE_SESSIONS = 4;

const isDataUrl = (value) => typeof value === 'string' && value.startsWith('data:');
const isLocalImageRef = (value) => typeof value === 'string' && value.startsWith(LOCAL_IMAGE_PREFIX);
const buildLocalImageRef = (key) => `${LOCAL_IMAGE_PREFIX}${key}`;
const extractLocalImageKey = (value) => isLocalImageRef(value) ? value.slice(LOCAL_IMAGE_PREFIX.length) : '';
const buildExamImageKeyPrefix = (examId) => `${examId}::`;
const buildExamPdfKeyPrefix = (examId) => `${examId}::`;
const bytesToHex = bytes => (
    Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
);
const calculateBlobHash = async (blob) => {
    if (!(blob instanceof Blob) || !globalThis.crypto?.subtle) return '';
    const digest = await globalThis.crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return `sha256:${bytesToHex(new Uint8Array(digest))}`;
};
const recordSyncChangesSafely = async (changes) => {
    const candidates = (changes || []).filter(Boolean);
    if (candidates.length === 0) return [];
    try {
        const recorded = await recordLocalSyncChanges(candidates);
        if (recorded.length > 0) {
            globalThis.window?.dispatchEvent(new CustomEvent('radexam-local-sync-change', {
                detail: { changeCount: recorded.length },
            }));
        }
        return recorded;
    } catch (error) {
        console.error('Failed to record local sync changes:', error);
        try {
            await markLocalSyncReconciliationRequired('local-change-journal-error');
        } catch (markError) {
            console.error('Failed to mark sync reconciliation as required:', markError);
        }
        return [];
    }
};
const markSyncReconciliationSafely = async (reason) => {
    try {
        await markLocalSyncReconciliationRequired(reason);
    } catch (error) {
        console.error('Failed to mark sync reconciliation as required:', error);
    }
};
const normalizeResumableSessions = sessions => (
    (Array.isArray(sessions) ? sessions : [])
        .filter(session => (
            session
            && typeof session === 'object'
            && session.id
            && session.mode !== 'search'
            && session.interrupted === true
        ))
        .sort((left, right) => (
            (Number(right.timestamp) || 0) - (Number(left.timestamp) || 0)
        ))
        .slice(0, MAX_RESUMABLE_SESSIONS)
);
const readLocalStorageJson = (key, fallback) => {
    try {
        const raw = globalThis.localStorage?.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch {
        return fallback;
    }
};
const writeLocalResumableSessions = sessions => {
    const normalized = normalizeResumableSessions(sessions).map(
        session => JSON.parse(JSON.stringify(session))
    );
    globalThis.localStorage?.setItem(
        RESUMABLE_SESSIONS_KEY,
        JSON.stringify(normalized)
    );
    globalThis.window?.dispatchEvent(new CustomEvent(
        'radexam-resumable-sessions-changed',
        { detail: { sessions: normalized } }
    ));
    return normalized;
};
const resumableSessionEntityId = sessionId => (
    `${RESUMABLE_SESSION_ENTITY_PREFIX}${String(sessionId)}`
);
const resumableSessionIdFromEntity = entityId => (
    String(entityId || '').startsWith(RESUMABLE_SESSION_ENTITY_PREFIX)
        ? String(entityId).slice(RESUMABLE_SESSION_ENTITY_PREFIX.length)
        : ''
);

export const getLocalResumableSessions = () => (
    normalizeResumableSessions(
        readLocalStorageJson(RESUMABLE_SESSIONS_KEY, [])
    )
);

export const replaceLocalResumableSessions = async sessions => {
    const previous = getLocalResumableSessions();
    const next = writeLocalResumableSessions(sessions);
    const syncConfig = await getLocalSyncJournalConfig();
    if (
        syncConfig.enabled
        && syncConfig.resumableSessionsInitialized !== true
    ) {
        const recorded = await recordSyncChangesSafely(next.map(session => (
            buildUpsertSyncChangeInput({
                entityType: SYNC_ENTITY_TYPES.PREFERENCE,
                entityId: resumableSessionEntityId(session.id),
                nextValue: session,
                fields: Object.keys(session),
            })
        )));
        if (next.length === 0 || recorded.length === next.length) {
            await configureLocalSyncJournal({
                resumableSessionsInitialized: true,
            });
        }
        return next;
    }
    const previousById = new Map(previous.map(session => [String(session.id), session]));
    const nextById = new Map(next.map(session => [String(session.id), session]));
    const changes = [];

    for (const [sessionId, session] of nextById) {
        changes.push(buildUpsertSyncChangeInput({
            entityType: SYNC_ENTITY_TYPES.PREFERENCE,
            entityId: resumableSessionEntityId(sessionId),
            previousValue: previousById.get(sessionId) || {},
            nextValue: session,
        }));
    }
    for (const sessionId of previousById.keys()) {
        if (!nextById.has(sessionId)) {
            changes.push(buildDeleteSyncChangeInput({
                entityType: SYNC_ENTITY_TYPES.PREFERENCE,
                entityId: resumableSessionEntityId(sessionId),
            }));
        }
    }
    await recordSyncChangesSafely(changes);
    return next;
};

export const saveLocalResumableSession = async session => {
    if (!session?.id) return getLocalResumableSessions();
    const current = getLocalResumableSessions();
    const next = current.filter(item => String(item.id) !== String(session.id));
    next.unshift(session);
    return replaceLocalResumableSessions(next);
};

export const deleteLocalResumableSession = async sessionId => (
    replaceLocalResumableSessions(
        getLocalResumableSessions().filter(
            session => String(session.id) !== String(sessionId)
        )
    )
);

export const migrateLegacyResumableSession = async () => {
    const legacy = readLocalStorageJson(LEGACY_RESUMABLE_SESSION_KEY, null);
    if (!legacy) return getLocalResumableSessions();
    const migrated = {
        ...legacy,
        id: legacy.id
            || (legacy.timestamp
                ? `migrated-${legacy.timestamp}`
                : `migrated-${Date.now()}`),
        name: legacy.name || '移行されたセッション',
        interrupted: true,
    };
    globalThis.localStorage?.removeItem(LEGACY_RESUMABLE_SESSION_KEY);
    return saveLocalResumableSession(migrated);
};
const resolveImageLegend = (source) => (
    Object.prototype.hasOwnProperty.call(source, 'legend')
        ? String(source.legend ?? '')
        : ''
);
const buildExamImageKey = (examId, questionId, imageIndex) => {
    const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    return `${buildExamImageKeyPrefix(examId)}${questionId}::${imageIndex}::${suffix}`;
};

const dataUrlToBlob = async (dataUrl) => {
    const response = await fetch(dataUrl);
    return response.blob();
};

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
        if (typeof reader.result === 'string') {
            resolve(reader.result);
            return;
        }
        reject(new Error('Failed to convert blob to data URL.'));
    };
    reader.onerror = () => reject(reader.error || new Error('Failed to read blob.'));
    reader.readAsDataURL(blob);
});

const binaryValueToDataUrl = async (value, label = '保存データ') => {
    if (isDataUrl(value)) return value;
    if (value instanceof Blob) return blobToDataUrl(value);
    if (value instanceof ArrayBuffer) return blobToDataUrl(new Blob([value]));
    if (ArrayBuffer.isView(value)) {
        return blobToDataUrl(new Blob([
            value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
        ]));
    }
    throw new Error(`${label}をバックアップ用データへ変換できませんでした。`);
};

const normalizeQuestionId = (question) => {
    if (!question || typeof question !== 'object') return question;

    const year = Number(question.year);
    const rawId = String(question.id ?? '').trim();
    if (!rawId) return question;

    if (/^\d{7}$/.test(rawId)) {
        return question;
    }

    const questionNumber = Number(question.questionNumber ?? rawId);
    if (!Number.isInteger(year) || !Number.isInteger(questionNumber)) {
        return question;
    }

    return {
        ...question,
        id: `${year}${String(questionNumber).padStart(3, '0')}`,
        questionNumber,
    };
};

const normalizeStoredImage = async (examId, questionId, image, imageIndex) => {
    const source = image && typeof image === 'object' ? image : {};
    const legend = resolveImageLegend(source);
    const metadata = {
        ...(source.layout ? { layout: source.layout } : {}),
        ...(source.legendLayout ? { legendLayout: source.legendLayout } : {}),
        ...(source.contentHash ? { contentHash: source.contentHash } : {}),
    };
    const storageKey = source.storageKey || extractLocalImageKey(source.path);
    const originalPath = typeof source.path === 'string' ? source.path : '';

    if (storageKey) {
        let contentHash = source.contentHash || '';
        if (!contentHash) {
            const storedBlob = await imageStore.getItem(storageKey);
            contentHash = storedBlob ? await calculateBlobHash(storedBlob) : '';
        }
        return {
            path: buildLocalImageRef(storageKey),
            legend,
            storageKey,
            ...metadata,
            ...(contentHash ? { contentHash } : {}),
        };
    }

    if (isDataUrl(originalPath)) {
        const imageKey = buildExamImageKey(examId, questionId, imageIndex);
        const blob = await dataUrlToBlob(originalPath);
        const contentHash = await calculateBlobHash(blob);
        await imageStore.setItem(imageKey, blob);
        return {
            path: buildLocalImageRef(imageKey),
            legend,
            storageKey: imageKey,
            ...metadata,
            ...(contentHash ? { contentHash } : {}),
        };
    }

    return {
        path: originalPath,
        legend,
        storageKey: '',
        ...metadata
    };
};

const prepareQuestionsForStorage = async (examId, questions) => {
    const usedImageKeys = new Set();

    const preparedQuestions = await Promise.all(
        questions.map(async (question) => {
            const normalizedQuestion = normalizeQuestionId(question);
            const images = Array.isArray(normalizedQuestion.images) ? normalizedQuestion.images : [];

            const preparedImages = await Promise.all(
                images.map((image, imageIndex) => normalizeStoredImage(examId, normalizedQuestion.id, image, imageIndex))
            );

            preparedImages.forEach((image) => {
                if (image.storageKey) {
                    usedImageKeys.add(image.storageKey);
                }
            });

            return {
                ...normalizedQuestion,
                images: preparedImages.map(({ storageKey: _storageKey, ...image }) => image)
            };
        })
    );

    return { preparedQuestions, usedImageKeys };
};

const cleanupOrphanExamImages = async (examId, usedImageKeys) => {
    const prefix = buildExamImageKeyPrefix(examId);
    const deleteTargets = [];

    await imageStore.iterate((_value, key) => {
        if (key.startsWith(prefix) && !usedImageKeys.has(key)) {
            deleteTargets.push(key);
        }
    });

    await Promise.all(deleteTargets.map((key) => imageStore.removeItem(key)));
    return deleteTargets;
};

const hydrateQuestionImages = async (question) => {
    const images = Array.isArray(question.images) ? question.images : [];

    const hydratedImages = await Promise.all(images.map(async (image) => {
        const source = image && typeof image === 'object' ? image : {};
        const metadata = {
            ...(source.layout ? { layout: source.layout } : {}),
            ...(source.legendLayout ? { legendLayout: source.legendLayout } : {}),
            ...(source.contentHash ? { contentHash: source.contentHash } : {}),
        };
        const storageKey = extractLocalImageKey(source.path);
        if (!storageKey) {
            return {
                path: source.path || '',
                legend: resolveImageLegend(source),
                ...metadata
            };
        }

        const blob = await imageStore.getItem(storageKey);
        if (!blob) {
            return {
                path: '',
                legend: resolveImageLegend(source),
                storageKey,
                ...metadata
            };
        }

        const path = await blobToDataUrl(blob);
        return {
            path,
            legend: resolveImageLegend(source),
            storageKey,
            ...metadata
        };
    }));

    return {
        ...question,
        images: hydratedImages
    };
};

const collectStoredImageDescriptors = (questions = []) => {
    const descriptors = new Map();
    for (const question of questions) {
        for (const image of question?.images || []) {
            const localKey = image?.storageKey || extractLocalImageKey(image?.path);
            if (!localKey) continue;
            descriptors.set(localKey, {
                localKey,
                ...(image?.contentHash ? { contentHash: image.contentHash } : {}),
            });
        }
    }
    return descriptors;
};

const buildExamSyncChanges = (previousExam, nextExam, deletedImageKeys = []) => {
    const changes = [
        buildUpsertSyncChangeInput({
            entityType: SYNC_ENTITY_TYPES.EXAM,
            entityId: nextExam.id,
            previousValue: previousExam || {},
            nextValue: nextExam,
            fields: ['name', 'years', 'genres'],
        }),
    ];
    const previousQuestions = new Map(
        (previousExam?.questions || []).map(question => [String(question.id), question])
    );
    const nextQuestions = new Map(
        (nextExam.questions || []).map(question => [String(question.id), question])
    );

    for (const [questionId, question] of nextQuestions) {
        changes.push(buildQuestionSyncChangeInput({
            examId: nextExam.id,
            previousQuestion: previousQuestions.get(questionId),
            nextQuestion: question,
        }));
    }
    for (const questionId of previousQuestions.keys()) {
        if (!nextQuestions.has(questionId)) {
            changes.push(buildDeleteSyncChangeInput({
                entityType: SYNC_ENTITY_TYPES.QUESTION,
                entityId: buildQuestionEntityId(nextExam.id, questionId),
            }));
        }
    }

    const previousImages = collectStoredImageDescriptors(previousExam?.questions);
    const nextImages = collectStoredImageDescriptors(nextExam.questions);
    for (const [localKey, descriptor] of nextImages) {
        const previousDescriptor = previousImages.get(localKey);
        if (previousDescriptor?.contentHash === descriptor.contentHash && previousDescriptor) continue;
        changes.push(buildUpsertSyncChangeInput({
            entityType: SYNC_ENTITY_TYPES.IMAGE,
            entityId: localKey,
            previousValue: previousDescriptor || {},
            nextValue: descriptor,
            fields: ['localKey', 'contentHash'],
            blobRefs: [{
                kind: SYNC_ENTITY_TYPES.IMAGE,
                localKey,
                ...(descriptor.contentHash ? { contentHash: descriptor.contentHash } : {}),
            }],
        }));
    }
    for (const localKey of deletedImageKeys) {
        changes.push(buildDeleteSyncChangeInput({
            entityType: SYNC_ENTITY_TYPES.IMAGE,
            entityId: localKey,
        }));
    }
    return changes;
};

const collectStoreEntries = async store => {
    const entries = [];
    await store.iterate((value, key) => {
        entries.push([String(key), value]);
    });
    return entries;
};

const collectLocalSyncSeedData = async () => {
    const exams = {};
    const progress = {};
    const images = {};
    const pdfs = {};
    const preferences = {};

    for (const [examId, exam] of await collectStoreEntries(examsStore)) {
        const questions = await Promise.all((exam?.questions || []).map(async question => {
            const enrichedImages = await Promise.all((question?.images || []).map(async image => {
                const localKey = image?.storageKey || extractLocalImageKey(image?.path);
                if (!localKey) return image;
                let contentHash = image?.contentHash || '';
                if (!contentHash) {
                    const blob = await imageStore.getItem(localKey);
                    if (!blob) {
                        throw new Error(`同期対象の画像を読み出せませんでした: ${localKey}`);
                    }
                    contentHash = await calculateBlobHash(blob);
                }
                images[localKey] = {
                    localKey,
                    ...(contentHash ? { contentHash } : {}),
                };
                return {
                    ...image,
                    ...(contentHash ? { contentHash } : {}),
                };
            }));
            return {
                ...question,
                images: enrichedImages,
            };
        }));
        exams[examId] = {
            ...exam,
            questions,
        };
    }

    for (const [questionId, value] of await collectStoreEntries(progressStore)) {
        progress[questionId] = value;
    }

    for (const [localKey, value] of await collectStoreEntries(pdfStore)) {
        let contentHash = value?.contentHash || '';
        if (!value?.blob) {
            throw new Error(`同期対象のPDFを読み出せませんでした: ${localKey}`);
        }
        if (!contentHash) contentHash = await calculateBlobHash(value.blob);
        pdfs[localKey] = {
            examId: value?.examId,
            year: value?.year,
            name: value?.name,
            type: value?.type,
            size: value?.size,
            ...(contentHash ? { contentHash } : {}),
        };
    }

    for (const session of getLocalResumableSessions()) {
        preferences[resumableSessionEntityId(session.id)] = session;
    }

    return { exams, progress, images, pdfs, preferences };
};

/**
 * Google認証後の接続情報だけを先に保存する。
 * 端末データの走査は行わないため、接続完了をすぐ画面へ反映できる。
 */
export const connectLocalSyncTracking = async ({
    provider,
    accountId,
    deviceName,
    accountLabel,
    cloudSyncId,
}) => {
    const supportedProviders = Object.values(SYNC_PROVIDERS);
    if (!supportedProviders.includes(provider)) {
        throw new Error(`未対応の同期先です: ${provider || '未指定'}`);
    }
    if (!accountId) throw new Error('同期を開始するにはアカウントIDが必要です。');

    const currentConfig = await getLocalSyncJournalConfig();
    if (
        currentConfig.enabled
        && (
            currentConfig.provider !== provider
            || String(currentConfig.accountId) !== String(accountId)
        )
    ) {
        throw new Error('同期中のクラウドとは別のサービスまたはアカウントです。先に同期を解除してください。');
    }
    if (currentConfig.enabled && currentConfig.bootstrapCompleted) {
        const config = cloudSyncId && !currentConfig.cloudSyncId
            ? await configureLocalSyncJournal({ cloudSyncId })
            : currentConfig;
        return {
            alreadyInitialized: true,
            queuedChanges: (await listPendingLocalSyncChanges()).length,
            config,
        };
    }

    const connectedAt = new Date().toISOString();
    const config = await configureLocalSyncJournal({
        enabled: true,
        provider,
        accountId: String(accountId),
        ...(deviceName ? { deviceName } : {}),
        ...(accountLabel ? { accountLabel } : {}),
        ...(cloudSyncId ? { cloudSyncId } : {}),
        bootstrapCompleted: false,
        connectedAt,
    });
    return {
        alreadyInitialized: false,
        queuedChanges: (await listPendingLocalSyncChanges()).length,
        config,
    };
};

/**
 * 接続済み端末のデータを初回同期キューへ登録する。
 * Google認証の完了後に別処理として呼び出し、準備の進捗を区別する。
 */
export const initializeLocalSyncTracking = async options => {
    const connection = await connectLocalSyncTracking(options);
    if (connection.config.bootstrapCompleted) return connection;

    const seedData = await collectLocalSyncSeedData();
    const recordedChanges = await recordLocalSyncChanges(
        buildInitialSyncChangeInputs(seedData)
    );
    const initializedAt = new Date().toISOString();
    const config = await configureLocalSyncJournal({
        bootstrapCompleted: true,
        bootstrapCompletedAt: initializedAt,
        resumableSessionsInitialized: true,
        reconciliationRequired: false,
        reconciliationReason: null,
        reconciliationMarkedAt: null,
    });

    return {
        alreadyInitialized: false,
        queuedChanges: recordedChanges.length,
        config,
    };
};

export const disconnectLocalSyncTracking = options => disconnectLocalSyncJournal(options);

/**
 * 開発中の端末復元テスト用に、クラウドへ削除変更を送らずローカルだけを空にする。
 * 同期履歴も消すため、次回接続時はクラウドの全体データを新しい端末として受信する。
 */
export const clearLocalAppDataForDevelopment = async () => {
    await Promise.all([
        examsStore.clear(),
        progressStore.clear(),
        imageStore.clear(),
        pdfStore.clear(),
    ]);
    writeLocalResumableSessions([]);
    globalThis.localStorage?.removeItem('radexam_last_settings');
    await disconnectLocalSyncJournal({ discardPending: true });
};

const rebuildExamMetadata = exam => ({
    ...exam,
    years: [...new Set(
        (exam?.questions || []).map(question => question.year).filter(Boolean)
    )].map(Number).sort((left, right) => right - left),
    genres: [...new Set(
        (exam?.questions || []).map(question => question.genre).filter(Boolean)
    )].sort(),
});

const normalizeReceivedBlob = (value, type = 'application/octet-stream') => {
    if (value instanceof Blob) return value;
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
        return new Blob([value], { type });
    }
    throw new Error('クラウドから取得したファイルの形式が不正です。');
};

const expectedBlobHashForChange = change => (
    change?.payload?.contentHash
    || (change?.blobRefs || []).find(ref => (
        ref?.kind === change.entityType
        && String(ref?.localKey) === String(change.entityId)
    ))?.contentHash
    || ''
);

const verifyReceivedBlob = async (change, value, type) => {
    const blob = normalizeReceivedBlob(value, type);
    const expectedHash = expectedBlobHashForChange(change);
    if (!expectedHash) return blob;
    const actualHash = await calculateBlobHash(blob);
    if (!actualHash || actualHash !== expectedHash) {
        throw new Error(`クラウドファイルの内容確認に失敗しました: ${change.entityId}`);
    }
    return blob;
};

const applyRemoteExamChange = async change => {
    if (change.operation === SYNC_OPERATIONS.DELETE) {
        await examsStore.removeItem(change.entityId);
        return;
    }
    const current = await examsStore.getItem(change.entityId) || {
        id: change.entityId,
        name: change.entityId,
        questions: [],
        years: [],
        genres: [],
    };
    const next = applySyncFieldDelta(current, change);
    await examsStore.setItem(change.entityId, {
        ...next,
        id: change.entityId,
        questions: Array.isArray(next.questions) ? next.questions : [],
        updatedAt: change.createdAt,
    });
};

const applyRemoteQuestionChange = async change => {
    const { examId, questionId } = parseQuestionEntityId(change.entityId);
    const currentExam = await examsStore.getItem(examId);
    if (!currentExam && change.operation === SYNC_OPERATIONS.DELETE) return;
    const exam = currentExam || {
        id: examId,
        name: examId,
        questions: [],
        years: [],
        genres: [],
    };
    const questions = Array.isArray(exam.questions) ? [...exam.questions] : [];
    const questionIndex = questions.findIndex(question => String(question.id) === questionId);

    if (change.operation === SYNC_OPERATIONS.DELETE) {
        if (questionIndex >= 0) questions.splice(questionIndex, 1);
    } else {
        const currentQuestion = questionIndex >= 0
            ? questions[questionIndex]
            : { id: questionId };
        const nextQuestion = normalizeQuestionId(
            applySyncFieldDelta(currentQuestion, change)
        );
        if (questionIndex >= 0) questions[questionIndex] = nextQuestion;
        else questions.push(nextQuestion);
    }

    await examsStore.setItem(examId, rebuildExamMetadata({
        ...exam,
        questions,
        updatedAt: change.createdAt,
    }));
};

const applyRemoteProgressChange = async change => {
    if (change.operation === SYNC_OPERATIONS.DELETE) {
        await progressStore.removeItem(change.entityId);
        return;
    }
    const current = await progressStore.getItem(change.entityId) || {};
    await progressStore.setItem(change.entityId, {
        ...applySyncFieldDelta(current, change),
        updatedAt: change.createdAt,
    });
};

const applyRemotePreferenceChange = async change => {
    const sessionId = resumableSessionIdFromEntity(change.entityId);
    if (!sessionId) {
        throw new Error(`未対応の同期設定です: ${change.entityId}`);
    }
    const sessions = getLocalResumableSessions();
    const currentIndex = sessions.findIndex(
        session => String(session.id) === sessionId
    );
    if (change.operation === SYNC_OPERATIONS.DELETE) {
        if (currentIndex >= 0) sessions.splice(currentIndex, 1);
        writeLocalResumableSessions(sessions);
        return;
    }
    const current = currentIndex >= 0 ? sessions[currentIndex] : { id: sessionId };
    const next = {
        ...applySyncFieldDelta(current, change),
        id: sessionId,
        interrupted: true,
    };
    if (currentIndex >= 0) sessions[currentIndex] = next;
    else sessions.push(next);
    writeLocalResumableSessions(sessions);
};

const applyRemoteImageChange = async (change, blob) => {
    if (change.operation === SYNC_OPERATIONS.DELETE) {
        await imageStore.removeItem(change.entityId);
        return;
    }
    const verifiedBlob = await verifyReceivedBlob(change, blob, 'application/octet-stream');
    await imageStore.setItem(change.entityId, verifiedBlob);
};

const applyRemotePdfChange = async (change, blob) => {
    if (change.operation === SYNC_OPERATIONS.DELETE) {
        await pdfStore.removeItem(change.entityId);
        return;
    }
    const current = await pdfStore.getItem(change.entityId) || {};
    const currentMetadata = { ...current };
    delete currentMetadata.blob;
    const metadata = applySyncFieldDelta(currentMetadata, change);
    const verifiedBlob = await verifyReceivedBlob(
        change,
        blob,
        metadata.type || 'application/pdf'
    );
    await pdfStore.setItem(change.entityId, {
        ...metadata,
        blob: verifiedBlob,
        updatedAt: change.createdAt,
    });
};

const localSyncDataStore = {
    async applyChange(change, { blob } = {}) {
        switch (change.entityType) {
            case SYNC_ENTITY_TYPES.EXAM:
                return applyRemoteExamChange(change);
            case SYNC_ENTITY_TYPES.QUESTION:
                return applyRemoteQuestionChange(change);
            case SYNC_ENTITY_TYPES.PROGRESS:
                return applyRemoteProgressChange(change);
            case SYNC_ENTITY_TYPES.PREFERENCE:
                return applyRemotePreferenceChange(change);
            case SYNC_ENTITY_TYPES.IMAGE:
                return applyRemoteImageChange(change, blob);
            case SYNC_ENTITY_TYPES.PDF:
                return applyRemotePdfChange(change, blob);
            default:
                throw new Error(`ローカル反映に未対応の同期データです: ${change.entityType}`);
        }
    },
};

/**
 * クラウドから受信した1変更を、重複・競合・ファイル検証を行ってから反映する。
 */
export const receiveRemoteSyncChange = async (change, { resolveBlob } = {}) => (
    processIncomingSyncChange({
        change,
        journal: localSyncJournal,
        dataStore: localSyncDataStore,
        resolveBlob,
    })
);

/**
 * クラウドへアップロードする画像またはPDF本体を取得する。
 */
export const getLocalSyncBlob = async ({ kind, localKey, contentHash } = {}) => {
    if (!localKey) throw new Error('同期ファイルのlocalKeyが必要です。');
    let blob = null;
    if (kind === SYNC_ENTITY_TYPES.IMAGE) {
        blob = await imageStore.getItem(localKey);
    } else if (kind === SYNC_ENTITY_TYPES.PDF) {
        blob = (await pdfStore.getItem(localKey))?.blob || null;
    } else {
        throw new Error(`ファイル取得に未対応の同期データです: ${kind}`);
    }
    if (!blob) throw new Error(`同期するファイルが見つかりません: ${localKey}`);
    const normalizedBlob = normalizeReceivedBlob(blob);
    const actualHash = await calculateBlobHash(normalizedBlob);
    if (contentHash && actualHash !== contentHash) {
        throw new Error(`同期するファイルの内容が変更されています: ${localKey}`);
    }
    return {
        blob: normalizedBlob,
        contentHash: actualHash,
    };
};

/**
 * 接続済みのクラウドアダプターを使って、受信してから送信する1同期サイクルを実行する。
 */
export const synchronizeLocalData = async provider => (
    runSyncCycle({
        provider,
        journal: localSyncJournal,
        dataStore: localSyncDataStore,
        getLocalBlob: getLocalSyncBlob,
        createLocalSnapshot: async () => {
            const backup = await exportAllLocalData();
            const blob = await createBackupArchiveBlob(backup);
            return {
                blob,
                contentHash: await calculateBlobHash(blob),
                counts: {
                    exams: Object.keys(backup.exams || {}).length,
                    progress: Object.keys(backup.progress || {}).length,
                    images: Object.keys(backup.images || {}).length,
                    pdfs: Object.keys(backup.pdfs || {}).length,
                    sessions: Array.isArray(backup.sessions) ? backup.sessions.length : 0,
                },
            };
        },
        restoreLocalSnapshot: async blob => {
            const backup = await parseBackupArchiveBlob(blob);
            await importLocalData(backup, 'overwrite');
        },
    })
);

// --- カスタム試験 (Custom Exams) 関連のAPI ---

/**
 * カスタム試験データを保存する
 * @param {string} examId - 試験ID (例: 'my_exam_2026')
 * @param {string} name - 試験の表示名 (例: '2026年 独自試験')
 * @param {Array} questions - 問題データの配列
 */
export const saveLocalExam = async (examId, name, questions, isMerge = false) => {
    if (!examId || !questions) return;

    const previousExam = await examsStore.getItem(examId);
    let finalName = name;
    let finalQuestions = questions.map(normalizeQuestionId);
    
    // マージ（追加）モードの場合、既存の試験データを取得してマージする
    if (isMerge) {
        try {
            const existingExam = previousExam;
            if (existingExam) {
                // 既存の表示名 (name) を最優先で維持する
                if (existingExam.name) {
                    finalName = existingExam.name;
                }
                if (Array.isArray(existingExam.questions)) {
                    const normalizedExistingQuestions = existingExam.questions.map(normalizeQuestionId);
                    // 重複問題の排除（同じ問題IDがある場合は新データを優先または無視）
                    const existingIds = new Set(normalizedExistingQuestions.map(q => q.id));
                    const newQuestions = finalQuestions.filter(q => !existingIds.has(q.id));
                    finalQuestions = [...normalizedExistingQuestions, ...newQuestions];
                }
            }
        } catch (e) {
            console.error("Failed to merge with existing exam data:", e);
        }
    }
    
    // ユニークな年度とジャンルを抽出してメタデータとして保存
    const { preparedQuestions, usedImageKeys } = await prepareQuestionsForStorage(examId, finalQuestions);
    const deletedImageKeys = await cleanupOrphanExamImages(examId, usedImageKeys);

    const years = [...new Set(preparedQuestions.map(q => q.year).filter(Boolean))].map(Number).sort((a, b) => b - a);
    const genres = [...new Set(preparedQuestions.map(q => q.genre).filter(Boolean))].sort();
    
    const examData = {
        id: examId,
        name: finalName,
        questions: preparedQuestions,
        years: years,
        genres: genres,
        updatedAt: new Date().toISOString()
    };
    
    await examsStore.setItem(examId, examData);
    await recordSyncChangesSafely(buildExamSyncChanges(previousExam, examData, deletedImageKeys));
};

/**
 * 指定されたカスタム試験のデータを取得する
 * @param {string} examId 
 * @returns {Promise<Array>} 問題データの配列
 */
export const getLocalExam = async (examId) => {
    try {
        const examData = await examsStore.getItem(examId);
        if (!examData || !Array.isArray(examData.questions)) return [];
        return Promise.all(examData.questions.map((question) => hydrateQuestionImages(question)));
    } catch (e) {
        console.error(`Failed to get local exam: ${examId}`, e);
        return [];
    }
};

/**
 * 保存されているすべてのカスタム試験のメタデータ（IDと名前）を取得する
 * @returns {Promise<Array<{id: string, name: string, count: number}>>}
 */
export const getAllLocalExams = async () => {
    const exams = [];
    try {
        await examsStore.iterate((value, key) => {
            exams.push({
                id: key,
                name: value.name || key,
                count: value.questions ? value.questions.length : 0,
                years: value.years || [],
                genres: value.genres || []
            });
        });
    } catch (e) {
        console.error("Failed to iterate local exams:", e);
    }
    return exams;
};

/**
 * カスタム試験を削除する
 * @param {string} examId 
 */
export const deleteLocalExam = async (examId) => {
    const examData = await examsStore.getItem(examId);
    await examsStore.removeItem(examId);
    const imageKeys = await cleanupOrphanExamImages(examId, new Set());
    const pdfKeys = [];
    await pdfStore.iterate((_value, key) => {
        if (key.startsWith(buildExamPdfKeyPrefix(examId))) pdfKeys.push(key);
    });
    await Promise.all(pdfKeys.map(key => pdfStore.removeItem(key)));
    await recordSyncChangesSafely([
        ...(examData ? [buildDeleteSyncChangeInput({
            entityType: SYNC_ENTITY_TYPES.EXAM,
            entityId: examId,
        })] : []),
        ...(examData?.questions || []).map(question => buildDeleteSyncChangeInput({
            entityType: SYNC_ENTITY_TYPES.QUESTION,
            entityId: buildQuestionEntityId(examId, question.id),
        })),
        ...imageKeys.map(key => buildDeleteSyncChangeInput({
            entityType: SYNC_ENTITY_TYPES.IMAGE,
            entityId: key,
        })),
        ...pdfKeys.map(key => buildDeleteSyncChangeInput({
            entityType: SYNC_ENTITY_TYPES.PDF,
            entityId: key,
        })),
    ]);
};

export const saveExamPdf = async (examId, year, file) => {
    if (!examId || !file) return;
    const name = file.name || `${year || 'unknown'}.pdf`;
    const key = `${buildExamPdfKeyPrefix(examId)}${year || 'unknown'}::${name}`;
    const previousRecord = await pdfStore.getItem(key);
    const blob = file instanceof Blob ? file : new Blob([file], { type: 'application/pdf' });
    const contentHash = await calculateBlobHash(blob);
    const nextRecord = {
        examId,
        year: Number(year) || null,
        name,
        type: file.type || 'application/pdf',
        size: file.size || 0,
        blob,
        ...(contentHash ? { contentHash } : {}),
        updatedAt: new Date().toISOString(),
    };
    await pdfStore.setItem(key, nextRecord);
    await recordSyncChangesSafely([
        buildUpsertSyncChangeInput({
            entityType: SYNC_ENTITY_TYPES.PDF,
            entityId: key,
            previousValue: previousRecord || {},
            nextValue: nextRecord,
            fields: ['examId', 'year', 'name', 'type', 'size', 'contentHash'],
            blobRefs: [{
                kind: SYNC_ENTITY_TYPES.PDF,
                localKey: key,
                ...(contentHash ? { contentHash } : {}),
            }],
        }),
    ]);
};

export const getExamPdfs = async (examId) => {
    const records = [];
    await pdfStore.iterate((value, key) => {
        if (key.startsWith(buildExamPdfKeyPrefix(examId))) records.push({ key, ...value });
    });
    return records.sort((a, b) => (b.year || 0) - (a.year || 0) || a.name.localeCompare(b.name, 'ja'));
};

/**
 * 指定したローカル試験内の1問を更新する
 * @param {string} examId
 * @param {string|number} questionId
 * @param {Object} updates
 */
export const updateLocalQuestion = async (examId, questionId, updates) => {
    if (!examId || !questionId || !updates || typeof updates !== 'object') return;

    const examData = await examsStore.getItem(examId);
    if (!examData || !Array.isArray(examData.questions)) {
        throw new Error('編集対象の試験データが見つかりません。');
    }

    const targetId = String(questionId);
    let found = false;

    const nextQuestions = examData.questions.map((question) => {
        if (String(question.id) !== targetId) {
            return normalizeQuestionId(question);
        }

        found = true;
        const mergedQuestion = normalizeQuestionId({
            ...question,
            ...updates,
        });
        return mergedQuestion;
    });

    if (!found) {
        throw new Error('編集対象の問題が見つかりません。');
    }

    const { preparedQuestions, usedImageKeys } = await prepareQuestionsForStorage(examId, nextQuestions);
    const deletedImageKeys = await cleanupOrphanExamImages(examId, usedImageKeys);

    const years = [...new Set(preparedQuestions.map(q => q.year).filter(Boolean))].map(Number).sort((a, b) => b - a);
    const genres = [...new Set(preparedQuestions.map(q => q.genre).filter(Boolean))].sort();

    const nextExamData = {
        ...examData,
        questions: preparedQuestions,
        years,
        genres,
        updatedAt: new Date().toISOString(),
    };
    await examsStore.setItem(examId, nextExamData);
    await recordSyncChangesSafely(buildExamSyncChanges(examData, nextExamData, deletedImageKeys));
};


// --- ユーザー進捗 (User Progress) 関連のAPI ---

/**
 * ユーザーの進捗状況をローカルに保存（マージ）する
 * @param {string|number} questionId - グローバルな問題ID (例: 'test_ivr_2016001')
 * @param {Object} data - 保存するデータ (status, isLiked など)
 */
export const saveLocalProgress = async (questionId, data) => {
    if (!questionId) return;
    
    const strId = questionId.toString();
    try {
        const existing = await progressStore.getItem(strId) || {};
        const updated = {
            ...existing,
            ...data,
            updatedAt: new Date().toISOString()
        };
        await progressStore.setItem(strId, updated);
        await recordSyncChangesSafely([
            buildUpsertSyncChangeInput({
                entityType: SYNC_ENTITY_TYPES.PROGRESS,
                entityId: strId,
                previousValue: existing,
                nextValue: updated,
                fields: Object.keys(data),
            }),
        ]);
    } catch (e) {
        console.error(`Failed to save local progress for ${questionId}:`, e);
    }
};

/**
 * すべてのユーザー進捗データを取得する
 * 既存の `getUserExamProgress` と同じフォーマットで返します。
 * @returns {Promise<Object>} キーが questionId、値が進捗オブジェクトのマップ
 */
export const getLocalProgress = async () => {
    const progress = {};
    try {
        await progressStore.iterate((value, key) => {
            progress[key] = value;
        });
    } catch (e) {
        console.error("Failed to iterate local progress:", e);
    }
    return progress;
};

// --- バックアップと復元 (Backup & Restore) ---

/**
 * すべてのローカルデータをエクスポート用JSONオブジェクトとして取得する
 * @returns {Promise<Object>}
 */
export const exportAllLocalData = async ({ includePdfs = true } = {}) => {
    const backup = {
        version: 4,
        timestamp: Date.now(),
        exams: {},
        progress: {},
        images: {},
        pdfs: {},
        sessions: getLocalResumableSessions(),
    };

    // 試験データをエクスポート用に追加
    await examsStore.iterate((value, key) => {
        backup.exams[key] = value;
    });

    // 進捗データをエクスポート用に追加
    await progressStore.iterate((value, key) => {
        backup.progress[key] = value;
    });

    // 問題データが実際に参照している画像をキー指定で取得する。
    // imageStore.iterate()だけに依存すると、一部環境でBlobが列挙されず、
    // 参照だけが残った不完全なバックアップになることがある。
    const referencedImageKeys = collectReferencedImageKeys(backup.exams);
    const missingImageKeys = [];
    for (const key of referencedImageKeys) {
        const value = await imageStore.getItem(key);
        if (value == null) {
            missingImageKeys.push(key);
            continue;
        }
        backup.images[key] = await binaryValueToDataUrl(value);
    }

    if (missingImageKeys.length > 0) {
        throw new Error(
            `問題が参照している画像${referencedImageKeys.length}件のうち`
            + `${missingImageKeys.length}件を読み出せませんでした。`
            + '元データが表示できる環境で再度エクスポートしてください。'
        );
    }

    if (includePdfs) {
        const pdfRecords = new Map();
        await pdfStore.iterate((value, key) => {
            pdfRecords.set(key, value);
        });

        // PDFストアの全件走査だけに依存すると、Blobを含むレコードが環境によって
        // 取りこぼされるため、問題のsourcePagesが参照する保存キーを直接取得する。
        const referencedPdfKeys = collectReferencedPdfKeys(backup.exams);
        const missingPdfKeys = [];
        for (const key of referencedPdfKeys) {
            const value = await pdfStore.getItem(key);
            if (value == null) {
                missingPdfKeys.push(key);
                continue;
            }
            pdfRecords.set(key, value);
        }

        if (missingPdfKeys.length > 0) {
            throw new Error(
                `問題が参照しているPDF${referencedPdfKeys.length}件のうち`
                + `${missingPdfKeys.length}件を読み出せませんでした。`
                + '元のPDFを再登録してからエクスポートしてください。'
            );
        }

        await Promise.all([...pdfRecords].map(async ([key, value]) => {
            backup.pdfs[key] = {
                ...value,
                blob: await binaryValueToDataUrl(value?.blob, `PDF「${value?.name || key}」`),
            };
        }));
    }

    return backup;
};

/**
 * バックアップJSONデータをローカルにインポートする
 * @param {Object} jsonData - インポートするバックアップデータ
 * @param {string} strategy - 'overwrite' (上書き)
 */
export const importLocalData = async (jsonData, strategy = 'overwrite', { includePdfs = true } = {}) => {
    if (!jsonData || typeof jsonData !== 'object') {
        throw new Error("Invalid backup data format");
    }

    if (strategy !== 'overwrite') {
        throw new Error("Unsupported import strategy");
    }

    const {
        exams,
        progress,
        images,
        pdfs,
        sessions = [],
    } = jsonData;
    const missingImageKeys = findMissingBackupImageKeys(exams, images);
    if (missingImageKeys.length > 0) {
        throw new Error(
            `バックアップ内の画像が${missingImageKeys.length}件不足しています。`
            + '現在のデータは変更していません。元の端末から新しくエクスポートしてください。'
        );
    }
    const missingPdfKeys = includePdfs ? findMissingBackupPdfKeys(exams, pdfs) : [];
    if (missingPdfKeys.length > 0) {
        throw new Error(
            `バックアップ内の参照PDFが${missingPdfKeys.length}件不足しています。`
            + '現在のデータは変更していません。元の端末から新しくエクスポートしてください。'
        );
    }

    // 現在のデータを消去する前に、すべての画像・PDFを復元可能な形式へ変換する。
    const preparedImages = [];
    for (const [key, value] of Object.entries(images || {})) {
        preparedImages.push([key, isDataUrl(value) ? await dataUrlToBlob(value) : value]);
    }

    const preparedPdfs = [];
    if (includePdfs && pdfs && typeof pdfs === 'object') {
        for (const [key, value] of Object.entries(pdfs)) {
            preparedPdfs.push([key, {
                ...value,
                blob: isDataUrl(value?.blob) ? await dataUrlToBlob(value.blob) : value?.blob,
            }]);
        }
    }

    // 1. 試験データのインポート
    if (exams && typeof exams === 'object') {
        await examsStore.clear();
        for (const [key, value] of Object.entries(exams)) {
            await examsStore.setItem(key, value);
        }
    }

    // 2. 進捗データのインポート
    if (progress && typeof progress === 'object') {
        await progressStore.clear();
        for (const [key, value] of Object.entries(progress)) {
            await progressStore.setItem(key, value);
        }
    }

    // 3. 画像データのインポート
    await imageStore.clear();
    for (const [key, value] of preparedImages) {
        await imageStore.setItem(key, value);
    }

    await pdfStore.clear();
    for (const [key, value] of preparedPdfs) {
        await pdfStore.setItem(key, value);
    }
    writeLocalResumableSessions(sessions);
    await markSyncReconciliationSafely('manual-backup-import');
};
