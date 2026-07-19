import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const bundleRoot = path.join(root, 'resources', 'vlm');
const manifestPath = path.join(bundleRoot, 'manifest.json');
const downloadManifestPath = path.join(bundleRoot, 'download-manifest.json');

const fail = message => {
    console.error(`VLM bundle verification failed: ${message}`);
    process.exitCode = 1;
};

if (!fs.existsSync(manifestPath) || !fs.existsSync(downloadManifestPath)) {
    fail('manifest.json or download-manifest.json is missing');
} else {
    let manifest;
    let downloadManifest;
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        downloadManifest = JSON.parse(fs.readFileSync(downloadManifestPath, 'utf8'));
    } catch (error) {
        fail(`invalid manifest JSON: ${error.message}`);
    }

    if (manifest && downloadManifest) {
        const platformKey = process.env.VLM_TARGET || `${process.platform}-${process.arch}`;
        const relativePath = manifest.runtimes?.[platformKey];
        const pinnedRuntime = downloadManifest.runtimes?.[platformKey];
        if (!relativePath || !pinnedRuntime) {
            fail(`runtime is not configured for ${platformKey}`);
        } else {
            const absolutePath = path.resolve(bundleRoot, relativePath);
            const receipt = path.join(path.dirname(absolutePath), 'installation.json');
            if (!absolutePath.startsWith(`${bundleRoot}${path.sep}`)) {
                fail(`runtime escapes the bundle directory: ${relativePath}`);
            } else if (!fs.existsSync(absolutePath) || !fs.existsSync(receipt)) {
                fail(`prepared runtime is missing: run npm run vlm:prepare-runtime`);
            } else {
                const installation = JSON.parse(fs.readFileSync(receipt, 'utf8'));
                if (installation.runtimeVersion !== downloadManifest.runtimeVersion
                    || installation.platformKey !== platformKey
                    || installation.archiveSha256 !== pinnedRuntime.sha256) {
                    fail('prepared runtime does not match the pinned release');
                } else {
                    const sizeKb = fs.statSync(absolutePath).size / 1024;
                    console.log(`ok runtime executable: ${relativePath} (${sizeKb.toFixed(1)} KB, ${downloadManifest.runtimeVersion})`);
                }
            }
        }

        const downloadableModels = Array.isArray(downloadManifest.models) ? downloadManifest.models : [downloadManifest.model].filter(Boolean);
        for (const model of downloadableModels) {
            const roles = new Set(model.files?.map(file => file.role));
            if (!manifest.models?.[model.id] || !roles.has('model') || !roles.has('projector')) {
                fail(`model manifest does not match the pinned download definition: ${model.id}`);
            }
        }

        if (!process.exitCode) {
            console.log(`Embedded VLM runtime is ready for ${platformKey}; model files will be downloaded on first use.`);
        }
    }
}
