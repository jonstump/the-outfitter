import { describe, expect, it } from "vitest";
import { QM, WEAPONS } from "../data/catalog.js";
import { capMax, capUsed, slotMax, totalCost, upTotal, weaponSize } from "./calc.js";

// Governing: issue #26 (calc.js reads the post-refactor catalog tuples)
//
// These assert the derived-math functions against the real catalog tuple shapes
// (weapon [id,name,size,cost,ammoClass,group], tool/consumable [id,name,cost,...])
// so a stale array-index reference can't silently corrupt budget math again.

function loadoutWith(overrides) {
  return {
    weapons: [null, null],
    equip: [],
    traits: [],
    blocked: 0,
    ...overrides,
  };
}

describe("totalCost", () => {
  // The literals below are catalog values, deliberately written out rather than derived from the
  // catalog — deriving them would make the assertions tautological and hide exactly the
  // string-concatenation bug the second test is named for. They were last reconciled against the
  // wiki by `scrape-stats.mjs --write-catalog` (#195).
  it("counts weapon cost and optional ammo cost", () => {
    const lo = loadoutWith({ weapons: [{ i: 0, a: -1 }] }); // Nagant M1895 = $24
    expect(totalCost(lo)).toBe(24);
    lo.weapons[0].a = 0; // FMJ tier-1 = $15
    expect(totalCost(lo)).toBe(39);
  });

  it("sums tool and consumable costs numerically, not by concatenation", () => {
    const lo = loadoutWith({
      equip: [
        { t: "T", i: 0 }, // First Aid Kit = $30
        { t: "C", i: 0 }, // Vitality Shot = $85
      ],
    });
    // 115, not "3085" — the whole point of this assertion.
    expect(totalCost(lo)).toBe(115);
  });

  it("returns 0 for an empty loadout", () => {
    expect(totalCost(loadoutWith({}))).toBe(0);
  });

  // Governing: ADR-0009 (index is the cell, null is empty), SPEC-0006 REQ "Equipment
  // Occupies a Fixed Eight-Cell Grid". `equip` is a fixed eight-cell grid, so a
  // packed-array totalCost would charge holes as items — silently, producing
  // plausible numbers. The assertions below pin the with-gaps behaviour.
  it("ignores empty cells in the sparse grid when totalling", () => {
    // First Aid Kit ($30) at cell 2, Vitality Shot ($85) at cell 6, holes elsewhere.
    const lo = loadoutWith({
      equip: [null, null, { t: "T", i: 0 }, null, null, null, { t: "C", i: 0 }, null],
    });
    expect(totalCost(lo)).toBe(115);
  });

  it("ignores a high-cell item when low cells are empty", () => {
    const lo = loadoutWith({ equip: [null, null, null, null, null, null, null, { t: "C", i: 0 }] });
    // Only the Vitality Shot at cell 7 is charged.
    expect(totalCost(lo)).toBe(85);
  });

  // Governing: issue #201. This used to index the ammo pool unguarded, so a loadout whose
  // ammo index does not name a variant threw here instead of costing nothing — and totalCost
  // runs on every render, which is what turned a bad share link into a blank page.
  it("charges no ammo for an index its weapon's pool does not have", () => {
    const compact = WEAPONS.findIndex((w) => w[4] === "compact");
    expect(totalCost(loadoutWith({ weapons: [{ i: compact, a: 9999 }] }))).toBe(WEAPONS[compact][3]);

    // Governing: issue #340. `special` weapons used to have no purchasable variants at all — an
    // empty pool, not a short one — but #340 populated AMMO.special with nine rows (see the block
    // comment above AMMO.special in catalog.js), so index 0 now resolves to a real, priced round
    // for a special-class weapon. `none`-class (melee) weapons are the ones still genuinely
    // ammo-less; the assertion moves there to keep testing "a truly empty pool clamps to no ammo".
    const none = WEAPONS.findIndex((w) => w[4] === "none");
    expect(totalCost(loadoutWith({ weapons: [{ i: none, a: 0 }] }))).toBe(WEAPONS[none][3]);
  });
});

describe("upTotal / slotMax", () => {
  it("sums trait UP costs by stable id", () => {
    const lo = loadoutWith({ traits: ["quartermaster", "fanning"] }); // 8 + 8
    expect(upTotal(lo)).toBe(16);
  });

  it("derives slot count from blocked cells", () => {
    // Governing: ADR-0009, SPEC-0006 REQ "Cells Are Individually Blockable". `blocked`
    // is an array of cell indices (not a count), so availability is 8 minus the number
    // of blocked cells.
    expect(slotMax(loadoutWith({}))).toBe(8);
    expect(slotMax(loadoutWith({ blocked: [0, 1, 2] }))).toBe(5);
  });
});

