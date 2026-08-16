import { AMMO, CONS, CONS_CAP_CATEGORIES, QM, TOOLS, TRAITS, WEAPONS } from "../data/catalog.js";

// All functions take a loadout-shaped object: { weapons: [w0, w1], equip: [{t,i}], traits: [id], blocked }

/**
 * The most traits a hunter can carry.
 *
 * Governing: ADR-0012 (fifteen-trait cap), SPEC-0003 REQ "A Loadout Holds At Most Fifteen Traits"
 *
 * Fifteen is fixed for every hunter, which is what separates it from the upgrade-point
 * budget: that ceiling is opt-in because it varies with a hunter level the app cannot
 * know, and nothing about fifteen varies. So this cap is unconditional and is NOT gated
 * on `ui.upBudgetOn`.
 *
 * It lives here, once, because a bound is only a bound if every writer states the same
 * number — the interactive add (loadoutSlice), both decoders (loadoutCodec), and the
 * generator (randomize) all import this rather than repeating the literal.
 */
export const TRAIT_MAX = 15;

export function capMax(loadout) {
  return 5 + (loadout.traits.includes(QM) ? 1 : 0);
}

export function capUsed(loadout) {
  return loadout.weapons.reduce((a, w) => a + weaponSize(w), 0);
}

/**
 * The weapon-budget points one entry occupies: its catalog size, or size + 1 when it
 * is a dual-wielded pair.
 *
 * Governing: ADR-0023, SPEC-0009 REQ "A Pair Costs Its Weapon's Size Plus One".
 *
 * The +1 is stated once and read by every capacity consumer — the reducer's addWeapon,
 * the picker, the generator and totalCost all MUST agree on what a pair costs, so the
 * arithmetic cannot drift between them. `undefined` entries (and entries whose `d` is
 * absent) are singles: a pair flag is a property of version-3 state, and state that has
 * not been normalized never pays the pair premium.
 *
 * Size-1 pistols only are verified in game; the size-2 figure is untested, and this
 * rule is implemented exactly as SPEC-0009 states it — no special case, no confirmation
 * in comments or tests (issue #178).
 */
export function weaponSize(w) {
  if (!w) return 0;
  return WEAPONS[w.i][2] + (w.d === true ? 1 : 0);
}

/**
 * Equipment capacity, stated once.
 *
 * Governing: ADR-0009 (sparse eight-cell grid), ADR-0015 (four per type, not four per
 * specific item — accepted 2026-08-12), SPEC-0006 REQ "Capacity Rules Are Stated Once
 * and Preserved", SPEC-0008 (the generator obeys the same cap).
 *
 * Capacity is ONE predicate: "a free, unblocked cell exists." `equip` is a fixed
 * eight-cell grid, so a free cell is an empty cell that is not in `blocked` — a hole
 * at a blocked position does not count as room. Every caller (reducer, picker,
 * generator) consults this one predicate rather than re-deriving capacity, so the
 * picker's enabled state and the reducer's acceptance cannot drift apart.
 */
export function hasFreeCell(loadout) {
  const blocked = new Set(loadout.blocked || []);
  return loadout.equip.some((e, k) => e === null && !blocked.has(k));
}

/**
 * The cap category a consumable counts against, RESOLVED THROUGH THE DECLARED LIST.
 *
 * Governing: ADR-0015, SPEC-0006 REQ "Capacity Rules Are Stated Once and Preserved",
 * SPEC-0007 REQ "Rules Inputs Are Assigned Only From Mechanical Categories" (prohibition
 * withdrawn by ADR-0015).
 *
 * SPEC-0007 read, until ADR-0015: "`CONS[i][3]` (`type`) is descriptive — it labels
 * picker rows — and MUST NOT be re-introduced as a cap key." ADR-0015's Decision
 * Outcome reverses that: the cap is four per TYPE, so `type` IS a cap key again.
 *
 * SPEC-0006: "The cap SHALL be read from a declared list of cap categories rather than
 * inferred from the `type` values present in `CONS`." Membership is therefore tested
 * against `CONS_CAP_CATEGORIES` (data/catalog.js) rather than the row's `type` being
 * taken at face value. This module used to declare its OWN four-entry copy of that list
 * and then never read it — the count grouped by raw `type`, which is the inference the
 * requirement forbids, and which left the list dead and its comment free to go false.
 *
 * Every undeclared type folds into ONE shared budget, not a budget per bad value. A row
 * typed `Bogus` must not get four slots of its own, and two typos must not get eight:
 * SPEC-0006 says such a row is "treated as a data error rather than silently escaping
 * the cap". `catalog.test.js` is what stops one reaching production; this is what bounds
 * it if one does.
 */
export const UNDECLARED_CATEGORY = "__undeclared__";

/**
 * Resolve a raw `type` value to the cap category it counts against.
 *
 * Exported because this one line IS the requirement — "read from a declared list ... rather than
 * inferred from the `type` values present in `CONS`" — and a rule reachable only through a catalog
 * row cannot be tested against a type the catalog does not contain. Every undeclared value
 * collapses to the same sentinel, which is what makes two bad values share one budget instead of
 * minting four slots each.
 */
export function capCategoryOf(type) {
  return CONS_CAP_CATEGORIES.includes(type) ? type : UNDECLARED_CATEGORY;
}

// Exported so callers resolve a consumable's cap category through this rather than
// re-deriving `capCategoryOf(CONS[i][3])` at the call site — the decoder's clamp
// needed exactly this and had inlined the body (issue #418 review).
export function capCategory(consIndex) {
  return capCategoryOf(CONS[consIndex] ? CONS[consIndex][3] : undefined);
}

