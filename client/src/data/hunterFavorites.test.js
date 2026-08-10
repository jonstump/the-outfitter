import { describe, expect, it } from "vitest";
import { FAVORITES_SECTION, ROSTER_SECTION, filterHunters, UNKNOWN_ACQUISITION } from "./hunters.js";

// Governing: ADR-0006 (Organize Saved Loadouts into User-Named Lists Illustrated with Hunter
// Portraits), ADR-0007 (hunter roster dataset), SPEC-0003 REQ "Favorite Hunters"
//
// The favorites half of `filterHunters`, tested against a hand-built roster rather than the
// real 242 so the expected SECTIONS can be written out in full. The picker's own suite covers
// the same rules through the UI; this file pins the seam they both run on, and in
// particular the invariants that are easy to regress by "simplifying" the function:
//
//   1. An empty favorites set produces ONE roster section holding everything — including
//      when favoritesOnly is true.
//   2. The split runs AFTER narrowing, so a favorite can never resurrect a hunter the active
//      filter excluded.
//   3. A hunter is in exactly one section, never both.
//   4. A section with no members is omitted rather than emitted empty.
//
// REVERSAL, 2026-08-10 (#138): the ordering assertions this file used to make — favorites
// sorted to the front of ONE array — are the ones that changed. Sectioning replaces that
// sort; it does not layer on top of it, so nothing here asserts a flat favorites-first order
// any more.

const ROSTER = [
  { id: "a", name: "Alpha", acquisition: "dlc", obtainable: true },
  { id: "b", name: "Bravo", acquisition: "event", obtainable: true },
  { id: "c", name: "Charlie", acquisition: "dlc", obtainable: false },
  { id: "d", name: "Delta", acquisition: null, obtainable: null },
];

/** The section ids actually rendered, in render order. */
const sectionIds = (out) => out.sections.map((s) => s.id);
/** Section id -> the hunter ids it holds, in order. */
const idsBySection = (out) =>
  Object.fromEntries(out.sections.map((s) => [s.id, s.hunters.map((h) => h.id)]));
/** Every hunter id the result would render, in render order across sections. */
const flatIds = (out) => out.sections.flatMap((s) => s.hunters.map((h) => h.id));

