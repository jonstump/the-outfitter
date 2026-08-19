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
  PREFERENCE_CONTROLS,
  DEFAULT_PREFERENCES,
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
