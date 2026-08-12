const path = require('path');

const LOOPBACK_HOST = '127.0.0.1';
const ANSI_ESCAPE_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/g;

function isNextServerReadyOutput(value) {
  const normalized = String(value || '').replace(ANSI_ESCAPE_PATTERN, ' ');
  return /(?:^|\s)Ready in\s+\d/i.test(normalized);
}

function isAllowedLoopbackRequest({ hostHeader, port }) {
  return Number.isInteger(port)
    && port > 0
    && String(hostHeader || '').toLowerCase() === `${LOOPBACK_HOST}:${port}`;
}

function createNextServerLaunch({ execPath, projectPath, port, isDev }) {
  if (!execPath || !projectPath || !Number.isInteger(port) || port < 1) {
    throw new Error('Invalid Next.js server launch configuration');
  }

  if (isDev) {
    return {
      command: execPath,
      args: [
        path.join(projectPath, 'node_modules', 'next', 'dist', 'bin', 'next'),
        'dev',
        '--webpack',
        '-p',
        String(port),
        '--hostname',
        LOOPBACK_HOST,
      ],
    };
  }

  return {
    command: execPath,
    args: [path.join(projectPath, 'server.js')],
  };
}

function createNextServerEnv({ baseEnv = {}, extraEnv = {}, port, isDev }) {
  const env = {
    ...baseEnv,
    ...extraEnv,
    ELECTRON_RUN_AS_NODE: '1',
    APP_TARGET: 'desktop',
    NODE_ENV: isDev ? 'development' : 'production',
    HOSTNAME: LOOPBACK_HOST,
    PORT: String(port),
  };

  if (isDev) {
    env.RADEXAM_NEXT_DIST_DIR = '.next-electron-dev';
  }

  return env;
}

module.exports = {
  LOOPBACK_HOST,
  createNextServerEnv,
  createNextServerLaunch,
  isAllowedLoopbackRequest,
  isNextServerReadyOutput,
};
