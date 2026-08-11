import { describe, expect, it } from "vitest";
import { selectSaveDestinationName } from "./selectors.js";
import { resolveSaveListId } from "./savedLoadoutsSlice.js";

// ---------------------------------------------------------------------------------------
// Issue #136 — the save control's label and the save's destination are one rule.
//
// Governing: SPEC-0003 REQ "The Selected List Is Client State".
//
// WHY THIS FILE EXISTS, stated plainly, because the obvious version of this test cannot fail:
//
// Swapping `resolveSaveListId(state)` for a raw `state.ui.selectedListId` inside
// `selectSaveDestinationName` changes NOTHING observable today — looking a name up by id
// performs the same existence check the resolver does, so a stale id yields null down either
// path. Every behavioural assertion in ActionsPanel.test.jsx stays green through that edit.
// That was confirmed by making the edit and watching the suite pass.
//
// So this file does not assert the implementation, and it does not re-assert the behaviour
// that already holds. It pins the AGREEMENT: for any state, the name the button shows is the
// name of the list the save resolves to, and nothing else. That is the property the shared
// call exists to protect, and it is the one that breaks the day the resolution rule gains a
// condition that is not "the list exists" — an archived list, a shared list the user may read
// but not file into. Under that change a raw read names a destination the save refuses to
// use, silently, and this test goes red where the behavioural ones would not.
// ---------------------------------------------------------------------------------------

const alpha = { id: "a", name: "shotgun experiments", hunterId: null, accent: "#b04a3e", createdAt: "2026-01-01" };
const beta = { id: "b", name: "Beta", hunterId: null, accent: "#7a8a4e", createdAt: "2026-01-01" };

const state = (selectedListId, items = [alpha, beta]) => ({
  ui: { selectedListId, unassignedOpen: false },
  loadoutLists: { items, status: "succeeded", error: null },
});

const CASES = [
  ["a live selection", state("a")],
  ["a different live selection", state("b")],
  ["no selection at all", state(null)],
  ["a selection retired in another tab", state("gone-yesterday")],
  ["a selection restored before the lists loaded", state("a", [])],
  ["an empty string, which is not an id", state("")],
  ["undefined, which is how a fresh store starts", state(undefined)],
];

describe("the save destination the button names and the one the save uses", () => {
  it.each(CASES)("agree for %s", (_label, s) => {
    const id = resolveSaveListId(s);
    const expected = id === null ? null : s.loadoutLists.items.find((l) => l.id === id).name;
    expect(selectSaveDestinationName(s)).toBe(expected);
  });

  it("never names a list the save would not file into", () => {
    // The same property from the other direction, and the one that fails loudly under drift:
    // a non-null name MUST correspond to a resolved id, and a null id MUST produce no name.
    for (const [, s] of CASES) {
      const name = selectSaveDestinationName(s);
      const id = resolveSaveListId(s);
      if (name === null) expect(id).toBeNull();
      else expect(s.loadoutLists.items.some((l) => l.id === id && l.name === name)).toBe(true);
    }
  });

  it("distinguishes the two lists rather than answering the same thing twice", () => {
    // A selector that always returned null, or always the first list, would satisfy the
    // agreement above trivially. It must actually track the selection.
    expect(selectSaveDestinationName(state("a"))).toBe("shotgun experiments");
    expect(selectSaveDestinationName(state("b"))).toBe("Beta");
    expect(selectSaveDestinationName(state(null))).toBeNull();
  });
});
