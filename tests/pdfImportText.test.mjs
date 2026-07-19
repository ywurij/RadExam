import assert from 'node:assert/strict';
import test from 'node:test';

import {
    applyDiagnosticImportCorrection,
    assignNearestUniqueLabels,
    buildPairedOptionText,
    compareImageReadingOrder,
    extractQuestionTable,
    extractOptionColumnHeaders,
    findNearestPrecedingQuestion,
    hasExplicitFigureCue,
    isPairedOptionHeader,
    isRepeatedOptionOrFigureLabel,
    isStandaloneImageLegendText,
    isUsableFallbackFigureCrop,
    joinOptionContinuation,
    mergeVerticallyAdjacentImageRects,
    repairLegacySequentialComparisonOptions,
    removeContainedImageRects,
    restoreTruncatedOptionText,
    splitOptionItemsByColumns,
} from '../src/lib/pdfImportText.js';

test('assigns stacked image legends one-to-one by spatial distance', () => {
    const assignments = assignNearestUniqueLabels([
        { minX: 100, maxX: 400, minY: 500, maxY: 700 },
        { minX: 100, maxX: 400, minY: 200, maxY: 400 }
    ], [
        { text: '冠状断', x: 420, y: 300, width: 40, height: 12 },
        { text: '軸位断', x: 420, y: 600, width: 40, height: 12 }
    ]);

    assert.deepEqual(assignments.map(({ rectIndex, labelIndex }) => [rectIndex, labelIndex]), [
        [0, 1],
        [1, 0]
    ]);
});

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

test('requires an explicit visual reference before rendering a fallback figure', () => {
    assert.equal(hasExplicitFigureCue('エックス線管の図について、正しい組み合わせはどれか。'), true);
    assert.equal(hasExplicitFigureCue('腹部CT画像を示す。診断はどれか。'), true);
    assert.equal(hasExplicitFigureCue('次の画像で認められる所見はどれか。'), true);
    assert.equal(hasExplicitFigureCue('脳の灌流画像について正しいのはどれか。'), false);
    assert.equal(hasExplicitFigureCue('放射線画像診断補助ソフトウェアについて正しいのはどれか。'), false);
});

test('rejects tiny fallback crops while preserving meaningful thin figures', () => {
    assert.equal(isUsableFallbackFigureCrop(43, 42), false);
    assert.equal(isUsableFallbackFigureCrop(39, 42), false);
    assert.equal(isUsableFallbackFigureCrop(400, 40), true);
    assert.equal(isUsableFallbackFigureCrop(240, 180), true);
});

test('joins wrapped option text for every option including option e', () => {
    assert.equal(
        joinOptionContinuation('Dynamic susceptibility contrast（DSC）法は Gd 造影剤の T1 コントラストを利用', 'した撮像法である。'),
        'Dynamic susceptibility contrast（DSC）法は Gd 造影剤の T1 コントラストを利用 した撮像法である。'
    );
    assert.equal(joinOptionContinuation('', '後続行'), '後続行');
});

test('distinguishes a standalone image legend from wrapped option prose', () => {
    assert.equal(isStandaloneImageLegendText('FLAIR像'), true);
    assert.equal(isStandaloneImageLegendText('造影CT'), true);
    assert.equal(isStandaloneImageLegendText('MRIで高信号を示す。'), false);
    assert.equal(isStandaloneImageLegendText('この画像で病変を認める。'), false);
    assert.equal(isStandaloneImageLegendText('発症当日 発症10日後'), true);
    assert.equal(isStandaloneImageLegendText('発症当日発症 10 日後'), true);
    assert.equal(isStandaloneImageLegendText('3か月前 当日'), true);
    assert.equal(isStandaloneImageLegendText('3 分後 15 分後'), true);
    assert.equal(isStandaloneImageLegendText('手技前 手技直後'), true);
    assert.equal(isStandaloneImageLegendText('負荷時 安静時'), true);
    assert.equal(isStandaloneImageLegendText('治療半年後 L15 H3 H15'), true);
    assert.equal(isStandaloneImageLegendText('L15 H3 H15'), true);
    assert.equal(isStandaloneImageLegendText('L15'), true);
    assert.equal(isStandaloneImageLegendText('時間放射能曲線'), true);
    assert.equal(isStandaloneImageLegendText('門脈優位相 肝細胞相'), true);
    assert.equal(isStandaloneImageLegendText('肝細胞相で低信号を示す。'), false);
});

test('does not restore a legend removed from the end of option e', () => {
    assert.deepEqual(
        restoreTruncatedOptionText(
            { e: '悪性リンパ腫の形質転換' },
            { e: '悪性リンパ腫の形質転換 治療半年後 L15 H3 H15' },
        ),
        { e: '悪性リンパ腫の形質転換' },
    );
    assert.deepEqual(
        restoreTruncatedOptionText(
            { e: 'HH15低値、LHL15低値' },
            { e: 'HH15低値、LHL15低値 時間放射能曲線' },
        ),
        { e: 'HH15低値、LHL15低値' },
    );
});

test('orders top-aligned images from left to right regardless of height', () => {
    const images = [
        { page: 18, x: 299, y: 430, w: 237, h: 156 },
        { page: 18, x: 60, y: 326, w: 237, h: 260 },
    ];

    assert.deepEqual([...images].sort(compareImageReadingOrder).map(image => image.x), [60, 299]);
});

test('orders bottom-aligned images from left to right regardless of height', () => {
    const images = [
        { page: 61, x: 294.46, y: 287.4, w: 245.24, h: 282.84, legend: '術後' },
        { page: 61, x: 55.69, y: 287.24, w: 243.6, h: 259.95, legend: '術前' },
    ];

    assert.deepEqual([...images].sort(compareImageReadingOrder).map(image => image.legend), ['術前', '術後']);
});

test('merges a vertically stacked image series while preserving a separate side image', () => {
    const left = { x: 60, y: 257, w: 165, h: 308, matchedQNum: 72 };
    const rightTop = { x: 227, y: 382, w: 308, h: 184, matchedQNum: 72 };
    const rightBottom = { x: 227, y: 194, w: 308, h: 184, matchedQNum: 72 };
    const result = mergeVerticallyAdjacentImageRects([rightTop, left, rightBottom]);

    assert.equal(result.length, 2);
    assert.equal(result.find(rect => rect.x === 227).h, 372);
    assert.equal(result.find(rect => rect.x === 60), left);
});

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
