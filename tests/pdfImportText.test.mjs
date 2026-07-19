import assert from 'node:assert/strict';
import test from 'node:test';

import {
    assignNearestUniqueLabels,
    buildPairedOptionText,
    buildSourceGridLayouts,
    compareImageReadingOrder,
    extractQuestionTable,
    extractOptionColumnHeaders,
    findNearestPrecedingQuestion,
    groupNearbyLegendItems,
    hasNearbyOptionPrefix,
    hasSingleNearbyLegendGroup,
    hasExplicitFigureCue,
    isPairedOptionHeader,
    isRepeatedOptionOrFigureLabel,
    isLikelyOptionContinuationLine,
    isLikelyLegendContinuationText,
    isStandaloneImageLegendText,
    isUsableFallbackFigureCrop,
    joinOptionContinuation,
    mergeHorizontalImagePairsBySharedLegend,
    mergeVerticallyAdjacentImageRects,
    mergeTwoByTwoImageGridRects,
    repairLegacySequentialComparisonOptions,
    removeContainedImageRects,
    restoreTruncatedOptionText,
    shouldConsumeOptionColumnHeaders,
    splitOptionItemsByColumns,
    spreadPositionedLegendLabels,
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

test('groups adjacent numeric and text fragments into one legend label', () => {
    const groups = groupNearbyLegendItems([
        { text: '治療前', x: 100, y: 300, width: 42, height: 10 },
        { text: '2', x: 250, y: 300, width: 6, height: 8 },
        { text: 'か月後', x: 257, y: 300, width: 32, height: 10 },
        { text: '1', x: 400, y: 300, width: 6, height: 8 },
        { text: '年後', x: 407, y: 300, width: 22, height: 10 },
    ]);

    assert.deepEqual(groups.map(group => group.text), ['治療前', '2か月後', '1年後']);
    assert.deepEqual(groups[1].items.map(item => item.text), ['2', 'か月後']);
});

test('groups an elevated isotope prefix with the adjacent nuclide name', () => {
    const groups = groupNearbyLegendItems([
        { text: '99m', x: 100, y: 307, width: 12, height: 7 },
        { text: 'Tc-MIBI', x: 112, y: 300, width: 42, height: 12 },
    ]);
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].items.map(token => token.text), ['99m', 'Tc-MIBI']);
});

test('keeps a parenthetical legend and its unit in one group across a wider gap', () => {
    const groups = groupNearbyLegendItems([
        { text: '拡散強調像（b＝800', x: 100, y: 300, width: 108, height: 10 },
        { text: 's/mm', x: 238, y: 300, width: 28, height: 10 },
        { text: '2', x: 266, y: 307, width: 5, height: 6 },
        { text: '）', x: 271, y: 300, width: 10, height: 10 },
    ]);

    assert.equal(groups.length, 1);
    assert.equal(groups[0].text, '拡散強調像（b＝800s/mm2）');
});

test('only consumes option-column headers before answer choices start', () => {
    const headers = [{ key: 'a' }, { key: 'b' }];
    assert.equal(shouldConsumeOptionColumnHeaders(headers, false), true);
    assert.equal(shouldConsumeOptionColumnHeaders(headers, true), false);
    assert.equal(shouldConsumeOptionColumnHeaders([{ key: 'a' }], false), false);
});

test('accepts a bracketed second line only after an existing legend line', () => {
    assert.equal(
        isLikelyLegendContinuationText('（基準値 1200～1250 ms）', 'T1 map：native T1＝780 ms'),
        true,
    );
    assert.equal(isLikelyLegendContinuationText('（基準値 1200～1250 ms）', ''), false);
    assert.equal(isLikelyLegendContinuationText('基準値 1200～1250 ms', 'T1 map'), false);
});

test('spreads colliding structured labels without changing distinct positions', () => {
    assert.deepEqual(
        spreadPositionedLegendLabels([
            { text: '前面像', position: 'bottom', offset: 0.5 },
            { text: '後面像', position: 'bottom', offset: 0.5 },
            { text: '負荷時', position: 'left', offset: 0.25 },
            { text: '安静時', position: 'left', offset: 0.75 },
        ]).map(label => label.offset),
        [0.44, 0.56, 0.25, 0.75],
    );
});

test('distinguishes one title from multiple captions on the same line', () => {
    assert.equal(hasSingleNearbyLegendGroup([
        { text: '遅延造影', x: 100, y: 300, width: 48, height: 10 },
        { text: '像', x: 150, y: 300, width: 10, height: 10 },
    ]), true);
    assert.equal(hasSingleNearbyLegendGroup([
        { text: '短軸像', x: 100, y: 300, width: 42, height: 10 },
        { text: '垂直長軸像', x: 280, y: 300, width: 70, height: 10 },
    ]), false);
});

