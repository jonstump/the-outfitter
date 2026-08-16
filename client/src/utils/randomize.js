import { CONS, FIRST_AID_KIT, QM, TOOLS, TRAITS, WEAPONS } from "../data/catalog.js";
import { ammoSlotsFor } from "../data/itemStats.js";
import { TRAIT_MAX, consAllowed, hasFreeCell, totalCost, weaponSize } from "./calc.js";

const RANDOM_TRAIT_COUNT = 3;
const BUDGET_RETRY_ATTEMPTS = 80;
const EQUIP_FILL_GUARD = 60;

// GENERATOR CONTRACT (SPEC-0006 REQ "Randomized and Bulk-Set Loadouts Produce
// Well-Formed Grids", SPEC-0008, ADR-0009):
//
// The generated loadout is a FIXED EIGHT-CELL GRID, not a packed array. Blocks are
// per-cell indices, so the generator places items only in unblocked cells, and the
// per-category consumable cap (ADR-0015) is respected via the SAME predicates the
// reducer uses — consAllowed/hasFreeCell. Holes may remain at blocked positions;
// the starter tool goes into the lowest free cell.
//
// Governing: issue #383. `hasFreeCell` (calc.js) is genuinely imported and called
// below, not just claimed — a prior version re-derived its predicate inline here,
// so a future change to `hasFreeCell` would have been picked up by the reducer and
// the picker and silently missed by the generator. The `findIndex` scan that follows
// still has to run to locate WHICH cell is free (`hasFreeCell` only answers whether
// one exists), so it is not redundant with the `hasFreeCell` call — it is the same
// existence check `hasFreeCell` makes, reused as a guard before the index lookup.
function place(equip, blocked, entry) {
  if (!hasFreeCell({ equip, blocked })) return false;
  const free = equip.findIndex((e, k) => e === null && !blocked.has(k));
  equip[free] = entry;
  return true;
}

