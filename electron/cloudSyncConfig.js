const fs = require('fs');
const path = require('path');

const parseEnvText = text => {
  const values = {};
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
};

const readJsonConfig = configPath => {
  if (!fs.existsSync(configPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return {};
  }
};

const loadCloudSyncConfig = ({
  appPath,
  isPackaged,
  runtimeDirectory = __dirname,
  env = process.env,
}) => {
  const localEnvPath = path.join(appPath, '.env.local');
  const localEnv = !isPackaged && fs.existsSync(localEnvPath)
    ? parseEnvText(fs.readFileSync(localEnvPath, 'utf8'))
    : {};
  const packaged = isPackaged
    ? readJsonConfig(path.join(runtimeDirectory, 'cloud-sync-config.json'))
    : {};
  return {
    googleDesktopClientSecret: String(
      env.GOOGLE_DESKTOP_CLIENT_SECRET
      || localEnv.GOOGLE_DESKTOP_CLIENT_SECRET
      || packaged.googleDesktopClientSecret
      || ''
    ),
  };
};

module.exports = {
  loadCloudSyncConfig,
  parseEnvText,
};
