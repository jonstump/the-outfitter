import { describe, expect, it } from "vitest";
import { CONS, TOOLS, TRAITS, WEAPONS } from "../data/catalog.js";
import {
  FORMAT_VERSION,
  LEGACY_CONS_IDS,
  LEGACY_TOOL_IDS,
  LEGACY_TRAIT_IDS,
  LEGACY_WEAPON_IDS,
  PROMOTED_TO_WEAPON,
  RETIRED_WEAPON_ALIASES,
  emptyLoadout,
  encodeShareUrl,
  fromData,
  toData,
} from "./loadoutCodec.js";
import { TRAIT_MAX } from "./calc.js";

// Governing: issue #26 (stable catalog ids + schema versioning for saved/share encodings)
//
// Regression coverage for the wire-format migration: v1 encodes items by stable catalog id
// (immune to array reorders), and the legacy pre-versioning index-based encoding still decodes
// against the catalog's current order. Both must round-trip to the same in-memory loadout.

// Weapon 19 is the Frontier 73C, which draws from the five-variant `compact` pool, so `a: 2` names a
// variant it really has. The sample used to pair `a: 2` with the Dolch 96 — a `special`-pool weapon
// whose purchasable variant list is EMPTY — which is the exact unrenderable shape issue #201 is about,
// asserted as if it round-tripped.
//
// It named live index 16 until #243 retired the Winfield M1873C, a duplicate of this very weapon; the
// delete shifted every later live index down one. In-memory loadouts are index-based, so a fixture
// like this has to move with the array — which is why the wire format stores ids instead.
function sampleLoadout() {
  const lo = emptyLoadout();
  lo.weapons = [{ i: 0, a: -1 }, { i: 19, a: 2 }]; // Nagant M1895, Frontier 73C + ammo variant
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
    // `b: 1` in the v1 sample is a blocked COUNT — but the sample is consumed through
    // `toData`, which now writes the current v2 shape, and v2's `b` is an array of cell
    // indices, not a count. A count written as v2 is malformed and decays to no blocks,
    // which is itself the well-formed-empty-grid rule #278 wants pinned. The v1->v2
    // lift of the SAME count (`b: 1`) is asserted separately below.
    expect(dec.blocked).toEqual([]);
    expect(dec.weapons).toEqual([{ i: 0, a: -1 }, { i: 19, a: 2 }]);
    // Current entries decode at their own cells; the rest of the fixed grid is holes.
    expect(dec.equip).toEqual([{ t: "T", i: 0 }, { t: "C", i: 3 }, null, null, null, null, null, null]);
    expect(dec.traits).toEqual(["quartermaster"]);
  });

  it("lifts a v1 blocked count to the last N cell indices", () => {
    // Governing: SPEC-0006 REQ "Version 1 Records Migrate Losslessly". `b: N` in v1
    // means the LAST N cells were blocked, so 1 lifts to cell index 7 — the single
    // cell a count of 1 can mean — and 3 lifts to [5,6,7].
    expect(fromData({ v: 1, w: [null, null], e: [], tr: [], n: "", b: 1 }).blocked).toEqual([7]);
    expect(fromData({ v: 1, w: [null, null], e: [], tr: [], n: "", b: 3 }).blocked).toEqual([5, 6, 7]);
  });

  it("encodes item references by stable id, not array position", () => {
    const enc = toData(sampleLoadout());
    expect(enc.w[0][0]).toBe(WEAPONS[0][0]);
    expect(enc.e[0][1]).toBe(TOOLS[0][0]);
    expect(enc.e[1][1]).toBe(CONS[3][0]);
    expect(enc.tr[0]).toBe("quartermaster");
  });

  it("drops a v1 item whose id no longer resolves, at its own cell", () => {
    const enc = toData(sampleLoadout());
    const dec = fromData({
      ...enc,
      w: [["removed-weapon", -1], null],
      e: [null, ["T", "removed-tool"], null, null, null, null, null, null],
      tr: ["removed-trait"],
    });
    expect(dec.weapons[0]).toBeNull();
    // A hole at the unresolvable cell, not a closed-up packing: cell 0 is empty and
    // cell 1 alone decides whether the test is about the hole or the gap (ADR-0009).
    expect(dec.equip).toEqual([
      null, null, null, null, null, null, null, null,
    ]);
    expect(dec.traits).toEqual([]);
  });
});