test('only treats a nearby left marker as an option prefix', () => {
    const target = { text: 'B', x: 220, y: 300, width: 8, height: 10 };
    assert.equal(hasNearbyOptionPrefix(target, [
        { text: 'A', x: 100, y: 300, width: 8, height: 10 },
    ]), false);
    assert.equal(hasNearbyOptionPrefix(
        { text: '血流量', x: 120, y: 300, width: 42, height: 10 },
        [{ text: 'a', x: 100, y: 300, width: 7, height: 10 }],
    ), true);
});

test('uses line geometry to separate wrapped options from distant image legends', () => {
    const optionLine = [
        { text: 'e', x: 90, y: 600, width: 6, height: 11, pageNum: 7 },
        { text: 'Dynamic susceptibility contrast法は', x: 120, y: 600, width: 180, height: 11, pageNum: 7 },
    ];
    const wrappedLine = [
        { text: 'Gd造影剤を使用する。', x: 120, y: 585, width: 130, height: 11, pageNum: 7 },
    ];
    const distantUnknownLegend = [
        { text: '投与120秒', x: 240, y: 310, width: 60, height: 11, pageNum: 7 },
    ];

    assert.equal(isLikelyOptionContinuationLine(optionLine, wrappedLine), true);
    assert.equal(isLikelyOptionContinuationLine(optionLine, distantUnknownLegend), false);
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

test('preserves a two-over-one source image layout on a twelve-column grid', () => {
    const images = [
        { page: 65, x: 97.8, y: 388.5, w: 198.4, h: 174.2 },
        { page: 65, x: 299.1, y: 388.5, w: 198.4, h: 177.0 },
        { page: 65, x: 198.4, y: 184.3, w: 198.4, h: 170.9 },
    ];
    const layouts = buildSourceGridLayouts(images);

    assert.deepEqual(layouts.map(layout => layout.row), [1, 1, 2]);
    assert.deepEqual(layouts.map(layout => layout.columnStart), [1, 7, 4]);
    assert.deepEqual(layouts.map(layout => layout.columnSpan), [6, 6, 6]);
});

test('does not overlap adjacent source-grid columns after independent image extraction', () => {
    const images = [
        { page: 54, x: 102, y: 300, w: 213, h: 250 },
        { page: 54, x: 316, y: 300, w: 163, h: 220 },
        { page: 54, x: 480, y: 300, w: 162, h: 220 },
    ];
    const layouts = buildSourceGridLayouts(images);
    const middleEnd = layouts[1].columnStart + layouts[1].columnSpan - 1;
    assert.ok(middleEnd < layouts[2].columnStart);
});

test('preserves a tall-left and stacked-right source layout with row span', () => {
    const images = [
        { page: 73, x: 60, y: 194, w: 165, h: 372 },
        { page: 73, x: 227, y: 382, w: 308, h: 184 },
        { page: 73, x: 227, y: 194, w: 308, h: 184 },
    ];
    const layouts = buildSourceGridLayouts(images);

    assert.deepEqual(layouts.map(layout => layout.row), [1, 1, 2]);
    assert.deepEqual(layouts.map(layout => layout.rowSpan), [2, 1, 1]);
    assert.deepEqual(layouts.map(layout => layout.columnStart), [1, 5, 5]);
});

test('merges a horizontal image pair when one centered legend is shared', () => {
    const images = [
        { x: 100, y: 300, w: 150, h: 190, matchedQNum: 1 },
        { x: 256, y: 300, w: 150, h: 190, matchedQNum: 1 },
        { x: 175, y: 80, w: 160, h: 180, matchedQNum: 1 },
    ];
    const result = mergeHorizontalImagePairsBySharedLegend(images, {
        textItems: [
            { text: '拡散強調像', x: 220, y: 280, width: 66, height: 10 },
            { text: 'FLAIR冠状断像', x: 215, y: 60, width: 90, height: 10 },
        ],
    });

    assert.equal(result.length, 2);
    assert.deepEqual(
        { x: result[0].x, y: result[0].y, w: result[0].w, h: result[0].h, preserveCompositeRow: result[0].preserveCompositeRow },
        { x: 100, y: 300, w: 306, h: 190, preserveCompositeRow: true },
    );
    assert.equal(mergeVerticallyAdjacentImageRects(result).length, 2);
});

test('keeps a horizontal image pair separate when each image has a caption', () => {
    const images = [
        { x: 100, y: 300, w: 150, h: 190, matchedQNum: 17 },
        { x: 256, y: 300, w: 150, h: 190, matchedQNum: 17 },
    ];
    const result = mergeHorizontalImagePairsBySharedLegend(images, {
        textItems: [
            { text: '治療前', x: 148, y: 280, width: 42, height: 10 },
            { text: '治療後', x: 304, y: 280, width: 42, height: 10 },
        ],
    });

    assert.deepEqual(result, images);
});

test('merges a horizontal pair when one shared caption is split into nearby text groups', () => {
    const images = [
        { x: 100, y: 300, w: 150, h: 190, matchedQNum: 66 },
        { x: 256, y: 300, w: 150, h: 190, matchedQNum: 66 },
    ];
    const result = mergeHorizontalImagePairsBySharedLegend(images, {
        textItems: [
            { text: 'T2', x: 220, y: 280, width: 15, height: 10 },
            { text: '強調横断像', x: 263, y: 280, width: 62, height: 10 },
        ],
    });

    assert.equal(result.length, 1);
    assert.equal(result[0].preserveCompositeRow, true);
});

test('merges an aligned two-by-two image grid into one composite figure', () => {
    const grid = [
        { x: 100, y: 300, w: 120, h: 140, matchedQNum: 76 },
        { x: 230, y: 300, w: 120, h: 140, matchedQNum: 76 },
        { x: 100, y: 150, w: 120, h: 140, matchedQNum: 76 },
        { x: 230, y: 150, w: 120, h: 140, matchedQNum: 76 },
    ];
    const result = mergeTwoByTwoImageGridRects(grid);

    assert.equal(result.length, 1);
    assert.deepEqual(result[0], { x: 100, y: 150, w: 250, h: 290, matchedQNum: 76 });
});

test('preserves two composite rows when captions occupy the gap in a two-by-two grid', () => {
    const grid = [
        { x: 100, y: 300, w: 120, h: 140, matchedQNum: 63 },
        { x: 230, y: 300, w: 120, h: 140, matchedQNum: 63 },
        { x: 100, y: 150, w: 120, h: 140, matchedQNum: 63 },
        { x: 230, y: 150, w: 120, h: 140, matchedQNum: 63 },
    ];
    const result = mergeTwoByTwoImageGridRects(grid, {
        textItems: [
            { text: '短軸像', x: 130, y: 292, width: 42, height: 6 },
            { text: '垂直長軸像', x: 260, y: 292, width: 70, height: 6 },
            { text: '123I-BMIPP', x: 45, y: 360, width: 50, height: 10 },
            { text: '201Tl', x: 55, y: 210, width: 40, height: 10 },
        ],
    });

    assert.equal(result.length, 2);
    assert.deepEqual(
        result.map(({ x, y, w, h, preserveCompositeRow }) => ({ x, y, w, h, preserveCompositeRow })),
        [
            { x: 100, y: 300, w: 250, h: 140, preserveCompositeRow: true },
            { x: 100, y: 150, w: 250, h: 140, preserveCompositeRow: true },
        ],
    );
    assert.equal(mergeVerticallyAdjacentImageRects(result).length, 2);
});

test('keeps four figures separate when a captioned two-by-two grid has no row labels', () => {
    const grid = [
        { x: 100, y: 300, w: 120, h: 140, matchedQNum: 44 },
        { x: 230, y: 300, w: 120, h: 140, matchedQNum: 44 },
        { x: 100, y: 150, w: 120, h: 140, matchedQNum: 44 },
        { x: 230, y: 150, w: 120, h: 140, matchedQNum: 44 },
    ];
    const result = mergeTwoByTwoImageGridRects(grid, {
        textItems: [
            { text: '動脈相', x: 130, y: 292, width: 42, height: 8 },
            { text: '後期相', x: 260, y: 292, width: 42, height: 8 },
        ],
    });
    assert.equal(result.length, 4);
    assert.equal(mergeVerticallyAdjacentImageRects(result).length, 4);
});

test('does not merge a loose collection that is not a two-by-two grid', () => {
    const figures = [
        { x: 100, y: 300, w: 120, h: 140, matchedQNum: 76 },
        { x: 300, y: 300, w: 120, h: 140, matchedQNum: 76 },
        { x: 100, y: 80, w: 120, h: 140, matchedQNum: 76 },
        { x: 360, y: 40, w: 80, h: 80, matchedQNum: 76 },
    ];

    assert.equal(mergeTwoByTwoImageGridRects(figures).length, 4);
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

test('does not treat numeric imaging conditions in prose as a table', () => {
    const lines = [
        {
            items: [
                item('60', 100), item('歳代の男性。血清PSA値が', 120, 135),
                item('6', 260), item('ng/mLのためMRIを施行した。', 275, 160),
                item('T2', 450),
            ],
        },
        {
            items: [
                item('拡散強調像（b＝', 100, 100), item('1', 205), item('400', 218),
                item('s/mm', 245, 35), item('2', 282), item('ADC map（b＝', 310, 80),
                item('50', 395), item('800', 420), item('s/mm', 450, 35), item('2', 487),
            ],
        },
    ];

    const result = extractQuestionTable(lines);
    assert.deepEqual([...result.lineIndexes], []);
    assert.equal(result.html, '');
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
