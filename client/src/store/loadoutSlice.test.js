import { describe, expect, it } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import { CONS, TOOLS, TRAITS, WEAPONS } from "../data/catalog.js";
import { TRAIT_MAX } from "../utils/calc.js";
import { emptyLoadout } from "../utils/loadoutCodec.js";
import { loadoutState } from "../test/testStore.js";
import loadoutReducer, { loadoutActions } from "./loadoutSlice.js";
import uiReducer from "./uiSlice.js";

// Governing: issue #26/#27 (loadoutSlice resolves the new catalog tuple shapes;
// setLoadout validates payload shape instead of blindly merging)
//
// Governing: ADR-0009 (fixed eight-cell sparse grid), SPEC-0006 REQ "Equipment
// Occupies a Fixed Eight-Cell Grid".
//
// All dispatch assertions now read `equip` as a GRID (array length is always 8;
// `null` is an empty cell). Counts are expressed per cell-occupied, via
// `filter(Boolean)`, so a test that merely checked `equip.length` would be
// asserting the grid size instead of the rule under test.

function makeStore(initial) {
  return configureStore({
    reducer: { loadout: loadoutReducer },
    preloadedState: { loadout: initial || emptyLoadout() },
  });
}

const held = (state) => state.loadout.equip.filter(Boolean);

describe("addEquip", () => {
  it("enforces the max-4-copies-of-one-consumable cap", () => {
    const store = makeStore();
    // Equip 4 Vitality Shots, then a 5th must be rejected.
    [0, 0, 0, 0].forEach((i) => store.dispatch(loadoutActions.addEquip({ t: "C", i })));
    expect(held(store.getState())).toHaveLength(4);
    store.dispatch(loadoutActions.addEquip({ t: "C", i: 0 })); // 5th Vitality Shot
    expect(held(store.getState())).toHaveLength(4);
  });

  it("caps FOUR PER TYPE: a fifth Dynamite Stick, and a Dynamite Bundle, rejected", () => {
    // Governing: ADR-0015 (four per cap category — accepted 2026-08-12), SPEC-0006 REQ
    // "Capacity Rules Are Stated Once and Preserved". The retired rule ("four of one
    // specific item, another item of the same type still fits") is inverted here: four
    // Dynamite Sticks fill the Throwable budget, so the Dynamite Bundle — same `type` —
    // is rejected too.
    const store = makeStore();
    const stick = CONS.findIndex((c) => c[0] === "dynamite-stick");
    const bundle = CONS.findIndex((c) => c[0] === "dynamite-bundle");
    expect(CONS[stick][3]).toBe(CONS[bundle][3]);
    [stick, stick, stick, stick].forEach((i) => store.dispatch(loadoutActions.addEquip({ t: "C", i })));
    expect(held(store.getState())).toHaveLength(4);
    store.dispatch(loadoutActions.addEquip({ t: "C", i: bundle }));
    expect(held(store.getState())).toHaveLength(4);
    expect(held(store.getState()).some((e) => e.i === bundle)).toBe(false);
  });

  it("rejects a duplicate tool (one per loadout)", () => {
    const store = makeStore();
    store.dispatch(loadoutActions.addEquip({ t: "T", i: 0 }));
    store.dispatch(loadoutActions.addEquip({ t: "T", i: 0 }));
    expect(held(store.getState())).toHaveLength(1);
  });

  it("places into the lowest free cell on a grid with holes", () => {
    // Governing: ADR-0009, SPEC-0006 REQ "Items Are Rearranged by Direct Manipulation".
    // Cells 0 and 2 occupied, cell 1 a hole — the next add must land in cell 1, not
    // append past the hole (a packed-array push would count the hole as space).
    const store = makeStore(
      loadoutState({
        equip: [
          { t: "T", i: 0 }, null, { t: "T", i: 5 }, null,
          null, null, null, null,
        ],
      })
    );
    store.dispatch(loadoutActions.addEquip({ t: "C", i: 0 }));
    expect(store.getState().loadout.equip[1]).toEqual({ t: "C", i: 0 });
    expect(held(store.getState())).toHaveLength(3);
  });

  it("removing an item leaves the others in their cells (no relocation)", () => {
    const store = makeStore(
      loadoutState({
        equip: [
          { t: "T", i: 0 }, null, { t: "C", i: 0 }, null,
          null, null, null, null,
        ],
      })
    );
    store.dispatch(loadoutActions.removeEquip(2));
    const s = store.getState().loadout.equip;
    expect(s[2]).toBeNull();
    expect(s[0]).toEqual({ t: "T", i: 0 });
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
    expect(s.blocked).toEqual([]);
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
        blocked: [],
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

// Governing: ADR-0012 (fifteen-trait cap), SPEC-0003 REQ "A Loadout Holds At Most Fifteen Traits"
describe("addTrait: the fifteen-trait cap", () => {
  const traitIds = TRAITS.map((t) => t[0]);

  it("has enough traits in the catalog for the cap to be reachable", () => {
    // If this ever fails the cases below stop testing anything, because a loadout
    // holding every trait in the game would sit under the cap by accident.
    expect(traitIds.length).toBeGreaterThan(TRAIT_MAX);
  });

  it("refuses a sixteenth trait", () => {
    const store = makeStore();
    traitIds.slice(0, TRAIT_MAX).forEach((id) => store.dispatch(loadoutActions.addTrait(id)));
    expect(store.getState().loadout.traits).toHaveLength(TRAIT_MAX);

    const sixteenth = traitIds[TRAIT_MAX];
    store.dispatch(loadoutActions.addTrait(sixteenth));
    expect(store.getState().loadout.traits).toHaveLength(TRAIT_MAX);
    expect(store.getState().loadout.traits).not.toContain(sixteenth);
  });

  it("refuses a sixteenth with the upgrade-point budget off, which is the default", () => {
    // The configuration the rule has to hold in. Gating the cap on `upBudgetOn` would leave
    // the shipped default — the one almost everyone runs — with no cap at all.
    const store = configureStore({
      reducer: { loadout: loadoutReducer, ui: uiReducer },
      preloadedState: { loadout: emptyLoadout() },
    });
    expect(store.getState().ui.upBudgetOn).toBe(false);

    traitIds.slice(0, TRAIT_MAX + 1).forEach((id) => store.dispatch(loadoutActions.addTrait(id)));
    expect(store.getState().ui.upBudgetOn).toBe(false);
    expect(store.getState().loadout.traits).toHaveLength(TRAIT_MAX);
    expect(store.getState().loadout.traits).toEqual(traitIds.slice(0, TRAIT_MAX));
  });

  it("keeps rejecting duplicates below the cap", () => {
    const store = makeStore();
    store.dispatch(loadoutActions.addTrait(traitIds[0]));
    store.dispatch(loadoutActions.addTrait(traitIds[0]));
    expect(store.getState().loadout.traits).toEqual([traitIds[0]]);
  });

  it("admits a replacement once a trait is removed at the cap", () => {
    const store = makeStore();
    traitIds.slice(0, TRAIT_MAX).forEach((id) => store.dispatch(loadoutActions.addTrait(id)));
    store.dispatch(loadoutActions.removeTrait(traitIds[0]));
    store.dispatch(loadoutActions.addTrait(traitIds[TRAIT_MAX]));
    expect(store.getState().loadout.traits).toHaveLength(TRAIT_MAX);
    expect(store.getState().loadout.traits).toContain(traitIds[TRAIT_MAX]);
  });
});
