// Governing: ADR-0006, SPEC-0003 REQ "List Ordering and Sorting"
//
// Sort orders for the list roster. The preference is client state and is never persisted
// server-side — see uiSlice.

/** Every sort this module can perform. */
export const SORT_KEYS = ["name", "hunter", "created", "count"];

/**
 * The subset offered in the UI, given what data exists.
 *
 * "hunter" resolves ids through the hunters dataset, which SPEC-0004's scrape has not
 * produced yet. With an empty roster nothing resolves, so every list would land in the
 * unresolved bucket and the ordering would silently duplicate the default — a menu entry
 * that appears to do nothing is worse than one that is absent.
 *
 * This is derived rather than hardcoded on purpose. The previous hardcoded list claimed in
 * a comment that enabling "hunter" was a one-line change; it was in fact two, because the
 * panel also had to start passing `hunterNameFor` (issue #120). Deriving it means populating
 * `client/src/data/hunters.js` is genuinely the only step.
 *
 * "recent" was removed rather than deferred — see SPEC-0003 REQ "List Ordering and Sorting".
 */
export function availableSortKeys({ hasHunterData = false } = {}) {
  return SORT_KEYS.filter((key) => key !== "hunter" || hasHunterData);
}

export const SORT_LABELS = {
  name: "List name",
  hunter: "Hunter name",
  created: "Creation date",
  count: "Loadouts held",
};

export const DEFAULT_SORT = "name";

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

/**
 * Order a user's lists.
 *
 * `hunterNameFor` resolves a hunterId to a display name, returning null when the hunter
 * is absent from the dataset — which happens routinely, because the dataset and a user's
 * stored lists refresh independently.
 *
 * The hunter-name order is the one with a real edge case. A list may reference no hunter,
 * or one that has since left the dataset, and so has no sort key at all. Treating a
 * missing name as an empty string would scatter those lists to the top, interleaved with
 * real entries, which reads as corruption. SPEC-0003 instead requires them grouped AFTER
 * everything that resolves, ordered by list name among themselves — a defined, explainable
 * position rather than whatever the comparator happens to do with undefined.
 *
 * Unassigned is not part of this list at all: it is pinned separately by the panel so its
 * position never moves as the sort changes.
 */
export function sortLists(lists, sortKey, { hunterNameFor = () => null, countFor = () => 0 } = {}) {
  const items = [...lists];

  switch (sortKey) {
    case "hunter": {
      const resolved = [];
      const unresolved = [];
      for (const l of items) {
        const hunterName = l.hunterId ? hunterNameFor(l.hunterId) : null;
        (hunterName ? resolved : unresolved).push({ l, hunterName });
      }
      resolved.sort(
        (a, b) =>
          a.hunterName.localeCompare(b.hunterName, undefined, { sensitivity: "base" }) ||
          byName(a.l, b.l)
      );
      unresolved.sort((a, b) => byName(a.l, b.l));
      return [...resolved, ...unresolved].map((x) => x.l);
    }

    case "created":
      // Newest first — a list you just made is the one you are most likely to want.
      return items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || byName(a, b));

    case "count":
      // Descending, ties broken by name.
      return items.sort((a, b) => countFor(b.id) - countFor(a.id) || byName(a, b));

    case "name":
    default:
      return items.sort(byName);
  }
}

/**
 * Group loadouts by list id.
 *
 * A loadout whose `listId` is null — or which references a list that no longer exists —
 * belongs to Unassigned. The dangling case degrades rather than erroring: SPEC-0003
 * requires a loadout referencing a deleted list to render in Unassigned, never to vanish
 * or throw.
 */
export const UNASSIGNED = "__unassigned__";

export function groupByList(loadouts, lists) {
  const known = new Set(lists.map((l) => l.id));
  const groups = new Map(lists.map((l) => [l.id, []]));
  groups.set(UNASSIGNED, []);

  for (const loadout of loadouts) {
    const key = loadout.listId && known.has(loadout.listId) ? loadout.listId : UNASSIGNED;
    groups.get(key).push(loadout);
  }
  return groups;
}

