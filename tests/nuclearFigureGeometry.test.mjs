import test from 'node:test';
import assert from 'node:assert/strict';

import {
    assignRectToQuestionAnchor,
    mergeNuclearImageFragments
} from '../src/lib/nuclearFigureGeometry.mjs';

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
    assert.deepEqual(assignment.candidateAnchorIds, ['A56', 'A58']);
});
