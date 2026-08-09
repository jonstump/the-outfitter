import { AMMO, CONS, QM, TOOLS, TRAITS, WEAPONS } from "../data/catalog.js";

// All functions take a loadout-shaped object: { weapons: [w0, w1], equip: [{t,i}], traits: [id], blocked }

export function capMax(loadout) {
  return 5 + (loadout.traits.includes(QM) ? 1 : 0);
}

export function capUsed(loadout) {
  return loadout.weapons.reduce((a, w) => a + (w ? WEAPONS[w.i][2] : 0), 0);
}

export function slotMax(loadout) {
  return 8 - loadout.blocked;
}

export function catCount(loadout, category) {
  return loadout.equip.filter((e) => e.t === "C" && CONS[e.i][3] === category).length;
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
    if (w.a >= 0) t += AMMO[WEAPONS[w.i][4]][w.a][1];
  });
  loadout.equip.forEach((e) => {
    t += e.t === "T" ? TOOLS[e.i][2] : CONS[e.i][2];
  });
  return t;
}
