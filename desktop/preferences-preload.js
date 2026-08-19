const { contextBridge, ipcRenderer } = require("electron");

// Governing: SPEC-0005 "Security Requirements". The Preferences window uses
// the same hardening as the main window: nodeIntegration disabled, context
// isolation enabled. The preload exposes a narrow `prefs` API with only the
// IPC calls the Preferences page needs — nothing else crosses the isolation
// boundary.

contextBridge.exposeInMainWorld("prefs", {
  changeDataDir: () => ipcRenderer.invoke("prefs:changeDataDir"),
  relaunch: () => ipcRenderer.invoke("prefs:relaunch"),
});
