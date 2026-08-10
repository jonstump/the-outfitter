import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import uiReducer from "./uiSlice.js";
import hunterFavoritesReducer, {
  fetchFavorites,
  favoriteHunterThunk,
  unfavoriteHunterThunk,
} from "./hunterFavoritesSlice.js";

// Governing: ADR-0006, SPEC-0003 REQ "Favorite Hunters", SPEC-0003 REQ "Error Handling
// Standards"
//
// The durable half of favorites. Three things are asserted that the picker's own suite
// cannot see: the wire shape (a favorite is addressed in the PATH, which is what makes both
// writes idempotent), that failures reach the ui.message banner with the "!" error prefix
// the panel strips, and that a failed refetch does not blank favorites the user still has.

function makeStore() {
  return configureStore({
    reducer: { ui: uiReducer, hunterFavorites: hunterFavoritesReducer },
  });
}

const respond = (obj, status = 200) => ({ ok: status < 400, status, json: async () => obj });

const favorites = (store) => store.getState().hunterFavorites.ids;

describe("hunterFavorites slice", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts empty — nothing is favorited on the user's behalf", () => {
    expect(favorites(makeStore())).toEqual([]);
  });

  it("loads favorites as bare hunter ids", async () => {
    global.fetch.mockResolvedValue(
      respond([
        { id: "f1", hunterId: "the-rat", createdAt: "2026-08-10T00:00:00.000Z" },
        { id: "f2", hunterId: "the-reaper", createdAt: "2026-08-10T00:00:01.000Z" },
      ])
    );
    const store = makeStore();
    await store.dispatch(fetchFavorites());
    expect(favorites(store)).toEqual(["the-rat", "the-reaper"]);
    expect(store.getState().hunterFavorites.status).toBe("succeeded");
  });

  it("favorites through PUT on the hunter's own path", async () => {
    global.fetch.mockResolvedValue(respond({ id: "f1", hunterId: "the-rat" }, 201));
    const store = makeStore();
    await store.dispatch(favoriteHunterThunk({ hunterId: "the-rat", hunterName: "The Rat" }));

    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toMatch(/\/api\/hunter-favorites\/the-rat$/);
    expect(init.method).toBe("PUT");
    expect(init.headers["x-loadout-token"]).toBeDefined();
    expect(favorites(store)).toEqual(["the-rat"]);
  });

  it("is idempotent: favoriting twice leaves one id", async () => {
    global.fetch.mockResolvedValue(respond({ id: "f1", hunterId: "the-rat" }));
    const store = makeStore();
    await store.dispatch(favoriteHunterThunk({ hunterId: "the-rat" }));
    await store.dispatch(favoriteHunterThunk({ hunterId: "the-rat" }));
    expect(favorites(store)).toEqual(["the-rat"]);
  });

  it("is idempotent: unfavoriting something not favorited is a no-op", async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 204, json: async () => null });
    const store = makeStore();
    await store.dispatch(unfavoriteHunterThunk({ hunterId: "the-reaper" }));
    expect(favorites(store)).toEqual([]);
    expect(global.fetch.mock.calls[0][1].method).toBe("DELETE");
  });

  it("unfavorites without disturbing the others", async () => {
    global.fetch.mockResolvedValue(respond({}, 201));
    const store = makeStore();
    await store.dispatch(favoriteHunterThunk({ hunterId: "the-rat" }));
    await store.dispatch(favoriteHunterThunk({ hunterId: "the-reaper" }));

    global.fetch.mockResolvedValue({ ok: true, status: 204, json: async () => null });
    await store.dispatch(unfavoriteHunterThunk({ hunterId: "the-rat" }));
    expect(favorites(store)).toEqual(["the-reaper"]);
  });

  it("surfaces a failed favorite in the message banner, naming the hunter", async () => {
    global.fetch.mockResolvedValue(respond({ error: "unknown hunter" }, 400));
    const store = makeStore();
    await store.dispatch(favoriteHunterThunk({ hunterId: "the-rat", hunterName: "The Rat" }));
    expect(store.getState().ui.message).toBe("!Couldn't favorite The Rat: unknown hunter");
    expect(favorites(store)).toEqual([]);
  });

  it("surfaces a failed unfavorite too", async () => {
    global.fetch.mockResolvedValue(respond({ error: "boom" }, 500));
    const store = makeStore();
    await store.dispatch(unfavoriteHunterThunk({ hunterId: "the-rat", hunterName: "The Rat" }));
    expect(store.getState().ui.message).toBe("!Couldn't unfavorite The Rat: boom");
  });

  it("keeps existing favorites when a refetch fails", async () => {
    global.fetch.mockResolvedValue(respond([{ id: "f1", hunterId: "the-rat" }]));
    const store = makeStore();
    await store.dispatch(fetchFavorites());

    global.fetch.mockRejectedValue(new Error("offline"));
    await store.dispatch(fetchFavorites());

    // A failed refetch is not evidence the user unfavorited anything; blanking the list
    // would silently drop the sort priority the picker is already rendering.
    expect(favorites(store)).toEqual(["the-rat"]);
    expect(store.getState().hunterFavorites.status).toBe("failed");
    expect(store.getState().ui.message).toMatch(/^!Couldn't load your favorite hunters/);
  });
});
