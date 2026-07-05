import test from 'node:test';
import assert from 'node:assert/strict';

import {
    assignRectToQuestionAnchor,
    buildNuclearStructuralGroups,
    buildNuclearDisplayLegend,
    mergeNuclearImageFragments,
    resolveNuclearDisplayLegend
} from '../src/lib/nuclearFigureGeometry.mjs';

const structuralObject = (id, type, x, y, w, h, extra = {}) => ({
    id,
    type,
    viewportRect: { x, y, w, h },
    ...extra
});

test('merges stacked wide strips from one rendered figure', () => {
    const strips = [
        { x: 105.8, y: 711.1, w: 423.6, h: 57.1 },
        { x: 105.8, y: 654.1, w: 423.6, h: 57.1 },
        { x: 105.8, y: 597.1, w: 423.6, h: 57.0 },
        { x: 105.8, y: 439.5, w: 423.6, h: 143.1 }
    ];

    const result = mergeNuclearImageFragments(strips, 595.276);

    assert.equal(result.length, 1);
    assert.ok(result[0].h > 320);
});

test('keeps complete stacked images separate when whitespace separates them', () => {
    const images = [
        { x: 154.1, y: 280.9, w: 381.8, h: 218.8 },
        { x: 154.1, y: 554.2, w: 382.3, h: 218.8 }
    ];

    assert.equal(mergeNuclearImageFragments(images, 595.276).length, 2);
});

test('keeps touching panels separate when they form a grid', () => {
    const panels = [
        { x: 71.8, y: 625.4, w: 222.9, h: 164.5 },
        { x: 296.7, y: 625.4, w: 227.9, h: 164.5 },
        { x: 70.3, y: 435.4, w: 225.4, h: 185.9 },
        { x: 366.5, y: 317.2, w: 158.2, h: 300.2 }
    ];

    assert.equal(mergeNuclearImageFragments(panels, 595.276).length, 4);
});

test('assigns a boundary-crossing image by section overlap instead of center distance', () => {
    const anchors = [
        { id: 'A56', viewportRect: { x: 0, y: 40, w: 70, h: 25 } },
        { id: 'A58', viewportRect: { x: 0, y: 690, w: 70, h: 25 } }
    ];
    const crossingImage = { x: 550, y: 335, w: 240, h: 450 };

    const assignment = assignRectToQuestionAnchor(crossingImage, anchors, 1263);

    assert.equal(assignment.defaultAnchor.id, 'A56');
    assert.deepEqual(assignment.candidateAnchorIds, ['A56']);
});

test('does not offer a distant adjacent anchor for a fully owned image', () => {
    const anchors = [
        { id: 'A45', viewportRect: { x: 0, y: 50, w: 70, h: 25 } },
        { id: 'A46', viewportRect: { x: 0, y: 795, w: 70, h: 25 } }
    ];

    const assignment = assignRectToQuestionAnchor({ x: 190, y: 400, w: 510, h: 308 }, anchors, 1263);

    assert.equal(assignment.defaultAnchor.id, 'A45');
    assert.deepEqual(assignment.candidateAnchorIds, ['A45']);
});

test('keeps semantic text after a figure-number caption', () => {
    const sources = [
        { text: '図1', viewportRect: { x: 100, y: 50, w: 40, h: 20 } },
        { text: '18F-FDG PET画像', viewportRect: { x: 155, y: 50, w: 180, h: 20 } }
    ];

    assert.equal(buildNuclearDisplayLegend(sources), '18F-FDG PET画像');
});

test('moves one contextual label to the display legend', () => {
    const sources = [
        { text: '術前', viewportRect: { x: 100, y: 50, w: 40, h: 20 } }
    ];

    assert.equal(buildNuclearDisplayLegend(sources), '術前');
});

