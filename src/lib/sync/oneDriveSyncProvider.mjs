import {
    GoogleDriveSyncProvider,
} from './googleDriveSyncProvider.mjs';
import {
    SyncManifestConflictError,
} from './syncManifest.mjs';

export const ONEDRIVE_APP_FOLDER_SCOPE = 'Files.ReadWrite.AppFolder';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const SIMPLE_UPLOAD_LIMIT = 4 * 1024 * 1024;
const UPLOAD_FRAGMENT_UNIT = 320 * 1024;
const DEFAULT_UPLOAD_CHUNK_SIZE = 10 * 1024 * 1024;
const LEGACY_SYNC_ID = 'legacy';

const defaultFetch = (...args) => globalThis.fetch(...args);
const defaultSleep = milliseconds => new Promise(resolve => {
    setTimeout(resolve, milliseconds);
});

const createDefaultUploadStateStore = () => ({
    get(key) {
        try {
            const value = globalThis.localStorage?.getItem(`radexam-onedrive-upload:${key}`);
            return value ? JSON.parse(value) : null;
        } catch {
            return null;
        }
    },
    set(key, value) {
        try {
            globalThis.localStorage?.setItem(
                `radexam-onedrive-upload:${key}`,
                JSON.stringify(value)
            );
        } catch {
            // 保存できない環境では、同じ起動中の再試行だけに任せる。
        }
    },
    remove(key) {
        try {
            globalThis.localStorage?.removeItem(`radexam-onedrive-upload:${key}`);
        } catch {
            // 保存されていなければ削除は不要。
        }
    },
});

const normalizeLogicalPath = path => String(path || '')
    .split('/')
    .filter(segment => segment && segment !== '.' && segment !== '..')
    .join('/');

const encodeGraphPath = path => normalizeLogicalPath(path)
    .split('/')
    .filter(Boolean)
    .map(segment => encodeURIComponent(segment))
    .join('/');

const parentPathOf = path => {
    const segments = normalizeLogicalPath(path).split('/').filter(Boolean);
    segments.pop();
    return segments.join('/');
};

const fileNameOf = path => normalizeLogicalPath(path).split('/').filter(Boolean).pop() || '';

const parseJsonSafely = async response => {
    const text = await response.text();
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
};

export class OneDriveSyncError extends Error {
    constructor(message, {
        status = 0,
        code = null,
        retryable = false,
        requiresReauth = false,
    } = {}) {
        super(message);
        this.name = 'OneDriveSyncError';
        this.status = status;
        this.code = code;
        this.retryable = retryable;
        this.requiresReauth = requiresReauth;
    }
}

const graphErrorFromResponse = async response => {
    const body = await parseJsonSafely(response);
    const code = body?.error?.code || null;
    const message = body?.error?.message
        || `OneDrive APIでエラーが発生しました（HTTP ${response.status}）。`;
    return new OneDriveSyncError(message, {
        status: response.status,
        code,
        retryable: response.status === 429 || response.status >= 500,
        requiresReauth: response.status === 401,
    });
};

const inferPathMetadata = path => {
    const normalized = normalizeLogicalPath(path);
    const segments = normalized.split('/');
    let syncId = LEGACY_SYNC_ID;
    let relative = normalized;
    if (segments[0] === 'spaces' && segments.length >= 3) {
        syncId = decodeURIComponent(segments[1]);
        relative = segments.slice(2).join('/');
    }

    const properties = {
        radexamPath: normalized,
        radexamSyncId: syncId,
    };
    if (relative === 'sync-root.json') properties.radexamKind = 'sync-root';
    else if (relative === 'manifest.json') properties.radexamKind = 'manifest';
    else if (relative.startsWith('changes/')) properties.radexamKind = 'change-batch';
    else if (relative.startsWith('bulk-changes/')) properties.radexamKind = 'bulk-change-batch';
    else if (relative.startsWith('objects/')) {
        properties.radexamKind = 'object';
        properties.contentHash = decodeURIComponent(relative.slice('objects/'.length));
    } else if (relative.startsWith('snapshots/')) {
        properties.radexamKind = 'snapshot';
    }
    return properties;
};

const normalizeDriveItem = (item, path, extraProperties = {}) => {
    if (!item) return null;
    const logicalPath = normalizeLogicalPath(path);
    return {
        ...item,
        version: item.eTag || item.cTag || item.lastModifiedDateTime || '',
        modifiedTime: item.lastModifiedDateTime,
        createdTime: item.createdDateTime,
        appProperties: {
            ...inferPathMetadata(logicalPath),
            ...extraProperties,
        },
        radexamPath: logicalPath,
    };
};

const nextExpectedOffset = body => {
    const range = body?.nextExpectedRanges?.[0] || '';
    const match = String(range).match(/^(\d+)-/);
    return match ? Number(match[1]) : 0;
};

