import {
    appendSyncManifestBatch,
    buildSyncBulkChangePackage,
    buildSyncChangeBatch,
    MAX_CHANGES_PER_BATCH,
    MAX_CHANGES_PER_BULK_PACKAGE,
    setLatestSyncSnapshot,
    SYNC_BATCH_FORMATS,
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

const bytesToHex = bytes => (
    Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
);

const calculateBlobHash = async blob => {
    if (!(blob instanceof Blob) || !globalThis.crypto?.subtle) {
        throw new Error('スナップショットの検証に必要なSHA-256を利用できません。');
    }
    const digest = await globalThis.crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return `sha256:${bytesToHex(new Uint8Array(digest))}`;
};

const reportProgress = (provider, progress) => {
    if (typeof provider?.reportProgress === 'function') provider.reportProgress(progress);
};

const readManifestForSync = provider => provider.readManifest({
    recoverMissingBatches: false,
});

const MAX_STANDARD_DELTA_BYTES = 5 * 1024 * 1024;
const STRUCTURAL_BULK_THRESHOLD = 25;
const BINARY_BULK_THRESHOLD = 10;
const STRUCTURAL_ENTITY_TYPES = new Set(['exam', 'question']);

const shouldUseBulkPackage = changes => {
    if (changes.length > MAX_CHANGES_PER_BATCH) return true;
    if (
        changes.filter(change => (
            STRUCTURAL_ENTITY_TYPES.has(change.entityType)
            || change.operation === 'delete'
        )).length >= STRUCTURAL_BULK_THRESHOLD
    ) {
        return true;
    }
    if (uniqueBlobRefs(changes).length >= BINARY_BULK_THRESHOLD) return true;
    return new Blob([JSON.stringify(changes)]).size > MAX_STANDARD_DELTA_BYTES;
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
    const batches = [];
    for (const batch of manifest.batches) {
        const alreadyApplied = typeof journal.hasAppliedBatch === 'function'
            ? await journal.hasAppliedBatch(batch.batchId)
            : batch.generation <= (Number(config.lastPulledGeneration) || 0);
        if (!alreadyApplied) batches.push(batch);
    }

    const [pendingLocalChanges, unresolvedConflicts, sentLocalChanges] = await Promise.all([
        journal.listPendingChanges(),
        typeof journal.listConflicts === 'function'
            ? journal.listConflicts()
            : Promise.resolve([]),
        typeof journal.listSentChangesAfterGeneration === 'function'
            ? journal.listSentChangesAfterGeneration(0)
            : Promise.resolve([]),
    ]);
    const incomingContext = {
        config,
        pendingLocalChanges,
        sentLocalChanges,
        conflictsByEntity: new Map(unresolvedConflicts.map(conflict => [
            `${conflict.entityType}:${String(conflict.entityId)}`,
            conflict,
        ])),
    };
    const totalChanges = batches.reduce(
        (total, batch) => total + (Number(batch.changeCount) || 0),
        0
    );
    let processedChanges = 0;
    if (totalChanges > 0) {
        reportProgress(provider, {
            phase: 'applying-changes',
            processedChanges,
            totalChanges,
        });
    }

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
                context: incomingContext,
            });
            if (result.status === 'needs-blob') {
                throw new Error(`同期ファイルを取得できませんでした: ${result.blobRef?.contentHash || '不明'}`);
            }
            if (result.status === 'applied') summary.appliedChanges += 1;
            if (result.status === 'duplicate') summary.duplicateChanges += 1;
            if (result.status === 'acknowledged') summary.acknowledgedChanges += 1;
            if (result.status === 'conflict') summary.conflicts += 1;
            processedChanges += 1;
            if (processedChanges % 10 === 0 || processedChanges === totalChanges) {
                reportProgress(provider, {
                    phase: 'applying-changes',
                    processedChanges,
                    totalChanges,
                });
            }
        }
        config = await journal.configure({
            lastPulledGeneration: descriptor.generation,
            lastPulledAt: new Date().toISOString(),
        });
        incomingContext.config = config;
        if (typeof journal.markBatchApplied === 'function') {
            await journal.markBatchApplied(descriptor);
        }
        summary.pulledBatches += 1;
    }
    return summary;
};

