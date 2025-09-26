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
let healthCheckInterval: NodeJS.Timeout | null = null;

function getAppDataRoot() {
  const root = path.join(app.getPath('userData'), 'BulkIG-Pro');
  try { fs.mkdirSync(root, { recursive: true }); } catch {}
  const inbox = path.join(root, 'inbox');
  try { fs.mkdirSync(inbox, { recursive: true }); } catch {}
  return { root, inbox, license: path.join(root, 'license.json') };
}

async function waitForServer(base = 'http://localhost:4011', timeoutMs = 30000) {
  const start = Date.now();
  let attempts = 0;
  let retryDelay = 500; // Start with 500ms delay
  
  console.log(`[ELECTRON] Waiting for server at ${base}...`);
  
  while (Date.now() - start < timeoutMs) {
    attempts++;
    try {
      // Try both base URL and health endpoint
      const healthEndpoint = `${base}/health`;
      const r = await fetch(healthEndpoint, { timeout: 2000 as any });
      
      if (r.ok || r.status < 500) {
        console.log(`[ELECTRON] Server responded after ${attempts} attempts (${Date.now() - start}ms)`);
        return true;
      }
    } catch (error: any) {
      // Log every 5th attempt to avoid spam
      if (attempts % 5 === 0) {
        console.log(`[ELECTRON] Still waiting for server... (attempt ${attempts}, ${Math.round((Date.now() - start) / 1000)}s elapsed)`);
      }
    }
    
    // Exponential backoff with max delay of 2 seconds
    await new Promise(r => setTimeout(r, retryDelay));
    retryDelay = Math.min(retryDelay * 1.2, 2000);
  }
  
  console.error(`[ELECTRON] Server did not respond within ${timeoutMs}ms after ${attempts} attempts`);
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
    const errorLog = path.join(root, 'server-error.log');
    
    // Log startup attempt
    try { 
      fs.appendFileSync(outLog, `\n[BOOT] ${new Date().toISOString()} launching: ${serverEntry}\n`);
      fs.appendFileSync(outLog, `[BOOT] App path: ${appPath}\n`);
      fs.appendFileSync(outLog, `[BOOT] Server entry exists: ${fs.existsSync(serverEntry)}\n`);
    } catch {}

    // Check if server entry exists
    if (!fs.existsSync(serverEntry)) {
      console.error('[SERVER] Server entry not found:', serverEntry);
      try { fs.appendFileSync(errorLog, `[ERROR] Server entry not found: ${serverEntry}\n`); } catch {}
      
      // Try alternative paths
      const alternativePaths = [
        path.join(appPath, 'dist', 'index.js'),
        path.join(appPath, 'dist', 'apps', 'ig-poster', 'index.js'),
        path.join(process.resourcesPath, 'app', 'apps', 'ig-poster', 'dist', 'index.js'),
        path.join(appPath, 'index.js'),
        path.join(appPath, 'server.js'),
      ];
      
      let found = false;
      for (const altPath of alternativePaths) {
        console.log('[SERVER] Checking alternative path:', altPath);
        if (fs.existsSync(altPath)) {
          console.log('[SERVER] Found server at alternative path:', altPath);
          serverEntry = altPath;
          found = true;
          break;
        }
      }
      
      if (!found) {
        console.error('[SERVER] Could not find server entry point in any location');
        try {
          fs.appendFileSync(errorLog, `[ERROR] Server entry not found in any location. Searched paths:\n`);
          fs.appendFileSync(errorLog, `  - ${serverEntry}\n`);
          alternativePaths.forEach(p => fs.appendFileSync(errorLog, `  - ${p}\n`));
        } catch {}
        
        // Show error in window
        if (mainWindow) {
          mainWindow.loadURL(`data:text/html,
            <html>
              <body style="font-family: system-ui; padding: 40px; background: #1a1a1a; color: #fff;">
                <h1 style="color: #ff6b6b;">Server Not Found</h1>
                <p>The BulkIG Pro server could not be found. This may be an installation issue.</p>
                <p>Please try reinstalling the application.</p>
                <pre style="background: #0a0a0a; padding: 20px; border-radius: 8px; overflow: auto;">
Searched paths:
- ${serverEntry}
${alternativePaths.map(p => '- ' + p).join('\n')}
                </pre>
              </body>
            </html>`);
        }
        return;
      }
    }

    // Ensure the child is Node-only (no Electron app, avoids single-instance lock conflicts)
    const envNode = Object.assign({}, env, { ELECTRON_RUN_AS_NODE: '1' });

    serverProcess = spawn(process.execPath, [serverEntry], {
      env: envNode,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    // Pipe logs to file with console output for debugging
    serverProcess.stdout?.on('data', (b) => { 
      console.log('[SERVER]', b.toString());
      try { fs.appendFileSync(outLog, b); } catch {} 
    });
    serverProcess.stderr?.on('data', (b) => { 
      console.error('[SERVER ERROR]', b.toString());
      try { fs.appendFileSync(errorLog, b); } catch {} 
    });
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
      webSecurity: false, // Allow loading local files
    },
    icon: getIconPath(),
    show: false,
  });

  // Add right-click context menu with paste functionality
  mainWindow.webContents.on('context-menu', (event, params) => {
    const contextMenu = Menu.buildFromTemplate([
      { label: 'Cut', role: 'cut', enabled: params.editFlags.canCut },
      { label: 'Copy', role: 'copy', enabled: params.editFlags.canCopy },
      { label: 'Paste', role: 'paste', enabled: params.editFlags.canPaste },
      { type: 'separator' },
      { label: 'Select All', role: 'selectAll', enabled: params.editFlags.canSelectAll },
    ]);
    contextMenu.popup();
  });

  // Add developer tools in case of issues
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('[ELECTRON] Failed to load:', errorDescription, validatedURL);
    // Show error page
    mainWindow?.loadURL(`data:text/html,
      <html>
        <head>
          <style>
            body { font-family: -apple-system, system-ui, sans-serif; padding: 40px; background: #1a1a1a; color: #fff; }
            h1 { color: #ff6b6b; }
            p { line-height: 1.6; }
            button { padding: 10px 20px; background: #22c55e; color: #fff; border: none; border-radius: 4px; cursor: pointer; }
          </style>
        </head>
        <body>
          <h1>Connection Error</h1>
          <p>Unable to connect to the BulkIG Pro server.</p>
          <p>Error: ${errorDescription}</p>
          <p>The server may still be starting. Please wait a moment...</p>
          <button onclick="location.reload()">Retry</button>
        </body>
      </html>`);
    
    // Retry after 3 seconds
    setTimeout(() => {
      mainWindow?.loadURL('http://localhost:4011');
    }, 3000);
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

  // Enable DevTools in production for debugging
  if (!app.isPackaged || process.env.DEBUG_PROD === 'true') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // Try to load the server URL
  mainWindow.loadURL('http://localhost:4011').catch((error) => {
    console.error('[ELECTRON] Failed to load URL:', error);
    // Fallback to loading the HTML file directly
    const htmlPath = app.isPackaged
      ? path.join(app.getAppPath(), 'apps', 'ig-poster', 'public', 'index.html')
      : path.join(__dirname, '..', '..', 'public', 'index.html');
    
    if (fs.existsSync(htmlPath)) {
      mainWindow?.loadFile(htmlPath);
    } else {
      console.error('[ELECTRON] HTML file not found at:', htmlPath);
    }
  });
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

