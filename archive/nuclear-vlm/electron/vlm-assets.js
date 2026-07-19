const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DISK_RESERVE_BYTES = 512 * 1024 * 1024;

function getBundleRoots(app, projectPath) {
  return {
    resourceRoot: app.isPackaged
      ? path.join(process.resourcesPath, 'vlm')
      : path.join(projectPath, 'resources', 'vlm'),
    userRoot: path.join(app.getPath('userData'), 'vlm')
  };
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function loadPinnedManifest(resourceRoot) {
  const manifest = readJson(path.join(resourceRoot, 'download-manifest.json'));
  if (!manifest) throw new Error('組み込みVLMのダウンロード定義がありません');
  if (!Array.isArray(manifest.models) || manifest.models.length === 0) {
    if (manifest.model) {
      manifest.models = [manifest.model];
      manifest.defaultModelId = manifest.model.id;
    } else {
      throw new Error('組み込みVLMモデルが定義されていません');
    }
  }
  return manifest;
}

function modelKey(modelId) {
  return String(modelId).replace(/[^a-zA-Z0-9._-]/g, '_');
}

function installationPath(userRoot, modelId) {
  return path.join(userRoot, 'installations', `${modelKey(modelId)}.json`);
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(filePath);
    input.on('data', chunk => hash.update(chunk));
    input.on('error', reject);
    input.on('end', () => resolve(hash.digest('hex')));
  });
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const error = new Error('Download paused');
  error.name = 'AbortError';
  throw error;
}

function getRuntimePath(resourceRoot, platformKey) {
  const executable = platformKey.startsWith('win32-') ? 'llama-server.exe' : 'llama-server';
  return path.join(resourceRoot, 'runtime', platformKey, executable);
}

function getFreeBytes(basePath) {
  try {
    const existingPath = fs.existsSync(basePath) ? basePath : path.dirname(basePath);
    const stats = fs.statfsSync(existingPath, { bigint: true });
    return Number(stats.bavail * stats.bsize);
  } catch {
    return null;
  }
}

function getInstallationState(userRoot, manifest, model) {
  const installation = readJson(installationPath(userRoot, model.id));
  if (!installation || installation.manifestVersion !== manifest.version || installation.modelId !== model.id) {
    return false;
  }

  return model.files.every(file => {
    const installed = installation.files?.find(entry => entry.name === file.name);
    const filePath = path.join(userRoot, 'models', file.name);
    return installed?.sha256 === file.sha256
      && fs.existsSync(filePath)
      && fs.statSync(filePath).size === file.size;
  });
}

function getSelectedModelId(userRoot, manifest) {
  const selection = readJson(path.join(userRoot, 'selection.json'));
  return manifest.models.some(model => model.id === selection?.modelId)
    ? selection.modelId
    : manifest.defaultModelId || manifest.models[0].id;
}

function getRemainingBytes(userRoot, model) {
  return model.files.reduce((total, file) => {
    const destination = path.join(userRoot, 'models', file.name);
    const partial = `${destination}.part`;
    if (fs.existsSync(destination) && fs.statSync(destination).size === file.size) return total;
    const partialBytes = fs.existsSync(partial) ? Math.min(fs.statSync(partial).size, file.size) : 0;
    return total + file.size - partialBytes;
  }, 0);
}

