import { app, BrowserWindow, Menu, Tray } from 'electron';
import path from 'path';
import fs from 'fs';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import fetch from 'node-fetch';
import { autoUpdater } from 'electron-updater';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let serverProcess: ChildProcessWithoutNullStreams | null = null;

function getAppDataRoot() {
  const root = path.join(app.getPath('userData'), 'BulkIG-Pro');
  try { fs.mkdirSync(root, { recursive: true }); } catch {}
  const inbox = path.join(root, 'inbox');
  try { fs.mkdirSync(inbox, { recursive: true }); } catch {}
  return { root, inbox, license: path.join(root, 'license.json') };
}

async function waitForServer(base = 'http://localhost:4011', timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${base}/health`, { timeout: 2000 as any });
      if (r.ok) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

function startServer() {
  const { inbox, license } = getAppDataRoot();
  const env = Object.assign({}, process.env, {
    IG_POSTER_PORT: String(process.env.IG_POSTER_PORT || '4011'),
    STATIC_SERVER_PORT: String(process.env.STATIC_SERVER_PORT || '5006'),
    INBOX_PATH: inbox,
    LICENSE_PATH: license,
  });

  // Always spawn compiled server (requires `pnpm build` before dev)
  const serverEntry = path.resolve(process.cwd(), 'apps', 'ig-poster', 'dist', 'index.js');
  serverProcess = spawn(process.execPath, [serverEntry], {
    env,
    stdio: 'inherit',
    windowsHide: true,
  });
  serverProcess.on('exit', (code) => {
    console.log('[SERVER] exited with code', code);
    serverProcess = null;
  });
}

function createWindow() {
  const { inbox } = getAppDataRoot();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'BulkIG Pro',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    icon: getIconPath(),
    show: false,
  });

  mainWindow.on('close', (e) => {
    if (process.platform === 'darwin') {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('ready-to-show', () => mainWindow?.show());

  mainWindow.loadURL('http://localhost:4011');
}

function createTray() {
  tray = new Tray(getIconPath());
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open BulkIG Pro', click: () => { if (!mainWindow) createWindow(); else mainWindow.show(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.quit(); } },
  ]);
  tray.setToolTip('BulkIG Pro');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => { if (!mainWindow) createWindow(); else mainWindow.show(); });
}

function getIconPath() {
  // Fallback to png
  const base = path.resolve(process.cwd(), 'assets');
  const ico = path.join(base, 'icon.ico');
  const icns = path.join(base, 'icon.icns');
  const png = path.join(base, 'icon.png');
  if (process.platform === 'win32' && fs.existsSync(ico)) return ico;
  if (process.platform === 'darwin' && fs.existsSync(icns)) return icns;
  if (fs.existsSync(png)) return png;
  return png; // default
}

async function bootstrap() {
  startServer();
  const ok = await waitForServer('http://localhost:4011', 45000);
  if (!ok) console.warn('[ELECTRON] Server did not respond in time');
  createWindow();
  createTray();
  try { autoUpdater.checkForUpdatesAndNotify().catch(()=>{}); } catch {}
}

app.on('ready', bootstrap);

app.on('before-quit', () => {
  try { tray?.destroy(); } catch {}
  if (serverProcess && !serverProcess.killed) {
    try { serverProcess.kill('SIGTERM'); } catch {}
  }
});

app.on('window-all-closed', (e) => {
  if (process.platform !== 'darwin') {
    app.quit();
  } else {
    e.preventDefault();
  }
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});
