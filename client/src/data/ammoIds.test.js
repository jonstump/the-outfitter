import { describe, expect, it } from "vitest";
import { AMMO } from "./catalog.js";
import { LEGACY_AMMO_IDS, legacyAmmoId } from "./ammoIds.js";

// Governing: ADR-0014, SPEC-0010 REQ "Every Legacy Ammo Selection Migrates to the Round It Named",
// issue #339, issue #340.
//
// This test proved the snapshot in ammoIds.js was taken correctly AS OF #339, by iterating the
// live `AMMO` constant and asserting every pool had one frozen id per row, in the same order. #340
// has now changed `AMMO`'s contents (five prices corrected to 0, nine rows added to `special`), and
// this file's own header comment anticipated exactly that: "LEGACY_AMMO_IDS and AMMO are SUPPOSED
// to diverge, because the whole point of freezing the table is that it keeps naming the round a
// legacy index meant even after the live catalog moves on." So this describe block is INVERTED
// rather than deleted — it now pins the divergence instead of the match, which is the live
// evidence that the frozen snapshot is doing its job.
describe("LEGACY_AMMO_IDS vs today's AMMO (snapshot pin, updated for #340's divergence)", () => {
  it("covers exactly the same pools as AMMO, all ten, including the two empty ones", () => {
    // Pool KEYS are unchanged by #340 — no pool was added or removed, only rows within them.
    expect(Object.keys(LEGACY_AMMO_IDS).sort()).toEqual(Object.keys(AMMO).sort());
  });

  it("still has one frozen id per live row for the eight pools #340 did not add rows to", () => {
    // #340 corrected five prices IN PLACE (no length change) across these eight pools, so the
    // frozen snapshot and the live catalog still agree row-for-row on everything except `special`.
    for (const ammoClass of Object.keys(AMMO).filter((c) => c !== "special")) {
      expect(LEGACY_AMMO_IDS[ammoClass], ammoClass).toHaveLength(AMMO[ammoClass].length);
    }
  });

  it("diverges from AMMO.special on purpose — #340 populated it, the frozen table stays empty", () => {
    // The whole point of a SNAPSHOT: no legacy index could ever have meant one of #340's nine new
    // special-pool rows, because no UI ever offered them before this change (the pool was empty).
    // So the frozen table correctly has NOTHING to say about them, while the live catalog now does.
    expect(LEGACY_AMMO_IDS.special).toHaveLength(0);
    expect(AMMO.special.length).toBeGreaterThan(0);
    expect(LEGACY_AMMO_IDS.special.length).not.toBe(AMMO.special.length);
  });

  it("the frozen table still covers all 31 rows it always did; the live catalog now covers more", () => {
    const frozenTotal = Object.values(LEGACY_AMMO_IDS).reduce((sum, table) => sum + table.length, 0);
    const liveTotal = Object.values(AMMO).reduce((sum, rows) => sum + rows.length, 0);
    expect(frozenTotal).toBe(31);
    // 31 unchanged rows across the eight original pools, plus #340's nine new `special` rows.
    expect(liveTotal).toBe(40);
  });

  it("every frozen id is unique across the whole table", () => {
    const allIds = Object.values(LEGACY_AMMO_IDS).flat();
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it("both currently-empty FROZEN pools have an entry (an empty array) rather than being omitted", () => {
    // Unaffected by #340: this describes ammoIds.js's own frozen table, which this story does not
    // touch. AMMO.special (the LIVE catalog) is asserted separately above — it is no longer empty.
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
