import { AMMO, CONS, QM, TOOLS, TRAITS, WEAPONS } from "../data/catalog.js";

// All functions take a loadout-shaped object: { weapons: [w0, w1], equip: [{t,i}], traits: [idx], blocked }

export function capMax(loadout) {
  return 5 + (loadout.traits.includes(QM) ? 1 : 0);
}

export function capUsed(loadout) {
  return loadout.weapons.reduce((a, w) => a + (w ? WEAPONS[w.i][1] : 0), 0);
}

export function slotMax(loadout) {
  return 8 - loadout.blocked;
}

export function catCount(loadout, category) {
  return loadout.equip.filter((e) => e.t === "C" && CONS[e.i][2] === category).length;
}

export function upTotal(loadout) {
  return loadout.traits.reduce((a, i) => a + TRAITS[i][1], 0);
}

export function totalCost(loadout) {
  let t = 0;
  loadout.weapons.forEach((w) => {
    if (!w) return;
    t += WEAPONS[w.i][2];
    if (w.a >= 0) t += AMMO[WEAPONS[w.i][3]][w.a][1];
  });
  loadout.equip.forEach((e) => {
    t += e.t === "T" ? TOOLS[e.i][1] : CONS[e.i][1];
  });
  return t;
}
