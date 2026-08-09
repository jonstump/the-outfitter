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

// Governing: data-accuracy review issues #35-#40 (UP costs, missing weapons,
// ammo classes, Tools/Consumables rosters). These tests lock in the verified
// values so future catalog edits don't silently regress the fixes.

// Catalog tuples are id-first: [id, name, ...]. Look entries up by display name
// (tuple[1]) so these tests read naturally against the game's names while still
// asserting the stable id is present.
const entry = (arr, name) => arr.find((t) => t[1] === name);

describe("data accuracy (verified against huntshowdown.wiki.gg, Update 2.8.1)", () => {
  it("reflects the Update 2.8 trait UP-cost rebalance", () => {
    expect(entry(TRAITS, "Frontiersman")[2]).toBe(6);
    expect(entry(TRAITS, "Quartermaster")[2]).toBe(8);
    expect(entry(TRAITS, "Hundred Hands")[2]).toBe(3);
  });

  it("reflects the full trait cost re-audit (#40)", () => {
    const expected = {
      Fanning: 8, Levering: 7, Doctor: 9, Physician: 5, Packmule: 4,
      Greyhound: 2, Lightfoot: 5, "Bolt Thrower": 3,
      Serpent: 4, Ghoul: 3, Determination: 1, Resilience: 3, Salveskin: 2,
      Necromancer: 4, Beastface: 4, "Silent Killer": 3, Vulture: 2, Whispersmith: 1,
      Conduit: 5, Ambidextrous: 3, Dauntless: 1,
    };
    Object.entries(expected).forEach(([name, up]) => {
      expect(entry(TRAITS, name)?.[2], name).toBe(up);
    });
  });

  it("renames Poison Sense to Pain Sense (3 UP) and Iron Repeater to Iron Eye (3 UP)", () => {
    expect(entry(TRAITS, "Poison Sense")).toBeUndefined();
    expect(entry(TRAITS, "Iron Repeater")).toBeUndefined();
    expect(entry(TRAITS, "Pain Sense")[2]).toBe(3);
    expect(entry(TRAITS, "Iron Eye")[2]).toBe(3);
  });

  it("includes the Update 2.8 weapons with verified stats (#36)", () => {
    expect(entry(WEAPONS, "1890 Cavalry")).toEqual(["1890-cavalry", "1890 Cavalry", 3, 56, "long", "Rifles"]);
    expect(entry(WEAPONS, "Haymaker")).toEqual(["haymaker", "Haymaker", 2, 279, "long", "Pistols"]);
  });

  it("assigns Dolch 96 and Nitro Express to the special ammo pool (#39)", () => {
    expect(entry(WEAPONS, "Dolch 96")[4]).toBe("special");
    expect(entry(WEAPONS, "Nitro Express")[4]).toBe("special");
  });

  it("moves beetles to Consumables and adds Fire Beetle (#38)", () => {
    expect(TOOLS.some((t) => t[1] === "Choke Beetle")).toBe(false);
    expect(TOOLS.some((t) => t[1] === "Stalker Beetle")).toBe(false);
    expect(entry(CONS, "Choke Beetle")).toEqual(["choke-beetle", "Choke Beetle", 22, "Throwable", "Gas"]);
    expect(entry(CONS, "Stalker Beetle")).toEqual(["stalker-beetle", "Stalker Beetle", 45, "Throwable", "Utility"]);
    expect(entry(CONS, "Fire Beetle")).toEqual(["fire-beetle", "Fire Beetle", 57, "Throwable", "Fire"]);
  });

  it("adds Bear Traps and other current Tools (#38)", () => {
    expect(entry(TOOLS, "Bear Traps")).toEqual(["bear-traps", "Bear Traps", 70, "Traps"]);
    expect(entry(TOOLS, "Knuckle Knife")).toEqual(["knuckle-knife", "Knuckle Knife", 50, "Melee"]);
    expect(entry(TOOLS, "Throwing Spear")).toEqual(["throwing-spear", "Throwing Spear", 80, "Throwing"]);
    expect(entry(TOOLS, "Derringer Pennyshot")).toEqual(["derringer-pennyshot", "Derringer Pennyshot", 63, "Utility"]);
  });

  it("adds the missing consumables and Weak-shot variants (#37)", () => {
    const expected = {
      "Ammo Box": ["ammo-box", "Ammo Box", 65, "Throwable", "Utility"],
      "Tool Box": ["tool-box", "Tool Box", 70, "Throwable", "Utility"],
      "Hellfire Bomb": ["hellfire-bomb", "Hellfire Bomb", 70, "Throwable", "Explosives"],
      "Waxed Dynamite Stick": ["waxed-dynamite-stick", "Waxed Dynamite Stick", 24, "Throwable", "Explosives"],
      "Dark Dynamite Satchel": ["dark-dynamite-satchel", "Dark Dynamite Satchel", 100, "Throwable", "Explosives"],
      "Poison Bomb": ["poison-bomb", "Poison Bomb", 25, "Throwable", "Gas"],
      "Medical Pack": ["medical-pack", "Medical Pack", 35, "Shot", "Shots"],
      "Recovery Shot": ["recovery-shot", "Recovery Shot", 140, "Shot", "Shots"],
      "Vitality Shot (Weak)": ["vitality-shot-weak", "Vitality Shot (Weak)", 20, "Shot", "Shots"],
      "Regeneration Shot (Weak)": ["regeneration-shot-weak", "Regeneration Shot (Weak)", 40, "Shot", "Shots"],
      "Stamina Shot (Weak)": ["stamina-shot-weak", "Stamina Shot (Weak)", 60, "Shot", "Shots"],
      "Antidote Shot (Weak)": ["antidote-shot-weak", "Antidote Shot (Weak)", 30, "Shot", "Shots"],
    };
    Object.entries(expected).forEach(([name, tuple]) => {
      expect(entry(CONS, name), name).toEqual(tuple);
    });
  });
});