/**
 * Order the loadouts within ONE list (or Unassigned) by their `order` field.
 *
 * Governing: SPEC-0003 REQ "Loadouts Within a List Have a User-Chosen Order". Unlike
 * `sortLists` above, this is not a client-chosen VIEW — the server always materialises a
 * numeric `order` on every loadout it returns (`server/src/routes/loadouts.js`'s
 * `publicLoadout`), computed from the record's storage position when nothing has been
 * explicitly written yet, so this is a plain ascending sort with no fallback of its own to
 * carry: an absent value here would mean the record came from a path that skipped the
 * server's projection (a stale fixture in a test, never a real API response), not a case
 * this function needs to paper over. `?? 0` keeps the sort from throwing on `undefined - 5`
 * (`NaN` and Array.prototype.sort do not mix) rather than asserting anything about what an
 * absent order MEANS.
 *
 * A plain numeric sort is stable for ties in every engine this app ships to (Array.prototype
 * .sort has been spec-stable since ES2019) — two loadouts that somehow shared an `order`
 * would keep their incoming relative order rather than being shuffled on every render.
 */
export function sortByOrder(loadouts) {
  return [...loadouts].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/**
 * Move the loadout with id `id` so it sits at `toIndex` in the result.
 *
 * Governing: SPEC-0003 REQ "Loadouts Within a List Have a User-Chosen Order". This is the
 * KEYBOARD path's move: LoadoutListsPanel.jsx computes the on-screen preview during an
 * in-progress keyboard grab by calling this on every arrow press, and commits the same
 * result on drop — the displayed order and the order actually sent are the same value,
 * never two computations that could drift apart.
 *
 * `toIndex` is clamped to the valid range of the array WITHOUT the moved item, so a caller
 * stepping one past either end lands on "first" or "last" rather than throwing or leaving a
 * gap. An unknown id is a no-op — returns `items` unchanged, not a copy with nothing moved,
 * so a caller can cheaply check `result === items` to tell "nothing happened" from "moved to
 * where it already was" (the latter still returns a new array).
 */
export function moveToIndex(items, id, toIndex) {
  const from = items.findIndex((i) => i.id === id);
  if (from === -1) return items;
  const without = items.filter((i) => i.id !== id);
  const clamped = Math.max(0, Math.min(toIndex, without.length));
  const next = [...without];
  next.splice(clamped, 0, items[from]);
  return next;
}

/**
 * Move the loadout with id `movedId` to sit immediately before or after the loadout with id
 * `targetId`.
 *
 * Governing: SPEC-0003 REQ "Loadouts Within a List Have a User-Chosen Order". This is the
 * POINTER path's move: a drop is resolved against whichever card the pointer released over
 * (`targetId`) and which half of that card's height the pointer was in (`placeBefore`),
 * never against a raw index — the equipment grid's pointer drop is resolved the same way,
 * against a cell under the pointer rather than a tracked coordinate.
 *
 * Dropping onto itself, or naming an id this list does not contain, is a no-op — returns
 * `items` unchanged. That covers both "the drag ended over its own card" (the ordinary
 * no-op drop) and a stale target from a race between the drop and a concurrent change to
 * the list, without the caller needing to check either case separately.
 */
export function moveBesideTarget(items, movedId, targetId, placeBefore) {
  if (movedId === targetId) return items;
  const moved = items.find((i) => i.id === movedId);
  if (!moved) return items;
  const without = items.filter((i) => i.id !== movedId);
  const targetIndex = without.findIndex((i) => i.id === targetId);
  if (targetIndex === -1) return items;
  const insertAt = placeBefore ? targetIndex : targetIndex + 1;
  const next = [...without];
  next.splice(insertAt, 0, moved);
  return next;
}
