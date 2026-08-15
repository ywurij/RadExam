const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  safeStorage,
  shell,
} = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');
const {
  LOOPBACK_HOST,
  createNextServerEnv,
  createNextServerLaunch,
  isAllowedLoopbackRequest,
  isNextServerReadyOutput,
} = require('./serverCommand');
const { GoogleDesktopOAuthManager } = require('./googleDesktopOAuth');
const { MicrosoftDesktopOAuthManager } = require('./microsoftDesktopOAuth');
const { loadCloudSyncConfig } = require('./cloudSyncConfig');
const { performCloudSyncFetch } = require('./cloudSyncFetch');
const {
  DEFAULT_ZOOM_FACTOR,
  loadZoomFactor,
  saveZoomFactor,
} = require('./displayZoom');
const {
  normalizeGoogleClientId,
  normalizeMicrosoftClientId,
} = require('./oauthClientId');
const {
  APPLICATION_NAME,
  installMacApplicationMenu,
  setApplicationProcessName,
} = require('./applicationIdentity');

// 表示名を変更しても既存の試験・画像・進捗を失わないよう、保存先は旧版と共通にする。
app.setPath('userData', path.join(app.getPath('appData'), 'exam-app'));
app.setName(APPLICATION_NAME);
setApplicationProcessName(process);

let nextProcess = null;
let embeddedNextServer = null;
let mainWindow = null;
let serverPort = 3000;
let googleOAuthManager = null;
let microsoftOAuthManager = null;
let cloudSyncConfig = null;
let displayZoomFactor = DEFAULT_ZOOM_FACTOR;
let applicationIsQuitting = false;

const SERVER_STARTUP_TIMEOUT_MS = 60_000;

const ensureMainWindowSender = event => {
  const expectedOrigin = `http://${LOOPBACK_HOST}:${serverPort}`;
  let senderOrigin = '';
  try {
    senderOrigin = new URL(event.senderFrame?.url || event.sender.getURL()).origin;
  } catch {
    senderOrigin = '';
  }
  if (!mainWindow || event.sender !== mainWindow.webContents || senderOrigin !== expectedOrigin) {
    throw new Error('許可されていないアプリ操作です。');
  }
};

// 未使用の空きポートを探索してポート衝突を回避
function findFreePort(startPort, callback) {
  const server = http.createServer();
  server.listen(startPort, LOOPBACK_HOST, () => {
    server.once('close', () => {
      callback(startPort);
    });
    server.close();
  });
  server.on('error', () => {
    findFreePort(startPort + 1, callback);
  });
}

// Next.js サーバーの起動
function startNextServer(port, extraEnv = {}) {
  const isDev = !app.isPackaged;
  const projectPath = app.getAppPath();
  
  // GUI起動時の調査ログは、インストール先ではなくOS管理のアプリ用データ領域へ保存する。
  const logDirectory = app.getPath('userData');
  fs.mkdirSync(logDirectory, { recursive: true });
  const logFile = path.join(logDirectory, 'server.log');
  const logStream = fs.createWriteStream(logFile, { flags: 'w' });
  
  logStream.write(`=== Server Start Attempt at ${new Date().toISOString()} ===\n`);
  logStream.write(`Project Path: ${projectPath}\n`);
  logStream.write(`Is Packaged: ${app.isPackaged}\n`);
  logStream.write(`Platform: ${process.platform}\n`);

  // Electron同梱のNode.jsランタイムを使用し、利用者端末のnodeやシェルに依存しない。
  // 引数配列で起動するため、インストール先のパスに空白があっても安全に扱える。
  const { command, args } = createNextServerLaunch({
    execPath: process.execPath,
    projectPath,
    port,
    isDev,
  });
  
  logStream.write(`Running Command: ${command} ${args.join(' ')}\n\n`);

  nextProcess = spawn(command, args, {
    cwd: projectPath,
    env: createNextServerEnv({
      baseEnv: process.env,
      extraEnv,
      port,
      isDev,
    }),
  });
  
  nextProcess.stdout.pipe(logStream);
  nextProcess.stderr.pipe(logStream);

  return new Promise((resolve, reject) => {
    let startupOutput = '';
    let startupComplete = false;
    const startupTimer = setTimeout(() => {
      if (startupComplete) return;
      startupComplete = true;
      reject(new Error('アプリ内サーバーの起動確認がタイムアウトしました。'));
      nextProcess?.kill('SIGTERM');
    }, SERVER_STARTUP_TIMEOUT_MS);

    const rejectStartup = error => {
      if (startupComplete) return;
      startupComplete = true;
      clearTimeout(startupTimer);
      reject(error);
    };

    nextProcess.stdout.on('data', chunk => {
      if (startupComplete) return;
      startupOutput = `${startupOutput}${chunk.toString('utf8')}`.slice(-8192);
      if (isNextServerReadyOutput(startupOutput)) {
        startupComplete = true;
        clearTimeout(startupTimer);
        resolve();
      }
    });

    nextProcess.once('error', err => {
      logStream.write(`[Spawn Error] ${err.message}\n`);
      rejectStartup(new Error(`アプリ内サーバーを起動できませんでした: ${err.message}`));
    });

    nextProcess.once('exit', (code, signal) => {
      logStream.write(`[Process Exit] code: ${code}, signal: ${signal}\n`);
      rejectStartup(new Error(`アプリ内サーバーが起動前に終了しました（code=${code}, signal=${signal}）。`));
      nextProcess = null;

      // 起動後にサーバーが失われた場合、同じポートへ別プロセスが入っても
      // Electronがその内容を読み込まないよう、画面を即座に閉じる。
      if (startupComplete && !applicationIsQuitting) {
        mainWindow?.destroy();
        mainWindow = null;
        app.quit();
      }
    });
  });
}

