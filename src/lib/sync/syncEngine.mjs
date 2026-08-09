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
const SNAPSHOT_PULL_CHANGE_THRESHOLD = 1000;
const CHANGE_BATCH_DOWNLOAD_CONCURRENCY = 3;
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

const syncEntityKey = change => `${change.entityType}:${String(change.entityId)}`;

const groupChangesByEntity = changes => {
    const grouped = new Map();
    for (const change of changes || []) {
        const key = syncEntityKey(change);
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(change);
    }
    return grouped;
};

const summarizeBatchChanges = (changes, byteSize = 0) => {
    const entityCounts = {};
    for (const change of changes || []) {
        entityCounts[change.entityType] = (entityCounts[change.entityType] || 0) + 1;
    }
    return {
        entityCounts,
        blobCount: uniqueBlobRefs(changes || []).length,
        byteSize: Math.max(0, Number(byteSize) || 0),
    };
};

const shouldRestoreCheckpointSnapshot = ({ manifest, config, remoteSummary }) => {
    const snapshot = manifest.latestSnapshot;
    if (
        !snapshot
        || remoteSummary.remoteChangeCount < SNAPSHOT_PULL_CHANGE_THRESHOLD
        || Number(snapshot.generation) <= (Number(config.lastPulledGeneration) || 0)
    ) {
        return false;
    }
    const remoteBatches = manifest.batches.filter(batch => (
        batch.generation > (Number(config.lastPulledGeneration) || 0)
        && batch.generation <= Number(snapshot.generation)
    ));
    if (
        remoteBatches.length === 0
        || remoteBatches.some(batch => !batch.entityCounts || !Number(batch.byteSize))
    ) {
        return false;
    }
    const totals = remoteBatches.reduce((summary, batch) => {
        for (const [entityType, count] of Object.entries(batch.entityCounts || {})) {
            summary.entityCounts[entityType] = (
                summary.entityCounts[entityType] || 0
            ) + (Number(count) || 0);
        }
        summary.byteSize += Number(batch.byteSize) || 0;
        return summary;
    }, { entityCounts: {}, byteSize: 0 });
    const structuralChanges = (
        (totals.entityCounts.exam || 0)
        + (totals.entityCounts.question || 0)
    );
    const binaryChanges = (
        (totals.entityCounts.image || 0)
        + (totals.entityCounts.pdf || 0)
    );
    return (
        binaryChanges === 0
        && structuralChanges / remoteSummary.remoteChangeCount >= 0.75
        && totals.byteSize >= Number(snapshot.byteSize) * 0.5
    );
};

const prefetchIncomingBlobs = async ({ provider, changes, batchIndex, totalBatches }) => {
    const refs = new Map();
    for (const change of changes) {
        if (!['image', 'pdf'].includes(change.entityType) || change.operation === 'delete') continue;
        for (const ref of change.blobRefs || []) {
            if (ref?.contentHash && !refs.has(ref.contentHash)) refs.set(ref.contentHash, ref);
        }
    }
    const queue = [...refs.keys()];
    const blobs = new Map();
    let downloadedFiles = 0;
    if (queue.length > 0) {
        reportProgress(provider, {
            phase: 'downloading-received-files',
            downloadedFiles,
            totalFiles: queue.length,
            batchIndex,
            totalBatches,
        });
    }
    await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
        while (queue.length > 0) {
            const contentHash = queue.shift();
            if (!contentHash) continue;
            blobs.set(contentHash, await provider.downloadBlob(contentHash));
            downloadedFiles += 1;
            reportProgress(provider, {
                phase: 'downloading-received-files',
                downloadedFiles,
                totalFiles: refs.size,
                batchIndex,
                totalBatches,
            });
        }
    }));
    return blobs;
};