function getVlmInstallStatus({ app, projectPath }) {
  const { resourceRoot, userRoot } = getBundleRoots(app, projectPath);
  const manifest = loadPinnedManifest(resourceRoot);
  const platformKey = `${process.platform}-${process.arch}`;
  const platformSupported = Boolean(manifest.runtimes?.[platformKey]);
  const runtimeReady = platformSupported && fs.existsSync(getRuntimePath(resourceRoot, platformKey));
  const selectedModelId = getSelectedModelId(userRoot, manifest);
  const freeBytes = getFreeBytes(userRoot);
  const models = manifest.models.map(model => {
    const totalBytes = model.files.reduce((sum, file) => sum + file.size, 0);
    const remainingBytes = getRemainingBytes(userRoot, model);
    const requiredFreeBytes = remainingBytes + DISK_RESERVE_BYTES;
    const installed = getInstallationState(userRoot, manifest, model);
    const enoughSpace = freeBytes === null || freeBytes >= requiredFreeBytes;
    return {
      id: model.id,
      label: model.label || model.id,
      description: model.description || '',
      recommended: Boolean(model.recommended),
      totalBytes,
      remainingBytes,
      requiredFreeBytes,
      installed,
      selected: model.id === selectedModelId,
      canInstall: platformSupported && runtimeReady && !installed && enoughSpace,
      enoughSpace
    };
  });
  const selected = models.find(model => model.selected) || models[0];

  return {
    available: platformSupported,
    platformKey,
    runtimeVersion: manifest.runtimeVersion,
    runtimeReady,
    selectedModelId,
    freeBytes,
    diskReserveBytes: DISK_RESERVE_BYTES,
    models,
    modelId: selected?.id,
    modelInstalled: Boolean(selected?.installed),
    canInstall: Boolean(selected?.canInstall),
    totalBytes: selected?.totalBytes || 0,
    restartRequired: false,
    message: !platformSupported
      ? `この環境（${platformKey}）向けの組み込みVLMは未対応です`
      : !runtimeReady
        ? '組み込みVLMランタイムがこのビルドに含まれていません'
        : selected?.installed
          ? `${selected.label}を使用します`
          : '利用するモデルを取得してください'
  };
}

async function downloadFile(file, destination, onProgress, completedBefore, totalBytes, modelId, signal, retry = true) {
  const partialPath = `${destination}.part`;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  let existingBytes = fs.existsSync(partialPath) ? fs.statSync(partialPath).size : 0;
  if (existingBytes > file.size) {
    fs.truncateSync(partialPath, 0);
    existingBytes = 0;
  }

  const headers = existingBytes > 0 ? { Range: `bytes=${existingBytes}-` } : {};
  const response = await fetch(file.url, { headers, redirect: 'follow', signal });
  if (response.status === 416 && retry) {
    fs.rmSync(partialPath, { force: true });
    return downloadFile(file, destination, onProgress, completedBefore, totalBytes, modelId, signal, false);
  }
  if (!response.ok) throw new Error(`${file.name}の取得に失敗しました（HTTP ${response.status}）`);

  const resumed = existingBytes > 0 && response.status === 206;
  if (!resumed) existingBytes = 0;
  const output = fs.createWriteStream(partialPath, { flags: resumed ? 'a' : 'w' });
  let downloaded = existingBytes;

  try {
    for await (const chunk of response.body) {
      throwIfAborted(signal);
      if (!output.write(chunk)) await new Promise(resolve => output.once('drain', resolve));
      downloaded += chunk.length;
      onProgress?.({ state: 'downloading', modelId, file: file.name, downloadedBytes: completedBefore + downloaded, totalBytes });
    }
  } finally {
    await new Promise(resolve => output.end(resolve));
  }

  throwIfAborted(signal);
  if (fs.statSync(partialPath).size !== file.size) throw new Error(`${file.name}のサイズが一致しません`);
  onProgress?.({ state: 'verifying', modelId, file: file.name, downloadedBytes: completedBefore + file.size, totalBytes });
  const actualHash = await hashFile(partialPath);
  throwIfAborted(signal);
  if (actualHash !== file.sha256) {
    fs.rmSync(partialPath, { force: true });
    throw new Error(`${file.name}のSHA-256検証に失敗しました`);
  }
  fs.renameSync(partialPath, destination);
}

