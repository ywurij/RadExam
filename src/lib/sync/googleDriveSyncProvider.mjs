import {
    appendSyncManifestBatch,
    createEmptySyncManifest,
    SyncManifestConflictError,
    validateSyncManifest,
} from './syncManifest.mjs';

export const GOOGLE_DRIVE_APPDATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
const DRIVE_BATCH_BASE = 'https://www.googleapis.com/batch/drive/v3';
const MANIFEST_PATH = 'manifest.json';
const SYNC_ROOT_PATH = 'sync-root.json';
const LEGACY_SYNC_ID = 'legacy';
const RESUMABLE_CHUNK_SIZE = 8 * 1024 * 1024;
const DELETE_BATCH_SIZE = 100;
const DRIVE_PROPERTY_BYTE_LIMIT = 124;
const PATH_PROPERTY_KEY = 'radexamPath';
const PATH_HASH_PROPERTY_KEY = 'radexamPathHash';

const escapeDriveQueryValue = value => String(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");

const utf8ByteLength = value => new TextEncoder().encode(String(value)).byteLength;

const hashDrivePath = async path => {
    const bytes = new TextEncoder().encode(String(path));
    if (globalThis.crypto?.subtle) {
        const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
        return [...new Uint8Array(digest)]
            .map(value => value.toString(16).padStart(2, '0'))
            .join('');
    }
    // crypto.subtleがないテスト環境向けの決定的なフォールバック。
    let hash = 2166136261;
    for (const byte of bytes) {
        hash ^= byte;
        hash = Math.imul(hash, 16777619);
    }
    return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

const drivePathProperty = async path => {
    const value = String(path);
    if (
        utf8ByteLength(PATH_PROPERTY_KEY) + utf8ByteLength(value)
        <= DRIVE_PROPERTY_BYTE_LIMIT
    ) {
        return { key: PATH_PROPERTY_KEY, value };
    }
    return {
        key: PATH_HASH_PROPERTY_KEY,
        value: await hashDrivePath(value),
    };
};

const encodePathSegment = value => encodeURIComponent(String(value));
const batchPath = batchId => `changes/${encodePathSegment(batchId)}.json`;
const bulkBatchPath = batchId => `bulk-changes/${encodePathSegment(batchId)}.json`;
const blobPath = contentHash => `objects/${encodePathSegment(contentHash)}`;
const snapshotPath = snapshotId => `snapshots/${encodePathSegment(snapshotId)}.radexam`;
const scopedPath = (syncId, path) => (
    !syncId || syncId === LEGACY_SYNC_ID
        ? path
        : `spaces/${encodePathSegment(syncId)}/${path}`
);

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

const createDefaultUploadStateStore = () => ({
    get(key) {
        try {
            const value = globalThis.localStorage?.getItem(`radexam-upload:${key}`);
            return value ? JSON.parse(value) : null;
        } catch {
            return null;
        }
    },
    set(key, value) {
        try {
            globalThis.localStorage?.setItem(`radexam-upload:${key}`, JSON.stringify(value));
        } catch {
            // 保存できない環境では、同じ起動中の再試行だけに任せる。
        }
    },
    remove(key) {
        try {
            globalThis.localStorage?.removeItem(`radexam-upload:${key}`);
        } catch {
            // 保存されていなければ削除は不要。
        }
    },
});

const uploadedByteCount = response => {
    const range = response.headers.get('Range') || '';
    const match = range.match(/bytes=0-(\d+)/i);
    return match ? Number(match[1]) + 1 : 0;
};

export class GoogleDriveAppDataClient {
    constructor({
        getAccessToken,
        fetchImpl = defaultFetch,
        sleep = defaultSleep,
        maxRetries = 3,
        uploadStateStore = createDefaultUploadStateStore(),
        onUploadProgress = null,
        resumableChunkSize = RESUMABLE_CHUNK_SIZE,
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
        this.uploadStateStore = uploadStateStore;
        this.onUploadProgress = onUploadProgress;
        this.resumableChunkSize = Math.max(
            256 * 1024,
            Math.floor(resumableChunkSize / (256 * 1024)) * (256 * 1024)
        );
    }

    async request(url, options = {}, { acceptedStatuses = [] } = {}) {
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
            if (response.ok || acceptedStatuses.includes(response.status)) return response;
            const error = await driveErrorFromResponse(response);
            if (!error.retryable || attempt === this.maxRetries) throw error;
            await this.sleep(Math.min(1000 * (2 ** attempt), 8000));
        }
        throw new GoogleDriveSyncError('Google Driveへの接続を再試行できませんでした。');
    }

    async listFiles({ path, kind } = {}) {
        const clauses = ['trashed = false'];
        if (path) {
            const pathProperty = await drivePathProperty(path);
            clauses.push(
                `appProperties has { key='${pathProperty.key}' and value='${escapeDriveQueryValue(pathProperty.value)}' }`
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

    async deleteFile(fileId) {
        await this.request(
            `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}`,
            { method: 'DELETE' },
            { acceptedStatuses: [404] }
        );
    }

    async deleteFiles(fileIds, { onProgress = null } = {}) {
        const ids = [...new Set(
            (fileIds || []).filter(Boolean).map(fileId => String(fileId))
        )];
        let deletedFiles = 0;
        onProgress?.({ deletedFiles, totalFiles: ids.length });

        for (let offset = 0; offset < ids.length; offset += DELETE_BATCH_SIZE) {
            const batchIds = ids.slice(offset, offset + DELETE_BATCH_SIZE);
            const boundary = `radexam_delete_${Date.now()}_${Math.random().toString(36).slice(2)}`;
            const body = batchIds.map((fileId, index) => [
                `--${boundary}`,
                'Content-Type: application/http',
                `Content-ID: <radexam-${index}>`,
                '',
                `DELETE /drive/v3/files/${encodeURIComponent(fileId)} HTTP/1.1`,
                '',
            ].join('\r\n')).join('\r\n') + `\r\n--${boundary}--\r\n`;
            const response = await this.request(DRIVE_BATCH_BASE, {
                method: 'POST',
                headers: {
                    'Content-Type': `multipart/mixed; boundary=${boundary}`,
                },
                body,
            });
            const responseText = await response.text();
            const statuses = [...responseText.matchAll(/HTTP\/1\.[01]\s+(\d{3})/g)]
                .map(match => Number(match[1]));

            // Googleの一括応答を解釈できない場合も、404を成功扱いにした個別削除で
            // 安全に再確認できる。
            const retryIds = statuses.length === batchIds.length
                ? batchIds.filter((fileId, index) => {
                    const status = statuses[index];
                    return status !== 404 && (status < 200 || status >= 300);
                })
                : batchIds;
            for (const fileId of retryIds) {
                await this.deleteFile(fileId);
            }
            deletedFiles += batchIds.length;
            onProgress?.({ deletedFiles, totalFiles: ids.length });
        }
        return { deletedFiles };
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
        resumeKey = path,
        progressPhase = null,
    }) {
        const blob = data instanceof Blob ? data : new Blob([data], { type: mimeType });
        const pathProperty = await drivePathProperty(path);
        const metadata = existingFile
            ? {}
            : {
                name: path.replaceAll('/', '__'),
                parents: ['appDataFolder'],
                appProperties: {
                    [pathProperty.key]: pathProperty.value,
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
        const stateKey = `${resumeKey}:${blob.size}`;
        let uploadState = await this.uploadStateStore?.get?.(stateKey);
        let uploadUrl = uploadState?.uploadUrl || '';
        let offset = 0;

        if (uploadUrl) {
            let statusResponse = null;
            try {
                statusResponse = await this.request(uploadUrl, {
                    method: 'PUT',
                    headers: {
                        'Content-Range': `bytes */${blob.size}`,
                    },
                }, { acceptedStatuses: [308, 404, 410] });
            } catch (error) {
                // メタデータ形式の変更前など、再開不能になった古いセッションは破棄し、
                // 新しいアップロードセッションを作り直す。
                if (
                    error instanceof GoogleDriveSyncError
                    && error.status >= 400
                    && error.status < 500
                    && !error.requiresReauth
                ) {
                    await this.uploadStateStore?.remove?.(stateKey);
                    uploadUrl = '';
                } else {
                    throw error;
                }
            }
            if (statusResponse?.status === 308) {
                offset = uploadedByteCount(statusResponse);
            } else if (statusResponse?.ok) {
                await this.uploadStateStore?.remove?.(stateKey);
                return statusResponse.json();
            } else if (statusResponse) {
                await this.uploadStateStore?.remove?.(stateKey);
                uploadUrl = '';
            }
        }

        if (!uploadUrl) {
            const startResponse = await this.request(`${target}?${query}`, {
                method,
                headers: {
                    'Content-Type': 'application/json; charset=UTF-8',
                    'X-Upload-Content-Type': mimeType,
                    'X-Upload-Content-Length': String(blob.size),
                },
                body: JSON.stringify(metadata),
            });
            uploadUrl = startResponse.headers.get('Location');
            if (!uploadUrl) {
                throw new GoogleDriveSyncError('Google Driveからアップロード先URLが返されませんでした。');
            }
            await this.uploadStateStore?.set?.(stateKey, {
                uploadUrl,
                path,
                size: blob.size,
                updatedAt: new Date().toISOString(),
            });
        }

        this.onUploadProgress?.({
            path,
            progressPhase,
            uploadedBytes: offset,
            totalBytes: blob.size,
        });
        while (offset < blob.size || (blob.size === 0 && offset === 0)) {
            const endExclusive = blob.size === 0
                ? 0
                : Math.min(offset + this.resumableChunkSize, blob.size);
            const chunk = blob.size === 0 ? blob : blob.slice(offset, endExclusive);
            const endInclusive = blob.size === 0 ? 0 : endExclusive - 1;
            const uploadResponse = await this.request(uploadUrl, {
                method: 'PUT',
                headers: {
                    'Content-Type': mimeType,
                    'Content-Range': blob.size === 0
                        ? 'bytes */0'
                        : `bytes ${offset}-${endInclusive}/${blob.size}`,
                },
                body: chunk,
            }, { acceptedStatuses: [308] });
            if (uploadResponse.status !== 308) {
                await this.uploadStateStore?.remove?.(stateKey);
                this.onUploadProgress?.({
                    path,
                    progressPhase,
                    uploadedBytes: blob.size,
                    totalBytes: blob.size,
                });
                return uploadResponse.json();
            }
            const nextOffset = uploadedByteCount(uploadResponse);
            offset = nextOffset > offset ? nextOffset : endExclusive;
            await this.uploadStateStore?.set?.(stateKey, {
                uploadUrl,
                path,
                size: blob.size,
                uploadedBytes: offset,
                updatedAt: new Date().toISOString(),
            });
            this.onUploadProgress?.({
                path,
                progressPhase,
                uploadedBytes: offset,
                totalBytes: blob.size,
            });
            if (blob.size === 0) break;
        }
        throw new GoogleDriveSyncError('Google Driveへのアップロードを完了できませんでした。');
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

    async writeBlob(path, blob, {
        kind,
        appProperties,
        existingFile,
        resumeKey,
        progressPhase,
    } = {}) {
        return this.startResumableUpload({
            path,
            data: blob,
            mimeType: blob?.type || 'application/octet-stream',
            kind,
            appProperties,
            existingFile: existingFile === undefined ? await this.findFile(path) : existingFile,
            resumeKey,
            progressPhase,
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
        objectKey: properties.radexamPath || scopedPath(
            properties.radexamSyncId || LEGACY_SYNC_ID,
            properties.radexamKind === 'bulk-change-batch'
                ? bulkBatchPath(properties.batchId)
                : batchPath(properties.batchId)
        ),
        fromSequence,
        toSequence,
        changeCount,
        format: properties.format || (
            properties.radexamKind === 'bulk-change-batch'
                ? 'bulk-delta'
                : 'change-batch'
        ),
        createdAt: file.createdTime || file.modifiedTime || new Date().toISOString(),
    };
};

export class GoogleDriveSyncProvider {
    constructor({ client, onProgress = null, syncId = LEGACY_SYNC_ID }) {
        if (!client) throw new Error('Google Drive同期にはclientが必要です。');
        this.client = client;
        this.onProgress = onProgress;
        this.blobInventory = null;
        this.syncId = syncId || LEGACY_SYNC_ID;
    }

    reportProgress(progress) {
        this.onProgress?.(progress);
    }

    path(logicalPath) {
        return scopedPath(this.syncId, logicalPath);
    }

    setSyncId(syncId) {
        this.syncId = syncId || LEGACY_SYNC_ID;
        this.blobInventory = null;
        return this.syncId;
    }

    async ensureActiveSyncSpace() {
        const stored = await this.client.readJson(SYNC_ROOT_PATH);
        let root = stored.value;
        if (!root?.activeSyncId) {
            const now = new Date().toISOString();
            root = {
                version: 1,
                activeSyncId: LEGACY_SYNC_ID,
                previousSyncIds: [],
                createdAt: now,
                updatedAt: now,
            };
            await this.client.writeJson(SYNC_ROOT_PATH, root, {
                kind: 'sync-root',
                existingFile: stored.file,
            });
        }
        this.setSyncId(root.activeSyncId);
        return root;
    }

    async rotateSyncSpace() {
        const current = await this.ensureActiveSyncSpace();
        const now = new Date().toISOString();
        const nextSyncId = globalThis.crypto?.randomUUID?.()
            || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const stored = await this.client.readJson(SYNC_ROOT_PATH);
        const next = {
            ...current,
            activeSyncId: nextSyncId,
            previousSyncIds: [
                ...(current.previousSyncIds || []),
                { syncId: current.activeSyncId, retiredAt: now },
            ],
            updatedAt: now,
        };
        await this.client.writeJson(SYNC_ROOT_PATH, next, {
            kind: 'sync-root',
            existingFile: stored.file,
        });
        this.setSyncId(nextSyncId);
        return next;
    }

    async deleteAllCloudSyncData() {
        const files = await this.client.listFiles();
        const fileIds = files.map(file => file?.id).filter(Boolean);
        this.reportProgress({
            phase: 'deleting-cloud-data',
            deletedFiles: 0,
            totalFiles: fileIds.length,
        });
        if (typeof this.client.deleteFiles === 'function') {
            await this.client.deleteFiles(fileIds, {
                onProgress: progress => this.reportProgress({
                    phase: 'deleting-cloud-data',
                    ...progress,
                }),
            });
        } else {
            const queue = [...fileIds];
            let deletedFiles = 0;
            const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
                while (queue.length > 0) {
                    const fileId = queue.shift();
                    if (fileId) await this.client.deleteFile(fileId);
                    deletedFiles += 1;
                    this.reportProgress({
                        phase: 'deleting-cloud-data',
                        deletedFiles,
                        totalFiles: fileIds.length,
                    });
                }
            });
            await Promise.all(workers);
        }
        this.setSyncId(LEGACY_SYNC_ID);
        return { deletedFiles: fileIds.length };
    }

    async readManifest({ recoverMissingBatches = true } = {}) {
        const stored = await this.client.readJson(this.path(MANIFEST_PATH));
        let manifest = validateSyncManifest(
            stored.value || createEmptySyncManifest()
        );
        if (recoverMissingBatches) {
            const knownBatchIds = new Set(manifest.batches.map(batch => batch.batchId));
            const [standardBatchFiles, bulkBatchFiles] = await Promise.all([
                this.client.listFiles({ kind: 'change-batch' }),
                this.client.listFiles({ kind: 'bulk-change-batch' }),
            ]);
            const batchFiles = [...standardBatchFiles, ...bulkBatchFiles]
                .filter(file => (
                    (file.appProperties?.radexamSyncId || LEGACY_SYNC_ID) === this.syncId
                ));
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
        }
        return {
            manifest,
            revision: stored.file
                ? `${stored.file.id}:${stored.file.version}`
                : 'absent',
        };
    }

    async commitManifest(manifest, expectedRevision) {
        const path = this.path(MANIFEST_PATH);
        const existingFile = await this.client.findFile(path);
        const currentRevision = existingFile
            ? `${existingFile.id}:${existingFile.version}`
            : 'absent';
        if (currentRevision !== expectedRevision) {
            throw new SyncManifestConflictError();
        }
        await this.client.writeJson(path, manifest, {
            kind: 'manifest',
            existingFile,
            appProperties: { radexamSyncId: this.syncId },
        });
    }

    async uploadChangeBatch(batch) {
        const path = this.path(batchPath(batch.batchId));
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
                    format: 'change-batch',
                    radexamSyncId: this.syncId,
                },
            });
        }
        return { objectKey: path };
    }

    async uploadBulkChangePackage(batch) {
        const path = this.path(bulkBatchPath(batch.batchId));
        const existing = await this.client.findFile(path);
        if (!existing) {
            await this.client.writeJson(path, batch, {
                kind: 'bulk-change-batch',
                existingFile: null,
                appProperties: {
                    batchId: batch.batchId,
                    deviceId: batch.deviceId,
                    fromSequence: String(batch.fromSequence),
                    toSequence: String(batch.toSequence),
                    changeCount: String(batch.changeCount),
                    format: 'bulk-delta',
                    radexamSyncId: this.syncId,
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
        if (!this.blobInventory) {
            const files = await this.client.listFiles({ kind: 'object' });
            this.blobInventory = new Set(files.filter(file => (
                (file.appProperties?.radexamSyncId || LEGACY_SYNC_ID) === this.syncId
            )).map(file => (
                file.appProperties?.contentHash
                || String(file.appProperties?.radexamPath || '').replace(/^objects\//, '')
            )).filter(Boolean));
        }
        return this.blobInventory.has(contentHash);
    }

    async uploadBlob(contentHash, blob) {
        const path = this.path(blobPath(contentHash));
        const existing = await this.client.findFile(path);
        if (!existing) {
            await this.client.writeBlob(path, blob, {
                kind: 'object',
                existingFile: null,
                appProperties: {
                    contentHash,
                    radexamSyncId: this.syncId,
                },
            });
        }
        this.blobInventory?.add(contentHash);
        return { objectKey: path };
    }

    async downloadBlob(contentHash) {
        return (await this.client.readBlob(this.path(blobPath(contentHash)))).blob;
    }

    async uploadSnapshot(snapshotId, blob, descriptor = {}) {
        const path = this.path(snapshotPath(snapshotId));
        const existing = await this.client.findFile(path);
        if (!existing) {
            await this.client.writeBlob(path, blob, {
                kind: 'snapshot',
                existingFile: null,
                resumeKey: `${path}:${descriptor.contentHash}`,
                progressPhase: descriptor.purpose === 'checkpoint'
                    ? 'uploading-checkpoint'
                    : 'uploading-snapshot',
                appProperties: {
                    snapshotId,
                    deviceId: descriptor.deviceId,
                    generation: String(descriptor.generation),
                    cutoffSequence: String(descriptor.cutoffSequence),
                    contentHash: descriptor.contentHash,
                    purpose: descriptor.purpose || 'checkpoint',
                    radexamSyncId: this.syncId,
                },
            });
        }
        return { objectKey: path };
    }

    async downloadSnapshot(descriptor) {
        return (await this.client.readBlob(descriptor.objectKey)).blob;
    }
}
