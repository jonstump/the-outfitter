import { describe, expect, it } from "vitest";
import { consCount } from "../utils/calc.js";
import {
  CONS,
  CONS_GROUPS,
  CONS_TYPES,
  CONS_TYPE_COLOR,
  TOOLS,
  TOOL_COLOR,
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
    expect(entry(TOOLS, "Derringer Pennyshot")).toEqual(["derringer-pennyshot", "Derringer Pennyshot", 63, "Sidearms"]);
  });

  it("adds the missing consumables and Weak-shot variants (#37)", () => {
    const expected = {
      "Ammo Box": ["ammo-box", "Ammo Box", 65, "Placeable", "Utility"],
      "Tool Box": ["tool-box", "Tool Box", 70, "Placeable", "Utility"],
      "Hellfire Bomb": ["hellfire-bomb", "Hellfire Bomb", 70, "Throwable", "Explosives"],
      "Waxed Dynamite Stick": ["waxed-dynamite-stick", "Waxed Dynamite Stick", 24, "Throwable", "Explosives"],
      "Dark Dynamite Satchel": ["dark-dynamite-satchel", "Dark Dynamite Satchel", 100, "Throwable", "Explosives"],
      "Poison Bomb": ["poison-bomb", "Poison Bomb", 25, "Throwable", "Gas"],
      "Medical Pack": ["medical-pack", "Medical Pack", 35, "Placeable", "Shots"],
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

  it("carries Choke Bombs once, as a Tool (#67)", () => {
    // The catalog listed the same item twice: "Choke Bombs" under Tools and a stale
    // "Choke Bomb" under Consumables, which had no wiki page and let a player fill a
    // consumable slot with something the game only offers as a tool.
    expect(entry(TOOLS, "Choke Bombs")).toEqual(["choke-bombs", "Choke Bombs", 25, "Utility"]);
    expect(CONS.some((c) => c[0] === "choke-bomb")).toBe(false);
    expect(CONS.some((c) => c[1] === "Choke Bomb")).toBe(false);
  });
});

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

// Governing: #155 (Placeable consumables), SPEC-0008 (the cap is per specific consumable)
//
// The issue that produced these rows described `type` as a rules input — "calc.js's catCount() counts
// equipped consumables by it" — and by the time it was fixed that was no longer true. #190 replaced
// the per-type cap with per-item `consCount`, and its "Done means" asked for a test that "a 5th
// Placeable is rejected", which would have reintroduced the retired rule. These tests pin what the
// field IS (data, and a badge colour) and what the cap is NOT (per type).
describe("consumable type", () => {
  const typeOf = (name) => entry(CONS, name)[3];

  it("files the three placeables the wiki files as Placeable", () => {
    // All three are Category:Placeable_Consumables. Medical Pack is the instructive one: the wiki has
    // it under both Placeable Consumables (a cap category) and Healing Consumables (an effect
    // category), and the app had taken the effect one and written it into `type`.
    expect(typeOf("Ammo Box")).toBe("Placeable");
    expect(typeOf("Tool Box")).toBe("Placeable");
    expect(typeOf("Medical Pack")).toBe("Placeable");
  });

  it("keeps Medical Pack's UI group, which was never wrong", () => {
    // `group` is the picker bucket and is a separate field from `type`. Only `type` was misfiled.
    expect(entry(CONS, "Medical Pack")[4]).toBe("Shots");
  });

  it("uses only declared types", () => {
    const undeclared = CONS.filter((c) => !CONS_TYPES.includes(c[3])).map((c) => `${c[0]}:${c[3]}`);
    expect(undeclared).toEqual([]);
  });

  it("gives every type its own badge colour", () => {
    // Two copies of a `type === "Shot" ? olive : rust` conditional would have rendered Placeable
    // identically to Throwable — a distinction the user cannot see is not a distinction.
    const colors = CONS_TYPES.map((t) => CONS_TYPE_COLOR[t]);
    expect(colors.filter(Boolean)).toHaveLength(CONS_TYPES.length);
    expect(new Set(colors).size).toBe(CONS_TYPES.length);
    expect(new Set([...colors, TOOL_COLOR]).size).toBe(CONS_TYPES.length + 1);
  });

  it("does not let type become a cap bucket again", () => {
    // The regression this issue's own stale description invited. SPEC-0008: "counted per specific
    // consumable rather than per consumable type". Four of one Placeable plus four of another is
    // legal, and so is a fifth Placeable that is a different item — what is capped is the item.
    const placeables = CONS.map((c, i) => ({ c, i })).filter((x) => x.c[3] === "Placeable");
    expect(placeables.length).toBeGreaterThanOrEqual(3);
    const equip = placeables.flatMap((x) => Array.from({ length: 4 }, () => ({ t: "C", i: x.i })));
    const loadout = { equip };
    for (const x of placeables) {
      expect(consCount(loadout, x.i)).toBe(4);
    }
    expect(equip.length).toBeGreaterThan(4);
  });
});

// Governing: #166 (splitting TOOL_GROUPS' Utility bucket), audit §D.2
//
// The split's own success condition, kept as a standing check. #166's "Done means" was "no
// TOOL_GROUPS bucket exceeds ~5 members", and a one-time reassignment satisfies that for exactly as
// long as nobody adds a tool. `Utility` reached 9 of 22 by accretion, one defensible addition at a
// time, which is how a category becomes a catch-all without any single edit looking wrong.
describe("the tool group balance", () => {
  const tally = (rows, index) => rows.reduce((acc, r) => ({ ...acc, [r[index]]: (acc[r[index]] ?? 0) + 1 }), {});

  it("keeps every bucket at or under five members", () => {
    const counts = tally(TOOLS, 3);
    const oversized = Object.entries(counts).filter(([, n]) => n > 5).map(([g, n]) => `${g} (${n})`);
    expect(oversized, "#166's threshold — split the bucket or justify raising this").toEqual([]);
  });

  it("no longer lets Utility hold the largest share", () => {
    // The specific regression: Utility was the catch-all at 9 of 22. It is a remainder now, and if it
    // ever becomes the biggest bucket again that is the signal the accretion has restarted.
    const counts = tally(TOOLS, 3);
    const largest = Math.max(...Object.values(counts));
    expect(counts.Utility).toBeLessThanOrEqual(largest);
    expect(counts.Utility).toBeLessThan(9);
  });

  it("assigns every tool to a declared group", () => {
    const undeclared = TOOLS.filter((t) => !TOOL_GROUPS.includes(t[3])).map((t) => t[0]);
    expect(undeclared).toEqual([]);
  });

  it("leaves no declared group empty", () => {
    // A name with no members is a filter button that shows nothing — the opposite failure from a
    // catch-all, and just as easy to create while splitting.
    const counts = tally(TOOLS, 3);
    const empty = TOOL_GROUPS.filter((g) => !counts[g]);
    expect(empty).toEqual([]);
  });

  it("groups the three Decoys together and the two derringers together", () => {
    // The two cuts are meant to be self-evident from the names; asserted so a later edit has to
    // disagree on purpose.
    const groupOf = (name) => entry(TOOLS, name)[3];
    expect(["Decoys", "Blank Fire Decoys", "Decoy Fuses"].map(groupOf)).toEqual(["Decoys", "Decoys", "Decoys"]);
    expect(["Quad Derringer", "Derringer Pennyshot"].map(groupOf)).toEqual(["Sidearms", "Sidearms"]);
  });

  it("keeps Throwing to retrievable projectile weapons", () => {
    // Why Choke Bombs stayed in Utility: every Throwing member's description ends "Can be retrieved
    // and reused", and that rule is what the group means.
    const throwing = TOOLS.filter((t) => t[3] === "Throwing").map((t) => t[1]);
    expect(throwing).toEqual(["Throwing Knives", "Throwing Axes", "Throwing Spear"]);
    expect(entry(TOOLS, "Choke Bombs")[3]).toBe("Utility");
  });
});
