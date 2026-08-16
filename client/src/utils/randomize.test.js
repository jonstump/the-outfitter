import { describe, expect, it } from "vitest";
import { CONS, FIRST_AID_KIT, TOOLS, WEAPONS } from "../data/catalog.js";
import { ammoSlotsFor } from "../data/itemStats.js";
import { fromData, toData } from "./loadoutCodec.js";

import { TRAIT_MAX } from "./calc.js";
import { randomizeLoadout } from "./randomize.js";

// Governing: issue #26 (randomize.js's loadout shape must match what the store
// accepts and the new catalog tuple shapes it reads)
//
// Governing: ADR-0009 (the generator emits the fixed eight-cell grid), ADR-0015
// (four per cap category), SPEC-0006 REQ "Randomized and Bulk-Set Loadouts Produce
// Well-Formed Grids", SPEC-0008 (the generator obeys the same cap as the reducer).
//
// The generated `equip` is a GRID: exactly 8 entries, `null` at blocked cells.
// Every assertion reads held items via `.filter(Boolean)`.

const held = (r) => r.equip.filter(Boolean);

describe("randomizeLoadout", () => {
  it("returns a store-accepted payload shape (weapons/equip/traits)", () => {
    const result = randomizeLoadout({ blocked: [] });
    expect(result).toHaveProperty("weapons");
    expect(result).toHaveProperty("equip");
    expect(result).toHaveProperty("traits");
    expect(Array.isArray(result.weapons)).toBe(true);
    expect(result.weapons).toHaveLength(2);
    expect(Array.isArray(result.equip)).toBe(true);
    expect(Array.isArray(result.traits)).toBe(true);
  });

  it("returns an eight-cell equip grid, with blocked positions as holes", () => {
    for (let k = 0; k < 20; k++) {
      const r = randomizeLoadout({ blocked: [0, 3] });
      expect(r.equip).toHaveLength(8);
      // A blocked cell never holds an item (SPEC-0006 REQ "Randomized ... Well-Formed
      // Grids" — the generator avoids blocked cells).
      expect(r.equip[0]).toBeNull();
      expect(r.equip[3]).toBeNull();
    }
  });

  it("always includes the First Aid Kit as starter tool, by stable id", () => {
    const kitIndex = TOOLS.findIndex((t) => t[0] === FIRST_AID_KIT);
    for (let k = 0; k < 20; k++) {
      const r = randomizeLoadout({ blocked: [] });
      expect(held(r)[0]).toEqual({ t: "T", i: kitIndex });
    }
  });

  it("never exceeds 4 copies of the same consumable", () => {
    for (let k = 0; k < 20; k++) {
      const r = randomizeLoadout({ blocked: [] });
      const counts = new Map();
      held(r)
        .filter((e) => e.t === "C")
        .forEach((e) => {
          counts.set(e.i, (counts.get(e.i) || 0) + 1);
        });
      for (const n of counts.values()) {
        expect(n).toBeLessThanOrEqual(4);
      }
    }
  });

  it("never emits more than four of one cap category", () => {
    // Governing: ADR-0015 (four per type), SPEC-0008 (the generator obeys the same
    // cap). Four Dynamite Sticks then a Dynamite Bundle must never be generated.
    for (let k = 0; k < 50; k++) {
      const r = randomizeLoadout({ blocked: [] });
      const byCategory = new Map();
      held(r)
        .filter((e) => e.t === "C")
        .forEach((e) => {
          const cat = CONS[e.i]?.[3] ?? "unknown";
          byCategory.set(cat, (byCategory.get(cat) || 0) + 1);
        });
      for (const n of byCategory.values()) {
        expect(n).toBeLessThanOrEqual(4);
      }
    }
  });

  it("never duplicates a tool or uses the starter tool twice", () => {
    const kitIndex = TOOLS.findIndex((t) => t[0] === FIRST_AID_KIT);
    for (let k = 0; k < 20; k++) {
      const r = randomizeLoadout({ blocked: [] });
      const tools = held(r).filter((e) => e.t === "T").map((e) => e.i);
      expect(new Set(tools).size).toBe(tools.length);
      expect(tools.filter((i) => i === kitIndex)).toHaveLength(1);
    }
  });

  it("honors budgetOn by retrying toward the budget", () => {
    const result = randomizeLoadout({ blocked: [], budgetOn: true, budget: 150 });
    expect(result.weapons.length).toBe(2);
    expect(held(result).length).toBeGreaterThanOrEqual(1);
  });

  // Governing: ADR-0014, SPEC-0010 REQ "A Weapon Holds Up to Two Independently Chosen
  // Rounds", issue #344/#462. #344's own acceptance criteria asked for exactly this as a
  // "regression guard": a generated loadout whose weapon holds an incompatible round must
  // fail this suite. `mkAmmo` (randomize.js) draws each slot from
  // `ammoSlotsFor(weaponId).groups[slotIndex]` — this pins that every non-null draw, across
  // many generated loadouts, really is a member of that weapon's own group for that slot,
  // never some other weapon's or the retired shared AMMO[ammoClass] pool.
  it("never selects an ammo id outside the weapon's own accepted list, across many generated loadouts", () => {
    let checkedAtLeastOneFilledSlot = false;
    for (let k = 0; k < 50; k++) {
      const r = randomizeLoadout({ blocked: [] });
      for (const w of r.weapons) {
        if (!w) continue;
        const weaponId = WEAPONS[w.i][0];
        const slots = ammoSlotsFor(weaponId);
        w.ammo.forEach((ammoId, slotIndex) => {
          if (ammoId === null) return;
          checkedAtLeastOneFilledSlot = true;
          const group = slots.groups[slotIndex] ?? [];
          expect(group.some((round) => round.id === ammoId)).toBe(true);
        });
      }
    }
    // The draw is random (30% per slot per #384/#344's odds) but near-certain to fill at
    // least one slot across 50 loadouts of up to 2 weapons x 2 slots each — if this is ever
    // false, the assertions above were vacuously true rather than exercising anything.
    expect(checkedAtLeastOneFilledSlot).toBe(true);
  });
});