const restoreRemoteSnapshotIfNeeded = async ({
    provider,
    journal,
    manifest,
    restoreLocalSnapshot,
}) => {
    const snapshot = manifest.latestSnapshot;
    if (!snapshot) return { restoredSnapshot: false };
    const config = await journal.getConfig();
    if (config.lastAppliedSnapshotId === snapshot.snapshotId) {
        return { restoredSnapshot: false };
    }
    if (
        config.lastAppliedSnapshotId
        || Number(config.lastPulledGeneration) > 0
        || Number(config.lastPushedGeneration) > 0
    ) {
        // 定期スナップショットは既存端末を上書きせず、初期復元にだけ使う。
        return { restoredSnapshot: false };
    }
    const pending = await journal.listPendingChanges();
    if (pending.length > 0) {
        // ローカルに独自データがある端末は、無断で全体を上書きしない。
        return { restoredSnapshot: false };
    }
    if (typeof provider.downloadSnapshot !== 'function' || typeof restoreLocalSnapshot !== 'function') {
        throw new Error('クラウドの初期データを復元する機能がありません。');
    }

    reportProgress(provider, { phase: 'downloading-snapshot' });
    const blob = await provider.downloadSnapshot(snapshot);
    if (!(blob instanceof Blob)) throw new Error('クラウドの初期データを取得できませんでした。');
    const contentHash = await calculateBlobHash(blob);
    if (contentHash !== snapshot.contentHash) {
        throw new Error('クラウドの初期データが破損しているため、復元を中止しました。');
    }
    reportProgress(provider, { phase: 'restoring-snapshot' });
    await restoreLocalSnapshot(blob, snapshot);
    await journal.configure({
        lastAppliedSnapshotId: snapshot.snapshotId,
        lastAppliedSnapshotAt: new Date().toISOString(),
        lastPulledGeneration: snapshot.generation,
        reconciliationRequired: false,
        reconciliationReason: null,
        reconciliationMarkedAt: null,
    });
    reportProgress(provider, { phase: 'snapshot-restored' });
    return { restoredSnapshot: true };
};

