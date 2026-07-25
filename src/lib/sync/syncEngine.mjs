import {
    appendSyncManifestBatch,
    buildSyncChangeBatch,
    MAX_CHANGES_PER_BATCH,
    validateSyncChangeBatch,
    validateSyncManifest,
} from './syncManifest.mjs';
import { processIncomingSyncChange } from './syncReceiver.mjs';

const REQUIRED_PROVIDER_METHODS = [
    'readManifest',
    'commitManifest',
    'uploadChangeBatch',
    'downloadChangeBatch',
    'hasBlob',
    'uploadBlob',
    'downloadBlob',
];

const assertSyncProvider = provider => {
    for (const method of REQUIRED_PROVIDER_METHODS) {
        if (typeof provider?.[method] !== 'function') {
            throw new Error(`同期プロバイダーに${method}()がありません。`);
        }
    }
};

const uniqueBlobRefs = changes => {
    const refs = new Map();
    for (const change of changes) {
        for (const ref of change.blobRefs || []) {
            if (!ref?.contentHash) {
                throw new Error(`同期ファイルの内容ハッシュがありません: ${ref?.localKey || '不明'}`);
            }
            if (!refs.has(ref.contentHash)) refs.set(ref.contentHash, ref);
        }
    }
    return [...refs.values()];
};

const buildBatchId = changes => {
    const first = changes[0];
    const last = changes.at(-1);
    return `${first.deviceId}-${first.sequence}-${last.sequence}`;
};

const pullRemoteBatches = async ({
    provider,
    journal,
    dataStore,
    manifest,
}) => {
    const summary = {
        pulledBatches: 0,
        appliedChanges: 0,
        duplicateChanges: 0,
        acknowledgedChanges: 0,
        conflicts: 0,
    };
    let config = await journal.getConfig();
    const batches = manifest.batches.filter(
        batch => batch.generation > (Number(config.lastPulledGeneration) || 0)
    );

    for (const descriptor of batches) {
        const batch = validateSyncChangeBatch(
            await provider.downloadChangeBatch(descriptor),
            descriptor
        );
        for (const change of batch.changes) {
            const result = await processIncomingSyncChange({
                change,
                journal,
                dataStore,
                resolveBlob: ref => provider.downloadBlob(ref.contentHash),
            });
            if (result.status === 'needs-blob') {
                throw new Error(`同期ファイルを取得できませんでした: ${result.blobRef?.contentHash || '不明'}`);
            }
            if (result.status === 'applied') summary.appliedChanges += 1;
            if (result.status === 'duplicate') summary.duplicateChanges += 1;
            if (result.status === 'acknowledged') summary.acknowledgedChanges += 1;
            if (result.status === 'conflict') summary.conflicts += 1;
        }
        config = await journal.configure({
            lastPulledGeneration: descriptor.generation,
            lastPulledAt: new Date().toISOString(),
        });
        summary.pulledBatches += 1;
    }
    return summary;
};

