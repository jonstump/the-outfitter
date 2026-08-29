import { describe, it, expect } from "vitest";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.join(__dirname, "..");

// Governing: SPEC-0005 REQ "Native Application Menu and Preferences Surface" —
// "About SHALL show the installed version, and MAY link out to documentation
// or support. It owns no persisted state and SHALL NOT contain editable
// controls." — and its scenario "WHEN a user opens About and, separately,
// Preferences / THEN they SHALL be distinct windows or panels, and neither
// SHALL contain the other's content". Issue #519.
//
// HOW THIS FILE LOADS `buildMenu`. desktop/preferences.js does
// `require("electron")` at module scope, and `electron`'s package main is a
// path string to a binary, not the runtime API — inside Vitest it does not
// resolve at all ("Cannot find module 'electron'"). `vi.mock("electron", ...)`
// does NOT help: Vitest's mock registry intercepts transformed ESM imports,
// not the real CommonJS `require` this file reaches through, so the mock is
// never consulted and the require still fails. Patching `Module._load` is a
// layer lower and does work — it intercepts the actual CJS load. The patch is
// installed, preferences.js is required through it once, and it is restored
// immediately, so nothing else in the suite sees a patched loader.
//
// `Menu.buildFromTemplate` is stubbed to return its template unchanged, which
// is what makes this a real behavioural test of `buildMenu` rather than a
// source-text assertion: the assertions below walk the menu structure the
// production function actually produced.

const electronStub = {
  app: {
    name: "Backwater Outfitters",
    getVersion: () => "0.0.0-test",
    getPath: () => "/tmp",
  },
  BrowserWindow: class {},
  dialog: {},
  ipcMain: { handle: () => {} },
  Menu: {
    buildFromTemplate: (template) => template,
    setApplicationMenu: () => {},
  },
};

const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "electron") return electronStub;
  return originalLoad.call(this, request, ...rest);
};
let buildMenu;
try {
  ({ buildMenu } = createRequire(path.join(__dirname, "menu.test.js"))(
    "../preferences.js"
  ));
} finally {
  Module._load = originalLoad;
}

/** Every item in the template, flattened across submenus. */
function allItems(template) {
  const out = [];
  const walk = (items) => {
    for (const item of items) {
      out.push(item);
      if (Array.isArray(item.submenu)) walk(item.submenu);
    }
  };
  walk(template);
  return out;
}

/**
 * Build the menu as if running on `platform`. `buildMenu` reads
 * `process.platform` at call time, so no module reload is needed.
 */
function buildOn(platform, options) {
  const original = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
  });
  try {
    return buildMenu(options);
  } finally {
    Object.defineProperty(process, "platform", original);
  }
}

const PLATFORMS = ["darwin", "win32", "linux"];

describe("buildMenu — About shows the installed version on every platform (SPEC-0005, #519)", () => {
  it.each(PLATFORMS)(
    "%s: every About item is role:'about' with no click handler",
    (platform) => {
      const template = buildOn(platform, {
        onDocumentation: () => {},
        onPreferences: () => {},
      });
      const abouts = allItems(template).filter((i) =>
        String(i.label || "").startsWith("About")
      );
      expect(abouts.length).toBeGreaterThan(0);
      for (const about of abouts) {
        expect(about.role).toBe("about");
        expect(about.click).toBeUndefined();
      }
    }
  );

  it.each(PLATFORMS)(
    "%s: no menu item carries both a role and a click handler",
    (platform) => {
      const template = buildOn(platform, {
        onDocumentation: () => {},
        onPreferences: () => {},
      });
      const conflicted = allItems(template).filter((i) => i.role && i.click);
      // Electron silently ignores `click` when `role` is set, so an item with
      // both is a handler that never runs — the exact defect in #519.
      expect(conflicted.map((i) => i.label ?? i.role)).toEqual([]);
    }
  );

  it("macOS: the app-menu About and the Help-menu About are the same item", () => {
    const template = buildOn("darwin", {
      onDocumentation: () => {},
      onPreferences: () => {},
    });
    const [appMenu, helpMenu] = template;
    const appAbout = appMenu.submenu.find((i) => i.role === "about");
    const helpAbout = helpMenu.submenu.find((i) => i.role === "about");
    expect(appAbout).toBeDefined();
    expect(helpAbout).toBeDefined();
    // Same shape, but distinct objects — buildFromTemplate consumes them.
    expect(helpAbout).toEqual(appAbout);
    expect(helpAbout).not.toBe(appAbout);
  });

  it.each(PLATFORMS)(
    "%s: the Help menu offers About and a separate Documentation item",
    (platform) => {
      const seen = [];
      const template = buildOn(platform, {
        onDocumentation: () => seen.push("documentation"),
        onPreferences: () => seen.push("preferences"),
      });
      const helpMenu = template.find((m) => m.role === "help");
      expect(helpMenu).toBeDefined();

      const about = helpMenu.submenu.find((i) => i.role === "about");
      expect(about).toBeDefined();

      const docs = helpMenu.submenu.find((i) => i.label === "Documentation");
      expect(docs).toBeDefined();
      expect(docs.role).toBeUndefined();
      docs.click();
      // The README link is Documentation's behaviour, never About's.
      expect(seen).toEqual(["documentation"]);
    }
  );

  it("no item anywhere invokes the documentation handler except Documentation", () => {
    for (const platform of PLATFORMS) {
      const fired = [];
      const template = buildOn(platform, {
        onDocumentation: () => fired.push(platform),
        onPreferences: () => {},
      });
      for (const item of allItems(template)) {
        if (typeof item.click === "function" && item.label !== "Documentation") {
          item.click();
        }
      }
      expect(fired).toEqual([]);
    }
  });
});

