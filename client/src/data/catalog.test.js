import { describe, expect, it } from "vitest";
import { statFieldFor, statsFor } from "./itemStats.js";
import {
  AMMO,
  CONS,
  CONS_CAP_CATEGORIES,
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
import { descriptionFor } from "./itemStats.js";

// Governing: data-accuracy review issues #35-#40 (UP costs, missing weapons,
// ammo classes, Tools/Consumables rosters). These tests lock in the verified
// values so future catalog edits don't silently regress the fixes.

// Catalog tuples are id-first: [id, name, ...]. Look entries up by display name
// (tuple[1]) so these tests read naturally against the game's names while still
// asserting the stable id is present.
const entry = (arr, name) => arr.find((t) => t[1] === name);

// Governing: SPEC-0007, issue #365. Related: #351, #359, #355, #339.
//
// The WIRE-FORMAT GATE comment above `AMMO` in catalog.js (around lines 32-45) says an edit to
// `AMMO` or to any weapon's `ammoClass` needs a FORMAT_VERSION bump and a saved-selection
// migration, because a saved ammo selection persists as a bare INDEX into `AMMO[ammoClass]` — no
// bounds check trips when a pool is reordered or a weapon is re-pointed at a different pool, so the
// failure is a silently wrong price, not a crash. Before this file, that invariant was enforced by
// nothing but the comment: only two of 147 weapons' `ammoClass` values were asserted anywhere
// (loadoutCodec.test.js), and no test pinned `AMMO`'s actual contents at all. Mutation testing
// showed pool-index swaps, price tampering, and most ammoClass flips passing the full suite
// undetected — the shape of bugs #351 and #359 actually were.
//
// These two snapshots are deliberately literal, hardcoded values copied from the real catalog.js
// data (not vitest's `toMatchSnapshot()`, which is designed to be regenerated with `-u` and would
// let a silent index-remap through with a single flag). If either fails, the data changed — which
// is only safe with a FORMAT_VERSION bump (see loadoutCodec.js) and a migration for existing saved
// selections. Do not "fix" a failure here by updating the expected value; fix it by doing the
// migration the WIRE-FORMAT GATE comment requires, or by reverting the catalog change.
describe("the AMMO wire-format pin (WIRE-FORMAT GATE, catalog.js ~37-58)", () => {
  // Governing: issue #340. Updated 2026-08-16 to the post-#340 shape: every row now carries a
  // stable id as its first element (name shifted to [1], price to [2] — see the AMMO tuple shape
  // note in catalog.js's header), five rows that were priced for a Scarce round were corrected to
  // 0 (ADR-0013), and `special` gained nine rows instead of staying empty (ADR-0014). None of this
  // reorders or renumbers an EXISTING index within a pool — the array lengths and orders of the
  // eight previously-populated pools are byte-identical to before, and `special` went from empty
  // to populated, which the WIRE-FORMAT GATE comment already calls the one safe structural edit
  // (there is no existing index to move). So this pin is deliberately, consciously updated in the
  // same commit that changed the data — exactly what the comment above it asks for — rather than
  // silently regenerated.
  it("pins every AMMO pool's [id, name, price] contents, including the still-empty none pool", () => {
    // A failure here means AMMO's contents changed further — an insert, removal, or reorder that
    // moves an EXISTING index. Per the WIRE-FORMAT GATE comment in catalog.js, that requires a
    // FORMAT_VERSION bump and a saved-selection migration (a saved selection is a bare index into
    // this array, so reordering or renumbering silently re-points existing saved loadouts at a
    // different round).
    expect(AMMO, "AMMO pool contents changed — see the WIRE-FORMAT GATE comment in catalog.js and bump FORMAT_VERSION").toEqual({
      compact: [
        ["ammo-compact-fmj", "FMJ", 15],
        ["ammo-compact-high-velocity", "High Velocity", 13],
        ["ammo-compact-dumdum", "Dumdum", 0],
        ["ammo-compact-incendiary", "Incendiary", 18],
        ["ammo-compact-poison", "Poison", 16],
      ],
      medium: [
        ["ammo-medium-fmj", "FMJ", 22],
        ["ammo-medium-spitzer", "Spitzer", 60],
        ["ammo-medium-dumdum", "Dumdum", 0],
        ["ammo-medium-incendiary", "Incendiary", 24],
        ["ammo-medium-poison", "Poison", 21],
      ],
      long: [
        ["ammo-long-fmj", "FMJ", 30],
        ["ammo-long-spitzer", "Spitzer", 75],
        ["ammo-long-dumdum", "Dumdum", 34],
        ["ammo-long-incendiary", "Incendiary", 28],
      ],
      slong: [
        ["ammo-slong-fmj", "FMJ", 35],
        ["ammo-slong-spitzer", "Spitzer", 0],
        ["ammo-slong-incendiary", "Incendiary", 32],
      ],
      shotgun: [
        ["ammo-shotgun-slug", "Slug", 28],
        ["ammo-shotgun-flechette", "Flechette", 26],
        ["ammo-shotgun-penny-shot", "Penny Shot", 22],
        ["ammo-shotgun-dragon-breath", "Dragon Breath", 30],
        ["ammo-shotgun-starshell", "Starshell", 18],
      ],
      xbow: [
        ["ammo-xbow-explosive-bolt", "Explosive Bolt", 0],
        ["ammo-xbow-shot-bolt", "Shot Bolt", 30],
        ["ammo-xbow-poison-bolt", "Poison Bolt", 25],
      ],
      hxbow: [
        ["ammo-hxbow-chaos-bolt", "Chaos Bolt", 20],
        ["ammo-hxbow-concertina-bolt", "Concertina Bolt", 35],
        ["ammo-hxbow-choke-bolt", "Choke Bolt", 25],
      ],
      bow: [
        ["ammo-bow-frag-arrow", "Frag Arrow", 0],
        ["ammo-bow-concertina-arrow", "Concertina Arrow", 35],
        ["ammo-bow-poison-arrow", "Poison Arrow", 25],
      ],
      special: [
        ["ammo-special-dragon-breath-charge", "Dragon Breath Charge", 10],
        ["ammo-special-harpoon", "Harpoon", 5],
        ["ammo-special-steel-ball", "Steel Ball", 5],
        ["ammo-special-waxed-frag-charge", "Waxed Frag Charge", 50],
        ["ammo-special-incendiary-bolt", "Incendiary Bolt", 25],
        ["ammo-special-explosive-bolt", "Explosive Bolt", 0],
        ["ammo-special-dumdum", "Dumdum", 0],
        ["ammo-special-explosive", "Explosive", 0],
        ["ammo-special-shredder", "Shredder", 0],
      ],
      none: [],
    });
  });

  it("pins every weapon's id -> ammoClass mapping, all 147 rows", () => {
    // A failure here means some weapon's ammoClass changed (or a weapon was added/removed). Per the
    // WIRE-FORMAT GATE comment in catalog.js, changing a weapon's ammoClass has the exact same
    // migration shape as editing an AMMO pool — it re-points that weapon's saved ammo selections at
    // a different pool's index space — so this needs a FORMAT_VERSION bump too, on the terms the
    // comment already states.
    const idToAmmoClass = Object.fromEntries(WEAPONS.map((w) => [w[0], w[4]]));
    expect(WEAPONS, "WEAPONS row count changed — update this pin deliberately, in step with a FORMAT_VERSION bump if any ammoClass moved").toHaveLength(147);
    expect(idToAmmoClass, "a weapon's ammoClass changed — see the WIRE-FORMAT GATE comment in catalog.js and bump FORMAT_VERSION").toEqual({
      "nagant-m1895": "compact", "caldwell-conversion-pistol": "compact", "scottfield-model-3": "medium",
      "bornheim-no-3": "compact", "caldwell-pax": "medium", "hand-crossbow": "hxbow",
      "cavalry-saber": "none", "combat-axe": "none", "railroad-hammer": "none",
      "lemat-mark-ii": "compact", "sparks-pistol": "long", "caldwell-conversion-uppercut": "long",
      "nagant-officer-carbine": "compact", "hunting-bow": "bow", "dolch-96": "special",
      "springfield-1866": "medium", "winfield-m1873": "compact", "romero-77": "shotgun",
      "crossbow": "xbow", "frontier-73c": "compact", "bomb-lance": "none",
      "caldwell-rival-78": "shotgun", "vetterli-71-karabiner": "medium", "specter-1882": "shotgun",
      "slate": "shotgun", "sparks-lrr": "long", "martini-henry-ic1": "long",
      "winfield-1876-centennial": "medium", "berthier-1892": "slong", "drilling": "shotgun",
      "krag-m1894": "slong", "mosin-nagant-m1891": "slong", "lebel-1886": "slong",
      "crown-king-auto-5": "shotgun", "mosin-nagant-avtomat": "slong", "nitro-express": "special",
      "haymaker": "long", "1890-cavalry": "long", "1865-carbine": "medium",
      "auto-4-shorty": "shotgun", "baseball-bat": "none", "bomb-launcher": "special",
      "chu-ko-nu": "special", "infantry-73l": "compact", "machete": "none",
      "mako-1895": "long", "marathon": "compact", "maynard-sniper": "medium",
      "mosin-obrez": "slong", "new-army": "compact", "officer": "compact",
      "terminus": "shotgun", "vandal-73c": "compact", "flame-rifle": "special",
      "homestead-78": "shotgun", "shredder": "special", "wildland": "medium",
      "katana": "none", "1865-carbine-aperture": "medium", "1865-carbine-silencer": "medium",
      "berthier-1892-deadeye": "slong", "berthier-1892-marksman": "slong", "berthier-1892-riposte": "slong",
      "bornheim-no-3-extended": "compact", "bornheim-no-3-match": "compact", "bornheim-no-3-silencer": "compact",
      "centennial-pointman": "medium", "centennial-shorty": "medium", "centennial-shorty-silencer": "medium",
      "centennial-sniper": "medium", "centennial-trauma": "medium", "conversion-chain-pistol": "compact",
      "crossbow-deadeye": "xbow", "dolch-96-bullseye": "special", "dolch-96-claw": "special",
      "dolch-96-precision": "special", "drilling-hatchet": "shotgun", "drilling-shorty": "shotgun",
      "frontier-73c-marksman": "compact", "frontier-73c-silencer": "compact", "infantry-73l-bayonet": "compact",
      "infantry-73l-sniper": "compact", "krag-bayonet": "slong", "krag-silencer": "slong",
      "krag-sniper": "slong", "lebel-1886-aperture": "slong", "lebel-1886-marksman": "slong",
      "lebel-1886-talon": "slong", "lemat-carbine": "compact", "lemat-carbine-marksman": "compact",
      "mako-1895-aperture": "long", "mako-1895-claw": "long", "marathon-swift": "compact",
      "martini-henry-deadeye": "long", "martini-henry-ironside": "long", "martini-henry-marksman": "long",
      "martini-henry-riposte": "long", "maynard-sniper-silencer": "medium", "mosin-obrez-extended": "slong",
      "mosin-obrez-mace": "slong", "mosin-obrez-match": "slong", "mosin-obrez-sharpeye": "slong",
      "mosin-nagant-bayonet": "slong", "mosin-nagant-sniper": "slong", "nagant-m1895-deadeye": "compact",
      "nagant-m1895-precision": "compact", "nagant-m1895-silencer": "compact", "new-army-swift": "compact",
      "officer-brawler": "compact", "officer-carbine-deadeye": "compact", "pax-claw": "medium",
      "pax-trueshot": "medium", "ranger-73-aperture": "compact", "ranger-73-swift": "compact",
      "ranger-73-talon": "compact", "rival-78-mace": "shotgun", "rival-78-shorty": "shotgun",
      "rival-78-trauma": "shotgun", "romero-77-alamo": "shotgun", "romero-77-hatchet": "shotgun",
      "romero-77-shorty": "shotgun", "romero-77-talon": "shotgun", "scottfield-brawler": "medium",
      "scottfield-precision": "medium", "scottfield-spitfire": "medium", "scottfield-swift": "medium",
      "slate-riposte": "shotgun", "sparks-pistol-silencer": "long", "sparks-silencer": "long",
      "sparks-sniper": "long", "specter-1882-bayonet": "shotgun", "specter-1882-shorty": "shotgun",
      "springfield-1866-bayonet": "medium", "springfield-1866-bullseye": "medium", "springfield-1866-marksman": "medium",
      "springfield-1866-shorty": "medium", "springfield-1866-striker": "medium", "terminus-shorty": "shotgun",
      "uppercut-deadeye": "long", "uppercut-precision": "long", "vandal-73c-bullseye": "compact",
      "vandal-73c-striker": "compact", "vetterli-71-bayonet": "medium", "vetterli-71-cyclone": "medium",
      "vetterli-71-deadeye": "medium", "vetterli-71-marksman": "medium", "vetterli-71-silencer": "medium",
    });
  });
});

// Governing: issue #340, SPEC-0010 REQ "Ammo Rows Are Addressed by Stable Id" ("Every ammo round
// SHALL be an ordinary catalog row carrying a stable, slug-style identifier, unique within the ammo
// category"). Every OTHER category in this file has always carried unique, slug-style ids as its
// first tuple element; ammo did not, until #340. This is that category's guard, extended across all
// five now that ammo has ids too — not a new mechanism, the same one WEAPONS/TOOLS/CONS/TRAITS have
// always needed and never had a standing check for either.
describe("catalog id uniqueness and slug style", () => {
  // Matches slugify()'s output shape (client/src/utils/slugify.js): lowercase, digits, and single
  // hyphens, no leading/trailing hyphen. Ammo ids additionally carry an `ammo-{class}-` prefix
  // (ADR-0014), which is itself slug-style, so the same pattern covers both.
  const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

  const categories = {
    WEAPONS,
    TOOLS,
    CONS,
    TRAITS,
  };

  it.each(Object.entries(categories))("%s: every id is unique and slug-style", (_name, rows) => {
    const ids = rows.map((r) => r[0]);
    expect(new Set(ids).size, "duplicate id found").toBe(ids.length);
    const malformed = ids.filter((id) => !SLUG_RE.test(id));
    expect(malformed, "id(s) not in slug style").toEqual([]);
  });

  it("every AMMO id is unique across all ten pools and matches the ammo-{class}-{slug} convention", () => {
    const allRows = Object.entries(AMMO).flatMap(([ammoClass, rows]) => rows.map((r) => ({ ammoClass, id: r[0] })));
    const ids = allRows.map((r) => r.id);
    expect(new Set(ids).size, "duplicate ammo id found").toBe(ids.length);

    const malformed = ids.filter((id) => !SLUG_RE.test(id));
    expect(malformed, "ammo id(s) not in slug style").toEqual([]);

    // ADR-0014's convention: `ammo-{ammoClass}-{slugified round name}`. Asserted per row so a
    // future addition that mints an id in the wrong pool's namespace fails here rather than only
    // on a uniqueness collision (which a typo in the class segment could still dodge).
    const wrongPrefix = allRows.filter((r) => !r.id.startsWith(`ammo-${r.ammoClass}-`)).map((r) => r.id);
    expect(wrongPrefix, "ammo id(s) not prefixed with their own pool's ammo-{class}- namespace").toEqual([]);
  });
});

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

  // Governing: issue #340 (superseding #373), ADR-0013, ADR-0014. Related: #361, #233, #254.
  //
  // #373 pinned AMMO.special as empty, on the claim that every special-class weapon has no
  // purchasable round. #340 corrected that claim: it was false for two of the nine (Bomb Launcher,
  // Chu Ko Nu sell rounds for Hunt Dollars) and incomplete for another three (Dolch 96 and its
  // variants, and Nitro Express, whose Scarce rounds should be selectable at 0 under ADR-0013,
  // not omitted). See the block comment above AMMO.special in catalog.js for the full sourcing.
  //
  // This test now pins the OPPOSITE invariant #373 pinned: the membership list is unchanged (still
  // the same nine weapons), but the pool itself is no longer empty, and every row's cost is
  // consistent with ADR-0013 — zero iff the round is Scarce.
  it("keeps AMMO.special's membership list, but the pool is no longer empty (#340)", () => {
    const specialWeapons = WEAPONS.filter((w) => w[4] === "special").map((w) => w[0]);
    expect(specialWeapons.sort()).toEqual(
      [
        "dolch-96",
        "dolch-96-bullseye",
        "dolch-96-claw",
        "dolch-96-precision",
        "nitro-express",
        "bomb-launcher",
        "chu-ko-nu",
        "flame-rifle",
        "shredder",
      ].sort(),
    );
    expect(specialWeapons.length).toBeGreaterThan(0);
    // The substantive claim #340 corrects: Bomb Launcher and Chu Ko Nu do sell rounds, so the pool
    // that serves them must not be empty.
    expect(AMMO.special.length).toBeGreaterThan(0);
    expect(AMMO.special.map((r) => r[0]).sort()).toEqual(
      [
        "ammo-special-dragon-breath-charge",
        "ammo-special-harpoon",
        "ammo-special-steel-ball",
        "ammo-special-waxed-frag-charge",
        "ammo-special-incendiary-bolt",
        "ammo-special-explosive-bolt",
        "ammo-special-dumdum",
        "ammo-special-explosive",
        "ammo-special-shredder",
      ].sort(),
    );
    // ADR-0013 both ways: the four Bomb Launcher rounds and Chu Ko Nu's Incendiary Bolt are
    // purchasable (nonzero); the rest are Scarce rounds carried at 0.
    const purchasable = ["Dragon Breath Charge", "Harpoon", "Steel Ball", "Waxed Frag Charge", "Incendiary Bolt"];
    const scarce = ["Explosive Bolt", "Dumdum", "Explosive", "Shredder"];
    AMMO.special.forEach((row) => {
      if (purchasable.includes(row[1])) expect(row[2], row[1]).toBeGreaterThan(0);
      if (scarce.includes(row[1])) expect(row[2], row[1]).toBe(0);
    });
  });

  // Bomb Lance is the known, deliberately-not-fixed gap #340 leaves open: it sells the same four
  // rounds as Bomb Launcher (same source, docs/reports/suggested-adrs.md § A6) but is still typed
  // `ammoClass: "none"`, so it draws from no pool at all. Reclassifying it is a WIRE-FORMAT-GATED
  // ammoClass change that belongs to the per-weapon compatibility work (#341+), not this story —
  // pinned here so the gap is visible rather than silently assumed closed.
  it("still types Bomb Lance as ammoClass none — a known gap #340 does not close", () => {
    expect(entry(WEAPONS, "Bomb Lance")[4]).toBe("none");
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

// Governing: #155 (Placeable consumables), ADR-0015 (four per type, accepted 2026-08-12),
// SPEC-0006 REQ "Capacity Rules Are Stated Once and Preserved"
//
// The issue that produced these rows described `type` as a rules input — "calc.js's catCount() counts
// equipped consumables by it" — and for a while the cap was per specific consumable (#190), which made
// the field display-only and made these tests pin what the cap is NOT. ADR-0015 reversed that: the cap
// is four per TYPE again, and `type` IS a rules input. These tests now pin what the field IS (data,
// a badge colour, and the cap key), and the fifth-Placeable test asserts the NEW rule: four of one
// Placeable means a fifth Placeable — even a different item — is rejected.
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
    // Governing: SPEC-0006 REQ "Capacity Rules Are Stated Once and Preserved" — a row typed outside
    // the declared categories is a DATA ERROR, because `type` is the cap key.
    //
    // Pinned to CONS_CAP_CATEGORIES, the list the cap actually reads. It used to pin to CONS_TYPES,
    // which is the narrower badge-palette subset — so a legitimate `Tarot Cards` row would have
    // failed this assertion as a data error on the very day the roster admitted one, contradicting
    // the requirement's "no new modelling" scenario.
    const undeclared = CONS.filter((c) => !CONS_CAP_CATEGORIES.includes(c[3])).map((c) => `${c[0]}:${c[3]}`);
    expect(undeclared).toEqual([]);
  });

  it("keeps the badge palette a subset of the cap vocabulary (SPEC-0006)", () => {
    // The two lists have different jobs and different lifetimes: CONS_CAP_CATEGORIES is the rule
    // vocabulary the cap reads, CONS_TYPES the categories with rows a player can see on a badge.
    // What must never drift is the direction of containment — a type that can appear on screen but
    // is invisible to the cap is precisely the bug the single-list rewrite removed.
    expect(CONS_TYPES.every((t) => CONS_CAP_CATEGORIES.includes(t))).toBe(true);
    // NOT strict, and the difference is load-bearing. `toBeLessThan` here would encode "Tarot Cards
    // has no rows" as a permanent fact: admitting one forces it into CONS_TYPES (the assertion
    // below), which makes both lists length 4 and fails a strict comparison — reproducing the very
    // tripwire this test's own governing requirement forbids ("no new modelling" the moment rows
    // are admitted). Equal lengths are the legitimate end state, so only EXCEEDING is a defect.
    expect(CONS_TYPES.length).toBeLessThanOrEqual(CONS_CAP_CATEGORIES.length);
    // Every cap category that HAS rows must be in the palette, or its badge falls back to
    // Throwable's colour and reads as a different category than it is.
    const withRows = [...new Set(CONS.map((c) => c[3]))];
    expect(withRows.every((t) => CONS_TYPES.includes(t))).toBe(true);
  });

  it("caps an undeclared type instead of letting it escape (SPEC-0006)", async () => {
    // SPEC-0006: a row typed outside the declared categories "SHALL be treated as a data error
    // rather than silently escaping the cap". The assertion above stops one reaching production;
    // this asserts what happens if one does. Every undeclared type shares ONE budget, so a typo
    // cannot mint four fresh slots and two typos cannot mint eight.
    const { capCategoryOf, consAllowed, consCategoryCount, UNDECLARED_CATEGORY } = await import("../utils/calc.js");

    // The resolution rule itself, tested against types the catalog does not contain — which is the
    // only way to distinguish "resolve through the declared list" from "group by whatever `type`
    // says". Reached through a catalog row it is indistinguishable, because every row is declared.
    expect(capCategoryOf("Shot")).toBe("Shot");
    expect(capCategoryOf("Tarot Cards")).toBe("Tarot Cards"); // declared with no rows — still itself
    expect(capCategoryOf("Bogus")).toBe(UNDECLARED_CATEGORY);
    expect(capCategoryOf("Shots")).toBe(UNDECLARED_CATEGORY); // the plural typo, not the category
    expect(capCategoryOf("Bogus")).toBe(capCategoryOf("Shots")); // one budget, not two
    expect(capCategoryOf(undefined)).toBe(UNDECLARED_CATEGORY);

    const bogus = CONS.findIndex((c) => !CONS_CAP_CATEGORIES.includes(c[3]));
    // No such row exists (that is the point of the assertion above), so drive the predicate with a
    // synthetic index instead: an out-of-range index has no row and therefore no declared type.
    expect(bogus).toBe(-1);
    const ghost = CONS.length + 1;
    const held = (n) => ({ equip: Array.from({ length: 8 }, (_, k) => (k < n ? { t: "C", i: ghost } : null)) });
    expect(consCategoryCount(held(3), ghost)).toBe(3);
    expect(consAllowed(held(3), ghost)).toBe(true);
    expect(consAllowed(held(4), ghost)).toBe(false);
    // A second undeclared value shares that same budget rather than opening its own.
    const otherGhost = CONS.length + 2;
    expect(consAllowed(held(4), otherGhost)).toBe(false);
  });

  it("gives every type its own badge colour", () => {
    // Two copies of a `type === "Shot" ? olive : rust` conditional would have rendered Placeable
    // identically to Throwable — a distinction the user cannot see is not a distinction.
    const colors = CONS_TYPES.map((t) => CONS_TYPE_COLOR[t]);
    expect(colors.filter(Boolean)).toHaveLength(CONS_TYPES.length);
    expect(new Set(colors).size).toBe(CONS_TYPES.length);
    expect(new Set([...colors, TOOL_COLOR]).size).toBe(CONS_TYPES.length + 1);
  });

  it("caps four per TYPE: a fifth Placeable — even a different item — is rejected", async () => {
    // Governing: ADR-0015, SPEC-0006 REQ "Capacity Rules Are Stated Once and Preserved",
    // SPEC-0008 (the generator obeys the same cap). The assertion #190 used to demand ("a 5th
    // Placeable is rejected") is the rule now: four Ammo Boxes sit in the Placeable budget, so a
    // Tool Box — a different specific item, same type — is refused by the reducer's gate. This
    // test asserts the REDUCER's acceptance, mirroring the acceptance criteria's "a reducer test
    // asserts a fifth Placeable is rejected, and ... a Stamina Shot after four Vitality Shots."
    const { configureStore } = await import("@reduxjs/toolkit");
    const { default: loadoutReducer, loadoutActions } = await import("../store/loadoutSlice.js");
    const store = configureStore({ reducer: { loadout: loadoutReducer } });
    const placeables = CONS.map((c, i) => ({ c, i })).filter((x) => x.c[3] === "Placeable");
    expect(placeables.length).toBeGreaterThanOrEqual(3);
    const [ammoBox, toolBox] = placeables;
    for (let k = 0; k < 4; k++) store.dispatch(loadoutActions.addEquip({ t: "C", i: ammoBox.i }));
    expect(store.getState().loadout.equip.filter(Boolean)).toHaveLength(4);
    store.dispatch(loadoutActions.addEquip({ t: "C", i: toolBox.i }));
    expect(store.getState().loadout.equip.filter(Boolean)).toHaveLength(4);
    expect(store.getState().loadout.equip.filter(Boolean).some((e) => e.i === toolBox.i)).toBe(false);
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
    // Compare against the other buckets, not against all of them: a max taken over `Utility` itself
    // is a tautology, and the assertion would pass for every dataset it exists to catch.
    const counts = tally(TOOLS, 3);
    const largestOther = Math.max(
      ...Object.entries(counts).filter(([g]) => g !== "Utility").map(([, n]) => n),
    );
    expect(counts.Utility, "#166's regression — Utility is the catch-all again").toBeLessThanOrEqual(largestOther);
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
    // Why Choke Bombs stayed in Utility: every Throwing member's description carries "can be retrieved
    // and reused", and that rule — not today's three names — is what the group means. Asserted against
    // the scraped descriptions so a fourth genuinely retrievable weapon can join without failing, and
    // so an unretrievable one fails with a message that says which rule it broke.
    const throwing = TOOLS.filter((t) => t[3] === "Throwing");
    expect(throwing.length).toBeGreaterThanOrEqual(3);
    const unretrievable = throwing
      .filter((t) => !/can be retrieved and reused/i.test(descriptionFor(t[0]) ?? ""))
      .map((t) => t[1]);
    expect(unretrievable, "Throwing means retrievable — the group's rule, not its roster").toEqual([]);
    expect(entry(TOOLS, "Choke Bombs")[3]).toBe("Utility");
  });
});