test('keeps repeated internal labels out of the display legend', () => {
    const sources = [
        { text: '上段', viewportRect: { x: 20, y: 50, w: 40, h: 20 } },
        { text: '下段', viewportRect: { x: 20, y: 90, w: 40, h: 20 } }
    ];

    assert.deepEqual(resolveNuclearDisplayLegend(sources), { legend: '', sources: [] });
});

test('uses a figure token when it has no semantic remainder', () => {
    const source = { text: '図3', viewportRect: { x: 100, y: 50, w: 40, h: 20 } };
    const resolved = resolveNuclearDisplayLegend([source]);

    assert.equal(resolved.legend, '図3');
    assert.deepEqual(resolved.sources, [source]);
});

test('moves a single orientation caption to the display legend', () => {
    const sources = [
        { text: '左：水平断面', viewportRect: { x: 100, y: 50, w: 100, h: 20 } }
    ];

    assert.equal(buildNuclearDisplayLegend(sources), '左：水平断面');
});

test('rejects appendix reference words after a figure token', () => {
    const sources = [
        { text: '図1 別紙', viewportRect: { x: 100, y: 50, w: 100, h: 20 } }
    ];

    assert.equal(buildNuclearDisplayLegend(sources), '');
});

test('groups all images inside numbered question subsections', () => {
    const objects = [
        structuralObject('A1', 'question_anchor', 40, 30, 100, 24, { text: 'No. 50-1' }),
        structuralObject('A2', 'question_anchor', 40, 520, 100, 24, { text: 'No. 50-2' }),
        structuralObject('I1', 'image', 180, 80, 220, 360, { defaultQuestionAnchorId: 'A1' }),
        structuralObject('I2', 'image', 420, 80, 220, 360, { defaultQuestionAnchorId: 'A1' }),
        structuralObject('I3', 'image', 150, 580, 220, 260, { defaultQuestionAnchorId: 'A2' }),
        structuralObject('I4', 'image', 390, 580, 220, 260, { defaultQuestionAnchorId: 'A2' })
    ];

    const result = buildNuclearStructuralGroups(objects, 900);

    assert.equal(result.complete, true);
    assert.deepEqual(result.groups.map(group => group.imageIds), [
        ['I1', 'I2'],
        ['I3', 'I4']
    ]);
});

test('groups multiple image objects by explicit figure bands', () => {
    const objects = [
        structuralObject('A1', 'question_anchor', 40, 25, 75, 24, { text: 'No. 51' }),
        structuralObject('T1', 'text', 45, 65, 45, 22, { text: '図1' }),
        structuralObject('T2', 'text', 45, 410, 45, 22, { text: '図2' }),
        structuralObject('I1', 'image', 60, 100, 260, 220, { defaultQuestionAnchorId: 'A1' }),
        structuralObject('I2', 'image', 340, 100, 260, 220, { defaultQuestionAnchorId: 'A1' }),
        structuralObject('I3', 'image', 60, 450, 260, 220, { defaultQuestionAnchorId: 'A1' }),
        structuralObject('I4', 'image', 340, 450, 260, 220, { defaultQuestionAnchorId: 'A1' })
    ];

    const result = buildNuclearStructuralGroups(objects, 760);

    assert.equal(result.complete, true);
    assert.deepEqual(result.groups.map(group => ({ images: group.imageIds, legends: group.legendIds })), [
        { images: ['I1', 'I2'], legends: ['T1'] },
        { images: ['I3', 'I4'], legends: ['T2'] }
    ]);
});

test('leaves unlabelled multi-image sections for VLM grouping', () => {
    const objects = [
        structuralObject('A1', 'question_anchor', 40, 25, 75, 24, { text: 'No. 56' }),
        structuralObject('I1', 'image', 60, 100, 240, 220, { defaultQuestionAnchorId: 'A1' }),
        structuralObject('I2', 'image', 320, 100, 240, 220, { defaultQuestionAnchorId: 'A1' })
    ];

    const result = buildNuclearStructuralGroups(objects, 760);

    assert.equal(result.complete, false);
    assert.deepEqual(result.groups, []);
});
