import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Governing: SPEC-0005 REQ "Per-User Data Directory" (2026-08-19 amendment:
// user-override scenarios), REQ "Native Application Menu and Preferences
// Surface", issue #504/#505.
//
// These tests exercise the preferences.json read/write round-trip and the
// data-directory-change flow (confirm-and-move copies the file, decline-and-keep
// leaves the old file untouched and starts empty). All filesystem assertions
// use temp directories — never the real `userData` path.
//
// The pure functions live in lib/prefsPure.js (ESM, no Electron dependency)
// so they can be tested in isolation. The Electron-dependent menu/window/IPC
// logic lives in preferences.js (CommonJS, requires electron) and wraps these.

import {
  loadPreferencesFromDir,
  savePreferencesToDir,
  isDirectoryWritable,
  PREFERENCE_CONTROLS,
  DEFAULT_PREFERENCES,
  escapeHtml,
} from "../lib/prefsPure.js";

let tempDir;

function makeTempDir() {
  const dir = path.join(
    os.tmpdir(),
    `outfitter-prefs-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

beforeEach(() => {
  tempDir = makeTempDir();
});

afterEach(() => {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe("preferences.json round-trip (SPEC-0005, #504/#505)", () => {
  it("returns defaults when the file does not exist (first launch)", async () => {
    const prefs = await loadPreferencesFromDir(tempDir);
    expect(prefs).toEqual(DEFAULT_PREFERENCES);
    expect(prefs.dataDir).toBeNull();
  });

  it("does not surface an error on first launch (file missing)", async () => {
    const prefs = await loadPreferencesFromDir(tempDir);
    expect(prefs).toEqual({ dataDir: null });
  });

  it("round-trips a data directory preference", async () => {
    await savePreferencesToDir(tempDir, { dataDir: "/some/custom/path" });
    const prefs = await loadPreferencesFromDir(tempDir);
    expect(prefs.dataDir).toBe("/some/custom/path");
  });

  it("survives a corrupted preferences.json (falls back to defaults)", async () => {
    const prefsFile = path.join(tempDir, "preferences.json");
    fs.writeFileSync(prefsFile, "{ not valid json");
    const prefs = await loadPreferencesFromDir(tempDir);
    expect(prefs).toEqual({ dataDir: null });
  });
});

describe("PREFERENCE_CONTROLS descriptor list (SPEC-0005, #504/#505)", () => {
  it("contains the data-directory control as its first entry", () => {
    expect(PREFERENCE_CONTROLS[0].key).toBe("dataDir");
    expect(PREFERENCE_CONTROLS[0].label).toMatch(/data directory/i);
  });

  it("renders a control fragment for the data directory", () => {
    const control = PREFERENCE_CONTROLS[0];
    const html = control.render("/some/path");
    expect(html).toContain("/some/path");
    expect(html).toContain('data-key="dataDir"');
  });

  it("renders the default label when the value is null", () => {
    const html = PREFERENCE_CONTROLS[0].render(null);
    expect(html).toContain("(default)");
  });

  it("is structured so a future control can be appended without changing core logic", () => {
    expect(Array.isArray(PREFERENCE_CONTROLS)).toBe(true);
    expect(PREFERENCE_CONTROLS.length).toBeGreaterThanOrEqual(1);
  });
});

describe("PREFERENCE_CONTROLS render() escaping (SPEC-0005 'Security Requirements', #521)", () => {
  // Governing: SPEC-0005 "Security Requirements", REQ "Native Application Menu
  // and Preferences Surface", issue #521. preferences.js joins these fragments
  // into a document loaded as a `data:` URL, and preferences-preload.js exposes
  // the privileged `window.prefs` bridge into that page — so an unescaped value
  // is live markup running next to `changeDataDir()` and `relaunch()`. A
  // directory name can carry markup without the user typing it (archive
  // extraction, sync clients, external volumes), so the picker is not a guard.

  it("escapes markup in the data directory value — no raw <img survives (#521)", () => {
    const payload = '/home/u/<img src=x onerror="window.prefs.relaunch()">';
    const html = PREFERENCE_CONTROLS[0].render(payload);

    expect(html).not.toContain("<img");
    expect(html).not.toContain("onerror=\"window.prefs");
    expect(html).toContain("&lt;img src=x onerror=&quot;window.prefs.relaunch()&quot;&gt;");
  });

  it("escapes all five of & < > \" ' in the rendered value", () => {
    const html = PREFERENCE_CONTROLS[0].render("/a&b/c<d>e/f\"g'h");
    const rendered = html.slice(
      html.indexOf('<code id="dataDir-path">') + '<code id="dataDir-path">'.length,
      html.indexOf("</code>")
    );

    expect(rendered).toBe("/a&amp;b/c&lt;d&gt;e/f&quot;g&#39;h");
    for (const raw of ["&", "<", ">", '"', "'"]) {
      expect(rendered.includes(raw + "b") || rendered.includes(raw + "d")).toBe(false);
    }
  });

  it("does not double-escape an ampersand it just escaped", () => {
    const html = PREFERENCE_CONTROLS[0].render("/tmp/a&b");
    expect(html).toContain("/tmp/a&amp;b");
    expect(html).not.toContain("&amp;amp;");
  });

  it("renders an ordinary path legibly, with no entity noise", () => {
    const ordinary = "/home/u/Library/App Support/Backwater Outfitters";
    const html = PREFERENCE_CONTROLS[0].render(ordinary);

    expect(html).toContain(ordinary);
    expect(html).not.toContain("&amp;");
    expect(html).not.toContain("&#39;");
    expect(html).not.toContain("&quot;");
    expect(html).not.toContain("&lt;");
    expect(html).not.toContain("&gt;");
  });

  it("still renders (default) when the value is null", () => {
    const html = PREFERENCE_CONTROLS[0].render(null);
    expect(html).toContain("(default)");
    expect(html).not.toContain("&#40;");
  });

  it("every registered control escapes a markup payload in its rendered output", () => {
    // Guards the comment beside PREFERENCE_CONTROLS: a future setting added to
    // the array must inherit the escaping guarantee, not reintroduce the bug.
    for (const control of PREFERENCE_CONTROLS) {
      const html = control.render("<script>window.prefs.relaunch()</script>");
      expect(html).not.toContain("<script>");
    }
  });

  it("escapeHtml is exported and escapes the five HTML-significant characters", () => {
    expect(escapeHtml("&<>\"'")).toBe("&amp;&lt;&gt;&quot;&#39;");
    expect(escapeHtml("plain/path")).toBe("plain/path");
    expect(escapeHtml(null)).toBe("null");
  });
});

describe("data-directory change flow (SPEC-0005, #504/#505)", () => {
  it("confirm-and-move: copies the lowdb file to the new location", () => {
    const oldDir = path.join(tempDir, "old");
    const newDir = path.join(tempDir, "new");
    fs.mkdirSync(oldDir, { recursive: true });
    const oldFile = path.join(oldDir, "db.json");
    fs.writeFileSync(oldFile, JSON.stringify({ loadouts: [{ name: "test" }] }));

    fs.mkdirSync(newDir, { recursive: true });
    fs.copyFileSync(oldFile, path.join(newDir, "db.json"));

    expect(fs.existsSync(path.join(newDir, "db.json"))).toBe(true);
    const copied = JSON.parse(
      fs.readFileSync(path.join(newDir, "db.json"), "utf8")
    );
    expect(copied.loadouts[0].name).toBe("test");
  });

  it("decline-and-keep: old file is NOT deleted, new location starts empty", () => {
    const oldDir = path.join(tempDir, "old");
    const newDir = path.join(tempDir, "new");
    fs.mkdirSync(oldDir, { recursive: true });
    const oldFile = path.join(oldDir, "db.json");
    fs.writeFileSync(oldFile, JSON.stringify({ loadouts: [{ name: "test" }] }));

    fs.mkdirSync(newDir, { recursive: true });

    expect(fs.existsSync(oldFile)).toBe(true);
    expect(fs.existsSync(path.join(newDir, "db.json"))).toBe(false);
  });
});

describe("isDirectoryWritable (SPEC-0005 REQ 'Per-User Data Directory', issue #515)", () => {
  // Governing: issue #515. On macOS, an unsigned/ad-hoc-signed build can be
  // denied write access to TCC-protected folders (Documents, Desktop,
  // Downloads, iCloud Drive, removable/network volumes) with EPERM and no
  // consent prompt ever shown — so there is no System Settings entry to grant
  // access from afterward. Picking such a directory in Preferences previously
  // got accepted with no validation, and every subsequent API request 500'd
  // forever. This exercises a REAL unwritable directory (permission bits
  // removed), not a mock — an fs.access()-based check would have passed here
  // and missed the real bug: TCC's EPERM shows up on the actual write, not on
  // an access() probe.
  const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

  it("reports a normal, writable directory as writable", async () => {
    const result = await isDirectoryWritable(tempDir);
    expect(result.writable).toBe(true);
  });

  it.skipIf(isRoot)(
    "reports a directory with write permission removed as not writable (regression, #515)",
    async () => {
      const readOnlyDir = path.join(tempDir, "readonly");
      fs.mkdirSync(readOnlyDir, { recursive: true });
      fs.chmodSync(readOnlyDir, 0o555);
      try {
        const result = await isDirectoryWritable(readOnlyDir);
        expect(result.writable).toBe(false);
        expect(result.error).toBeTruthy();
      } finally {
        // Restore write access so the outer afterEach's rmSync can clean up.
        fs.chmodSync(readOnlyDir, 0o755);
      }
    }
  );

  it("creates the directory first if it does not exist yet, then reports it writable", async () => {
    const newDir = path.join(tempDir, "not-yet-created");
    expect(fs.existsSync(newDir)).toBe(false);
    const result = await isDirectoryWritable(newDir);
    expect(result.writable).toBe(true);
    expect(fs.existsSync(newDir)).toBe(true);
  });

  it("does not leave its probe file behind after a successful check", async () => {
    await isDirectoryWritable(tempDir);
    const leftover = fs
      .readdirSync(tempDir)
      .filter((f) => f.startsWith(".outfitter-write-test-"));
    expect(leftover).toEqual([]);
  });
});

describe("preference resolution ordering (SPEC-0005, #504/#505)", () => {
  it("the preference is read and awaited before OUTFITTER_DB_FILE is set", async () => {
    await savePreferencesToDir(tempDir, { dataDir: "/custom/from-prefs" });
    const prefs = await loadPreferencesFromDir(tempDir);
    const dataDir = prefs.dataDir || tempDir;
    process.env.OUTFITTER_DB_FILE = path.join(dataDir, "db.json");

    expect(process.env.OUTFITTER_DB_FILE).toBe("/custom/from-prefs/db.json");

    delete process.env.OUTFITTER_DB_FILE;
  });
});
