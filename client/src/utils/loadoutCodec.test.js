import { describe, expect, it } from "vitest";
import { CONS, TOOLS, TRAITS, WEAPONS } from "../data/catalog.js";
import {
  FORMAT_VERSION,
  LEGACY_CONS_IDS,
  LEGACY_TOOL_IDS,
  LEGACY_TRAIT_IDS,
  LEGACY_WEAPON_IDS,
  emptyLoadout,
  fromData,
  toData,
} from "./loadoutCodec.js";
import { TRAIT_MAX } from "./calc.js";

// Governing: issue #26 (stable catalog ids + schema versioning for saved/share encodings)
//
// Regression coverage for the wire-format migration: v1 encodes items by stable catalog id
// (immune to array reorders), and the legacy pre-versioning index-based encoding still decodes
// against the catalog's current order. Both must round-trip to the same in-memory loadout.

// Weapon 16 is the Winfield M1873C, which draws from the five-variant `medium` pool, so
// `a: 2` names a variant it really has. The sample used to pair `a: 2` with the Dolch 96 —
// a `special`-pool weapon whose purchasable variant list is EMPTY — which is the exact
// unrenderable shape issue #201 is about, asserted as if it round-tripped.
function sampleLoadout() {
  const lo = emptyLoadout();
  lo.weapons = [{ i: 0, a: -1 }, { i: 16, a: 2 }]; // Nagant M1895, Winfield M1873C + ammo variant
  lo.equip = [{ t: "T", i: 0 }, { t: "C", i: 3 }]; // First Aid Kit, Antidote Shot
  lo.traits = ["quartermaster"];
  lo.name = "Test build";
  lo.blocked = 1;
  return lo;
}

describe("toData / fromData (v1 id-based wire format)", () => {
  it("encodes the format version in the envelope", () => {
    const enc = toData(sampleLoadout());
    expect(enc.v).toBe(FORMAT_VERSION);
  });

  it("round-trips a full loadout through the wire format", () => {
    const lo = sampleLoadout();
    const dec = fromData(toData(lo));
    expect(dec.name).toBe("Test build");
    expect(dec.blocked).toBe(1);
    expect(dec.weapons).toEqual([{ i: 0, a: -1 }, { i: 16, a: 2 }]);
    expect(dec.equip).toEqual([{ t: "T", i: 0 }, { t: "C", i: 3 }]);
    expect(dec.traits).toEqual(["quartermaster"]);
  });

  it("encodes item references by stable id, not array position", () => {
    const enc = toData(sampleLoadout());
    expect(enc.w[0][0]).toBe(WEAPONS[0][0]);
    expect(enc.e[0][1]).toBe(TOOLS[0][0]);
    expect(enc.e[1][1]).toBe(CONS[3][0]);
    expect(enc.tr[0]).toBe("quartermaster");
  });

  it("drops v1 items whose ids no longer resolve in the catalog", () => {
    const enc = toData(sampleLoadout());
    const dec = fromData({
      ...enc,
      w: [["removed-weapon", -1], null],
      e: [["T", "removed-tool"]],
      tr: ["removed-trait"],
    });
    expect(dec.weapons[0]).toBeNull();
    expect(dec.equip).toEqual([]);
    expect(dec.traits).toEqual([]);
  });
});

