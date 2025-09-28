import { app, BrowserWindow, Menu, Tray, dialog } from 'electron';
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
let isQuitting = false; // Track app quit state

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
  
  // On macOS, give extra time for server to start
  if (process.platform === 'darwin') {
    timeoutMs = Math.max(timeoutMs, 45000);
  }
  
  while (Date.now() - start < timeoutMs) {
    attempts++;
    try {
      // Try both base URL and health endpoint
      const healthEndpoint = `${base}/health`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      
      const r = await fetch(healthEndpoint, { 
        signal: controller.signal,
        // @ts-ignore - node-fetch supports timeout
        timeout: 2000 
      }).finally(() => clearTimeout(timeoutId));
      
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
  // Don't start multiple servers
  if (serverProcess && !serverProcess.killed) {
    console.log('[ELECTRON] Server already running');
    return;
  }
  
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
    let serverEntry = path.resolve(appPath, 'apps', 'ig-poster', 'dist', 'index.js');

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

    // Catch spawn errors explicitly (important on macOS hardened runtime)
    serverProcess.on('error', (err) => {
      console.error('[SERVER ERROR] spawn failed:', err);
      try { fs.appendFileSync(errorLog, `\n[SPAWN ERROR] ${new Date().toISOString()} ${String(err?.stack || err)}\n`); } catch {}
      // Surface a visible error page to the user
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadURL(`data:text/html,
          <html>
            <body style="font-family: system-ui; padding: 40px; background: #1a1a1a; color: #fff;">
              <h1 style="color: #ff6b6b;">Failed to Start Server</h1>
              <p>BulkIG Pro's internal server could not be launched.</p>
              <p>Please reinstall or move the app to Applications and try again.</p>
              <p>Error: ${String((err as any)?.message || err)}</p>
              <p>You can also open Console logs: ~/Library/Logs/BulkIG-Pro</p>
            </body>
          </html>`);
      }
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
  
  // If window already exists, just show it
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'BulkIG Pro',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false, // Allow loading local files
      backgroundThrottling: false, // Ensure rendering isn't throttled while hidden
    },
    icon: getIconPath(),
    show: false, // Start hidden to avoid flash
    center: true, // Center on screen
    backgroundColor: '#1a1a1a', // Dark background to match loading screen
    skipTaskbar: false, // Ensure window appears in taskbar
    minimizable: true,
    maximizable: true,
    resizable: true,
    frame: true, // Ensure window has frame
    transparent: false, // Disable transparency which can cause issues
  });
  
  // Force window to show after a timeout to prevent invisible window
  const forceShowTimeout = setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      console.log('[ELECTRON] Force showing window after timeout');
      mainWindow.show();
      mainWindow.focus();
      mainWindow.moveTop();
    }
  }, 2000); // Show after 2 seconds no matter what

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
    // On macOS, only prevent close if we're not actually quitting the app
    if (process.platform === 'darwin' && !isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
      // Keep app in dock but hide window
      return false;
    }
  });

  mainWindow.on('ready-to-show', () => {
    try {
      clearTimeout(forceShowTimeout); // Clear the force show timeout
      mainWindow?.show();
      // Bring to front briefly so it isn't hidden behind other windows
      mainWindow?.setAlwaysOnTop(true);
      mainWindow?.focus();
      mainWindow?.moveTop();
      setTimeout(() => { try { mainWindow?.setAlwaysOnTop(false); } catch {} }, 1500);
    } catch {}
  });

  // Enable DevTools in production for debugging
  if (!app.isPackaged || process.env.DEBUG_PROD === 'true') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // Don't immediately try to load server URL, wait for bootstrap to handle it
  // This prevents race conditions on macOS where the window loads before server is ready
  if (process.platform === 'darwin') {
    console.log('[ELECTRON] Deferring URL load on macOS to bootstrap');
  } else {
    // On other platforms, attempt load
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
}

function createTray() {
  const iconPath = getIconPath();
  if (!iconPath) {
    console.warn('[ELECTRON] No icon path found, skipping tray creation');
    return;
  }
  
  tray = new Tray(iconPath);
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open BulkIG Pro', click: () => { 
      if (!mainWindow) {
        createWindow();
      } else {
        mainWindow.show();
        if (process.platform === 'darwin') {
          app.dock.show(); // Show dock icon on macOS when opening from tray
        }
      }
    }},
    { type: 'separator' },
    { label: 'Quit', click: () => { 
      isQuitting = true;
      app.quit(); 
    }},
  ]);
  tray.setToolTip('BulkIG Pro');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => { if (!mainWindow) createWindow(); else mainWindow.show(); });
}

