const fs = require('fs');
const path = require('path');

const DEFAULT_ZOOM_FACTOR = 1;
const MIN_ZOOM_FACTOR = 0.75;
const MAX_ZOOM_FACTOR = 1.5;
const SETTINGS_FILE_NAME = 'display-settings.json';

const normalizeZoomFactor = value => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_ZOOM_FACTOR;
  return Math.round(Math.min(MAX_ZOOM_FACTOR, Math.max(MIN_ZOOM_FACTOR, numeric)) * 100) / 100;
};

const getSettingsPath = userDataPath => path.join(userDataPath, SETTINGS_FILE_NAME);

const loadZoomFactor = userDataPath => {
  try {
    const settings = JSON.parse(fs.readFileSync(getSettingsPath(userDataPath), 'utf8'));
    return normalizeZoomFactor(settings.zoomFactor);
  } catch {
    return DEFAULT_ZOOM_FACTOR;
  }
};

const saveZoomFactor = (userDataPath, value) => {
  const zoomFactor = normalizeZoomFactor(value);
  fs.mkdirSync(userDataPath, { recursive: true });
  fs.writeFileSync(getSettingsPath(userDataPath), `${JSON.stringify({ zoomFactor }, null, 2)}\n`, 'utf8');
  return zoomFactor;
};

module.exports = {
  DEFAULT_ZOOM_FACTOR,
  MAX_ZOOM_FACTOR,
  MIN_ZOOM_FACTOR,
  loadZoomFactor,
  normalizeZoomFactor,
  saveZoomFactor,
};
