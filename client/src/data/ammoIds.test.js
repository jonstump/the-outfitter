import { describe, expect, it } from "vitest";
import { AMMO } from "./catalog.js";
import { LEGACY_AMMO_IDS, legacyAmmoId } from "./ammoIds.js";

// Governing: ADR-0014, SPEC-0010 REQ "Every Legacy Ammo Selection Migrates to the Round It Named",
// issue #339.
//
// This test proves the snapshot in ammoIds.js was taken correctly NOW, while it is still true —
// by iterating the LIVE `AMMO` constant and asserting every pool has one frozen id per row, in the
// same order. It is expected to be deleted or inverted once #340 changes `AMMO`'s contents, per the
// issue: at that point `LEGACY_AMMO_IDS` and `AMMO` are SUPPOSED to diverge, because the whole point
// of freezing the table is that it keeps naming the round a legacy index meant even after the live
// catalog moves on.
describe("LEGACY_AMMO_IDS matches today's AMMO exactly (snapshot pin)", () => {
  it("covers exactly the same pools as AMMO, all ten, including the two empty ones", () => {
    expect(Object.keys(LEGACY_AMMO_IDS).sort()).toEqual(Object.keys(AMMO).sort());
  });

  it.each(Object.keys(AMMO))("%s: has one frozen id per live row, in order", (ammoClass) => {
    expect(LEGACY_AMMO_IDS[ammoClass]).toHaveLength(AMMO[ammoClass].length);
  });

  it("covers all 31 rows across all ten pools", () => {
    const total = Object.values(LEGACY_AMMO_IDS).reduce((sum, table) => sum + table.length, 0);
    const liveTotal = Object.values(AMMO).reduce((sum, rows) => sum + rows.length, 0);
    expect(liveTotal).toBe(31);
    expect(total).toBe(31);
  });

  it("every frozen id is unique across the whole table", () => {
    const allIds = Object.values(LEGACY_AMMO_IDS).flat();
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it("both currently-empty pools have an entry (an empty array) rather than being omitted", () => {
    expect(LEGACY_AMMO_IDS.special).toEqual([]);
    expect(LEGACY_AMMO_IDS.none).toEqual([]);
  });
});

describe("legacyAmmoId()", () => {
  it("resolves a legacy index to the id that names the round at that position today", () => {
    // AMMO.medium[1] is Spitzer as of this commit (see catalog.test.js's WIRE-FORMAT GATE pin).
    expect(legacyAmmoId("medium", 1)).toBe("ammo-medium-spitzer");
    expect(legacyAmmoId("compact", 0)).toBe("ammo-compact-fmj");
    expect(legacyAmmoId("bow", 2)).toBe("ammo-bow-poison-arrow");
  });

  it("returns null for an out-of-range index", () => {
    expect(legacyAmmoId("compact", 5)).toBeNull(); // compact has 5 rows: valid indexes are 0-4
    expect(legacyAmmoId("bow", 3)).toBeNull(); // bow has 3 rows: valid indexes are 0-2
    expect(legacyAmmoId("compact", 1000)).toBeNull();
  });

  it("returns null for an unknown ammoClass", () => {
    expect(legacyAmmoId("nonexistent-class", 0)).toBeNull();
    expect(legacyAmmoId(undefined, 0)).toBeNull();
    expect(legacyAmmoId(null, 0)).toBeNull();
    expect(legacyAmmoId("", 0)).toBeNull();
  });

  it("returns null for a negative index", () => {
    expect(legacyAmmoId("compact", -1)).toBeNull();
    expect(legacyAmmoId("medium", -100)).toBeNull();
  });

  it("returns null for a non-integer index without throwing", () => {
    expect(legacyAmmoId("compact", 1.5)).toBeNull();
    expect(legacyAmmoId("compact", NaN)).toBeNull();
    expect(legacyAmmoId("compact", "1")).toBeNull();
    expect(legacyAmmoId("compact", null)).toBeNull();
    expect(legacyAmmoId("compact", undefined)).toBeNull();
  });

  it("returns null for any index against an empty pool (special, none), never undefined behaviour", () => {
    expect(legacyAmmoId("special", 0)).toBeNull();
    expect(legacyAmmoId("none", 0)).toBeNull();
    expect(legacyAmmoId("special", -1)).toBeNull();
  });

  it("never throws across a spread of inputs", () => {
    const inputs = [
      ["compact", 0], ["compact", -1], ["compact", 99], ["compact", NaN],
      ["unknown", 0], [null, null], [undefined, undefined], ["", -0],
      ["medium", Infinity], ["medium", -Infinity], ["special", 0], ["none", 0],
    ];
    for (const [ammoClass, index] of inputs) {
      expect(() => legacyAmmoId(ammoClass, index)).not.toThrow();
    }
  });
});
