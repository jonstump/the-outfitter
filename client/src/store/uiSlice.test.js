import { describe, expect, it, beforeEach } from "vitest";
import { createTestStore } from "../test/testStore.js";
import { uiActions, LS_SELECTED_LIST, FETCH_LISTS_FULFILLED } from "./uiSlice.js";
import { fetchLists } from "./loadoutListsSlice.js";

// Governing: ADR-0006, SPEC-0003 REQ "The Selected List Is Client State"

beforeEach(() => localStorage.clear());

describe("selected-list reconciliation", () => {
  it("uses the same action type fetchLists actually dispatches", () => {
    // uiSlice cannot import fetchLists (loadoutListsSlice imports uiActions, so it would be
    // a cycle) and matches on a literal string instead. If the thunk is ever renamed, this
    // fails rather than silently disabling reconciliation.
    expect(fetchLists.fulfilled.type).toBe(FETCH_LISTS_FULFILLED);
  });

  it("clears a selection whose list no longer exists", () => {
    const store = createTestStore();
    store.dispatch(uiActions.selectList("retired-id"));
    expect(store.getState().ui.selectedListId).toBe("retired-id");
    expect(localStorage.getItem(LS_SELECTED_LIST)).toBe("retired-id");

    store.dispatch({ type: FETCH_LISTS_FULFILLED, payload: [{ id: "other" }] });

    expect(store.getState().ui.selectedListId).toBeNull();
    expect(localStorage.getItem(LS_SELECTED_LIST)).toBeNull();
  });

  it("keeps a selection that still resolves", () => {
    const store = createTestStore();
    store.dispatch(uiActions.selectList("keep-me"));
    store.dispatch({ type: FETCH_LISTS_FULFILLED, payload: [{ id: "keep-me" }] });
    expect(store.getState().ui.selectedListId).toBe("keep-me");
  });

  it("tolerates an empty payload", () => {
    const store = createTestStore();
    store.dispatch(uiActions.selectList("gone"));
    store.dispatch({ type: FETCH_LISTS_FULFILLED, payload: [] });
    expect(store.getState().ui.selectedListId).toBeNull();
  });

  it("selecting a real list clears unassignedOpen, and vice versa", () => {
    const store = createTestStore();
    store.dispatch(uiActions.openUnassigned(true));
    expect(store.getState().ui.unassignedOpen).toBe(true);

    store.dispatch(uiActions.selectList("a"));
    expect(store.getState().ui.unassignedOpen).toBe(false);

    store.dispatch(uiActions.openUnassigned(true));
    expect(store.getState().ui.selectedListId).toBeNull();
    expect(localStorage.getItem(LS_SELECTED_LIST)).toBeNull();
  });
});

describe("budget defaults", () => {
  // Issue #65: the trait cap defaulted to 12, two points richer than the 10 UP a
  // Legendary Hunter actually starts with, so a fresh session green-lit loadouts that
  // could not be built. Pinned here because nothing else asserts the default — every
  // other test passes its own upBudget in.
  it("seeds the trait cap at the 10 UP a Legendary Hunter starts with", () => {
    const store = createTestStore();
    expect(store.getState().ui.upBudget).toBe(10);
  });

  it("leaves both budgets off by default", () => {
    const store = createTestStore();
    expect(store.getState().ui.budgetOn).toBe(false);
    expect(store.getState().ui.upBudgetOn).toBe(false);
  });
});
