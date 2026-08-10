import { describe, expect, it } from "vitest";
import { groupByList, sortLists, availableSortKeys, SORT_KEYS, SORT_LABELS, UNASSIGNED } from "./listOrdering.js";
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
  it("resolves nothing while the roster is empty, which is the specified state", () => {
    // SPEC-0003 requires consumers to tolerate a hunterId absent from the dataset. With no
    // dataset every id is absent, so this is correct behaviour rather than a stub.
    expect(HUNTERS).toEqual([]);
    expect(hunterNameFor("the-rat")).toBeNull();
  });

  it("returns null for a missing or empty id without throwing", () => {
    expect(hunterNameFor(null)).toBeNull();
    expect(hunterNameFor(undefined)).toBeNull();
    expect(hunterNameFor("")).toBeNull();
  });

  it("drives hunter ordering into the unresolved bucket rather than erroring", () => {
    const lists = [L("1", "b", { hunterId: "the-rat" }), L("2", "a", { hunterId: "unknown" })];
    const out = sortLists(lists, "hunter", { hunterNameFor });
    expect(out.map((l) => l.name)).toEqual(["a", "b"]);
  });
});
