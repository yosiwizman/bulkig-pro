import { app, BrowserWindow, Menu, Tray } from 'electron';
import path from 'path';
import fs from 'fs';
import { spawn, type ChildProcess } from 'child_process';
import fetch from 'node-fetch';
import { decrypt } from '../secure';

// FIX: Prevent multiple instances (fixes 20+ process bug)
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let serverProcess: ChildProcess | null = null;

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
  const { inbox, license, root } = getAppDataRoot();

  // Load saved settings and inject into env before spawning
  const settingsPath = path.join(root, 'settings.json');
  const injected: Record<string,string> = {};
  try {
    if (fs.existsSync(settingsPath)) {
      const raw = fs.readFileSync(settingsPath, 'utf8');
      const j = JSON.parse(raw || '{}');
      if (j.igUserId) injected.IG_USER_ID = String(j.igUserId);
      if (j.fbToken) injected.FB_LONG_LIVED_PAGE_TOKEN = decrypt(String(j.fbToken));
      if (j.openaiKey) injected.OPENAI_API_KEY = decrypt(String(j.openaiKey));
    }
  } catch {}

  const env = Object.assign({}, process.env, injected, {
    IG_POSTER_PORT: String(process.env.IG_POSTER_PORT || '4011'),
    STATIC_SERVER_PORT: String(process.env.STATIC_SERVER_PORT || '5006'),
    INBOX_PATH: inbox,
    LICENSE_PATH: license,
    BULKIG_PRO_DATA_DIR: root,
  });

  const isDev = !app.isPackaged;
  if (isDev) {
    // Use tsx to run TypeScript directly in dev to avoid ESM/CJS friction
    const tsxBin = process.platform === 'win32'
      ? path.resolve(process.cwd(), 'node_modules', '.bin', 'tsx.cmd')
      : path.resolve(process.cwd(), 'node_modules', '.bin', 'tsx');
    const srcEntry = path.resolve(process.cwd(), 'apps', 'ig-poster', 'src', 'index.ts');
    serverProcess = spawn(tsxBin, [srcEntry], {
      env,
      stdio: 'inherit',
      windowsHide: true,
    });
  } else {
    // Spawn compiled server for production as pure Node using Electron's embedded Node runtime
    const appPath = app.getAppPath();
    const serverEntry = path.resolve(appPath, 'apps', 'ig-poster', 'dist', 'index.js');

    // Minimal persistent logging for diagnostics
    const { root } = getAppDataRoot();
    const outLog = path.join(root, 'server.log');
    try { fs.appendFileSync(outLog, `\n[BOOT] ${new Date().toISOString()} launching: ${serverEntry}\n`); } catch {}

    // Ensure the child is Node-only (no Electron app, avoids single-instance lock conflicts)
    const envNode = Object.assign({}, env, { ELECTRON_RUN_AS_NODE: '1' });

    serverProcess = spawn(process.execPath, [serverEntry], {
      env: envNode,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    // Pipe logs to file (best-effort)
    serverProcess.stdout?.on('data', (b) => { try { fs.appendFileSync(outLog, b); } catch {} });
    serverProcess.stderr?.on('data', (b) => { try { fs.appendFileSync(outLog, b); } catch {} });
  }
  serverProcess.on('exit', (code) => {
    console.log('[SERVER] exited with code', code);
    try {
      const { root } = getAppDataRoot();
      fs.appendFileSync(path.join(root, 'server.log'), `\n[EXIT] ${new Date().toISOString()} code=${code}\n`);
    } catch {}
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

  mainWindow.on('ready-to-show', () => {
    try {
      mainWindow?.show();
      // Bring to front briefly so it isn't hidden behind other windows
      mainWindow?.setAlwaysOnTop(true);
      mainWindow?.focus();
      setTimeout(() => { try { mainWindow?.setAlwaysOnTop(false); } catch {} }, 1500);
    } catch {}
  });

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
  try { createTray(); } catch (e) { console.warn('[ELECTRON] Tray init failed:', (e as any)?.message || e); }
  // Auto-updater removed to prevent EPIPE crashes
}

app.on('ready', bootstrap);

app.on('before-quit', () => {
  try { tray?.destroy(); } catch {}
  if (serverProcess && !serverProcess.killed) {
    try { serverProcess.kill('SIGTERM'); } catch {}
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});

// Handle second instance attempt
app.on('second-instance', () => {
  // If someone tries to run a second instance, focus our window instead
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});
