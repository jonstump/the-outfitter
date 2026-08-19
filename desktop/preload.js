const { contextBridge } = require("electron");

// Governing: SPEC-0005 "Security Requirements", issue #503.
//
// The launch secret reaches the renderer through this preload script's narrow
// bridge, not `nodeIntegration` (which is disabled). `contextBridge
// .exposeInMainWorld` exposes ONLY the secret itself — nothing else from the
// Node/Electron main process reaches the renderer. The renderer's API module
// reads `window.__DESKTOP_SECRET__` and injects it as the `X-Desktop-Secret`
// header on every `/api` request.
//
// The secret is injected via an environment variable set by the main process
// before the preload script runs. This is an IPC boundary, not a global: the
// preload runs in an isolated context and the bridge is the only thing that
// crosses the isolation boundary.

const secret = process.env.__DESKTOP_SECRET__;

contextBridge.exposeInMainWorld("__DESKTOP_SECRET__", secret || null);