const pullRemoteBatches = async ({
    provider,
    journal,
    dataStore,
    manifest,
    localState = null,
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
        const alreadyApplied = (
            batch.generation <= (Number(config.lastPulledGeneration) || 0)
            || (typeof journal.hasAppliedBatch === 'function'
                && await journal.hasAppliedBatch(batch.batchId))
        );
        if (!alreadyApplied) batches.push(batch);
    }

    const totalChanges = batches.reduce(
        (total, batch) => total + (Number(batch.changeCount) || 0),
        0
    );
    let processedChanges = 0;
    if (totalChanges > 0) {
        reportProgress(provider, {
            phase: 'preparing-received-changes',
            processedChanges,
            totalChanges,
        });
    }

    const preparedState = localState || (typeof journal.readPullState === 'function'
        ? await journal.readPullState()
        : null);
    const [pendingLocalChanges, unresolvedConflicts, sentLocalChanges] = preparedState
        ? [
            preparedState.pendingLocalChanges,
            preparedState.unresolvedConflicts,
            preparedState.sentLocalChanges,
        ]
        : await Promise.all([
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
        appliedChangeIds: new Set(),
        pendingChangesByEntity: groupChangesByEntity(pendingLocalChanges),
        sentChangesByEntity: groupChangesByEntity(sentLocalChanges),
    };
    const batchDownloads = new Map();
    const prefetchBatch = index => {
        if (index >= batches.length || batchDownloads.has(index)) return;
        const descriptor = batches[index];
        batchDownloads.set(index, provider.downloadChangeBatch(descriptor).then(
            value => ({
                value: validateSyncChangeBatch(value, descriptor),
                error: null,
            }),
            error => ({ value: null, error })
        ));
    };
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
        const descriptor = batches[batchIndex];
        for (
            let preloadIndex = batchIndex;
            preloadIndex < Math.min(
                batches.length,
                batchIndex + CHANGE_BATCH_DOWNLOAD_CONCURRENCY
            );
            preloadIndex += 1
        ) {
            prefetchBatch(preloadIndex);
        }
        reportProgress(provider, {
            phase: 'downloading-change-batch',
            batchIndex: batchIndex + 1,
            totalBatches: batches.length,
            processedChanges,
            totalChanges,
        });
        const downloaded = await batchDownloads.get(batchIndex);
        batchDownloads.delete(batchIndex);
        if (downloaded.error) throw downloaded.error;
        const batch = downloaded.value;
        const supportsBatch = (
            typeof dataStore.beginBatch === 'function'
            && typeof dataStore.endBatch === 'function'
        );
        const appliedChanges = [];
        const pendingChangesToAcknowledge = [];
        try {
            if (supportsBatch) await dataStore.beginBatch();
            const prefetchedBlobs = await prefetchIncomingBlobs({
                provider,
                changes: batch.changes,
                batchIndex: batchIndex + 1,
                totalBatches: batches.length,
            });
            reportProgress(provider, {
                phase: 'checking-received-changes',
                processedChanges,
                totalChanges,
                batchIndex: batchIndex + 1,
                totalBatches: batches.length,
            });
            for (const change of batch.changes) {
                const result = await processIncomingSyncChange({
                    change,
                    journal,
                    dataStore,
                    resolveBlob: ref => prefetchedBlobs.has(ref.contentHash)
                        ? prefetchedBlobs.get(ref.contentHash)
                        : provider.downloadBlob(ref.contentHash),
                    context: incomingContext,
                    deferAppliedMark: supportsBatch,
                });
                if (result.status === 'needs-blob') {
                    throw new Error(`同期ファイルを取得できませんでした: ${result.blobRef?.contentHash || '不明'}`);
                }
                if (result.status === 'applied') {
                    summary.appliedChanges += 1;
                    if (supportsBatch) appliedChanges.push(result.change);
                }
                if (result.status === 'duplicate') summary.duplicateChanges += 1;
                if (result.pendingChange) {
                    pendingChangesToAcknowledge.push(result.pendingChange);
                }
                if (result.status === 'acknowledged') {
                    summary.acknowledgedChanges += 1;
                }
                if (result.status === 'conflict') summary.conflicts += 1;
                processedChanges += 1;
                if (processedChanges % 10 === 0 || processedChanges === totalChanges) {
                    reportProgress(provider, {
                        phase: 'checking-received-changes',
                        processedChanges,
                        totalChanges,
                    });
                }
            }
            if (supportsBatch) {
                reportProgress(provider, {
                    phase: 'saving-received-changes',
                    changeCount: appliedChanges.length,
                    batchIndex: batchIndex + 1,
                    totalBatches: batches.length,
                });
                await dataStore.endBatch();
                reportProgress(provider, {
                    phase: 'recording-received-history',
                    changeCount: pendingChangesToAcknowledge.length,
                    batchIndex: batchIndex + 1,
                    totalBatches: batches.length,
                });
                if (pendingChangesToAcknowledge.length > 0) {
                    if (typeof journal.acknowledgeKnownChanges === 'function') {
                        await journal.acknowledgeKnownChanges(
                            pendingChangesToAcknowledge,
                            { committedGeneration: descriptor.generation }
                        );
                    } else {
                        await journal.acknowledgeChanges(
                            pendingChangesToAcknowledge.map(change => change.changeId),
                            { committedGeneration: descriptor.generation }
                        );
                    }
                }
            }
        } catch (error) {
            await dataStore.cancelBatch?.();
            throw error;
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
    summary.pendingChanges = incomingContext.pendingLocalChanges.length;
    return summary;
};

const restoreRemoteSnapshotIfNeeded = async ({
    provider,
    journal,
    manifest,
    restoreLocalSnapshot,
    allowCheckpointRestore = false,
    pendingChanges = null,
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
        if (!allowCheckpointRestore) return { restoredSnapshot: false };
    }
    const pending = pendingChanges || await journal.listPendingChanges();
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
    pendingChanges = null,
}) => {
    if (
        manifest.latestSnapshot
        || typeof provider.uploadSnapshot !== 'function'
        || typeof createLocalSnapshot !== 'function'
        || typeof journal.saveBootstrapSnapshot !== 'function'
    ) {
        return { createdSnapshot: false, coveredChanges: 0 };
    }
    const pending = pendingChanges || await journal.listPendingChanges();
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
        if (typeof journal.acknowledgeKnownChanges === 'function') {
            await journal.acknowledgeKnownChanges(covered, {
                committedGeneration: committedSnapshot.generation,
            });
        } else {
            await journal.acknowledgeChanges(
                covered.map(change => change.changeId),
                { committedGeneration: committedSnapshot.generation }
            );
        }
        await journal.configure({
            lastAppliedSnapshotId: committedSnapshot.snapshotId,
            lastPublishedSnapshotId: committedSnapshot.snapshotId,
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
    pendingChanges = null,
}) => {
    const allPending = pendingChanges || (await journal.listPendingChanges())
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
    const batchSummary = summarizeBatchChanges(
        pending,
        new Blob([JSON.stringify(batch)]).size
    );
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
            ...batchSummary,
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
    if (typeof journal.acknowledgeKnownChanges === 'function') {
        await journal.acknowledgeKnownChanges(pending, {
            committedGeneration: committedBatch.generation,
        });
    } else {
        await journal.acknowledgeChanges(
            pending.map(change => change.changeId),
            { committedGeneration: committedBatch.generation }
        );
    }
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
    pendingChanges = null,
}) => {
    const total = {
        pushedBatches: 0,
        pushedChanges: 0,
        uploadedBlobs: 0,
        pushedBulkPackages: 0,
    };
    const pendingQueue = [...(
        pendingChanges || await journal.listPendingChanges()
    )].sort((left, right) => left.sequence - right.sequence);
    for (let index = 0; index < maxPushBatches; index += 1) {
        const result = await pushLocalBatch({
            provider,
            journal,
            getLocalBlob,
            maxManifestRetries,
            remoteHint: index === 0 ? remoteHint : null,
            pendingChanges: pendingQueue,
        });
        total.pushedBatches += result.pushedBatches;
        total.pushedChanges += result.pushedChanges;
        total.uploadedBlobs += result.uploadedBlobs;
        total.pushedBulkPackages += result.pushedBulkPackages || 0;
        if (result.pushedBatches === 0) break;
        pendingQueue.splice(0, result.pushedChanges);
    }
    total.remainingPendingChanges = pendingQueue.length;
    return total;
};

const inspectRemoteUpdates = async ({ journal, manifest }) => {
    const config = await journal.getConfig();
    const unappliedBatches = [];
    for (const batch of manifest.batches) {
        const alreadyApplied = (
            batch.generation <= (Number(config.lastPulledGeneration) || 0)
            || (typeof journal.hasAppliedBatch === 'function'
                && await journal.hasAppliedBatch(batch.batchId))
        );
        if (!alreadyApplied) unappliedBatches.push(batch);
    }
    const snapshotAvailable = Boolean(
        manifest.latestSnapshot
        && !config.lastAppliedSnapshotId
        && manifest.latestSnapshot.deviceId !== config.deviceId
        && Number(config.lastPulledGeneration || 0) === 0
        && Number(config.lastPushedGeneration || 0) === 0
    );
    return {
        cloudGeneration: Number(manifest.generation) || 0,
        remoteBatchCount: unappliedBatches.length,
        remoteChangeCount: unappliedBatches.reduce(
            (total, batch) => total + (Number(batch.changeCount) || 0),
            0
        ),
        snapshotAvailable,
        updatesAvailable: snapshotAvailable || unappliedBatches.length > 0,
    };
};

const reconcileOwnPublishedSnapshot = async ({ journal, manifest }) => {
    const snapshot = manifest.latestSnapshot;
    if (!snapshot) return { reconciled: false, coveredChanges: 0 };
    const config = await journal.getConfig();
    if (
        config.lastAppliedSnapshotId === snapshot.snapshotId
        || String(snapshot.deviceId) !== String(config.deviceId)
    ) {
        return { reconciled: false, coveredChanges: 0 };
    }

    const cutoffSequence = Math.max(0, Number(snapshot.cutoffSequence) || 0);
    const pending = await journal.listPendingChanges();
    const covered = pending.filter(change => (
        String(change.deviceId) === String(config.deviceId)
        && Number(change.sequence) <= cutoffSequence
    ));
    if (covered.length > 0) {
        if (typeof journal.acknowledgeKnownChanges === 'function') {
            await journal.acknowledgeKnownChanges(covered, {
                committedGeneration: Number(snapshot.generation) || 0,
            });
        } else {
            await journal.acknowledgeChanges(
                covered.map(change => change.changeId),
                { committedGeneration: Number(snapshot.generation) || 0 }
            );
        }
    }
    await journal.configure({
        lastAppliedSnapshotId: snapshot.snapshotId,
        lastAppliedSnapshotAt: snapshot.createdAt || new Date().toISOString(),
        lastPublishedSnapshotId: snapshot.snapshotId,
        lastPushedGeneration: Math.max(
            Number(config.lastPushedGeneration) || 0,
            Number(snapshot.generation) || 0
        ),
        lastSnapshotAt: snapshot.createdAt || config.lastSnapshotAt || null,
        changesSinceSnapshot: 0,
    });
    return { reconciled: true, coveredChanges: covered.length };
};

const assertSyncReady = async ({ provider, journal, dataStoreRequired = false, dataStore }) => {
    assertSyncProvider(provider);
    if (!journal || (dataStoreRequired && !dataStore?.applyChange)) {
        throw new Error(dataStoreRequired
            ? '同期にはjournalとdataStoreが必要です。'
            : '同期にはjournalが必要です。');
    }
    const config = await journal.getConfig();
    return Boolean(config.enabled && config.bootstrapCompleted);
};

const recordSyncFailure = async (journal, error) => {
    try {
        await journal.configure({
            lastSyncError: error instanceof Error ? error.message : String(error),
            lastSyncErrorAt: new Date().toISOString(),
        });
    } catch {
        // 元の同期エラーを優先する。
    }
};

export const checkSyncUpdates = async ({ provider, journal }) => {
    if (!await assertSyncReady({ provider, journal })) return { status: 'disabled' };
    const startedAtMs = Date.now();
    try {
        const remote = await readManifestForSync(provider);
        const manifest = validateSyncManifest(remote.manifest);
        await reconcileOwnPublishedSnapshot({ journal, manifest });
        const summary = await inspectRemoteUpdates({ journal, manifest });
        const checkedAt = new Date().toISOString();
        const pendingChanges = (await journal.listPendingChanges()).length;
        await journal.configure({
            lastCheckedAt: checkedAt,
            lastKnownCloudGeneration: summary.cloudGeneration,
            remoteChangesAvailable: summary.updatesAvailable,
            remoteChangeCount: summary.remoteChangeCount,
            remoteSnapshotAvailable: summary.snapshotAvailable,
            lastSyncError: null,
            lastSyncErrorAt: null,
        });
        return {
            status: 'completed',
            ...summary,
            pendingChanges,
            checkedAt,
            durationMs: Date.now() - startedAtMs,
        };
    } catch (error) {
        await recordSyncFailure(journal, error);
        throw error;
    }
};

export const runSyncPull = async ({
    provider,
    journal,
    dataStore,
    restoreLocalSnapshot,
}) => {
    if (!await assertSyncReady({ provider, journal, dataStore, dataStoreRequired: true })) {
        return { status: 'disabled' };
    }
    const startedAtMs = Date.now();
    try {
        const remote = await readManifestForSync(provider);
        const manifest = validateSyncManifest(remote.manifest);
        await reconcileOwnPublishedSnapshot({ journal, manifest });
        const config = await journal.getConfig();
        const remoteSummary = await inspectRemoteUpdates({ journal, manifest });
        const localState = typeof journal.readPullState === 'function'
            ? await journal.readPullState()
            : null;
        const [pending, conflicts] = localState
            ? [localState.pendingLocalChanges, localState.unresolvedConflicts]
            : await Promise.all([
                journal.listPendingChanges(),
                typeof journal.listConflicts === 'function' ? journal.listConflicts() : [],
            ]);
        const allowCheckpointRestore = Boolean(
            pending.length === 0
            && conflicts.length === 0
            && shouldRestoreCheckpointSnapshot({
                manifest,
                config,
                remoteSummary,
            })
        );
        const snapshotPull = await restoreRemoteSnapshotIfNeeded({
            provider,
            journal,
            manifest,
            restoreLocalSnapshot,
            allowCheckpointRestore,
            pendingChanges: pending,
        });
        const pull = await pullRemoteBatches({
            provider,
            journal,
            dataStore,
            manifest,
            localState,
        });
        const finishedAt = new Date().toISOString();
        const remaining = await inspectRemoteUpdates({ journal, manifest });
        await journal.configure({
            lastPullAt: finishedAt,
            lastSyncAt: finishedAt,
            lastVerifiedAt: finishedAt,
            lastKnownCloudGeneration: remaining.cloudGeneration,
            remoteChangesAvailable: remaining.updatesAvailable,
            remoteChangeCount: remaining.remoteChangeCount,
            remoteSnapshotAvailable: remaining.snapshotAvailable,
            lastSyncDurationMs: Date.now() - startedAtMs,
            lastSyncReceivedChanges: pull.appliedChanges,
            lastSyncSentChanges: 0,
            lastSyncError: null,
            lastSyncErrorAt: null,
        });
        return {
            status: 'completed',
            ...snapshotPull,
            ...pull,
            ...remaining,
            finishedAt,
            pendingChanges: pull.pendingChanges,
            durationMs: Date.now() - startedAtMs,
        };
    } catch (error) {
        await recordSyncFailure(journal, error);
        throw error;
    }
};

export const runSyncPush = async ({
    provider,
    journal,
    getLocalBlob,
    maxManifestRetries = 3,
    maxPushBatches = 20,
    createLocalSnapshot,
    snapshotThreshold = MAX_CHANGES_PER_BATCH + 1,
}) => {
    if (!await assertSyncReady({ provider, journal })) return { status: 'disabled' };
    const startedAtMs = Date.now();
    try {
        const remote = await readManifestForSync(provider);
        const manifest = validateSyncManifest(remote.manifest);
        await reconcileOwnPublishedSnapshot({ journal, manifest });
        const remoteUpdates = await inspectRemoteUpdates({ journal, manifest });
        if (remoteUpdates.updatesAvailable) {
            const error = new Error('クラウドに未取得の更新があります。先に「クラウドから更新を取得」を実行してください。');
            error.code = 'REMOTE_UPDATES_REQUIRED';
            throw error;
        }
        const pendingChanges = await journal.listPendingChanges();
        const snapshotPush = await commitInitialSnapshot({
            provider,
            journal,
            manifest,
            revision: remote.revision,
            createLocalSnapshot,
            maxManifestRetries,
            snapshotThreshold,
            pendingChanges,
        });
        const push = await pushLocalBatches({
            provider,
            journal,
            getLocalBlob,
            maxManifestRetries,
            maxPushBatches,
            remoteHint: snapshotPush.createdSnapshot ? null : remote,
            pendingChanges: snapshotPush.createdSnapshot ? null : pendingChanges,
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
            remoteUpdates.cloudGeneration,
            Number(finalConfig.lastPushedGeneration) || 0
        );
        const sentChanges = (snapshotPush.coveredChanges || 0) + (push.pushedChanges || 0);
        await journal.configure({
            lastPushAt: finishedAt,
            lastSyncAt: finishedAt,
            lastVerifiedAt: finishedAt,
            lastKnownCloudGeneration,
            remoteChangesAvailable: false,
            remoteChangeCount: 0,
            remoteSnapshotAvailable: false,
            lastSyncDurationMs: Date.now() - startedAtMs,
            lastSyncSentChanges: sentChanges,
            lastSyncReceivedChanges: 0,
            lastSyncCreatedSnapshot: Boolean(snapshotPush.createdSnapshot),
            lastSyncSnapshotChanges: snapshotPush.coveredChanges || 0,
            lastSyncError: null,
            lastSyncErrorAt: null,
        });
        return {
            status: 'completed',
            ...snapshotPush,
            ...push,
            ...periodicSnapshot,
            finishedAt,
            lastKnownCloudGeneration,
            pendingChanges: push.remainingPendingChanges,
            sentChanges,
            durationMs: Date.now() - startedAtMs,
        };
    } catch (error) {
        await recordSyncFailure(journal, error);
        throw error;
    }
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
        await reconcileOwnPublishedSnapshot({ journal, manifest });
        const localState = typeof journal.readPullState === 'function'
            ? await journal.readPullState()
            : null;
        const snapshotPull = await restoreRemoteSnapshotIfNeeded({
            provider,
            journal,
            manifest,
            restoreLocalSnapshot,
            pendingChanges: localState?.pendingLocalChanges || null,
        });
        const pull = await pullRemoteBatches({
            provider,
            journal,
            dataStore,
            manifest,
            localState,
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
        const pendingChanges = push.remainingPendingChanges;
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
