import { createSlice } from "@reduxjs/toolkit";
import { WEAPONS } from "../data/catalog.js";
import { TRAIT_MAX, capMax, consAllowed, hasFreeCell, heldItems } from "../utils/calc.js";
import { emptyLoadout } from "../utils/loadoutCodec.js";

// Governing: ADR-0009 (index is the cell, `null` is empty), SPEC-0006
// REQ "Equipment Occupies a Fixed Eight-Cell Grid", REQ "Cells Are Individually Blockable".
//
// Equipment lives in a fixed eight-cell sparse array. Index IS the cell;
// `null` IS an empty cell. A removal empties that cell only — it never
// relocates another item, and that is what a packed `splice` used to do.
// `blocked` is an array of cell indices (not a count): a middle cell can be
// blocked while later cells stay usable, and an occupied cell cannot be
// blocked. Placement skips every blocked index, so holes may remain at
// blocked positions while every unblocked cell is full.

// Shape of a valid loadout state object. setLoadout() rejects payloads that don't
// conform so a malformed/partial payload can't silently poison the store (issue #27).
// `name`/`blocked` are optional and defaulted — randomize's payload intentionally
// omits them (a random build has no name and keeps the current blocked count).
function isValidLoadoutShape(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  if (typeof payload.weapons !== "object" || !Array.isArray(payload.weapons) || payload.weapons.length !== 2) return false;
  if (typeof payload.equip !== "object" || !Array.isArray(payload.equip) || payload.equip.length > 8) return false;
  // Steady-state blocked cells are array-shaped (ADR-0009, v2), but bulk payloads
  // are still accepted for the legacy/blind-merge shape guard, and #278's flagged
  // gap means a payload may carry either a count or an array.
  if (payload.blocked !== undefined && (!Array.isArray(payload.blocked) || payload.blocked.some((c) => !Number.isInteger(c) || c < 0 || c >= 8))) return false;
  if (payload.name !== undefined && typeof payload.name !== "string") return false;
  if (!Array.isArray(payload.traits)) return false;
  return payload.weapons.every(
    (w) => w === null || (typeof w === "object" && typeof w.i === "number" && WEAPONS[w.i] && Number.isInteger(w.a))
  );
}

