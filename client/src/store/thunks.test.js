import { describe, expect, it, vi } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import { emptyLoadout } from "../utils/loadoutCodec.js";
import { WEAPONS } from "../data/catalog.js";
import { encodeShareUrl, toData } from "../utils/loadoutCodec.js";
import loadoutReducer, { loadoutActions } from "./loadoutSlice.js";
import uiReducer from "./uiSlice.js";
import savedLoadoutsReducer, { saveCurrent } from "./savedLoadoutsSlice.js";
import { loadSavedThunk, randomizeThunk, shareThunk } from "./thunks.js";

// Governing: issue #27 (randomize's payload must satisfy setLoadout's shape
// validation — a shape mismatch used to throw inside the reducer and crashed the
// Randomize button)

function makeStore() {
  return configureStore({
    reducer: {
      loadout: loadoutReducer,
      ui: uiReducer,
    },
    preloadedState: {
      loadout: { ...emptyLoadout(), savedId: null, nameIsDerived: true },
      ui: {
        tab: "Weapons",
        search: "",
        group: "All",
        sizeFilter: "All",
        ammoF: "All",
        budgetOn: false,
        budget: 300,
        upBudgetOn: false,
        upBudget: 5,
        message: "",
      },
    },
  });
}

const validData = {
  v: 2,
  w: [["nagant-m1895", -1], null],
  e: [["T", "first-aid-kit"], null, null, null, null, null, null, null],
  tr: ["quartermaster"],
  n: "Test build",
  b: [],
};

describe("randomizeThunk", () => {
  it("dispatches setLoadout without throwing (crash regression)", () => {
    const store = makeStore();
    // Randomize is fired directly from the button with no try/catch; if the
    // payload fails shape validation the reducer throws and the button dies.
    expect(() => store.dispatch(randomizeThunk())).not.toThrow();
    const s = store.getState().loadout;
    expect(Array.isArray(s.weapons)).toBe(true);
    expect(s.weapons).toHaveLength(2);
    expect(Array.isArray(s.equip)).toBe(true);
    expect(Array.isArray(s.traits)).toBe(true);
  });

  it("clears the message banner after randomizing", () => {
    const store = makeStore();
    store.dispatch({ type: "ui/setMessage", payload: "old banner" });
    store.dispatch(randomizeThunk());
    expect(store.getState().ui.message).toBe("");
  });

  // Governing: ADR-0022, SPEC-0003 REQ "The Saved-Loadout Wire Format Is Unchanged" —
  // a randomized loadout has no provenance, so `savedId` must be null. The `?? null`
  // default in `setLoadout` is what clears it.
  it("leaves savedId null after randomizing", () => {
    const store = makeStore();
    // Seed a savedId to prove randomize clears it.
    store.dispatch({ type: "loadout/setSavedId", payload: "some-existing-id" });
    expect(store.getState().loadout.savedId).toBe("some-existing-id");
    store.dispatch(randomizeThunk());
    expect(store.getState().loadout.savedId).toBeNull();
  });
});

// Governing: ADR-0022, SPEC-0003 REQ "Loadout Identity Is Scoped to Its List" —
// loading a saved record puts `record.id` into `state.loadout.savedId` so a
// subsequent save addresses that record by id.
describe("loadSavedThunk", () => {
  it("puts record.id into state.loadout.savedId", () => {
    const store = makeStore();
    const record = { id: "abc-123", name: "My Build", data: validData };
    store.dispatch(loadSavedThunk(record));
    expect(store.getState().loadout.savedId).toBe("abc-123");
  });

  it("decodes the wire payload into the loadout state", () => {
    const store = makeStore();
    const record = { id: "abc-456", name: "Whatever", data: validData };
    store.dispatch(loadSavedThunk(record));
    const s = store.getState().loadout;
    expect(s.weapons).toHaveLength(2);
    expect(s.weapons[0]).not.toBeNull();
    expect(s.name).toBe("Test build");
  });

  it("announces the loaded record name in the message banner", () => {
    const store = makeStore();
    store.dispatch(loadSavedThunk({ id: "x", name: "Fanning", data: validData }));
    expect(store.getState().ui.message).toContain("Fanning");
  });
});