// Governing: SPEC-0009 REQ "The Weapon Budget Is Five Points, Six With Quartermaster",
// REQ "Occupied Capacity Is the Sum of Entry Sizes", ADR-0023.
//
// These pin the weapon-size budget rules SPEC-0009 Part A codified:
//   - capacity is 5, or 6 with the real Quartermaster trait;
//   - occupied capacity is the sum of the catalog sizes of the held entries.
//
// Weapon sizes are read from `WEAPONS[i][2]` rather than hardcoded so a catalog
// rebalance fails a test instead of silently invalidating one, and Quartermaster is
// the real catalog id (`QM`) so a rename breaks the pin rather than passing through
// a hand-written string that stopped meaning anything.
describe("SPEC-0009: the weapon budget", () => {
  it("holds exactly two weapon entries in a fresh loadout, both null", () => {
    const fresh = loadoutWith({});
    expect(fresh.weapons).toHaveLength(2);
    expect(fresh.weapons[0]).toBeNull();
    expect(fresh.weapons[1]).toBeNull();
    // The budget rule this pins: an empty grid occupies none of the five points.
    expect(capUsed(fresh)).toBe(0);
  });

  it("is 5 points with no Quartermaster and 6 with the real Quartermaster trait", () => {
    const noTrait = loadoutWith({});
    expect(capMax(noTrait)).toBe(5);

    const withQM = loadoutWith({ traits: [QM] });
    expect(capMax(withQM)).toBe(6);
    // A fresh loadout always has the default 5-point ceiling, never an unbounded one.
    expect(capMax(withQM)).toBeGreaterThan(capMax(noTrait));
  });

  it("sums the catalog sizes of the held entries, a null entry contributing zero", () => {
    // A size-3 weapon in one slot and an empty slot must occupy 3 points.
    const size3 = WEAPONS.findIndex((w) => w[2] === 3);
    expect(WEAPONS[size3][2]).toBe(3);
    const held = loadoutWith({ weapons: [{ i: size3, a: -1 }, null] });
    expect(capUsed(held)).toBe(3);

    // And two held entries sum their sizes: 1 + 2 = 3.
    const size1 = WEAPONS.findIndex((w) => w[2] === 1);
    const size2 = WEAPONS.findIndex((w) => w[2] === 2);
    expect(capUsed(loadoutWith({ weapons: [{ i: size1, a: -1 }, { i: size2, a: -1 }] }))).toBe(
      WEAPONS[size1][2] + WEAPONS[size2][2]
    );
  });
});

// Governing: ADR-0023, SPEC-0009 REQ "A Pair Costs Its Weapon's Size Plus One",
// REQ "A Pair Carries One Weapon's Ammo and Doubles Only the Weapon Price".
//
// A dual-wielded pair is a flag on ONE weapon entry (`d: true`) that occupies the
// weapon's size plus one point and doubles the WEAPON price only — both pistols fire
// the same round, so the ammo line must not double. Sizes and prices come from the
// catalog, never hardcoded, so a rebalance fails a test instead of silently
// invalidating one.
describe("dual-wielded pairs: budget and cost", () => {
  // Real catalog pair: a size-1 dual-wieldable pistol (Conversion) and a size-3 rifle
  // (Frontier 73C) must together total 5 points.
  const PISTOL = WEAPONS.findIndex((w) => w[0] === "caldwell-conversion-pistol");
  const RIFLE = WEAPONS.findIndex((w) => w[0] === "frontier-73c");
  const pair = { i: PISTOL, a: -1, d: true };
  const single = { i: PISTOL, a: -1, d: false };

  it("a pair occupies size + 1, occupying 2 of 5 with a size-1 pistol", () => {
    expect(WEAPONS[PISTOL][2]).toBe(1);
    expect(weaponSize(pair)).toBe(2);
    expect(weaponSize(single)).toBe(1);
  });

  it("a pair of a size-1 pistol and a size-3 rifle is a legal 5-point loadout", () => {
    expect(WEAPONS[RIFLE][2]).toBe(3);
    const lo = loadoutWith({ weapons: [pair, { i: RIFLE, a: -1, d: false }] });
    expect(capUsed(lo)).toBe(5);
    expect(capUsed(lo)).toBeLessThanOrEqual(capMax(lo));
  });

  it("weaponSize returns 0 for an empty entry and ignores an absent d", () => {
    expect(weaponSize(null)).toBe(0);
    // An entry that has not been normalized (no `d` at all) is a single, never a pair.
    expect(weaponSize({ i: PISTOL, a: -1 })).toBe(1);
  });

  it("doubles the weapon price for a pair but leaves the ammo price unchanged", () => {
    // The Conversion's own catalog price, plus one priced ammo variant from its pool.
    const AMMO_INDEX = 0;
    const singleLo = loadoutWith({ weapons: [{ i: PISTOL, a: AMMO_INDEX, d: false }] });
    const pairLo = loadoutWith({ weapons: [{ i: PISTOL, a: AMMO_INDEX, d: true }] });
    const ammoLine = (lo) => totalCost(lo) - WEAPONS[lo.weapons[0].i][3] * (lo.weapons[0].d === true ? 2 : 1);

    // The pool really has a priced variant at index 0, or this test proves nothing.
    expect(ammoLine(singleLo)).toBeGreaterThan(0);

    // Weapon line: doubles. Ammo line: byte-identical. Asserted separately.
    expect(totalCost(pairLo) - totalCost(singleLo)).toBe(WEAPONS[PISTOL][3]);
    expect(ammoLine(pairLo)).toBe(ammoLine(singleLo));
  });
});