function startHealthMonitoring() {
  // Clear any existing interval
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
  }
  
  let failureCount = 0;
  const maxFailures = 3;
  
  healthCheckInterval = setInterval(async () => {
    try {
      const response = await fetch('http://localhost:4011/health', { 
        timeout: 5000 as any,
        signal: AbortSignal.timeout(5000)
      });
      
      if (response.ok) {
        failureCount = 0; // Reset on success
      } else {
        failureCount++;
      }
    } catch (error) {
      failureCount++;
      console.warn(`[HEALTH] Health check failed (${failureCount}/${maxFailures}):`, error);
    }
    
    // If too many failures, attempt recovery
    if (failureCount >= maxFailures) {
      console.error('[HEALTH] Server appears to be down, attempting recovery...');
      
      // Show error page
      mainWindow?.loadURL(`data:text/html,
        <html>
          <body style="font-family: system-ui; padding: 40px; background: #1a1a1a; color: #fff;">
            <h1 style="color: #ff6b6b;">Server Connection Lost</h1>
            <p>The BulkIG Pro server stopped responding. Attempting to recover...</p>
            <div style="margin-top: 20px;">
              <div style="width: 50px; height: 50px; border: 5px solid rgba(255,255,255,0.3); border-top: 5px solid #fff; border-radius: 50%; animation: spin 1s linear infinite;"></div>
            </div>
            <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
          </body>
        </html>`);
      
      // Try to restart server
      if (serverProcess) {
        console.log('[HEALTH] Killing unresponsive server...');
        serverProcess.kill();
        serverProcess = null;
      }
      
      // Restart server
      setTimeout(() => {
        console.log('[HEALTH] Starting server...');
        startServer();
        
        // Wait for server to come back
        waitForServer('http://localhost:4011', 30000).then(ok => {
          if (ok) {
            console.log('[HEALTH] Server recovered successfully');
            failureCount = 0;
            mainWindow?.loadURL('http://localhost:4011');
          } else {
            console.error('[HEALTH] Server recovery failed');
            mainWindow?.loadURL(`data:text/html,
              <html>
                <body style="font-family: system-ui; padding: 40px; background: #1a1a1a; color: #fff;">
                  <h1 style="color: #ff6b6b;">Recovery Failed</h1>
                  <p>Could not restart the BulkIG Pro server. Please restart the application.</p>
                  <button onclick="require('electron').remote.app.relaunch();require('electron').remote.app.exit(0)" 
                    style="padding: 12px 24px; background: #22c55e; color: #fff; border: none; border-radius: 6px; font-size: 16px; margin-top: 20px; cursor: pointer;">Restart Application</button>
                </body>
              </html>`);
          }
        });
      }, 1000);
    }
  }, 30000); // Check every 30 seconds
}

