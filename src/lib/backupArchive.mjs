import {
    decryptBackupBlob,
    encryptBackupBlob,
    isEncryptedBackupBlob,
} from './backupEncryption.mjs';

const ARCHIVE_FORMAT = 'radexam-backup-archive';
const ARCHIVE_VERSION = 1;
export const MAX_BACKUP_FILE_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_BACKUP_RECORD_BYTES = 512 * 1024 * 1024;
export const MAX_BACKUP_RECORDS = 200_000;
const MAX_BACKUP_KEY_LENGTH = 4096;
const COUNT_KEYS = ['exams', 'progress', 'images', 'pdfs', 'sessions'];
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

const isPlainObject = value => (
    value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
);

const assertSafeKey = key => {
    if (
        typeof key !== 'string'
        || !key
        || key.length > MAX_BACKUP_KEY_LENGTH
        || /[\u0000-\u001f\u007f]/.test(key)
        || UNSAFE_KEYS.has(key)
    ) {
        throw new Error('バックアップ内に不正なデータキーがあります。');
    }
};

const validateCounts = counts => {
    if (!isPlainObject(counts) || Object.keys(counts).some(key => !COUNT_KEYS.includes(key))) {
        throw new Error('バックアップ内の件数情報が不正です。');
    }
    let total = 0;
    for (const key of COUNT_KEYS) {
        const count = counts[key];
        if (!Number.isSafeInteger(count) || count < 0 || count > MAX_BACKUP_RECORDS) {
            throw new Error(`バックアップ内の${key}件数が不正です。`);
        }
        total += count;
    }
    if (total > MAX_BACKUP_RECORDS) {
        throw new Error('バックアップ内のデータ件数が上限を超えています。');
    }
    return counts;
};

const validateRecordMap = (value, label) => {
    if (!isPlainObject(value)) throw new Error(`バックアップ内の${label}データが不正です。`);
    const entries = Object.entries(value);
    if (entries.length > MAX_BACKUP_RECORDS) {
        throw new Error(`バックアップ内の${label}件数が上限を超えています。`);
    }
    for (const [key] of entries) assertSafeKey(key);
    return value;
};

export const validateBackupData = backup => {
    if (!isPlainObject(backup)) throw new Error('RadExamのバックアップファイルではありません。');
    validateRecordMap(backup.exams, 'exams');
    validateRecordMap(backup.progress || {}, 'progress');
    validateRecordMap(backup.images || {}, 'images');
    validateRecordMap(backup.pdfs || {}, 'pdfs');
    if (!Array.isArray(backup.sessions || []) || (backup.sessions || []).length > MAX_BACKUP_RECORDS) {
        throw new Error('バックアップ内の中断履歴が不正です。');
    }
    let questionCount = 0;
    for (const exam of Object.values(backup.exams || {})) {
        if (!isPlainObject(exam) || !Array.isArray(exam.questions || [])) {
            throw new Error('バックアップ内の試験データが不正です。');
        }
        questionCount += (exam.questions || []).length;
        if (questionCount > MAX_BACKUP_RECORDS) {
            throw new Error('バックアップ内の問題数が上限を超えています。');
        }
        if ((exam.questions || []).some(question => !isPlainObject(question))) {
            throw new Error('バックアップ内の問題データが不正です。');
        }
    }
    if (Object.values(backup.images || {}).some(value => typeof value !== 'string' && !(value instanceof Blob))) {
        throw new Error('バックアップ内の画像データが不正です。');
    }
    if (Object.values(backup.pdfs || {}).some(value => (
        !isPlainObject(value)
        || (typeof value.blob !== 'string' && !(value.blob instanceof Blob))
    ))) {
        throw new Error('バックアップ内のPDFデータが不正です。');
    }
    if ((backup.sessions || []).some(session => !isPlainObject(session) || !session.id)) {
        throw new Error('バックアップ内の中断履歴が不正です。');
    }
    return backup;
};

const createRecordIterator = function* (backup) {
    const counts = {
        exams: Object.keys(backup.exams || {}).length,
        progress: Object.keys(backup.progress || {}).length,
        images: Object.keys(backup.images || {}).length,
        pdfs: Object.keys(backup.pdfs || {}).length,
        sessions: Array.isArray(backup.sessions) ? backup.sessions.length : 0,
    };

    yield {
        type: 'header',
        format: ARCHIVE_FORMAT,
        archiveVersion: ARCHIVE_VERSION,
        backupVersion: backup.version,
        timestamp: backup.timestamp,
        counts,
    };

    for (const [key, value] of Object.entries(backup.exams || {})) {
        yield { type: 'exam', key, value };
    }
    for (const [key, value] of Object.entries(backup.progress || {})) {
        yield { type: 'progress', key, value };
    }
    for (const [key, value] of Object.entries(backup.images || {})) {
        yield { type: 'image', key, value };
    }
    for (const [key, value] of Object.entries(backup.pdfs || {})) {
        yield { type: 'pdf', key, value };
    }
    for (const session of backup.sessions || []) {
        yield { type: 'session', key: String(session.id), value: session };
    }

    yield { type: 'end', counts };
};

