import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Governing: ADR-0014, SPEC-0010, issue #344 — retires #384's original scenario rather than
// preserving it unmodified.
//
// #384's `mkAmmo` looked up `AMMO[WEAPONS[i][4]]` unguarded — a weapon whose `ammoClass` was
// absent from the shared pool table threw roughly 30% of draws. #344 replaced that lookup
// entirely: `mkAmmo` now reads `ammoSlotsFor(weaponId)`, which reads the weapon's OWN scraped
// `ammo` record (client/src/data/itemStats.json) and never touches `ammoClass` or the AMMO
// pool table at all. Mocking `ammoClass` to a nonexistent value, as this test used to, would
// now exercise nothing — the code path it targeted no longer exists.
//
// The equivalent hazard in the NEW model is a weapon whose scraped stats record is missing
// (or has no `ammo` field) — `ammoSlotsFor`'s own contract (itemStats.js) already degrades
// that to `{ count: 0, ... }` rather than throwing, but `mkAmmo` consuming it must not
// reintroduce a crash on top of a well-formed empty result. Constructed with a mock rather
// than a real fixture row, for the same reason #384 gave: there is no live weapon this
// uncovered today.
vi.mock("../data/itemStats.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    // Every weapon looks up as if the scrape never covered it — the same "uncovered id"
    // state ammoSlotsFor's own doc comment says statsFor degrades to, applied uniformly so
    // any randomize draw exercises it regardless of which weapon is randomly selected.
    ammoSlotsFor: () => ({ count: 0, bound: false, groups: [] }),
  };
});

describe("randomizeLoadout mkAmmo guard (issue #344, retiring #384's ammoClass scenario)", () => {
  let randomizeLoadout;

  beforeEach(async () => {
    vi.resetModules();
    ({ randomizeLoadout } = await import("./randomize.js"));
  });

  afterEach(() => {
    vi.doUnmock("../data/itemStats.js");
    vi.resetModules();
  });

  it("draws no ammo for a weapon with no scraped ammo slots, rather than throwing", () => {
    for (let k = 0; k < 20; k++) {
      let result;
      expect(() => {
        result = randomizeLoadout({ blocked: [] });
      }).not.toThrow();
      for (const w of result.weapons) {
        if (w) expect(w.ammo).toEqual([null, null]);
      }
    }
  });
});