// Governing: issue #201 (a crafted share link permanently blanks the app)
//
// `a` is an index into the weapon's AMMO pool, and two consumers — WeaponSlot and
// totalCost — read it. An out-of-range value made both read a property off `undefined`,
// which throws during render; because the store persists the decoded loadout BEFORE React
// draws it, the poisoned value reached localStorage and blanked every later visit, hash or
// no hash. Bounding it at decode is what stops it being persisted at all.
//
// Asserted against BOTH decoders. The v1 decoder had no bound whatsoever; the legacy one
// had a fixed `inRange(w[1], 5)`, which is not the same rule — `special` (Dolch 96, Nitro
// Express) has no purchasable variants at all, so 5 still admitted a crashing value there.
describe("out-of-range ammo indices decode to no variant selected", () => {
  const DOLCH = WEAPONS.findIndex((t) => t[0] === "dolch-96"); // `special` pool: zero variants
  const WINFIELD = WEAPONS.findIndex((t) => t[0] === "winfield-m1873c"); // `compact`: five

  const v1 = (weaponIndex, a) =>
    fromData({ v: FORMAT_VERSION, w: [[WEAPONS[weaponIndex][0], a], null], e: [], tr: [], n: "", b: 0 });

  it.each([9999, 5, 2.5, -2, "2", null])("v1 rejects the ammo index %p", (a) => {
    expect(v1(WINFIELD, a)).toMatchObject({ weapons: [{ i: WINFIELD, a: -1 }, null] });
  });

  it("v1 keeps an index the weapon's pool actually has", () => {
    expect(v1(WINFIELD, 4).weapons[0]).toEqual({ i: WINFIELD, a: 4 });
  });

  it("v1 rejects any variant on a weapon whose pool is empty", () => {
    // The case a fixed bound of 5 would have let through.
    expect(v1(DOLCH, 2).weapons[0]).toEqual({ i: DOLCH, a: -1 });
  });

  it("legacy rejects a variant on a weapon whose pool is empty", () => {
    const dec = fromData({ w: [[LEGACY_WEAPON_IDS.indexOf("dolch-96"), 2], null], e: [], tr: [] });
    expect(dec.weapons[0]).toEqual({ i: DOLCH, a: -1 });
  });

  it("never persists a decoded loadout that a re-encode would reintroduce the fault through", () => {
    // The round trip is the mechanism that made this permanent: whatever fromData returns is
    // what toData writes to localStorage. If the bound held on decode but not through the
    // re-encode, the next read would poison the store again.
    const decoded = v1(DOLCH, 9999);
    expect(fromData(toData(decoded)).weapons[0]).toEqual({ i: DOLCH, a: -1 });
  });
});

describe("fromData (legacy index-based wire format)", () => {
  it("decodes a legacy record against the current catalog order, preserving item identity", () => {
    const legacy = {
      w: [[0, -1], [16, 2]],
      e: [["T", 0], ["C", 3]],
      tr: [0],
      n: "Old build",
      b: 0,
    };
    const dec = fromData(legacy);
    expect(dec.weapons).toEqual([{ i: 0, a: -1 }, { i: 16, a: 2 }]);
    // Resolved identity, not just raw index pass-through: appends to the catalog
    // must never shift what a legacy position refers to (data-accuracy update).
    expect(WEAPONS[dec.weapons[0].i][1]).toBe("Nagant M1895");
    expect(WEAPONS[dec.weapons[1].i][1]).toBe("Winfield M1873C");
    expect(dec.equip).toEqual([{ t: "T", i: 0 }, { t: "C", i: 3 }]);
    expect(TOOLS[dec.equip[0].i][1]).toBe("First Aid Kit");
    expect(CONS[dec.equip[1].i][1]).toBe("Antidote Shot");
    expect(dec.traits).toEqual(["quartermaster"]);
    expect(dec.name).toBe("Old build");
  });

  it("restores legacy tool positions that moved to Consumables as the items they were", () => {
    // Pre-data-accuracy Tools index 18/19 were Choke Beetle / Stalker Beetle, which are
    // Consumables now. They used to be dropped (issue #38), because the decoder had no
    // way to tell them apart from the new tools appended in their place. The frozen
    // legacy table names them, so they come back correctly instead — what the record
    // meant is the item, not the category it sat in.
    const dec = fromData({ w: [null, null], e: [["T", 18], ["T", 19]], tr: [], n: "", b: 0 });
    expect(dec.equip.map((e) => e.t)).toEqual(["C", "C"]);
    expect(dec.equip.map((e) => CONS[e.i][1])).toEqual(["Choke Beetle", "Stalker Beetle"]);
  });

  it("drops out-of-range legacy indices instead of remapping them", () => {
    const dec = fromData({
      w: [[999, -1], null],
      e: [["T", 999], ["C", -1]],
      tr: [999],
    });
    expect(dec.weapons[0]).toBeNull();
    expect(dec.equip).toEqual([]);
    expect(dec.traits).toEqual([]);
  });

  it("treats a payload with an unknown version as legacy", () => {
    const legacy = { v: 0, w: [[1, -1], null], e: [], tr: [0] };
    const dec = fromData(legacy);
    expect(dec.weapons[0]).toEqual({ i: 1, a: -1 });
    expect(dec.traits).toEqual([TRAITS[0][0]]);
  });

  it("returns an empty loadout for null/non-object input", () => {
    expect(fromData(null)).toEqual(emptyLoadout());
    expect(fromData("garbage")).toEqual(emptyLoadout());
  });
});

