// Electron main process for Atlas of Thought.
//
// Strategy: spawn the existing Next.js server as a child process so the
// current code (terraform.ts, all API routes, Prisma + SQLite, etc.) runs
// unchanged. Electron just provides the OS-native window and packaging.
//
// In dev: assume `next dev` is already running on localhost:3002 (started
// by `npm run electron:dev` via concurrently). Wait for the port and load
// the window.
//
// In prod: this file is bundled into the app. We start `next start` in a
// child process pointing at the bundled .next/standalone output, set the
// SQLite DATABASE_URL to an OS app-data directory so user data persists
// across upgrades, and load http://localhost:<port>.

const { app, BrowserWindow, shell, Menu, session, safeStorage } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { randomBytes } = require("node:crypto");
const { spawn } = require("node:child_process");
const waitOn = require("wait-on");

const IS_DEV = !app.isPackaged;
const DEV_URL = "http://localhost:3002";
const PROD_PORT = 3892; // unlikely to clash with anything else
const PROD_URL = `http://localhost:${PROD_PORT}`;
const ALLOWED_RENDERER_PERMISSIONS = new Set(["clipboard-sanitized-write"]);

let mainWindow = null;
let nextProcess = null;

app.enableSandbox();
if (process.platform !== "win32") process.umask(0o077);

function getDatabasePath() {
  // app-data dir is per-OS:
  //   macOS:   ~/Library/Application Support/atlas-of-thought
  //   Windows: %APPDATA%/atlas-of-thought
  //   Linux:   ~/.config/atlas-of-thought
  const dir = app.getPath("userData");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") fs.chmodSync(dir, 0o700);
  return path.join(dir, "atlas.db");
}

function getOrCreateEncryptionKey() {
  if (process.env.ENCRYPTION_KEY) return process.env.ENCRYPTION_KEY;

  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      "Secure API-key storage is unavailable. Configure the OS credential store or set ENCRYPTION_KEY.",
    );
  }
  if (
    process.platform === "linux" &&
    safeStorage.getSelectedStorageBackend() === "basic_text"
  ) {
    throw new Error(
      "No secure Linux credential store is available. Install a supported secret store or set ENCRYPTION_KEY.",
    );
  }

  const keyPath = path.join(app.getPath("userData"), "master-key.bin");
  if (fs.existsSync(keyPath)) {
    if (process.platform !== "win32") fs.chmodSync(keyPath, 0o600);
    return safeStorage.decryptString(fs.readFileSync(keyPath));
  }

  const key = randomBytes(32).toString("base64");
  fs.writeFileSync(keyPath, safeStorage.encryptString(key), {
    flag: "wx",
    mode: 0o600,
  });
  if (process.platform !== "win32") fs.chmodSync(keyPath, 0o600);
  return key;
}

function createWindow(targetUrl) {
  const trustedOrigin = new URL(targetUrl).origin;

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: "#aaccdd", // matches sea color so loading flash is gentle
    title: "Atlas of Thought",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  function openTrustedExternalUrl(url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:") {
        void shell.openExternal(parsed.href);
      }
    } catch {
      // Ignore malformed and non-HTTPS URLs.
    }
  }

  // External links (in-app anchor with target=_blank etc.) open in the
  // default browser instead of a new Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openTrustedExternalUrl(url);
    return { action: "deny" };
  });

  const guardNavigation = (event, url) => {
    try {
      if (new URL(url).origin === trustedOrigin) return;
    } catch {
      // Malformed navigation targets are always blocked.
    }
    event.preventDefault();
    openTrustedExternalUrl(url);
  };
  mainWindow.webContents.on("will-navigate", guardNavigation);
  mainWindow.webContents.on("will-redirect", guardNavigation);

  mainWindow.loadURL(targetUrl);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function startProdServer() {
  const dbPath = getDatabasePath();
  const dbUrl = `file:${dbPath}`;
  const encryptionKey = getOrCreateEncryptionKey();
  console.log(`[atlas] DATABASE_URL=${dbUrl}`);

  // The bundled app ships .next/standalone (Next.js standalone output) +
  // .next/static + public next to it. server.js is the Next entry point.
  const serverScript = path.join(
    process.resourcesPath,
    "app",
    ".next",
    "standalone",
    "server.js",
  );
  if (!fs.existsSync(serverScript)) {
    throw new Error(
      `server.js not found at ${serverScript}. Did the build include the standalone output?`,
    );
  }

  nextProcess = spawn(process.execPath, [serverScript], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      PORT: String(PROD_PORT),
      // Bind ONLY to loopback so the bundled Next.js server isn't
      // reachable from the local network. Without this, anyone on the
      // same Wi-Fi could browse your atlas at http://your-ip:3892.
      HOSTNAME: "127.0.0.1",
      DATABASE_URL: dbUrl,
      ENCRYPTION_KEY: encryptionKey,
      NODE_ENV: "production",
      NEXT_PUBLIC_ORIGIN: PROD_URL,
    },
    stdio: ["ignore", "inherit", "inherit"],
  });

  nextProcess.on("exit", (code) => {
    console.log(`[atlas] Next.js server exited with code ${code}`);
    if (mainWindow) app.quit();
  });

  await waitOn({ resources: [PROD_URL], timeout: 30_000 });
  if (process.platform !== "win32" && fs.existsSync(dbPath)) {
    fs.chmodSync(dbPath, 0o600);
  }
}

async function bootstrap() {
  await app.whenReady();

  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      callback(ALLOWED_RENDERER_PERMISSIONS.has(permission));
    },
  );
  session.defaultSession.setPermissionCheckHandler(
    (_webContents, permission) => ALLOWED_RENDERER_PERMISSIONS.has(permission),
  );

  Menu.setApplicationMenu(buildMenu());

  if (IS_DEV) {
    // Dev: `npm run electron:dev` starts `next dev` in parallel; wait for
    // it to come up before opening the window so we don't show a blank
    // 404 page.
    await waitOn({ resources: [DEV_URL], timeout: 30_000 });
    createWindow(DEV_URL);
  } else {
    await startProdServer();
    createWindow(PROD_URL);
  }
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  return Menu.buildFromTemplate([
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      role: "windowMenu",
    },
  ]);
}

app.on("window-all-closed", () => {
  if (nextProcess) {
    try {
      nextProcess.kill();
    } catch {
      // ignore — process may have already exited
    }
  }
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (mainWindow === null) {
    createWindow(IS_DEV ? DEV_URL : PROD_URL);
  }
});

bootstrap().catch((err) => {
  console.error("[atlas] Failed to start:", err);
  app.quit();
});
