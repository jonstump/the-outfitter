// Governing: ADR-0006, SPEC-0003 REQ "List Ordering and Sorting"
//
// Sort orders for the list roster. The preference is client state and is never persisted
// server-side — see uiSlice.

/** Every sort this module can perform. */
export const SORT_KEYS = ["name", "hunter", "created", "recent", "count"];

/**
 * The subset actually offered in the UI today.
 *
 * "hunter" needs a hunters dataset to resolve ids to names (issue #88 / ADR-0007), and
 * "recent" needs a `lastUsedAt` the server does not yet record. Both currently fall
 * through to the name tiebreak, so offering them would ship two menu entries that
 * silently duplicate the default. The comparators stay implemented and unit-tested so
 * enabling them is a one-line change once the data exists.
 */
export const AVAILABLE_SORT_KEYS = ["name", "created", "count"];

export const SORT_LABELS = {
  name: "List name",
  hunter: "Hunter name",
  created: "Creation date",
  recent: "Recently used",
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

    case "recent":
      // "Used" means last opened (SPEC-0003). A list never opened sorts after every list
      // that has been, rather than jumping to the top on a missing value.
      return items.sort(
        (a, b) => String(b.lastUsedAt || "").localeCompare(String(a.lastUsedAt || "")) || byName(a, b)
      );

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
