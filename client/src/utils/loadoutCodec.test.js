import { describe, expect, it } from "vitest";
import { CONS, TOOLS, TRAITS, WEAPONS } from "../data/catalog.js";
import { FORMAT_VERSION, emptyLoadout, fromData, toData } from "./loadoutCodec.js";

// Governing: issue #26 (stable catalog ids + schema versioning for saved/share encodings)
//
// Regression coverage for the wire-format migration: v1 encodes items by stable catalog id
// (immune to array reorders), and the legacy pre-versioning index-based encoding still decodes
// against the catalog's current order. Both must round-trip to the same in-memory loadout.

function sampleLoadout() {
  const lo = emptyLoadout();
  lo.weapons = [{ i: 0, a: -1 }, { i: 14, a: 2 }]; // Nagant M1895, Dolch 96 + ammo variant
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
    expect(dec.weapons).toEqual([{ i: 0, a: -1 }, { i: 14, a: 2 }]);
    expect(dec.equip).toEqual([{ t: "T", i: 0 }, { t: "C", i: 3 }]);
    expect(dec.traits).toEqual([TRAITS.findIndex((t) => t[0] === "quartermaster")]);
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

describe("fromData (legacy index-based wire format)", () => {
  it("decodes a legacy record against the current catalog order", () => {
    const legacy = {
      w: [[0, -1], [14, 2]],
      e: [["T", 0], ["C", 3]],
      tr: [0],
      n: "Old build",
      b: 0,
    };
    const dec = fromData(legacy);
    expect(dec.weapons).toEqual([{ i: 0, a: -1 }, { i: 14, a: 2 }]);
    expect(dec.equip).toEqual([{ t: "T", i: 0 }, { t: "C", i: 3 }]);
    expect(dec.traits).toEqual([0]);
    expect(dec.name).toBe("Old build");
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
    expect(dec.traits).toEqual([0]);
  });

  it("returns an empty loadout for null/non-object input", () => {
    expect(fromData(null)).toEqual(emptyLoadout());
    expect(fromData("garbage")).toEqual(emptyLoadout());
  });
});
