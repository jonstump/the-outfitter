import { describe, expect, it } from "vitest";
import { catCount, slotMax, totalCost, upTotal } from "./calc.js";

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
  it("counts weapon cost and optional ammo cost", () => {
    const lo = loadoutWith({ weapons: [{ i: 0, a: -1 }] }); // Nagant M1895 = $30
    expect(totalCost(lo)).toBe(30);
    lo.weapons[0].a = 0; // FMJ tier-1 = $15
    expect(totalCost(lo)).toBe(45);
  });

  it("sums tool and consumable costs numerically, not by concatenation", () => {
    const lo = loadoutWith({
      equip: [
        { t: "T", i: 0 }, // First Aid Kit = $30
        { t: "C", i: 0 }, // Vitality Shot = $60
      ],
    });
    expect(totalCost(lo)).toBe(90);
  });

  it("returns 0 for an empty loadout", () => {
    expect(totalCost(loadoutWith({}))).toBe(0);
  });
});

describe("catCount", () => {
  it("counts consumables sharing a category string", () => {
    const lo = loadoutWith({
      equip: [
        { t: "C", i: 0 }, // Vitality Shot (Shot)
        { t: "C", i: 3 }, // Antidote Shot (Shot)
        { t: "C", i: 4 }, // Dynamite Stick (Throwable)
      ],
    });
    expect(catCount(lo, "Shot")).toBe(2);
    expect(catCount(lo, "Throwable")).toBe(1);
  });

  it("ignores tools and unknown categories", () => {
    const lo = loadoutWith({ equip: [{ t: "T", i: 0 }, { t: "C", i: 4 }] });
    expect(catCount(lo, "Shot")).toBe(0);
    expect(catCount(lo, "Nope")).toBe(0);
  });
});

describe("upTotal / slotMax", () => {
  it("sums trait UP costs by stable id", () => {
    const lo = loadoutWith({ traits: ["quartermaster", "fanning"] }); // 8 + 7
    expect(upTotal(lo)).toBe(15);
  });

  it("derives slot count from blocked slots", () => {
    expect(slotMax(loadoutWith({}))).toBe(8);
    expect(slotMax(loadoutWith({ blocked: 3 }))).toBe(5);
  });
});
