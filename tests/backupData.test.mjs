import assert from 'node:assert/strict';
import test from 'node:test';
import {
    collectReferencedImageKeys,
    collectReferencedPdfKeys,
    findMissingBackupImageKeys,
    findMissingBackupPdfKeys,
} from '../src/lib/backupData.mjs';
import {
    createBackupArchiveBlob,
    parseBackupArchiveBlob,
} from '../src/lib/backupArchive.mjs';

const exams = {
    diagnostic: {
        questions: [
            {
                id: '2022048',
                images: [
                    { path: 'local-image://diagnostic::2022048::0' },
                    { path: 'data:image/png;base64,inline' },
                ],
            },
            {
                id: '2022049',
                images: [
                    { path: 'local-image://diagnostic::2022049::0' },
                    { path: 'local-image://diagnostic::2022048::0' },
                ],
                sourcePages: [
                    { pdfName: '2022.pdf', pdfYear: 2022, pageNumber: 12 },
                    { pdfKey: 'diagnostic::appendix::special.pdf', pageNumber: 13 },
                ],
            },
        ],
    },
};

test('collects every unique image key referenced by questions', () => {
    assert.deepEqual(collectReferencedImageKeys(exams), [
        'diagnostic::2022048::0',
        'diagnostic::2022049::0',
    ]);
});

test('detects missing and non-serialized image payloads before import', () => {
    assert.deepEqual(findMissingBackupImageKeys(exams, {
        'diagnostic::2022048::0': 'data:image/png;base64,abc',
        'diagnostic::2022049::0': {},
    }), ['diagnostic::2022049::0']);
});

test('collects PDF keys referenced by source pages', () => {
    assert.deepEqual(collectReferencedPdfKeys(exams), [
        'diagnostic::2022::2022.pdf',
        'diagnostic::appendix::special.pdf',
    ]);
});

test('detects missing and non-serialized PDF payloads before import', () => {
    assert.deepEqual(findMissingBackupPdfKeys(exams, {
        'diagnostic::2022::2022.pdf': {
            blob: 'data:application/pdf;base64,abc',
        },
        'diagnostic::appendix::special.pdf': {
            blob: {},
        },
    }), ['diagnostic::appendix::special.pdf']);
});

test('round-trips a chunked RadExam archive without one giant JSON string', async () => {
    const backup = {
        version: 3,
        timestamp: 12345,
        exams,
        progress: {
            diagnostic_2022049: { status: 'incorrect', isLiked: true },
        },
        images: {
            'diagnostic::2022048::0': 'data:image/png;base64,abc',
        },
        pdfs: {
            'diagnostic::2022::2022.pdf': {
                name: '2022.pdf',
                blob: 'data:application/pdf;base64,xyz',
            },
        },
    };

    const archive = await createBackupArchiveBlob(backup);
    const restored = await parseBackupArchiveBlob(archive);
    assert.deepEqual(restored, backup);
});