function getIconPath(): string | undefined {
  // Try multiple locations for icon
  const possiblePaths = [
    // Dev paths
    path.resolve(process.cwd(), 'assets'),
    // Packaged app paths
    path.join(app.getAppPath(), 'assets'),
    path.join(app.getAppPath(), '..', 'assets'),
    path.join(process.resourcesPath, 'assets'),
    // Fallback to app resources
    app.getAppPath(),
  ];
  
  for (const base of possiblePaths) {
    const ico = path.join(base, 'icon.ico');
    const icns = path.join(base, 'icon.icns');
    const png = path.join(base, 'icon.png');
    
    if (process.platform === 'win32' && fs.existsSync(ico)) {
      console.log('[ELECTRON] Found icon at:', ico);
      return ico;
    }
    if (process.platform === 'darwin' && fs.existsSync(icns)) {
      console.log('[ELECTRON] Found icon at:', icns);
      return icns;
    }
    if (fs.existsSync(png)) {
      console.log('[ELECTRON] Found icon at:', png);
      return png;
    }
  }
  
  console.warn('[ELECTRON] No icon found in any location');
  return undefined; // Let Electron use default
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
                  <p>Could not restart the BulkIG Pro server.</p>
                  <p>Please quit (Cmd+Q) and reopen the app, or use the BulkIG Pro menu → Quit, then relaunch.</p>
                  <button onclick="location.reload()"
                    style="padding: 12px 24px; background: #22c55e; color: #fff; border: none; border-radius: 6px; font-size: 16px; margin-top: 20px; cursor: pointer;">Reload</button>
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
    
    // Start server first
    startServer();
    
    // Create window immediately
    createWindow();
    
    // Ensure window is created
    if (!mainWindow || mainWindow.isDestroyed()) {
      console.error('[ELECTRON] Failed to create main window');
      app.quit();
      return;
    }
    
    // On macOS, ensure the window is visible and focused
    if (process.platform === 'darwin') {
      mainWindow.show();
      mainWindow.focus();
      app.dock?.show();
    }
    
    // Make sure window will be visible
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
        console.log('[ELECTRON] Forcing window to show in bootstrap');
        mainWindow.show();
        mainWindow.focus();
      }
    }, 3000);
    
    // Show loading page while server starts
    await mainWindow.loadURL(`data:text/html,
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
    
    // Wait for server with platform-specific timeout
    const initialTimeout = process.platform === 'darwin' ? 25000 : 15000;
    const initialOk = await waitForServer('http://localhost:4011', initialTimeout);
    
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
            <button onclick="location.reload()">Reload</button>
            <p>If reloading doesn't help, quit (Cmd+Q) and reopen the app.</p>
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

app.on('ready', () => {
  console.log('[ELECTRON] App is ready, starting bootstrap...');
  
  // Setup macOS menu bar
  if (process.platform === 'darwin') {
    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: 'BulkIG Pro',
        submenu: [
          { label: 'About BulkIG Pro', role: 'about' },
          { type: 'separator' },
          { label: 'Hide BulkIG Pro', role: 'hide', accelerator: 'Command+H' },
          { label: 'Hide Others', role: 'hideOthers', accelerator: 'Command+Shift+H' },
          { label: 'Show All', role: 'unhide' },
          { type: 'separator' },
          { 
            label: 'Quit BulkIG Pro', 
            accelerator: 'Command+Q',
            click: () => {
              isQuitting = true;
              app.quit();
            }
          },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { label: 'Undo', role: 'undo', accelerator: 'Command+Z' },
          { label: 'Redo', role: 'redo', accelerator: 'Shift+Command+Z' },
          { type: 'separator' },
          { label: 'Cut', role: 'cut', accelerator: 'Command+X' },
          { label: 'Copy', role: 'copy', accelerator: 'Command+C' },
          { label: 'Paste', role: 'paste', accelerator: 'Command+V' },
          { label: 'Select All', role: 'selectAll', accelerator: 'Command+A' },
        ],
      },
      {
        label: 'View',
        submenu: [
          { label: 'Reload', role: 'reload', accelerator: 'Command+R' },
          { label: 'Force Reload', role: 'forceReload', accelerator: 'Command+Shift+R' },
          { label: 'Toggle Developer Tools', role: 'toggleDevTools', accelerator: 'F12' },
          { type: 'separator' },
          { label: 'Actual Size', role: 'resetZoom', accelerator: 'Command+0' },
          { label: 'Zoom In', role: 'zoomIn', accelerator: 'Command+Plus' },
          { label: 'Zoom Out', role: 'zoomOut', accelerator: 'Command+-' },
          { type: 'separator' },
          { label: 'Toggle Fullscreen', role: 'togglefullscreen', accelerator: 'Control+Command+F' },
        ],
      },
      {
        label: 'Window',
        submenu: [
          { label: 'Minimize', role: 'minimize', accelerator: 'Command+M' },
          { label: 'Close', role: 'close', accelerator: 'Command+W' },
          { type: 'separator' },
          { label: 'Bring All to Front', role: 'front' },
        ],
      },
    ];
    
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
  }
  
  bootstrap().catch(err => {
    console.error('[ELECTRON] Bootstrap failed:', err);
    dialog.showErrorBox('BulkIG Pro Error', `Failed to start application: ${err.message || err}`);
    app.quit();
  });
});

app.on('before-quit', () => {
  // Mark that we're actually quitting
  isQuitting = true;
  
  // Clean up health monitoring
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
  
  try { tray?.destroy(); } catch {}
  if (serverProcess && !serverProcess.killed) {
    try { 
      // Use SIGKILL on macOS for more reliable process termination
      if (process.platform === 'darwin') {
        serverProcess.kill('SIGKILL');
      } else {
        serverProcess.kill('SIGTERM');
      }
    } catch {}
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  } else {
    // On macOS, keep app running but hide dock icon when all windows closed
    app.dock?.hide();
  }
});

app.on('activate', () => {
  console.log('[ELECTRON] App activated');
  if (!mainWindow || mainWindow.isDestroyed()) {
    // On macOS, recreate window when dock icon clicked and no windows exist
    bootstrap();
  } else {
    mainWindow.show();
    mainWindow.focus();
    if (process.platform === 'darwin') {
      app.dock?.show(); // Ensure dock icon is visible
    }
  }
});

// Handle second instance attempt
app.on('second-instance', () => {
  console.log('[ELECTRON] Second instance detected, focusing existing window');
  // If someone tries to run a second instance, focus our window instead
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.moveTop();
    // Flash the window to get user attention
    mainWindow.flashFrame(true);
    setTimeout(() => mainWindow?.flashFrame(false), 1000);
  } else {
    // Window doesn't exist, create it
    bootstrap();
  }
});
