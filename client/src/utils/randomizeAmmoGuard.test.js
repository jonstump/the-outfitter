import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Governing: issue #384 (mirrors the AMMO-lookup guard in calc.js:152)
//
// `mkAmmo` in randomize.js looks up `AMMO[WEAPONS[i][4]]` unguarded. calc.js's `totalCost`
// makes the same lookup at line 225 defensively — `(AMMO[WEAPONS[w.i][4]] || [])[w.a]` — so a
// weapon whose `ammoClass` is absent from the AMMO table cannot throw there. Before this fix,
// mkAmmo had no such guard, so the same missing-class weapon would throw a TypeError roughly
// 30% of draws (whenever the 0.3 chance to roll ammo hit).
//
// Not live today — every catalog ammoClass currently resolves in AMMO — so this scenario is
// constructed with a mocked catalog rather than a real catalog row, per the issue's explicit
// instruction not to add a fixture row to client/src/data/catalog.js.
vi.mock("../data/catalog.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    // Every weapon's ammoClass is replaced with a key that does not exist in AMMO, so any
    // mkAmmo draw exercises the unguarded-lookup path regardless of which weapon is randomly
    // selected.
    WEAPONS: actual.WEAPONS.map((w) => [w[0], w[1], w[2], w[3], "nonexistent-ammo-class", w[5]]),
  };
});

describe("randomizeLoadout mkAmmo guard (issue #384)", () => {
  let randomizeLoadout;

  beforeEach(async () => {
    vi.resetModules();
    ({ randomizeLoadout } = await import("./randomize.js"));
  });

  afterEach(() => {
    vi.doUnmock("../data/catalog.js");
    vi.resetModules();
  });

  it("draws no ammo for a weapon whose ammoClass is absent from AMMO, rather than throwing", () => {
    for (let k = 0; k < 20; k++) {
      let result;
      expect(() => {
        result = randomizeLoadout({ blocked: [] });
      }).not.toThrow();
      for (const w of result.weapons) {
        if (w) expect(w.a).toBe(-1);
      }
    }
  });
});
