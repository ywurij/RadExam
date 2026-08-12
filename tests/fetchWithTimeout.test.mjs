import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchWithTimeout } from '../src/lib/sync/fetchWithTimeout.mjs';

test('クラウド通信が制限時間を超えたら中断する', async () => {
    await assert.rejects(fetchWithTimeout({
        fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
        }),
        url: 'https://example.invalid',
        timeoutMs: 5,
    }), error => error?.name === 'TimeoutError');
});

test('呼び出し元の中断シグナルも引き継ぐ', async () => {
    const upstream = new AbortController();
    const expected = new Error('cancelled');
    const pending = fetchWithTimeout({
        fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
        }),
        url: 'https://example.invalid',
        options: { signal: upstream.signal },
        timeoutMs: 1000,
    });
    upstream.abort(expected);
    await assert.rejects(pending, error => error === expected);
});
