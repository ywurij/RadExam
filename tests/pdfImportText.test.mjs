import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildPairedOptionText,
    extractQuestionTable,
    findNearestPrecedingQuestion,
    isPairedOptionHeader,
} from '../src/lib/pdfImportText.js';

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
