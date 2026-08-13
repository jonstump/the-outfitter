import { describe, expect, it } from "vitest";
import { WEAPONS } from "../data/catalog.js";
import { consCount, slotMax, totalCost, upTotal } from "./calc.js";

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

  it("derives slot count from blocked slots", () => {
    expect(slotMax(loadoutWith({}))).toBe(8);
    expect(slotMax(loadoutWith({ blocked: 3 }))).toBe(5);
  });
});
