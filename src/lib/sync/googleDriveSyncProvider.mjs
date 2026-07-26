import {
    appendSyncManifestBatch,
    createEmptySyncManifest,
    SyncManifestConflictError,
    validateSyncManifest,
} from './syncManifest.mjs';

export const GOOGLE_DRIVE_APPDATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
const MANIFEST_PATH = 'manifest.json';

const escapeDriveQueryValue = value => String(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");

const encodePathSegment = value => encodeURIComponent(String(value));
const batchPath = batchId => `changes/${encodePathSegment(batchId)}.json`;
const blobPath = contentHash => `objects/${encodePathSegment(contentHash)}`;

const parseJsonSafely = async response => {
    const text = await response.text();
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
};

export class GoogleDriveSyncError extends Error {
    constructor(message, {
        status = 0,
        reason = null,
        retryable = false,
        requiresReauth = false,
    } = {}) {
        super(message);
        this.name = 'GoogleDriveSyncError';
        this.status = status;
        this.reason = reason;
        this.retryable = retryable;
        this.requiresReauth = requiresReauth;
    }
}

const driveErrorFromResponse = async response => {
    const body = await parseJsonSafely(response);
    const reason = body?.error?.errors?.[0]?.reason || null;
    const message = body?.error?.message
        || `Google Drive APIでエラーが発生しました（HTTP ${response.status}）。`;
    return new GoogleDriveSyncError(message, {
        status: response.status,
        reason,
        retryable: response.status === 429 || response.status >= 500,
        requiresReauth: response.status === 401,
    });
};

const defaultSleep = milliseconds => new Promise(resolve => {
    setTimeout(resolve, milliseconds);
});

const defaultFetch = (...args) => globalThis.fetch(...args);

export class GoogleDriveAppDataClient {
    constructor({
        getAccessToken,
        fetchImpl = defaultFetch,
        sleep = defaultSleep,
        maxRetries = 3,
    }) {
        if (typeof getAccessToken !== 'function') {
            throw new Error('Google Drive接続にはgetAccessToken()が必要です。');
        }
        if (typeof fetchImpl !== 'function') {
            throw new Error('Google Drive接続にはfetch()が必要です。');
        }
        this.getAccessToken = getAccessToken;
        // WebKitなどではwindow.fetchを別オブジェクトのメソッドとして呼ぶと
        // Illegal invocationになるため、呼び出し時のthisを引き継がない。
        this.fetch = (...args) => fetchImpl(...args);
        this.sleep = sleep;
        this.maxRetries = maxRetries;
    }

    async request(url, options = {}) {
        for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
            const accessToken = await this.getAccessToken();
            if (!accessToken) throw new GoogleDriveSyncError('Google Driveの再認証が必要です。', {
                requiresReauth: true,
            });
            let response;
            try {
                response = await this.fetch(url, {
                    ...options,
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        ...(options.headers || {}),
                    },
                });
            } catch (cause) {
                if (attempt < this.maxRetries) {
                    await this.sleep(Math.min(1000 * (2 ** attempt), 8000));
                    continue;
                }
                const error = new GoogleDriveSyncError(
                    'Google Driveと通信できませんでした。ネットワーク接続を確認して再試行してください。',
                    {
                        reason: 'network-error',
                        retryable: true,
                    }
                );
                error.cause = cause;
                throw error;
            }
            if (response.ok) return response;
            const error = await driveErrorFromResponse(response);
            if (!error.retryable || attempt === this.maxRetries) throw error;
            await this.sleep(Math.min(1000 * (2 ** attempt), 8000));
        }
        throw new GoogleDriveSyncError('Google Driveへの接続を再試行できませんでした。');
    }

    async listFiles({ path, kind } = {}) {
        const clauses = ['trashed = false'];
        if (path) {
            clauses.push(
                `appProperties has { key='radexamPath' and value='${escapeDriveQueryValue(path)}' }`
            );
        }
        if (kind) {
            clauses.push(
                `appProperties has { key='radexamKind' and value='${escapeDriveQueryValue(kind)}' }`
            );
        }
        const files = [];
        let pageToken = '';
        do {
            const query = new URLSearchParams({
                spaces: 'appDataFolder',
                q: clauses.join(' and '),
                pageSize: '1000',
                fields: 'nextPageToken,files(id,name,mimeType,size,modifiedTime,createdTime,version,appProperties)',
            });
            if (pageToken) query.set('pageToken', pageToken);
            const response = await this.request(`${DRIVE_API_BASE}/files?${query}`);
            const body = await response.json();
            files.push(...(body.files || []));
            pageToken = body.nextPageToken || '';
        } while (pageToken);
        return files;
    }

    async findFile(path) {
        const files = await this.listFiles({ path });
        return files.sort((left, right) => (
            String(right.modifiedTime || '').localeCompare(String(left.modifiedTime || ''))
            || Number(right.version || 0) - Number(left.version || 0)
            || String(right.id).localeCompare(String(left.id))
        ))[0] || null;
    }

    async getFileMetadata(fileId) {
        const query = new URLSearchParams({
            fields: 'id,name,mimeType,size,modifiedTime,createdTime,version,appProperties',
        });
        const response = await this.request(
            `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?${query}`
        );
        return response.json();
    }

    async getCurrentUser() {
        const query = new URLSearchParams({
            fields: 'user(displayName,permissionId,emailAddress,photoLink)',
        });
        const response = await this.request(`${DRIVE_API_BASE}/about?${query}`);
        return (await response.json()).user || null;
    }

    async downloadFile(fileId) {
        return this.request(
            `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`
        );
    }

    async readJson(path) {
        const file = await this.findFile(path);
        if (!file) return { file: null, value: null };
        const response = await this.downloadFile(file.id);
        return { file, value: await response.json() };
    }

    async readBlob(path) {
        const file = await this.findFile(path);
        if (!file) return { file: null, blob: null };
        const response = await this.downloadFile(file.id);
        return { file, blob: await response.blob() };
    }

    async startResumableUpload({
        path,
        data,
        mimeType,
        kind,
        appProperties = {},
        existingFile = null,
    }) {
        const blob = data instanceof Blob ? data : new Blob([data], { type: mimeType });
        const metadata = existingFile
            ? {}
            : {
                name: path.replaceAll('/', '__'),
                parents: ['appDataFolder'],
                appProperties: {
                    radexamPath: path,
                    radexamKind: kind,
                    ...appProperties,
                },
            };
        const method = existingFile ? 'PATCH' : 'POST';
        const target = existingFile
            ? `${DRIVE_UPLOAD_BASE}/files/${encodeURIComponent(existingFile.id)}`
            : `${DRIVE_UPLOAD_BASE}/files`;
        const query = new URLSearchParams({
            uploadType: 'resumable',
            fields: 'id,name,mimeType,size,modifiedTime,createdTime,version,appProperties',
        });
        const startResponse = await this.request(`${target}?${query}`, {
            method,
            headers: {
                'Content-Type': 'application/json; charset=UTF-8',
                'X-Upload-Content-Type': mimeType,
                'X-Upload-Content-Length': String(blob.size),
            },
            body: JSON.stringify(metadata),
        });
        const uploadUrl = startResponse.headers.get('Location');
        if (!uploadUrl) {
            throw new GoogleDriveSyncError('Google Driveからアップロード先URLが返されませんでした。');
        }
        const uploadResponse = await this.request(uploadUrl, {
            method: 'PUT',
            headers: {
                'Content-Type': mimeType,
            },
            body: blob,
        });
        return uploadResponse.json();
    }

    async writeJson(path, value, { kind, appProperties, existingFile } = {}) {
        return this.startResumableUpload({
            path,
            data: JSON.stringify(value),
            mimeType: 'application/json',
            kind,
            appProperties,
            existingFile: existingFile === undefined ? await this.findFile(path) : existingFile,
        });
    }

    async writeBlob(path, blob, { kind, appProperties, existingFile } = {}) {
        return this.startResumableUpload({
            path,
            data: blob,
            mimeType: blob?.type || 'application/octet-stream',
            kind,
            appProperties,
            existingFile: existingFile === undefined ? await this.findFile(path) : existingFile,
        });
    }
}