async function bootstrap() {
  try {
    console.log('[ELECTRON] Starting bootstrap...');
    startServer();
    
    // Create window immediately but show loading state
    createWindow();
    
    // Show loading page while server starts
    mainWindow?.loadURL(`data:text/html,
      <html>
        <head>
          <style>
            body { 
              font-family: -apple-system, system-ui, sans-serif; 
              padding: 40px; 
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
              color: #fff; 
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              margin: 0;
            }
            .container {
              text-align: center;
            }
            h1 { 
              font-size: 48px;
              margin-bottom: 20px;
            }
            p { 
              font-size: 18px;
              opacity: 0.9;
            }
            .spinner {
              width: 50px;
              height: 50px;
              border: 5px solid rgba(255,255,255,0.3);
              border-top: 5px solid #fff;
              border-radius: 50%;
              animation: spin 1s linear infinite;
              margin: 30px auto;
            }
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>BulkIG Pro</h1>
            <div class="spinner"></div>
            <p>Starting server, please wait...</p>
          </div>
        </body>
      </html>`);
    
    // Wait for server with reduced initial timeout for faster feedback
    const initialOk = await waitForServer('http://localhost:4011', 15000);
    
    if (initialOk) {
      console.log('[ELECTRON] Server is ready, loading application...');
      // Load the actual application
      await mainWindow?.loadURL('http://localhost:4011');
      
      // Start periodic health checks
      startHealthMonitoring();
    } else {
      console.warn('[ELECTRON] Server did not respond in initial check, showing retry UI');
      
      // Continue trying in background
      const retryInBackground = async () => {
        const retryOk = await waitForServer('http://localhost:4011', 30000);
        if (retryOk) {
          console.log('[ELECTRON] Server finally responded, loading app');
          mainWindow?.loadURL('http://localhost:4011');
          startHealthMonitoring(); // Start health checks once server is ready
        }
      };
      retryInBackground();
      
      // Show error with retry option
      mainWindow?.loadURL(`data:text/html,
        <html>
          <head>
            <style>
              body { 
                font-family: -apple-system, system-ui, sans-serif; 
                padding: 40px; 
                background: #1a1a1a; 
                color: #fff; 
              }
              h1 { color: #ff6b6b; }
              p { line-height: 1.6; margin: 20px 0; }
              button { 
                padding: 12px 24px; 
                background: #22c55e; 
                color: #fff; 
                border: none; 
                border-radius: 6px; 
                cursor: pointer; 
                font-size: 16px;
              }
              button:hover { background: #16a34a; }
              .logs {
                background: #0a0a0a;
                padding: 20px;
                border-radius: 8px;
                margin-top: 20px;
                font-family: monospace;
                font-size: 12px;
                max-height: 300px;
                overflow-y: auto;
              }
            </style>
          </head>
          <body>
            <h1>Server Startup Failed</h1>
            <p>The BulkIG Pro server could not start properly.</p>
            <p>This might happen on first launch or after an update. Please try:</p>
            <ol>
              <li>Wait a moment and click Retry</li>
              <li>Restart the application</li>
              <li>Check if port 4011 is already in use</li>
            </ol>
            <button onclick="location.href='http://localhost:4011'">Retry Connection</button>
            <button onclick="require('electron').remote.app.relaunch();require('electron').remote.app.exit(0)">Restart App</button>
            <div class="logs">
              <p>Debug Information:</p>
              <p>Platform: ${process.platform}</p>
              <p>App Path: ${app.getAppPath()}</p>
            </div>
          </body>
        </html>`);
    }
    
    try { createTray(); } catch (e) { console.warn('[ELECTRON] Tray init failed:', (e as any)?.message || e); }
  } catch (error) {
    console.error('[ELECTRON] Bootstrap error:', error);
  }
}

app.on('ready', bootstrap);

app.on('before-quit', () => {
  // Clean up health monitoring
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
  
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
