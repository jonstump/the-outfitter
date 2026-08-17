import { describe, expect, it } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import { CONS, QM, TOOLS, TRAITS, WEAPONS } from "../data/catalog.js";
import { dualWieldFor } from "../data/itemStats.js";
import { TRAIT_MAX, capMax, capUsed, weaponSize } from "../utils/calc.js";
import { emptyLoadout, fromData, toData } from "../utils/loadoutCodec.js";
import { loadoutState } from "../test/testStore.js";
import loadoutReducer, { loadoutActions } from "./loadoutSlice.js";
import uiReducer from "./uiSlice.js";
import { randomizeLoadout } from "../utils/randomize.js";

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
    preloadedState: { loadout: initial || { ...emptyLoadout(), savedId: null, nameIsDerived: true } },
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

  it("caps Tarot Cards at four per type, using four DIFFERENT cards (#37)", () => {
    // Governing: ADR-0013 (Scarce items at zero cost), ADR-0015 (four per cap category),
    // SPEC-0006 REQ "Capacity Rules Are Stated Once and Preserved".
    //
    // Four DIFFERENT cards on purpose. Four copies of one card would be rejected by the RETIRED
    // per-item rule as readily as by the per-type rule in force, so such a test passes either way
    // and proves nothing about which rule is running. Five distinct cards can only be capped by a
    // per-type budget.
    //
    // This is also the assertion behind "no new modelling": `CONS_CAP_CATEGORIES` already declared
    // "Tarot Cards" while the table held none, so admitting rows in #37 capped them with no change
    // to calc.js or the reducer.
    const store = makeStore();
    const cards = CONS.map((c, i) => [c, i]).filter(([c]) => c[3] === "Tarot Cards");
    expect(cards.length, "the fourteen were admitted by #37").toBe(14);
    const [a, b, c, d, e] = cards.map(([, i]) => i);
    [a, b, c, d].forEach((i) => store.dispatch(loadoutActions.addEquip({ t: "C", i })));
    expect(held(store.getState())).toHaveLength(4);
    // A FIFTH distinct card is refused — the budget is the category's, not the item's.
    store.dispatch(loadoutActions.addEquip({ t: "C", i: e }));
    expect(held(store.getState())).toHaveLength(4);
    expect(held(store.getState()).some((x) => x.i === e)).toBe(false);
    // And the four that landed really are four different cards, not one repeated.
    expect(new Set(held(store.getState()).map((x) => x.i)).size).toBe(4);
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

  // Governing: SPEC-0006 REQ "Repeated Consumables Read as One Stack" — "Adding a
  // consumable from the picker that is already equipped SHALL place the new copy in
  // the cell immediately following the last cell of an existing run of that item,
  // when that cell is free and unblocked. Otherwise it SHALL fall back to the
  // lowest-numbered free, unblocked cell." Corrected 2026-08-17 per `/sdd:audit`.
  describe("picker run-append placement (SPEC-0006, corrected 2026-08-17)", () => {
    it("grows an existing run from the picker, even when a lower cell is free", () => {
      // The bug this regression-tests: a run at cells 5-6 (indices 4-5) with cell 1
      // (index 0) free used to always take the lowest free cell, so the third copy
      // landed AHEAD of the run instead of extending it.
      const store = makeStore(
        loadoutState({
          equip: [
            null, { t: "T", i: 0 }, { t: "T", i: 5 }, null,
            { t: "C", i: 0 }, { t: "C", i: 0 }, null, null,
          ],
        })
      );
      store.dispatch(loadoutActions.addEquip({ t: "C", i: 0 }));
      expect(store.getState().loadout.equip[6]).toEqual({ t: "C", i: 0 });
      expect(store.getState().loadout.equip[0]).toBeNull();
    });

    it("falls back to the lowest free cell when the cell after the run is occupied", () => {
      // Spec's own scenario: run at cells 1-2, cell 3 holds a different item, cell 4
      // is free — the new copy lands at cell 4, not extending past the occupied cell.
      const store = makeStore(
        loadoutState({
          equip: [
            { t: "C", i: 0 }, { t: "C", i: 0 }, { t: "T", i: 0 }, null,
            null, null, null, null,
          ],
        })
      );
      store.dispatch(loadoutActions.addEquip({ t: "C", i: 0 }));
      expect(store.getState().loadout.equip[3]).toEqual({ t: "C", i: 0 });
      // The original run is untouched — still exactly two cells.
      expect(store.getState().loadout.equip[1]).toEqual({ t: "C", i: 0 });
    });

    it("falls back to the lowest free cell when the cell after the run is blocked", () => {
      const store = makeStore(
        loadoutState({
          equip: [
            null, { t: "C", i: 0 }, { t: "C", i: 0 }, null,
            null, null, null, null,
          ],
          blocked: [3],
        })
      );
      store.dispatch(loadoutActions.addEquip({ t: "C", i: 0 }));
      expect(store.getState().loadout.equip[0]).toEqual({ t: "C", i: 0 });
      expect(store.getState().loadout.equip[3]).toBeNull();
    });

    it("falls back to the lowest free cell when no run of that item exists yet", () => {
      const store = makeStore(
        loadoutState({
          equip: [
            { t: "T", i: 0 }, null, null, null,
            null, null, null, null,
          ],
        })
      );
      store.dispatch(loadoutActions.addEquip({ t: "C", i: 0 }));
      expect(store.getState().loadout.equip[1]).toEqual({ t: "C", i: 0 });
    });
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

// Governing: issue #352, ADR-0009 (fixed eight-cell grid), ADR-0015 (per-type caps).
//
// `moveEquip` had zero test coverage and a defect: when `from` was empty and `to` was
// filled, `moving` bound to `equip[to]` and BOTH cells were assigned it, duplicating
// the item. The dead `moving === null` guard could never fire because `moving` was
// read from the destination. This suite exercises all four occupancy combinations
// (empty→empty, empty→filled, filled→empty, filled→filled) plus the regression: a
// duplicate must never survive a move.
describe("moveEquip — the four occupancy combinations", () => {
  const KNIFE = TOOLS.findIndex((t) => t[0] === "knife");
  const equip = (cells) => [...cells, ...Array(8 - cells.length).fill(null)];

  it("empty→empty is a no-op", () => {
    const store = makeStore(loadoutState({ equip: equip([null, null]) }));
    store.dispatch(loadoutActions.moveEquip({ from: 0, to: 1 }));
    const s = store.getState().loadout.equip;
    expect(s[0]).toBeNull();
    expect(s[1]).toBeNull();
  });

  it("empty→filled is REFUSED (no duplication): the filled cell stays, the empty cell stays empty", () => {
    // The defect: `moving` bound to `equip[to]` and both cells were assigned it,
    // duplicating the item. The guard now requires an occupant at `from`.
    const store = makeStore(loadoutState({ equip: equip([null, { t: "T", i: KNIFE }]) }));
    store.dispatch(loadoutActions.moveEquip({ from: 0, to: 1 }));
    const s = store.getState().loadout.equip;
    expect(s[0]).toBeNull();
    expect(s[1]).toEqual({ t: "T", i: KNIFE });
    // No duplication — exactly one item is held.
    expect(held(store.getState())).toHaveLength(1);
  });

  it("filled→empty moves the item", () => {
    const store = makeStore(loadoutState({ equip: equip([{ t: "T", i: KNIFE }, null]) }));
    store.dispatch(loadoutActions.moveEquip({ from: 0, to: 1 }));
    const s = store.getState().loadout.equip;
    expect(s[0]).toBeNull();
    expect(s[1]).toEqual({ t: "T", i: KNIFE });
    expect(held(store.getState())).toHaveLength(1);
  });

  it("filled→filled swaps the two items (a permutation)", () => {
    const VITALITY = CONS.findIndex((c) => c[0] === "vitality-shot");
    const store = makeStore(
      loadoutState({
        equip: equip([{ t: "T", i: KNIFE }, { t: "C", i: VITALITY }]),
      })
    );
    store.dispatch(loadoutActions.moveEquip({ from: 0, to: 1 }));
    const s = store.getState().loadout.equip;
    expect(s[0]).toEqual({ t: "C", i: VITALITY });
    expect(s[1]).toEqual({ t: "T", i: KNIFE });
    expect(held(store.getState())).toHaveLength(2);
  });

  it("from===to is a no-op", () => {
    const store = makeStore(loadoutState({ equip: equip([{ t: "T", i: KNIFE }, null]) }));
    store.dispatch(loadoutActions.moveEquip({ from: 0, to: 0 }));
    expect(store.getState().loadout.equip[0]).toEqual({ t: "T", i: KNIFE });
  });

  it("dragged off the grid (to: -1) unequips the source cell", () => {
    const store = makeStore(loadoutState({ equip: equip([{ t: "T", i: KNIFE }, null]) }));
    store.dispatch(loadoutActions.moveEquip({ from: 0, to: -1 }));
    expect(store.getState().loadout.equip[0]).toBeNull();
    expect(held(store.getState())).toHaveLength(0);
  });

  it("dragged off the grid from an EMPTY cell is a no-op", () => {
    const store = makeStore(loadoutState({ equip: equip([null, { t: "T", i: KNIFE }]) }));
    store.dispatch(loadoutActions.moveEquip({ from: 0, to: -1 }));
    // The source is empty, so nothing is unequipped — the other cell is untouched.
    expect(store.getState().loadout.equip[1]).toEqual({ t: "T", i: KNIFE });
    expect(held(store.getState())).toHaveLength(1);
  });

  it("a move involving a blocked cell is refused", () => {
    const store = makeStore(
      loadoutState({
        equip: equip([{ t: "T", i: KNIFE }, null]),
        blocked: [1],
      })
    );
    store.dispatch(loadoutActions.moveEquip({ from: 0, to: 1 }));
    expect(store.getState().loadout.equip[0]).toEqual({ t: "T", i: KNIFE });
    expect(store.getState().loadout.equip[1]).toBeNull();
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
        // Padded to eight cells (ADR-0009): the shape guard requires exactly eight (#382).
        equip: [{ t: "T", i: 0 }, null, null, null, null, null, null, null],
        traits: ["quartermaster"],
      })
    );
    const s = store.getState().loadout;
    // No savedId → nameIsDerived is true, so the name re-derives from the weapons
    // (SPEC-0003 REQ "A Loadout's Name Is Derived From Its Weapons Until the User
    // Owns It"). A randomize-shaped payload has no savedId, so it derives.
    expect(s.name).toBe(WEAPONS[0][1]);
    expect(s.blocked).toEqual([]);
    expect(s.traits).toEqual(["quartermaster"]);
  });

  it("rejects a payload with an invalid shape instead of merging it", () => {
    const store = makeStore();
    expect(() =>
      store.dispatch(loadoutActions.setLoadout({ weapons: [{ i: 0, a: -1 }], equip: [], traits: [] }))
    ).toThrow();
  });

  // Governing: ADR-0009 (fixed eight-cell grid), SPEC-0006, issue #382
  //
  // The shape guard used to be an UPPER bound only (`equip.length > 8`), so a shorter
  // array passed through verbatim — after which `hasFreeCell` finds no `null` and
  // reports the grid full, while EquipmentPanel still renders eight cells. The guard
  // is now exact, matching the server's existing check (server/src/routes/loadouts.js).
  describe("the equip shape guard is exact, not an upper bound (#382)", () => {
    const validWeapons = [null, null];

    it("rejects a three-cell equip array, leaving the store unchanged", () => {
      const store = makeStore();
      store.dispatch(loadoutActions.setName("Keep me"));
      const before = store.getState().loadout;
      expect(() =>
        store.dispatch(
          loadoutActions.setLoadout({ weapons: validWeapons, equip: [null, null, null], traits: [] })
        )
      ).toThrow();
      expect(store.getState().loadout).toEqual(before);
    });

    it("still rejects a nine-cell equip array (the upper bound must not regress)", () => {
      const store = makeStore();
      store.dispatch(loadoutActions.setName("Keep me"));
      const before = store.getState().loadout;
      expect(() =>
        store.dispatch(
          loadoutActions.setLoadout({ weapons: validWeapons, equip: Array(9).fill(null), traits: [] })
        )
      ).toThrow();
      expect(store.getState().loadout).toEqual(before);
    });

    it("accepts an exactly-eight-cell equip array", () => {
      const store = makeStore();
      store.dispatch(
        loadoutActions.setLoadout({
          weapons: validWeapons,
          equip: [{ t: "T", i: 0 }, null, null, null, null, null, null, null],
          traits: [],
        })
      );
      expect(store.getState().loadout.equip).toHaveLength(8);
      expect(store.getState().loadout.equip[0]).toEqual({ t: "T", i: 0 });
    });
  });

  it("stores traits by stable id, consistent with upTotal/QM checks", () => {
    const store = makeStore();
    store.dispatch(
      loadoutActions.setLoadout({
        weapons: [null, null],
        // Padded to eight cells (ADR-0009): the shape guard requires exactly eight (#382).
        equip: Array(8).fill(null),
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

// Governing: ADR-0022, SPEC-0003 REQ "A Loadout's Name Is Derived From Its Weapons
// Until the User Owns It". A loadout's name defaults to "{weapon1} and {weapon2}"
// from the equipped weapons, and re-derives only on weapon changes. Typing takes
// ownership permanently; a loaded record never re-derives.
describe("derived loadout name", () => {
  // Weapon indices used across these tests:
  // 0 = "Nagant M1895", 1 = "Conversion"
  const W0 = 0;
  const W1 = 1;
  const NAME0 = WEAPONS[W0][1];
  const NAME1 = WEAPONS[W1][1];

  it("derives the name from the first weapon added", () => {
    const store = makeStore();
    store.dispatch(loadoutActions.addWeapon(W0));
    expect(store.getState().loadout.name).toBe(NAME0);
  });

  it("derives \"{first} and {second}\" in slot order when two weapons are held", () => {
    const store = makeStore();
    store.dispatch(loadoutActions.addWeapon(W0));
    store.dispatch(loadoutActions.addWeapon(W1));
    expect(store.getState().loadout.name).toBe(`${NAME0} and ${NAME1}`);
  });

  it("re-derives from what remains when a weapon is removed", () => {
    const store = makeStore();
    store.dispatch(loadoutActions.addWeapon(W0));
    store.dispatch(loadoutActions.addWeapon(W1));
    // Remove the primary (slot 0). The secondary stays put in slot 1 — nothing is
    // compacted; `derivedName` simply skips the now-empty slot.
    store.dispatch(loadoutActions.removeWeapon(0));
    expect(store.getState().loadout.name).toBe(NAME1);
  });

  it("yields that weapon's name alone for one weapon — no \"and\"", () => {
    const store = makeStore();
    store.dispatch(loadoutActions.addWeapon(W0));
    const name = store.getState().loadout.name;
    expect(name).toBe(NAME0);
    expect(name).not.toContain(" and ");
  });

  it("yields the empty string for no weapons — never a dangling \"and\"", () => {
    const store = makeStore();
    // Fresh build: no weapons. nameIsDerived is true, so the name is derived (empty).
    expect(store.getState().loadout.nameIsDerived).toBe(true);
    const name = store.getState().loadout.name;
    expect(name).toBe("");
    expect(name).not.toBe("and");
    expect(name).not.toBe(" and ");
    expect(name).not.toBe("undefined and undefined");
  });

  it("does not change the name on setAmmo — a name cannot express a round", () => {
    const store = makeStore();
    store.dispatch(loadoutActions.addWeapon(W0));
    const before = store.getState().loadout.name;
    // The name must have been derived from the weapon — not left empty.
    expect(before).toBe(NAME0);
    store.dispatch(loadoutActions.setAmmo({ slot: 0, ammoSlotIndex: 0, ammoId: "ammo-compact-high-velocity" }));
    expect(store.getState().loadout.name).toBe(before);
  });

  it("leaves a derived name byte-identical when a consumable is added", () => {
    const store = makeStore();
    store.dispatch(loadoutActions.addWeapon(W0));
    const before = store.getState().loadout.name;
    expect(before).toBe(NAME0);
    store.dispatch(loadoutActions.addEquip({ t: "C", i: 0 }));
    expect(store.getState().loadout.name).toBe(before);
  });

  it("leaves a derived name byte-identical when a tool is added", () => {
    const store = makeStore();
    store.dispatch(loadoutActions.addWeapon(W0));
    const before = store.getState().loadout.name;
    expect(before).toBe(NAME0);
    store.dispatch(loadoutActions.addEquip({ t: "T", i: 0 }));
    expect(store.getState().loadout.name).toBe(before);
  });

  it("leaves a derived name byte-identical when a trait is added", () => {
    const store = makeStore();
    store.dispatch(loadoutActions.addWeapon(W0));
    const before = store.getState().loadout.name;
    expect(before).toBe(NAME0);
    store.dispatch(loadoutActions.addTrait(TRAITS[0][0]));
    expect(store.getState().loadout.name).toBe(before);
  });

  it("does not alter the name after setName, even on a weapon change", () => {
    const store = makeStore();
    store.dispatch(loadoutActions.addWeapon(W0));
    store.dispatch(loadoutActions.setName("My Build"));
    // setName takes ownership — nameIsDerived must be false.
    expect(store.getState().loadout.nameIsDerived).toBe(false);
    // Adding a second weapon must NOT overwrite the owned name.
    store.dispatch(loadoutActions.addWeapon(W1));
    expect(store.getState().loadout.name).toBe("My Build");
    // Removing a weapon must NOT overwrite it either.
    store.dispatch(loadoutActions.removeWeapon(0));
    expect(store.getState().loadout.name).toBe("My Build");
  });

  it("resets to a derived name after clearBuild, even if the user had typed", () => {
    const store = makeStore();
    store.dispatch(loadoutActions.addWeapon(W0));
    store.dispatch(loadoutActions.setName("Owned"));
    store.dispatch(loadoutActions.clearBuild());
    expect(store.getState().loadout.name).toBe("");
    expect(store.getState().loadout.nameIsDerived).toBe(true);
    // A weapon change after clearing re-derives again.
    store.dispatch(loadoutActions.addWeapon(W1));
    expect(store.getState().loadout.name).toBe(NAME1);
  });

  // Governing: ADR-0022, SPEC-0003 REQ "Loadout Identity Is Scoped to Its List". Reported
  // as a live bug: load a saved loadout, hit Clear, build something new, save it to a
  // different (or Unassigned) list — the save overwrote the ORIGINAL loaded record instead
  // of filing the new build where the user pointed it. Root cause: `saveCurrent`
  // (savedLoadoutsSlice.js) sends `loadout.savedId` as an id-addressing argument, and the
  // server resolves an id-addressed save against that record ONLY, ignoring the selected
  // list entirely. `clearBuild` is the one control that starts an unrelated build, so it
  // MUST sever that provenance the same way `setLoadout` already does for every other
  // fresh-build path (randomize, share URL, hydration — all via `payload.savedId ?? null`).
  it("clears savedId on clearBuild, so a save after Clear cannot address the loaded record", () => {
    const store = makeStore();
    store.dispatch(loadoutActions.setSavedId("loaded-from-a-list-record-id"));
    expect(store.getState().loadout.savedId).toBe("loaded-from-a-list-record-id");
    store.dispatch(loadoutActions.clearBuild());
    expect(store.getState().loadout.savedId).toBeNull();
  });

  // The store subscriber persists the loadout to localStorage on every change
  // (store/index.js), and App.jsx hydrates it through setLoadout on boot with no
  // savedId. A typed name is on the wire (`n`), so deriving over a hydrated payload
  // would destroy it on every reload. Deriving keys off BOTH savedId and name.
  it("keeps a typed name through a toData/fromData round trip and re-hydration", () => {
    const s1 = makeStore();
    s1.dispatch(loadoutActions.addWeapon(W0));
    s1.dispatch(loadoutActions.setName("Doc's Rat Slayer"));
    const persisted = toData(s1.getState().loadout);
    expect(persisted.n).toBe("Doc's Rat Slayer");

    // Fresh boot: hydrate the persisted draft exactly as App.jsx does.
    const s2 = makeStore();
    s2.dispatch(loadoutActions.setLoadout(fromData(persisted)));
    expect(s2.getState().loadout.name).toBe("Doc's Rat Slayer");
    // The name came in owned, so a later weapon change must not overwrite it.
    expect(s2.getState().loadout.nameIsDerived).toBe(false);
    s2.dispatch(loadoutActions.addWeapon(W1));
    expect(s2.getState().loadout.name).toBe("Doc's Rat Slayer");
  });

  it("still derives on hydration when the persisted draft carried no name", () => {
    const s1 = makeStore();
    s1.dispatch(loadoutActions.addWeapon(W0));
    const persisted = toData(s1.getState().loadout);
    // Nothing was typed, so the persisted name is the derived one; hydrating it must
    // leave the loadout still-derived rather than latching it as owned.
    const s2 = makeStore();
    s2.dispatch(loadoutActions.setLoadout({ ...fromData(persisted), name: "" }));
    expect(s2.getState().loadout.nameIsDerived).toBe(true);
    expect(s2.getState().loadout.name).toBe(NAME0);
    s2.dispatch(loadoutActions.addWeapon(W1));
    expect(s2.getState().loadout.name).toBe(`${NAME0} and ${NAME1}`);
  });

  it("does not re-derive when a weapon changes on a loadout loaded with savedId", () => {
    // A loadout loaded from a saved record has an owned name — savedId is set, so
    // nameIsDerived is false. Weapon changes must not overwrite it.
    const store = makeStore(loadoutState({
      weapons: [{ i: W0, a: -1 }, null],
      name: "Loaded Name",
      savedId: "rec-1",
      nameIsDerived: false,
    }));
    expect(store.getState().loadout.nameIsDerived).toBe(false);
    // Adding a weapon must not re-derive because nameIsDerived is false.
    store.dispatch(loadoutActions.addWeapon(W1));
    expect(store.getState().loadout.name).toBe("Loaded Name");
    expect(store.getState().loadout.nameIsDerived).toBe(false);
  });
});

// Governing: ADR-0022, SPEC-0003 REQ "A Loadout's Name Is Derived From Its Weapons Until
// the User Owns It" (issue #316, area B)
//
// Derived names are a pure function of the weapon pair, so two builds with the same two
// weapons get the same name BY CONSTRUCTION — no user error required. Under the old
// `(owner, name)` upsert key that would have been systematic data loss: saving the second
// build would overwrite and relocate the first. The current `(owner, listId, name)` triple
// key makes the two records coexist.
//
// This test pins the collision that makes the triple key load-bearing. The server-side proof
// that two same-named records in different lists survive is in
// `server/src/routes/filing.test.js` — "keeps two same-named loadouts in different lists,
// relocating neither". This is the client half: it produces the collision that test proves
// survivable. If someone "simplifies" the key back to `(owner, name)`, the server test fails
// and this test explains what it cost.
describe("identical weapon pairs derive identical names (the collision the triple key survives)", () => {
  // Two size-1 weapons so both fit. 0 = Nagant M1895, 1 = Conversion.
  const W0 = 0;
  const W1 = 1;
  const EXPECTED = `${WEAPONS[W0][1]} and ${WEAPONS[W1][1]}`;

  it("two builds with the same weapon pair produce the same derived name", () => {
    const s1 = makeStore();
    s1.dispatch(loadoutActions.addWeapon(W0));
    s1.dispatch(loadoutActions.addWeapon(W1));

    const s2 = makeStore();
    s2.dispatch(loadoutActions.addWeapon(W0));
    s2.dispatch(loadoutActions.addWeapon(W1));

    const name1 = s1.getState().loadout.name;
    const name2 = s2.getState().loadout.name;

    expect(name1).toBe(EXPECTED);
    expect(name2).toBe(EXPECTED);
    // The collision: two independent builds share one name, by construction.
    expect(name1).toBe(name2);
  });
});

// Governing: SPEC-0009 REQ "A Loadout Holds Exactly Two Weapon Entries", REQ "The
// Weapon Budget Is Five Points, Six With Quartermaster", REQ "The Weapon Budget Is
// Enforced at Every Write Path", ADR-0023.
//
// The reducer-side pins for the rules the calc predicates above state. Sizes are read
// from `WEAPONS[i][2]`, and Quartermaster is the real catalog id (`QM`), so neither a
// catalog rebalance nor a trait rename can silently invalidate these.
describe("SPEC-0009: the weapon budget in the reducer", () => {
  it("gives a fresh loadout two null weapon entries", () => {
    const store = makeStore();
    const w = store.getState().loadout.weapons;
    expect(w).toHaveLength(2);
    expect(w[0]).toBeNull();
    expect(w[1]).toBeNull();
  });

  it("keeps a 6-point loadout over capacity when Quartermaster is removed, removing no weapon", () => {
    const store = makeStore();
    const size3 = WEAPONS.findIndex((w) => w[2] === 3);
    store.dispatch(loadoutActions.addTrait(QM));
    store.dispatch(loadoutActions.addWeapon(size3));
    store.dispatch(loadoutActions.addWeapon(size3));
    expect(capUsed(store.getState().loadout)).toBe(6);

    store.dispatch(loadoutActions.removeTrait(QM));
    // Remaining over capacity under the 5-point ceiling, and both entries still held.
    expect(capMax(store.getState().loadout)).toBe(5);
    expect(capUsed(store.getState().loadout)).toBe(6);
    expect(store.getState().loadout.weapons.every((w) => w !== null && WEAPONS[w.i][2] === 3)).toBe(true);
  });

  it("refuses an oversized weapon with 1 point remaining, leaving both entries unchanged", () => {
    const store = makeStore();
    const size4 = WEAPONS.findIndex((w) => w[2] === 4);
    const size5 = WEAPONS.findIndex((w) => w[2] === 5);
    const size1 = WEAPONS.findIndex((w) => w[2] === 1);
    store.dispatch(loadoutActions.addWeapon(size4));
    store.dispatch(loadoutActions.addWeapon(size1));
    expect(capUsed(store.getState().loadout)).toBe(5);
    expect(store.getState().loadout.weapons.filter(Boolean)).toHaveLength(2);

    // The refused add must leave the two held entries exactly as they were.
    const before = store.getState().loadout.weapons.map((w) => w && { i: w.i, a: w.a });
    store.dispatch(loadoutActions.addWeapon(size5));
    expect(store.getState().loadout.weapons.map((w) => w && { i: w.i, a: w.a })).toEqual(before);
  });

  it("rejects a bulk-set payload with a weapons array of length 1, leaving the store unchanged", () => {
    const store = makeStore();
    store.dispatch(loadoutActions.setName("Keep me"));
    const before = store.getState().loadout;
    expect(() =>
      store.dispatch(
        loadoutActions.setLoadout({
          // One weapon entry — the shape guard must refuse before anything is merged.
          weapons: [{ i: 0, a: -1 }],
          equip: [],
          traits: [],
        })
      )
    ).toThrow();
    expect(store.getState().loadout).toEqual(before);
  });

  it("randomized loadouts total no more than the capacity their own traits grant", () => {
    // The generator's draw respects the budget rule no matter which traits it lands on:
    // whatever the generated build carries, its occupied capacity must stay within the
    // capacity that same trait set grants. Sizes come from the catalog, so a rebalance
    // that started generating over-cap draws fails here rather than shipping.
    for (let i = 0; i < 30; i++) {
      const drawn = randomizeLoadout({});
      expect(capUsed(drawn)).toBeLessThanOrEqual(capMax(drawn));
    }
  });
});

// Governing: ADR-0023, SPEC-0009 REQ "The Pair Flag Is Refused Wherever the Data Does Not
// Permit It", REQ "A Pair Never Consumes the Second Weapon Entry", REQ "A Pair Costs Its
// Weapon's Size Plus One".
//
// The pair flag (dual-wield) normalization and gating in STORE STATE. Every weapon in
// loadout state carries a boolean `d` — not merely falsy, since `undefined` is falsy and
// is exactly the value this invariant exists to eliminate. The flag is refused at every
// route that can write it — addWeapon, setLoadout, and the generator — never inferred,
// and read only from the stored per-weapon attribute (`dualWieldFor`).
describe("SPEC-0009: the dual-wield pair flag in state", () => {
  // Real catalog pair: a size-1 dual-wieldable pistol (Conversion) and a size-3 rifle
  // (Frontier 73C). Sizes come from WEAPONS[i][2].
  const PISTOL = WEAPONS.findIndex((w) => w[0] === "caldwell-conversion-pistol");
  const RIFLE = WEAPONS.findIndex((w) => w[0] === "frontier-73c");
  // A real weapon the stored attribute does NOT mark dual-wieldable.
  const HAYMAKER = WEAPONS.findIndex((w) => w[0] === "haymaker");
  const AMMO_ID = "ammo-compact-fmj"; // a real round the Conversion's own accepted list has

  it("addWeapon gives the new weapon a boolean d of false", () => {
    const store = makeStore();
    store.dispatch(loadoutActions.addWeapon(PISTOL));
    const w = store.getState().loadout.weapons[0];
    expect(typeof w.d).toBe("boolean");
    expect(w.d).toBe(false);
  });

  it("addWeapon adds a single even when the weapon IS dual-wieldable", () => {
    // The load-bearing case: the Conversion is pairable by the stored attribute, so if the
    // interactive path ever started inferring a pair, this is where it would show. It adds
    // a single regardless — the pair toggle and its refusal ship with the affordance (#333).
    expect(dualWieldFor(WEAPONS[PISTOL][0])).toBe(true);
    const store = makeStore();
    store.dispatch(loadoutActions.addWeapon(PISTOL));
    expect(store.getState().loadout.weapons[0]).toEqual({ i: PISTOL, ammo: [null, null], d: false });
    // And the capacity it occupies is the single's, not the pair's — a size-1 pistol added
    // through this route costs 1, never 2.
    expect(capUsed(store.getState().loadout)).toBe(WEAPONS[PISTOL][2]);

    // A non-pairable weapon lands the same way, so `d: false` here is not a coincidence of
    // the stored attribute — the route simply does not write the flag.
    expect(dualWieldFor(WEAPONS[HAYMAKER][0])).not.toBe(true);
    const other = makeStore();
    other.dispatch(loadoutActions.addWeapon(HAYMAKER));
    expect(other.getState().loadout.weapons[0]).toEqual({ i: HAYMAKER, ammo: [null, null], d: false });
  });

  it("a pair + a size-3 rifle is a legal 5-point loadout, and marking the pistol as a pair leaves the rifle in place", () => {
    const store = makeStore();
    store.dispatch(loadoutActions.addWeapon(PISTOL));
    store.dispatch(loadoutActions.addWeapon(RIFLE));
    let s = store.getState().loadout;
    expect(s.weapons[0]).toEqual({ i: PISTOL, ammo: [null, null], d: false });
    expect(s.weapons[1]).toEqual({ i: RIFLE, ammo: [null, null], d: false });
    // Marking the already-held pistol as a pair (via setLoadout, the pair-carrying route)
    // must leave the rifle's entry untouched — a pair never consumes the second slot.
    const withFlag = s.weapons.map((w) => (w && w.i === PISTOL ? { ...w, d: true } : w));
    store.dispatch(loadoutActions.setLoadout({ ...s, weapons: withFlag }));
    s = store.getState().loadout;
    expect(s.weapons[0]).toEqual({ i: PISTOL, ammo: [null, null], d: true });
    expect(s.weapons[1]).toEqual({ i: RIFLE, ammo: [null, null], d: false });
    expect(weaponSize(s.weapons[0])).toBe(2);
    expect(capUsed(s)).toBe(5);
    expect(capUsed(s)).toBeLessThanOrEqual(capMax(s));
  });

  it("a pair costs its size plus one, which is what turns 1 point remaining into a refusal", () => {
    const store = makeStore();
    store.dispatch(loadoutActions.addWeapon(RIFLE)); // 3 points
    store.dispatch(loadoutActions.addWeapon(PISTOL)); // size-1 single fits -> 4
    let s = store.getState().loadout;
    expect(s.weapons[0]).toEqual({ i: RIFLE, ammo: [null, null], d: false });
    expect(s.weapons[1]).toEqual({ i: PISTOL, ammo: [null, null], d: false });
    expect(capUsed(s)).toBe(4);

    // Exactly 1 point remains. The pair would cost 2 (size 1 + 1), pushing to 6 over the
    // 5-point cap — the arithmetic the picker/affordance will refuse on (a later story).
    // This story owns the cost: assert that the pair's occupied capacity is what overflows.
    const pairEntry = { i: PISTOL, ammo: [null, null], d: true };
    expect(weaponSize(pairEntry)).toBe(2);
    expect(capUsed(s) + weaponSize(pairEntry)).toBe(6);
    expect(capUsed(s) + weaponSize(pairEntry)).toBeGreaterThan(capMax(s));
    // The single still fits, and the pair flag is not silently written in a way that
    // would store an over-capacity build (the capacity refusal is the affordance's gate).
    expect(s.weapons[1]).toEqual({ i: PISTOL, ammo: [null, null], d: false });
  });

  it("setLoadout normalizes every weapon in a version-2 record to a boolean d", () => {
    // Build the v2 payload with fromData, per the acceptance criterion — do not hand-write
    // the decoded shape. fromData gives d-less {i, a} entries (v2 cannot express a pair).
    const decoded = fromData({
      v: 2,
      w: [
        [WEAPONS[PISTOL][0], 1], // a v2 wire entry is still a bare live-pool index, not an id
        [WEAPONS[RIFLE][0], -1],
      ],
      e: [],
      tr: [],
      n: "x",
      b: [],
    });
    // The decoder itself leaves `d` absent (proven by #330's tests, which still pass).
    expect(decoded.weapons[0]).not.toHaveProperty("d");

    const store = makeStore();
    store.dispatch(loadoutActions.setLoadout({ ...decoded, name: "x" }));
    const [w0, w1] = store.getState().loadout.weapons;
    expect(typeof w0.d).toBe("boolean");
    expect(typeof w1.d).toBe("boolean");
    expect(w0.d).toBe(false);
    expect(w1.d).toBe(false);
  });

  it("setLoadout strikes an impermissible pair flag to false, reflecting the single's capacity", () => {
    // A decoded share URL carrying the flag on a weapon the data does not permit — the
    // flag must NOT reach state, and occupied capacity must reflect the single only.
    const store = makeStore();
    store.dispatch(
      loadoutActions.setLoadout({
        weapons: [
          { i: HAYMAKER, a: -1, d: true }, // haymaker: shared size with the Uppercut, NOT pairable
          null,
        ],
        // Padded to eight cells (ADR-0009): the shape guard requires exactly eight (#382).
        equip: Array(8).fill(null),
        traits: [],
      })
    );
    const w = store.getState().loadout.weapons[0];
    expect(typeof w.d).toBe("boolean");
    expect(w.d).toBe(false);
    expect(capUsed(store.getState().loadout)).toBe(WEAPONS[HAYMAKER][2]); // single, not +1
  });

  it("marking a pair leaves the ammo selection byte-identical (setAmmo then toggle d)", () => {
    const store = makeStore();
    store.dispatch(loadoutActions.addWeapon(PISTOL));
    store.dispatch(loadoutActions.setAmmo({ slot: 0, ammoSlotIndex: 0, ammoId: AMMO_ID }));
    const before = store.getState().loadout.weapons[0].ammo;
    // The pair flag is normalized onto a state entry that already carries its ammo.
    // `equip` comes from the emptyLoadout() spread (already eight cells, ADR-0009) —
    // the shape guard requires exactly eight, not overridden here (#382).
    store.dispatch(
      loadoutActions.setLoadout({ ...emptyLoadout(), weapons: [{ i: PISTOL, ammo: before, d: true }, null], traits: [] })
    );
    expect(store.getState().loadout.weapons[0].ammo).toEqual(before);
    expect(store.getState().loadout.weapons[0].d).toBe(true);
    expect(Object.keys(store.getState().loadout.weapons[0]).sort()).toEqual(["ammo", "d", "i"].sort());
  });

  it("the generator emits weapons whose d is a boolean, and never a flag the data disallows", () => {
    for (let i = 0; i < 30; i++) {
      const drawn = randomizeLoadout({});
      for (const w of drawn.weapons) {
        if (w === null) continue;
        expect(typeof w.d).toBe("boolean");
        if (w.d === true) expect(dualWieldFor(WEAPONS[w.i][0])).toBe(true);
      }
    }
  });

  // Governing: issue #400. The toggle is dispatched DIRECTLY — #333's acceptance criterion
  // ("the toggle reducer refuses an over-budget pair on its own, tested by dispatching the
  // action directly rather than through the button") was delivered as a disabled-button
  // click in #399, which is a DOM no-op and proves nothing about the guard.
  describe("togglePair — direct dispatch", () => {
    it("refuses an over-budget pair on its own, leaving the weapon a single", () => {
      // The issue's own repro shape: a size-1 pairable pistol (Conversion) + a size-4
      // rifle (Springfield) = 5 of 5, no slack. Marking the pair costs size + 1 = 2,
      // so 2 + 4 = 6 > capMax 5 — refused, and capUsed stays 5.
      const size4 = WEAPONS.findIndex((w) => w[2] === 4);
      const store = makeStore();
      store.dispatch(loadoutActions.addWeapon(size4));
      store.dispatch(loadoutActions.addWeapon(PISTOL));
      let s = store.getState().loadout;
      expect(capUsed(s)).toBe(5);
      expect(capMax(s)).toBe(5);

      // Direct dispatch of the toggle — the affordance's disabled button is not involved.
      store.dispatch(loadoutActions.togglePair(1));
      s = store.getState().loadout;
      expect(s.weapons[1].d).toBe(false);
      expect(capUsed(s)).toBe(5);
    });

    it("refuses to mark a pair for a weapon the data does not allow, by stored attribute not size", () => {
      // Haymaker is size 2 and NOT pairable; the Uppercut is also size 2 and IS pairable.
      // The stored attribute decides — never the size (SPEC-0009 "never derived").
      expect(dualWieldFor(WEAPONS[HAYMAKER][0])).not.toBe(true);
      const store = makeStore();
      store.dispatch(loadoutActions.addWeapon(HAYMAKER));
      store.dispatch(loadoutActions.togglePair(0));
      const s = store.getState().loadout;
      expect(s.weapons[0].d).toBe(false);
      expect(capUsed(s)).toBe(WEAPONS[HAYMAKER][2]);
    });

    it("regression: un-pairing succeeds while over capacity, and is never refused", () => {
      // The bug (#400): the capacity guard previously forced d:true in BOTH directions,
      // so an un-pair was costed as a pair and silently dropped when capUsed already
      // exceeded capMax — the one situation where un-pairing is the fix. Reachable via
      // removeTrait(Quartermaster) (no clamp) or an over-budget decoded save.
      const size4 = WEAPONS.findIndex((w) => w[2] === 4);
      const store = makeStore({
        weapons: [{ i: PISTOL, a: -1, d: true }, { i: size4, a: -1, d: false }],
        traits: [QM],
        equip: [],
      });
      let s = store.getState().loadout;
      expect(capUsed(s)).toBe(6);
      expect(capMax(s)).toBe(6); // quartermaster

      // Remove Quartermaster: capMax falls to 5 while occupied capacity stays at 6 — the
      // loadout is now over capacity, and un-pairing must still succeed.
      store.dispatch(loadoutActions.removeTrait(QM));
      s = store.getState().loadout;
      expect(capMax(s)).toBe(5);
      expect(capUsed(s)).toBe(6);
      expect(s.weapons[0].d).toBe(true);

      store.dispatch(loadoutActions.togglePair(0));
      s = store.getState().loadout;
      expect(s.weapons[0].d).toBe(false);
      expect(capUsed(s)).toBe(5); // size-1 single instead of the 2-point pair
    });
  });
});