const descriptorFromDriveFile = file => {
    const properties = file.appProperties || {};
    const fromSequence = Number(properties.fromSequence);
    const toSequence = Number(properties.toSequence);
    const changeCount = Number(properties.changeCount);
    if (
        !properties.batchId
        || !properties.deviceId
        || !Number.isSafeInteger(fromSequence)
        || !Number.isSafeInteger(toSequence)
        || !Number.isSafeInteger(changeCount)
    ) {
        return null;
    }
    return {
        batchId: properties.batchId,
        deviceId: properties.deviceId,
        objectKey: properties.radexamPath,
        fromSequence,
        toSequence,
        changeCount,
        createdAt: file.createdTime || file.modifiedTime || new Date().toISOString(),
    };
};

export class GoogleDriveSyncProvider {
    constructor({ client }) {
        if (!client) throw new Error('Google Drive同期にはclientが必要です。');
        this.client = client;
    }

    async readManifest() {
        const stored = await this.client.readJson(MANIFEST_PATH);
        let manifest = validateSyncManifest(
            stored.value || createEmptySyncManifest()
        );
        const knownBatchIds = new Set(manifest.batches.map(batch => batch.batchId));
        const batchFiles = await this.client.listFiles({ kind: 'change-batch' });
        const missing = batchFiles
            .map(descriptorFromDriveFile)
            .filter(descriptor => descriptor && !knownBatchIds.has(descriptor.batchId))
            .sort((left, right) => (
                String(left.createdAt).localeCompare(String(right.createdAt))
                || left.batchId.localeCompare(right.batchId)
            ));
        for (const descriptor of missing) {
            manifest = appendSyncManifestBatch(manifest, descriptor).manifest;
        }
        return {
            manifest,
            revision: stored.file
                ? `${stored.file.id}:${stored.file.version}`
                : 'absent',
        };
    }

