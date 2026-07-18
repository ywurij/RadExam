import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const bundleRoot = path.join(root, 'resources', 'vlm');
const manifest = JSON.parse(fs.readFileSync(path.join(bundleRoot, 'download-manifest.json'), 'utf8'));
const platformKey = process.env.VLM_TARGET || `${process.platform}-${process.arch}`;
const runtime = manifest.runtimes[platformKey];

if (!runtime) {
    throw new Error(`No pinned VLM runtime for ${platformKey}`);
}

const archiveName = new URL(runtime.url).pathname.split('/').at(-1);
const archiveCandidates = [
    process.env.VLM_RUNTIME_ARCHIVE,
    path.join(os.tmpdir(), archiveName),
    process.platform === 'win32' ? null : path.join('/tmp', archiveName)
].filter(Boolean);
const archivePath = archiveCandidates.find(candidate => fs.existsSync(candidate))
    || archiveCandidates[0];
const destination = path.join(bundleRoot, 'runtime', platformKey);

const sha256 = filePath => new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
});

if (!fs.existsSync(archivePath) || await sha256(archivePath) !== runtime.sha256) {
    console.log(`Downloading llama.cpp ${manifest.runtimeVersion} for ${platformKey}...`);
    const response = await fetch(runtime.url, { redirect: 'follow' });
    if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}`);
    const output = fs.createWriteStream(`${archivePath}.part`);
    for await (const chunk of response.body) output.write(chunk);
    await new Promise((resolve, reject) => output.end(error => error ? reject(error) : resolve()));
    fs.renameSync(`${archivePath}.part`, archivePath);
}

const actualHash = await sha256(archivePath);
if (actualHash !== runtime.sha256) {
    throw new Error(`Runtime SHA-256 mismatch: expected ${runtime.sha256}, received ${actualHash}`);
}

fs.mkdirSync(destination, { recursive: true });
const args = ['-xf', archivePath, '-C', destination];
if (runtime.archiveRoot) args.push('--strip-components', '1');
const extraction = spawnSync('tar', args, { stdio: 'inherit' });
if (extraction.status !== 0) throw new Error(`tar exited with status ${extraction.status}`);

const executable = path.join(destination, platformKey.startsWith('win32-') ? 'llama-server.exe' : 'llama-server');
if (!fs.existsSync(executable)) throw new Error(`llama-server was not found after extraction: ${executable}`);
if (!platformKey.startsWith('win32-')) fs.chmodSync(executable, 0o755);

fs.writeFileSync(path.join(destination, 'installation.json'), `${JSON.stringify({
    runtimeVersion: manifest.runtimeVersion,
    platformKey,
    archive: archiveName,
    archiveSha256: runtime.sha256,
    preparedAt: new Date().toISOString()
}, null, 2)}\n`);

console.log(`Prepared ${path.relative(root, executable)}`);
