import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    getVlmInstallStatus,
    installPinnedVlmModel,
    removePinnedVlmModel,
    selectPinnedVlmModel
} = require('../electron/vlm-assets.js');

function createFixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'radexam-vlm-assets-'));
    const projectPath = path.join(root, 'project');
    const userData = path.join(root, 'user-data');
    const resourceRoot = path.join(projectPath, 'resources', 'vlm');
    const platformKey = `${process.platform}-${process.arch}`;
    const runtimeName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
    const files = [
        { role: 'model', name: 'model.gguf', size: 5, sha256: 'model-hash', url: 'https://example.invalid/model' },
        { role: 'projector', name: 'mmproj.gguf', size: 4, sha256: 'projector-hash', url: 'https://example.invalid/mmproj' }
    ];
    const secondFiles = [
        { role: 'model', name: 'model-4b.gguf', size: 8, sha256: 'model-4b-hash', url: 'https://example.invalid/model-4b' },
        { role: 'projector', name: 'mmproj-4b.gguf', size: 6, sha256: 'projector-4b-hash', url: 'https://example.invalid/mmproj-4b' }
    ];

    fs.mkdirSync(path.join(resourceRoot, 'runtime', platformKey), { recursive: true });
    fs.writeFileSync(path.join(resourceRoot, 'runtime', platformKey, runtimeName), 'runtime');
    fs.writeFileSync(path.join(resourceRoot, 'download-manifest.json'), JSON.stringify({
        version: 2,
        runtimeVersion: 'test-runtime',
        runtimes: { [platformKey]: { url: 'https://example.invalid/runtime' } },
        defaultModelId: 'test-model-2b',
        models: [
            { id: 'test-model-2b', label: 'Test 2B', recommended: true, files },
            { id: 'test-model-4b', label: 'Test 4B', files: secondFiles }
        ]
    }));

    const app = {
        isPackaged: false,
        getPath(name) {
            assert.equal(name, 'userData');
            return userData;
        }
    };
    return { root, projectPath, userData, app, files, secondFiles };
}

