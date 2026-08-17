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

// Governing: ADR-0009 (fixed eight-cell grid), SPEC-0006 REQ "Repeated Consumables
// Read as One Stack", issue #464.
//
// A PURE predicate — never mutates `equip` or `blocked` — for whether a run of
// `cells.length` cells (the cells a dragged run currently occupies, from `equipRuns`)
// may land starting at `targetStart`. This is the shipped-layout stand-in for the
// design doc's `placement.js` `canDrop`: it lives here, beside `equipRuns`, rather
// than in a new file (see design.md's 2026-08-16 annotation).
//
// The destination region is `[targetStart, targetStart + cells.length - 1]`. Per
// SPEC-0006 REQ "Repeated Consumables Read as One Stack": "A stack of length N MAY
// be dropped only onto a destination region of N consecutive cells each of which is
// empty, unblocked, or already part of the dragged run." Read literally that is
// three alternatives, but "empty" alone (regardless of blocked status) and
// "unblocked" alone (regardless of occupancy) cannot each be independently
// sufficient — the first would make a blocked cell a legal destination and the
// second would make dropping onto a FOREIGN item legal, both of which contradict
// "Stack drops SHALL NOT swap" two sentences later. The two are one joint condition
// — empty AND unblocked — exactly `calc.js`'s existing free-cell test
// (`e === null && !blocked.has(k)`), with "already part of the dragged run" as the
// separate, genuine third alternative: a cell the run itself currently occupies is
// always a legal landing cell for that same run, regardless of the run's own
// content there, since the run is what will occupy it after the move.
export function canPlaceRun(equip, blocked, cells, targetStart) {
  const length = cells.length;
  if (!Number.isInteger(targetStart) || targetStart < 0 || targetStart + length > equip.length) return false;
  const ownCells = new Set(cells);
  const blockedSet = new Set(blocked);
  for (let k = 0; k < length; k++) {
    const dest = targetStart + k;
    if (ownCells.has(dest)) continue; // already part of the dragged run
    if (blockedSet.has(dest)) return false;
    if (equip[dest] !== null) return false; // occupied by a FOREIGN item — never swap
  }
  return true;
}