/**
 * How many equipped consumables of one cap category, counted across all cells
 * regardless of adjacency and regardless of which specific items make up the four.
 *
 * Governing: ADR-0015, SPEC-0006 REQ "Capacity Rules Are Stated Once and Preserved".
 * Per-item counting is RETIRED, not kept alongside: four of one item is already four
 * of its type, and a `×3` stack counts as 3.
 */
export function consCategoryCount(loadout, consIndex) {
  const category = capCategory(consIndex);
  return heldItems(loadout).filter((e) => e.t === "C" && capCategory(e.i) === category).length;
}

/**
 * Whether a consumable can still be added under the per-category cap.
 *
 * Governing: ADR-0015, SPEC-0006 REQ "Capacity Rules Are Stated Once and Preserved",
 * SPEC-0008 (the generator obeys the same cap). The single predicate every caller
 * uses: four of the item's TYPE are held, another cannot be added. A stack of three
 * Vitality Shots plus one more is four of `Shot` — and any fifth `Shot` (even a
 * different specific item) is rejected.
 */
/**
 * The per-cap-category consumable ceiling (ADR-0015). Named rather than inlined
 * because it is read from two directions — `consAllowed` asks "is there room for
 * one more" (`< CONS_CAP`) and `equipOverCapacity` asks "are we past it"
 * (`> CONS_CAP`). ADR-0015 already moved this rule once (four per specific item →
 * four per type) and SPEC-0006 anticipates Tarot Cards becoming a fourth cap
 * category, so a second copy of the literal is a drift waiting to happen.
 */
export const CONS_CAP = 4;

export function consAllowed(loadout, consIndex) {
  return consCategoryCount(loadout, consIndex) < CONS_CAP;
}

export function slotMax(loadout) {
  return 8 - (Array.isArray(loadout.blocked) ? loadout.blocked.length : 0);
}

/**
 * The equipment actually held, ignoring empty cells.
 *
 * Governing: ADR-0009 (index is the cell, `null` is an empty cell), SPEC-0006
 * REQ "Equipment Occupies a Fixed Eight-Cell Grid". `equip` is exactly eight
 * entries under this model, so counting or iterating the raw array would count
 * holes as items and produce plausible-looking wrong numbers. Every consumer
 * that counts or totals equipment reads through this helper.
 */
export function heldItems(loadout) {
  return loadout.equip.filter(Boolean);
}

/**
 * Whether the equipment grid is over its capacity, and why.
 *
 * Governing: ADR-0009 (eight cells), ADR-0015 (four per cap category), SPEC-0006
 * REQ "Capacity Rules Are Stated Once and Preserved", issue #353.
 *
 * Two independent ways to be over capacity: more items held than unblocked cells
 * (`held > slotMax`), or more than four consumables of one cap category. Either
 * produces a loadout the game refuses, and the equipment panel must surface it
 * rather than pricing the build confidently. Returns null when the grid is legal.
 *
 * Reads through `heldItems`, `slotMax`, `consCategoryCount` and `CONS_CAP` — the
 * SAME counter and the SAME ceiling `consAllowed` is built on — so the warning
 * cannot disagree with the reducer's rules. #353 asks for exactly this ("drive it
 * from `consAllowed` / `capCategoryOf` rather than re-deriving the rule"): counting
 * categories here with a second literal `4` would have been a copy of the cap that
 * the next change to ADR-0015 could miss.
 */
export function equipOverCapacity(loadout) {
  const items = heldItems(loadout);
  const max = slotMax(loadout);
  if (items.length > max) return { kind: "slots", held: items.length, max };
  // `consCategoryCount` resolves each item's cap category and counts the whole
  // grid for it, so asking once per held consumable is enough — an over-cap
  // category necessarily contains at least one held item that reports it. An
  // undeclared type collapses to one shared budget inside `capCategoryOf`, so two
  // unknown types share the ceiling rather than minting one each.
  for (const e of items) {
    if (e.t !== "C") continue;
    const n = consCategoryCount(loadout, e.i);
    if (n > CONS_CAP) return { kind: "category", category: capCategory(e.i), held: n, max: CONS_CAP };
  }
  return null;
}

const TRAIT_UP = new Map(TRAITS.map((t) => [t[0], t[2]]));
export function upTotal(loadout) {
  return loadout.traits.reduce((a, id) => a + (TRAIT_UP.get(id) || 0), 0);
}

export function totalCost(loadout) {
  let t = 0;
  loadout.weapons.forEach((w) => {
    if (!w) return;
    // Governing: ADR-0023, SPEC-0009 REQ "A Pair Carries One Weapon's Ammo and Doubles
    // Only the Weapon Price". A pair buys two pistols, so the WEAPON price counts twice;
    // both fire the same round, so the ammo price does NOT double — the ammo line below
    // is deliberately outside this branch.
    t += WEAPONS[w.i][3] * (w.d === true ? 2 : 1);
    // Governing: issue #201. The decoder bounds `a` against the weapon's own variant list,
    // so a selection that resolves to nothing should be unreachable — but this used to
    // index straight into the pool, and an unresolved variant threw here rather than
    // costing nothing. Cost is a pure function of a loadout the user can also have built
    // in-session; it should not be the thing that decides a build is unrenderable.
    const variant = w.a >= 0 ? (AMMO[WEAPONS[w.i][4]] || [])[w.a] : null;
    if (variant) t += variant[1];
  });
  loadout.equip.forEach((e) => {
    if (!e) return; // empty cell — ADR-0009 holes are not items
    t += e.t === "T" ? TOOLS[e.i][2] : CONS[e.i][2];
  });
  return t;
}