async function installPinnedVlmModel({ app, projectPath, modelId, onProgress, signal }) {
  const { resourceRoot, userRoot } = getBundleRoots(app, projectPath);
  const manifest = loadPinnedManifest(resourceRoot);
  const model = manifest.models.find(entry => entry.id === modelId);
  if (!model) throw new Error(`不明なVLMモデルです: ${modelId}`);
  const initialStatus = getVlmInstallStatus({ app, projectPath });
  if (!initialStatus.runtimeReady) throw new Error(initialStatus.message);
  const initialModel = initialStatus.models.find(entry => entry.id === modelId);
  if (initialModel.installed) return initialStatus;
  if (!initialModel.enoughSpace) {
    throw new Error(`空き容量が不足しています。少なくとも${Math.ceil(initialModel.requiredFreeBytes / 1_000_000_000 * 10) / 10}GB必要です`);
  }

  const totalBytes = model.files.reduce((sum, file) => sum + file.size, 0);
  let completedBytes = 0;
  try {
    for (const file of model.files) {
      const destination = path.join(userRoot, 'models', file.name);
      if (fs.existsSync(destination) && fs.statSync(destination).size === file.size) {
        onProgress?.({ state: 'verifying', modelId, file: file.name, downloadedBytes: completedBytes + file.size, totalBytes });
        if (await hashFile(destination) === file.sha256) {
          completedBytes += file.size;
          continue;
        }
        fs.rmSync(destination, { force: true });
      }
      await downloadFile(file, destination, onProgress, completedBytes, totalBytes, modelId, signal);
      completedBytes += file.size;
    }
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') {
      onProgress?.({ state: 'paused', modelId, downloadedBytes: completedBytes, totalBytes });
      return { ...getVlmInstallStatus({ app, projectPath }), pausedModelId: modelId, message: 'ダウンロードを一時停止しました' };
    }
    throw error;
  }

  throwIfAborted(signal);
  writeJson(installationPath(userRoot, model.id), {
    manifestVersion: manifest.version,
    runtimeVersion: manifest.runtimeVersion,
    modelId: model.id,
    installedAt: new Date().toISOString(),
    files: model.files.map(({ name, sha256, size }) => ({ name, sha256, size }))
  });
  const autoSelected = !fs.existsSync(path.join(userRoot, 'selection.json'));
  if (autoSelected) {
    writeJson(path.join(userRoot, 'selection.json'), { modelId: model.id });
  }
  onProgress?.({ state: 'complete', modelId, downloadedBytes: totalBytes, totalBytes });
  return { ...getVlmInstallStatus({ app, projectPath }), restartRequired: autoSelected, message: `${model.label || model.id}をインストールしました` };
}

function selectPinnedVlmModel({ app, projectPath, modelId }) {
  const { resourceRoot, userRoot } = getBundleRoots(app, projectPath);
  const manifest = loadPinnedManifest(resourceRoot);
  const model = manifest.models.find(entry => entry.id === modelId);
  if (!model || !getInstallationState(userRoot, manifest, model)) throw new Error('インストール済みのモデルだけを選択できます');
  writeJson(path.join(userRoot, 'selection.json'), { modelId });
  return { ...getVlmInstallStatus({ app, projectPath }), restartRequired: true, message: `${model.label || model.id}へ切り替えます` };
}

function removePinnedVlmModel({ app, projectPath, modelId }) {
  const { resourceRoot, userRoot } = getBundleRoots(app, projectPath);
  const manifest = loadPinnedManifest(resourceRoot);
  const model = manifest.models.find(entry => entry.id === modelId);
  if (!model) throw new Error(`不明なVLMモデルです: ${modelId}`);
  const wasSelected = getSelectedModelId(userRoot, manifest) === modelId;
  for (const file of model.files) {
    fs.rmSync(path.join(userRoot, 'models', file.name), { force: true });
    fs.rmSync(path.join(userRoot, 'models', `${file.name}.part`), { force: true });
  }
  fs.rmSync(installationPath(userRoot, model.id), { force: true });
  if (wasSelected) {
    const fallback = manifest.models.find(entry => entry.id !== modelId && getInstallationState(userRoot, manifest, entry));
    if (fallback) writeJson(path.join(userRoot, 'selection.json'), { modelId: fallback.id });
    else fs.rmSync(path.join(userRoot, 'selection.json'), { force: true });
  }
  return { ...getVlmInstallStatus({ app, projectPath }), restartRequired: wasSelected, message: `${model.label || model.id}を削除しました` };
}

module.exports = {
  getVlmInstallStatus,
  installPinnedVlmModel,
  pausePinnedVlmModelDownload: controller => controller?.abort(),
  removePinnedVlmModel,
  selectPinnedVlmModel
};
