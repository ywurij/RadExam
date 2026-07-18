import assert from 'node:assert/strict';
import test from 'node:test';

import { buildNuclearSourcePageAssignments } from '../src/lib/nuclearSourcePages.mjs';

const page = (pageNum, text, rotation = 0) => ({
    pageNum,
    width: 600,
    height: 800,
    rotation,
    textItems: [{ text }]
});

test('assigns only matching appendix pages and excludes question pages', () => {
    const assignments = buildNuclearSourcePageAssignments({
        questions: [
            { questionNumber: 35, startPage: 2, question: '画像を示す（別紙 No. 35）。' },
            { questionNumber: 36, startPage: 2, question: '画像を使用しない問題。' },
            { questionNumber: 43, startPage: 3, question: '別紙 No. 43を参照。' }
        ],
        pages: [
            page(2, '35. 画像を示す（別紙 No. 35）。'),
            page(3, '43. 別紙 No. 43を参照。'),
            page(4, '核医学専門医試験 別紙 設問 No.35 No.36'),
            page(5, 'No.43')
        ],
        pdfName: '2025.pdf',
        pdfYear: 2025,
        totalPages: 5
    });

    assert.deepEqual(assignments[0].sourcePages.map(source => source.pageNumber), [4]);
    assert.deepEqual(assignments[1].sourcePages, []);
    assert.deepEqual(assignments[2].sourcePages.map(source => source.pageNumber), [5]);
    assert.equal(assignments[0].sourcePages[0].focusRect, null);
    assert.equal(assignments[0].sourcePages[0].sourceType, 'nuclear-appendix');
});

test('supports shared pages, repeated figure pages, full-width digits and rotated appendix pages', () => {
    const assignments = buildNuclearSourcePageAssignments({
        questions: [
            { questionNumber: 44, startPage: 2, question: '別紙 No. 44を示す。' },
            {
                questionNumber: 45,
                startPage: 3,
                question: '別紙 Ｎｏ．４５を示す。',
                rawTextLines: ['別紙 No. 44まで連結された未整理の内部テキスト']
            }
        ],
        pages: [
            page(2, '44. 別紙 No. 44を示す。'),
            page(3, '45. 別紙 No. 45を示す。'),
            page(4, '第22回核医学専門医試験 別紙 設問 No. 44 No.45'),
            page(5, 'No. 44-2', 90)
        ],
        pdfName: 'exam.pdf',
        pdfYear: 2024,
        totalPages: 5
    });

    assert.deepEqual(assignments[0].sourcePages.map(source => source.pageNumber), [4, 5]);
    assert.deepEqual(assignments[1].sourcePages.map(source => source.pageNumber), [4]);
    assert.equal(assignments[0].sourcePages[1].rotation, 90);
    assert.equal(assignments[0].sourcePages[0].pdfName, 'exam.pdf');
});

test('rejoins split appendix digits and falls back from a corrupt reference to the question number', () => {
    const assignments = buildNuclearSourcePageAssignments({
        questions: [
            { questionNumber: 48, startPage: 2, question: '図（別紙 No.48）を示す。' },
            { questionNumber: 59, startPage: 3, question: '別紙 No.422 の画像を示す。' }
        ],
        pages: [
            page(2, '48. 図（別紙 No.48）を示す。'),
            page(3, '59. 別紙 No.59 の画像を示す。'),
            {
                pageNum: 4,
                width: 600,
                height: 800,
                rotation: 0,
                textItems: [{ text: '核医学専門医試験 別紙 設問 ' }, { text: 'No.' }, { text: ' ' }, { text: '4' }, { text: '8' }]
            },
            {
                pageNum: 5,
                width: 600,
                height: 800,
                rotation: 0,
                textItems: [{ text: 'No.59' }, { text: '' }, { text: '123' }]
            }
        ],
        pdfName: 'exam.pdf',
        pdfYear: 2022,
        totalPages: 5
    });

    assert.deepEqual(assignments[0].sourcePages.map(source => source.pageNumber), [4]);
    assert.deepEqual(assignments[1].sourcePages.map(source => source.pageNumber), [5]);
    assert.deepEqual(assignments[1].sourcePages[0].referenceNumbers, [59]);
});