describe("buildMenu — About and Preferences stay distinct surfaces (SPEC-0005, #519)", () => {
  it.each(PLATFORMS)("%s: Preferences is its own item with its own handler", (platform) => {
    const fired = [];
    const template = buildOn(platform, {
      onDocumentation: () => fired.push("documentation"),
      onPreferences: () => fired.push("preferences"),
    });
    const prefs = allItems(template).filter((i) => i.label === "Preferences…");
    expect(prefs).toHaveLength(1);
    expect(prefs[0].role).toBeUndefined();
    prefs[0].click();
    expect(fired).toEqual(["preferences"]);
  });

  it("macOS: Preferences keeps its Cmd+, accelerator and is separated from About", () => {
    const template = buildOn("darwin", {
      onDocumentation: () => {},
      onPreferences: () => {},
    });
    const appMenu = template[0];
    const prefs = appMenu.submenu.find((i) => i.label === "Preferences…");
    expect(prefs.accelerator).toBe("Cmd+,");

    const aboutIdx = appMenu.submenu.findIndex((i) => i.role === "about");
    const prefsIdx = appMenu.submenu.indexOf(prefs);
    expect(aboutIdx).toBeLessThan(prefsIdx);
    // A separator between them: About and Preferences are distinct surfaces,
    // not one merged panel.
    expect(
      appMenu.submenu
        .slice(aboutIdx + 1, prefsIdx)
        .some((i) => i.type === "separator")
    ).toBe(true);
  });

  it.each(PLATFORMS)("%s: no About item carries editable or persisted state", (platform) => {
    const template = buildOn(platform, {
      onDocumentation: () => {},
      onPreferences: () => {},
    });
    for (const about of allItems(template).filter((i) => i.role === "about")) {
      // A checkbox/radio item or a submenu would be an About surface owning
      // state, which the REQ forbids.
      expect(about.type).toBeUndefined();
      expect(about.submenu).toBeUndefined();
      expect(about.checked).toBeUndefined();
    }
  });
});

describe("desktop/main.js populates the About panel from app.getVersion() (SPEC-0005, #519)", () => {
  // Static source assertions: `installMenu` is not exported, and requiring
  // main.js has module-scope side effects (single-instance lock, app event
  // registration, whenReady → startServer) that are not safely reproducible
  // under a stub. The two facts asserted here are exactly the two acceptance
  // criteria the behavioural tests above cannot reach.
  const mainSrc = fs.readFileSync(path.join(desktopDir, "main.js"), "utf8");
  const prefsSrc = fs.readFileSync(path.join(desktopDir, "preferences.js"), "utf8");

  it("calls app.setAboutPanelOptions", () => {
    expect(mainSrc).toMatch(/app\.setAboutPanelOptions\(/);
  });

  it("sources applicationVersion from app.getVersion(), not a hardcoded literal", () => {
    expect(mainSrc).toMatch(/applicationVersion:\s*app\.getVersion\(\)/);
    // A version literal (e.g. "0.1.0") would drift from the shipped manifest.
    expect(mainSrc).not.toMatch(/applicationVersion:\s*["'`]/);
  });

  it("installs the About panel options alongside the menu, in installMenu", () => {
    const start = mainSrc.indexOf("function installMenu(");
    expect(start).toBeGreaterThan(-1);
    const end = mainSrc.indexOf("\n}", mainSrc.indexOf("Menu.setApplicationMenu", start));
    expect(mainSrc.slice(start, end)).toMatch(/app\.setAboutPanelOptions\(/);
  });

  it("no longer routes About through an onAbout handler", () => {
    // The README is Documentation's job now; About is a role.
    expect(mainSrc).not.toMatch(/\bonAbout\b/);
    expect(prefsSrc).not.toMatch(/\bonAbout\b/);
    expect(mainSrc).toMatch(/onDocumentation:/);
  });
});
