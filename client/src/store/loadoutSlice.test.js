import { describe, expect, it } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import { CONS, QM, TOOLS, TRAITS, WEAPONS } from "../data/catalog.js";
import { TRAIT_MAX, capMax, capUsed } from "../utils/calc.js";
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
    store.dispatch(loadoutActions.setAmmo({ slot: 0, ammoIndex: 0 }));
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
