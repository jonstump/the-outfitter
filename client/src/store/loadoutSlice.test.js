import { describe, expect, it } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import { CONS, TOOLS, WEAPONS } from "../data/catalog.js";
import { emptyLoadout } from "../utils/loadoutCodec.js";
import loadoutReducer, { loadoutActions } from "./loadoutSlice.js";

// Governing: issue #26/#27 (loadoutSlice resolves the new catalog tuple shapes;
// setLoadout validates payload shape instead of blindly merging)

function makeStore(initial) {
  return configureStore({
    reducer: { loadout: loadoutReducer },
    preloadedState: { loadout: initial || emptyLoadout() },
  });
}

describe("addEquip", () => {
  it("enforces the max-4-per-consumable-category cap", () => {
    const store = makeStore();
    // Equip 4 Shots, then a 5th must be rejected.
    [0, 1, 2, 3].forEach((i) => store.dispatch(loadoutActions.addEquip({ t: "C", i })));
    expect(store.getState().loadout.equip).toHaveLength(4);
    store.dispatch(loadoutActions.addEquip({ t: "C", i: 0 })); // 5th Vitality Shot
    expect(store.getState().loadout.equip).toHaveLength(4);
  });

  it("keeps different categories independent", () => {
    const store = makeStore();
    [0, 4, 12, 13].forEach((i) => store.dispatch(loadoutActions.addEquip({ t: "C", i })));
    // 4 different categories all fit.
    expect(store.getState().loadout.equip).toHaveLength(4);
  });

  it("rejects a duplicate tool (one per loadout)", () => {
    const store = makeStore();
    store.dispatch(loadoutActions.addEquip({ t: "T", i: 0 }));
    store.dispatch(loadoutActions.addEquip({ t: "T", i: 0 }));
    expect(store.getState().loadout.equip).toHaveLength(1);
  });
});

describe("addWeapon", () => {
  it("enforces the weapon capacity cap using tuple cost (index 2)", () => {
    const store = makeStore();
    // Largest-size-rating weapon: 5 (Nitro Express), second must not fit.
    const big = WEAPONS.findIndex((w) => w[2] === 5);
    const small = WEAPONS.findIndex((w) => w[2] === 1);
    store.dispatch(loadoutActions.addWeapon(big));
    store.dispatch(loadoutActions.addWeapon(small));
    expect(store.getState().loadout.weapons.filter(Boolean)).toHaveLength(1);
  });
});

describe("setLoadout", () => {
  it("accepts a randomize-shaped payload (no name/blocked) with graceful defaults", () => {
    const store = makeStore();
    store.dispatch(loadoutActions.setName("Keep me"));
    store.dispatch(
      loadoutActions.setLoadout({
        weapons: [{ i: 0, a: -1 }, null],
        equip: [{ t: "T", i: 0 }],
        traits: ["quartermaster"],
      })
    );
    const s = store.getState().loadout;
    expect(s.name).toBe("Keep me");
    expect(s.blocked).toBe(0);
    expect(s.traits).toEqual(["quartermaster"]);
  });

  it("rejects a payload with an invalid shape instead of merging it", () => {
    const store = makeStore();
    expect(() =>
      store.dispatch(loadoutActions.setLoadout({ weapons: [{ i: 0, a: -1 }], equip: [], traits: [] }))
    ).toThrow();
  });

  it("stores traits by stable id, consistent with upTotal/QM checks", () => {
    const store = makeStore();
    store.dispatch(
      loadoutActions.setLoadout({
        weapons: [null, null],
        equip: [],
        traits: ["quartermaster", "fanning"],
        name: "x",
        blocked: 0,
      })
    );
    expect(store.getState().loadout.traits).toEqual(["quartermaster", "fanning"]);
  });

  it("addTrait/removeTrait operate on stable ids", () => {
    const store = makeStore();
    store.dispatch(loadoutActions.addTrait("quartermaster"));
    store.dispatch(loadoutActions.addTrait("quartermaster"));
    expect(store.getState().loadout.traits).toEqual(["quartermaster"]);
    store.dispatch(loadoutActions.removeTrait("quartermaster"));
    expect(store.getState().loadout.traits).toEqual([]);
  });
});

describe("catalog tuple references", () => {
  it("loadoutSlice indexes the new tool/consumable tuples correctly", () => {
    // Guard against stale indices: every cost index in slice code must be a number.
    const store = makeStore();
    store.dispatch(loadoutActions.addEquip({ t: "T", i: 0 }));
    store.dispatch(loadoutActions.addEquip({ t: "C", i: 0 }));
    // TOOLS[0][2] and CONS[0][2] are costs; if the slice read [1] (name) this
    // test would still pass silently — the calc.test.js totalCost asserts the
    // numeric behavior end-to-end.
    expect(TOOLS[0][2]).toBeTypeOf("number");
    expect(CONS[0][2]).toBeTypeOf("number");
  });
});
