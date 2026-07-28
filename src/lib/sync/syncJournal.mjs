import {
    createSyncChange,
    SYNC_OPERATIONS,
} from './syncProtocol.mjs';

const CONFIG_KEY = 'config';
const CHANGE_PREFIX = 'change:';
const TOMBSTONE_PREFIX = 'tombstone:';
const APPLIED_PREFIX = 'applied:';
const CONFLICT_PREFIX = 'conflict:';
const SENT_PREFIX = 'sent:';
const APPLIED_BATCH_PREFIX = 'applied-batch:';
const BOOTSTRAP_SNAPSHOT_KEY = 'bootstrap-snapshot';

const padSequence = sequence => String(sequence).padStart(16, '0');
const changeKey = change => `${CHANGE_PREFIX}${padSequence(change.sequence)}:${change.changeId}`;
const tombstoneKey = change => `${TOMBSTONE_PREFIX}${change.entityType}:${change.entityId}`;

const defaultUuid = () => {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

export class SyncJournal {
    constructor(storage, {
        now = () => new Date().toISOString(),
        uuid = defaultUuid,
    } = {}) {
        if (!storage) throw new Error('同期ジャーナルにはstorageが必要です。');
        this.storage = storage;
        this.now = now;
        this.uuid = uuid;
        this.queue = Promise.resolve();
    }

    withLock(task) {
        const result = this.queue.then(task, task);
        this.queue = result.catch(() => {});
        return result;
    }

    async getConfig() {
        const stored = await this.storage.getItem(CONFIG_KEY);
        return {
            enabled: false,
            deviceId: null,
            deviceName: null,
            provider: null,
            accountId: null,
            nextSequence: 1,
            reconciliationRequired: false,
            ...(stored || {}),
        };
    }

    async configure(updates = {}) {
        return this.withLock(async () => {
            const current = await this.getConfig();
            const next = {
                ...current,
                ...updates,
                deviceId: updates.deviceId || current.deviceId || this.uuid(),
                nextSequence: Math.max(1, Number(current.nextSequence) || 1),
            };
            await this.storage.setItem(CONFIG_KEY, next);
            return next;
        });
    }

    async markReconciliationRequired(reason = 'local-change-journal-error') {
        return this.withLock(async () => {
            const current = await this.getConfig();
            if (!current.enabled) return current;
            const next = {
                ...current,
                reconciliationRequired: true,
                reconciliationReason: reason,
                reconciliationMarkedAt: this.now(),
            };
            await this.storage.setItem(CONFIG_KEY, next);
            return next;
        });
    }

    async clearReconciliationRequired() {
        return this.withLock(async () => {
            const current = await this.getConfig();
            const next = {
                ...current,
                reconciliationRequired: false,
                reconciliationReason: null,
                reconciliationMarkedAt: null,
            };
            await this.storage.setItem(CONFIG_KEY, next);
            return next;
        });
    }

    async disconnect({ discardPending = false } = {}) {
        return this.withLock(async () => {
            const pendingKeys = [];
            const allKeys = [];
            await this.storage.iterate((value, key) => {
                allKeys.push(key);
                if (String(key).startsWith(CHANGE_PREFIX) && value?.status === 'pending') {
                    pendingKeys.push(key);
                }
            });
            if (pendingKeys.length > 0 && !discardPending) {
                throw new Error(`未同期の変更が${pendingKeys.length}件あります。先に同期してください。`);
            }
            if (typeof this.storage.clear === 'function') {
                await this.storage.clear();
            } else {
                await Promise.all(allKeys.map(key => this.storage.removeItem(key)));
            }
            const config = {
                enabled: false,
                deviceId: this.uuid(),
                deviceName: null,
                provider: null,
                accountId: null,
                nextSequence: 1,
                reconciliationRequired: false,
            };
            await this.storage.setItem(CONFIG_KEY, config);
            return config;
        });
    }

    async recordChanges(inputs) {
        const candidates = (inputs || []).filter(Boolean);
        if (candidates.length === 0) return [];

        return this.withLock(async () => {
            const config = await this.getConfig();
            if (!config.enabled) return [];

            const startingSequence = Math.max(1, Number(config.nextSequence) || 1);
            const reservedConfig = {
                ...config,
                nextSequence: startingSequence + candidates.length,
            };
            await this.storage.setItem(CONFIG_KEY, reservedConfig);

            const changes = [];
            try {
                for (let index = 0; index < candidates.length; index += 1) {
                    const change = createSyncChange({
                        ...candidates[index],
                        changeId: candidates[index].changeId || this.uuid(),
                        deviceId: config.deviceId || this.uuid(),
                        sequence: startingSequence + index,
                        baseVersion: candidates[index].baseVersion
                            || `generation:${Math.max(
                                Number(config.lastPulledGeneration) || 0,
                                Number(config.lastPushedGeneration) || 0
                            )}`,
                        createdAt: candidates[index].createdAt || this.now(),
                    });
                    await this.storage.setItem(changeKey(change), {
                        status: 'pending',
                        change,
                    });
                    if (change.operation === SYNC_OPERATIONS.DELETE) {
                        await this.storage.setItem(tombstoneKey(change), {
                            entityType: change.entityType,
                            entityId: change.entityId,
                            changeId: change.changeId,
                            deviceId: change.deviceId,
                            sequence: change.sequence,
                            baseVersion: change.baseVersion,
                            deletedAt: change.createdAt,
                        });
                    }
                    changes.push(change);
                }
            } catch (error) {
                await this.storage.setItem(CONFIG_KEY, {
                    ...reservedConfig,
                    reconciliationRequired: true,
                    reconciliationReason: 'journal-write-failed',
                    reconciliationMarkedAt: this.now(),
                });
                throw error;
            }
            return changes;
        });
    }

    async listPendingChanges() {
        const records = [];
        await this.storage.iterate((value, key) => {
            if (String(key).startsWith(CHANGE_PREFIX) && value?.status === 'pending' && value.change) {
                records.push(value.change);
            }
        });
        return records.sort((left, right) => (
            left.sequence - right.sequence || left.changeId.localeCompare(right.changeId)
        ));
    }

    async getBootstrapSnapshot() {
        return this.storage.getItem(BOOTSTRAP_SNAPSHOT_KEY);
    }

    async saveBootstrapSnapshot(snapshot) {
        if (!snapshot?.descriptor || !(snapshot?.blob instanceof Blob)) {
            throw new Error('初回同期スナップショットの保存内容が不正です。');
        }
        await this.storage.setItem(BOOTSTRAP_SNAPSHOT_KEY, snapshot);
        return snapshot;
    }

    async clearBootstrapSnapshot() {
        await this.storage.removeItem(BOOTSTRAP_SNAPSHOT_KEY);
    }

    async acknowledgeChanges(changeIds, { committedGeneration = null } = {}) {
        const targets = new Set((changeIds || []).map(String));
        if (targets.size === 0) return 0;
        const removals = [];
        await this.storage.iterate((value, key) => {
            if (String(key).startsWith(CHANGE_PREFIX) && targets.has(String(value?.change?.changeId))) {
                removals.push({ key, change: value.change });
            }
        });
        if (Number.isSafeInteger(committedGeneration) && committedGeneration > 0) {
            await Promise.all(removals.map(({ change }) => (
                this.storage.setItem(`${SENT_PREFIX}${change.changeId}`, {
                    change,
                    committedGeneration,
                    acknowledgedAt: this.now(),
                })
            )));
        }
        await Promise.all(removals.map(({ key }) => this.storage.removeItem(key)));
        return removals.length;
    }

    async discardChanges(changeIds) {
        const targets = new Set((changeIds || []).map(String));
        if (targets.size === 0) return 0;
        const removals = [];
        await this.storage.iterate((value, key) => {
            const stringKey = String(key);
            if (
                stringKey.startsWith(CHANGE_PREFIX)
                && targets.has(String(value?.change?.changeId))
            ) {
                removals.push(key);
            } else if (
                stringKey.startsWith(TOMBSTONE_PREFIX)
                && targets.has(String(value?.changeId))
            ) {
                removals.push(key);
            }
        });
        await Promise.all(removals.map(key => this.storage.removeItem(key)));
        return removals.length;
    }

    async listSentChangesAfterGeneration(generation = 0) {
        const minimumGeneration = Number(generation) || 0;
        const changes = [];
        await this.storage.iterate((value, key) => {
            if (
                String(key).startsWith(SENT_PREFIX)
                && value?.change
                && Number(value.committedGeneration) > minimumGeneration
            ) {
                changes.push({
                    ...value.change,
                    committedGeneration: Number(value.committedGeneration),
                });
            }
        });
        return changes.sort((left, right) => (
            left.committedGeneration - right.committedGeneration
            || left.sequence - right.sequence
        ));
    }

    async hasAppliedBatch(batchId) {
        if (!batchId) return false;
        return Boolean(await this.storage.getItem(`${APPLIED_BATCH_PREFIX}${batchId}`));
    }

    async markBatchApplied(batch, appliedAt = this.now()) {
        if (!batch?.batchId) throw new Error('適用済みバッチにはbatchIdが必要です。');
        const key = `${APPLIED_BATCH_PREFIX}${batch.batchId}`;
        const existing = await this.storage.getItem(key);
        if (existing) return existing;
        const record = {
            batchId: String(batch.batchId),
            deviceId: String(batch.deviceId || ''),
            fromSequence: Number(batch.fromSequence) || 0,
            toSequence: Number(batch.toSequence) || 0,
            generation: Number(batch.generation) || 0,
            appliedAt,
        };
        await this.storage.setItem(key, record);
        return record;
    }

    async hasAppliedChange(changeId) {
        if (!changeId) return false;
        return Boolean(await this.storage.getItem(`${APPLIED_PREFIX}${String(changeId)}`));
    }

    async markChangeApplied(change, appliedAt = this.now()) {
        if (!change?.changeId) {
            throw new Error('適用済みとして記録する変更にはchangeIdが必要です。');
        }
        const key = `${APPLIED_PREFIX}${String(change.changeId)}`;
        const existing = await this.storage.getItem(key);
        if (existing) return existing;
        const record = {
            changeId: String(change.changeId),
            deviceId: String(change.deviceId || ''),
            sequence: Number(change.sequence) || 0,
            appliedAt,
        };
        await this.storage.setItem(key, record);
        return record;
    }

    async recordConflict(conflict) {
        if (!conflict?.conflictId) {
            throw new Error('競合の保存にはconflictIdが必要です。');
        }
        const key = `${CONFLICT_PREFIX}${String(conflict.conflictId)}`;
        const existing = await this.storage.getItem(key);
        if (existing) return existing;
        const record = {
            ...conflict,
            status: 'pending',
            detectedAt: conflict.detectedAt || this.now(),
        };
        await this.storage.setItem(key, record);
        return record;
    }

    async listConflicts({ status = 'pending' } = {}) {
        const conflicts = [];
        await this.storage.iterate((value, key) => {
            if (
                String(key).startsWith(CONFLICT_PREFIX)
                && value
                && (!status || value.status === status)
            ) {
                conflicts.push(value);
            }
        });
        return conflicts.sort((left, right) => (
            String(left.detectedAt).localeCompare(String(right.detectedAt))
            || String(left.conflictId).localeCompare(String(right.conflictId))
        ));
    }

    async resolveConflict(conflictId, resolution) {
        if (!conflictId || !resolution) {
            throw new Error('競合解決にはconflictIdとresolutionが必要です。');
        }
        const key = `${CONFLICT_PREFIX}${String(conflictId)}`;
        const conflict = await this.storage.getItem(key);
        if (!conflict) throw new Error('解決対象の競合が見つかりません。');
        if (conflict.status === 'resolved') return conflict;
        const resolved = {
            ...conflict,
            status: 'resolved',
            resolution,
            resolvedAt: this.now(),
        };
        await this.storage.setItem(key, resolved);
        return resolved;
    }

    async listTombstones() {
        const tombstones = [];
        await this.storage.iterate((value, key) => {
            if (String(key).startsWith(TOMBSTONE_PREFIX) && value) tombstones.push(value);
        });
        return tombstones.sort((left, right) => (
            String(left.deletedAt).localeCompare(String(right.deletedAt))
            || String(left.changeId).localeCompare(String(right.changeId))
        ));
    }
}