// Governing: issue #68 (mid-array catalog deletes silently remapped legacy records)
//
// The Electric Lamp was deleted from TOOLS position 9 in e0076d3 without touching the
// decoder, which resolved legacy indices against the live array. Everything after it slid
// down one, so a legacy record meaning Spyglass (9) decoded as Decoys (10), and so on
// through index 17. These pin the frozen legacy order that replaced that assumption.
describe("fromData (legacy tool indices across the Electric Lamp removal)", () => {
  const legacyTools = (...indices) =>
    fromData({ w: [null, null], e: indices.map((i) => ["T", i]), tr: [], n: "", b: 0 });

  const equipNames = (dec) =>
    dec.equip.map((e) => (e.t === "T" ? TOOLS : CONS)[e.i][1]);

  // Indices 0-8 predate the gap and were never wrong; 10-17 are the ones that were
  // silently off by one. Asserted per index rather than as one record, because a
  // legacy loadout only carries 8 equipment slots.
  it.each([
    [0, "First Aid Kit"], [4, "Throwing Knives"], [8, "Fusees"],
    [10, "Spyglass"], [11, "Decoys"], [12, "Blank Fire Decoys"], [13, "Decoy Fuses"],
    [14, "Alert Trip Mine"], [15, "Concertina Trip Mine"], [16, "Poison Trip Mine"],
    [17, "Quad Derringer"],
  ])("legacy tool index %i resolves to %s", (index, name) => {
    expect(equipNames(legacyTools(index))).toEqual([name]);
  });

  it("drops the Electric Lamp's position rather than resolving its neighbour", () => {
    // The item left the game; the honest outcome is a missing slot, not Spyglass.
    expect(legacyTools(9).equip).toEqual([]);
  });

  it("restores the retired Choke Bomb consumable as the surviving Choke Bombs tool", () => {
    // Issue #67 deleted CONS position 13. Same item as the tool, so the legacy slot
    // resolves across categories instead of being dropped or shifting Flash Bomb up.
    const dec = fromData({ w: [null, null], e: [["C", 13], ["C", 14], ["C", 15]], tr: [] });
    expect(equipNames(dec)).toEqual(["Choke Bombs", "Flash Bomb", "Concertina Bomb"]);
    expect(dec.equip[0].t).toBe("T");
  });

  it("resolves legacy trait positions across the in-place renames", () => {
    // Iron Repeater (12) was merged into Iron Eye; Poison Sense (26) became Pain Sense.
    const dec = fromData({ w: [null, null], e: [], tr: [12, 26, 31] });
    expect(dec.traits).toEqual(["iron-eye", "pain-sense", "vigilant"]);
  });

  it("resolves the last legacy weapon position, unshifted by later appends", () => {
    const dec = fromData({ w: [[36, -1], [16, 1]], e: [], tr: [] });
    expect(WEAPONS[dec.weapons[0].i][1]).toBe("Nitro Express");
    expect(WEAPONS[dec.weapons[1].i][1]).toBe("Winfield M1873C");
  });
});

// This is the guard the old "positions still line up" comment could not be. A catalog row
// that a legacy slot names cannot be deleted without failing here, which forces the person
// deleting it to say what the legacy slot should do — repoint it, or set it to null.
describe("frozen legacy catalog tables", () => {
  const cases = [
    ["weapons", LEGACY_WEAPON_IDS, [WEAPONS], 37],
    ["tools", LEGACY_TOOL_IDS, [TOOLS, CONS], 20],
    ["consumables", LEGACY_CONS_IDS, [CONS, TOOLS], 16],
    ["traits", LEGACY_TRAIT_IDS, [TRAITS], 32],
  ];

  it.each(cases)("%s: every non-null legacy id still resolves", (_name, table, catalogs) => {
    const known = new Set(catalogs.flat().map((t) => t[0]));
    const unresolved = table.filter((id) => id !== null && !known.has(id));
    expect(unresolved).toEqual([]);
  });

  it.each(cases)("%s: the table keeps its pre-versioning length", (_n, table, _c, length) => {
    // Growing or shrinking a table shifts every position after the edit — the exact
    // failure this whole mechanism exists to prevent. Append to catalog.js instead.
    expect(table).toHaveLength(length);
  });
});

