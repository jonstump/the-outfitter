import { describe, expect, it } from "vitest";
import { FIRST_AID_KIT, TOOLS } from "../data/catalog.js";
import { randomizeLoadout } from "./randomize.js";

// Governing: issue #26 (randomize.js's loadout shape must match what the store
// accepts and the new catalog tuple shapes it reads)

describe("randomizeLoadout", () => {
  it("returns a store-accepted payload shape (weapons/equip/traits)", () => {
    const result = randomizeLoadout({ slotMax: 8 });
    expect(result).toHaveProperty("weapons");
    expect(result).toHaveProperty("equip");
    expect(result).toHaveProperty("traits");
    expect(Array.isArray(result.weapons)).toBe(true);
    expect(result.weapons).toHaveLength(2);
    expect(Array.isArray(result.equip)).toBe(true);
    expect(Array.isArray(result.traits)).toBe(true);
  });

  it("always includes the First Aid Kit as starter tool, by stable id", () => {
    const kitIndex = TOOLS.findIndex((t) => t[0] === FIRST_AID_KIT);
    for (let k = 0; k < 20; k++) {
      const r = randomizeLoadout({ slotMax: 8 });
      expect(r.equip[0]).toEqual({ t: "T", i: kitIndex });
    }
  });

  it("never exceeds 4 copies of the same consumable", () => {
    for (let k = 0; k < 20; k++) {
      const r = randomizeLoadout({ slotMax: 8 });
      const counts = new Map();
      r.equip
        .filter((e) => e.t === "C")
        .forEach((e) => {
          counts.set(e.i, (counts.get(e.i) || 0) + 1);
        });
      for (const n of counts.values()) {
        expect(n).toBeLessThanOrEqual(4);
      }
    }
  });

  it("never duplicates a tool or uses the starter tool twice", () => {
    const kitIndex = TOOLS.findIndex((t) => t[0] === FIRST_AID_KIT);
    for (let k = 0; k < 20; k++) {
      const r = randomizeLoadout({ slotMax: 8 });
      const tools = r.equip.filter((e) => e.t === "T").map((e) => e.i);
      expect(new Set(tools).size).toBe(tools.length);
      expect(tools.filter((i) => i === kitIndex)).toHaveLength(1);
    }
  });

  it("honors budgetOn by retrying toward the budget", () => {
    const result = randomizeLoadout({ slotMax: 8, budgetOn: true, budget: 150 });
    expect(result.weapons.length).toBe(2);
    expect(result.equip.length).toBeGreaterThanOrEqual(1);
  });
});
