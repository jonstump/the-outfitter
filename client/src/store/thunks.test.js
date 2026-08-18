import { afterEach, describe, expect, it, vi } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import { emptyLoadout } from "../utils/loadoutCodec.js";
import { WEAPONS } from "../data/catalog.js";
import { encodeShareCode, toData } from "../utils/loadoutCodec.js";
import loadoutReducer, { loadoutActions } from "./loadoutSlice.js";
import uiReducer, { uiActions } from "./uiSlice.js";
import savedLoadoutsReducer, { saveCurrent } from "./savedLoadoutsSlice.js";
import { copyCodeThunk, importCodeThunk, loadSavedThunk, randomizeThunk } from "./thunks.js";

// Swappable-for-one-test stub for randomizeLoadout, same pattern as selectors.test.js's
// stubbedRule. Null means "use the real generator"; every test outside the #380 describe
// block below runs against the genuine implementation.
const { stubbedResult } = vi.hoisted(() => ({ stubbedResult: { fn: null } }));
vi.mock("../utils/randomize.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, randomizeLoadout: (args) => (stubbedResult.fn ?? actual.randomizeLoadout)(args) };
});

afterEach(() => {
  stubbedResult.fn = null;
});

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

  it("toData output contains no nameIsDerived key, and a share code does not carry it", () => {
    const store = makeStore();
    store.dispatch(loadoutActions.addWeapon(0));
    const lo = store.getState().loadout;
    const enc = toData(lo);
    expect(enc).not.toHaveProperty("nameIsDerived");
    expect(Object.keys(enc).sort()).toEqual(["b", "e", "n", "tr", "v", "w"]);
    const code = encodeShareCode(lo);
    expect(code).not.toContain("nameIsDerived");
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

// Governing: item 4 of the 2026-08-16 feedback batch ("I want to use share codes").
describe("copyCodeThunk", () => {
  function withClipboard(impl, fn) {
    const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", { value: impl, configurable: true });
    try {
      fn();
    } finally {
      if (original) Object.defineProperty(navigator, "clipboard", original);
      else delete navigator.clipboard;
    }
  }

  it("copies the bare code (encodeShareCode's output, not a URL) and confirms success", async () => {
    const store = makeStore();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const expectedCode = encodeShareCode(store.getState().loadout);
    withClipboard({ writeText }, () => store.dispatch(copyCodeThunk()));
    await Promise.resolve(); // let the writeText promise's .then() run
    expect(writeText).toHaveBeenCalledWith(expectedCode);
    expect(writeText.mock.calls[0][0]).not.toContain("#");
    expect(writeText.mock.calls[0][0]).not.toContain("http");
    expect(store.getState().ui.message).toBe("Share code copied to clipboard.");
  });

  it("points at the visible field, not the address bar, when clipboard write fails", async () => {
    const store = makeStore();
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    withClipboard({ writeText }, () => store.dispatch(copyCodeThunk()));
    await Promise.resolve().then().then(); // let the rejection's .then(_, fallback) run
    expect(store.getState().ui.message).toContain("select the code below");
  });

  it("falls back with the same message when the Clipboard API is unavailable", () => {
    const store = makeStore();
    withClipboard(undefined, () => store.dispatch(copyCodeThunk()));
    expect(store.getState().ui.message).toContain("select the code below");
  });

  it("dispatches a message when encodeShareCode throws (issue #358)", () => {
    const store = makeStore();
    const realBtoa = globalThis.btoa;
    vi.stubGlobal("btoa", () => { throw new Error("encode failed"); });
    try {
      store.dispatch(copyCodeThunk());
      expect(store.getState().ui.message).toContain("Could not generate");
    } finally {
      vi.unstubAllGlobals();
      globalThis.btoa = realBtoa;
    }
  });
});

// Governing: item 4 of the 2026-08-16 feedback batch, ADR-0024.
describe("importCodeThunk", () => {
  it("loads a valid pasted code, replacing the current build", () => {
    const source = { ...emptyLoadout(), name: "Source build" };
    const code = encodeShareCode(source);
    const store = makeStore();

    const ok = store.dispatch(importCodeThunk(code));

    expect(ok).toBe(true);
    expect(store.getState().loadout.name).toBe("Source build");
    expect(store.getState().ui.message).toBe("Loaded from code.");
  });

  // Governing: ActionsPanel's paste field clears itself only on a successful load, so it
  // can leave a failed paste visible beside the error explaining why. That behavior lives
  // in the component, but it depends entirely on this return-value contract holding.
  it("returns false on either failure path, so a caller knows not to clear the input", () => {
    const store = makeStore();
    expect(store.dispatch(importCodeThunk("not a code at all"))).toBe(false);
    expect(store.dispatch(importCodeThunk("bm90IHZhbGlkIGpzb24="))).toBe(false);
  });

  it("accepts a full URL or a bare hash fragment, not just the raw code", () => {
    const source = { ...emptyLoadout(), name: "Via URL" };
    const code = encodeShareCode(source);
    const store = makeStore();

    store.dispatch(importCodeThunk(`https://example.com/#L=${code}`));
    expect(store.getState().loadout.name).toBe("Via URL");

    const store2 = makeStore();
    store2.dispatch(importCodeThunk(`#L=${code}`));
    expect(store2.getState().loadout.name).toBe("Via URL");
  });

  it("carries no savedId — an imported code is a fresh, never-saved build", () => {
    const source = { ...emptyLoadout(), name: "Fresh via code" };
    const code = encodeShareCode(source);
    const store = makeStore();
    store.dispatch({ type: "loadout/setSavedId", payload: "should-be-cleared" });

    store.dispatch(importCodeThunk(code));

    expect(store.getState().loadout.savedId).toBeNull();
  });

  it("names the problem distinctly for garbage input vs. a well-formed-but-bad code", () => {
    const store = makeStore();
    store.dispatch(importCodeThunk("this is definitely not a code"));
    expect(store.getState().ui.message).toBe("!That doesn't look like a share code.");

    const store2 = makeStore();
    // Base64-alphabet-shaped, but not valid JSON underneath — extraction accepts it,
    // decode rejects it. A distinct message from the "not a code attempt" case above.
    store2.dispatch(importCodeThunk("bm90IHZhbGlkIGpzb24="));
    expect(store2.getState().ui.message).toContain("Couldn't load that code");
    expect(store2.getState().ui.message).not.toBe("!That doesn't look like a share code.");
  });

  it("does not touch loadout state on a failed import", () => {
    const store = makeStore();
    const before = store.getState().loadout;
    store.dispatch(importCodeThunk("garbage"));
    expect(store.getState().loadout).toBe(before);
  });

  it("surfaces the ammo-dropped notice, mirroring loadSavedThunk's identical wording pattern", () => {
    // Governing: issue #359. A code built from a v3 payload whose ammo selection no longer
    // resolves must still load — ADR-0024 — with the drop surfaced, not silent. Fixture
    // shape matches loadoutCodec.test.js's own pinned "issue #359" cases exactly (a v3
    // weapon entry is `[stringId, ammoIndex]`; an out-of-range index drops to -1 with a
    // notice — see that file for why dolch-96/9999 is the reliable out-of-range case).
    const codeData = { v: 3, w: [["dolch-96", 9999], null], e: [], tr: [], n: "Stale ammo build", b: 0 };
    const code = btoa(JSON.stringify(codeData));
    const store = makeStore();

    store.dispatch(importCodeThunk(code));

    expect(store.getState().loadout.name).toBe("Stale ammo build");
    expect(store.getState().ui.message).toBe("Loaded from code. This build's ammo selection is no longer available.");
  });
});

// Governing: SPEC-0008, issue #380. Related: #211, #208.
//
// When budgetOn, randomizeLoadout retries a bounded number of uniform draws and, if none
// land at or under budget, falls back to the cheapest attempt it drew — silently. Before
// this fix, randomizeThunk unconditionally cleared the message banner, so a miss looked
// identical to any other result: the total merely recolored red, with nothing telling the
// player a retry would very likely land in budget. These tests stub randomizeLoadout (via
// the module mock above) so the "did it land in budget" branch is deterministic rather than
// dependent on the real generator's random draws.
describe("randomizeThunk budget miss disclosure (issue #380)", () => {
  function makeBudgetStore(budgetOn, budget) {
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
          budgetOn,
          budget,
          upBudgetOn: false,
          upBudget: 5,
          message: "",
        },
      },
    });
  }

  // Nagant M1895 is WEAPONS[0], price 24 (see client/src/data/catalog.js) — cheap enough
  // that a low budget guarantees a miss and a generous budget guarantees a hit.
  const singleWeaponBuild = () => ({
    weapons: [{ i: 0, a: -1, d: false }, null],
    equip: [null, null, null, null, null, null, null, null],
    traits: [],
  });

  it("sets a message when budgetOn and the returned build's totalCost exceeds the budget", () => {
    stubbedResult.fn = () => singleWeaponBuild(); // totalCost 24
    const store = makeBudgetStore(true, 10); // budget below the build's cost — guaranteed miss
    store.dispatch(randomizeThunk());
    expect(store.getState().ui.message).not.toBe("");
    expect(store.getState().ui.message.toLowerCase()).toContain("budget");
  });

  it("sets no message when budgetOn and the returned build satisfies the budget", () => {
    stubbedResult.fn = () => singleWeaponBuild(); // totalCost 24
    const store = makeBudgetStore(true, 200); // budget comfortably covers the build's cost
    store.dispatch(randomizeThunk());
    expect(store.getState().ui.message).toBe("");
  });

  it("clears a prior miss message on the next successful (in-budget) press", () => {
    stubbedResult.fn = () => singleWeaponBuild(); // totalCost 24
    const store = makeBudgetStore(true, 10); // first press: guaranteed miss
    store.dispatch(randomizeThunk());
    expect(store.getState().ui.message).not.toBe("");

    // Second press lands in budget — the miss message must clear, not linger.
    store.dispatch(uiActions.setBudget(200));
    store.dispatch(randomizeThunk());
    expect(store.getState().ui.message).toBe("");
  });

  it("clears a prior miss message on the next press when budget mode is turned off", () => {
    stubbedResult.fn = () => singleWeaponBuild(); // totalCost 24
    const store = makeBudgetStore(true, 10); // first press: guaranteed miss
    store.dispatch(randomizeThunk());
    expect(store.getState().ui.message).not.toBe("");

    // Second press has budget mode off entirely — the miss message must clear.
    store.dispatch(uiActions.toggleBudgetOn());
    store.dispatch(randomizeThunk());
    expect(store.getState().ui.message).toBe("");
  });
});
