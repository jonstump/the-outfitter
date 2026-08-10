import { describe, expect, it } from "vitest";
import { filterHunters, UNKNOWN_ACQUISITION } from "./hunters.js";

// Governing: ADR-0007 (hunter roster dataset), SPEC-0003 REQ "Favorite Hunters"
//
// The favorites half of `filterHunters`, tested against a hand-built roster rather than the
// real 242 so the expected ORDER can be written out in full. The picker's own suite covers
// the same rules through the UI; this file pins the seam they both run on, and in
// particular the two invariants that are easy to regress by "simplifying" the function:
//
//   1. An empty favorites set changes NOTHING — including when favoritesOnly is true.
//   2. The favorites sort runs AFTER narrowing, so a favorite can never resurrect a hunter
//      the active filter excluded.

const ROSTER = [
  { id: "a", name: "Alpha", acquisition: "dlc", obtainable: true },
  { id: "b", name: "Bravo", acquisition: "event", obtainable: true },
  { id: "c", name: "Charlie", acquisition: "dlc", obtainable: false },
  { id: "d", name: "Delta", acquisition: null, obtainable: null },
];

const ids = (out) => out.map((h) => h.id);

describe("filterHunters favorites", () => {
  it("changes nothing when nothing is favorited", () => {
    expect(ids(filterHunters(ROSTER, {}))).toEqual(["a", "b", "c", "d"]);
    expect(ids(filterHunters(ROSTER, { favorites: [] }))).toEqual(["a", "b", "c", "d"]);
    expect(ids(filterHunters(ROSTER, { favorites: new Set() }))).toEqual(["a", "b", "c", "d"]);
  });

  it("treats an empty favorites set as no filter even with favoritesOnly on", () => {
    // "An empty favorites set SHALL therefore behave as no filter at all, not as an empty
    // picker." You cannot favorite a hunter you have never seen, so an unpopulated set must
    // not be able to hide the roster that would populate it.
    expect(ids(filterHunters(ROSTER, { favorites: [], favoritesOnly: true }))).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("sorts favorites ahead, keeping dataset order within each group", () => {
    expect(ids(filterHunters(ROSTER, { favorites: ["c", "b"] }))).toEqual(["b", "c", "a", "d"]);
  });

  it("sorts ahead within the active filter and never resurrects a non-match", () => {
    // "b" is favorited but is `event`, so the dlc filter drops it before the sort runs.
    const out = filterHunters(ROSTER, { acquisition: "dlc", favorites: ["b", "c"] });
    expect(ids(out)).toEqual(["c", "a"]);
    expect(ids(out)).not.toContain("b");
  });

  it("narrows to favorites when favoritesOnly is on, still inside the active filter", () => {
    expect(ids(filterHunters(ROSTER, { favorites: ["a", "b"], favoritesOnly: true }))).toEqual([
      "a",
      "b",
    ]);
    expect(
      ids(filterHunters(ROSTER, { acquisition: "dlc", favorites: ["a", "b"], favoritesOnly: true }))
    ).toEqual(["a"]);
    expect(
      ids(filterHunters(ROSTER, { query: "brav", favorites: ["a", "b"], favoritesOnly: true }))
    ).toEqual(["b"]);
  });

  it("leaves the pre-existing filters untouched", () => {
    // Regression guard for the extension itself: adding favorites must not have perturbed
    // the name / acquisition / obtainable behaviour the picker already depended on.
    expect(ids(filterHunters(ROSTER, { query: "AR" }))).toEqual(["c"]); // case-insensitive
    expect(ids(filterHunters(ROSTER, { query: "a" }))).toEqual(["a", "b", "c", "d"]);
    expect(ids(filterHunters(ROSTER, { acquisition: UNKNOWN_ACQUISITION }))).toEqual(["d"]);
    expect(ids(filterHunters(ROSTER, { obtainable: "no" }))).toEqual(["c"]);
    expect(ids(filterHunters(ROSTER, { obtainable: UNKNOWN_ACQUISITION }))).toEqual(["d"]);
  });

  it("ignores a favorited id that is not in the roster", () => {
    // The dataset and a user's stored favorites refresh independently, so a favorite may
    // outlive its hunter. It sorts nothing and hides nothing.
    expect(ids(filterHunters(ROSTER, { favorites: ["gone"] }))).toEqual(["a", "b", "c", "d"]);
    expect(ids(filterHunters(ROSTER, { favorites: ["gone", "c"] }))).toEqual(["c", "a", "b", "d"]);
  });

  it("does not mutate the roster it was given", () => {
    const before = ids(ROSTER);
    filterHunters(ROSTER, { favorites: ["d"] });
    expect(ids(ROSTER)).toEqual(before);
  });
});
