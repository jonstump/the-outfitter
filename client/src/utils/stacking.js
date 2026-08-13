// Consumable stacking, as a VIEW function — never a state field.
//
// Governing: ADR-0009 (no quantity field on an entry — the fixed eight-cell grid IS
// the state), SPEC-0006 REQ "Repeated Consumables Read as One Stack".
//
// A stack is computed at render time from a run of IDENTICAL AND ADJACENT entries:
// same entry (same category and item), cells next to one another. Non-adjacent
// duplicates do NOT stack and render as separate tiles. A run of length 1 is a
// single tile, which is also what "no stack" means, so every filled cell returns a
// run of its own.

/** Identity of an entry for stacking: same category AND same specific item. */
export function entryKey(entry) {
  return entry ? `${entry.t}:${entry.i}` : null;
}

/**
 * The runs of the grid's filled cells, in grid order, each with the cells it spans.
 *
 * Returns `[{ entry, cells: [indices...] }]`; a non-adjacent duplicate appears in
 * TWO runs (one tile each), and adjacent identical entries collapse into one run
 * whose `cells` length is the badge count. Empty cells are skipped.
 */
export function equipRuns(equip) {
  const runs = [];
  let current = null;
  equip.forEach((entry, k) => {
    if (!entry) {
      current = null;
      return;
    }
    const key = entryKey(entry);
    if (current && current.key === key && k === current.last + 1) {
      current.cells.push(k);
      current.last = k;
      return;
    }
    current = { key, entry, cells: [k], last: k };
    runs.push(current);
  });
  return runs.map((r) => ({ entry: r.entry, cells: r.cells }));
}