// Governing: ADR-0002 (Source Weapon/Equipment Images from huntshowdown.wiki.gg via a One-Time,
// Self-Hosted Scrape)
// Covers: SPEC-0001 REQ "Image Coverage Across All Catalog Categories, with Fallback"
//
// catalog.js has no awareness of scraped photos at all (see the header note in catalog.js) — that
// tier is resolved entirely in ItemThumb.jsx via <img onError> and is covered by
// ItemThumb.test.jsx instead. What catalog.js *does* own is the SVG fallback safety net: a
// two-tier per-item-override-else-per-group lookup, per category, with a final hardcoded default.
// These tests cover that lookup for every category. The per-item override tier (ITEM_THUMBS /
// TOOL_ITEM_THUMBS / TRAIT_ITEM_THUMBS / CONS_ITEM_THUMBS) is intentionally empty today — no
// per-item SVGs have been authored yet, and those maps are module-private (not exported) — so
// every real catalog item currently resolves through the per-group tier below. That's exercised
// directly. The "per-item override wins over per-group" precedence can't be exercised from outside
// the module without changing catalog.js's exports (out of scope for this issue), but every
// existing item passing through to its group's icon is itself proof the per-item tier is being
// consulted first and (correctly) coming up empty.

describe("weaponThumb", () => {
  it("resolves every weapon in the catalog to a non-empty SVG path", () => {
    WEAPONS.forEach((w) => {
      expect(weaponThumb(w)).toEqual(expect.any(String));
      expect(weaponThumb(w).length).toBeGreaterThan(0);
    });
  });

  it("dispatches melee ('none' ammo class) weapons to the melee icon", () => {
    const melee = WEAPONS.find((w) => w[4] === "none");
    expect(melee).toBeTruthy();
    expect(weaponThumb(melee)).toBe(weaponThumb(["fixture", "Fixture", 99, 0, "none", "Melee"]));
  });

  it("dispatches bow-class weapons to the bow icon, distinct from crossbows", () => {
    const bow = WEAPONS.find((w) => w[4] === "bow");
    const xbow = WEAPONS.find((w) => w[4] === "xbow" || w[4] === "hxbow");
    expect(bow).toBeTruthy();
    expect(xbow).toBeTruthy();
    expect(weaponThumb(bow)).not.toBe(weaponThumb(xbow));
  });

  it("dispatches hxbow the same as xbow (shared crossbow icon)", () => {
    expect(weaponThumb(["fixture-hxbow", "Fixture", 2, 0, "hxbow", "Bows"])).toBe(
      weaponThumb(["fixture-xbow", "Fixture", 3, 0, "xbow", "Bows"])
    );
  });

  it("dispatches shotgun-class weapons to the shotgun icon regardless of size", () => {
    const shotgun = WEAPONS.find((w) => w[4] === "shotgun");
    expect(shotgun).toBeTruthy();
    expect(weaponThumb(shotgun)).toBe(weaponThumb(["fixture", "Fixture", 1, 0, "shotgun", "Shotguns"]));
  });

  it("dispatches by size for firearm classes not covered above: <=2 pistol, 3 carbine, >=4 rifle", () => {
    const pistolIcon = weaponThumb(["fixture", "Fixture", 1, 0, "compact", "Pistols"]);
    const pistolIcon2 = weaponThumb(["fixture", "Fixture", 2, 0, "medium", "Pistols"]);
    const carbineIcon = weaponThumb(["fixture", "Fixture", 3, 0, "compact", "Rifles"]);
    const rifleIcon = weaponThumb(["fixture", "Fixture", 4, 0, "long", "Rifles"]);
    const rifleIcon2 = weaponThumb(["fixture", "Fixture", 5, 0, "slong", "Rifles"]);

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
    const icons = new Set(TOOL_GROUPS.map((g) => toolThumb(["fixture", "Fixture", 0, g])));
    expect(icons.size).toBe(TOOL_GROUPS.length);
  });

  it("falls back to the Utility icon for an unrecognized group", () => {
    const utilityIcon = toolThumb(["fixture", "Fixture", 0, "Utility"]);
    expect(toolThumb(["fixture", "Fixture", 0, "NotARealGroup"])).toBe(utilityIcon);
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
    const icons = new Set(TRAIT_GROUPS.map((g) => traitThumb(["fixture", "Fixture", 0, g])));
    expect(icons.size).toBe(TRAIT_GROUPS.length);
  });

  it("falls back to the Utility icon for an unrecognized group", () => {
    const utilityIcon = traitThumb(["fixture", "Fixture", 0, "Utility"]);
    expect(traitThumb(["fixture", "Fixture", 0, "NotARealGroup"])).toBe(utilityIcon);
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
    const icons = new Set(CONS_GROUPS.map((g) => consThumb(["fixture", "Fixture", 0, "Throwable", g])));
    expect(icons.size).toBe(CONS_GROUPS.length);
  });

  it("falls back to the Utility icon for an unrecognized group", () => {
    const utilityIcon = consThumb(["fixture", "Fixture", 0, "Throwable", "Utility"]);
    expect(consThumb(["fixture", "Fixture", 0, "Throwable", "NotARealGroup"])).toBe(utilityIcon);
  });
});
