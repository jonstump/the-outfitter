import { describe, expect, it } from "vitest";
import {
  CONS,
  CONS_GROUPS,
  TOOLS,
  TOOL_GROUPS,
  TRAITS,
  TRAIT_GROUPS,
  WEAPONS,
  consThumb,
  toolThumb,
  traitThumb,
  weaponThumb,
} from "./catalog.js";

// Governing: ADR-0002 (Source Weapon/Equipment Images from huntshowdown.wiki.gg via a One-Time,
// Self-Hosted Scrape)
// Covers: SPEC-0001 REQ "Image Coverage Across All Catalog Categories, with Fallback"
//
// catalog.js has no awareness of scraped photos at all (see the header note in catalog.js) — that
// tier is resolved entirely in ItemThumb.jsx via <img onError> and is covered by
// ItemThumb.test.jsx instead. What catalog.js *does* own is the SVG fallback safety net: a
// per-group lookup per category, with a final hardcoded default. The per-item override tier was
// removed (issue #22) — the maps were empty and carried no per-item SVGs — so every real catalog
// item resolves through the per-group tier below. That's exercised directly.

describe("weaponThumb", () => {
  it("resolves every weapon in the catalog to a non-empty SVG path", () => {
    WEAPONS.forEach((w) => {
      expect(weaponThumb(w)).toEqual(expect.any(String));
      expect(weaponThumb(w).length).toBeGreaterThan(0);
    });
  });

  it("dispatches melee ('none' ammo class) weapons to the melee icon", () => {
    const melee = WEAPONS.find((w) => w[3] === "none");
    expect(melee).toBeTruthy();
    expect(weaponThumb(melee)).toBe(weaponThumb(["fixture", 99, 0, "none", "Melee"]));
  });

  it("dispatches bow-class weapons to the bow icon, distinct from crossbows", () => {
    const bow = WEAPONS.find((w) => w[3] === "bow");
    const xbow = WEAPONS.find((w) => w[3] === "xbow" || w[3] === "hxbow");
    expect(bow).toBeTruthy();
    expect(xbow).toBeTruthy();
    expect(weaponThumb(bow)).not.toBe(weaponThumb(xbow));
  });

  it("dispatches hxbow the same as xbow (shared crossbow icon)", () => {
    expect(weaponThumb(["fixture-hxbow", 2, 0, "hxbow", "Bows"])).toBe(
      weaponThumb(["fixture-xbow", 3, 0, "xbow", "Bows"])
    );
  });

  it("dispatches shotgun-class weapons to the shotgun icon regardless of size", () => {
    const shotgun = WEAPONS.find((w) => w[3] === "shotgun");
    expect(shotgun).toBeTruthy();
    expect(weaponThumb(shotgun)).toBe(weaponThumb(["fixture", 1, 0, "shotgun", "Shotguns"]));
  });

  it("dispatches by size for firearm classes not covered above: <=2 pistol, 3 carbine, >=4 rifle", () => {
    const pistolIcon = weaponThumb(["fixture", 1, 0, "compact", "Pistols"]);
    const pistolIcon2 = weaponThumb(["fixture", 2, 0, "medium", "Pistols"]);
    const carbineIcon = weaponThumb(["fixture", 3, 0, "compact", "Rifles"]);
    const rifleIcon = weaponThumb(["fixture", 4, 0, "long", "Rifles"]);
    const rifleIcon2 = weaponThumb(["fixture", 5, 0, "slong", "Rifles"]);

    expect(pistolIcon).toBe(pistolIcon2);
    expect(pistolIcon).not.toBe(carbineIcon);
    expect(carbineIcon).not.toBe(rifleIcon);
    expect(rifleIcon).toBe(rifleIcon2);
  });
});

describe("toolThumb", () => {
  it("resolves every tool in the catalog to a non-empty SVG path", () => {
    TOOLS.forEach((t) => {
      expect(toolThumb(t)).toEqual(expect.any(String));
      expect(toolThumb(t).length).toBeGreaterThan(0);
    });
  });

  it("resolves a distinct icon per declared tool group", () => {
    const icons = new Set(TOOL_GROUPS.map((g) => toolThumb(["fixture", 0, g])));
    expect(icons.size).toBe(TOOL_GROUPS.length);
  });

  it("falls back to the Utility icon for an unrecognized group", () => {
    const utilityIcon = toolThumb(["fixture", 0, "Utility"]);
    expect(toolThumb(["fixture", 0, "NotARealGroup"])).toBe(utilityIcon);
  });
});

describe("traitThumb", () => {
  it("resolves every trait in the catalog to a non-empty SVG path", () => {
    TRAITS.forEach((t) => {
      expect(traitThumb(t)).toEqual(expect.any(String));
      expect(traitThumb(t).length).toBeGreaterThan(0);
    });
  });

  it("resolves a distinct icon per declared trait group", () => {
    const icons = new Set(TRAIT_GROUPS.map((g) => traitThumb(["fixture", 0, g])));
    expect(icons.size).toBe(TRAIT_GROUPS.length);
  });

  it("falls back to the Utility icon for an unrecognized group", () => {
    const utilityIcon = traitThumb(["fixture", 0, "Utility"]);
    expect(traitThumb(["fixture", 0, "NotARealGroup"])).toBe(utilityIcon);
  });
});

describe("consThumb", () => {
  it("resolves every consumable in the catalog to a non-empty SVG path", () => {
    CONS.forEach((c) => {
      expect(consThumb(c)).toEqual(expect.any(String));
      expect(consThumb(c).length).toBeGreaterThan(0);
    });
  });

  it("resolves a distinct icon per declared consumable group", () => {
    const icons = new Set(CONS_GROUPS.map((g) => consThumb(["fixture", 0, "Throwable", g])));
    expect(icons.size).toBe(CONS_GROUPS.length);
  });

  it("falls back to the Utility icon for an unrecognized group", () => {
    const utilityIcon = consThumb(["fixture", 0, "Throwable", "Utility"]);
    expect(consThumb(["fixture", 0, "Throwable", "NotARealGroup"])).toBe(utilityIcon);
  });
});
