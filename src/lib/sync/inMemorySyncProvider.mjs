const cloneValue = value => {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
};

export class SyncManifestConflictError extends Error {
    constructor(message = 'manifestが別端末で更新されました。') {
        super(message);
        this.name = 'SyncManifestConflictError';
        this.code = 'SYNC_MANIFEST_CONFLICT';
    }
}

export const createInMemorySyncCloud = () => ({
    manifest: null,
    revision: 0,
    batches: new Map(),
    blobs: new Map(),
    stats: {
        batchUploads: 0,
        blobUploads: 0,
        manifestCommits: 0,
    },
});

export class InMemorySyncProvider {
    constructor(cloud = createInMemorySyncCloud()) {
        this.cloud = cloud;
    }

    async readManifest() {
        return {
            manifest: cloneValue(this.cloud.manifest),
            revision: String(this.cloud.revision),
        };
    }

    async commitManifest(manifest, expectedRevision) {
        if (String(this.cloud.revision) !== String(expectedRevision)) {
            throw new SyncManifestConflictError();
        }
        this.cloud.manifest = cloneValue(manifest);
        this.cloud.revision += 1;
        this.cloud.stats.manifestCommits += 1;
        return { revision: String(this.cloud.revision) };
    }

    async uploadChangeBatch(batch) {
        if (!this.cloud.batches.has(batch.batchId)) {
            this.cloud.batches.set(batch.batchId, cloneValue(batch));
            this.cloud.stats.batchUploads += 1;
        }
        return { objectKey: `changes/${batch.batchId}.json` };
    }

    async downloadChangeBatch(descriptor) {
        const batchId = String(descriptor.objectKey)
            .replace(/^changes\//, '')
            .replace(/\.json$/, '');
        const batch = this.cloud.batches.get(batchId);
        if (!batch) throw new Error(`変更バッチが見つかりません: ${descriptor.objectKey}`);
        return cloneValue(batch);
    }

    async hasBlob(contentHash) {
        return this.cloud.blobs.has(String(contentHash));
    }

    async uploadBlob(contentHash, blob) {
        if (!this.cloud.blobs.has(String(contentHash))) {
            this.cloud.blobs.set(String(contentHash), cloneValue(blob));
            this.cloud.stats.blobUploads += 1;
        }
        return { objectKey: `objects/${contentHash}` };
    }

    async downloadBlob(contentHash) {
        const blob = this.cloud.blobs.get(String(contentHash));
        return blob == null ? null : cloneValue(blob);
    }
}