function attempt({ blockedArray, upBudgetOn, upBudget }) {
  const blocked = new Set(blockedArray || []);
  const upCap = upBudgetOn ? upBudget : Infinity;

  const traits = [];
  if (Math.random() < 0.3) traits.push(QM);
  let upSpent = traits.reduce((a, id) => a + TRAITS.find((t) => t[0] === id)[2], 0);
  if (upSpent > upCap) {
    traits.length = 0;
    upSpent = 0;
  }
  const poolIds = TRAITS.map((t) => t[0]).filter((id) => id !== QM);
  // Governing: ADR-0012 (fifteen-trait cap), SPEC-0003 REQ "A Loadout Holds At Most Fifteen Traits"
  //
  // The draw is bounded by the cap as well as by the pool. RANDOM_TRAIT_COUNT is three today,
  // so this changes no generated build — it is here so raising the draw count cannot quietly
  // start generating loadouts the game rejects. The remaining headroom, not the draw count,
  // is what bounds the loop, because Quartermaster may already be in `traits`.
  const nT = Math.min(RANDOM_TRAIT_COUNT, poolIds.length, Math.max(TRAIT_MAX - traits.length, 0));
  for (let k = 0; k < nT && poolIds.length; k++) {
    const p = poolIds.splice(Math.floor(Math.random() * poolIds.length), 1)[0];
    const up = TRAITS.find((t) => t[0] === p)[2];
    if (upSpent + up <= upCap) {
      traits.push(p);
      upSpent += up;
    }
  }

  const cap = 5 + (traits.includes(QM) ? 1 : 0);
  // Governing: ADR-0023, SPEC-0009 REQ "The Pair Flag Is Refused Wherever the Data Does
  // Not Permit It", REQ "A Pair Costs Its Weapon's Size Plus One".
  //
  // The generator draws SINGLE weapons only — `d: false` on every entry — and budgets the
  // pair-free size. `weaponSize` is the shared capacity predicate, so if a future story
  // makes the generator emit pairs, the same +1 the reducer/picker use gates here too and
  // the draw cannot silently exceed the cap.
  const w1c = WEAPONS.map((w, i) => i).filter((i) => weaponSize({ i, d: false }) <= cap - 1);
  const i1 = w1c[Math.floor(Math.random() * w1c.length)];
  const rem = cap - weaponSize({ i: i1, d: false });
  const w2c = WEAPONS.map((w, i) => i).filter((i) => weaponSize({ i, d: false }) <= rem);
  const i2 = w2c.length ? w2c[Math.floor(Math.random() * w2c.length)] : null;
  // Governing: ADR-0014, SPEC-0010 REQ "A Weapon Holds Up to Two Independently Chosen
  // Rounds", issue #344 (mirrors #384's original AMMO-lookup guard, now per-weapon-slot).
  //
  // Rolls each of the weapon's OWN slots independently — up to two, per `ammoSlotsFor`,
  // which already resolves split-reserve (both slots share one group, may repeat) vs.
  // dual-family (#431's disjoint groups) vs. one-slot. A slot past the weapon's own
  // count, or one whose group is empty, stays unfilled; each filled slot is an
  // independent 30% draw, same odds the single-slot generator always used.
  const mkAmmo = (i) => {
    const slots = ammoSlotsFor(WEAPONS[i][0]);
    return [0, 1].map((slotIndex) => {
      const group = slotIndex < slots.count ? slots.groups[slotIndex] : null;
      if (!group || !group.length || Math.random() >= 0.3) return null;
      return group[Math.floor(Math.random() * group.length)].id;
    });
  };
  const weapons = [{ i: i1, ammo: mkAmmo(i1), d: false }, i2 === null ? null : { i: i2, ammo: mkAmmo(i2), d: false }];

  // Starter tool resolved by stable catalog id so a future reorder of TOOLS
  // can't silently remap the random build's guaranteed First Aid Kit.
  const equip = Array(8).fill(null);
  const starter = { t: "T", i: TOOLS.findIndex((t) => t[0] === FIRST_AID_KIT) };
  if (!place(equip, blocked, starter)) return { weapons, equip, traits };

  const n = Math.min(5 + Math.floor(Math.random() * 4), 8 - blocked.size);
  let guard = 0;
  while (held(equip) < n && guard++ < EQUIP_FILL_GUARD) {
    if (Math.random() < 0.5) {
      const i = 1 + Math.floor(Math.random() * (TOOLS.length - 1));
      if (i !== starter.i && !equip.some((e) => e && e.t === "T" && e.i === i)) place(equip, blocked, { t: "T", i });
    } else {
      const i = Math.floor(Math.random() * CONS.length);
      const candidate = { t: "C", i };
      // Governing: ADR-0015 (four per cap category), SPEC-0008 (the generator obeys
      // the same cap). The SAME consAllowed predicate the reducer uses, so a random
      // loadout cannot emit a build the picker would refuse to add to.
      if (consAllowed(equipAsLoadout(equip), i)) place(equip, blocked, candidate);
    }
  }

  return { weapons, equip, traits };
}

function held(equip) {
  return equip.filter(Boolean).length;
}

// Wrapper to reuse the calc.js predicates without rebuilding the full shape.
function equipAsLoadout(equip) {
  return { equip };
}

// Returns { weapons, equip, traits } for a random loadout, respecting `blocked` cells,
// the per-category consumable cap, and — when `budgetOn` — retrying up to 80 times to
// land at or under `budget`. `equip` is a full eight-cell grid (ADR-0009); blocked
// positions stay holes.
export function randomizeLoadout({ blocked, budgetOn, budget, upBudgetOn, upBudget }) {
  let best = attempt({ blockedArray: blocked, upBudgetOn, upBudget });
  if (budgetOn) {
    for (let k = 0; k < BUDGET_RETRY_ATTEMPTS; k++) {
      const a = attempt({ blockedArray: blocked, upBudgetOn, upBudget });
      if (totalCost(a) <= budget) {
        best = a;
        break;
      }
      if (totalCost(a) < totalCost(best)) best = a;
    }
  }
  return best;
}
