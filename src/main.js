const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const { spawn, execFile } = require('child_process');

const PIPE = '\\\\.\\pipe\\repo-terminals-host';

let mainWindow = null;
let daemonSocket = null;
let socketBuf = '';

// ---- Persistencia da lista de repos ----
function reposFile() {
  return path.join(app.getPath('userData'), 'repos.json');
}
function loadRepos() {
  try { return JSON.parse(fs.readFileSync(reposFile(), 'utf8')); } catch { return []; }
}
function saveRepos(repos) {
  try { fs.writeFileSync(reposFile(), JSON.stringify(repos, null, 2), 'utf8'); return true; }
  catch (e) { console.error('Falha ao salvar repos:', e); return false; }
}

// ---- Conexao com o daemon (host de terminais) ----
function tryConnectOnce() {
  return new Promise((resolve, reject) => {
    const sock = net.connect(PIPE);
    const onErr = (e) => { sock.destroy(); reject(e); };
    sock.once('connect', () => { sock.removeListener('error', onErr); resolve(sock); });
    sock.once('error', onErr);
  });
}

function spawnDaemon() {
  const logPath = path.join(app.getPath('userData'), 'daemon.log');
  const child = spawn(process.execPath, [path.join(__dirname, 'daemon.js'), PIPE, logPath], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  child.unref();
}

async function ensureDaemon() {
  try { return await tryConnectOnce(); }
  catch {
    spawnDaemon();
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 150));
      try { return await tryConnectOnce(); } catch {}
    }
    throw new Error('Nao foi possivel conectar ao daemon de terminais.');
  }
}

function attachSocket(sock) {
  daemonSocket = sock;
  socketBuf = '';
  sock.on('data', (chunk) => {
    socketBuf += chunk.toString('utf8');
    let idx;
    while ((idx = socketBuf.indexOf('\n')) >= 0) {
      const line = socketBuf.slice(0, idx);
      socketBuf = socketBuf.slice(idx + 1);
      if (!line.trim()) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('daemon:msg', msg);
      }
    }
  });
  sock.on('close', () => { daemonSocket = null; });
  sock.on('error', () => {});
}

function sendDaemon(obj) {
  if (daemonSocket) {
    try { daemonSocket.write(JSON.stringify(obj) + '\n'); } catch {}
  }
}

// ---- IPC renderer <-> main ----
function setupIpc(win) {
  ipcMain.handle('repos:load', () => loadRepos());
  ipcMain.handle('repos:save', (_e, repos) => saveRepos(repos));
  ipcMain.handle('dialog:pickFolder', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Escolha a pasta do repositorio',
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
  ipcMain.on('daemon:send', (_e, msg) => sendDaemon(msg));
  ipcMain.handle('shell:openPath', (_e, p) => shell.openPath(p));
  ipcMain.handle('shell:openExternal', (_e, url) => shell.openExternal(url));
  ipcMain.handle('git:info', (_e, dir) => getGitInfo(dir));
  ipcMain.handle('git:branches', (_e, dir) => getBranches(dir));
  ipcMain.handle('clipboard:saveImage', () => {
    const img = clipboard.readImage();
    if (img.isEmpty()) return null;
    const file = path.join(os.tmpdir(), `rt-paste-${Date.now()}.png`);
    try { fs.writeFileSync(file, img.toPNG()); return file; } catch { return null; }
  });
  ipcMain.handle('clipboard:saveImageBuffer', (_e, data) => {
    try {
      const file = path.join(os.tmpdir(), `rt-paste-${Date.now()}.png`);
      fs.writeFileSync(file, Buffer.from(data));
      return file;
    } catch { return null; }
  });
}

function getBranches(dir) {
  return new Promise((resolve) => {
    execFile('git', ['-C', dir, 'branch', '--format=%(refname:short)'], { timeout: 4000, windowsHide: true }, (err, stdout) => {
      if (err) { resolve([]); return; }
      resolve(String(stdout).split('\n').map((s) => s.trim()).filter(Boolean));
    });
  });
}

// Branch atual e se ha mudancas nao commitadas
function getGitInfo(dir) {
  return new Promise((resolve) => {
    if (!dir || !fs.existsSync(path.join(dir, '.git'))) { resolve({ isRepo: false }); return; }
    let branch = null;
    try {
      const head = fs.readFileSync(path.join(dir, '.git', 'HEAD'), 'utf8').trim();
      const m = head.match(/ref:\s*refs\/heads\/(.+)$/);
      if (m) branch = m[1];
      else if (head) branch = head.slice(0, 7); // detached HEAD -> hash curto
    } catch {}
    execFile('git', ['-C', dir, 'status', '--porcelain', '--branch'], { timeout: 4000, windowsHide: true }, (err, stdout) => {
      if (err) { resolve({ isRepo: true, branch, dirty: null, ahead: 0, behind: 0 }); return; }
      const lines = String(stdout).split('\n');
      const head0 = lines[0] || '';
      if (!branch && head0) { const bm = head0.match(/^## ([^.\s]+)/); if (bm) branch = bm[1]; }
      const am = head0.match(/ahead (\d+)/);
      const bm2 = head0.match(/behind (\d+)/);
      const dirty = lines.slice(1).some((l) => l.trim().length > 0);
      resolve({ isRepo: true, branch, dirty, ahead: am ? +am[1] : 0, behind: bm2 ? +bm2[1] : 0 });
    });
  });
}

function appIcon() {
  const icoPath = path.join(__dirname, '..', 'assets', 'icon.ico');
  return fs.existsSync(icoPath) ? icoPath : undefined;
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 760,
    backgroundColor: '#1e1e1e',
    title: 'Terminals',
    icon: appIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow = win;
  win.removeMenu();
  setupIpc(win);

  try {
    const sock = await ensureDaemon();
    attachSocket(sock);
  } catch (e) {
    console.error(e);
  }

  win.loadFile(path.join(__dirname, 'index.html'));

  // Importante: NAO matamos os terminais ao fechar — eles seguem vivos no daemon.
  win.on('closed', () => {
    mainWindow = null;
    if (daemonSocket) { try { daemonSocket.end(); } catch {} }
  });
}

// Instancia unica: se o app ja estiver aberto, foca a janela existente.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(createWindow);
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