const loadoutSlice = createSlice({
  name: "loadout",
  initialState: emptyLoadout(),
  reducers: {
    addWeapon(state, action) {
      const weaponIndex = action.payload;
      const w = WEAPONS[weaponIndex];
      const slot = state.weapons[0] ? 1 : 0;
      const other = state.weapons[1 - slot] ? WEAPONS[state.weapons[1 - slot].i][2] : 0;
      if (w[2] + other > capMax(state)) return;
      state.weapons[slot] = { i: weaponIndex, a: -1 };
    },
    removeWeapon(state, action) {
      state.weapons[action.payload] = null;
    },
    // Picker placement fills the LOWEST-NUMBERED free (unblocked, empty) cell:
    // cells 0..7 in order, and `blocked` names the exact cells to skip (ADR-0009).
    setAmmo(state, action) {
      const { slot, ammoIndex } = action.payload;
      if (state.weapons[slot]) state.weapons[slot].a = ammoIndex;
    },
    addEquip(state, action) {
      const { t, i } = action.payload;
      // Capacity is the single shared predicate from calc.js — a free, unblocked
      // cell exists — so the picker's enabled state and the reducer's acceptance
      // cannot drift apart (SPEC-0006 REQ "Capacity Rules Are Stated Once and
      // Preserved"). Recomputed from the sparse grid rather than kept as a count,
      // because `equip.length` is always 8 under this model (ADR-0009); comparing
      // it against a slot maximum would silently disable the picker entirely.
      if (!hasFreeCell(state)) return;
      const blockSet = new Set(state.blocked);
      const free = state.equip.findIndex((e, k) => e === null && !blockSet.has(k));
      // One of each specific Tool per loadout — re-verified against the wiki as still
      // in force after Update 2.8's equipment-slot rework (issue #41).
      if (t === "T" && heldItems(state).some((e) => e.t === "T" && e.i === i)) return;
      // Governing: ADR-0015 (four per type, not four per specific item — accepted
      // 2026-08-12), SPEC-0006 REQ "Capacity Rules Are Stated Once and Preserved".
      // The cap is per cap CATEGORY (`CONS[i][3]`), not per specific consumable:
      // four Dynamite Sticks then a Dynamite Bundle is rejected, and four Vitality
      // Shots then any fifth `Shot` — even a Stamina Shot — is rejected.
      if (t === "C" && !consAllowed(state, i)) return;
      state.equip[free] = { t, i };
    },
    // Empties the ONE cell named by the index; other items never move (ADR-0009).
    removeEquip(state, action) {
      state.equip[action.payload] = null;
    },
    // Direct manipulation (SPEC-0006 REQ "Items Are Rearranged by Direct Manipulation").
    // A move is a PERMUTATION of cells and changes nothing but position: which items
    // are equipped, the total cost, and every capacity total are untouched. Dropping
    // onto an occupied cell swaps the two; dropping onto the origin cell is a no-op.
    // Blocked cells are not part of the grid's permutation space (a block is outside
    // the loadout), so any move involving one is rejected rather than swapped.
    moveEquip(state, action) {
      const { from, to } = action.payload;
      if (from === to) return;
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= 8 || to < 0 || to >= 8) return;
      if (state.blocked.includes(from) || state.blocked.includes(to)) return;
      if (state.equip[from] === null && state.equip[to] === null) return;
      const moving = state.equip[from] === null ? state.equip[to] : state.equip[from];
      if (moving === null) return;
      // Dragged off the grid unequips (the drop handler passes to = -1).
      if (to === null) {
        state.equip[from] = null;
        return;
      }
      state.equip[from] = state.equip[to];
      state.equip[to] = moving;
    },
    // Per-cell blocking (ADR-0009): `blocked` is an array of cell indices. A cell
    // that already holds an item cannot be blocked, and a blocked cell refuses
    // placement through `addEquip`'s free-cell scan above.
    toggleBlockedSlot(state, action) {
      const cell = action.payload;
      if (state.equip[cell]) return;
      const i = state.blocked.indexOf(cell);
      state.blocked = i === -1 ? [...state.blocked, cell].sort((a, b) => a - b) : state.blocked.filter((c) => c !== cell);
    },
    addTrait(state, action) {
      // Governing: ADR-0012 (fifteen-trait cap), SPEC-0003 REQ "A Loadout Holds At Most Fifteen Traits"
      //
      // The refusal is unconditional — deliberately NOT gated on `ui.upBudgetOn`, which is
      // off by default and would leave the shipped configuration with no cap at all. The UP
      // budget is a toggle because it depends on hunter level; fifteen depends on nothing.
      if (state.traits.length >= TRAIT_MAX) return;
      if (!state.traits.includes(action.payload)) state.traits.push(action.payload);
    },
    removeTrait(state, action) {
      state.traits = state.traits.filter((x) => x !== action.payload);
    },
    setName(state, action) {
      state.name = action.payload;
    },
    clearBuild(state) {
      state.weapons = [null, null];
      state.equip = Array(8).fill(null);
      state.traits = [];
      state.blocked = [];
    },
    // Bulk merge — used by hydrate-on-load, loading a saved build, and randomize.
    // Rejects payloads that don't match the loadout shape so a bad call fails
    // loudly at the source instead of silently corrupting derived math later.
    setLoadout(state, action) {
      const payload = action.payload;
      if (!isValidLoadoutShape(payload)) {
        throw new Error("setLoadout: payload does not match the expected loadout shape");
      }
      state.weapons = payload.weapons;
      state.equip = payload.equip;
      state.traits = payload.traits;
      state.blocked = payload.blocked ?? state.blocked;
      state.name = payload.name ?? state.name;
    },
  },
});

export const loadoutActions = loadoutSlice.actions;
export default loadoutSlice.reducer;