// Governing: ADR-0005 (Scrape Item Stats into a Generated, Committed Data File — every wiki value
// measured below is read through `statFieldFor` off the generated itemStats.json, so this suite is
// bound to that contract as much as to the taxonomy argument), #162 (closing #42), audit §D.2,
// SPEC-0007 REQ "Fields the Scraper Must Not Derive"
//
// The TRAIT_GROUPS rationale, pinned to the measurements it rests on rather than left as prose. The
// comment above TRAIT_GROUPS argues the wiki's functional scheme would be a WORSE affordance than the
// app's own five buckets, and that is a claim about data — so it should fail if the data stops
// supporting it, instead of aging quietly into a confident-sounding paragraph.
describe("the TRAIT_GROUPS taxonomy rationale", () => {
  const share = (counts) => {
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return Math.max(...Object.values(counts)) / total;
  };
  const tally = (values) => values.reduce((acc, v) => ({ ...acc, [v]: (acc[v] ?? 0) + 1 }), {});

  // The wiki's single-valued primary function, as scraped. Read from the dataset rather than restated,
  // so this measures the wiki rather than a transcription of it.
  const wikiCategories = TRAITS.map((t) => statFieldFor(t[0], "Category")).filter(Boolean);

  it("has a wiki category for every trait, so the comparison is not made on a subset", () => {
    expect(wikiCategories).toHaveLength(TRAITS.length);
  });

  it("offers four values where the UI needs five", () => {
    // Reason 1 in the comment: no Stealth bucket and no Medical bucket exist upstream, so adopting the
    // scheme deletes two sections rather than re-sorting the roster.
    const distinct = [...new Set(wikiCategories)].sort();
    expect(distinct).toEqual(["Defensive", "Movement", "Offensive", "Supportive"]);
    expect(distinct.length).toBeLessThan(TRAIT_GROUPS.length);
  });

  it("would concentrate the roster far more than the app's own buckets do", () => {
    // Reason 2, and the one that decides it. `Supportive` is the wiki's catch-all; if it ever stops
    // being lopsided, the argument for hand-authoring these names weakens and this should be revisited.
    //
    // Pinned to the exact counts, not just to `lopsided > even`. The comment PRINTS a table, so the
    // table is what has to fail — a share threshold alone lets every number in it drift while both
    // assertions stay green, which is how a printed distribution ages quietly into being wrong.
    expect(tally(wikiCategories)).toEqual({
      Supportive: 30, Offensive: 12, Defensive: 10, Movement: 6,
    });
    expect(tally(TRAITS.map((t) => t[3]))).toEqual({
      Combat: 15, Medical: 16, Mobility: 5, Stealth: 8, Utility: 14,
    });
    const wikiShare = share(tally(wikiCategories));
    const appShare = share(tally(TRAITS.map((t) => t[3])));
    expect(wikiShare).toBeGreaterThan(0.5);
    expect(appShare).toBeLessThan(wikiShare);
  });

  it("carries a second functional value in a field `group` cannot hold", () => {
    // Reason 3 — the half of it this repo's data can actually decide. `Solo` and `Catalyst` are on
    // SPEC-0007's functional axis alongside the four `Category` values, but they arrive in their own
    // infobox field, so these four traits carry two functional labels at once against one section
    // header.
    //
    // The OTHER half of reason 3 — "no trait is both Offensive and Defensive" — is deliberately not
    // asserted here, and its absence is the point. `scrape-stats.mjs` persists only the acquisition
    // axis, so the sole committed evidence is the single-valued `Category` string: a test against it
    // could only ever pass, which would make it a decoration rather than a check. The comment above
    // TRAIT_GROUPS states that claim as a 43-of-58 probe for the same reason.
    const conditional = (id) => statFieldFor(id, "ConditionalEffect");
    expect(["beastface", "vigilant"].map(conditional)).toEqual(["Catalyst", "Catalyst"]);
    expect(["necromancer", "conduit"].map(conditional)).toEqual(["Solo", "Solo"]);
    for (const id of ["beastface", "vigilant", "necromancer", "conduit"]) {
      expect(statFieldFor(id, "Category")).toBe("Supportive");
    }
  });

  it("assigns every trait to a declared group", () => {
    const undeclared = TRAITS.filter((t) => !TRAIT_GROUPS.includes(t[3])).map((t) => t[0]);
    expect(undeclared).toEqual([]);
  });
});

