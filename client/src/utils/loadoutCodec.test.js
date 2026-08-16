import { describe, expect, it } from "vitest";
import { AMMO, CONS, TOOLS, TRAITS, WEAPONS } from "../data/catalog.js";
import {
  FORMAT_VERSION,
  LEGACY_CONS_IDS,
  LEGACY_TOOL_IDS,
  LEGACY_TRAIT_IDS,
  LEGACY_WEAPON_IDS,
  LS_CUR,
  PROMOTED_TO_WEAPON,
  RETIRED_WEAPON_ALIASES,
  emptyLoadout,
  encodeShareUrl,
  fromData,
  readHashLoadout,
  readStoredLoadout,
  toData,
} from "./loadoutCodec.js";
import { TRAIT_MAX, capUsed, upTotal } from "./calc.js";

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
    // Version 3 decodes a `d` on every weapon — a single here, since the sample has no pair.
    expect(dec.weapons).toEqual([{ i: 0, a: -1, d: false }, { i: 19, a: 2, d: false }]);
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
    expect(enc.v).toBe(FORMAT_VERSION);
    const dec = fromData(enc);
    // Cell positions and the hole at cell 1 survive the round trip. Version 3 decodes a
    // `d: false` on each weapon — a single here, since the loadout has no pair.
    expect(dec.weapons).toEqual([{ i: 0, a: -1, d: false }, null]);
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
    // Built with `v: FORMAT_VERSION` (3), so the entry decodes with a `d` — false here.
    expect(v1(WINFIELD, 4).weapons[0]).toEqual({ i: WINFIELD, a: 4, d: false });
  });

  it("v1 rejects any variant on a weapon whose pool is empty", () => {
    // The case a fixed bound of 5 would have let through.
    expect(v1(DOLCH, 2).weapons[0]).toEqual({ i: DOLCH, a: -1, d: false });
  });

  it("legacy rejects a variant on a weapon whose pool is empty", () => {
    const dec = fromData({ w: [[LEGACY_WEAPON_IDS.indexOf("dolch-96"), 2], null], e: [], tr: [] });
    // Legacy is unversioned and lands in the legacy decoder, which leaves `d` absent.
    expect(dec.weapons[0]).toEqual({ i: DOLCH, a: -1 });
  });

  it("never persists a decoded loadout that a re-encode would reintroduce the fault through", () => {
    // The round trip is the mechanism that made this permanent: whatever fromData returns is
    // what toData writes to localStorage. If the bound held on decode but not through the
    // re-encode, the next read would poison the store again.
    const decoded = v1(DOLCH, 9999);
    expect(fromData(toData(decoded)).weapons[0]).toEqual({ i: DOLCH, a: -1, d: false });
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

  it("treats a payload with no v field as legacy", () => {
    // Governing: issue #360. A genuine pre-versioning legacy record has no `v`
    // field at all. `v: 0` is NOT the same as "no v" — it is a declared version
    // this client does not know, and now returns a "cannot decode" result (see
    // the issue #360 tests below).
    const legacy = { w: [[1, -1], null], e: [], tr: [0] };
    const dec = fromData(legacy);
    expect(dec.weapons[0]).toEqual({ i: 1, a: -1 });
    expect(dec.traits).toEqual([TRAITS[0][0]]);
  });

  it("treats a payload with v: null as legacy", () => {
    const legacy = { v: null, w: [[1, -1], null], e: [], tr: [0] };
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

// Governing: issue #357 (boundedTraits admits duplicate trait ids), ADR-0012 (fifteen-trait cap)
//
// `boundedTraits` slices to TRAIT_MAX but never deduped, so a crafted v2/legacy payload of
// fifteen copies of `quartermaster` decoded to fifteen copies, burned the whole trait budget,
// and inflated `upTotal` (which charges per copy). The dedupe happens before the slice so the
// cap counts fifteen DISTINCT traits. Asserted against both the current and legacy decoders.
describe("boundedTraits dedupes trait ids before the fifteen-trait clamp (issue #357)", () => {
  const QM = "quartermaster";
  const QM_UP = TRAITS.find((t) => t[0] === QM)[2];

  it("a v2 payload of fifteen copies of one trait decodes to a single trait", () => {
    const dec = fromData({ v: FORMAT_VERSION, w: [null, null], e: [], tr: Array(TRAIT_MAX).fill(QM) });
    expect(dec.traits).toEqual([QM]);
    expect(upTotal(dec)).toBe(QM_UP);
  });

  it("fifteen copies through the legacy decoder produce the same single-trait result", () => {
    // Legacy trait index 0 is `quartermaster` (LEGACY_TRAIT_IDS[0]).
    expect(LEGACY_TRAIT_IDS[0]).toBe(QM);
    const dec = fromData({ w: [null, null], e: [], tr: Array(TRAIT_MAX).fill(0) });
    expect(dec.traits).toEqual([QM]);
    expect(upTotal(dec)).toBe(QM_UP);
  });

  it("fifteen DISTINCT trait ids still decode to fifteen (regression guard)", () => {
    const distinct = TRAITS.slice(0, TRAIT_MAX).map((t) => t[0]);
    const dec = fromData({ v: FORMAT_VERSION, w: [null, null], e: [], tr: distinct });
    expect(dec.traits).toEqual(distinct);
    expect(dec.traits).toHaveLength(TRAIT_MAX);
  });

  it("does not over-dedupe a list with repeats under the cap", () => {
    // Two copies of one trait and one other: the dedupe keeps two distinct traits.
    const dec = fromData({ v: FORMAT_VERSION, w: [null, null], e: [], tr: [QM, QM, "fanning"] });
    expect(dec.traits).toEqual([QM, "fanning"]);
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
    // Version 3 writes the pair flag as the third element — unset (false) for this single.
    expect(re.w[0]).toEqual(["katana", -1, false]);
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
    const decoded = fromData({ v: FORMAT_VERSION, w: [["winfield-m1873c", 3], null], e: [], tr: [], n: "", b: 0 });
    expect(decoded.weapons[0]).toEqual({ i: FRONTIER, a: 3, d: false });
    expect(WEAPONS[FRONTIER][4]).toBe("compact");
  });

  it("still bounds an out-of-range ammo index after aliasing", () => {
    // The alias must not slip past `boundedAmmo` — #201's crash came from an index the pool lacks.
    const decoded = fromData({
      v: FORMAT_VERSION, w: [["winfield-m1873c", 99], null], e: [], tr: [], n: "", b: 0,
    });
    expect(decoded.weapons[0]).toEqual({ i: FRONTIER, a: -1, d: false });
  });

  it("re-encodes under the surviving id, so the alias applies once per record", () => {
    const decoded = fromData({
      v: FORMAT_VERSION, w: [["winfield-m1873c", 2], null], e: [], tr: [], n: "", b: 0,
    });
    const re = toData(decoded);
    // Version 3: three elements per entry, the flag unset for this single.
    expect(re.w[0]).toEqual(["frontier-73c", 2, false]);
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
// may leak into `data`, a share URL, or a local draft, and decoding one must not hand
// the recipient provenance over the sender's record.
//
// `savedId` and `nameIsDerived` are both set by `setLoadout`, not by `fromData` — these
// tests cover the codec half only. What `setLoadout` does with a decoded payload is
// covered in `loadoutSlice.test.js`.
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

  it("a round trip through toData/fromData yields a payload with neither savedId nor nameIsDerived", () => {
    // The provenance half of the guarantee: a decoded share URL must not believe it
    // owns someone else's record. `fromData` returns a plain object carrying neither
    // client-only field — `setLoadout` is what sets both, from what the payload holds.
    //
    // Note what that means for the name, because it is easy to get backwards: the name
    // DOES survive on the wire (`n`), and `setLoadout` reads a payload carrying a name
    // as owned rather than derived (`!payload.savedId && !payload.name`, added in #322,
    // so that a reload or a share link cannot overwrite a name someone typed). So a
    // decoded share URL is a fresh build as far as `savedId` goes, but its name is not
    // re-derived. See "keeps a typed name through a toData/fromData round trip and
    // re-hydration" in `loadoutSlice.test.js` for the state-side assertion.
    const lo = loadoutWithBoth();
    const enc = toData(lo);
    const dec = fromData(enc);
    expect(dec).not.toHaveProperty("savedId");
    expect(dec).not.toHaveProperty("nameIsDerived");
    // The name survives — it was in `n` on the wire — while the provenance does not.
    expect(dec.name).toBe("Nagant M1895");
    // The weapons survive the round trip, now carrying the version-3 `d` flag.
    expect(dec.weapons).toEqual([{ i: 0, a: -1, d: false }, null]);
  });
});

// Governing: ADR-0023 (the pair flag is the third element of a version-3 weapon entry),
// SPEC-0009 REQ "Version 2 and Version 1 Records Continue to Decode".
//
// The version-3 decoder accepts `[weaponId, ammoIndex, d]` entries and lands the pair
// flag on the DECODED weapon object as `d`, verbatim. Nothing older than v3 can express
// a pair, and the flag is never inferred — a v2, v1 or legacy record must decode with no
// weapon flagged. Selection is by declared version: a `v: 3` payload whose entries have
// only two elements is NOT silently treated as v2.
describe("version-3 wire format (ADR-0023 pair flag)", () => {
  // Nagant M1895 is the first catalog weapon. All fixtures reference ids, not indices.
  const NAGANT = WEAPONS[0][0];
  const NAGANT_INDEX = 0;
  // A real ammo variant index the Nagant's pool actually has.
  const AMMO_INDEX = 1;

  // {weapons} carry the pair flag; {equip, tr, n, b} are props of the whole record and
  // MUST NOT be inferred from anything about the weapons.
  const v3Payload = (weapons) => ({
    v: 3,
    w: weapons,
    e: [],
    tr: [],
    n: "x",
    b: 0,
  });

  it("decodes a hand-built version-3 payload, landing d on the flagged weapon", () => {
    const dec = fromData(
      v3Payload([
        [NAGANT, AMMO_INDEX, true], // dual-wielded pair
        [NAGANT, AMMO_INDEX, false], // same weapon, single
      ])
    );
    expect(dec.weapons[0]).toEqual({ i: NAGANT_INDEX, a: AMMO_INDEX, d: true });
    expect(dec.weapons[1]).toEqual({ i: NAGANT_INDEX, a: AMMO_INDEX, d: false });
  });

  it("a version-2 record decodes with no weapon flagged, explicitly", () => {
    // The acceptance criterion: no weapon flagged, asserted explicitly — not merely
    // "does not throw". A v2 entry has no third element, so `d` must be absent.
    const dec = fromData({
      v: 2,
      w: [
        [NAGANT, AMMO_INDEX],
        [NAGANT, AMMO_INDEX],
      ],
      e: [],
      tr: [],
      n: "x",
      b: [],
    });
    expect(dec.weapons[0]).toEqual({ i: NAGANT_INDEX, a: AMMO_INDEX });
    expect(dec.weapons[1]).toEqual({ i: NAGANT_INDEX, a: AMMO_INDEX });
    expect(dec.weapons[0]).not.toHaveProperty("d");
    expect(dec.weapons[1]).not.toHaveProperty("d");
  });

  it("a version-1 record and a legacy record decode with no weapon flagged", () => {
    const v1 = fromData({
      v: 1,
      w: [
        [NAGANT, AMMO_INDEX],
        [NAGANT, AMMO_INDEX],
      ],
      e: [],
      tr: [],
      n: "x",
      b: 0,
    });
    expect(v1.weapons[0]).toEqual({ i: NAGANT_INDEX, a: AMMO_INDEX });
    expect(v1.weapons[0]).not.toHaveProperty("d");

    // Legacy (unversioned) records fall back to the legacy decoder. Legacy entries are
    // NUMERIC catalog indices, not ids.
    const legacy = fromData({
      w: [
        [0, AMMO_INDEX],
        null,
      ],
      e: [],
      tr: [],
      n: "x",
      b: 0,
    });
    expect(legacy.weapons[0]).toEqual({ i: 0, a: AMMO_INDEX });
    expect(legacy.weapons[0]).not.toHaveProperty("d");
  });

  it("a version-2 record re-encoded at version 3 keeps every v2 field unchanged", () => {
    // Re-encoding a v2 record to a v3 shape must preserve exactly the fields v2 defined,
    // with nothing invented — the flag is not implied by re-encoding either. `e` uses
    // the client wire format's stable string ids (toData writes TOOLS[e.i][0]), and the
    // v2 blocked array shape.
    const reEncodedAsV3 = {
      v: 3,
      w: [[NAGANT, AMMO_INDEX], null],
      e: [["T", TOOLS[0][0]], null, null, null, null, null, null, null],
      tr: ["quartermaster"],
      n: "Test build",
      b: [],
    };
    const dec = fromData(reEncodedAsV3);
    // Under v3 the flag is always present on the decoded entry — false here, because
    // the two-element entry simply has no flag to carry. A v2 record decoded through
    // the v3 shape therefore reads as an unpaired single, matching what v2 computed.
    expect(dec.weapons[0]).toEqual({ i: NAGANT_INDEX, a: AMMO_INDEX, d: false });

    // And the loadout's other fields survive the decode exactly as v2 defined them.
    expect(dec.equip[0]).toEqual({ t: "T", i: 0 });
    expect(dec.traits).toEqual(["quartermaster"]);
    expect(dec.name).toBe("Test build");
    expect(dec.blocked).toEqual([]);
  });

  it("selection is by declared version: a v:3 payload with two-element entries is not decoded as v2", () => {
    // The registry picks the match for the DECLARED version. A v3 payload whose weapon
    // entry omits the pair flag is malformed FOR v3, and the decoder must not fall
    // through to a v2 read of it — `fromData` selects by `d.v`, never by shape. `w[2]`
    // is undefined here, which the v3 decoder normalises to `d: false` — the entry
    // still resolves, but under v3 semantics, not v2's.
    const dec = fromData(
      v3Payload([
        [NAGANT, AMMO_INDEX],
        null,
      ])
    );
    // Two elements decoded under v3: the pair flag is present and false. This is what
    // distinguishes "declared v3, missing the flag" from "declared v2".
    expect(dec.weapons[0]).toEqual({ i: NAGANT_INDEX, a: AMMO_INDEX, d: false });
  });

  it("a malformed v3 payload still decays to the well-formed empty grid", () => {
    // Missing `w` entirely is the same malformed-input contract as v2 — the empty
    // grid, not an exception.
    expect(fromData({ v: 3, w: null, e: "nope", tr: 42, n: "", b: "x" })).toEqual(emptyLoadout());
  });

  it("does not infer a pair from a duplicate weapon appearing twice in a v2 record", () => {
    // The sharpest case: two entries of the SAME weapon in a v2 record is not a
    // dual-wield signal. Absence means absent.
    const dec = fromData({
      v: 2,
      w: [
        [NAGANT, -1],
        [NAGANT, -1],
      ],
      e: [],
      tr: [],
      n: "x",
      b: [],
    });
    expect(dec.weapons[0]).toEqual({ i: NAGANT_INDEX, a: -1 });
    expect(dec.weapons[1]).toEqual({ i: NAGANT_INDEX, a: -1 });
    expect(dec.weapons[0]).not.toHaveProperty("d");
    expect(dec.weapons[1]).not.toHaveProperty("d");
  });
});

// Governing: ADR-0023, SPEC-0009 REQ "Wire Format Version 3 Encodes the Pair Flag".
//
// #332: FORMAT_VERSION bumps to 3 and toData writes the pair flag as the third element of
// every weapon entry. A single still round-trips with the flag unset — the entry is
// THREE elements, never two. The serialized byte at index 2 must be a boolean in every
// case (undefined would become null in the JSON array and the server's version-3
// validator rejects it), so assertions here run on the JSON round trip.
describe("version-3 encoding (issue #332)", () => {
  // Real catalog pair: a size-1 dual-wieldable pistol (Conversion) and a size-3 rifle
  // (Frontier 73C) — together a legal 5-point loadout (SPEC-0009).
  const PISTOL = WEAPONS.findIndex((w) => w[0] === "caldwell-conversion-pistol");
  const RIFLE = WEAPONS.findIndex((w) => w[0] === "frontier-73c");
  const AMMO_INDEX = 1; // a real variant the Conversion's pool has

  const pairLoadout = () => {
    const lo = emptyLoadout();
    lo.weapons = [{ i: PISTOL, a: AMMO_INDEX, d: true }, { i: RIFLE, a: -1, d: false }];
    return lo;
  };

  it("FORMAT_VERSION is 3", () => {
    expect(FORMAT_VERSION).toBe(3);
  });

  it("round-trips a pair through toData/fromData, preserving the flag and occupied capacity", () => {
    const enc = toData(pairLoadout());
    expect(enc.v).toBe(3);
    const dec = fromData(enc);
    expect(dec.weapons[0]).toEqual({ i: PISTOL, a: AMMO_INDEX, d: true });
    expect(dec.weapons[1]).toEqual({ i: RIFLE, a: -1, d: false });
    // The pair + rifle occupies 5 points — capacity must be unchanged through the round trip.
    expect(capUsed(dec)).toBe(5);
  });

  it("round-trips a pair through a share URL", () => {
    const url = encodeShareUrl(pairLoadout());
    // readHashLoadout reads location.hash; encodeShareUrl set it via history.replaceState.
    const via = fromData(JSON.parse(atob(url.split("#L=")[1])));
    expect(via.weapons[0]).toEqual({ i: PISTOL, a: AMMO_INDEX, d: true });
    expect(via.weapons[1]).toEqual({ i: RIFLE, a: -1, d: false });
  });

  it("a single round-trips with a three-element entry and the flag unset", () => {
    const lo = emptyLoadout();
    lo.weapons = [{ i: PISTOL, a: -1, d: false }, null];
    const enc = toData(lo);
    expect(enc.w[0]).toEqual([WEAPONS[PISTOL][0], -1, false]);
    expect(enc.w[0]).toHaveLength(3);
    const dec = fromData(enc);
    expect(dec.weapons[0]).toEqual({ i: PISTOL, a: -1, d: false });
  });

  it("the serialized third element is a boolean in every case", () => {
    const ser = JSON.parse(JSON.stringify(toData(pairLoadout())));
    expect(typeof ser.w[0][2]).toBe("boolean");
    expect(typeof ser.w[1][2]).toBe("boolean");
    // A weapon with NO d at all (a decoder-produced or pre-normalization entry) must
    // still serialize to a boolean, not null — this is the byte the server validates.
    const dless = emptyLoadout();
    dless.weapons = [{ i: PISTOL, a: -1 }, null];
    const ser2 = JSON.parse(JSON.stringify(toData(dless)));
    expect(ser2.w[0][2]).toBe(false);
    expect(typeof ser2.w[0][2]).toBe("boolean");
  });

  it("toData output contains exactly the keys the wire format defines", () => {
    const enc = toData(pairLoadout());
    expect(Object.keys(enc).sort()).toEqual(["b", "e", "n", "tr", "v", "w"]);
  });

  it("a version-2 localStorage draft written before this change still loads", () => {
    // The draft is a v2 record the OLD code wrote: two-element weapon entries, no v3
    // notion of a pair. It must decode through fromV2 (selection by declared version)
    // with no weapon flagged, and re-encoding it as v3 must not drop anything.
    const draft = JSON.stringify({
      v: 2,
      w: [[WEAPONS[PISTOL][0], AMMO_INDEX], null],
      e: [["T", "first-aid-kit"], null, null, null, null, null, null, null],
      tr: [],
      n: "Old draft",
      b: [],
    });
    localStorage.setItem(LS_CUR, draft);
    const loaded = readStoredLoadout();
    // The v2 decoder yields NO `d` (a v2 record could not express a pair).
    expect(loaded.weapons[0]).toEqual({ i: PISTOL, a: AMMO_INDEX });
    expect(loaded.weapons[0]).not.toHaveProperty("d");
    expect(loaded.name).toBe("Old draft");

    // The next save re-encodes as v3; the pair flag must not be invented, and the
    // weapon must survive with everything it had (its ammo index included).
    const saved = toData(loaded);
    expect(saved.w[0]).toEqual([WEAPONS[PISTOL][0], AMMO_INDEX, false]);
    expect(JSON.parse(JSON.stringify(saved)).w[0][2]).toBe(false);
  });
});

// Governing: issue #351. `frontier-73c` moved from `medium` to `compact` (commit
// `e9b2c1d`) without a FORMAT_VERSION bump. A saved ammo selection is a bare index
// into `AMMO[ammoClass]`, so a legacy record carrying `["frontier-73c", 1]` was written
// against the pre-change `medium` pool (Spitzer, $60) but reads against the current
// `compact` pool (High Velocity, $13). The legacy decoder remaps the index by round NAME;
// Spitzer has no equivalent in `compact`, so it decodes to -1 (no variant) rather than to
// a different round at a different price.
describe("issue #351 — frontier-73c legacy ammo remap", () => {
  const FRONTIER = WEAPONS.findIndex((w) => w[0] === "frontier-73c");
  const MEDIUM = AMMO.medium;
  const COMPACT = AMMO.compact;

  it("an unversioned legacy record naming Frontier 73C at ammo index 1 decodes to -1, not High Velocity", () => {
    // Legacy weapon index 20 is `frontier-73c` (see LEGACY_WEAPON_IDS). A legacy record
    // carrying [20, 1] was written against the pre-change `medium` pool, where index 1
    // is Spitzer ($60). Spitzer has no equivalent in the current `compact` pool, so the
    // remap yields -1 (no variant) rather than silently reading `compact[1]` (High Velocity).
    const dec = fromData({
      w: [[0, -1], [20, 1]],
      e: [],
      tr: [],
      n: "",
      b: 0,
    });
    expect(dec.weapons[1]).toEqual({ i: FRONTIER, a: -1 });
    expect(WEAPONS[dec.weapons[1].i][1]).toBe("Frontier 73C");
  });

  it("indices 0, 2, 3, 4 are unchanged by the remap — the round names exist in both pools", () => {
    // FMJ, Dumdum, Incendiary, Poison exist in both `medium` and `compact` at the SAME
    // index, so the remap is a no-op for them.
    for (const i of [0, 2, 3, 4]) {
      const dec = fromData({ w: [[0, -1], [20, i]], e: [], tr: [], n: "", b: 0 });
      expect(dec.weapons[1]).toEqual({ i: FRONTIER, a: i });
      // The round name survives because the index is the same in both pools.
      expect(AMMO[WEAPONS[FRONTIER][4]][i][0]).toBe(MEDIUM[i][0]);
    }
  });

  it("a native v2 record carrying [frontier-73c, 1] still decodes to High Velocity — the remap must NOT reach it", () => {
    // A v2 record is NOT legacy: it was written (or laundered) under versioning, so the
    // index 1 means the current `compact` pool's index 1 (High Velocity). The remap
    // applies ONLY to unversioned legacy records.
    const dec = fromData({
      v: 2,
      w: [["nagant-m1895", -1], ["frontier-73c", 1]],
      e: [],
      tr: [],
      n: "",
      b: [],
    });
    expect(dec.weapons[1]).toEqual({ i: FRONTIER, a: 1 });
    expect(AMMO.compact[1][0]).toBe("High Velocity");
  });

  it("the remap is a no-op for a weapon other than frontier-73c", () => {
    // A legacy record carrying a Nagant M1895 (compact, never re-classed) at index 1
    // decodes to High Velocity — the Nagant's pool is `compact` and was never `medium`.
    const dec = fromData({ w: [[0, 1], null], e: [], tr: [], n: "", b: 0 });
    expect(dec.weapons[0]).toEqual({ i: 0, a: 1 });
    expect(AMMO[WEAPONS[0][4]][1][0]).toBe("High Velocity");
  });
});

// Governing: issue #418 (PR 2 of #353), ADR-0009, ADR-0015, SPEC-0006
// REQ "Capacity Rules Are Stated Once and Preserved".
//
// `boundedEquip` clamps a decoded equipment grid to the shared capacity rules: at
// most `slotMax` items (8 minus blocked cells) and at most four per consumable cap
// category. Applied by ALL four decoders so no decode route can skip it — the same
// all-write-paths discipline `boundedTraits` uses for the fifteen-trait cap.
describe("boundedEquip — decode clamps the equipment grid (issue #418)", () => {
  const STICK = CONS.findIndex((c) => c[0] === "dynamite-stick");
  const BUNDLE = CONS.findIndex((c) => c[0] === "dynamite-bundle");
  const SHOT = CONS.findIndex((c) => c[0] === "vitality-shot");

  // Helper: build an equip payload of N copies of one consumable, padded to 8.
  const equipPayload = (...items) => {
    const e = [...items, ...Array(8 - items.length).fill(null)];
    return e.map((x) => (x ? ["C", CONS[x][0]] : null));
  };

  // The over-category payload: 5 Dynamite Sticks (all Throwables, 5 > 4).
  const overCategory = equipPayload(STICK, STICK, STICK, STICK, STICK);

  // Legacy positional payloads use indices into LEGACY_CONS_IDS, not id pairs.
  // dynamite-stick is legacy index 4, so 5 copies = [4, 4, 4, 4, 4, null, null, null].
  const legacyOverCategory = [4, 4, 4, 4, 4].map((i) => ["C", i]);
  const legacyOverCategoryPadded = [...legacyOverCategory, ...Array(8 - legacyOverCategory.length).fill(null)];

  // The over-slot payload: 7 different tools (no per-category cap applies to tools),
  // with 2 blocked cells → slotMax 6, 7 > 6.
  const toolPayload = () => {
    const ids = ["knife", "heavy-knife", "dusters", "throwing-knives", "flare-pistol", "fusees", "spyglass"];
    const e = ids.map((id) => ["T", id]);
    return [...e, ...Array(8 - e.length).fill(null)];
  };

  // Legal: 4 Dynamite Sticks, no overflow.
  const legal = equipPayload(STICK, STICK, STICK, STICK);

  // A versioned wrapper for each decoder.
  const v3 = (e, opts = {}) => ({
    v: 3,
    w: [null, null],
    e,
    tr: [],
    n: "",
    b: opts.blocked || [],
  });
  const v2 = (e, opts = {}) => ({
    v: 2,
    w: [null, null],
    e,
    tr: [],
    n: "",
    b: opts.blocked || [],
  });
  const v1 = (e, opts = {}) => ({
    v: 1,
    w: [null, null],
    e,
    tr: [],
    n: "",
    b: opts.blockedCount || 0,
  });
  const legacy = (e) => ({
    w: [null, null],
    e,
    tr: [],
    n: "",
    b: 0,
  });

  // Legacy tool payloads use positional indices into LEGACY_TOOL_IDS.
  // knife=0, heavy-knife=1, dusters=3, throwing-knives=4, flare-pistol=7, fusees=8, spyglass=10
  const legacyToolPayload = () => {
    const indices = [0, 1, 3, 4, 7, 8, 10];
    const e = indices.map((i) => ["T", i]);
    return [...e, ...Array(8 - e.length).fill(null)];
  };

  // Legacy legal: 4 × dynamite-stick (legacy index 4).
  const legacyLegal = () => {
    const e = [4, 4, 4, 4].map((i) => ["C", i]);
    return [...e, ...Array(8 - e.length).fill(null)];
  };

  it.each([
    ["v3", v3(overCategory)],
    ["v2", v2(overCategory)],
    ["v1", v1(overCategory)],
    ["legacy", legacy(legacyOverCategoryPadded)],
  ])("clamps an over-category record (%s: 5 Throwables → 4)", (_label, payload) => {
    const dec = fromData(payload);
    const held = dec.equip.filter(Boolean);
    expect(held).toHaveLength(4);
    // All four are Dynamite Sticks (the first four survive — the clamp drops from the end).
    expect(held.every((e) => CONS[e.i][0] === "dynamite-stick")).toBe(true);
    // The 5th cell is now a hole.
    expect(dec.equip[4]).toBeNull();
  });

  it.each([
    ["v3", v3(toolPayload(), { blocked: [6, 7] })],
    ["v2", v2(toolPayload(), { blocked: [6, 7] })],
    ["v1", v1(toolPayload(), { blockedCount: 2 })],
  ])("clamps an over-slot record (%s: 7 items, slotMax 6 → 6)", (_label, payload) => {
    const dec = fromData(payload);
    const held = dec.equip.filter(Boolean);
    expect(held).toHaveLength(6);
    expect(dec.equip[6]).toBeNull();
  });

  // Legacy is excluded from the row set above rather than early-returning inside it:
  // its `b` is a trailing COUNT, and these seven tools carry `b: 0`, so slotMax is 8
  // and seven items are legal. Asserting "no clamp" under a title that says "clamps
  // to 6" would describe the opposite of what it checks.
  it("leaves a legacy record of 7 tools untouched — slotMax is 8 with no blocked count", () => {
    const dec = fromData(legacy(legacyToolPayload()));
    expect(dec.equip.filter(Boolean)).toHaveLength(7);
  });

  it.each([
    ["v3", v3(legal)],
    ["v2", v2(legal)],
    ["v1", v1(legal)],
    ["legacy", legacy(legacyLegal())],
  ])("leaves a legal grid untouched (%s: 4 Throwables)", (_label, payload) => {
    const dec = fromData(payload);
    const held = dec.equip.filter(Boolean);
    expect(held).toHaveLength(4);
    expect(held.every((e) => CONS[e.i][0] === "dynamite-stick")).toBe(true);
  });

  it("the clamp is deterministic — the same record decodes to the same loadout", () => {
    const payload = v2(overCategory);
    const dec1 = fromData(payload);
    const dec2 = fromData(payload);
    expect(dec1.equip).toEqual(dec2.equip);
  });

  // Governing: SPEC-0006 REQ "Version 1 Records Migrate Losslessly" — "Decoding SHALL
  // be total: ... no input SHALL produce a blocked list containing a duplicate or an
  // out-of-range index."
  //
  // The out-of-range half was enforced; the duplicate half was not. Nine copies of `0`
  // are nine individually valid indices, so `b` decoded to a nine-element list and the
  // clamp's `8 - blocked.length` went NEGATIVE. A loop dropping items until the count
  // fell below a negative bound could never finish — an infinite loop inside the
  // decoder, reachable from a share link, which freezes the tab rather than blanking
  // it the way issue #201 did. These pin the input, which is where the fix belongs.
  it.each([
    ["duplicates", [0, 0, 0, 0, 0, 0, 0, 0, 0], [0]],
    ["duplicates mixed with distinct", [3, 3, 5, 5, 5, 3], [3, 5]],
    ["out-of-range mixed with duplicates", [9, 2, 2, -1, 2, 99], [2]],
  ])("decodes a v2 record whose blocked list carries %s, deduplicated", (_label, b, expected) => {
    const dec = fromData({
      v: 2,
      w: [null, null],
      e: [["T", "knife"], null, null, null, null, null, null, null],
      tr: [],
      n: "",
      b,
    });
    expect(dec.blocked).toEqual(expected);
    // And the grid still decodes — the item survives, because slotMax is now positive.
    expect(dec.equip.filter(Boolean)).toHaveLength(1);
  });

  it("decodes a v3 record with a duplicate-laden blocked list the same way", () => {
    const dec = fromData({
      v: 3,
      w: [null, null],
      e: [["T", "knife"], null, null, null, null, null, null, null],
      tr: [],
      n: "",
      b: [7, 7, 7, 7, 7, 7, 7, 7, 7],
    });
    expect(dec.blocked).toEqual([7]);
    expect(dec.equip.filter(Boolean)).toHaveLength(1);
  });

  it("clamps to an empty grid when every cell is blocked, without spinning", () => {
    // slotMax 0: nothing may be held. The clamp drops every item and stops, rather
    // than looping on a grid it can no longer make smaller.
    const dec = fromData({
      v: 2,
      w: [null, null],
      e: [["T", "knife"], ["T", "dusters"], null, null, null, null, null, null],
      tr: [],
      n: "",
      b: [0, 1, 2, 3, 4, 5, 6, 7],
    });
    expect(dec.blocked).toHaveLength(8);
    expect(dec.equip.filter(Boolean)).toHaveLength(0);
  });
});

// Governing: issue #26 (created the version envelope), issue #360 (unknown versions
// must not fall through to the legacy positional decoder).
//
// fromData used to fall back to fromLegacy for ANY unrecognized `v` — including `v: 99`,
// `v: "2"`, and a future `v: 4` on an old client. fromLegacy reads item references as
// raw array positions, so a crafted `{v: 99, w: [[20, 1]], ...}` fabricated a real weapon
// (Frontier 73C, $13) from a bare integer. Worse, once FORMAT_VERSION bumps to 4, every
// old client opening a v4 share link would decode it through fromLegacy, persist the
// fabricated result to localStorage, and silently overwrite the reader's stored build.
describe("issue #360 — unknown versions do not route through the legacy decoder", () => {
  it("a v:99 record produces a 'cannot decode' result, not a fabricated loadout", () => {
    const result = fromData({ v: 99, w: [[20, 1], null], e: [["T", 1]], tr: [0], n: "x", b: 0 });
    expect(result).toEqual({ ok: false, v: 99 });
    expect(result).not.toHaveProperty("weapons");
  });

  it("a v:3 record still decodes correctly (known version)", () => {
    const dec = fromData({ v: 3, w: [["nagant-m1895", 1], null], e: [], tr: [], n: "x", b: [] });
    expect(dec.weapons[0]).toEqual({ i: 0, a: 1, d: false });
  });

  it("a v:'2' record (string) produces a 'cannot decode' result", () => {
    const result = fromData({ v: "2", w: [["nagant-m1895", 1], null], e: [], tr: [], n: "x", b: [] });
    expect(result).toEqual({ ok: false, v: "2" });
  });

  it("the specific fabrication case must not decode to a real weapon", () => {
    // Before the fix, {v:3, w:[[20,1],null], e:[["T",1]], tr:[0]} decoded through
    // fromLegacy to a Frontier 73C with a conjured trait and equipment item.
    // (v:3 now routes to fromV3; the fabrication was from the old fallback.)
    // v:99 still triggers the same shape, so it is the regression guard.
    const result = fromData({ v: 99, w: [[20, 1], null], e: [["T", 1]], tr: [0], n: "x", b: 0 });
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("weapons");
    expect(result).not.toHaveProperty("equip");
    expect(result).not.toHaveProperty("traits");
  });

  it("a record with no v field still decodes through fromLegacy (genuine legacy)", () => {
    const dec = fromData({ w: [[0, -1], [16, 2]], e: [["T", 0], ["C", 3]], tr: [0], n: "Old", b: 0 });
    expect(WEAPONS[dec.weapons[0].i][1]).toBe("Nagant M1895");
    expect(dec.traits).toEqual(["quartermaster"]);
  });

  it("readHashLoadout returns null for an undecodable share link", () => {
    // A share link carrying v:99 must not be fed to setLoadout. readHashLoadout
    // returns null so the caller starts fresh rather than crashing or persisting.
    const code = btoa(JSON.stringify({ v: 99, w: [null, null], e: [], tr: [], n: "x", b: [] }));
    history.replaceState(null, "", "#L=" + code);
    expect(readHashLoadout()).toBeNull();
  });

  it("readStoredLoadout returns null for an undecodable stored record", () => {
    localStorage.setItem(LS_CUR, JSON.stringify({ v: 99, w: [null, null], e: [], tr: [], n: "x", b: [] }));
    expect(readStoredLoadout()).toBeNull();
  });
});

// Governing: issue #359. `boundedAmmo` correctly returns -1 for weapons whose pool shrank
// (dolch-96, nitro-express moved to the empty `special` pool), but nothing told the player
// their saved ammo choice vanished and the cost silently dropped. The decoder now attaches
// a `decodeNotices` array to the result so the UI can surface a one-time notice.
describe("issue #359 — ammo-drop notice when decode drops a saved selection", () => {
  const DOLCH = WEAPONS.findIndex((w) => w[0] === "dolch-96");
  const NITRO = WEAPONS.findIndex((w) => w[0] === "nitro-express");
  const NAGANT = WEAPONS.findIndex((w) => w[0] === "nagant-m1895");

  it("a record naming dolch-96 with ammo index 2 decodes with the ammo dropped and a notice", () => {
    const dec = fromData({ v: FORMAT_VERSION, w: [["dolch-96", 2], null], e: [], tr: [], n: "", b: 0 });
    expect(dec.weapons[0]).toEqual({ i: DOLCH, a: -1, d: false });
    expect(dec.decodeNotices).toContainEqual({ kind: "ammo-dropped", slot: 0 });
  });

  it("a record naming nitro-express with ammo index 0 decodes with the ammo dropped and a notice", () => {
    const dec = fromData({ v: FORMAT_VERSION, w: [["nitro-express", 0], null], e: [], tr: [], n: "", b: 0 });
    expect(dec.weapons[0]).toEqual({ i: NITRO, a: -1, d: false });
    expect(dec.decodeNotices).toContainEqual({ kind: "ammo-dropped", slot: 0 });
  });

  it("a record naming dolch-96 with ammo index -1 decodes silently — no notice", () => {
    const dec = fromData({ v: FORMAT_VERSION, w: [["dolch-96", -1], null], e: [], tr: [], n: "", b: 0 });
    expect(dec.weapons[0]).toEqual({ i: DOLCH, a: -1, d: false });
    expect(dec.decodeNotices).toEqual([]);
  });

  it("a weapon on a non-empty pool with a valid index does not raise a notice", () => {
    // Nagant M1895 draws from `compact` (5 variants). Index 1 is valid, so no notice.
    const dec = fromData({ v: FORMAT_VERSION, w: [["nagant-m1895", 1], null], e: [], tr: [], n: "", b: 0 });
    expect(dec.weapons[0]).toEqual({ i: NAGANT, a: 1, d: false });
    expect(dec.decodeNotices).toEqual([]);
  });

  it("a legacy record naming dolch-96 with ammo index 2 also raises the notice", () => {
    // Legacy records carry positional indices, but the post-pass compares the raw entry's
    // ammo index against the decoded value, so legacy drops are detected too.
    const dolchLegacy = LEGACY_WEAPON_IDS.indexOf("dolch-96");
    const dec = fromData({ w: [[dolchLegacy, 2], null], e: [], tr: [], n: "", b: 0 });
    expect(dec.weapons[0]).toEqual({ i: DOLCH, a: -1 });
    expect(dec.decodeNotices).toContainEqual({ kind: "ammo-dropped", slot: 0 });
  });

  it("an empty loadout has no decodeNotices", () => {
    expect(emptyLoadout().decodeNotices).toEqual([]);
  });
});

// Governing: issue #358. `encodeShareUrl` used `btoa(JSON.stringify(toData(loadout)))`, and
// `btoa` throws `InvalidCharacterError` on any code point above U+00FF — so a loadout named
// with an emoji or CJK/Cyrillic/Greek characters made the Share button do nothing (the throw
// escaped uncaught; the `try` wrapped `history.replaceState`, not `btoa`). The fix encodes the
// JSON as UTF-8 before base64, with a symmetric decode that falls back to the legacy raw path.
describe("issue #358 — share URL encoding for non-Latin-1 names", () => {
  function loadoutNamed(name) {
    const lo = emptyLoadout();
    lo.name = name;
    return lo;
  }

  it("encodes a loadout named with an emoji without throwing", () => {
    const lo = loadoutNamed("Loadout 🔥");
    const url = encodeShareUrl(lo);
    expect(url).toMatch(/#L=[A-Za-z0-9+/=]+$/);
  });

  it("encodes a loadout named with CJK characters without throwing", () => {
    const lo = loadoutNamed("日本");
    const url = encodeShareUrl(lo);
    expect(url).toMatch(/#L=[A-Za-z0-9+/=]+$/);
  });

  it("round-trips a non-Latin-1 name through encodeShareUrl and readHashLoadout", () => {
    const lo = loadoutNamed("Loadout 🔥");
    const url = encodeShareUrl(lo);
    // readHashLoadout reads location.hash, which encodeShareUrl set via history.replaceState.
    const dec = readHashLoadout();
    expect(dec).not.toBeNull();
    expect(dec.name).toBe("Loadout 🔥");
  });

  it("round-trips a CJK name through encodeShareUrl and readHashLoadout", () => {
    const lo = loadoutNamed("日本");
    encodeShareUrl(lo);
    const dec = readHashLoadout();
    expect(dec).not.toBeNull();
    expect(dec.name).toBe("日本");
  });

  it("a legacy share code (raw Latin-1 base64 of plain-ASCII) still decodes correctly", () => {
    // Simulate a pre-fix share code: raw btoa(JSON.stringify(toData(loadout))) on a
    // plain-ASCII name. This is the code the OLD encoder produced.
    const lo = loadoutNamed("Plain ASCII build");
    const legacyCode = btoa(JSON.stringify(toData(lo)));
    // Set the hash so readHashLoadout can read it.
    history.replaceState(null, "", "#L=" + legacyCode);
    const dec = readHashLoadout();
    expect(dec).not.toBeNull();
    expect(dec.name).toBe("Plain ASCII build");
  });

  it("a legacy share code naming a Latin-1 accented character (not plain ASCII) still decodes correctly", () => {
    // The regression this guards: a pre-fix share code built by the OLD raw-btoa encoder
    // can carry a Latin-1 character in U+0080..U+00FF (e.g. "é" is U+00E9) — `btoa` allows
    // these, it only throws above U+00FF. Read as raw bytes, "é" is the single byte 0xE9,
    // which is NOT valid standalone UTF-8 (0xE9 starts a 3-byte sequence with no
    // continuation bytes following). `decodeBase64Utf8` must throw on this so
    // readHashLoadout's catch falls through to the legacy `atob` path — if it instead
    // silently substitutes U+FFFD (TextDecoder's default, non-fatal behavior), the name
    // decodes as mangled text instead of falling back.
    const lo = loadoutNamed("Café");
    const legacyCode = btoa(JSON.stringify(toData(lo)));
    history.replaceState(null, "", "#L=" + legacyCode);
    const dec = readHashLoadout();
    expect(dec).not.toBeNull();
    expect(dec.name).toBe("Café");
  });

  it("a plain-ASCII name round-trips through the new encoder too", () => {
    const lo = loadoutNamed("Café");
    encodeShareUrl(lo);
    const dec = readHashLoadout();
    expect(dec).not.toBeNull();
    expect(dec.name).toBe("Café");
  });
});