    async commitManifest(manifest, expectedRevision) {
        const existingFile = await this.client.findFile(MANIFEST_PATH);
        const currentRevision = existingFile
            ? `${existingFile.id}:${existingFile.version}`
            : 'absent';
        if (currentRevision !== expectedRevision) {
            throw new SyncManifestConflictError();
        }
        await this.client.writeJson(MANIFEST_PATH, manifest, {
            kind: 'manifest',
            existingFile,
        });
    }

    async uploadChangeBatch(batch) {
        const path = batchPath(batch.batchId);
        const existing = await this.client.findFile(path);
        if (!existing) {
            await this.client.writeJson(path, batch, {
                kind: 'change-batch',
                existingFile: null,
                appProperties: {
                    batchId: batch.batchId,
                    deviceId: batch.deviceId,
                    fromSequence: String(batch.fromSequence),
                    toSequence: String(batch.toSequence),
                    changeCount: String(batch.changeCount),
                },
            });
        }
        return { objectKey: path };
    }

    async downloadChangeBatch(descriptor) {
        const stored = await this.client.readJson(descriptor.objectKey);
        if (!stored.value) {
            throw new GoogleDriveSyncError(`Google Driveに変更バッチがありません: ${descriptor.objectKey}`);
        }
        return stored.value;
    }

    async hasBlob(contentHash) {
        return Boolean(await this.client.findFile(blobPath(contentHash)));
    }

    async uploadBlob(contentHash, blob) {
        const path = blobPath(contentHash);
        const existing = await this.client.findFile(path);
        if (!existing) {
            await this.client.writeBlob(path, blob, {
                kind: 'object',
                existingFile: null,
                appProperties: { contentHash },
            });
        }
        return { objectKey: path };
    }

    async downloadBlob(contentHash) {
        return (await this.client.readBlob(blobPath(contentHash))).blob;
    }
}
