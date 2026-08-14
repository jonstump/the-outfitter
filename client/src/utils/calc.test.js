import { describe, expect, it } from "vitest";
import { QM, WEAPONS } from "../data/catalog.js";
import { capMax, capUsed, consCount, slotMax, totalCost, upTotal } from "./calc.js";

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

    // `special` weapons have no purchasable variants at all — an empty pool, not a short one.
    const special = WEAPONS.findIndex((w) => w[4] === "special");
    expect(totalCost(loadoutWith({ weapons: [{ i: special, a: 0 }] }))).toBe(WEAPONS[special][3]);
  });
});

describe("consCount", () => {
  it("counts copies of one specific consumable, not its type", () => {
    const lo = loadoutWith({
      equip: [
        { t: "C", i: 4 }, // Dynamite Stick (Throwable)
        { t: "C", i: 4 }, // Dynamite Stick (Throwable)
        { t: "C", i: 5 }, // Dynamite Bundle (Throwable)
      ],
    });
    expect(consCount(lo, 4)).toBe(2);
    expect(consCount(lo, 5)).toBe(1);
  });

  it("counts only held items on a grid with gaps", () => {
    // Two Dynamite Sticks separated by holes must still count as 2 — a packed-array
    // count would work here by accident, but one that iterated `.length` or holes
    // would not; the point is the filter(Boolean) semantics under ADR-0009.
    const lo = loadoutWith({
      equip: [
        { t: "C", i: 4 }, null, null, { t: "C", i: 4 }, null, null, null, null,
      ],
    });
    expect(consCount(lo, 4)).toBe(2);
  });

  it("ignores tools sharing the consumable's index", () => {
    const lo = loadoutWith({ equip: [{ t: "T", i: 4 }, { t: "C", i: 0 }] });
    expect(consCount(lo, 4)).toBe(0);
    expect(consCount(lo, 0)).toBe(1);
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
