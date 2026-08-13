import { afterEach, describe, expect, it, vi } from "vitest";
import { selectSaveDestinationName } from "./selectors.js";
import { resolveSaveListId } from "./savedLoadoutsSlice.js";

// The resolution rule, swappable for the length of one test. See "pins the delegation" below:
// this is what lets the suite ask whether `selectSaveDestinationName` CALLS the resolver, as
// opposed to whether it happens to agree with it today. Null means "use the real one", so
// every other test in this file runs against the genuine implementation.
const { stubbedRule } = vi.hoisted(() => ({ stubbedRule: { fn: null } }));
vi.mock("./savedLoadoutsSlice.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, resolveSaveListId: (state) => (stubbedRule.fn ?? actual.resolveSaveListId)(state) };
});

afterEach(() => {
  stubbedRule.fn = null;
});

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
// So this file does not re-assert the behaviour that already holds. It pins the AGREEMENT:
// for any state, the name the button shows is the name of the list the save resolves to, and
// nothing else. That is the property the shared call exists to protect, and it is the one that
// breaks the day the resolution rule gains a condition that is not "the list exists" — an
// archived list, a shared list the user may read but not file into.
//
// AND IT PINS THE DELEGATION, which the agreement alone does not. The first two tests here
// computed their own expectation by calling `resolveSaveListId`, so the very mutation this
// header names — reading `ui.selectedListId` raw — sailed through both of them: both sides of
// the comparison moved together. Only the third test was load-bearing, and it pins the
// behaviour rather than the sharing.
//
// The fix is to give the resolver a condition that ISN'T "the list exists" and check that the
// label obeys it. That condition does not exist yet, so the last test below installs one — the
// archived-list rule this header has been describing hypothetically since it was written. A
// raw read ignores it and names a list the save would refuse; the shared call cannot.
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

  it("obeys a resolution rule that is not just 'the list exists'", () => {
    // THE ONE THAT CATCHES THE RAW READ. Everything above compares the label against the
    // resolver, so swapping `resolveSaveListId(state)` for `state.ui.selectedListId` inside
    // the selector moves both sides at once and nothing goes red. Here the resolver is given
    // the condition this file has always described in the future tense — an archived list is
    // readable but not fileable — and the label has to follow it.
    stubbedRule.fn = (s) => (s.ui.selectedListId === "a" ? null : s.ui.selectedListId ?? null);

    // "a" exists and has a name, so a raw read would happily print "shotgun experiments" for
    // a save that is going to Unassigned. Going through the resolver is what makes it null.
    expect(selectSaveDestinationName(state("a"))).toBeNull();
    // And the selector is not simply ignoring the state: an unaffected selection still names.
    expect(selectSaveDestinationName(state("b"))).toBe("Beta");
  });

  it("resolves through the shared rule for every case, not only the archived one", () => {
    // The general form: whatever the resolver answers, the label names THAT list — including
    // a list the selection never pointed at, which no amount of reading `ui.selectedListId`
    // could produce.
    stubbedRule.fn = () => "b";
    expect(selectSaveDestinationName(state("a"))).toBe("Beta");
    expect(selectSaveDestinationName(state(null))).toBe("Beta");
  });
});

// Governing: ADR-0009 (index is the cell, null is empty), SPEC-0006 REQ "Equipment
// Occupies a Fixed Eight-Cell Grid". `selectEquipCount` reads through filter(Boolean),
// so the count it reports on a grid with holes is the number of HELD items — the
// packed-array reading (`equip.length`) of the same state would report 8 and is the
// wrong number the sparse model must not propagate to the panel header.
describe("selectEquipCount on a grid with gaps", () => {
  it("counts held items, not cells", async () => {
    const { selectEquipCount: sel } = await import("./selectors.js");
    expect(
      sel({
        loadout: {
          weapons: [null, null],
          equip: [{ t: "T", i: 0 }, null, null, { t: "C", i: 0 }, null, null, null, null],
          traits: [],
          blocked: [],
        },
      })
    ).toBe(2);
  });
});
