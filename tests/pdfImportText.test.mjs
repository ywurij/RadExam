import assert from 'node:assert/strict';
import test from 'node:test';

import {
    applyDiagnosticImportCorrection,
    buildPairedOptionText,
    extractQuestionTable,
    extractOptionColumnHeaders,
    findNearestPrecedingQuestion,
    isPairedOptionHeader,
    isRepeatedOptionOrFigureLabel,
    repairLegacySequentialComparisonOptions,
    removeContainedImageRects,
    restoreTruncatedOptionText,
    splitOptionItemsByColumns,
} from '../src/lib/pdfImportText.js';

test('restores option suffixes removed while excluding image-contained text', () => {
    assert.deepEqual(
        restoreTruncatedOptionText(
            { a: '≧', b: '≧', c: '≧', d: '≧', e: '≧' },
            { a: '≧1', b: '≧2', c: '≧3', d: '≧4', e: '≧5' }
        ),
        { a: '≧1', b: '≧2', c: '≧3', d: '≧4', e: '≧5' }
    );
});

test('repairs already imported options containing only sequential comparison marks', () => {
    assert.deepEqual(
        repairLegacySequentialComparisonOptions({ a: '≧', b: '≧', c: '≧', d: '≧', e: '≧' }),
        { a: '≧1', b: '≧2', c: '≧3', d: '≧4', e: '≧5' }
    );
    assert.deepEqual(
        repairLegacySequentialComparisonOptions({ a: '≧1', b: '≧2', c: '≧3', d: '≧4', e: '≧5' }),
        { a: '≧1', b: '≧2', c: '≧3', d: '≧4', e: '≧5' }
    );
});

const item = (text, x, width = 10) => ({ text, x, width });

test('converts consecutive positioned numeric rows into an HTML table', () => {
    const lines = [
        { items: [item('①', 225), item('②', 268), item('③', 310), item('④', 353), item('⑤', 395)] },
        { items: [item('α/β 比（Gy）', 120, 70), item('2', 228), item('2', 271), item('6', 313), item('6', 356), item('10', 395)] },
        { items: [item('1 回線量（Gy）', 120, 80), item('6', 228), item('3', 271), item('3', 313), item('2', 356), item('2', 398)] },
    ];

    const result = extractQuestionTable(lines);
    assert.deepEqual([...result.lineIndexes], [0, 1, 2]);
    assert.match(result.html, /<table>/);
    assert.match(result.html, /α\/β 比（Gy）/);
    assert.match(result.html, /<td>10<\/td>/);
});

test('recognizes paired option headers and preserves both option columns', () => {
    assert.equal(isPairedOptionHeader('（A）　　　（B）'), true);
    const option = buildPairedOptionText([
        item('a', 99, 6),
        item('アノード', 119, 45),
        item('カソード', 264, 45),
    ]);
    assert.equal(option, 'アノード ― カソード');
});

test('assigns a page image to the nearest question above it', () => {
    const question98 = { questionNumber: 98, anchorY: 760 };
    const question99 = { questionNumber: 99, anchorY: 287 };
    assert.equal(findNearestPrecedingQuestion([question98, question99], 405), question98);
});

test('removes small image fragments contained in a larger source image', () => {
    const rects = [
        { x: 152, y: 142, w: 291, h: 202 },
        { x: 365, y: 262, w: 78, h: 42 },
        { x: 408, y: 160, w: 35, h: 60 },
        { x: 60, y: 375, w: 240, h: 191 },
    ];
    assert.deepEqual(removeContainedImageRects(rects), [rects[0], rects[3]]);
});

test('does not overwrite real choices with uppercase figure labels', () => {
    const parsedOptions = { a: '本来の選択肢a', b: '本来の選択肢b', e: '本来の選択肢e' };
    assert.equal(isRepeatedOptionOrFigureLabel('a', parsedOptions, true), true);
    assert.equal(isRepeatedOptionOrFigureLabel('b', parsedOptions, true), true);
    assert.equal(isRepeatedOptionOrFigureLabel('c', parsedOptions, true), true);
    assert.equal(isRepeatedOptionOrFigureLabel('a', {}, false), false);
});

test('extracts a three-column option header without treating it as option a', () => {
    const headers = extractOptionColumnHeaders([
        item('A', 140), item('B', 280), item('C', 420),
    ]);
    assert.deepEqual(headers.map(header => header.label), ['A', 'B', 'C']);

    const columns = splitOptionItemsByColumns([
        item('a', 90, 6),
        item('99mTc-MIBI', 120, 70),
        item('123I-MIBG', 260, 70),
        item('201TlCl', 400, 60),
    ], headers);
    assert.deepEqual(columns.map(column => column.map(token => token.text).join('')), [
        '99mTc-MIBI', '123I-MIBG', '201TlCl',
    ]);
});

test('applies row and column legends for diagnostic image grids', () => {
    const q43 = {
        questionNumber: 43,
        pageImages: [
            { x: 70, y: 399 }, { x: 70, y: 230 },
            { x: 299, y: 384 }, { x: 299, y: 230 },
        ],
    };
    applyDiagnosticImportCorrection(2022, q43);
    assert.deepEqual(q43.pageImages.map(image => image.legend), ['横断像', '冠状断像', '横断像', '冠状断像']);

    const q63 = {
        questionNumber: 63,
        pageImages: [
            { x: 307, y: 347 }, { x: 111, y: 347 },
            { x: 304, y: 118 }, { x: 94, y: 118 },
        ],
    };
    applyDiagnosticImportCorrection(2022, q63);
    assert.deepEqual(q63.pageImages.map(image => image.legend), [
        '<sup>123</sup>I-BMIPP短軸像',
        '<sup>123</sup>I-BMIPP垂直長軸像',
        '<sup>201</sup>Tl短軸像',
        '<sup>201</sup>Tl垂直長軸像',
    ]);
});

test('removes a false table and restores a two-line legend', () => {
    const q51 = {
        questionNumber: 51,
        question: '前立腺MRIを示す。<div class="tableWrapper"><table><tbody><tr><td>誤検出</td></tr></tbody></table></div>',
        pageImages: [{ x: 70, y: 420 }, { x: 299, y: 420 }, { x: 184, y: 247 }],
    };
    applyDiagnosticImportCorrection(2023, q51);
    assert.equal(q51.question, '前立腺MRIを示す。');

    const q30 = { questionNumber: 30, pageImages: [{ x: 70, y: 336 }, { x: 299, y: 335 }] };
    applyDiagnosticImportCorrection(2023, q30);
    assert.match(q30.pageImages[1].legend, /基準値 1200～1250 ms/);
});

test('preserves row and column context for composite diagnostic figures', () => {
    const q65 = { questionNumber: 65, pageImages: [{ x: 145, y: 397 }, { x: 145, y: 214 }] };
    applyDiagnosticImportCorrection(2023, q65);
    assert.deepEqual(q65.pageImages.map(image => image.legend), [
        '翌日: 2～3分 / 14～15分 / 29～30分',
        '8日後: 2～3分 / 14～15分 / 29～30分',
    ]);

    const q91 = { questionNumber: 91, pageImages: [{ x: 145, y: 397 }, { x: 145, y: 214 }] };
    applyDiagnosticImportCorrection(2025, q91);
    assert.deepEqual(q91.pageImages.map(image => image.legend), [
        '前面像（血流 / 換気）',
        '後面像（血流 / 換気）',
    ]);
});
