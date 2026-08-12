import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { fetchWithTimeout } = require('../electron/fetchWithTimeout.js');

test('ElectronのOAuth通信を制限時間で中断する', async () => {
    await assert.rejects(fetchWithTimeout(
        (_url, options) => new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
        }),
        'https://example.invalid',
        {},
        5
    ), error => error?.name === 'TimeoutError');
});
