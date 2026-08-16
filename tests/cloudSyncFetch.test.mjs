import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import { createDesktopCloudFetch } from '../src/lib/sync/desktopCloudFetch.mjs';

const require = createRequire(import.meta.url);
const {
    assertAllowedCloudUrl,
    performCloudSyncFetch,
} = require('../electron/cloudSyncFetch');

test('Mac/PC版のクラウド通信先をGoogle DriveとMicrosoftに限定する', () => {
    assert.equal(
        assertAllowedCloudUrl('https://www.googleapis.com/drive/v3/files?spaces=appDataFolder'),
        'https://www.googleapis.com/drive/v3/files?spaces=appDataFolder'
    );
    assert.equal(
        assertAllowedCloudUrl('https://graph.microsoft.com/v1.0/me/drive/special/approot'),
        'https://graph.microsoft.com/v1.0/me/drive/special/approot'
    );
    assert.equal(
        assertAllowedCloudUrl('https://public.sn.files.1drv.com/download/example'),
        'https://public.sn.files.1drv.com/download/example'
    );
    assert.equal(
        assertAllowedCloudUrl('https://storage.live.com/upload/session-id'),
        'https://storage.live.com/upload/session-id'
    );
    assert.equal(
        assertAllowedCloudUrl('https://region.storage.live.com/upload/session-id'),
        'https://region.storage.live.com/upload/session-id'
    );
    assert.equal(
        assertAllowedCloudUrl('https://tenant-my.sharepoint.com/upload/session-id'),
        'https://tenant-my.sharepoint.com/upload/session-id'
    );
    assert.equal(
        assertAllowedCloudUrl('https://my.microsoftpersonalcontent.com/personal/upload/session-id'),
        'https://my.microsoftpersonalcontent.com/personal/upload/session-id'
    );
    assert.throws(
        () => assertAllowedCloudUrl('https://microsoftpersonalcontent.com.example.com/upload'),
        /許可されていない/
    );
    assert.throws(
        () => assertAllowedCloudUrl('https://storage.live.com.example.com/collect'),
        /許可されていない/
    );
    assert.throws(
        () => assertAllowedCloudUrl('https://example.com/collect'),
        /許可されていない/
    );
    assert.throws(
        () => assertAllowedCloudUrl('http://graph.microsoft.com/v1.0/me'),
        /許可されていない/
    );
});

test('Electronメインプロセスがクラウド応答を安全に転送する', async () => {
    const result = await performCloudSyncFetch({
        url: 'https://www.googleapis.com/drive/v3/files/file-id?alt=media',
        method: 'GET',
        headers: [['Authorization', 'Bearer token'], ['Cookie', 'blocked=true']],
    }, {
        fetchImpl: async (_url, options) => {
            assert.equal(options.headers.get('authorization'), 'Bearer token');
            assert.equal(options.headers.has('cookie'), false);
            return new Response('cloud data', {
                status: 200,
                headers: { 'Content-Type': 'text/plain' },
            });
        },
    });
    assert.equal(new TextDecoder().decode(result.body), 'cloud data');
    assert.ok(result.body instanceof ArrayBuffer);
    assert.equal(result.status, 200);
});

test('同期クライアントがWindowsで複製されたBuffer応答を復元する', async () => {
    const fetchImpl = createDesktopCloudFetch({
        fetch: async () => ({
            status: 200,
            statusText: 'OK',
            headers: [['content-type', 'application/octet-stream']],
            body: { type: 'Buffer', data: [0, 1, 127, 128, 255] },
        }),
    });
    const response = await fetchImpl('https://graph.microsoft.com/v1.0/me/drive/items/id/content');
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [0, 1, 127, 128, 255]);
});

test('同期クライアントがIPC応答を標準Responseとして扱える', async () => {
    const fetchImpl = createDesktopCloudFetch({
        fetch: async request => {
            assert.equal(request.url, 'https://graph.microsoft.com/v1.0/me');
            return {
                status: 200,
                statusText: 'OK',
                headers: [['content-type', 'application/json']],
                body: new TextEncoder().encode('{"id":"user"}'),
            };
        },
    });
    const response = await fetchImpl('https://graph.microsoft.com/v1.0/me');
    assert.deepEqual(await response.json(), { id: 'user' });
});
