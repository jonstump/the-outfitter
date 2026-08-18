import { describe, expect, it } from "vitest";
import {
  groupByList,
  sortByOrder,
  moveToIndex,
  moveBesideTarget,
  sortLists,
  availableSortKeys,
  SORT_KEYS,
  SORT_LABELS,
  UNASSIGNED,
} from "./listOrdering.js";
import { HUNTERS, hunterNameFor } from "../data/hunters.js";

// Governing: ADR-0006, SPEC-0003 REQ "List Ordering and Sorting"

const L = (id, name, extra = {}) => ({ id, name, hunterId: null, createdAt: "2026-01-01", ...extra });

describe("sortLists", () => {
  it("orders by list name by default", () => {
    const lists = [L("1", "Zebra"), L("2", "apple"), L("3", "Mango")];
    expect(sortLists(lists, "name").map((l) => l.name)).toEqual(["apple", "Mango", "Zebra"]);
  });

  it("orders by hunter name, which differs from list name once renamed", () => {
    // A list named "shotgun experiments" pointing at "The Rat" sorts by the hunter, not
    // by its own name — the two orderings only coincide until someone renames something.
    const lists = [
      L("1", "shotgun experiments", { hunterId: "rat" }),
      L("2", "aaa first alphabetically", { hunterId: "zephyr" }),
    ];
    const names = { rat: "The Rat", zephyr: "Zephyr" };
    const out = sortLists(lists, "hunter", { hunterNameFor: (id) => names[id] });
    expect(out.map((l) => l.id)).toEqual(["1", "2"]); // The Rat < Zephyr
  });

  it("groups hunterless and unresolvable lists AFTER everything that resolves", () => {
    // The edge the spec calls out: a missing name has no sort key. Treating it as an
    // empty string would scatter these to the top interleaved with real entries, which
    // reads as corruption.
    const lists = [
      L("res", "resolves", { hunterId: "rat" }),
      L("none", "b-no-hunter"),
      L("gone", "a-hunter-left-dataset", { hunterId: "deleted" }),
    ];
    const out = sortLists(lists, "hunter", {
      hunterNameFor: (id) => (id === "rat" ? "The Rat" : null),
    });
    expect(out.map((l) => l.id)).toEqual(["res", "gone", "none"]);
    expect(out).toHaveLength(3); // none omitted
  });

  it("orders unresolvable lists among themselves by list name", () => {
    const lists = [L("b", "beta"), L("a", "alpha"), L("c", "gamma")];
    const out = sortLists(lists, "hunter", { hunterNameFor: () => null });
    expect(out.map((l) => l.name)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("orders by loadout count descending, ties by name", () => {
    const lists = [L("1", "b"), L("2", "a"), L("3", "c")];
    const counts = { 1: 2, 2: 2, 3: 9 };
    const out = sortLists(lists, "count", { countFor: (id) => counts[id] });
    expect(out.map((l) => l.name)).toEqual(["c", "a", "b"]);
  });

  it("orders by creation date, newest first", () => {
    const lists = [
      L("old", "old", { createdAt: "2026-01-01T00:00:00Z" }),
      L("new", "new", { createdAt: "2026-06-01T00:00:00Z" }),
    ];
    expect(sortLists(lists, "created").map((l) => l.id)).toEqual(["new", "old"]);
  });

  it("falls back to list name for an unknown sort key", () => {
    // "recent" was a real key until 2026-08-10. A persisted or hand-crafted value naming it
    // must degrade to the default rather than throwing or returning an unsorted array.
    const lists = [L("1", "z"), L("2", "a")];
    expect(sortLists(lists, "recent").map((l) => l.id)).toEqual(["2", "1"]);
  });

  it("does not mutate the input array", () => {
    const lists = [L("1", "z"), L("2", "a")];
    const snapshot = lists.map((l) => l.id);
    sortLists(lists, "name");
    expect(lists.map((l) => l.id)).toEqual(snapshot);
  });
});

describe("groupByList", () => {
  const lists = [L("a", "A"), L("b", "B")];

  it("groups loadouts under their list", () => {
    const loadouts = [
      { id: "1", listId: "a" },
      { id: "2", listId: "a" },
      { id: "3", listId: "b" },
    ];
    const g = groupByList(loadouts, lists);
    expect(g.get("a").map((l) => l.id)).toEqual(["1", "2"]);
    expect(g.get("b").map((l) => l.id)).toEqual(["3"]);
  });

  it("puts null and absent listId in Unassigned", () => {
    const g = groupByList([{ id: "1", listId: null }, { id: "2" }], lists);
    expect(g.get(UNASSIGNED).map((l) => l.id)).toEqual(["1", "2"]);
  });

  it("degrades a dangling listId to Unassigned rather than dropping it", () => {
    const g = groupByList([{ id: "1", listId: "deleted-list" }], lists);
    expect(g.get(UNASSIGNED).map((l) => l.id)).toEqual(["1"]);
  });

  it("keeps an empty list present as an empty group", () => {
    const g = groupByList([], lists);
    expect(g.has("a")).toBe(true);
    expect(g.get("a")).toEqual([]);
  });
});

// Governing: SPEC-0003 REQ "Loadouts Within a List Have a User-Chosen Order".
describe("sortByOrder", () => {
  it("orders ascending by the order field", () => {
    const loadouts = [
      { id: "z", order: 2 },
      { id: "x", order: 0 },
      { id: "y", order: 1 },
    ];
    expect(sortByOrder(loadouts).map((l) => l.id)).toEqual(["x", "y", "z"]);
  });

  it("does not mutate the input array", () => {
    const loadouts = [{ id: "b", order: 1 }, { id: "a", order: 0 }];
    const copy = [...loadouts];
    sortByOrder(loadouts);
    expect(loadouts).toEqual(copy);
  });

  it("treats a missing order as 0 rather than throwing or sorting to NaN-land", () => {
    const loadouts = [{ id: "has-order", order: 1 }, { id: "no-order" }];
    expect(sortByOrder(loadouts).map((l) => l.id)).toEqual(["no-order", "has-order"]);
  });

  it("is a no-op on an already-sorted or empty array", () => {
    expect(sortByOrder([])).toEqual([]);
    const loadouts = [{ id: "a", order: 0 }, { id: "b", order: 1 }];
    expect(sortByOrder(loadouts).map((l) => l.id)).toEqual(["a", "b"]);
  });
});

// Governing: SPEC-0003 REQ "Loadouts Within a List Have a User-Chosen Order" — the keyboard
// reorder's move-to-index step.
describe("moveToIndex", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

  it("moves an item forward", () => {
    expect(moveToIndex(items, "a", 2).map((i) => i.id)).toEqual(["b", "c", "a", "d"]);
  });

  it("moves an item backward", () => {
    expect(moveToIndex(items, "d", 0).map((i) => i.id)).toEqual(["d", "a", "b", "c"]);
  });

  it("clamps an out-of-range index to the last valid position", () => {
    expect(moveToIndex(items, "a", 99).map((i) => i.id)).toEqual(["b", "c", "d", "a"]);
  });

  it("clamps a negative index to the first position", () => {
    expect(moveToIndex(items, "d", -5).map((i) => i.id)).toEqual(["d", "a", "b", "c"]);
  });

  it("is a no-op for an unknown id, returning the same array reference", () => {
    expect(moveToIndex(items, "missing", 0)).toBe(items);
  });

  it("moving to its own current index still returns a new array (not the same reference)", () => {
    const result = moveToIndex(items, "b", 1);
    expect(result).not.toBe(items);
    expect(result.map((i) => i.id)).toEqual(["a", "b", "c", "d"]);
  });
});

// Governing: SPEC-0003 REQ "Loadouts Within a List Have a User-Chosen Order" — the
// pointer-drop reorder's move-beside-target step.
describe("moveBesideTarget", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("places the moved item immediately before the target", () => {
    expect(moveBesideTarget(items, "a", "c", true).map((i) => i.id)).toEqual(["b", "a", "c"]);
  });

  it("places the moved item immediately after the target", () => {
    expect(moveBesideTarget(items, "c", "a", false).map((i) => i.id)).toEqual(["a", "c", "b"]);
  });

  it("dropping onto itself is a no-op", () => {
    expect(moveBesideTarget(items, "a", "a", true)).toBe(items);
  });

  it("an unknown moved id is a no-op", () => {
    expect(moveBesideTarget(items, "missing", "a", true)).toBe(items);
  });

  it("an unknown target id is a no-op", () => {
    expect(moveBesideTarget(items, "a", "missing", true)).toBe(items);
  });

  it("moving beside an adjacent neighbour on the correct side is a true no-op in ORDER, but still a new array", () => {
    // "a" placed after "a"'s own left neighbour is nonsensical (no left neighbour), so
    // exercise the adjacent case that IS well-formed: "b" placed immediately after "a",
    // which is already where it sits.
    const result = moveBesideTarget(items, "b", "a", false);
    expect(result.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });
});

describe("availableSortKeys", () => {
  it("withholds hunter ordering while the dataset resolves nothing", () => {
    expect(availableSortKeys({ hasHunterData: false })).toEqual(["name", "created", "count"]);
  });

  it("offers hunter ordering as soon as the dataset carries a roster", () => {
    // The whole point of deriving this: populating client/src/data/hunters.js is the only
    // step needed to light the ordering up. No edit here, none in the panel (issue #120).
    expect(availableSortKeys({ hasHunterData: true })).toContain("hunter");
  });

  it("defaults to withholding when told nothing", () => {
    expect(availableSortKeys()).not.toContain("hunter");
  });

  it("labels every key it can offer", () => {
    for (const key of SORT_KEYS) expect(SORT_LABELS[key]).toBeTruthy();
  });

  it("no longer carries the dropped recently-used ordering", () => {
    // SPEC-0003 removed it on 2026-08-10 rather than deferring it indefinitely.
    expect(SORT_KEYS).not.toContain("recent");
    expect(SORT_LABELS.recent).toBeUndefined();
  });
});

describe("hunterNameFor", () => {
  it("resolves against the scraped roster", () => {
    // SPEC-0004's dataset has landed, so the comparator the panel already wired up now has
    // something to resolve. Asserting a known entry rather than a count keeps this from
    // breaking every time the wiki gains a hunter.
    expect(HUNTERS.length).toBeGreaterThan(0);
    const first = HUNTERS[0];
    expect(hunterNameFor(first.id)).toBe(first.name);
  });

  it("still returns null for a hunter absent from the dataset", () => {
    // SPEC-0003: a list may reference a hunter that has left the roster, and must stay usable.
    expect(hunterNameFor("definitely-not-a-hunter")).toBeNull();
  });

  it("returns null for a missing or empty id without throwing", () => {
    expect(hunterNameFor(null)).toBeNull();
    expect(hunterNameFor(undefined)).toBeNull();
    expect(hunterNameFor("")).toBeNull();
  });

  it("drives unresolved hunters into the trailing bucket rather than erroring", () => {
    const known = HUNTERS[0];
    const lists = [L("1", "b", { hunterId: "gone-from-the-wiki" }), L("2", "a", { hunterId: known.id })];
    const out = sortLists(lists, "hunter", { hunterNameFor });
    // The resolvable hunter sorts ahead; the unresolved one lands after everything that resolves.
    expect(out.map((l) => l.name)).toEqual(["a", "b"]);
  });
});

describe("the scraped dataset satisfies SPEC-0003's consumption contract", () => {
  it("gives every entry a stable id and a display name", () => {
    for (const hunter of HUNTERS) {
      expect(typeof hunter.id).toBe("string");
      expect(hunter.id.length).toBeGreaterThan(0);
      expect(typeof hunter.name).toBe("string");
      expect(hunter.name.length).toBeGreaterThan(0);
    }
  });

  it("keeps ids unique, so a hunterId reference is unambiguous", () => {
    expect(new Set(HUNTERS.map((h) => h.id)).size).toBe(HUNTERS.length);
  });

  it("carries the classification the picker filters on", () => {
    for (const hunter of HUNTERS) {
      expect(hunter).toHaveProperty("acquisition");
      expect(hunter).toHaveProperty("obtainable");
      expect(hunter).toHaveProperty("source");
    }
  });

  it("records provenance on every entry", () => {
    for (const hunter of HUNTERS) {
      expect(hunter.sourceRevision).toBeTruthy();
      expect(hunter.ingestedAt).toBeTruthy();
    }
  });
});