async function startPackagedNextServer() {
  const projectPath = app.getAppPath();
  const requiredFilesPath = path.join(projectPath, '.next', 'required-server-files.json');
  const requiredFiles = JSON.parse(fs.readFileSync(requiredFilesPath, 'utf8'));
  process.env.NODE_ENV = 'production';
  process.env.NEXT_MANUAL_SIG_HANDLE = '1';
  process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(requiredFiles.config);

  // standalone出力が同梱する最小構成だけで起動する。通常のnext() APIは
  // ビルド時専用依存を追加で要求するため使用しない。
  require(path.join(projectPath, 'node_modules', 'next'));
  const { startServer } = require(path.join(
    projectPath,
    'node_modules',
    'next',
    'dist',
    'server',
    'lib',
    'start-server'
  ));

  const originalCreateServer = http.createServer;
  http.createServer = function createProtectedServer(requestListener, ...args) {
    const protectedListener = (request, response) => {
      const activePort = Number(embeddedNextServer?.address()?.port);
      if (!isAllowedLoopbackRequest({
        hostHeader: request.headers.host,
        port: activePort,
      })) {
        response.writeHead(421, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        response.end('Misdirected Request');
        return;
      }
      requestListener(request, response);
    };
    embeddedNextServer = originalCreateServer.call(http, protectedListener, ...args);
    embeddedNextServer.headersTimeout = 15_000;
    embeddedNextServer.requestTimeout = 120_000;
    embeddedNextServer.maxHeadersCount = 100;
    return embeddedNextServer;
  };

  try {
    await startServer({
      dir: projectPath,
      isDev: false,
      config: requiredFiles.config,
      hostname: LOOPBACK_HOST,
      port: 0,
      allowRetry: false,
    });
  } finally {
    http.createServer = originalCreateServer;
    // Next.jsは起動中にprocess.titleを変更するため、macOSのアプリメニュー名を復元する。
    setApplicationProcessName(process);
  }

  const assignedPort = Number(embeddedNextServer?.address()?.port);
  if (!Number.isInteger(assignedPort) || assignedPort < 1) {
    throw new Error('アプリ内サーバーの安全な待受ポートを確認できませんでした。');
  }
  return assignedPort;
}

// メインウィンドウの作成
function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    title: "RadExam",
    autoHideMenuBar: true, // メニューバーを自動非表示にしてアプリらしい見た目にする
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      devTools: !app.isPackaged,
      navigateOnDragDrop: false,
      allowRunningInsecureContent: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  mainWindow.webContents.setZoomFactor(displayZoomFactor);

  const url = `http://${LOOPBACK_HOST}:${port}`;
  const allowedOrigin = new URL(url).origin;

  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    try {
      if (new URL(navigationUrl).origin === allowedOrigin) return;
    } catch {
      // 不正なURLも同様に拒否する。
    }
    event.preventDefault();
  });
  mainWindow.webContents.on('will-attach-webview', event => event.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    try {
      const parsed = new URL(targetUrl);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        void shell.openExternal(parsed.toString());
      }
    } catch {
      // 不正なURLは何も開かず拒否する。
    }
    return { action: 'deny' };
  });
  mainWindow.webContents.session.setPermissionCheckHandler(() => false);
  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  
  // 子プロセス自身の待受開始通知を確認した後にだけ呼ばれる。
  // ポート上の第三者サーバーからの応答を起動完了判定には使用しない。
  void mainWindow.loadURL(url);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

