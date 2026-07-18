import assert from 'node:assert/strict';
import test from 'node:test';

import { filterUnavailableStaticImages } from '../src/lib/staticImageReferences.mjs';

test('removes unavailable bundled image references without a question-specific rule', () => {
    const question = filterUnavailableStaticImages({
        images: [
            { path: 'assets/images/nuclear/2021/available.png' },
            { path: 'assets/images/nuclear/2021/missing.png' }
        ]
    }, new Set(['/assets/images/nuclear/2021/available.png']));

    assert.deepEqual(question.images.map(image => image.path), [
        'assets/images/nuclear/2021/available.png'
    ]);
});

test('preserves non-bundled image sources used by local imports', () => {
    const question = filterUnavailableStaticImages({
        images: [{ path: 'data:image/png;base64,abc' }]
    }, new Set());

    assert.equal(question.images.length, 1);
});
