import assert from 'node:assert/strict';
import test from 'node:test';
import {
    changeOptionLayoutMode,
    getEditableOptionCells,
    getOptionColumnCount,
    getOptionLayoutError,
    getOptionLayoutMode,
    updateOptionCell,
} from '../src/lib/optionLayout.mjs';

test('通常形式から2列の組み合わせ形式に変更しても選択肢の文章を保持する', () => {
    const original = '検査A';
    const layout = changeOptionLayoutMode(null, 'columns2');
    assert.deepEqual(layout, { type: 'columns', columnCount: 2, headers: ['', ''] });
    assert.deepEqual(getEditableOptionCells(original, 2), ['検査A', '']);
    const combined = updateOptionCell(original, 2, 1, '疾患B');
    assert.equal(combined, '検査A ― 疾患B');
    assert.equal(getOptionLayoutError({ a: combined }, layout), '');
    assert.equal(changeOptionLayoutMode(layout, 'normal'), null);
    assert.equal(combined, '検査A ― 疾患B');
});

test('3列の編集では列名と既存の選択肢を保持し、不完全な行を検出する', () => {
    const layout = changeOptionLayoutMode({ type: 'paired', headers: ['薬剤', '疾患'] }, 'columns3');
    assert.equal(getOptionLayoutMode(layout), 'columns3');
    assert.equal(getOptionColumnCount(layout), 3);
    assert.deepEqual(layout.headers, ['薬剤', '疾患', '']);
    assert.deepEqual(getEditableOptionCells('A ― B', 3), ['A', 'B', '']);
    assert.equal(getOptionLayoutError({ a: 'A ― B' }, layout), '選択肢 a は 3 列すべてに内容を入力してください。');
    assert.equal(getOptionLayoutError({ a: 'A ― B ― C', b: '' }, layout), '');
});

test('3列から2列への切替では余った内容を消さず、手動修正を促す', () => {
    const value = 'A ― B ― C';
    assert.equal(getEditableOptionCells(value, 2), null);
    assert.equal(getOptionLayoutError({ a: value }, changeOptionLayoutMode(null, 'columns2')), '選択肢 a は 2 列すべてに内容を入力してください。');
    assert.equal(getOptionLayoutMode({ type: 'paired' }), 'columns2');
});
