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

class FakeDriveClient {
    constructor() {
        this.files = new Map();
        this.writes = [];
        this.kindFiles = [];
    }

    async readJson(path) {
        return this.files.get(path) || { file: null, value: null };
    }

    async readBlob(path) {
        return this.files.get(path) || { file: null, blob: null };
    }

    async listFiles({ kind } = {}) {
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