// Governing: ADR-0009, SPEC-0006 REQ "Wire Format Version 2 Encodes Cell Position",
// REQ "Version 1 Records Migrate Losslessly".
//
// Round-trip coverage across the four cases the story required: the current v2 shape,
// a v1 record, a pre-versioning (legacy) record, and malformed input. Each asserts the
// grid stays well-formed — positions preserved, holes surviving, and malformed input
// decaying to the empty grid rather than throwing.
describe("wire-format round-trips (v2, v1, pre-versioning, malformed)", () => {
  it("round-trips a v2 loadout with empty cells preserved", () => {
    const lo = emptyLoadout();
    lo.weapons = [{ i: 0, a: -1 }, null];
    lo.equip = [
      { t: "T", i: 0 }, null, { t: "C", i: 3 }, null,
      null, null, null, null,
    ];
    lo.traits = ["quartermaster"];
    lo.name = "v2 gap";
    lo.blocked = [];
    const enc = toData(lo);
    expect(enc.v).toBe(2);
    const dec = fromData(enc);
    // Cell positions and the hole at cell 1 survive the round trip.
    expect(dec.weapons).toEqual([{ i: 0, a: -1 }, null]);
    expect(dec.equip).toEqual([
      { t: "T", i: 0 }, null, { t: "C", i: 3 }, null,
      null, null, null, null,
    ]);
    expect(dec.traits).toEqual(["quartermaster"]);
  });

  it("round-trips a v2 loadout with blocked cells", () => {
    const lo = emptyLoadout();
    lo.equip = [{ t: "C", i: 3 }, null, null, null, null, null, null, null];
    lo.blocked = [2, 3];
    const dec = fromData(toData(lo));
    expect(dec.blocked).toEqual([2, 3]);
    expect(dec.equip[0]).toEqual({ t: "C", i: 3 });
  });

  it("decodes a v1 record to the cells it rendered in (pre-versioning path)", () => {
    // Same pack as the legacy fixture in the legacy describe — a v1 record whose items
    // were packed in insertion order lands in cells 0..n-1, trailing cells stay holes.
    const dec = fromData({
      v: 1,
      w: [[0, -1], [16, 2]],
      e: [["T", "first-aid-kit"], ["C", "antidote-shot"]],
      tr: ["quartermaster"],
      n: "Old build",
      b: 1,
    });
    expect(dec.equip).toEqual([
      { t: "T", i: 0 }, { t: "C", i: 3 }, null, null,
      null, null, null, null,
    ]);
    expect(dec.blocked).toEqual([7]);
  });

  it("treats malformed input as a well-formed empty grid rather than throwing", () => {
    // Malformed in several ways: non-object, wrong-type arrays, and a v2 `e` with a
    // junk element. All must come back as the eight-cell empty grid.
    expect(fromData(null)).toEqual(emptyLoadout());
    expect(fromData("garbage")).toEqual(emptyLoadout());
    expect(fromData({ v: 2, w: null, e: "nope", tr: 42, b: "x" })).toEqual(emptyLoadout());
    const junk = fromData({ v: 2, w: [null, null], e: ["junk", null, null, null, null, null, null, null], tr: [], n: "", b: [] });
    expect(junk.equip).toEqual(Array(8).fill(null));
    expect(junk.blocked).toEqual([]);
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
  // Frontier 73C, after #243 retired its duplicate. Any five-variant `compact` weapon serves here;
  // what the test needs is a pool with enough variants that index 2 is legitimately in range.
  const WINFIELD = WEAPONS.findIndex((t) => t[0] === "frontier-73c"); // `compact`: five

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
  // The legacy shape shares v1's packed semantics, so it decodes through the same
  // v1->v2 lift: insertion order becomes cell order and trailing cells stay holes
  // (SPEC-0006 "Version 1 Records Migrate Losslessly").
  const packedEquip = (items) => [...items, ...Array(8 - items.length).fill(null)];

  it("decodes a legacy record against the current catalog order, preserving item identity", () => {
    const legacy = {
      w: [[0, -1], [16, 2]],
      e: [["T", 0], ["C", 3]],
      tr: [0],
      n: "Old build",
      b: 0,
    };
    const dec = fromData(legacy);
    // Legacy position 16 named the Winfield M1873C, retired by #243; it now resolves through
    // RETIRED_WEAPON_ALIASES to the Frontier 73C at live index 19 — the same gun, kept rather than
    // dropped. The ammo index survives because both rows draw from the five-variant `compact` pool.
    expect(dec.weapons).toEqual([{ i: 0, a: -1 }, { i: 19, a: 2 }]);
    // Resolved identity, not just raw index pass-through: appends to the catalog
    // must never shift what a legacy position refers to (data-accuracy update).
    expect(WEAPONS[dec.weapons[0].i][1]).toBe("Nagant M1895");
    expect(WEAPONS[dec.weapons[1].i][1]).toBe("Frontier 73C");
    expect(dec.equip).toEqual(packedEquip([{ t: "T", i: 0 }, { t: "C", i: 3 }]));
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
    expect(dec.equip.slice(0, 2).map((e) => e.t)).toEqual(["C", "C"]);
    expect(dec.equip.slice(0, 2).map((e) => CONS[e.i][1])).toEqual(["Choke Beetle", "Stalker Beetle"]);
  });

  it("drops out-of-range legacy indices instead of remapping them", () => {
    const dec = fromData({
      w: [[999, -1], null],
      e: [["T", 999], ["C", -1]],
      tr: [999],
    });
    expect(dec.weapons[0]).toBeNull();
    expect(dec.equip).toEqual(packedEquip([]));
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
    dec.equip.filter(Boolean).map((e) => (e.t === "T" ? TOOLS : CONS)[e.i][1]);

  // Indices 0-8 predate the gap and were never wrong; 10-17 are the ones that were
  // silently off by one. Asserted per index rather than as one record, because a
  // legacy loadout only carries 8 equipment slots.
  it.each([
    [0, "First Aid Kit"], [4, "Throwing Knives"], [8, "Fusees"],
    [10, "Spyglass"], [11, "Decoys"], [12, "Blank Fire Decoys"], [13, "Decoy Fuses"],
    [14, "Alert Trip Mines"], [15, "Concertina Trip Mines"], [16, "Poison Trip Mines"],
    [17, "Quad Derringer"],
  ])("legacy tool index %i resolves to %s", (index, name) => {
    expect(equipNames(legacyTools(index))).toEqual([name]);
  });

  it("drops the Electric Lamp's position rather than resolving its neighbour", () => {
    // The item left the game; the honest outcome is a missing slot, not Spyglass.
    expect(legacyTools(9).equip.filter(Boolean)).toEqual([]);
  });

  it("restores the retired Choke Bomb consumable as the surviving Choke Bombs tool", () => {
    // Issue #67 deleted CONS position 13. Same item as the tool, so the legacy slot
    // resolves across categories instead of being dropped or shifting Flash Bomb up.
    const dec = fromData({ w: [null, null], e: [["C", 13], ["C", 14], ["C", 15]], tr: [] });
    expect(equipNames(dec)).toEqual(["Choke Bombs", "Flash Bomb", "Concertina Bomb"]);
    expect(dec.equip.filter(Boolean)[0].t).toBe("T");
  });

  it("resolves legacy trait positions across the in-place renames", () => {
    // Iron Repeater (12) was merged into Iron Eye; Poison Sense (26) became Pain Sense.
    const dec = fromData({ w: [null, null], e: [], tr: [12, 26, 31] });
    expect(dec.traits).toEqual(["iron-eye", "pain-sense", "vigilant"]);
  });

  it("resolves the last legacy weapon position, unshifted by later appends", () => {
    const dec = fromData({ w: [[36, -1], [16, 1]], e: [], tr: [] });
    expect(WEAPONS[dec.weapons[0].i][1]).toBe("Nitro Express");
    // Was "Winfield M1873C" until #243 retired that duplicate row; the alias lands it on its twin.
    expect(WEAPONS[dec.weapons[1].i][1]).toBe("Frontier 73C");
  });
});

// This is the guard the old "positions still line up" comment could not be. A catalog row
// that a legacy slot names cannot be deleted without failing here, which forces the person
// deleting it to say what the legacy slot should do — repoint it, or set it to null.
const WEAPON_BY_ID_TEST = new Set(WEAPONS.map((w) => w[0]));

describe("frozen legacy catalog tables", () => {
  const cases = [
    ["weapons", LEGACY_WEAPON_IDS, [WEAPONS], 37],
    ["tools", LEGACY_TOOL_IDS, [TOOLS, CONS], 20],
    ["consumables", LEGACY_CONS_IDS, [CONS, TOOLS], 16],
    ["traits", LEGACY_TRAIT_IDS, [TRAITS], 32],
  ];

  it.each(cases)("%s: every non-null legacy id still resolves", (_name, table, catalogs) => {
    // Two escape hatches, and both require a DECLARATION rather than a coincidence. Adding WEAPONS to
    // every case's catalog list would let any tool id that happens to match a weapon id pass
    // silently, which is the opposite of what this guard is for.
    //
    //   PROMOTED_TO_WEAPON      the id moved category and resolves into WEAPONS (#156, the Katana)
    //   RETIRED_WEAPON_ALIASES  the row was deleted and another id carries the same item (#243)
    const known = new Set(catalogs.flat().map((t) => t[0]));
    const resolvesElsewhere = (id) =>
      (PROMOTED_TO_WEAPON.has(id) && WEAPON_BY_ID_TEST.has(id)) ||
      WEAPON_BY_ID_TEST.has(RETIRED_WEAPON_ALIASES[id]);
    const unresolved = table.filter((id) => id !== null && !known.has(id) && !resolvesElsewhere(id));
    expect(unresolved).toEqual([]);
  });

  it("declares every promoted id as a real weapon", () => {
    // The other half: a declaration is only meaningful if the destination exists.
    const missing = [...PROMOTED_TO_WEAPON].filter((id) => !WEAPON_BY_ID_TEST.has(id));
    expect(missing).toEqual([]);
  });

  it("points every retired alias at a row that exists, and never at another retired id", () => {
    // Same argument as above, plus the chain case: an alias whose target is itself retired would
    // resolve to nothing after one hop, and neither decoder follows a second.
    const targets = Object.entries(RETIRED_WEAPON_ALIASES);
    expect(targets.length).toBeGreaterThan(0);
    const dangling = targets.filter(([, to]) => !WEAPON_BY_ID_TEST.has(to)).map(([from, to]) => `${from} -> ${to}`);
    expect(dangling).toEqual([]);
    const chained = targets.filter(([, to]) => to in RETIRED_WEAPON_ALIASES).map(([from]) => from);
    expect(chained, "aliases are resolved in one hop").toEqual([]);
  });

  it("retires the alias source from the live catalog", () => {
    // The point of the alias: the old id must be GONE. If it still resolves, the duplicate is back and
    // the alias is dead code hiding it.
    const stillLive = Object.keys(RETIRED_WEAPON_ALIASES).filter((id) => WEAPON_BY_ID_TEST.has(id));
    expect(stillLive).toEqual([]);
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

// Governing: #156 (the Katana moved TOOLS -> WEAPONS), SPEC-0006 (the saved-loadout wire format)
//
// The migration is the reason #156 was not a one-line data edit. `fromV1` filters equipment through
// TOOL_BY_ID and `resolveLegacyEquip` consults TOOLS/CONS only, so BOTH decoders would have dropped a
// stored Katana silently — this is not a legacy-only hazard, which is the part that is easy to miss.
describe("the Katana's promotion from equipment to weapon", () => {
  const KATANA_WEAPON = WEAPONS.findIndex((w) => w[0] === "katana");
  const weaponIds = (lo) => lo.weapons.map((w) => (w ? WEAPONS[w.i][0] : null));
  const equipIds = (lo) => lo.equip.filter(Boolean).map((e) => (e.t === "T" ? TOOLS[e.i][0] : CONS[e.i][0]));

  it("is a weapon and no longer a tool", () => {
    expect(KATANA_WEAPON).toBeGreaterThan(-1);
    expect(TOOLS.some((t) => t[0] === "katana")).toBe(false);
    expect(WEAPONS[KATANA_WEAPON][2], "size 2, per the infobox and Category:Weapons/Size 2").toBe(2);
  });

  it("moves a current-format ['T','katana'] into a free weapon slot", () => {
    const decoded = fromData({ v: FORMAT_VERSION, w: [null, null], e: [["T", "katana"]], tr: [], n: "", b: 0 });
    expect(weaponIds(decoded)).toEqual(["katana", null]);
    expect(equipIds(decoded)).toEqual([]);
  });

  it("stops the Katana consuming an equipment cell it should never have used", () => {
    // The budget error this issue is about, in the direction a user would notice: the Katana used to
    // occupy one of the eight equipment cells while costing nothing against capMax.
    const decoded = fromData({
      v: FORMAT_VERSION, w: [null, null],
      e: [["T", "katana"], ["T", "first-aid-kit"]], tr: [], n: "", b: 0,
    });
    expect(equipIds(decoded)).toEqual(["first-aid-kit"]);
    expect(decoded.equip.filter(Boolean)).toHaveLength(1);
  });

  it("keeps the second weapon slot free rather than filling both", () => {
    const decoded = fromData({
      v: FORMAT_VERSION, w: [["nagant-m1895", -1], null], e: [["T", "katana"]], tr: [], n: "", b: 0,
    });
    expect(weaponIds(decoded)).toEqual(["nagant-m1895", "katana"]);
  });

  it("drops it when both weapon slots are taken, because no encoding can hold a third", () => {
    // Best-effort by necessity, and the same outcome as before the migration existed rather than a
    // regression. Asserted so the loss is a stated behaviour instead of a surprise.
    const decoded = fromData({
      v: FORMAT_VERSION,
      w: [["nagant-m1895", -1], ["romero-77", -1]],
      e: [["T", "katana"]], tr: [], n: "", b: 0,
    });
    expect(weaponIds(decoded)).toEqual(["nagant-m1895", "romero-77"]);
    expect(equipIds(decoded)).toEqual([]);
  });

  it("does not duplicate a Katana already carried as a weapon", () => {
    // A record saved after the migration whose stale equipment entry survived alongside it.
    const decoded = fromData({
      v: FORMAT_VERSION, w: [["katana", -1], null], e: [["T", "katana"]], tr: [], n: "", b: 0,
    });
    expect(weaponIds(decoded)).toEqual(["katana", null]);
    expect(equipIds(decoded)).toEqual([]);
  });

  it("promotes a LEGACY tool slot too, which resolveLegacyEquip alone could not", () => {
    // LEGACY_TOOL_IDS[6] is "katana". A legacy record has no `v`, and its equipment is a raw index.
    expect(LEGACY_TOOL_IDS[6]).toBe("katana");
    const decoded = fromData({ w: [null, null], e: [["T", 6]], tr: [], n: "", b: 0 });
    expect(weaponIds(decoded)).toEqual(["katana", null]);
    expect(equipIds(decoded)).toEqual([]);
  });

  it("leaves the legacy tool slots around it untouched", () => {
    // Index 6 is the Katana; 5 and 7 are its neighbours. A promotion must not perturb the frozen
    // table's other positions — the failure mode #68 was about.
    const decoded = fromData({ w: [null, null], e: [["T", 5], ["T", 6], ["T", 7]], tr: [], n: "", b: 0 });
    expect(equipIds(decoded)).toEqual(["throwing-axes", "flare-pistol"]);
    expect(weaponIds(decoded)).toEqual(["katana", null]);
  });

  it("carries no ammo variant, since a melee weapon has no pool", () => {
    const decoded = fromData({ v: FORMAT_VERSION, w: [null, null], e: [["T", "katana"]], tr: [], n: "", b: 0 });
    expect(decoded.weapons[0].a).toBe(-1);
    expect(WEAPONS[KATANA_WEAPON][4]).toBe("none");
  });

  it("round-trips as a weapon once re-encoded", () => {
    // The migration is one-way by design: the next save writes the Katana as a weapon, so the
    // promotion runs once per record rather than on every load.
    const decoded = fromData({ v: FORMAT_VERSION, w: [null, null], e: [["T", "katana"]], tr: [], n: "", b: 0 });
    const re = toData(decoded);
    expect(re.w[0]).toEqual(["katana", -1]);
    // The fixed grid encodes cell order: only the holes it carried (all eight cells
    // were empty after the promotion) write as trailing `null` entries.
    expect(re.e).toEqual(Array(8).fill(null));
    expect(weaponIds(fromData(re))).toEqual(["katana", null]);
  });
});

// Governing: #243 (retiring the `winfield-m1873c` duplicate), SPEC-0006 (the wire format)
//
// Deleting a catalog row is normally free — both decoders resolve stable ids, not array positions. It
// was not free here, and the note in wiki.mjs that said it was is corrected by this change: the frozen
// LEGACY_WEAPON_IDS still names index 16 `winfield-m1873c`, so a delete without an alias left that
// position resolving to nothing and dropped the weapon instead of landing it on its twin.
describe("the retired Winfield M1873C alias", () => {
  const FRONTIER = WEAPONS.findIndex((w) => w[0] === "frontier-73c");
  const nameOf = (lo, slot) => (lo.weapons[slot] ? WEAPONS[lo.weapons[slot].i][1] : null);

  it("removes the duplicate row and keeps its twin", () => {
    expect(WEAPONS.some((w) => w[0] === "winfield-m1873c")).toBe(false);
    expect(FRONTIER).toBeGreaterThan(-1);
    expect(RETIRED_WEAPON_ALIASES["winfield-m1873c"]).toBe("frontier-73c");
  });

  it("resolves a LEGACY record's index 16 to the surviving row", () => {
    expect(LEGACY_WEAPON_IDS[16]).toBe("winfield-m1873c");
    const decoded = fromData({ w: [[16, -1], null], e: [], tr: [], n: "", b: 0 });
    expect(nameOf(decoded, 0)).toBe("Frontier 73C");
  });

  it("resolves a CURRENT-format record too, which #243 did not ask for", () => {
    // `toData` writes `WEAPONS[w.i][0]`, so any loadout saved while the duplicate was still selectable
    // carries this id in the v1 format. Without the alias in `fromV1` as well, those records would
    // have lost the weapon just as quietly as the legacy ones.
    const decoded = fromData({
      v: FORMAT_VERSION, w: [["winfield-m1873c", -1], null], e: [], tr: [], n: "", b: 0,
    });
    expect(nameOf(decoded, 0)).toBe("Frontier 73C");
  });

  it("carries the stored ammo index across, unchanged and still in range", () => {
    // The two rows agree on ammo class (`compact`, five variants) and size, which is what makes a bare
    // id substitution safe. An alias between different pools would need the index remapped.
    const decoded = fromData({
      v: FORMAT_VERSION, w: [["winfield-m1873c", 3], null], e: [], tr: [], n: "", b: 0,
    });
    expect(decoded.weapons[0]).toEqual({ i: FRONTIER, a: 3 });
    expect(WEAPONS[FRONTIER][4]).toBe("compact");
  });

  it("still bounds an out-of-range ammo index after aliasing", () => {
    // The alias must not slip past `boundedAmmo` — #201's crash came from an index the pool lacks.
    const decoded = fromData({
      v: FORMAT_VERSION, w: [["winfield-m1873c", 99], null], e: [], tr: [], n: "", b: 0,
    });
    expect(decoded.weapons[0]).toEqual({ i: FRONTIER, a: -1 });
  });

  it("re-encodes under the surviving id, so the alias applies once per record", () => {
    const decoded = fromData({
      v: FORMAT_VERSION, w: [["winfield-m1873c", 2], null], e: [], tr: [], n: "", b: 0,
    });
    const re = toData(decoded);
    expect(re.w[0]).toEqual(["frontier-73c", 2]);
    expect(nameOf(fromData(re), 0)).toBe("Frontier 73C");
  });

  it("does not disturb the legacy positions on either side of 16", () => {
    // The #68 failure mode: an edit that shifts what a neighbouring legacy slot resolves to.
    const decoded = fromData({ w: [[15, -1], [17, -1]], e: [], tr: [], n: "", b: 0 });
    expect(nameOf(decoded, 0)).toBe("Springfield 1866");
    expect(nameOf(decoded, 1)).toBe("Ranger 73");
  });

  it("leaves an unaliased unknown id resolving to nothing", () => {
    // The alias table is a lookup, not a catch-all: an id nobody declared still drops.
    const decoded = fromData({
      v: FORMAT_VERSION, w: [["no-such-weapon", -1], null], e: [], tr: [], n: "", b: 0,
    });
    expect(decoded.weapons).toEqual([null, null]);
  });
});

// Governing: ADR-0022, SPEC-0003 REQ "The Saved-Loadout Wire Format Is Unchanged" and
// REQ "A Loadout's Name Is Derived From Its Weapons Until the User Owns It" (issue #316)
//
// Each feature individually tests that its own client-only state — `savedId` and
// `nameIsDerived` — never reaches the wire. What is missing is coverage of BOTH fields
// active at once: a loadout that carries a `savedId` AND a still-derived name. Neither
// may leak into `data`, a share URL, or a local draft, and a decoded share URL must
// produce a fresh build — no `savedId`, and a name that is derived, not owned.
describe("wire format stays clean with both savedId and nameIsDerived active", () => {
  // A loadout carrying both pieces of client-only state at once.
  function loadoutWithBoth() {
    const lo = emptyLoadout();
    lo.weapons = [{ i: 0, a: -1 }, null]; // Nagant M1895 — a derived name
    lo.name = "Nagant M1895"; // still derived (matches what derivation would produce)
    lo.savedId = "rec-from-server";
    lo.nameIsDerived = true;
    return lo;
  }

  it("toData output contains neither savedId nor nameIsDerived, and FORMAT_VERSION is unchanged", () => {
    const enc = toData(loadoutWithBoth());
    expect(enc).not.toHaveProperty("savedId");
    expect(enc).not.toHaveProperty("nameIsDerived");
    // The wire keys are exactly the format's own, and nothing more.
    expect(Object.keys(enc).sort()).toEqual(["b", "e", "n", "tr", "v", "w"]);
    expect(enc.v).toBe(FORMAT_VERSION);
  });

  it("an encoded share URL contains neither the savedId nor the nameIsDerived flag", () => {
    const lo = loadoutWithBoth();
    const url = encodeShareUrl(lo);
    expect(url).not.toContain("rec-from-server");
    expect(url).not.toContain("savedId");
    expect(url).not.toContain("nameIsDerived");
  });

  it("a round trip through toData/fromData yields a loadout with no savedId and a derived name", () => {
    // This is the interesting case: decoding a share URL must produce a FRESH build,
    // not one that believes it owns someone else's record. `fromData` returns a
    // plain object with no `savedId` and no `nameIsDerived` — the caller (setLoadout)
    // is what sets those, based on whether `savedId` was attached to the payload.
    const lo = loadoutWithBoth();
    const enc = toData(lo);
    const dec = fromData(enc);
    expect(dec).not.toHaveProperty("savedId");
    expect(dec).not.toHaveProperty("nameIsDerived");
    // The name survives (it was in `n` on the wire), but the decoded loadout has no
    // provenance: a shared build is not the sender's record.
    expect(dec.name).toBe("Nagant M1895");
    // The weapons survive the round trip.
    expect(dec.weapons).toEqual([{ i: 0, a: -1 }, null]);
  });
});
