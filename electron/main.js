const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');

let nextProcess = null;
let mainWindow = null;
let serverPort = 3000;

// 未使用の空きポートを探索してポート衝突を回避
function findFreePort(startPort, callback) {
  const server = http.createServer();
  server.listen(startPort, () => {
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
  
  // ログファイルの作成 (Finder等からのGUI起動時の不具合究明用・ホームフォルダ直下に出力)
  const logFile = path.join(app.getPath('home'), 'radtest-server.log');
  const logStream = fs.createWriteStream(logFile, { flags: 'w' });
  
  logStream.write(`=== Server Start Attempt at ${new Date().toISOString()} ===\n`);
  logStream.write(`Project Path: ${projectPath}\n`);
  logStream.write(`Is Packaged: ${app.isPackaged}\n`);
  logStream.write(`Platform: ${process.platform}\n`);

  let command;
  let args = [];
  
  const nextBin = path.join('node_modules', 'next', 'dist', 'bin', 'next');
  const subCommand = isDev ? 'dev --webpack' : 'start';
  
  if (process.platform === 'win32') {
    command = 'cmd.exe';
    args = ['/c', `node ${nextBin} ${subCommand} -p ${port}`];
  } else {
    // macOS/Linux では、ログインシェル (zsh -l) を経由させて環境変数をロードした上で、
    // package.jsonのscriptsに依存しないよう、直接 node_modules 内の next コマンドを実行
    command = 'zsh';
    args = ['-l', '-c', `cd "${projectPath}" && node ${nextBin} ${subCommand} -p ${port}`];
  }
  
  logStream.write(`Running Command: ${command} ${args.join(' ')}\n\n`);

  nextProcess = spawn(command, args, {
    cwd: projectPath,
    env: { ...process.env, ...extraEnv, PORT: port.toString() }
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

  const url = `http://localhost:${port}`;
  
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

// Electron の初期化完了時に実行
app.whenReady().then(async () => {
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
