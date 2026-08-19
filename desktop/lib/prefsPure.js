const path = require("node:path");
const fs = require("node:fs");

// Governing: SPEC-0005 REQ "Per-User Data Directory" (2026-08-19 amendment:
// user-override scenarios), REQ "Native Application Menu and Preferences
// Surface".
//
// Pure functions for reading/writing preferences.json — no Electron
// dependency, so they can be unit-tested in isolation. The Electron-dependent
// menu/window/IPC logic lives in preferences.js, which delegates to these.
//
// Preferences are persisted in a flat `preferences.json` in the OS per-user
// application data directory (`app.getPath("userData")`), read and written by
// the main process directly — NOT through the Express app or lowdb. This must
// be readable BEFORE `OUTFITTER_DB_FILE` is set, since the `dataDir`
// preference determines where that file points.
//
// Fixed 2026-08-19 (manual verification of a locally packaged build ahead of
// the first tagged release): this file previously used ESM `import`/`export`
// syntax while everything else under desktop/ (main.js, preferences.js,
// preload.js, lib/secretCheck.js) is CommonJS, and desktop/package.json has
// no "type": "module". Vitest's transform layer hid the mismatch — tests
// import this file via ESM `import` and it works regardless of the file's
// own syntax — but preferences.js's real `require("./lib/prefsPure")` hit
// Node's native CJS parser, which cannot parse a top-level `import`
// statement. Crashed on first real launch of a packaged build with
// "SyntaxError: Cannot use import statement outside a module" — the tests
// never caught it because they never exercised the real require() call.
// Converted to CommonJS to match every other file in this workspace.

const DEFAULT_PREFERENCES = {
  dataDir: null, // null means "use Electron's default userData path"
};

/**
 * Read preferences from a given directory. Returns defaults if the file does
 * not exist (first launch) — MUST NOT surface an error.
 */
async function loadPreferencesFromDir(dir) {
  const prefsFile = path.join(dir, "preferences.json");
  try {
    const raw = await fs.promises.readFile(prefsFile, "utf8");
    return { ...DEFAULT_PREFERENCES, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

/**
 * Write preferences to a given directory, creating it if needed.
 */
async function savePreferencesToDir(dir, prefs) {
  await fs.promises.mkdir(dir, { recursive: true });
  const prefsFile = path.join(dir, "preferences.json");
  await fs.promises.writeFile(prefsFile, JSON.stringify(prefs, null, 2), "utf8");
}

/**
 * The descriptor list for the Preferences surface.
 *
 * Each entry declares a control that the Preferences view renders. A future
 * setting can be added by appending an entry here — the view and the menu
 * logic do not need to change. `render(value)` returns an HTML fragment for
 * the control.
 */
const PREFERENCE_CONTROLS = [
  {
    key: "dataDir",
    label: "Data directory",
    render: (value) => `
      <div class="pref-control" data-key="dataDir">
        <label for="dataDir-path">Data directory</label>
        <code id="dataDir-path">${value || "(default)"}</code>
        <button type="button" id="dataDir-change">Change…</button>
      </div>`,
  },
  // Future settings register here — e.g. a hunter-list favorites-cutoff
  // toggle. Do NOT build the behavior of any setting other than the data
  // directory (SPEC-0005 non-goal).
];

module.exports = {
  DEFAULT_PREFERENCES,
  loadPreferencesFromDir,
  savePreferencesToDir,
  PREFERENCE_CONTROLS,
};