// Governing: ADR-0022, SPEC-0003 REQ "A Loadout's Name Is Derived From Its Weapons
// Until the User Owns It". A randomized loadout (no savedId) derives its name from
// the rolled weapons; a loadout loaded from a saved record (savedId set) does not.
describe("derived name on setLoadout paths", () => {
  it("a randomized loadout derives its name from its weapons", () => {
    const store = makeStore();
    store.dispatch(randomizeThunk());
    const s = store.getState().loadout;
    expect(s.nameIsDerived).toBe(true);
    // If randomize rolled weapons, the name should reflect them. If it rolled none
    // (unlikely but possible), the name is "". Either way it must be derived.
    const weapons = s.weapons.filter(Boolean);
    if (weapons.length === 1) {
      expect(s.name).toBe(WEAPONS[weapons[0].i][1]);
      expect(s.name).not.toContain(" and ");
    } else if (weapons.length === 2) {
      expect(s.name).toBe(`${WEAPONS[weapons[0].i][1]} and ${WEAPONS[weapons[1].i][1]}`);
    }
  });

  it("a loadout loaded with savedId does not re-derive on weapon change", () => {
    const store = makeStore();
    const record = { id: "rec-xyz", name: "Owned Name", data: validData };
    store.dispatch(loadSavedThunk(record));
    expect(store.getState().loadout.nameIsDerived).toBe(false);
    expect(store.getState().loadout.name).toBe("Test build");
    // A weapon change must not overwrite the owned name.
    store.dispatch(loadoutActions.addWeapon(0));
    expect(store.getState().loadout.name).toBe("Test build");
  });

  it("toData output contains no nameIsDerived key, and a share URL does not carry it", () => {
    const store = makeStore();
    store.dispatch(loadoutActions.addWeapon(0));
    const lo = store.getState().loadout;
    const enc = toData(lo);
    expect(enc).not.toHaveProperty("nameIsDerived");
    expect(Object.keys(enc).sort()).toEqual(["b", "e", "n", "tr", "v", "w"]);
    const url = encodeShareUrl(lo);
    expect(url).not.toContain("nameIsDerived");
  });
});

