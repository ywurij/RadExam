import assert from 'node:assert/strict';
import test from 'node:test';
import {
    GOOGLE_DRIVE_APPDATA_SCOPE,
    GoogleDriveAppDataClient,
    GoogleDriveSyncError,
    GoogleDriveSyncProvider,
} from '../src/lib/sync/googleDriveSyncProvider.mjs';
import {
    appendSyncManifestBatch,
    createEmptySyncManifest,
} from '../src/lib/sync/syncManifest.mjs';

const jsonResponse = (value, init = {}) => new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
});

test('uses the appDataFolder space and drive.appdata authorization', async () => {
    const requests = [];
    const client = new GoogleDriveAppDataClient({
        getAccessToken: async () => 'access-token',
        fetchImpl: async (url, options) => {
            requests.push({ url: String(url), options });
            return jsonResponse({ files: [] });
        },
    });

    const files = await client.listFiles({ path: "changes/device'a.json" });

    assert.deepEqual(files, []);
    assert.equal(GOOGLE_DRIVE_APPDATA_SCOPE, 'https://www.googleapis.com/auth/drive.appdata');
    assert.equal(requests[0].options.headers.Authorization, 'Bearer access-token');
    const url = new URL(requests[0].url);
    assert.equal(url.searchParams.get('spaces'), 'appDataFolder');
    assert.match(url.searchParams.get('q'), /radexamPath/);
    assert.match(url.searchParams.get('q'), /device\\'a/);
});

test('reads the currently authorized Google Drive account', async () => {
    const requests = [];
    const client = new GoogleDriveAppDataClient({
        getAccessToken: async () => 'access-token',
        fetchImpl: async (url, options) => {
            requests.push({ url: String(url), options });
            return jsonResponse({
                user: {
                    displayName: 'RadExam User',
                    permissionId: 'permission-123',
                    emailAddress: 'user@example.com',
                },
            });
        },
    });

    const user = await client.getCurrentUser();

    assert.equal(user.permissionId, 'permission-123');
    assert.equal(user.emailAddress, 'user@example.com');
    const url = new URL(requests[0].url);
    assert.equal(url.pathname, '/drive/v3/about');
    assert.match(url.searchParams.get('fields'), /permissionId/);
    assert.equal(requests[0].options.headers.Authorization, 'Bearer access-token');
});

test('calls an injected fetch function without binding the Drive client as this', async () => {
    const client = new GoogleDriveAppDataClient({
        getAccessToken: async () => 'access-token',
        fetchImpl: function fetchWithoutReceiver() {
            assert.equal(this, undefined);
            return jsonResponse({ files: [] });
        },
    });

    await client.listFiles();
});

test('creates an appData file through a resumable upload session', async () => {
    const requests = [];
    const client = new GoogleDriveAppDataClient({
        getAccessToken: async () => 'access-token',
        fetchImpl: async (url, options) => {
            requests.push({ url: String(url), options });
            if (requests.length === 1) {
                return new Response(null, {
                    status: 200,
                    headers: { Location: 'https://upload.example/session-1' },
                });
            }
            return jsonResponse({
                id: 'file-1',
                version: '1',
                appProperties: { radexamPath: 'manifest.json' },
            });
        },
    });

    const result = await client.writeJson(
        'manifest.json',
        { generation: 1 },
        { kind: 'manifest', existingFile: null }
    );

    assert.equal(result.id, 'file-1');
    assert.match(requests[0].url, /uploadType=resumable/);
    assert.equal(requests[0].options.method, 'POST');
    const metadata = JSON.parse(requests[0].options.body);
    assert.deepEqual(metadata.parents, ['appDataFolder']);
    assert.equal(metadata.appProperties.radexamPath, 'manifest.json');
    assert.equal(metadata.appProperties.radexamKind, 'manifest');
    assert.equal(requests[1].url, 'https://upload.example/session-1');
    assert.equal(requests[1].options.method, 'PUT');
    assert.equal(await requests[1].options.body.text(), '{"generation":1}');
});

test('uses a compact lookup property when a scoped Drive path exceeds the property limit', async () => {
    const requests = [];
    const longPath = `spaces/${'s'.repeat(50)}/snapshots/${'snapshot-'.repeat(10)}.radexam`;
    const client = new GoogleDriveAppDataClient({
        getAccessToken: async () => 'access-token',
        fetchImpl: async (url, options) => {
            requests.push({ url: String(url), options });
            if (requests.length === 1) {
                return new Response(null, {
                    status: 200,
                    headers: { Location: 'https://upload.example/long-path' },
                });
            }
            return jsonResponse({ id: 'long-path-file', version: '1' });
        },
    });

    await client.writeJson(longPath, { generation: 1 }, {
        kind: 'snapshot',
        existingFile: null,
    });

    const metadata = JSON.parse(requests[0].options.body);
    assert.equal(metadata.appProperties.radexamPath, undefined);
    assert.match(metadata.appProperties.radexamPathHash, /^[a-f0-9]{64}$/);
    assert.ok(
        new TextEncoder().encode(
            `radexamPathHash${metadata.appProperties.radexamPathHash}`
        ).byteLength <= 124
    );
});

test('uploads a large file in resumable chunks and reports byte progress', async () => {
    const requests = [];
    const progress = [];
    const client = new GoogleDriveAppDataClient({
        getAccessToken: async () => 'access-token',
        resumableChunkSize: 256 * 1024,
        uploadStateStore: {
            async get() { return null; },
            async set() {},
            async remove() {},
        },
        onUploadProgress: value => progress.push(value),
        fetchImpl: async (url, options) => {
            requests.push({ url: String(url), options });
            if (requests.length === 1) {
                return new Response(null, {
                    status: 200,
                    headers: { Location: 'https://upload.example/chunked' },
                });
            }
            if (requests.length === 2) {
                return new Response(null, {
                    status: 308,
                    headers: { Range: `bytes=0-${256 * 1024 - 1}` },
                });
            }
            return jsonResponse({ id: 'large-file', version: '1' });
        },
    });
    const blob = new Blob([new Uint8Array(300 * 1024)]);

    const result = await client.writeBlob(
        'snapshots/initial.radexam',
        blob,
        { kind: 'snapshot', existingFile: null }
    );

    assert.equal(result.id, 'large-file');
    assert.equal(requests[1].options.headers['Content-Range'], `bytes 0-${256 * 1024 - 1}/${blob.size}`);
    assert.equal(requests[2].options.headers['Content-Range'], `bytes ${256 * 1024}-${blob.size - 1}/${blob.size}`);
    assert.deepEqual(
        progress.map(value => value.uploadedBytes),
        [0, 256 * 1024, blob.size]
    );
});

test('resumes an interrupted upload from the byte position reported by Drive', async () => {
    const requests = [];
    const stored = {
        uploadUrl: 'https://upload.example/resume',
        size: 300 * 1024,
    };
    const client = new GoogleDriveAppDataClient({
        getAccessToken: async () => 'access-token',
        resumableChunkSize: 256 * 1024,
        uploadStateStore: {
            async get() { return stored; },
            async set() {},
            async remove() {},
        },
        fetchImpl: async (url, options) => {
            requests.push({ url: String(url), options });
            if (requests.length === 1) {
                return new Response(null, {
                    status: 308,
                    headers: { Range: `bytes=0-${256 * 1024 - 1}` },
                });
            }
            return jsonResponse({ id: 'resumed-file', version: '1' });
        },
    });
    const blob = new Blob([new Uint8Array(300 * 1024)]);

    const result = await client.writeBlob(
        'snapshots/initial.radexam',
        blob,
        { kind: 'snapshot', existingFile: null }
    );

    assert.equal(result.id, 'resumed-file');
    assert.equal(requests[0].options.headers['Content-Range'], `bytes */${blob.size}`);
    assert.equal(requests[1].options.headers['Content-Range'], `bytes ${256 * 1024}-${blob.size - 1}/${blob.size}`);
});

test('restarts an upload when a stored resumable session has invalid metadata', async () => {
    const requests = [];
    const removedKeys = [];
    const client = new GoogleDriveAppDataClient({
        getAccessToken: async () => 'access-token',
        uploadStateStore: {
            async get() {
                return {
                    uploadUrl: 'https://upload.example/stale-session',
                    size: 4,
                };
            },
            async set() {},
            async remove(key) {
                removedKeys.push(key);
            },
        },
        fetchImpl: async (url, options) => {
            requests.push({ url: String(url), options });
            if (requests.length === 1) {
                return jsonResponse({
                    error: {
                        code: 400,
                        message: 'Properties and app properties are limited to 124 bytes.',
                    },
                }, { status: 400 });
            }
            if (requests.length === 2) {
                return new Response(null, {
                    status: 200,
                    headers: { Location: 'https://upload.example/new-session' },
                });
            }
            return jsonResponse({ id: 'restarted-file', version: '1' });
        },
    });

    const result = await client.writeBlob(
        'snapshots/restarted.radexam',
        new Blob(['test']),
        { kind: 'snapshot', existingFile: null }
    );

    assert.equal(result.id, 'restarted-file');
    assert.equal(requests[0].url, 'https://upload.example/stale-session');
    assert.match(requests[1].url, /uploadType=resumable/);
    assert.equal(requests[2].url, 'https://upload.example/new-session');
    assert.ok(removedKeys.length >= 1);
});

test('marks expired credentials as requiring reauthentication', async () => {
    const client = new GoogleDriveAppDataClient({
        getAccessToken: async () => 'expired-token',
        fetchImpl: async () => jsonResponse({
            error: {
                code: 401,
                message: 'Invalid Credentials',
                errors: [{ reason: 'authError' }],
            },
        }, { status: 401 }),
        maxRetries: 0,
    });

    await assert.rejects(
        () => client.listFiles(),
        error => (
            error instanceof GoogleDriveSyncError
            && error.requiresReauth
            && error.status === 401
        )
    );
});

test('retries temporary Drive errors with exponential backoff', async () => {
    let attempts = 0;
    const delays = [];
    const client = new GoogleDriveAppDataClient({
        getAccessToken: async () => 'access-token',
        fetchImpl: async () => {
            attempts += 1;
            if (attempts < 3) {
                return jsonResponse({
                    error: { code: 503, message: 'Backend error' },
                }, { status: 503 });
            }
            return jsonResponse({ files: [] });
        },
        sleep: async delay => delays.push(delay),
    });

    await client.listFiles();

    assert.equal(attempts, 3);
    assert.deepEqual(delays, [1000, 2000]);
});

test('retries browser network failures before reporting a Drive connection error', async () => {
    let attempts = 0;
    const delays = [];
    const client = new GoogleDriveAppDataClient({
        getAccessToken: async () => 'access-token',
        fetchImpl: async () => {
            attempts += 1;
            if (attempts < 3) throw new TypeError('Failed to fetch');
            return jsonResponse({ files: [] });
        },
        sleep: async delay => delays.push(delay),
    });

    const files = await client.listFiles();

    assert.deepEqual(files, []);
    assert.equal(attempts, 3);
    assert.deepEqual(delays, [1000, 2000]);
});

test('reports a persistent browser network failure as retryable', async () => {
    const client = new GoogleDriveAppDataClient({
        getAccessToken: async () => 'access-token',
        fetchImpl: async () => {
            throw new TypeError('Failed to fetch');
        },
        sleep: async () => {},
        maxRetries: 1,
    });

    await assert.rejects(
        () => client.listFiles(),
        error => (
            error instanceof GoogleDriveSyncError
            && error.retryable
            && error.reason === 'network-error'
            && /ネットワーク接続/.test(error.message)
        )
    );
});

class FakeDriveClient {
    constructor() {
        this.files = new Map();
        this.writes = [];
        this.kindFiles = [];
        this.allFiles = [];
        this.deleted = [];
    }

    async readJson(path) {
        return this.files.get(path) || { file: null, value: null };
    }

    async readBlob(path) {
        return this.files.get(path) || { file: null, blob: null };
    }

    async listFiles({ kind } = {}) {
        if (!kind) return this.allFiles;
        return kind === 'change-batch' ? this.kindFiles : [];
    }

    async findFile(path) {
        return this.files.get(path)?.file || null;
    }

    async writeJson(path, value, options) {
        this.writes.push({ type: 'json', path, value, options });
        return { id: `written-${path}`, version: '1' };
    }

    async writeBlob(path, blob, options) {
        this.writes.push({ type: 'blob', path, blob, options });
        return { id: `written-${path}`, version: '1' };
    }

    async deleteFile(fileId) {
        this.deleted.push(fileId);
    }
}

test('recovers an immutable change batch omitted from the Drive manifest', async () => {
    const client = new FakeDriveClient();
    const manifest = appendSyncManifestBatch(createEmptySyncManifest({
        createdAt: '2026-07-26T00:00:00.000Z',
    }), {
        batchId: 'device-a-1-1',
        deviceId: 'device-a',
        objectKey: 'changes/device-a-1-1.json',
        fromSequence: 1,
        toSequence: 1,
        changeCount: 1,
        createdAt: '2026-07-26T00:00:01.000Z',
    }).manifest;
    client.files.set('manifest.json', {
        file: { id: 'manifest-file', version: '4' },
        value: manifest,
    });
    client.kindFiles.push({
        id: 'batch-file-b',
        createdTime: '2026-07-26T00:00:02.000Z',
        appProperties: {
            radexamPath: 'changes/device-b-1-1.json',
            radexamKind: 'change-batch',
            batchId: 'device-b-1-1',
            deviceId: 'device-b',
            fromSequence: '1',
            toSequence: '1',
            changeCount: '1',
        },
    });
    const provider = new GoogleDriveSyncProvider({ client });

    const remote = await provider.readManifest();

    assert.equal(remote.revision, 'manifest-file:4');
    assert.deepEqual(remote.manifest.batches.map(batch => batch.batchId), [
        'device-a-1-1',
        'device-b-1-1',
    ]);
    assert.equal(remote.manifest.generation, 2);
});

test('skips the expensive orphan batch inventory during a normal sync read', async () => {
    const client = new FakeDriveClient();
    let listCalls = 0;
    client.listFiles = async () => {
        listCalls += 1;
        return [];
    };
    const provider = new GoogleDriveSyncProvider({ client });

    const remote = await provider.readManifest({ recoverMissingBatches: false });

    assert.equal(remote.manifest.generation, 0);
    assert.equal(listCalls, 0);
});

test('rejects a Drive manifest commit when its file version changed', async () => {
    const client = new FakeDriveClient();
    client.files.set('manifest.json', {
        file: { id: 'manifest-file', version: '5' },
        value: createEmptySyncManifest(),
    });
    const provider = new GoogleDriveSyncProvider({ client });

    await assert.rejects(
        () => provider.commitManifest(createEmptySyncManifest(), 'manifest-file:4'),
        error => error?.code === 'SYNC_MANIFEST_CONFLICT'
    );
    assert.deepEqual(client.writes, []);
});

test('stores a bulk delta package as one Drive file', async () => {
    const client = new FakeDriveClient();
    const provider = new GoogleDriveSyncProvider({ client });
    const batch = {
        batchVersion: 1,
        format: 'bulk-delta',
        batchId: 'device-a-1-150',
        deviceId: 'device-a',
        fromSequence: 1,
        toSequence: 150,
        changeCount: 150,
        createdAt: '2026-07-26T00:00:00.000Z',
        changes: Array.from({ length: 150 }, (_, index) => ({ sequence: index + 1 })),
    };

    const result = await provider.uploadBulkChangePackage(batch);

    assert.equal(result.objectKey, 'bulk-changes/device-a-1-150.json');
    assert.equal(client.writes.length, 1);
    assert.equal(client.writes[0].options.kind, 'bulk-change-batch');
    assert.equal(client.writes[0].options.appProperties.format, 'bulk-delta');
});

test('scopes new sync files under the active cloud sync ID', async () => {
    const client = new FakeDriveClient();
    const provider = new GoogleDriveSyncProvider({
        client,
        syncId: 'sync-space-1',
    });
    const batch = {
        batchId: 'device-a-1-1',
        deviceId: 'device-a',
        fromSequence: 1,
        toSequence: 1,
        changeCount: 1,
    };

    const result = await provider.uploadChangeBatch(batch);

    assert.equal(
        result.objectKey,
        'spaces/sync-space-1/changes/device-a-1-1.json'
    );
    assert.equal(client.writes[0].options.appProperties.radexamSyncId, 'sync-space-1');
});

test('rotates to a new sync ID while retaining the previous cloud space', async () => {
    const client = new FakeDriveClient();
    client.files.set('sync-root.json', {
        file: { id: 'root-file', version: '1' },
        value: {
            version: 1,
            activeSyncId: 'old-space',
            previousSyncIds: [],
            createdAt: '2026-07-26T00:00:00.000Z',
            updatedAt: '2026-07-26T00:00:00.000Z',
        },
    });
    const provider = new GoogleDriveSyncProvider({ client });

    const root = await provider.rotateSyncSpace();

    assert.notEqual(root.activeSyncId, 'old-space');
    assert.equal(root.previousSyncIds.at(-1).syncId, 'old-space');
    assert.equal(provider.syncId, root.activeSyncId);
    assert.equal(client.writes.at(-1).path, 'sync-root.json');
});

test('development reset deletes every file in the app data folder', async () => {
    const client = new FakeDriveClient();
    client.allFiles = [{ id: 'file-1' }, { id: 'file-2' }, { id: 'file-3' }];
    const progress = [];
    const provider = new GoogleDriveSyncProvider({
        client,
        onProgress: value => progress.push(value),
    });

    const result = await provider.deleteAllCloudSyncData();

    assert.equal(result.deletedFiles, 3);
    assert.deepEqual(client.deleted.sort(), ['file-1', 'file-2', 'file-3']);
    assert.deepEqual(progress.at(-1), {
        phase: 'deleting-cloud-data',
        deletedFiles: 3,
        totalFiles: 3,
    });
});

test('deletes Drive files in one batch request and reports progress', async () => {
    const requests = [];
    const progress = [];
    const client = new GoogleDriveAppDataClient({
        getAccessToken: async () => 'access-token',
        fetchImpl: async (url, options) => {
            requests.push({ url: String(url), options });
            return new Response([
                '--batch-response',
                'Content-Type: application/http',
                '',
                'HTTP/1.1 204 No Content',
                '--batch-response',
                'Content-Type: application/http',
                '',
                'HTTP/1.1 404 Not Found',
                '--batch-response--',
            ].join('\r\n'), {
                status: 200,
                headers: { 'Content-Type': 'multipart/mixed; boundary=batch-response' },
            });
        },
    });

    const result = await client.deleteFiles(['file-1', 'file-2'], {
        onProgress: value => progress.push(value),
    });

    assert.equal(result.deletedFiles, 2);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://www.googleapis.com/batch/drive/v3');
    assert.equal(requests[0].options.method, 'POST');
    assert.match(requests[0].options.body, /DELETE \/drive\/v3\/files\/file-1 HTTP\/1\.1/);
    assert.deepEqual(progress, [
        { deletedFiles: 0, totalFiles: 2 },
        { deletedFiles: 2, totalFiles: 2 },
    ]);
});

test('loads the cloud object inventory once instead of listing once per blob', async () => {
    const client = new FakeDriveClient();
    let objectLists = 0;
    client.listFiles = async ({ kind } = {}) => {
        if (kind === 'object') {
            objectLists += 1;
            return [{
                appProperties: {
                    radexamKind: 'object',
                    radexamPath: 'objects/sha256:existing',
                    contentHash: 'sha256:existing',
                },
            }];
        }
        return [];
    };
    const provider = new GoogleDriveSyncProvider({ client });

    assert.equal(await provider.hasBlob('sha256:existing'), true);
    assert.equal(await provider.hasBlob('sha256:missing'), false);
    assert.equal(objectLists, 1);
});

test('downloads known blobs directly from the shared object inventory', async () => {
    const client = new FakeDriveClient();
    let objectLists = 0;
    let directDownloads = 0;
    client.listFiles = async ({ kind } = {}) => {
        if (kind !== 'object') return [];
        objectLists += 1;
        return [{
            id: 'blob-file-1',
            appProperties: {
                radexamKind: 'object',
                radexamPath: 'objects/sha256:known',
                contentHash: 'sha256:known',
            },
        }];
    };
    client.downloadFile = async fileId => {
        directDownloads += 1;
        assert.equal(fileId, 'blob-file-1');
        return new Response(new Blob(['known-blob']));
    };
    client.readBlob = async () => {
        throw new Error('path lookup should not be used');
    };
    const provider = new GoogleDriveSyncProvider({ client });

    assert.equal(await (await provider.downloadBlob('sha256:known')).text(), 'known-blob');
    assert.equal(objectLists, 1);
    assert.equal(directDownloads, 1);
});

test('does not repeat a missing blob lookup after loading the inventory', async () => {
    const client = new FakeDriveClient();
    let fileLookups = 0;
    client.listFiles = async () => [];
    client.findFile = async () => {
        fileLookups += 1;
        return null;
    };
    const provider = new GoogleDriveSyncProvider({ client });

    assert.equal(await provider.hasBlob('sha256:new'), false);
    await provider.uploadBlob('sha256:new', new Blob(['new-image']));

    assert.equal(fileLookups, 0);
    assert.equal(client.writes.length, 1);
    assert.equal(client.writes[0].options.existingFile, null);
});
