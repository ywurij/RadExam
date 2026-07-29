import assert from 'node:assert/strict';
import test from 'node:test';
import {
    ONEDRIVE_APP_FOLDER_SCOPE,
    OneDriveAppFolderClient,
    OneDriveSyncError,
    OneDriveSyncProvider,
} from '../src/lib/sync/oneDriveSyncProvider.mjs';
import {
    createEmptySyncManifest,
} from '../src/lib/sync/syncManifest.mjs';

const jsonResponse = (value, init = {}) => new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
});

const appRoot = {
    id: 'app-root',
    name: 'RadExam',
    folder: { childCount: 0 },
    eTag: '"root-etag"',
};

test('uses the least-privilege OneDrive app folder and bearer token', async () => {
    const requests = [];
    const client = new OneDriveAppFolderClient({
        getAccessToken: async () => 'microsoft-access-token',
        fetchImpl: async (url, options) => {
            requests.push({ url: String(url), options });
            return jsonResponse(appRoot);
        },
    });

    const root = await client.getAppRoot();

    assert.equal(ONEDRIVE_APP_FOLDER_SCOPE, 'Files.ReadWrite.AppFolder');
    assert.equal(root.id, 'app-root');
    assert.equal(
        requests[0].url,
        'https://graph.microsoft.com/v1.0/me/drive/special/approot'
    );
    assert.equal(
        requests[0].options.headers.Authorization,
        'Bearer microsoft-access-token'
    );
});

test('reads the currently authorized Microsoft account', async () => {
    const requests = [];
    const client = new OneDriveAppFolderClient({
        getAccessToken: async () => 'access-token',
        fetchImpl: async (url, options) => {
            requests.push({ url: String(url), options });
            return jsonResponse({
                id: 'microsoft-user-1',
                displayName: 'RadExam User',
                mail: 'user@example.com',
            });
        },
    });

    const user = await client.getCurrentUser();

    assert.equal(user.id, 'microsoft-user-1');
    const url = new URL(requests[0].url);
    assert.equal(url.pathname, '/v1.0/me');
    assert.match(url.searchParams.get('$select'), /userPrincipalName/);
});

test('uploads a small manifest into the OneDrive app folder', async () => {
    const requests = [];
    const client = new OneDriveAppFolderClient({
        getAccessToken: async () => 'access-token',
        fetchImpl: async (url, options) => {
            requests.push({ url: String(url), options });
            if (requests.length === 1) return jsonResponse(appRoot);
            return jsonResponse({
                id: 'manifest-file',
                name: 'manifest.json',
                eTag: '"manifest-etag"',
            }, { status: 201 });
        },
    });

    const result = await client.writeJson(
        'manifest.json',
        { generation: 1 },
        { existingFile: null }
    );

    assert.equal(result.id, 'manifest-file');
    assert.equal(result.version, '"manifest-etag"');
    assert.equal(result.appProperties.radexamKind, 'manifest');
    assert.equal(
        requests[1].url,
        'https://graph.microsoft.com/v1.0/me/drive/items/app-root:/manifest.json:/content'
    );
    assert.equal(requests[1].options.method, 'PUT');
    assert.equal(requests[1].options.headers['If-None-Match'], '*');
    assert.equal(await requests[1].options.body.text(), '{"generation":1}');
});

