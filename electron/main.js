const {
  app,
  BrowserWindow,
  ipcMain,
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
} = require('./serverCommand');
const { GoogleDesktopOAuthManager } = require('./googleDesktopOAuth');

// 表示名を変更しても既存の試験・画像・進捗を失わないよう、保存先は旧版と共通にする。
app.setPath('userData', path.join(app.getPath('appData'), 'exam-app'));
app.setName('RadExam');

let nextProcess = null;
let mainWindow = null;
let serverPort = 3000;
let googleOAuthManager = null;

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
  
  nextProcess.on('error', (err) => {
    logStream.write(`[Spawn Error] ${err.message}\n`);
  });

  nextProcess.on('exit', (code, signal) => {
    logStream.write(`[Process Exit] code: ${code}, signal: ${signal}\n`);
  });
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
      preload: path.join(__dirname, 'preload.js')
    }
  });

  const url = `http://${LOOPBACK_HOST}:${port}`;
  
  // サーバーの応答をポーリングで待機し、立ち上がり次第ロード
  const checkServer = () => {
    http.get(url, (res) => {
      if (mainWindow) {
        mainWindow.loadURL(url);
      }
    }).on('error', () => {
      if (mainWindow) {
        setTimeout(checkServer, 200);
      }
    });
  };
  checkServer();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

const registerCloudSyncIpc = () => {
  const ensureSender = event => {
    if (!mainWindow || event.sender !== mainWindow.webContents) {
      throw new Error('許可されていないクラウド同期要求です。');
    }
  };
  const getManager = clientId => {
    const normalizedClientId = String(clientId || '');
    if (!googleOAuthManager || googleOAuthManager.clientId !== normalizedClientId) {
      googleOAuthManager = new GoogleDesktopOAuthManager({
        clientId: normalizedClientId,
        userDataPath: app.getPath('userData'),
        safeStorage,
        shell,
      });
    }
    return googleOAuthManager;
  };

  ipcMain.handle('cloud-sync:google-status', (event, clientId) => {
    ensureSender(event);
    return getManager(clientId).getStatus();
  });
  ipcMain.handle('cloud-sync:google-authorize', async (event, clientId) => {
    ensureSender(event);
    return getManager(clientId).authorize();
  });
  ipcMain.handle('cloud-sync:google-access-token', async (event, clientId) => {
    ensureSender(event);
    return getManager(clientId).getAccessToken();
  });
  ipcMain.handle('cloud-sync:google-clear', (event, clientId) => {
    ensureSender(event);
    return getManager(clientId).clear();
  });
};

// Electron の初期化完了時に実行
app.whenReady().then(async () => {
  registerCloudSyncIpc();
  // 開発版も必ず専用サーバーを起動する。インストール済みRadExam等が3000番を
  // 使用していても、空きポートと専用distDirを使うため古い画面を再利用しない。
  findFreePort(3000, (port) => {
    serverPort = port;
    startNextServer(port);
    createWindow(port);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// アプリケーション終了時にNext.jsサーバープロセスも確実にキル
app.on('will-quit', () => {
  if (nextProcess) {
    if (process.platform === 'win32') {
      // Windows ではツリー全体のプロセスをキル
      spawn('taskkill', ['/pid', nextProcess.pid, '/f', '/t']);
    } else {
      nextProcess.kill('SIGTERM');
    }
  }
});
