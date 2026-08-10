// Governing: ADR-0007 (Scrape the Full Hunter Roster into a Generated Dataset)
// Implements: SPEC-0003 REQ "List Ordering and Sorting", SPEC-0003 REQ "Hunter Dataset
// Consumption Contract"
//
// The roster seam. SPEC-0004's scrape writes `client/src/data/hunters.json`; until it has
// run, the roster is empty.
//
// An empty roster is a correct state here, not a placeholder. SPEC-0003 already requires
// every consumer to tolerate a `hunterId` absent from the dataset — "the dataset and a
// user's stored lists refresh independently" — and with no dataset, every id is absent.
// `hunterNameFor` reports that honestly and needs no special case for "not scraped yet";
// the not-scraped-yet state and the hunter-left-the-roster state are the same state.
//
// Landing the dataset is one import in this file and nothing else:
//
//     import hunters from "./hunters.json";
//     export const HUNTERS = hunters;
//
// Everything downstream — hunter-name ordering, and the picker when it arrives — reads
// through here, so nothing else has to change to pick it up.

export const HUNTERS = [];

const NAME_BY_ID = new Map(HUNTERS.map((h) => [h.id, h.name]));

/**
 * Resolve a hunter id to its display name, or null when the dataset does not carry it.
 *
 * Null is the ordinary answer, not an error: a list may reference a hunter that has left
 * the roster, or the roster may not be populated at all. SPEC-0003 defines the caller's
 * behaviour in that case (group after everything that resolves; render a placeholder).
 */
export function hunterNameFor(hunterId) {
  if (!hunterId) return null;
  return NAME_BY_ID.get(hunterId) ?? null;
}
