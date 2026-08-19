const { app, BrowserWindow, dialog, ipcMain, Menu } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const {
  loadPreferencesFromDir,
  savePreferencesToDir,
  isDirectoryWritable,
  PREFERENCE_CONTROLS,
} = require("./lib/prefsPure");

// Governing: SPEC-0005 REQ "Native Application Menu and Preferences Surface",
// REQ "Per-User Data Directory" (2026-08-19 amendment: user-override scenarios).
//
// Preferences are persisted in a flat `preferences.json` in the OS per-user
// application data directory (`app.getPath("userData")`), read and written by
// the main process directly — NOT through the Express app or lowdb. This must
// be readable BEFORE `OUTFITTER_DB_FILE` is set, since the `dataDir`
// preference determines where that file points.
//
// The pure read/write functions live in lib/prefsPure.js (ESM, no Electron
// dependency) so they can be unit-tested in isolation. This module wraps them
// with Electron's `app.getPath("userData")` and adds the menu/window/IPC logic.

async function loadPreferences() {
  return loadPreferencesFromDir(app.getPath("userData"));
}

async function savePreferences(prefs) {
  return savePreferencesToDir(app.getPath("userData"), prefs);
}

/**
 * Build the native application menu.
 *
 * Governing: SPEC-0005 REQ "Native Application Menu and Preferences Surface".
 * Exposes two distinct entry points: About and Preferences. These MUST NOT be
 * merged into one window. On macOS, the app name is the first menu, containing
 * at minimum an About item and a Preferences item (Cmd+,).
 */
function buildMenu({ onAbout, onPreferences }) {
  const isMac = process.platform === "darwin";
  const appName = app.name || "Backwater Outfitters";
  const appMenu = isMac
    ? {
        label: appName,
        submenu: [
          { role: "about", label: `About ${appName}`, click: onAbout },
          { type: "separator" },
          { label: "Preferences…", accelerator: "Cmd+,", click: onPreferences },
          { type: "separator" },
          { role: "services" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { type: "separator" },
          { role: "quit" },
        ],
      }
    : {
        label: "File",
        submenu: [
          { label: "Preferences…", click: onPreferences },
          { type: "separator" },
          { role: "quit" },
        ],
      };

  const helpMenu = {
    role: "help",
    submenu: [
      {
        label: `About ${appName}`,
        click: onAbout,
      },
    ],
  };

  return Menu.buildFromTemplate([appMenu, helpMenu]);
}

let preferencesWindow = null;
let mainWindowRef = null;

/**
 * Set the main window reference (used as the parent for the Preferences
 * window and to send IPC messages like `menu:about`).
 */
function setMainWindow(win) {
  mainWindowRef = win;
}

/**
 * Create the Preferences window — a small standalone HTML page loaded into its
 * own BrowserWindow with the same hardening as the main window.
 */
function createPreferencesWindow(prefs) {
  if (preferencesWindow) {
    preferencesWindow.focus();
    return;
  }

  preferencesWindow = new BrowserWindow({
    width: 520,
    height: 400,
    title: "Preferences",
    parent: mainWindowRef || undefined,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preferences-preload.js"),
    },
  });

  const controls = PREFERENCE_CONTROLS.map((c) => c.render(prefs[c.key] ?? null)).join("");
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Preferences</title>
<style>
  body { font: 14px -apple-system, system-ui, sans-serif; margin: 16px; }
  .pref-control { margin-bottom: 16px; }
  label { display: block; font-weight: 600; margin-bottom: 4px; }
  code { font-size: 12px; color: #555; word-break: break-all; }
  button { margin-top: 4px; }
</style>
</head>
<body>
  <h2>Preferences</h2>
  ${controls}
  <script>
    document.getElementById("dataDir-change")?.addEventListener("click", async () => {
      const result = await window.prefs.changeDataDir();
      if (result && result.changed) {
        const msg = result.moved ? "Data moved. The app will relaunch." : "New directory set (starts empty). The app will relaunch.";
        alert(msg);
        await window.prefs.relaunch();
      }
    });
  </script>
</body>
</html>`;

  preferencesWindow.loadURL(
    "data:text/html;charset=utf-8," + encodeURIComponent(html)
  );
  preferencesWindow.on("closed", () => {
    preferencesWindow = null;
  });
}

/**
 * Register IPC handlers for the Preferences window.
 *
 * Governing: REQ "Per-User Data Directory" (2026-08-19 amendment). The
 * data-directory-change flow: pick a new directory, offer to move the
 * existing lowdb file, and persist the choice. On "decline move", the new
 * location starts from empty collections and the old file is NOT deleted.
 */
function registerPreferencesIpc(prefs, onRelaunch) {
  ipcMain.handle("prefs:changeDataDir", async () => {
    const result = await dialog.showOpenDialog(preferencesWindow, {
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths.length) return { changed: false };

    const newDir = result.filePaths[0];

    // Governing: SPEC-0005 REQ "Per-User Data Directory", issue #515. Reject an
    // unwritable directory here, before any move dialog or persisted state —
    // a directory the app can't actually write to (most commonly a
    // TCC-protected macOS folder like Documents/Desktop/Downloads on an
    // unsigned build) would otherwise get accepted silently and turn into a
    // permanent 500 on every subsequent API request, with no recovery path
    // short of hand-editing preferences.json.
    const writability = await isDirectoryWritable(newDir);
    if (!writability.writable) {
      await dialog.showMessageBox(preferencesWindow, {
        type: "error",
        title: "Directory not writable",
        message: "This app can't write to the selected directory.",
        detail: `${newDir}\n\n${writability.error || "Unknown error."}\n\nOn macOS, this often happens with Documents, Desktop, Downloads, iCloud Drive, or removable/network volumes when the app isn't signed. Choose a different folder.`,
      });
      return { changed: false, error: "not-writable" };
    }

    const currentDbFile = process.env.OUTFITTER_DB_FILE;
    const newDbFile = path.join(newDir, "db.json");

    let moved = false;
    if (fs.existsSync(currentDbFile)) {
      const choice = await dialog.showMessageBox(preferencesWindow, {
        type: "question",
        title: "Move data file?",
        message: "Move your existing data to the new directory?",
        detail: `Choose "Move" to copy your current data file to ${newDir}. Choose "Don't Move" to start fresh at the new location (the old file is not deleted).`,
        buttons: ["Move", "Don't Move", "Cancel"],
        defaultId: 0,
        cancelId: 2,
      });
      if (choice.response === 2) return { changed: false };
      if (choice.response === 0) {
        fs.mkdirSync(newDir, { recursive: true });
        fs.copyFileSync(currentDbFile, newDbFile);
        moved = true;
      }
      // "Don't Move" (response === 1): new location starts empty, old file
      // is NOT deleted — per the spec explicitly.
    }

    const newPrefs = { ...prefs, dataDir: newDir };
    await savePreferences(newPrefs);
    return { changed: true, moved, newDir };
  });

  ipcMain.handle("prefs:relaunch", () => {
    onRelaunch();
  });
}

module.exports = {
  loadPreferences,
  savePreferences,
  buildMenu,
  setMainWindow,
  createPreferencesWindow,
  registerPreferencesIpc,
  PREFERENCE_CONTROLS,
};
