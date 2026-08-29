const { contextBridge, ipcRenderer } = require("electron");

// Governing: SPEC-0005 "Security Requirements", REQ "Authenticated Loopback
// Boundary", issues #503 and #523.
//
// The launch secret reaches the renderer through this preload script's narrow
// bridge, not `nodeIntegration` (which is disabled). `contextBridge
// .exposeInMainWorld` exposes ONLY the secret itself — nothing else from the
// Node/Electron main process reaches the renderer. The renderer's API module
// reads `window.__DESKTOP_SECRET__` and injects it as the `X-Desktop-Secret`
// header on every `/api` request.
//
// The secret is fetched from the main process over a SYNCHRONOUS IPC channel.
// It used to arrive in the `__DESKTOP_SECRET__` environment variable, which
// Electron copies into even a sandboxed preload — but that also handed it to
// every child process the app spawns (`shell.openExternal`), where on Linux
// it is readable from `/proc/<pid>/environ`. See the matching note in
// main.js (#523).
//
// `sendSync` rather than `await ipcRenderer.invoke(...)`: this preload is
// CommonJS with no top-level await, so an async fetch could still be in flight
// when the page issues its first `/api` request. Blocking here — once, before
// page load — keeps the exposed value a plain string, which is what
// client/src/api/loadouts.js's synchronous `headers()` reads. The main process
// registers the listener at secret-generation time, before the BrowserWindow
// is created, so it is always live by the time this runs.
//
// The channel name is duplicated in main.js because a sandboxed preload cannot
// `require()` a local module to share a constant. desktop/tests/
// secret-transport.test.js asserts the two literals still agree.

const secret = ipcRenderer.sendSync("desktop:secret");

contextBridge.exposeInMainWorld("__DESKTOP_SECRET__", secret || null);