test('uses 320 KiB-aligned fragments and omits authorization from upload URLs', async () => {
    const requests = [];
    const chunkSize = 5 * 320 * 1024;
    const blob = new Blob([new Uint8Array(4 * 1024 * 1024 + 1)]);
    let uploaded = 0;
    const progress = [];
    const client = new OneDriveAppFolderClient({
        getAccessToken: async () => 'access-token',
        resumableChunkSize: chunkSize,
        uploadStateStore: {
            async get() { return null; },
            async set() {},
            async remove() {},
        },
        onUploadProgress: value => progress.push(value),
        fetchImpl: async (url, options = {}) => {
            requests.push({ url: String(url), options });
            if (String(url).endsWith('/special/approot')) return jsonResponse(appRoot);
            if (String(url).includes('/special/approot:/snapshots')) {
                return jsonResponse({
                    error: { code: 'itemNotFound', message: 'Not found' },
                }, { status: 404 });
            }
            if (String(url).endsWith('/items/app-root/children')) {
                return jsonResponse({
                    id: 'snapshots-folder',
                    name: 'snapshots',
                    folder: { childCount: 0 },
                }, { status: 201 });
            }
            if (String(url).endsWith('/createUploadSession')) {
                return jsonResponse({
                    uploadUrl: 'https://upload.example/onedrive-session',
                    expirationDateTime: '2026-07-29T00:00:00.000Z',
                });
            }
            const chunk = options.body;
            uploaded += chunk.size;
            if (uploaded < blob.size) {
                return jsonResponse({
                    nextExpectedRanges: [`${uploaded}-`],
                }, { status: 202 });
            }
            return jsonResponse({
                id: 'snapshot-file',
                name: 'initial.radexam',
                eTag: '"snapshot-etag"',
            }, { status: 201 });
        },
    });

    const result = await client.writeBlob(
        'snapshots/initial.radexam',
        blob,
        { existingFile: null, progressPhase: 'uploading-snapshot' }
    );

    const uploadRequests = requests.filter(request => (
        request.url === 'https://upload.example/onedrive-session'
    ));
    assert.equal(result.id, 'snapshot-file');
    assert.equal(uploadRequests.length, 3);
    assert.equal(uploadRequests[0].options.body.size, chunkSize);
    assert.equal(uploadRequests[1].options.body.size, chunkSize);
    assert.equal(uploadRequests[0].options.headers.Authorization, undefined);
    assert.equal(
        uploadRequests[0].options.headers['Content-Range'],
        `bytes 0-${chunkSize - 1}/${blob.size}`
    );
    assert.equal(progress.at(-1).uploadedBytes, blob.size);
});

test('turns an expired upload session into a new resumable session', async () => {
    const requests = [];
    const blob = new Blob([new Uint8Array(4 * 1024 * 1024 + 1)]);
    const client = new OneDriveAppFolderClient({
        getAccessToken: async () => 'access-token',
        uploadStateStore: {
            async get() {
                return { uploadUrl: 'https://upload.example/expired', uploadedBytes: 1 };
            },
            async set() {},
            async remove() {},
        },
        fetchImpl: async (url, options = {}) => {
            requests.push({ url: String(url), options });
            if (String(url).endsWith('/special/approot')) return jsonResponse(appRoot);
            if (String(url).includes('/special/approot:/snapshots')) {
                return jsonResponse({
                    error: { code: 'itemNotFound', message: 'Not found' },
                }, { status: 404 });
            }
            if (String(url).endsWith('/items/app-root/children')) {
                return jsonResponse({
                    id: 'snapshots-folder',
                    name: 'snapshots',
                    folder: { childCount: 0 },
                }, { status: 201 });
            }
            if (String(url) === 'https://upload.example/expired') {
                return jsonResponse({
                    error: { code: 'itemNotFound', message: 'Expired' },
                }, { status: 404 });
            }
            if (String(url).endsWith('/createUploadSession')) {
                return jsonResponse({ uploadUrl: 'https://upload.example/restarted' });
            }
            return jsonResponse({
                id: 'snapshot-file',
                eTag: '"snapshot-etag"',
            }, { status: 201 });
        },
    });

    const result = await client.writeBlob(
        'snapshots/initial.radexam',
        blob,
        { existingFile: null }
    );

    assert.equal(result.id, 'snapshot-file');
    assert.ok(requests.some(request => request.url.endsWith('/createUploadSession')));
    assert.ok(requests.some(request => request.url === 'https://upload.example/restarted'));
});

test('normalizes a OneDrive ETag race as a manifest conflict', async () => {
    const client = {
        async findFile() {
            return { id: 'manifest-file', version: '"v1"', eTag: '"v1"' };
        },
        async writeJson() {
            throw new OneDriveSyncError('ETag changed', { status: 412 });
        },
    };
    const provider = new OneDriveSyncProvider({ client });

    await assert.rejects(
        () => provider.commitManifest(createEmptySyncManifest(), 'manifest-file:"v1"'),
        error => error?.code === 'SYNC_MANIFEST_CONFLICT'
    );
});
