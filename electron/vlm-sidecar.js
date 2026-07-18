const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const DEFAULT_PORT = 11435;

function findFreePort(startPort) {
  return new Promise((resolve) => {
    const server = http.createServer();
    server.listen(startPort, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', () => resolve(findFreePort(startPort + 1)));
  });
}

function readManifest(filePath, log) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    log(`Invalid VLM manifest at ${filePath}: ${error.message}`);
    return null;
  }
}

function resolveAsset(relativeOrAbsolutePath, roots) {
  if (!relativeOrAbsolutePath) return null;
  if (path.isAbsolute(relativeOrAbsolutePath)) {
    return fs.existsSync(relativeOrAbsolutePath) ? relativeOrAbsolutePath : null;
  }
  for (const root of roots) {
    const candidate = path.join(root, relativeOrAbsolutePath);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function buildEnvironment(baseUrl, model) {
  return {
    NUCLEAR_VLM_PROVIDER: 'embedded',
    NUCLEAR_VLM_EMBEDDED_URL: baseUrl,
    NUCLEAR_VLM_EMBEDDED_MODEL: model,
    NUCLEAR_VLM_EMBEDDED_MANAGED: '1'
  };
}

function modelKey(modelId) {
  return String(modelId).replace(/[^a-zA-Z0-9._-]/g, '_');
}

function getSelectedModel(userRoot, resourceRoot, manifest) {
  const pinned = readManifest(path.join(resourceRoot, 'download-manifest.json'), () => {});
  const selection = readManifest(path.join(userRoot, 'selection.json'), () => {});
  const defaultModelId = manifest.defaultModelId || manifest.model?.id || pinned?.defaultModelId || pinned?.models?.[0]?.id;
  const requestedModelId = process.env.NUCLEAR_VLM_MODEL || selection?.modelId || defaultModelId;
  const config = manifest.models?.[requestedModelId]
    || (manifest.model?.id === requestedModelId ? manifest.model : null);
  return config ? { id: requestedModelId, config } : null;
}

function isVerifiedUserModel(userRoot, resourceRoot, modelId, modelPath, projectorPath) {
  if (!modelPath.startsWith(`${userRoot}${path.sep}`) && !projectorPath.startsWith(`${userRoot}${path.sep}`)) {
    return true;
  }
  const installation = readManifest(path.join(userRoot, 'installations', `${modelKey(modelId)}.json`), () => {});
  const pinned = readManifest(path.join(resourceRoot, 'download-manifest.json'), () => {});
  if (!installation || !pinned) return false;
  if (installation.manifestVersion !== pinned.version || installation.modelId !== modelId) return false;
  const pinnedModel = pinned.models?.find(model => model.id === modelId) || pinned.model;
  return pinnedModel?.files?.every(file => (
    installation.files?.some(entry => entry.name === file.name && entry.sha256 === file.sha256 && entry.size === file.size)
  ));
}

async function startEmbeddedVlm({ app, projectPath }) {
  if (process.env.NUCLEAR_VLM_PROVIDER === 'ollama') return null;

  if (process.env.NUCLEAR_VLM_EMBEDDED_URL) {
    return {
      process: null,
      env: {
        NUCLEAR_VLM_PROVIDER: 'embedded',
        NUCLEAR_VLM_EMBEDDED_URL: process.env.NUCLEAR_VLM_EMBEDDED_URL,
        NUCLEAR_VLM_EMBEDDED_MODEL: process.env.NUCLEAR_VLM_EMBEDDED_MODEL
          || process.env.NUCLEAR_VLM_MODEL
          || 'qwen3-vl:2b-instruct',
        NUCLEAR_VLM_EMBEDDED_MANAGED: '0'
      }
    };
  }

  const logPath = path.join(app.getPath('userData'), 'radexam-vlm.log');
  const logStream = fs.createWriteStream(logPath, { flags: 'w' });
  const log = message => logStream.write(`${message}\n`);
  const resourceRoot = app.isPackaged
    ? path.join(process.resourcesPath, 'vlm')
    : path.join(projectPath, 'resources', 'vlm');
  const userRoot = path.join(app.getPath('userData'), 'vlm');
  const roots = [userRoot, resourceRoot];
  const manifest = readManifest(path.join(userRoot, 'manifest.json'), log)
    || readManifest(path.join(resourceRoot, 'manifest.json'), log);

  if (!manifest) {
    log('No embedded VLM manifest found; using the configured external provider.');
    logStream.end();
    if (process.env.NUCLEAR_VLM_PROVIDER === 'embedded') {
      return {
        process: null,
        env: buildEnvironment(`http://127.0.0.1:${DEFAULT_PORT}`, process.env.NUCLEAR_VLM_MODEL || 'qwen3-vl:2b-instruct')
      };
    }
    return null;
  }

  const platformKey = `${process.platform}-${process.arch}`;
  const runtimePath = resolveAsset(
    process.env.NUCLEAR_VLM_RUNTIME_PATH || manifest.runtimes?.[platformKey],
    roots
  );
  const selectedModel = getSelectedModel(userRoot, resourceRoot, manifest);
  const modelId = selectedModel?.id || 'qwen3-vl:2b-instruct';
  let modelPath = resolveAsset(process.env.NUCLEAR_VLM_MODEL_PATH || selectedModel?.config.file, roots);
  let projectorPath = resolveAsset(process.env.NUCLEAR_VLM_PROJECTOR_PATH || selectedModel?.config.projector, roots);

  if (modelPath && projectorPath && !isVerifiedUserModel(userRoot, resourceRoot, modelId, modelPath, projectorPath)) {
    log('User VLM model files are not backed by a verified installation record.');
    modelPath = null;
    projectorPath = null;
  }

  if (!runtimePath || !modelPath || !projectorPath) {
    log(`Embedded VLM assets are incomplete for ${platformKey}.`);
    log(`runtime=${runtimePath || 'missing'} model=${modelPath || 'missing'} projector=${projectorPath || 'missing'}`);
    logStream.end();
    return null;
  }

  const port = await findFreePort(Number(process.env.NUCLEAR_VLM_EMBEDDED_PORT) || DEFAULT_PORT);
  const args = [
    '--model', modelPath,
    '--mmproj', projectorPath,
    '--alias', modelId,
    '--host', '127.0.0.1',
    '--port', String(port),
    '--ctx-size', String(manifest.contextSize || 8192),
    '--jinja',
    ...(Array.isArray(manifest.arguments) ? manifest.arguments.map(String) : [])
  ];

  log(`Starting embedded VLM: ${runtimePath}`);
  log(`Platform: ${platformKey}`);
  log(`Model: ${modelId}`);
  log(`Port: ${port}`);

  const child = spawn(runtimePath, args, {
    cwd: path.dirname(runtimePath),
    env: { ...process.env },
    windowsHide: true
  });
  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);
  child.on('error', error => log(`Embedded VLM spawn error: ${error.message}`));
  child.on('exit', (code, signal) => {
    log(`Embedded VLM exited: code=${code}, signal=${signal}`);
    logStream.end();
  });

  return {
    process: child,
    env: buildEnvironment(`http://127.0.0.1:${port}`, modelId)
  };
}

module.exports = { startEmbeddedVlm };