describe("filterHunters sections", () => {
  it("returns one roster section holding everything when nothing is favorited", () => {
    for (const favorites of [undefined, [], new Set()]) {
      const out = filterHunters(ROSTER, favorites === undefined ? {} : { favorites });
      expect(sectionIds(out)).toEqual([ROSTER_SECTION]);
      expect(flatIds(out)).toEqual(["a", "b", "c", "d"]);
      expect(out.total).toBe(4);
    }
  });

  it("treats an empty favorites set as no filter even with favoritesOnly on", () => {
    // "An empty favorites set SHALL therefore behave as no filter at all, not as an empty
    // picker." You cannot favorite a hunter you have never seen, so an unpopulated set must
    // not be able to hide the roster that would populate it.
    const out = filterHunters(ROSTER, { favorites: [], favoritesOnly: true });
    expect(sectionIds(out)).toEqual([ROSTER_SECTION]);
    expect(flatIds(out)).toEqual(["a", "b", "c", "d"]);
  });

  it("lifts favorites into their own section AHEAD of the rest, dataset order within each", () => {
    // Was: one array, ["b", "c", "a", "d"]. Now: two sections, and the boundary between the
    // user's curation and the rest is a structure rather than an ordering.
    const out = filterHunters(ROSTER, { favorites: ["c", "b"] });
    expect(sectionIds(out)).toEqual([FAVORITES_SECTION, ROSTER_SECTION]);
    expect(idsBySection(out)).toEqual({ [FAVORITES_SECTION]: ["b", "c"], [ROSTER_SECTION]: ["a", "d"] });
    expect(out.total).toBe(4);
  });

  it("places each hunter in exactly one section, never both", () => {
    const out = filterHunters(ROSTER, { favorites: ["c", "b"] });
    const flat = flatIds(out);
    expect(new Set(flat).size).toBe(flat.length);
    expect(flat).toHaveLength(out.total);
    // The counts sum to the match total — the property duplication would quietly break.
    expect(out.sections.reduce((n, s) => n + s.hunters.length, 0)).toBe(out.total);
    expect(idsBySection(out)[ROSTER_SECTION]).not.toContain("b");
  });

  it("sections within the active filter and never resurrects a non-match", () => {
    // "b" is favorited but is `event`, so the dlc filter drops it before the split runs.
    const out = filterHunters(ROSTER, { acquisition: "dlc", favorites: ["b", "c"] });
    expect(idsBySection(out)).toEqual({ [FAVORITES_SECTION]: ["c"], [ROSTER_SECTION]: ["a"] });
    expect(flatIds(out)).not.toContain("b");
  });

  it("omits the roster section entirely when no unfavorited hunter matched", () => {
    // Not an empty heading with nothing under it: the section is simply not there.
    const out = filterHunters(ROSTER, { query: "arli", favorites: ["c"] });
    expect(sectionIds(out)).toEqual([FAVORITES_SECTION]);
    expect(out.total).toBe(1);
  });

  it("omits the favorites section when no favorite matched the active filter", () => {
    const out = filterHunters(ROSTER, { acquisition: "event", favorites: ["c"] });
    expect(sectionIds(out)).toEqual([ROSTER_SECTION]);
    expect(flatIds(out)).toEqual(["b"]);
  });

  it("returns no sections at all when nothing matched", () => {
    const out = filterHunters(ROSTER, { query: "zzzz", favorites: ["c"] });
    expect(out.sections).toEqual([]);
    expect(out.total).toBe(0);
  });

  it("narrows to the favorites section alone when favoritesOnly is on", () => {
    const out = filterHunters(ROSTER, { favorites: ["a", "b"], favoritesOnly: true });
    expect(sectionIds(out)).toEqual([FAVORITES_SECTION]);
    expect(flatIds(out)).toEqual(["a", "b"]);

    // …still inside whatever else is filtering.
    expect(
      flatIds(filterHunters(ROSTER, { acquisition: "dlc", favorites: ["a", "b"], favoritesOnly: true }))
    ).toEqual(["a"]);
    expect(
      flatIds(filterHunters(ROSTER, { query: "brav", favorites: ["a", "b"], favoritesOnly: true }))
    ).toEqual(["b"]);
  });

  it("leaves the pre-existing filters untouched", () => {
    // Regression guard for the extension itself: sectioning must not have perturbed the
    // name / acquisition / obtainable behaviour the picker already depended on.
    expect(flatIds(filterHunters(ROSTER, { query: "AR" }))).toEqual(["c"]); // case-insensitive
    expect(flatIds(filterHunters(ROSTER, { query: "a" }))).toEqual(["a", "b", "c", "d"]);
    expect(flatIds(filterHunters(ROSTER, { acquisition: UNKNOWN_ACQUISITION }))).toEqual(["d"]);
    expect(flatIds(filterHunters(ROSTER, { obtainable: "no" }))).toEqual(["c"]);
    expect(flatIds(filterHunters(ROSTER, { obtainable: UNKNOWN_ACQUISITION }))).toEqual(["d"]);
  });

  it("ignores a favorited id that is not in the roster", () => {
    // The dataset and a user's stored favorites refresh independently, so a favorite may
    // outlive its hunter. It sections nothing and hides nothing.
    const orphaned = filterHunters(ROSTER, { favorites: ["gone"] });
    expect(sectionIds(orphaned)).toEqual([ROSTER_SECTION]);
    expect(flatIds(orphaned)).toEqual(["a", "b", "c", "d"]);

    const mixed = filterHunters(ROSTER, { favorites: ["gone", "c"] });
    expect(idsBySection(mixed)).toEqual({ [FAVORITES_SECTION]: ["c"], [ROSTER_SECTION]: ["a", "b", "d"] });
  });

  it("does not mutate the roster it was given", () => {
    const before = ROSTER.map((h) => h.id);
    filterHunters(ROSTER, { favorites: ["d"] });
    expect(ROSTER.map((h) => h.id)).toEqual(before);
  });
});