// Governing: ADR-0012 (fifteen-trait cap), SPEC-0003 REQ "A Loadout Holds At Most Fifteen Traits"
//
// Both decoders, deliberately. A bound carried by one decoder and not the other is exactly how
// the ammo bound was lost (issue #201), and PR #203 had to fix it in both — so a case that
// covers only the current format would leave the same hole open one migration later.
describe("every decoder clamps a trait list to the cap", () => {
  const OVER_CAP = 20;
  const traitIds = TRAITS.map((t) => t[0]);

  it("the catalog carries enough traits for an over-cap payload to be built from valid ids", () => {
    expect(traitIds.length).toBeGreaterThanOrEqual(OVER_CAP);
    expect(LEGACY_TRAIT_IDS.length).toBeGreaterThanOrEqual(OVER_CAP);
  });

  it("fromData (v1) keeps the first fifteen of twenty valid ids", () => {
    const dec = fromData({ v: FORMAT_VERSION, w: [null, null], e: [], tr: traitIds.slice(0, OVER_CAP) });
    expect(dec.traits).toHaveLength(TRAIT_MAX);
    // The FIRST fifteen, in order — decoding the same record twice must give the same loadout.
    expect(dec.traits).toEqual(traitIds.slice(0, TRAIT_MAX));
  });

  it("fromLegacy keeps the first fifteen of twenty valid ids", () => {
    // No `v` field, so this routes to the legacy decoder; positions 0..19 are the legacy
    // trait table's own indices, translated to stable ids before the clamp applies.
    const dec = fromData({ w: [null, null], e: [], tr: [...Array(OVER_CAP).keys()] });
    expect(dec.traits).toHaveLength(TRAIT_MAX);
    expect(dec.traits).toEqual(LEGACY_TRAIT_IDS.slice(0, TRAIT_MAX));
  });

  it("clamps the survivors, not the raw entries — v1", () => {
    // Unknown ids are dropped first, so a payload padded with retired ids still yields a
    // full fifteen rather than fifteen-minus-the-junk.
    const padded = traitIds.slice(0, OVER_CAP).flatMap((id) => [id, "retired-trait-" + id]);
    const dec = fromData({ v: FORMAT_VERSION, w: [null, null], e: [], tr: padded });
    expect(dec.traits).toEqual(traitIds.slice(0, TRAIT_MAX));
  });

  it("clamps after the positional translation, not before — legacy", () => {
    // Out-of-range positions resolve to nothing. If the legacy decoder clamped before
    // translating, these would eat cells and the result would come back short.
    const padded = [...Array(OVER_CAP).keys()].flatMap((i) => [i, 999]);
    const dec = fromData({ w: [null, null], e: [], tr: padded });
    expect(dec.traits).toEqual(LEGACY_TRAIT_IDS.slice(0, TRAIT_MAX));
  });

  it("leaves an at-or-under-cap list alone in both decoders", () => {
    const atCap = traitIds.slice(0, TRAIT_MAX);
    expect(fromData({ v: FORMAT_VERSION, w: [null, null], e: [], tr: atCap }).traits).toEqual(atCap);
    const legacyAtCap = [...Array(TRAIT_MAX).keys()];
    expect(fromData({ w: [null, null], e: [], tr: legacyAtCap }).traits).toEqual(
      LEGACY_TRAIT_IDS.slice(0, TRAIT_MAX)
    );
  });

  it("re-encodes the clamped loadout, so an over-cap record self-heals on next save", () => {
    // The record stays loadable and the next write puts fifteen back — the reason decode
    // clamps rather than throwing (a decoded loadout is persisted before it is rendered).
    const dec = fromData({ v: FORMAT_VERSION, w: [null, null], e: [], tr: traitIds.slice(0, OVER_CAP) });
    expect(toData(dec).tr).toHaveLength(TRAIT_MAX);
  });
});
