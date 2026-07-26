const ARCHIVE_FORMAT = 'radexam-backup-archive';
const ARCHIVE_VERSION = 1;

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

export const parseBackupArchiveBlob = async file => {
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

    const processLine = line => {
        if (!line.trim()) return;
        const record = JSON.parse(line);
        if (!header) {
            if (record.type !== 'header' || record.format !== ARCHIVE_FORMAT) {
                throw new Error('RadExamのバックアップファイルではありません。');
            }
            if (record.archiveVersion !== ARCHIVE_VERSION) {
                throw new Error(`未対応のバックアップ形式です: ${record.archiveVersion}`);
            }
            header = record;
            backup.version = record.backupVersion;
            backup.timestamp = record.timestamp;
            return;
        }
        if (record.type === 'end') {
            footer = record;
            return;
        }
        if (footer) {
            throw new Error('バックアップ終端の後に余分なデータがあります。');
        }
        addArchiveRecord(backup, record);
    };

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        pending += value;
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

    return backup;
};

export const readBackupFile = async file => {
    if (file.name?.toLowerCase().endsWith('.json')) {
        return JSON.parse(await file.text());
    }
    return parseBackupArchiveBlob(file);
};