const pushLocalBatch = async ({
    provider,
    journal,
    getLocalBlob,
    maxManifestRetries,
}) => {
    const pending = (await journal.listPendingChanges())
        .sort((left, right) => left.sequence - right.sequence)
        .slice(0, MAX_CHANGES_PER_BATCH);
    if (pending.length === 0) return { pushedBatches: 0, pushedChanges: 0, uploadedBlobs: 0 };
    const blobRefs = uniqueBlobRefs(pending);
    if (blobRefs.length > 0 && typeof getLocalBlob !== 'function') {
        throw new Error('変更の送信にはgetLocalBlob()が必要です。');
    }

    let uploadedBlobs = 0;
    for (const ref of blobRefs) {
        if (await provider.hasBlob(ref.contentHash)) continue;
        const local = await getLocalBlob(ref);
        if (!local?.blob || local.contentHash !== ref.contentHash) {
            throw new Error(`送信ファイルの内容ハッシュが一致しません: ${ref.localKey}`);
        }
        await provider.uploadBlob(ref.contentHash, local.blob);
        uploadedBlobs += 1;
    }

    const batch = buildSyncChangeBatch({
        batchId: buildBatchId(pending),
        deviceId: pending[0].deviceId,
        changes: pending,
    });
    const { objectKey } = await provider.uploadChangeBatch(batch);
    let committedBatch = null;

    for (let attempt = 1; attempt <= maxManifestRetries; attempt += 1) {
        const remote = await provider.readManifest();
        const manifest = validateSyncManifest(remote.manifest);
        const appended = appendSyncManifestBatch(manifest, {
            batchId: batch.batchId,
            deviceId: batch.deviceId,
            objectKey,
            fromSequence: batch.fromSequence,
            toSequence: batch.toSequence,
            changeCount: batch.changeCount,
            createdAt: batch.createdAt,
        });
        if (!appended.appended) {
            committedBatch = appended.batch;
            break;
        }
        try {
            await provider.commitManifest(appended.manifest, remote.revision);
            committedBatch = appended.batch;
            break;
        } catch (error) {
            if (error?.code !== 'SYNC_MANIFEST_CONFLICT' || attempt === maxManifestRetries) {
                throw error;
            }
        }
    }

    if (!committedBatch) throw new Error('manifestへ変更バッチを登録できませんでした。');
    await journal.acknowledgeChanges(
        pending.map(change => change.changeId),
        { committedGeneration: committedBatch.generation }
    );
    await journal.configure({
        lastPushedGeneration: committedBatch.generation,
        lastPushedAt: new Date().toISOString(),
    });
    return {
        pushedBatches: 1,
        pushedChanges: pending.length,
        uploadedBlobs,
    };
};

const pushLocalBatches = async ({
    provider,
    journal,
    getLocalBlob,
    maxManifestRetries,
    maxPushBatches,
}) => {
    const total = {
        pushedBatches: 0,
        pushedChanges: 0,
        uploadedBlobs: 0,
    };
    for (let index = 0; index < maxPushBatches; index += 1) {
        const result = await pushLocalBatch({
            provider,
            journal,
            getLocalBlob,
            maxManifestRetries,
        });
        total.pushedBatches += result.pushedBatches;
        total.pushedChanges += result.pushedChanges;
        total.uploadedBlobs += result.uploadedBlobs;
        if (result.pushedBatches === 0) break;
    }
    return total;
};

export const runSyncCycle = async ({
    provider,
    journal,
    dataStore,
    getLocalBlob,
    maxManifestRetries = 3,
    maxPushBatches = 20,
}) => {
    assertSyncProvider(provider);
    if (!journal || !dataStore?.applyChange) {
        throw new Error('同期にはjournalとdataStoreが必要です。');
    }
    const config = await journal.getConfig();
    if (!config.enabled || !config.bootstrapCompleted) {
        return { status: 'disabled' };
    }

    try {
        const remote = await provider.readManifest();
        const manifest = validateSyncManifest(remote.manifest);
        const pull = await pullRemoteBatches({
            provider,
            journal,
            dataStore,
            manifest,
        });
        const push = await pushLocalBatches({
            provider,
            journal,
            getLocalBlob,
            maxManifestRetries,
            maxPushBatches,
        });
        const finishedAt = new Date().toISOString();
        await journal.configure({
            lastSyncAt: finishedAt,
            lastSyncError: null,
            lastSyncErrorAt: null,
        });
        return {
            status: 'completed',
            ...pull,
            ...push,
            finishedAt,
            pendingChanges: (await journal.listPendingChanges()).length,
        };
    } catch (error) {
        try {
            await journal.configure({
                lastSyncError: error instanceof Error ? error.message : String(error),
                lastSyncErrorAt: new Date().toISOString(),
            });
        } catch {
            // 元の同期エラーを優先して呼び出し元へ返す。
        }
        throw error;
    }
};