export class OneDriveAppFolderClient {
    constructor({
        getAccessToken,
        fetchImpl = defaultFetch,
        sleep = defaultSleep,
        maxRetries = 3,
        uploadStateStore = createDefaultUploadStateStore(),
        onUploadProgress = null,
        resumableChunkSize = DEFAULT_UPLOAD_CHUNK_SIZE,
    }) {
        if (typeof getAccessToken !== 'function') {
            throw new Error('OneDrive接続にはgetAccessToken()が必要です。');
        }
        if (typeof fetchImpl !== 'function') {
            throw new Error('OneDrive接続にはfetch()が必要です。');
        }
        this.getAccessToken = getAccessToken;
        this.fetch = (...args) => fetchImpl(...args);
        this.sleep = sleep;
        this.maxRetries = maxRetries;
        this.uploadStateStore = uploadStateStore;
        this.onUploadProgress = onUploadProgress;
        this.resumableChunkSize = Math.max(
            UPLOAD_FRAGMENT_UNIT,
            Math.floor(resumableChunkSize / UPLOAD_FRAGMENT_UNIT) * UPLOAD_FRAGMENT_UNIT
        );
        this.appRoot = null;
        this.folderCache = new Map();
    }

    async request(url, options = {}, { acceptedStatuses = [] } = {}) {
        for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
            const accessToken = await this.getAccessToken();
            if (!accessToken) {
                throw new OneDriveSyncError('OneDriveの再認証が必要です。', {
                    requiresReauth: true,
                });
            }
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
                const error = new OneDriveSyncError(
                    'OneDriveと通信できませんでした。ネットワーク接続を確認して再試行してください。',
                    { code: 'network-error', retryable: true }
                );
                error.cause = cause;
                throw error;
            }
            if (response.ok || acceptedStatuses.includes(response.status)) return response;
            const error = await graphErrorFromResponse(response);
            if (!error.retryable || attempt === this.maxRetries) throw error;
            const retryAfter = Number(response.headers.get('Retry-After'));
            await this.sleep(
                Number.isFinite(retryAfter) && retryAfter > 0
                    ? retryAfter * 1000
                    : Math.min(1000 * (2 ** attempt), 8000)
            );
        }
        throw new OneDriveSyncError('OneDriveへの接続を再試行できませんでした。');
    }

    async uploadRequest(url, options = {}, { acceptedStatuses = [] } = {}) {
        for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
            let response;
            try {
                // uploadUrlは認証済みURLなのでAuthorizationヘッダーを付けない。
                response = await this.fetch(url, options);
            } catch (cause) {
                if (attempt < this.maxRetries) {
                    await this.sleep(Math.min(1000 * (2 ** attempt), 8000));
                    continue;
                }
                const error = new OneDriveSyncError(
                    'OneDriveへのアップロードが中断されました。再試行すると続きから送信します。',
                    { code: 'upload-interrupted', retryable: true }
                );
                error.cause = cause;
                throw error;
            }
            if (response.ok || acceptedStatuses.includes(response.status)) return response;
            const error = await graphErrorFromResponse(response);
            if (!error.retryable || attempt === this.maxRetries) throw error;
            await this.sleep(Math.min(1000 * (2 ** attempt), 8000));
        }
        throw new OneDriveSyncError('OneDriveへのアップロードを再試行できませんでした。');
    }

    async getAppRoot() {
        if (this.appRoot) return this.appRoot;
        const response = await this.request(`${GRAPH_BASE}/me/drive/special/approot`);
        this.appRoot = await response.json();
        this.folderCache.set('', this.appRoot);
        return this.appRoot;
    }

    async getCurrentUser() {
        const query = new URLSearchParams({
            '$select': 'id,displayName,mail,userPrincipalName',
        });
        const response = await this.request(`${GRAPH_BASE}/me?${query}`);
        return response.json();
    }

    itemUrl(path) {
        return `${GRAPH_BASE}/me/drive/special/approot:/${encodeGraphPath(path)}`;
    }

    async findFile(path) {
        const normalized = normalizeLogicalPath(path);
        if (!normalized) return normalizeDriveItem(await this.getAppRoot(), '');
        const response = await this.request(this.itemUrl(normalized), {}, {
            acceptedStatuses: [404],
        });
        if (response.status === 404) return null;
        return normalizeDriveItem(await response.json(), normalized);
    }

    async getFileMetadata(fileId) {
        const response = await this.request(
            `${GRAPH_BASE}/me/drive/items/${encodeURIComponent(fileId)}`
        );
        return normalizeDriveItem(await response.json(), '');
    }

    async downloadFile(fileId) {
        return this.request(
            `${GRAPH_BASE}/me/drive/items/${encodeURIComponent(fileId)}/content`
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

    async ensureFolder(path) {
        const normalized = normalizeLogicalPath(path);
        if (this.folderCache.has(normalized)) return this.folderCache.get(normalized);
        let parent = await this.getAppRoot();
        let currentPath = '';
        for (const name of normalized.split('/').filter(Boolean)) {
            currentPath = currentPath ? `${currentPath}/${name}` : name;
            const cached = this.folderCache.get(currentPath);
            if (cached) {
                parent = cached;
                continue;
            }
            const existing = await this.findFile(currentPath);
            if (existing) {
                if (!existing.folder) {
                    throw new OneDriveSyncError(
                        `OneDrive上の「${currentPath}」がフォルダーではありません。`
                    );
                }
                this.folderCache.set(currentPath, existing);
                parent = existing;
                continue;
            }
            const response = await this.request(
                `${GRAPH_BASE}/me/drive/items/${encodeURIComponent(parent.id)}/children`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name,
                        folder: {},
                        '@microsoft.graph.conflictBehavior': 'fail',
                    }),
                },
                { acceptedStatuses: [409] }
            );
            const created = response.status === 409
                ? await this.findFile(currentPath)
                : normalizeDriveItem(await response.json(), currentPath);
            if (!created?.folder) {
                throw new OneDriveSyncError(
                    `OneDriveに「${currentPath}」フォルダーを作成できませんでした。`
                );
            }
            this.folderCache.set(currentPath, created);
            parent = created;
        }
        return parent;
    }

    async writeJson(path, value, options = {}) {
        return this.writeBlob(
            path,
            new Blob([JSON.stringify(value)], { type: 'application/json' }),
            options
        );
    }

    async writeBlob(path, blob, {
        existingFile,
        resumeKey = path,
        progressPhase = null,
    } = {}) {
        const normalized = normalizeLogicalPath(path);
        const data = blob instanceof Blob ? blob : new Blob([blob]);
        const parent = await this.ensureFolder(parentPathOf(normalized));
        const existing = existingFile === undefined ? await this.findFile(normalized) : existingFile;
        if (data.size < SIMPLE_UPLOAD_LIMIT) {
            const headers = {
                'Content-Type': data.type || 'application/octet-stream',
            };
            if (existing?.eTag) headers['If-Match'] = existing.eTag;
            else if (existingFile === null) headers['If-None-Match'] = '*';
            const response = await this.request(
                `${GRAPH_BASE}/me/drive/items/${encodeURIComponent(parent.id)}:/${encodeURIComponent(fileNameOf(normalized))}:/content`,
                { method: 'PUT', headers, body: data }
            );
            this.onUploadProgress?.({
                path: normalized,
                progressPhase,
                uploadedBytes: data.size,
                totalBytes: data.size,
            });
            return normalizeDriveItem(await response.json(), normalized);
        }
        return this.startResumableUpload({
            path: normalized,
            data,
            existingFile: existing,
            parent,
            resumeKey,
            progressPhase,
        });
    }

    async startResumableUpload({
        path,
        data,
        existingFile,
        parent,
        resumeKey,
        progressPhase,
    }) {
        const stateKey = `${resumeKey}:${data.size}`;
        let state = await this.uploadStateStore?.get?.(stateKey);
        let uploadUrl = state?.uploadUrl || '';
        let offset = Number(state?.uploadedBytes) || 0;

        if (uploadUrl) {
            const statusResponse = await this.uploadRequest(uploadUrl, {}, {
                acceptedStatuses: [404],
            });
            if (statusResponse.status === 404) {
                await this.uploadStateStore?.remove?.(stateKey);
                uploadUrl = '';
                offset = 0;
            } else {
                const status = await statusResponse.json();
                offset = nextExpectedOffset(status);
            }
        }

        if (!uploadUrl) {
            const headers = { 'Content-Type': 'application/json' };
            if (existingFile?.eTag) headers['If-Match'] = existingFile.eTag;
            else if (existingFile === null) headers['If-None-Match'] = '*';
            const response = await this.request(
                `${GRAPH_BASE}/me/drive/items/${encodeURIComponent(parent.id)}:/${encodeURIComponent(fileNameOf(path))}:/createUploadSession`,
                {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        item: {
                            '@microsoft.graph.conflictBehavior': 'replace',
                            name: fileNameOf(path),
                        },
                    }),
                }
            );
            const body = await response.json();
            uploadUrl = body.uploadUrl || '';
            if (!uploadUrl) {
                throw new OneDriveSyncError('OneDriveからアップロード先URLが返されませんでした。');
            }
            offset = 0;
            await this.uploadStateStore?.set?.(stateKey, {
                uploadUrl,
                path,
                size: data.size,
                uploadedBytes: offset,
                expirationDateTime: body.expirationDateTime,
            });
        }

        this.onUploadProgress?.({
            path,
            progressPhase,
            uploadedBytes: offset,
            totalBytes: data.size,
        });
        while (offset < data.size) {
            const endExclusive = Math.min(offset + this.resumableChunkSize, data.size);
            const response = await this.uploadRequest(uploadUrl, {
                method: 'PUT',
                headers: {
                    'Content-Length': String(endExclusive - offset),
                    'Content-Range': `bytes ${offset}-${endExclusive - 1}/${data.size}`,
                },
                body: data.slice(offset, endExclusive),
            }, { acceptedStatuses: [202] });
            if (response.status !== 202) {
                await this.uploadStateStore?.remove?.(stateKey);
                this.onUploadProgress?.({
                    path,
                    progressPhase,
                    uploadedBytes: data.size,
                    totalBytes: data.size,
                });
                return normalizeDriveItem(await response.json(), path);
            }
            const status = await response.json();
            const reportedOffset = nextExpectedOffset(status);
            offset = reportedOffset > offset ? reportedOffset : endExclusive;
            await this.uploadStateStore?.set?.(stateKey, {
                uploadUrl,
                path,
                size: data.size,
                uploadedBytes: offset,
                expirationDateTime: status.expirationDateTime,
            });
            this.onUploadProgress?.({
                path,
                progressPhase,
                uploadedBytes: offset,
                totalBytes: data.size,
            });
        }
        throw new OneDriveSyncError('OneDriveへのアップロードを完了できませんでした。');
    }

    async listChildren(item, path) {
        const files = [];
        let url = `${GRAPH_BASE}/me/drive/items/${encodeURIComponent(item.id)}/children?$top=200`;
        while (url) {
            const response = await this.request(url);
            const body = await response.json();
            for (const child of body.value || []) {
                const childPath = path ? `${path}/${child.name}` : child.name;
                files.push(normalizeDriveItem(child, childPath));
            }
            url = body['@odata.nextLink'] || '';
        }
        return files;
    }

    async listFiles({ path, kind } = {}) {
        if (path) {
            const file = await this.findFile(path);
            return file ? [file] : [];
        }
        const root = await this.getAppRoot();
        const files = [];
        const folders = [{ item: root, path: '' }];
        while (folders.length > 0) {
            const folder = folders.shift();
            const children = await this.listChildren(folder.item, folder.path);
            for (const child of children) {
                files.push(child);
                if (child.folder) folders.push({ item: child, path: child.radexamPath });
            }
        }
        const matching = kind
            ? files.filter(file => file.appProperties?.radexamKind === kind)
            : files;
        if (kind === 'change-batch' || kind === 'bulk-change-batch') {
            await Promise.all(matching.map(async file => {
                const response = await this.downloadFile(file.id);
                const batch = await response.json();
                Object.assign(file.appProperties, {
                    batchId: batch.batchId,
                    deviceId: batch.deviceId,
                    fromSequence: String(batch.fromSequence),
                    toSequence: String(batch.toSequence),
                    changeCount: String(batch.changeCount),
                    format: kind === 'bulk-change-batch' ? 'bulk-delta' : 'change-batch',
                });
            }));
        }
        return matching;
    }

    async deleteFile(fileId) {
        await this.request(
            `${GRAPH_BASE}/me/drive/items/${encodeURIComponent(fileId)}`,
            { method: 'DELETE' },
            { acceptedStatuses: [404] }
        );
    }

    async deleteFiles(fileIds, { onProgress = null } = {}) {
        const ids = [...new Set((fileIds || []).filter(Boolean).map(String))];
        let deletedFiles = 0;
        onProgress?.({ deletedFiles, totalFiles: ids.length });
        const queue = [...ids];
        const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
            while (queue.length > 0) {
                const fileId = queue.shift();
                if (fileId) await this.deleteFile(fileId);
                deletedFiles += 1;
                onProgress?.({ deletedFiles, totalFiles: ids.length });
            }
        });
        await Promise.all(workers);
        this.appRoot = null;
        this.folderCache.clear();
        return { deletedFiles };
    }
}

export class OneDriveSyncProvider extends GoogleDriveSyncProvider {
    constructor(options) {
        if (!options?.client) throw new Error('OneDrive同期にはclientが必要です。');
        super(options);
    }

    async commitManifest(manifest, expectedRevision) {
        try {
            return await super.commitManifest(manifest, expectedRevision);
        } catch (error) {
            if (error instanceof OneDriveSyncError && error.status === 412) {
                throw new SyncManifestConflictError();
            }
            throw error;
        }
    }

    async downloadChangeBatch(descriptor) {
        const stored = await this.client.readJson(descriptor.objectKey);
        if (!stored.value) {
            throw new OneDriveSyncError(
                `OneDriveに変更バッチがありません: ${descriptor.objectKey}`
            );
        }
        return stored.value;
    }
}