const commitInitialSnapshot = async ({
    provider,
    journal,
    manifest,
    revision,
    createLocalSnapshot,
    maxManifestRetries,
    snapshotThreshold,
}) => {
    if (
        manifest.latestSnapshot
        || typeof provider.uploadSnapshot !== 'function'
        || typeof createLocalSnapshot !== 'function'
        || typeof journal.saveBootstrapSnapshot !== 'function'
    ) {
        return { createdSnapshot: false, coveredChanges: 0 };
    }
    const pending = await journal.listPendingChanges();
    if (pending.length < snapshotThreshold) {
        return { createdSnapshot: false, coveredChanges: 0 };
    }
    const cutoffSequence = Math.max(...pending.map(change => change.sequence));
    const config = await journal.getConfig();
    let cached = await journal.getBootstrapSnapshot?.();
    if (
        !cached?.descriptor
        || !(cached?.blob instanceof Blob)
        || cached.descriptor.deviceId !== config.deviceId
        || ![undefined, 'initial'].includes(cached.descriptor.purpose)
    ) {
        reportProgress(provider, {
            phase: 'preparing-snapshot',
            totalChanges: pending.length,
        });
        const created = await createLocalSnapshot();
        if (!(created?.blob instanceof Blob)) {
            throw new Error('初回同期用の全体データを作成できませんでした。');
        }
        const contentHash = created.contentHash || await calculateBlobHash(created.blob);
        const createdAt = new Date().toISOString();
        const snapshotId = `${config.deviceId}-${cutoffSequence}-${contentHash.slice(-12)}`;
        cached = {
            blob: created.blob,
            descriptor: {
                snapshotId,
                deviceId: config.deviceId,
                objectKey: '',
                generation: manifest.generation,
                cutoffSequence,
                byteSize: created.blob.size,
                contentHash,
                counts: created.counts || null,
                purpose: 'initial',
                createdAt,
            },
        };
        await journal.saveBootstrapSnapshot(cached);
    }

    reportProgress(provider, {
        phase: 'uploading-snapshot',
        uploadedBytes: 0,
        totalBytes: cached.blob.size,
    });
    const uploaded = await provider.uploadSnapshot(
        cached.descriptor.snapshotId,
        cached.blob,
        cached.descriptor
    );
    let remoteManifest = manifest;
    let remoteRevision = revision;
    let committedSnapshot = null;
    for (let attempt = 1; attempt <= maxManifestRetries; attempt += 1) {
        if (attempt > 1) {
            const remote = await readManifestForSync(provider);
            remoteManifest = validateSyncManifest(remote.manifest);
            remoteRevision = remote.revision;
        }
        if (remoteManifest.latestSnapshot) {
            committedSnapshot = remoteManifest.latestSnapshot;
            break;
        }
        const descriptor = {
            ...cached.descriptor,
            objectKey: uploaded.objectKey,
            generation: remoteManifest.generation,
        };
        const next = setLatestSyncSnapshot(remoteManifest, descriptor);
        try {
            reportProgress(provider, { phase: 'committing-snapshot' });
            await provider.commitManifest(next.manifest, remoteRevision);
            committedSnapshot = descriptor;
            break;
        } catch (error) {
            if (error?.code !== 'SYNC_MANIFEST_CONFLICT' || attempt === maxManifestRetries) {
                throw error;
            }
        }
    }
    if (!committedSnapshot) throw new Error('初回同期データをmanifestへ登録できませんでした。');

    const covered = pending.filter(
        change => change.sequence <= cached.descriptor.cutoffSequence
    );
    if (committedSnapshot.snapshotId === cached.descriptor.snapshotId) {
        reportProgress(provider, {
            phase: 'finalizing-local-changes',
            totalChanges: covered.length,
        });
        await journal.acknowledgeChanges(
            covered.map(change => change.changeId),
            { committedGeneration: committedSnapshot.generation }
        );
        await journal.configure({
            lastAppliedSnapshotId: committedSnapshot.snapshotId,
            lastPushedGeneration: committedSnapshot.generation,
            lastSnapshotAt: committedSnapshot.createdAt,
            changesSinceSnapshot: 0,
        });
    }
    await journal.clearBootstrapSnapshot?.();
    reportProgress(provider, { phase: 'snapshot-completed' });
    return {
        createdSnapshot: committedSnapshot.snapshotId === cached.descriptor.snapshotId,
        coveredChanges: committedSnapshot.snapshotId === cached.descriptor.snapshotId
            ? covered.length
            : 0,
    };
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const CHECKPOINT_CHANGE_THRESHOLD = 100;
const MINIMUM_WEEKLY_CHECKPOINT_CHANGES = 10;

const commitPeriodicSnapshotIfDue = async ({
    provider,
    journal,
    createLocalSnapshot,
    maxManifestRetries,
}) => {
    if (
        typeof provider.uploadSnapshot !== 'function'
        || typeof createLocalSnapshot !== 'function'
        || typeof journal.saveBootstrapSnapshot !== 'function'
    ) {
        return { createdPeriodicSnapshot: false };
    }
    const config = await journal.getConfig();
    const changesSinceSnapshot = Number(config.changesSinceSnapshot) || 0;
    const lastSnapshotTime = new Date(config.lastSnapshotAt || 0).getTime();
    const dueByCount = changesSinceSnapshot >= CHECKPOINT_CHANGE_THRESHOLD;
    const dueByAge = (
        changesSinceSnapshot >= MINIMUM_WEEKLY_CHECKPOINT_CHANGES
        && (!Number.isFinite(lastSnapshotTime) || Date.now() - lastSnapshotTime >= WEEK_MS)
    );
    if (!dueByCount && !dueByAge) return { createdPeriodicSnapshot: false };

    const remote = await readManifestForSync(provider);
    const manifest = validateSyncManifest(remote.manifest);
    const cutoffSequence = Math.max(0, (Number(config.nextSequence) || 1) - 1);
    let cached = await journal.getBootstrapSnapshot?.();
    if (
        !cached?.descriptor
        || !(cached?.blob instanceof Blob)
        || cached.descriptor.deviceId !== config.deviceId
        || cached.descriptor.purpose !== 'checkpoint'
    ) {
        reportProgress(provider, {
            phase: 'preparing-checkpoint',
            totalChanges: changesSinceSnapshot,
        });
        const created = await createLocalSnapshot();
        if (!(created?.blob instanceof Blob)) {
            throw new Error('復旧用スナップショットを作成できませんでした。');
        }
        const contentHash = created.contentHash || await calculateBlobHash(created.blob);
        const createdAt = new Date().toISOString();
        cached = {
            blob: created.blob,
            descriptor: {
                snapshotId: `${config.deviceId}-${cutoffSequence}-${contentHash.slice(-12)}`,
                deviceId: config.deviceId,
                objectKey: '',
                generation: manifest.generation,
                cutoffSequence,
                byteSize: created.blob.size,
                contentHash,
                counts: created.counts || null,
                purpose: 'checkpoint',
                createdAt,
            },
        };
        await journal.saveBootstrapSnapshot(cached);
    }

    reportProgress(provider, {
        phase: 'uploading-checkpoint',
        uploadedBytes: 0,
        totalBytes: cached.blob.size,
    });
    const uploaded = await provider.uploadSnapshot(
        cached.descriptor.snapshotId,
        cached.blob,
        cached.descriptor
    );
    let committed = null;
    let currentManifest = manifest;
    let currentRevision = remote.revision;
    for (let attempt = 1; attempt <= maxManifestRetries; attempt += 1) {
        if (attempt > 1) {
            const refreshed = await readManifestForSync(provider);
            currentManifest = validateSyncManifest(refreshed.manifest);
            currentRevision = refreshed.revision;
        }
        const descriptor = {
            ...cached.descriptor,
            objectKey: uploaded.objectKey,
            generation: currentManifest.generation,
        };
        try {
            await provider.commitManifest(
                setLatestSyncSnapshot(currentManifest, descriptor).manifest,
                currentRevision
            );
            committed = descriptor;
            break;
        } catch (error) {
            if (error?.code !== 'SYNC_MANIFEST_CONFLICT' || attempt === maxManifestRetries) {
                throw error;
            }
        }
    }
    if (!committed) throw new Error('復旧用スナップショットを登録できませんでした。');
    await journal.clearBootstrapSnapshot?.();
    await journal.configure({
        lastSnapshotAt: committed.createdAt,
        lastPublishedSnapshotId: committed.snapshotId,
        changesSinceSnapshot: 0,
    });
    reportProgress(provider, { phase: 'checkpoint-completed' });
    return { createdPeriodicSnapshot: true };
};

const pushLocalBatch = async ({
    provider,
    journal,
    getLocalBlob,
    maxManifestRetries,
    remoteHint = null,
}) => {
    const allPending = (await journal.listPendingChanges())
        .sort((left, right) => left.sequence - right.sequence);
    const useBulkPackage = (
        typeof provider.uploadBulkChangePackage === 'function'
        && shouldUseBulkPackage(allPending.slice(0, MAX_CHANGES_PER_BULK_PACKAGE))
    );
    const pending = allPending.slice(
        0,
        useBulkPackage ? MAX_CHANGES_PER_BULK_PACKAGE : MAX_CHANGES_PER_BATCH
    );
    if (pending.length === 0) return { pushedBatches: 0, pushedChanges: 0, uploadedBlobs: 0 };
    const blobRefs = uniqueBlobRefs(pending);
    if (blobRefs.length > 0 && typeof getLocalBlob !== 'function') {
        throw new Error('変更の送信にはgetLocalBlob()が必要です。');
    }

    const missingBlobRefs = [];
    for (const ref of blobRefs) {
        if (await provider.hasBlob(ref.contentHash)) continue;
        missingBlobRefs.push(ref);
    }

    let uploadedBlobs = 0;
    const blobQueue = [...missingBlobRefs];
    if (blobQueue.length > 0) {
        reportProgress(provider, {
            phase: 'uploading-files',
            uploadedFiles: 0,
            totalFiles: blobQueue.length,
        });
    }
    const blobWorkers = Array.from(
        { length: Math.min(3, blobQueue.length) },
        async () => {
            while (blobQueue.length > 0) {
                const ref = blobQueue.shift();
                if (!ref) continue;
                const local = await getLocalBlob(ref);
                if (!local?.blob || local.contentHash !== ref.contentHash) {
                    throw new Error(`送信ファイルの内容ハッシュが一致しません: ${ref.localKey}`);
                }
                await provider.uploadBlob(ref.contentHash, local.blob);
                uploadedBlobs += 1;
                reportProgress(provider, {
                    phase: 'uploading-files',
                    uploadedFiles: uploadedBlobs,
                    totalFiles: missingBlobRefs.length,
                });
            }
        }
    );
    await Promise.all(blobWorkers);

    const batch = (useBulkPackage ? buildSyncBulkChangePackage : buildSyncChangeBatch)({
        batchId: buildBatchId(pending),
        deviceId: pending[0].deviceId,
        changes: pending,
    });
    const { objectKey } = useBulkPackage
        ? await provider.uploadBulkChangePackage(batch)
        : await provider.uploadChangeBatch(batch);
    let committedBatch = null;

    for (let attempt = 1; attempt <= maxManifestRetries; attempt += 1) {
        const remote = attempt === 1 && remoteHint
            ? remoteHint
            : await readManifestForSync(provider);
        const manifest = validateSyncManifest(remote.manifest);
        const appended = appendSyncManifestBatch(manifest, {
            batchId: batch.batchId,
            deviceId: batch.deviceId,
            objectKey,
            fromSequence: batch.fromSequence,
            toSequence: batch.toSequence,
            changeCount: batch.changeCount,
            format: batch.format,
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
    reportProgress(provider, {
        phase: 'finalizing-local-changes',
        totalChanges: pending.length,
    });
    await journal.acknowledgeChanges(
        pending.map(change => change.changeId),
        { committedGeneration: committedBatch.generation }
    );
    const config = await journal.getConfig();
    await journal.configure({
        lastPushedGeneration: committedBatch.generation,
        lastPushedAt: new Date().toISOString(),
        changesSinceSnapshot: (Number(config.changesSinceSnapshot) || 0) + pending.length,
    });
    return {
        pushedBatches: 1,
        pushedChanges: pending.length,
        uploadedBlobs,
        pushedBulkPackages: useBulkPackage ? 1 : 0,
    };
};

const pushLocalBatches = async ({
    provider,
    journal,
    getLocalBlob,
    maxManifestRetries,
    maxPushBatches,
    remoteHint = null,
}) => {
    const total = {
        pushedBatches: 0,
        pushedChanges: 0,
        uploadedBlobs: 0,
        pushedBulkPackages: 0,
    };
    for (let index = 0; index < maxPushBatches; index += 1) {
        const result = await pushLocalBatch({
            provider,
            journal,
            getLocalBlob,
            maxManifestRetries,
            remoteHint: index === 0 ? remoteHint : null,
        });
        total.pushedBatches += result.pushedBatches;
        total.pushedChanges += result.pushedChanges;
        total.uploadedBlobs += result.uploadedBlobs;
        total.pushedBulkPackages += result.pushedBulkPackages || 0;
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
    createLocalSnapshot,
    restoreLocalSnapshot,
    snapshotThreshold = MAX_CHANGES_PER_BATCH + 1,
}) => {
    const startedAtMs = Date.now();
    assertSyncProvider(provider);
    if (!journal || !dataStore?.applyChange) {
        throw new Error('同期にはjournalとdataStoreが必要です。');
    }
    const config = await journal.getConfig();
    if (!config.enabled || !config.bootstrapCompleted) {
        return { status: 'disabled' };
    }

    try {
        const remote = await readManifestForSync(provider);
        let manifest = validateSyncManifest(remote.manifest);
        const snapshotPull = await restoreRemoteSnapshotIfNeeded({
            provider,
            journal,
            manifest,
            restoreLocalSnapshot,
        });
        const pull = await pullRemoteBatches({
            provider,
            journal,
            dataStore,
            manifest,
        });
        const snapshotPush = await commitInitialSnapshot({
            provider,
            journal,
            manifest,
            revision: remote.revision,
            createLocalSnapshot,
            maxManifestRetries,
            snapshotThreshold,
        });
        const push = await pushLocalBatches({
            provider,
            journal,
            getLocalBlob,
            maxManifestRetries,
            maxPushBatches,
            remoteHint: snapshotPush.createdSnapshot ? null : remote,
        });
        const periodicSnapshot = await commitPeriodicSnapshotIfDue({
            provider,
            journal,
            createLocalSnapshot,
            maxManifestRetries,
        });
        const finishedAt = new Date().toISOString();
        const finalConfig = await journal.getConfig();
        const lastKnownCloudGeneration = Math.max(
            Number(manifest.generation) || 0,
            Number(finalConfig.lastPulledGeneration) || 0,
            Number(finalConfig.lastPushedGeneration) || 0
        );
        const pendingChanges = (await journal.listPendingChanges()).length;
        const sentChanges = (snapshotPush.coveredChanges || 0) + (push.pushedChanges || 0);
        await journal.configure({
            lastSyncAt: finishedAt,
            lastSyncError: null,
            lastSyncErrorAt: null,
            lastKnownCloudGeneration,
            lastVerifiedAt: finishedAt,
            lastSyncDurationMs: Date.now() - startedAtMs,
            lastSyncSentChanges: sentChanges,
            lastSyncReceivedChanges: pull.appliedChanges,
            lastSyncCreatedSnapshot: Boolean(snapshotPush.createdSnapshot),
            lastSyncSnapshotChanges: snapshotPush.coveredChanges || 0,
        });
        return {
            status: 'completed',
            ...snapshotPull,
            ...snapshotPush,
            ...pull,
            ...push,
            ...periodicSnapshot,
            finishedAt,
            lastKnownCloudGeneration,
            pendingChanges,
            sentChanges,
            durationMs: Date.now() - startedAtMs,
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
