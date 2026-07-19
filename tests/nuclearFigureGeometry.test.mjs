import test from 'node:test';
import assert from 'node:assert/strict';

import {
    assignRectToQuestionAnchor,
    buildNuclearCanvasRotationPlan,
    buildNuclearStructuralGroups,
    buildNuclearDisplayLegend,
    detectNuclearContentRotation,
    expandFigureRectWithinOwner,
    extractPdfImageRectFromTransform,
    mergeNuclearImageFragments,
    normalizeNuclearPdfRect,
    normalizeNuclearTextItemGeometry,
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

test('assigns side-by-side images to question anchors on the same row', () => {
    const anchors = [
        { id: 'A53', viewportRect: { x: 50, y: 400, w: 60, h: 24 } },
        { id: 'A55', viewportRect: { x: 310, y: 400, w: 60, h: 24 } }
    ];

    const left = assignRectToQuestionAnchor(
        { x: 78, y: 425, w: 190, h: 365 },
        anchors,
        842
    );
    const right = assignRectToQuestionAnchor(
        { x: 328, y: 425, w: 228, h: 365 },
        anchors,
        842
    );

    assert.equal(left.defaultAnchor.id, 'A53');
    assert.equal(right.defaultAnchor.id, 'A55');
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

test('orders structural figure groups by figure label instead of page position', () => {
    const objects = [
        structuralObject('A1', 'question_anchor', 40, 25, 75, 24, { text: 'No. 52-2' }),
        structuralObject('T4', 'text', 80, 60, 40, 20, { text: '図4' }),
        structuralObject('T6', 'text', 360, 60, 40, 20, { text: '図6' }),
        structuralObject('T5', 'text', 80, 330, 40, 20, { text: '図5' }),
        structuralObject('I4', 'image', 70, 90, 220, 200, { defaultQuestionAnchorId: 'A1' }),
        structuralObject('I6', 'image', 350, 90, 220, 240, { defaultQuestionAnchorId: 'A1' }),
        structuralObject('I5', 'image', 70, 360, 220, 200, { defaultQuestionAnchorId: 'A1' })
    ];

    const result = buildNuclearStructuralGroups(objects, 760);

    assert.deepEqual(result.groups.map(group => group.legendIds[0]), ['T4', 'T5', 'T6']);
    assert.deepEqual(result.groups.map(group => group.imageIds), [['I4'], ['I5'], ['I6']]);
});

test('keeps staggered side-by-side figure labels in one row', () => {
    const objects = [
        structuralObject('A1', 'question_anchor', 40, 25, 75, 24, { text: 'No. 56' }),
        structuralObject('T3', 'text', 70, 560, 40, 20, { text: '図3' }),
        structuralObject('T4', 'text', 335, 584, 40, 20, { text: '図4' }),
        structuralObject('I3', 'image', 65, 590, 245, 225, { defaultQuestionAnchorId: 'A1' }),
        structuralObject('I4', 'image', 335, 614, 210, 165, { defaultQuestionAnchorId: 'A1' })
    ];

    const result = buildNuclearStructuralGroups(objects, 840);

    assert.deepEqual(result.groups.map(group => group.imageIds), [['I3'], ['I4']]);
});

test('groups tight two-by-two image grids without a figure label', () => {
    const objects = [
        structuralObject('A1', 'question_anchor', 40, 25, 75, 24, { text: 'No. 52' }),
        structuralObject('I1', 'image', 100, 100, 80, 75, { defaultQuestionAnchorId: 'A1' }),
        structuralObject('I2', 'image', 187, 100, 80, 75, { defaultQuestionAnchorId: 'A1' }),
        structuralObject('I3', 'image', 100, 183, 80, 75, { defaultQuestionAnchorId: 'A1' }),
        structuralObject('I4', 'image', 187, 183, 80, 75, { defaultQuestionAnchorId: 'A1' }),
        structuralObject('I5', 'image', 350, 100, 80, 75, { defaultQuestionAnchorId: 'A1' }),
        structuralObject('I6', 'image', 437, 100, 80, 75, { defaultQuestionAnchorId: 'A1' }),
        structuralObject('I7', 'image', 350, 183, 80, 75, { defaultQuestionAnchorId: 'A1' }),
        structuralObject('I8', 'image', 437, 183, 80, 75, { defaultQuestionAnchorId: 'A1' })
    ];

    const result = buildNuclearStructuralGroups(objects, 600);

    assert.equal(result.complete, true);
    assert.deepEqual(result.groups.map(group => group.imageIds), [
        ['I1', 'I2', 'I3', 'I4'],
        ['I5', 'I6', 'I7', 'I8']
    ]);
});

test('keeps a differently sized adjacent image outside a paired composite', () => {
    const objects = [
        structuralObject('A1', 'question_anchor', 40, 25, 75, 24, { text: 'No. 53' }),
        structuralObject('I1', 'image', 40, 70, 140, 425, { defaultQuestionAnchorId: 'A1' }),
        structuralObject('I2', 'image', 177, 70, 140, 425, { defaultQuestionAnchorId: 'A1' }),
        structuralObject('I3', 'image', 322, 115, 245, 185, { defaultQuestionAnchorId: 'A1' })
    ];

    const result = buildNuclearStructuralGroups(objects, 700);

    assert.deepEqual(result.groups.map(group => group.imageIds), [
        ['I1', 'I2'],
        ['I3']
    ]);
});

test('groups an aligned three-panel row as one composite', () => {
    const objects = [
        structuralObject('A1', 'question_anchor', 40, 25, 75, 24, { text: 'No. 47' }),
        structuralObject('I1', 'image', 100, 100, 95, 360, { defaultQuestionAnchorId: 'A1' }),
        structuralObject('I2', 'image', 265, 104, 95, 358, { defaultQuestionAnchorId: 'A1' }),
        structuralObject('I3', 'image', 430, 103, 95, 355, { defaultQuestionAnchorId: 'A1' })
    ];

    const result = buildNuclearStructuralGroups(objects, 600);

    assert.equal(result.complete, true);
    assert.deepEqual(result.groups.map(group => group.imageIds), [['I1', 'I2', 'I3']]);
});

test('normalizes clockwise page content into a horizontal analysis space', () => {
    const textItem = {
        str: 'No. 49',
        transform: [0, -13, 13, 0, 523.7, 768.1],
        width: 35,
        height: 13
    };

    assert.equal(detectNuclearContentRotation([textItem]), 270);
    const normalizedText = normalizeNuclearTextItemGeometry(textItem, 842, 270, 19);
    const normalizedRect = normalizeNuclearPdfRect(
        { x: 93.8, y: 169.8, w: 109.4, h: 502.6 },
        842,
        270
    );
    assert.ok(Math.abs(normalizedText.x - 73.9) < 0.001);
    assert.equal(normalizedText.y, 523.7);
    assert.ok(Math.abs(normalizedRect.x - 169.6) < 0.001);
    assert.deepEqual(
        { y: normalizedRect.y, w: normalizedRect.w, h: normalizedRect.h },
        { y: 93.8, w: 502.6, h: 109.4 }
    );
});

test('detects rotated content even when the No anchor is split or unavailable', () => {
    const items = [
        { str: 'Time', transform: [0, -10, 10, 0, 100, 700] },
        { str: 'Activity', transform: [0, -10, 10, 0, 130, 700] },
        { str: 'Curve', transform: [0, -10, 10, 0, 160, 700] },
        { str: 'Minutes', transform: [0, -10, 10, 0, 190, 700] },
        { str: 'kcpm', transform: [0, -10, 10, 0, 220, 700] }
    ];

    assert.equal(detectNuclearContentRotation(items), 270);
});

test('extracts a non-zero image rect from a rotated PDF image transform', () => {
    const rect = extractPdfImageRectFromTransform([0, -774.96, 329.28, 0, 111.84, 808.44]);

    assert.ok(Math.abs(rect.x - 111.84) < 0.001);
    assert.ok(Math.abs(rect.y - 33.48) < 0.001);
    assert.ok(Math.abs(rect.w - 329.28) < 0.001);
    assert.ok(Math.abs(rect.h - 774.96) < 0.001);
});

test('builds a canvas rotation plan matching the normalized clockwise PDF space', () => {
    const plan = buildNuclearCanvasRotationPlan(892.8, 1262.88, 270);

    assert.deepEqual(
        {
            width: plan.width,
            height: plan.height,
            translateX: plan.translateX,
            translateY: plan.translateY
        },
        {
            width: 1263,
            height: 893,
            translateX: 0,
            translateY: 893
        }
    );
    assert.equal(plan.radians, -Math.PI / 2);
});

test('keeps every image object on a rotated question page in one composite', () => {
    const objects = [
        structuralObject('A1', 'question_anchor', 20, 20, 70, 20, { text: 'No. 50' }),
        structuralObject('I1', 'image', 60, 70, 280, 180, { defaultQuestionAnchorId: 'A1' }),
        structuralObject('I2', 'image', 390, 70, 180, 180, { defaultQuestionAnchorId: 'A1' }),
        structuralObject('I3', 'image', 60, 280, 180, 180, { defaultQuestionAnchorId: 'A1' }),
        structuralObject('I4', 'image', 280, 280, 180, 180, { defaultQuestionAnchorId: 'A1' })
    ];

    const result = buildNuclearStructuralGroups(objects, 595, {
        forceQuestionComposite: true
    });

    assert.equal(result.complete, true);
    assert.deepEqual(result.groups.map(group => group.imageIds), [['I1', 'I2', 'I3', 'I4']]);
});

test('does not expand a crop into the next question anchor band', () => {
    const imageRect = { x: 110, y: 370.9, w: 464, h: 433.8 };
    const result = expandFigureRectWithinOwner(
        imageRect,
        [imageRect],
        {
            ownerLeftX: -Infinity,
            ownerRightX: Infinity,
            ownerBottomY: 375,
            ownerTopY: 830
        },
        8
    );

    assert.equal(result.y, imageRect.y);
    assert.ok(Math.abs(result.h - (imageRect.h + 8)) < 0.001);
});