test('reports a prepared runtime as ready for first model install', () => {
    const fixture = createFixture();
    try {
        const status = getVlmInstallStatus(fixture);
        assert.equal(status.runtimeReady, true);
        assert.equal(status.modelInstalled, false);
        assert.equal(status.canInstall, true);
        assert.equal(status.totalBytes, 9);
        assert.equal(status.selectedModelId, 'test-model-2b');
        assert.equal(status.models.length, 2);
        assert.equal(status.models[1].totalBytes, 14);
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
});

test('recognizes and removes a verified model installation', () => {
    const fixture = createFixture();
    try {
        const modelRoot = path.join(fixture.userData, 'vlm', 'models');
        fs.mkdirSync(modelRoot, { recursive: true });
        fs.writeFileSync(path.join(modelRoot, fixture.files[0].name), '12345');
        fs.writeFileSync(path.join(modelRoot, fixture.files[1].name), '1234');
        const receipt = path.join(fixture.userData, 'vlm', 'installations', 'test-model-2b.json');
        fs.mkdirSync(path.dirname(receipt), { recursive: true });
        fs.writeFileSync(receipt, JSON.stringify({
            manifestVersion: 2,
            modelId: 'test-model-2b',
            files: fixture.files.map(({ name, size, sha256 }) => ({ name, size, sha256 }))
        }));

        assert.equal(getVlmInstallStatus(fixture).modelInstalled, true);
        const removed = removePinnedVlmModel({ ...fixture, modelId: 'test-model-2b' });
        assert.equal(removed.modelInstalled, false);
        assert.equal(removed.canInstall, true);
        assert.equal(fs.existsSync(receipt), false);
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
});

test('downloads pinned files and activates them only after hash verification', async () => {
    const fixture = createFixture();
    const originalFetch = globalThis.fetch;
    const payloads = new Map([
        ['https://local.test/model', Buffer.from('model')],
        ['https://local.test/mmproj', Buffer.from('view')]
    ]);
    globalThis.fetch = async url => {
        const payload = payloads.get(String(url));
        return payload ? new Response(payload) : new Response(null, { status: 404 });
    };

    try {
        const manifestPath = path.join(fixture.projectPath, 'resources', 'vlm', 'download-manifest.json');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        manifest.models[0].files = [
            { role: 'model', name: 'model.gguf', url: 'https://local.test/model', ...fileIdentity(payloads.get('https://local.test/model')) },
            { role: 'projector', name: 'mmproj.gguf', url: 'https://local.test/mmproj', ...fileIdentity(payloads.get('https://local.test/mmproj')) }
        ];
        fs.writeFileSync(manifestPath, JSON.stringify(manifest));

        const progress = [];
        const status = await installPinnedVlmModel({
            ...fixture,
            modelId: 'test-model-2b',
            onProgress: event => progress.push(event.state)
        });

        assert.equal(status.modelInstalled, true);
        assert.equal(status.restartRequired, true);
        assert.equal(progress.at(-1), 'complete');
        assert.equal(fs.readFileSync(path.join(fixture.userData, 'vlm', 'models', 'model.gguf'), 'utf8'), 'model');
    } finally {
        globalThis.fetch = originalFetch;
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
});

test('switches between installed models and requires a restart', () => {
    const fixture = createFixture();
    try {
        const modelRoot = path.join(fixture.userData, 'vlm', 'models');
        const receiptRoot = path.join(fixture.userData, 'vlm', 'installations');
        fs.mkdirSync(modelRoot, { recursive: true });
        fs.mkdirSync(receiptRoot, { recursive: true });
        for (const [modelId, files] of [['test-model-2b', fixture.files], ['test-model-4b', fixture.secondFiles]]) {
            for (const file of files) fs.writeFileSync(path.join(modelRoot, file.name), 'x'.repeat(file.size));
            fs.writeFileSync(path.join(receiptRoot, `${modelId}.json`), JSON.stringify({
                manifestVersion: 2,
                modelId,
                files: files.map(({ name, size, sha256 }) => ({ name, size, sha256 }))
            }));
        }

        const status = selectPinnedVlmModel({ ...fixture, modelId: 'test-model-4b' });
        assert.equal(status.selectedModelId, 'test-model-4b');
        assert.equal(status.restartRequired, true);
        assert.equal(status.models.find(model => model.id === 'test-model-4b').selected, true);
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
});

test('pauses an active download and keeps the partial file for resume', async () => {
    const fixture = createFixture();
    const originalFetch = globalThis.fetch;
    const payload = Buffer.from('abcdefghij');
    const controller = new AbortController();
    globalThis.fetch = async () => new Response(new ReadableStream({
        start(streamController) {
            streamController.enqueue(payload.subarray(0, 5));
            setTimeout(() => {
                streamController.enqueue(payload.subarray(5));
                streamController.close();
            }, 5);
        }
    }));

    try {
        const manifestPath = path.join(fixture.projectPath, 'resources', 'vlm', 'download-manifest.json');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        manifest.models[0].files[0] = {
            role: 'model',
            name: 'pausable.gguf',
            url: 'https://local.test/pausable',
            ...fileIdentity(payload)
        };
        fs.writeFileSync(manifestPath, JSON.stringify(manifest));

        const status = await installPinnedVlmModel({
            ...fixture,
            modelId: 'test-model-2b',
            signal: controller.signal,
            onProgress: event => {
                if (event.state === 'downloading') controller.abort();
            }
        });

        const partial = path.join(fixture.userData, 'vlm', 'models', 'pausable.gguf.part');
        assert.equal(status.pausedModelId, 'test-model-2b');
        assert.equal(fs.statSync(partial).size, 5);
        assert.equal(status.models[0].remainingBytes, 9);
    } finally {
        globalThis.fetch = originalFetch;
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
});

function fileIdentity(payload) {
    return {
        size: payload.length,
        sha256: crypto.createHash('sha256').update(payload).digest('hex')
    };
}
