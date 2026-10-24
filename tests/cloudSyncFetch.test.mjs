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

const driveUrl = 'https://www.googleapis.com/drive/v3/files/file-id?alt=media';

test('不正なIPC本文やサイズ超過を通信・追加のメモリ確保前に拒否する', async () => {
    for (const body of [512 * 1024 * 1024, { length: 512 * 1024 * 1024 }, [1, 2], new ArrayBuffer(32 * 1024 * 1024 + 1)]) {
        await assert.rejects(performCloudSyncFetch({ url: driveUrl, method: 'POST', body }, {
            fetchImpl: async () => { assert.fail('不正な本文で通信してはいけない'); },
        }), /データ形式|大きすぎ/);
    }
});

test('リダイレクトの各段でURLを検証して不正な宛先へ通信しない', async () => {
    for (const location of [
        'https://example.com/collect',
        'http://127.0.0.1/private',
        'https://user:password@graph.microsoft.com/v1.0/me',
        'https://graph.microsoft.com:8443/v1.0/me',
        'https://www.googleapis.com/not-drive',
    ]) {
        let calls = 0;
        await assert.rejects(performCloudSyncFetch({ url: driveUrl }, {
            fetchImpl: async (_url, options) => {
                calls += 1;
                assert.equal(options.redirect, 'manual');
                return new Response(null, { status: 302, headers: { location } });
            },
        }), /許可されていない/);
        assert.equal(calls, 1);
    }
});

test('GraphからOneDriveへの転送で認証ヘッダーを外す', async () => {
    const calls = [];
    const result = await performCloudSyncFetch({
        url: 'https://graph.microsoft.com/v1.0/me/drive/items/id/content',
        headers: [['Authorization', 'Bearer token'], ['Range', 'bytes=0-10']],
    }, {
        fetchImpl: async (url, options) => {
            calls.push({ url, authorization: options.headers.get('authorization') });
            if (calls.length === 1) {
                return new Response(null, {
                    status: 302,
                    headers: { location: 'https://region.storage.live.com/download/id' },
                });
            }
            assert.equal(options.headers.get('range'), 'bytes=0-10');
            return new Response('downloaded');
        },
    });
    assert.deepEqual(calls.map(call => call.authorization), ['Bearer token', null]);
    assert.equal(new TextDecoder().decode(result.body), 'downloaded');
});

test('同一originの相対リダイレクトは認証とPUT本文を維持する', async () => {
    let calls = 0;
    await performCloudSyncFetch({
        url: driveUrl,
        method: 'PUT',
        headers: [['Authorization', 'Bearer token']],
        body: new Uint8Array([1, 2, 3]),
    }, {
        fetchImpl: async (url, options) => {
            calls += 1;
            assert.equal(options.method, 'PUT');
            assert.equal(options.headers.get('authorization'), 'Bearer token');
            assert.deepEqual([...options.body], [1, 2, 3]);
            if (calls === 1) return new Response(null, { status: 307, headers: { location: './next' } });
            assert.equal(url, 'https://www.googleapis.com/drive/v3/files/next');
            return new Response(null, { status: 204 });
        },
    });
    assert.equal(calls, 2);
});

test('POSTの302・303転送は本文を再送せずGETに切り替える', async () => {
    for (const status of [302, 303]) {
        let calls = 0;
        await performCloudSyncFetch({
            url: driveUrl,
            method: 'POST',
            body: new Uint8Array([1]),
            headers: [['Content-Type', 'application/json']],
        }, {
            fetchImpl: async (_url, options) => {
                calls += 1;
                if (calls === 1) return new Response(null, { status, headers: { location: './next' } });
                assert.equal(options.method, 'GET');
                assert.equal(options.body, undefined);
                assert.equal(options.headers.has('content-type'), false);
                return new Response('ok');
            },
        });
    }
});

test('リダイレクトループを有限回で打ち切る', async () => {
    let calls = 0;
    await assert.rejects(performCloudSyncFetch({ url: driveUrl }, {
        fetchImpl: async () => {
            calls += 1;
            return new Response(null, { status: 302, headers: { location: driveUrl } });
        },
    }), /リダイレクト回数/);
    assert.equal(calls, 6);
});

test('Content-Lengthの省略・偽装にかかわらず読取中にサイズ上限で中断する', async () => {
    for (const headers of [{}, { 'content-length': '1' }, { 'content-length': '100' }]) {
        let cancelled = false;
        let pulls = 0;
        const body = new ReadableStream({
            pull(controller) {
                pulls += 1;
                controller.enqueue(new Uint8Array(3));
            },
            cancel() { cancelled = true; },
        });
        await assert.rejects(performCloudSyncFetch({ url: driveUrl }, {
            maxResponseBodyBytes: 4,
            fetchImpl: async () => new Response(body, { headers }),
        }), /サイズ/);
        assert.equal(cancelled, true);
        assert.ok(pulls <= 3);
    }
});

test('ヘッダー受信待ちの通信もタイムアウトで中断する', async () => {
    let aborted = false;
    await assert.rejects(performCloudSyncFetch({ url: driveUrl }, {
        timeoutMs: 20,
        fetchImpl: async (_url, { signal }) => new Promise((_, reject) => {
            signal.addEventListener('abort', () => {
                aborted = true;
                reject(signal.reason);
            }, { once: true });
        }),
    }), { name: 'TimeoutError' });
    assert.equal(aborted, true);
});

test('本文が停止した応答もタイムアウトで読取を中止する', async () => {
    let cancelled = false;
    await assert.rejects(performCloudSyncFetch({ url: driveUrl }, {
        timeoutMs: 20,
        fetchImpl: async () => new Response(new ReadableStream({
            start(controller) { controller.enqueue(new Uint8Array([1])); },
            cancel() { cancelled = true; },
        })),
    }), { name: 'TimeoutError' });
    assert.equal(cancelled, true);
});
