import { AMMO, CONS, FIRST_AID_KIT, QM, TOOLS, TRAITS, WEAPONS } from "../data/catalog.js";
import { totalCost } from "./calc.js";

const RANDOM_TRAIT_COUNT = 3;
const BUDGET_RETRY_ATTEMPTS = 80;
const EQUIP_FILL_GUARD = 60;

function attempt({ slotMax, upBudgetOn, upBudget }) {
  const upCap = upBudgetOn ? upBudget : Infinity;

  const traits = [];
  if (Math.random() < 0.3) traits.push(QM);
  let upSpent = traits.reduce((a, id) => a + TRAITS.find((t) => t[0] === id)[2], 0);
  if (upSpent > upCap) {
    traits.length = 0;
    upSpent = 0;
  }
  const poolIds = TRAITS.map((t) => t[0]).filter((id) => id !== QM);
  const nT = Math.min(RANDOM_TRAIT_COUNT, poolIds.length);
  for (let k = 0; k < nT && poolIds.length; k++) {
    const p = poolIds.splice(Math.floor(Math.random() * poolIds.length), 1)[0];
    const up = TRAITS.find((t) => t[0] === p)[2];
    if (upSpent + up <= upCap) {
      traits.push(p);
      upSpent += up;
    }
  }

  const cap = 5 + (traits.includes(QM) ? 1 : 0);
  const w1c = WEAPONS.map((w, i) => i).filter((i) => WEAPONS[i][2] <= cap - 1);
  const i1 = w1c[Math.floor(Math.random() * w1c.length)];
  const rem = cap - WEAPONS[i1][2];
  const w2c = WEAPONS.map((w, i) => i).filter((i) => WEAPONS[i][2] <= rem);
  const i2 = w2c.length ? w2c[Math.floor(Math.random() * w2c.length)] : null;
  const mkAmmo = (i) =>
    Math.random() < 0.3 && AMMO[WEAPONS[i][4]].length ? Math.floor(Math.random() * AMMO[WEAPONS[i][4]].length) : -1;
  const weapons = [{ i: i1, a: mkAmmo(i1) }, i2 === null ? null : { i: i2, a: mkAmmo(i2) }];

  // Starter tool resolved by stable catalog id so a future reorder of TOOLS
  // can't silently remap the random build's guaranteed First Aid Kit.
  const equip = [{ t: "T", i: TOOLS.findIndex((t) => t[0] === FIRST_AID_KIT) }];
  const n = Math.min(5 + Math.floor(Math.random() * 4), slotMax);
  let guard = 0;
  while (equip.length < n && guard++ < EQUIP_FILL_GUARD) {
    if (Math.random() < 0.5) {
      const i = 1 + Math.floor(Math.random() * (TOOLS.length - 1));
      if (i !== equip[0].i && !equip.some((e) => e.t === "T" && e.i === i)) equip.push({ t: "T", i });
    } else {
      const i = Math.floor(Math.random() * CONS.length);
      // Cap is four copies of the same consumable, not four of the same type.
      if (equip.filter((e) => e.t === "C" && e.i === i).length < 4) equip.push({ t: "C", i });
    }
  }

  return { weapons, equip, traits };
}

// Returns { weapons, equip, traits } for a random loadout, respecting `slotMax` and,
// when `budgetOn`, retrying up to 80 times to land at or under `budget`.
export function randomizeLoadout({ slotMax, budgetOn, budget, upBudgetOn, upBudget }) {
  let best = attempt({ slotMax, upBudgetOn, upBudget });
  if (budgetOn) {
    for (let k = 0; k < BUDGET_RETRY_ATTEMPTS; k++) {
      const a = attempt({ slotMax, upBudgetOn, upBudget });
      if (totalCost(a) <= budget) {
        best = a;
        break;
      }
      if (totalCost(a) < totalCost(best)) best = a;
    }
  }
  return best;
}