const registerCloudSyncIpc = () => {
  const getManager = clientId => {
    const normalizedClientId = normalizeGoogleClientId(clientId);
    if (!googleOAuthManager || googleOAuthManager.clientId !== normalizedClientId) {
      googleOAuthManager = new GoogleDesktopOAuthManager({
        clientId: normalizedClientId,
        clientSecret: cloudSyncConfig?.googleDesktopClientSecret,
        userDataPath: app.getPath('userData'),
        safeStorage,
        shell,
      });
    }
    return googleOAuthManager;
  };
  const getMicrosoftManager = clientId => {
    const normalizedClientId = normalizeMicrosoftClientId(clientId);
    if (!microsoftOAuthManager || microsoftOAuthManager.clientId !== normalizedClientId) {
      microsoftOAuthManager = new MicrosoftDesktopOAuthManager({
        clientId: normalizedClientId,
        userDataPath: app.getPath('userData'),
        safeStorage,
        shell,
      });
    }
    return microsoftOAuthManager;
  };

  ipcMain.handle('cloud-sync:google-status', (event, clientId) => {
    ensureMainWindowSender(event);
    return getManager(clientId).getStatus();
  });
  ipcMain.handle('cloud-sync:google-authorize', async (event, clientId) => {
    ensureMainWindowSender(event);
    return getManager(clientId).authorize();
  });
  ipcMain.handle('cloud-sync:google-access-token', async (event, clientId) => {
    ensureMainWindowSender(event);
    return getManager(clientId).getAccessToken();
  });
  ipcMain.handle('cloud-sync:google-clear', (event, clientId) => {
    ensureMainWindowSender(event);
    return getManager(clientId).clear();
  });
  ipcMain.handle('cloud-sync:microsoft-status', (event, clientId) => {
    ensureMainWindowSender(event);
    return getMicrosoftManager(clientId).getStatus();
  });
  ipcMain.handle('cloud-sync:microsoft-authorize', async (event, clientId) => {
    ensureMainWindowSender(event);
    return getMicrosoftManager(clientId).authorize();
  });
  ipcMain.handle('cloud-sync:microsoft-access-token', async (event, clientId) => {
    ensureMainWindowSender(event);
    return getMicrosoftManager(clientId).getAccessToken();
  });
  ipcMain.handle('cloud-sync:microsoft-clear', (event, clientId) => {
    ensureMainWindowSender(event);
    return getMicrosoftManager(clientId).clear();
  });
  ipcMain.handle('cloud-sync:fetch', async (event, request) => {
    ensureMainWindowSender(event);
    return performCloudSyncFetch(request);
  });
};

const registerDisplayIpc = () => {
  ipcMain.handle('display:get-zoom-factor', event => {
    ensureMainWindowSender(event);
    return displayZoomFactor;
  });
  ipcMain.handle('display:set-zoom-factor', (event, value) => {
    ensureMainWindowSender(event);
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error('表示倍率の形式が不正です。');
    }
    displayZoomFactor = saveZoomFactor(app.getPath('userData'), value);
    event.sender.setZoomFactor(displayZoomFactor);
    return displayZoomFactor;
  });
};

// Electron の初期化完了時に実行
app.whenReady().then(async () => {
  installMacApplicationMenu(Menu);
  displayZoomFactor = loadZoomFactor(app.getPath('userData'));
  cloudSyncConfig = loadCloudSyncConfig({
    appPath: app.getAppPath(),
    isPackaged: app.isPackaged,
  });
  registerCloudSyncIpc();
  registerDisplayIpc();
  if (app.isPackaged) {
    try {
      // 本番版はElectron自身がポート0で待受を開始する。空きポート確認と
      // 実際の待受の間に第三者プロセスが入り込む余地を作らない。
      serverPort = await startPackagedNextServer();
      createWindow(serverPort);
    } catch (error) {
      console.error(error);
      app.quit();
    }
    return;
  }

  // 開発版も必ず専用サーバーを起動する。インストール済みRadExam等が3000番を
  // 使用していても、空きポートと専用distDirを使うため古い画面を再利用しない。
  findFreePort(3000, async (port) => {
    serverPort = port;
    try {
      await startNextServer(port);
      createWindow(port);
    } catch (error) {
      console.error(error);
      app.quit();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// アプリケーション終了時にNext.jsサーバープロセスも確実にキル
app.on('before-quit', () => {
  applicationIsQuitting = true;
});

app.on('will-quit', () => {
  embeddedNextServer?.close();
  if (nextProcess) {
    if (process.platform === 'win32') {
      // Windows ではツリー全体のプロセスをキル
      spawn('taskkill', ['/pid', nextProcess.pid, '/f', '/t']);
    } else {
      nextProcess.kill('SIGTERM');
    }
  }
});
