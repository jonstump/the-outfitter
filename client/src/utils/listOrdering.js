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
