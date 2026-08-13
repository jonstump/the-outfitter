import { AMMO, CONS, QM, TOOLS, TRAITS, WEAPONS } from "../data/catalog.js";

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
  return loadout.weapons.reduce((a, w) => a + (w ? WEAPONS[w.i][2] : 0), 0);
}

export function slotMax(loadout) {
  return 8 - loadout.blocked;
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

export function consCount(loadout, consIndex) {
  return heldItems(loadout).filter((e) => e.t === "C" && e.i === consIndex).length;
}

const TRAIT_UP = new Map(TRAITS.map((t) => [t[0], t[2]]));

export function upTotal(loadout) {
  return loadout.traits.reduce((a, id) => a + (TRAIT_UP.get(id) || 0), 0);
}

export function totalCost(loadout) {
  let t = 0;
  loadout.weapons.forEach((w) => {
    if (!w) return;
    t += WEAPONS[w.i][3];
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
