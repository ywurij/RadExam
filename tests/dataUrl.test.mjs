import assert from 'node:assert/strict';
import test from 'node:test';

import { dataUrlToBlob } from '../src/lib/dataUrl.mjs';

test('converts a base64 data URL to a blob without fetch', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => {
        throw new Error('fetch must not be called');
    };
    try {
        const blob = dataUrlToBlob('data:image/png;base64,AAECAw==');
        assert.equal(blob.type, 'image/png');
        assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [0, 1, 2, 3]);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('converts a percent-encoded data URL and retains its media type', async () => {
    const blob = dataUrlToBlob('data:text/plain;charset=utf-8,%E8%A9%A6%E9%A8%93');
    assert.equal(blob.type, 'text/plain;charset=utf-8');
    assert.equal(await blob.text(), '試験');
});

test('rejects malformed data URLs with a useful error', () => {
    assert.throws(
        () => dataUrlToBlob('not-a-data-url'),
        /画像・PDFデータの形式が不正/
    );
    assert.throws(
        () => dataUrlToBlob('data:image/png;base64,!invalid!'),
        /画像・PDFデータを復元できませんでした/
    );
});

