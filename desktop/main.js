const { app, BrowserWindow, shell, Menu } = require("electron");
const path = require("node:path");
const http = require("node:http");
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

  // Fixed 2026-08-19 (manual verification of a locally packaged build ahead
  // of the first tagged release): server/src/index.js only registers static
  // serving of client/dist and the SPA fallback when NODE_ENV === "production"
  // — that's the same gate npm start relies on. Nothing here was ever setting
  // it, so every non-/api, non-/healthz request (including the renderer's
  // initial GET /) fell through to Express's default handler: "Cannot GET /".
  // Must be set before the import below, since the check runs at module
  // evaluation time.
  process.env.NODE_ENV = "production";

  // Import the server app now that OUTFITTER_DB_FILE is set. The import does
  // not bind a port (Part 1's guard) — we call `app.listen` ourselves on a
  // loopback ephemeral port below.
  //
  // Fixed 2026-08-19 (/sdd:review on PR #508): `server/src/index.js`'s router
  // registrations (`app.use("/api/loadouts", ...)` etc.) run synchronously as
  // a side effect of this import, at module-evaluation time. Calling
  // `serverApp.use("/api", secretCheck)` AFTER awaiting the import — as the
  // original code did — appends the check behind those routers in Express's
  // middleware stack, so it never runs for any request a router actually
  // matches. Reproduced directly: GET /api/loadouts with no secret header
  // returned 200, not 403. Fix: mount the imported app as a sub-app of a
  // fresh wrapper whose own middleware (the secret check) is registered
  // first, so it runs before control is ever handed to `serverApp`.
  const { app: serverApp } = await import("../server/src/index.js");

  // Generate a fresh 256-bit launch secret on every launch. Held in memory
  // only; injected into the renderer via the preload script's contextBridge.
  const secret = generateLaunchSecret();
  process.env.__DESKTOP_SECRET__ = secret;

  // Mount the secret-check middleware before every `/api` router. Registered
  // in front of `serverApp`, not inside server/src/index.js — the
  // self-hosted target is unaffected, and the spec explicitly permits the
  // auth plumbing to live in desktop/, but nothing else request-path-related.
  //
  // Fixed 2026-08-19 (the first real tagged release attempt): this used to
  // wrap `serverApp` in a fresh `express()` instance so the secret check
  // could run before Express's own routing. That wrapper was the ONLY thing
  // in this workspace that needed `express` as a real runtime dependency
  // (desktop/package.json's "dependencies", not "devDependencies") — and
  // giving electron-builder something real to auto-bundle for the app is
  // what appears to have triggered its "installing production dependencies"
  // step, which then corrupted its OWN hoisted tool dependency
  // (app-builder-bin) partway through packaging on Linux and macOS CI
  // runners: `spawn .../node_modules/app-builder-bin/linux/x64/app-builder
  // ENOENT`, despite the diagnosed CI run confirming that exact file
  // existed, full-sized, moments before the crash. A plain `http.Server`
  // does the identical job — `secretCheck` already reads `req.headers`
  // directly and writes via `res.writeHead`/`res.end` (see its own 2026-08-19
  // fix note), which work the same whether `req`/`res` are plain Node
  // objects or Express's (Express extends the same base classes) — and an
  // Express `app` instance (`serverApp` here) is itself just a callable
  // `(req, res) => {...}`, the same signature `http.createServer` expects,
  // so no adapter is needed to delegate into it. With this, desktop/ has no
  // real "dependencies" left at all — matching its state before this
  // problem existed — so electron-builder should have nothing to
  // auto-collect for the app bundle.
  const secretCheck = createSecretCheck(secret);
  const server = http.createServer((req, res) => {
    if (req.url === "/api" || req.url.startsWith("/api/") || req.url.startsWith("/api?")) {
      secretCheck(req, res, () => serverApp(req, res));
    } else {
      serverApp(req, res);
    }
  });

  // Bind 127.0.0.1 explicitly (MUST NOT bind 0.0.0.0 or any routable address)
  // and request an ephemeral port (pass 0, read back via server.address().port).
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
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
//
// Fixed 2026-08-19 (/sdd:review on PR #508): the original code sent an IPC
// message (`menu:about`) whenever `mainWindow` was truthy — which is every
// realistic click, since this menu is only installed after the main window
// is created. Nothing in `desktop/preload.js` bridges `ipcRenderer` (it
// exposes only the launch secret), and issue #76 (the in-app About/Help
// panel this was meant to eventually trigger) is still open, so the message
// had no listener anywhere. The documented README fallback was unreachable
// dead code. Until #76 lands, always open the README externally.
function installMenu(prefs) {
  const menu = buildMenu({
    onAbout: () => {
      // TODO(#76): once the in-app About/Help panel lands, wire this to send
      // an IPC message the renderer listens for and opens that panel instead
      // — but that requires a corresponding `ipcRenderer.on` bridge in
      // desktop/preload.js and a listener in the client, neither of which
      // exist yet. Don't reintroduce the send() call without both.
      shell.openExternal("https://github.com/jonstump/the-outfitter#readme");
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