// Governing: ADR-0013 (Scarce items are selectable at zero cost), SPEC-0007 REQ "Roster Coverage Is
// Reported Against the Wiki's Own Categories". Closes the documentation half of #161 and #37.
//
// The roster boundary above CONS, made checkable. Prose alone failed three times here: the exclusion
// was justified as "a limited-time event item" (077e747), whose own revisit trigger fired at Update
// 2.8.1; then as "unpurchasable with Hunt Dollars", which ADR-0013 turned into a cost of zero; then
// as a bare scope choice, which #37 reversed. A comment cannot notice when its reason expires; a test
// can at least make the decision visible to whoever changes the data.
//
// These now assert ADMISSION rather than exclusion (#37). The shape is deliberately the same — the
// point was never which way the boundary ran, it was that the boundary is pinned rather than argued.
describe("the Tarot Card roster boundary", () => {
  // The fourteen, from a discovery crawl rather than from memory. Each states its price as the
  // literal word "Scarce", which is why they land in the coverage report's `unpurchasable` bucket.
  const TAROT_CARDS = [
    "The Chariot", "The Devil", "The Empress", "The Fool", "The Garden", "The Hanged Man",
    "The High Priestess", "The Judgement", "The Magician", "The Moon", "The Pathfinder",
    "The Sun", "The Tower", "The World",
  ];

  it("carries all fourteen in CONS, under their own cap category and group", () => {
    const missing = TAROT_CARDS.filter((name) => !CONS.some((c) => c[1] === name));
    expect(missing, "the fourteen were admitted by #37 — a missing one is a regression").toEqual([]);
    // Type is the cap key and group is the picker heading; both must be the Tarot Cards value, or
    // the cards fall back into another category's budget or another group's list.
    const rows = CONS.filter((c) => TAROT_CARDS.includes(c[1]));
    expect(rows.map((c) => c[3])).toEqual(Array(14).fill("Tarot Cards"));
    expect(rows.map((c) => c[4])).toEqual(Array(14).fill("Tarot Cards"));
    expect(CONS_CAP_CATEGORIES).toContain("Tarot Cards");
    expect(CONS_GROUPS).toContain("Tarot Cards");
  });

  it("accounts for the full gap against the wiki's 54 consumable pages", () => {
    // 44 rows + 10 tombstones = 54, and 0 actually missing. The fourteen moved from the gap into the
    // table (#37), so the arithmetic that used to read 30 + 14 + 10 now reads 44 + 10. Pinning the
    // row count means a future addition has to restate the arithmetic rather than quietly breaking it.
    expect(CONS).toHaveLength(44);
    expect(CONS.length + 10).toBe(54);
  });

  it("pairs every card's cost of 0 with the scrape's own Scarce evidence, in both directions", () => {
    // The assertion that replaces "is a scope decision, not an unpurchasability rule" (#37). Same
    // predicate itemStats.test.js applies to the twelve Scarce rows that preceded these: a wiki page
    // stating its price as the literal word "Scarce" is refused by the strict parser and recorded as
    // `purchasable: false`, which is what makes a hand-authored 0 evidenced rather than asserted.
    const evidencedUnpurchasable = (record) =>
      Boolean(record) &&
      ((record.acquisitionClasses ?? []).includes("Scarce") || record.purchasable === false);
    const rows = CONS.filter((c) => TAROT_CARDS.includes(c[1]));
    expect(rows, "neither direction can pass vacuously").toHaveLength(14);
    // Forward: a card costs 0, so it must be evidenced. Catches a price that quietly appears.
    expect(rows.filter((c) => c[2] === 0).map((c) => c[0]).filter((id) => !evidencedUnpurchasable(statsFor(id)))).toEqual([]);
    // Reverse: a card is evidenced unpurchasable, so it must cost 0. Catches a re-scrape that leaves
    // a stale non-zero cost nothing else objects to.
    expect(rows.filter((c) => evidencedUnpurchasable(statsFor(c[0]))).filter((c) => c[2] !== 0).map((c) => c[0])).toEqual([]);
  });

  it("keeps the twelve older Scarce rows, which is the precedent the cards rest on", () => {
    // The assertion that keeps the retired rationale from creeping back. If "unpurchasable" were the
    // criterion, these twelve rows could not exist — they are Scarce items carried at cost 0 under
    // ADR-0013, and itemStats.test.js asserts that pairing in both directions.
    const weaponsAtZero = WEAPONS.filter((w) => w[3] === 0);
    const traitsAtZero = TRAITS.filter((t) => t[2] === 0);
    // Counted, not merely non-empty. The claim the boundary comment rests on is that unpurchasable
    // items ARE in this file, so the numbers it quotes have to be the numbers the data holds — a
    // shrinking count is the shape of the retired rationale returning one row at a time. The split is
    // pinned too, because the twelve arrived on two different axes (#233 for weapons, #157 for
    // traits) and either could be undone alone.
    expect(weaponsAtZero).toHaveLength(4);
    expect(traitsAtZero).toHaveLength(8);
    expect(weaponsAtZero.length + traitsAtZero.length).toBe(12);
  });
});