// Governing: ADR-0022, SPEC-0003 REQ "Loadout Identity Is Scoped to Its List" and
// REQ "A Loadout's Name Is Derived From Its Weapons Until the User Owns It" (issue #316, area C)
//
// The sharpest interaction: a loadout loaded from a saved record has an owned name AND a
// savedId. Renaming it and saving must update THAT SAME RECORD by id — not create a copy
// or match some other record by name. And a weapon change after loading must NOT re-derive,
// even though it would on a fresh build. This is the test that fails if someone wires
// derivation to weapon changes without checking savedId first.
describe("load → rename → save interaction (savedId + derived names together)", () => {
  function makeSaveStore() {
    return configureStore({
      reducer: {
        loadout: loadoutReducer,
        ui: uiReducer,
        savedLoadouts: savedLoadoutsReducer,
      },
      preloadedState: {
        loadout: { ...emptyLoadout(), savedId: null, nameIsDerived: true },
        ui: { message: "" },
        savedLoadouts: { items: [], status: "idle", error: null },
      },
    });
  }

  const respond = (obj, status = 200) => ({ ok: status < 400, status, json: async () => obj });
  const bodyOf = (call) => JSON.parse(call[1].body);

  const validData = {
    v: 2,
    w: [["nagant-m1895", -1], null],
    e: [["T", "first-aid-kit"], null, null, null, null, null, null, null],
    tr: ["quartermaster"],
    n: "Original Name",
    b: [],
  };

  it("load → rename → save addresses the original record by id, carrying the new name", async () => {
    vi.stubGlobal("fetch", vi.fn());
    try {
      global.fetch.mockResolvedValueOnce(
        respond({ id: "rec-original", name: "Renamed", data: {}, listId: null })
      );
      const store = makeSaveStore();

      // 1. Load a saved record.
      store.dispatch(loadSavedThunk({ id: "rec-original", name: "Original Name", data: validData }));
      expect(store.getState().loadout.savedId).toBe("rec-original");
      expect(store.getState().loadout.nameIsDerived).toBe(false);

      // 2. Rename it.
      store.dispatch(loadoutActions.setName("Renamed"));

      // 3. Save — the request must carry the record's id and the NEW name.
      await store.dispatch(saveCurrent());

      const [, opts] = global.fetch.mock.calls.at(-1);
      expect(opts.method).toBe("POST");
      const body = bodyOf(global.fetch.mock.calls.at(-1));
      expect(body.id).toBe("rec-original");
      expect(body.name).toBe("Renamed");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("a weapon change after loading does not re-derive the name, even though it would on a fresh build", () => {
    // This is the test that fails if someone wires derivation to weapon changes without
    // checking savedId first. A loaded loadout has nameIsDerived=false, so addWeapon must
    // NOT call derivedName.
    vi.stubGlobal("fetch", vi.fn());
    try {
      const store = makeSaveStore();
      store.dispatch(loadSavedThunk({ id: "rec-w", name: "My Build", data: validData }));
      expect(store.getState().loadout.name).toBe("Original Name");
      expect(store.getState().loadout.nameIsDerived).toBe(false);

      // Add a weapon. On a fresh build this would re-derive. On a loaded build it must not.
      store.dispatch(loadoutActions.addWeapon(0));
      expect(store.getState().loadout.name).toBe("Original Name");
      expect(store.getState().loadout.nameIsDerived).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// Governing: ADR-0022, SPEC-0003 REQ "Loadout Identity Is Scoped to Its List" and
// REQ "A Loadout's Name Is Derived From Its Weapons Until the User Owns It" (issue #316, area D)
//
// A fresh build with a derived name saves with NO `id` in the request body — it upserts on
// the triple. After the first save succeeds, the loadout adopts the returned record's id,
// so a second save carries `id`. A randomized build has no savedId and saves by triple too.
describe("fresh vs loaded save addressing (triple vs id)", () => {
  function makeSaveStore() {
    return configureStore({
      reducer: {
        loadout: loadoutReducer,
        ui: uiReducer,
        savedLoadouts: savedLoadoutsReducer,
      },
      preloadedState: {
        loadout: { ...emptyLoadout(), savedId: null, nameIsDerived: true },
        ui: { message: "" },
        savedLoadouts: { items: [], status: "idle", error: null },
      },
    });
  }

  const respond = (obj, status = 200) => ({ ok: status < 400, status, json: async () => obj });
  const bodyOf = (call) => JSON.parse(call[1].body);

  it("a fresh build saves with no id — it upserts on the triple", async () => {
    vi.stubGlobal("fetch", vi.fn());
    try {
      global.fetch.mockResolvedValueOnce(
        respond({ id: "rec-first", name: "Nagant M1895", data: {}, listId: null })
      );
      const store = makeSaveStore();
      // Add a weapon so the name is derived (not empty, not "Unnamed loadout").
      store.dispatch(loadoutActions.addWeapon(0));
      expect(store.getState().loadout.savedId).toBeNull();

      await store.dispatch(saveCurrent());

      const body = bodyOf(global.fetch.mock.calls.at(-1));
      expect(body).not.toHaveProperty("id");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("after the first save succeeds, a second save carries id", async () => {
    vi.stubGlobal("fetch", vi.fn());
    try {
      global.fetch
        .mockResolvedValueOnce(
          respond({ id: "rec-first", name: "Nagant M1895", data: {}, listId: null })
        )
        .mockResolvedValueOnce(
          respond({ id: "rec-first", name: "Nagant M1895", data: {}, listId: null })
        );
      const store = makeSaveStore();
      store.dispatch(loadoutActions.addWeapon(0));

      // First save: no id (triple).
      await store.dispatch(saveCurrent());
      const firstBody = bodyOf(global.fetch.mock.calls.at(-1));
      expect(firstBody).not.toHaveProperty("id");

      // The loadout now carries the returned id.
      expect(store.getState().loadout.savedId).toBe("rec-first");

      // Second save: carries id.
      await store.dispatch(saveCurrent());
      const secondBody = bodyOf(global.fetch.mock.calls.at(-1));
      expect(secondBody.id).toBe("rec-first");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("a randomized build saves with no id — it upserts on the triple", async () => {
    vi.stubGlobal("fetch", vi.fn());
    try {
      global.fetch.mockResolvedValueOnce(
        respond({ id: "rec-rand", name: "Some Name", data: {}, listId: null })
      );
      const store = makeSaveStore();
      store.dispatch(randomizeThunk());
      expect(store.getState().loadout.savedId).toBeNull();
      expect(store.getState().loadout.nameIsDerived).toBe(true);

      await store.dispatch(saveCurrent());

      const body = bodyOf(global.fetch.mock.calls.at(-1));
      expect(body).not.toHaveProperty("id");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// Governing: issue #358. `shareThunk` had no try/catch around `encodeShareUrl`, so an encode
// failure (e.g. `btoa` throwing on non-Latin-1 characters) escaped uncaught and the Share
// button did nothing — no toast, no error. The thunk now wraps the call so a failure
// dispatches a `setMessage` instead of throwing silently.
describe("shareThunk error handling (issue #358)", () => {
  it("dispatches a message when encodeShareUrl throws", () => {
    const store = makeStore();
    // Force encodeShareUrl to throw by stubbing btoa (which encodeShareUrl calls internally).
    const realBtoa = globalThis.btoa;
    vi.stubGlobal("btoa", () => { throw new Error("encode failed"); });
    try {
      store.dispatch(shareThunk());
      expect(store.getState().ui.message).toContain("Could not generate");
    } finally {
      vi.unstubAllGlobals();
      globalThis.btoa = realBtoa;
    }
  });
});