const addArchiveRecord = (backup, record) => {
    if (!record || typeof record !== 'object') {
        throw new Error('バックアップ内に不正なレコードがあります。');
    }

    if (record.type === 'session') {
        if (!record.value?.id) {
            throw new Error('バックアップ内にIDのない中断履歴があります。');
        }
        backup.sessions.push(record.value);
        return;
    }
    const targetByType = {
        exam: backup.exams,
        progress: backup.progress,
        image: backup.images,
        pdf: backup.pdfs,
    };
    const target = targetByType[record.type];
    if (!target || typeof record.key !== 'string') {
        throw new Error(`未対応のバックアップレコードです: ${record.type || 'unknown'}`);
    }
    assertSafeKey(record.key);
    if (Object.hasOwn(target, record.key)) {
        throw new Error(`バックアップ内に重複したデータがあります: ${record.key}`);
    }
    target[record.key] = record.value;
};

export const createBackupArchiveBlob = async backup => {
    const iterator = createRecordIterator(backup);
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        pull(controller) {
            const { value, done } = iterator.next();
            if (done) {
                controller.close();
                return;
            }
            controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
        },
    });
    const blob = await new Response(stream).blob();
    return new Blob([blob], { type: 'application/x-radexam-backup' });
};

export const createEncryptedBackupArchiveBlob = async (backup, passphrase) => (
    encryptBackupBlob(await createBackupArchiveBlob(backup), passphrase)
);

export const parseBackupArchiveBlob = async file => {
    if (!(file instanceof Blob) || file.size > MAX_BACKUP_FILE_BYTES) {
        throw new Error('バックアップファイルのサイズが上限を超えています。');
    }
    const reader = file.stream()
        .pipeThrough(new TextDecoderStream())
        .getReader();
    const backup = {
        version: null,
        timestamp: null,
        exams: {},
        progress: {},
        images: {},
        pdfs: {},
        sessions: [],
    };
    let header = null;
    let footer = null;
    let pending = '';
    let recordCount = 0;

    const processLine = line => {
        if (!line.trim()) return;
        if (new TextEncoder().encode(line).byteLength > MAX_BACKUP_RECORD_BYTES) {
            throw new Error('バックアップ内の1件のデータが大きすぎます。');
        }
        const record = JSON.parse(line);
        if (!header) {
            if (record.type !== 'header' || record.format !== ARCHIVE_FORMAT) {
                throw new Error('RadExamのバックアップファイルではありません。');
            }
            if (record.archiveVersion !== ARCHIVE_VERSION) {
                throw new Error(`未対応のバックアップ形式です: ${record.archiveVersion}`);
            }
            header = record;
            validateCounts(record.counts);
            backup.version = record.backupVersion;
            backup.timestamp = record.timestamp;
            return;
        }
        if (footer) {
            throw new Error('バックアップ終端の後に余分なデータがあります。');
        }
        if (record.type === 'end') {
            validateCounts(record.counts);
            footer = record;
            return;
        }
        recordCount += 1;
        if (recordCount > MAX_BACKUP_RECORDS) {
            throw new Error('バックアップ内のデータ件数が上限を超えています。');
        }
        addArchiveRecord(backup, record);
    };

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        pending += value;
        if (pending.length > MAX_BACKUP_RECORD_BYTES) {
            await reader.cancel();
            throw new Error('バックアップ内の1件のデータが大きすぎます。');
        }
        let newlineIndex = pending.indexOf('\n');
        while (newlineIndex >= 0) {
            processLine(pending.slice(0, newlineIndex));
            pending = pending.slice(newlineIndex + 1);
            newlineIndex = pending.indexOf('\n');
        }
    }
    processLine(pending);

    if (!header || !footer) {
        throw new Error('バックアップファイルが途中で切れています。');
    }

    const actualCounts = {
        exams: Object.keys(backup.exams).length,
        progress: Object.keys(backup.progress).length,
        images: Object.keys(backup.images).length,
        pdfs: Object.keys(backup.pdfs).length,
        sessions: backup.sessions.length,
    };
    for (const [key, count] of Object.entries(header.counts || {})) {
        if (actualCounts[key] !== count || footer.counts?.[key] !== count) {
            throw new Error(`バックアップ内の${key}データが不足しています。`);
        }
    }

    return validateBackupData(backup);
};

export const readBackupFile = async (file, { passphrase = '' } = {}) => {
    if (!(file instanceof Blob) || file.size > MAX_BACKUP_FILE_BYTES + 32 * 1024 * 1024) {
        throw new Error('バックアップファイルのサイズが上限を超えています。');
    }
    if (await isEncryptedBackupBlob(file)) {
        if (!passphrase) {
            const error = new Error('暗号化バックアップのパスワードを入力してください。');
            error.code = 'BACKUP_PASSPHRASE_REQUIRED';
            throw error;
        }
        return parseBackupArchiveBlob(await decryptBackupBlob(file, passphrase));
    }
    if (file.name?.toLowerCase().endsWith('.json')) {
        return validateBackupData(JSON.parse(await file.text()));
    }
    return parseBackupArchiveBlob(file);
};
