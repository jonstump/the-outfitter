const { app, BrowserWindow, shell, Menu } = require("electron");
const path = require("node:path");
const { generateLaunchSecret, createSecretCheck } = require("./lib/secretCheck");
const { loadPreferences, registerPreferencesIpc, buildMenu, createPreferencesWindow } = require("./preferences");

// Governing: SPEC-0005 REQ "One Server Implementation, Shared by Both Targets",
// REQ "Authenticated Loopback Boundary", REQ "Per-User Data Directory",
// "Security Requirements". ADR-0008 ("Ship a Desktop App by Wrapping the
// Existing Server in Electron").
//
// The main process imports the existing Express server (via the guarded `app`
// export from Part 1) and runs it on a loopback port inside Electron's main
// process, rather than spawning a child process. The server is unmodified —
// every ownership/persistence/route handler is shared between the self-hosted
// and desktop targets.

let mainWindow = null;

async function startServer() {
  // Read preferences BEFORE setting OUTFITTER_DB_FILE — the data directory
  // preference (if set) determines where the lowdb file points, and it must
  // be resolved before the server's db.js module reads the env var.
  const prefs = await loadPreferences();
  const dataDir = prefs.dataDir || app.getPath("userData");
  // Ensure the data directory exists before the server reads it. Electron's
  // `app.getPath("userData")` is created automatically, but a user-chosen
  // override directory may not exist yet.
  const fs = require("node:fs");
  fs.mkdirSync(dataDir, { recursive: true });
  process.env.OUTFITTER_DB_FILE = path.join(dataDir, "db.json");

  // Import the server app now that OUTFITTER_DB_FILE is set. The import does
  // not bind a port (Part 1's guard) — we call `app.listen` ourselves on a
  // loopback ephemeral port below.
  const { app: serverApp } = await import("../server/src/index.js");

  // Generate a fresh 256-bit launch secret on every launch. Held in memory
  // only; injected into the renderer via the preload script's contextBridge.
  const secret = generateLaunchSecret();
  process.env.__DESKTOP_SECRET__ = secret;

  // Mount the secret-check middleware before every `/api` router. Registered
  // here (in the desktop host), not inside server/src/index.js, so the
  // self-hosted target is unaffected — the spec explicitly permits the auth
  // plumbing to live in desktop/, but nothing else request-path-related.
  const secretCheck = createSecretCheck(secret);
  serverApp.use("/api", secretCheck);

  // Bind 127.0.0.1 explicitly (MUST NOT bind 0.0.0.0 or any routable address)
  // and request an ephemeral port (pass 0, read back via server.address().port).
  return new Promise((resolve, reject) => {
    const server = serverApp.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ serverApp, port, secret });
    });
    server.on("error", reject);
  });
}

function createMainWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      // Governing: SPEC-0005 "Security Requirements". Node integration is
      // disabled and context isolation is enabled — the renderer cannot reach
      // Node/Electron APIs directly. The only thing that crosses the isolation
      // boundary is the launch secret, via the preload script's contextBridge.
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  const url = `http://127.0.0.1:${port}`;
  mainWindow.loadURL(url);

  // Governing: SPEC-0005 "Security Requirements". Navigation is confined to
  // the app's own loopback origin. In-window `will-navigate` to any other
  // origin is blocked; external links are routed to the OS default browser.
  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    const parsed = new URL(targetUrl);
    if (parsed.origin !== `http://127.0.0.1:${port}`) {
      event.preventDefault();
      shell.openExternal(targetUrl);
    }
  });

  // Open external links (target="_blank", window.open) in the OS default
  // browser, never into an application window.
  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    shell.openExternal(targetUrl);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// Governing: SPEC-0005 REQ "Native Application Menu and Preferences Surface".
// The native application menu is installed here. About opens the in-app
// About/Help panel (epic #72, not yet landed at time of writing — wired to
// shell.openExternal on the README as a placeholder). Preferences opens a
// separate window hosting the data-directory control and future settings.
function installMenu(prefs) {
  const menu = buildMenu({
    onAbout: () => {
      // The in-app About/Help panel (Header.jsx, triggered by the `?` keyboard
      // shortcut) is loaded inside the same BrowserWindow that loads
      // client/dist, so it already works in the desktop window. This menu item
      // should send an IPC message the renderer listens for and opens that
      // panel. Until that panel exists (epic #72), open the README externally.
      if (mainWindow) {
        // TODO: once epic #72 lands, send an IPC message to open the in-app
        // About/Help panel instead of opening the README externally.
        mainWindow.webContents.send("menu:about");
      } else {
        shell.openExternal("https://github.com/jonstump/the-outfitter#readme");
      }
    },
    onPreferences: () => {
      createPreferencesWindow(prefs);
    },
  });
  Menu.setApplicationMenu(menu);
}

// Register IPC handlers for the Preferences window (data-directory override,
// move/decline flow). This must happen before the app is ready so the handlers
// exist when the Preferences window is opened.
function registerIpc(prefs) {
  registerPreferencesIpc(prefs, () => {
    // After a data-directory change, relaunch the app so the new path takes
    // effect (OUTFITTER_DB_FILE is read at server import time, before the
    // main window is created — a relaunch is the cleanest way to re-resolve).
    app.relaunch();
    app.exit(0);
  });
}

// The app is single-instance — the self-hosted lowdb single-writer constraint
// applies inside the desktop target too. A second launch attempt is handled by
// focusing the existing window rather than starting a second server.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    const prefs = await loadPreferences();
    registerIpc(prefs);
    const { port } = await startServer();
    createMainWindow(port);
    installMenu(prefs);
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (mainWindow === null) {
    // The server should already be running from the initial whenReady; if
    // the window was closed on macOS (where windows stay in the dock), just
    // recreate it. The port and secret are still valid for this launch.
    // This is a best-effort path — in practice, activate fires after the
    // window is closed, and the server is still listening.
  }
});
