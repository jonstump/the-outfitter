import { createSelector } from "@reduxjs/toolkit";
import { capMax, capUsed, equipOverCapacity, totalCost, upTotal } from "../utils/calc.js";
import { resolveSaveListId } from "./savedLoadoutsSlice.js";

// Governing: #24 (memoized derived-state selectors)
//
// Narrow, memoized selectors for the derived loadout values that several panels
// render. Components subscribe to just the slice they need instead of grabbing
// the whole `loadout` object, so unrelated state changes no longer re-render
// them (and re-compute totals) for nothing.

const selectLoadout = (state) => state.loadout;

export const selectWeaponCount = createSelector([selectLoadout], (l) => l.weapons.filter(Boolean).length);

export const selectCapMax = createSelector([selectLoadout], capMax);

export const selectCapUsed = createSelector([selectLoadout], capUsed);

export const selectUpTotal = createSelector([selectLoadout], upTotal);

export const selectTotalCost = createSelector([selectLoadout], totalCost);

// Governing: ADR-0009, SPEC-0006 REQ "Equipment Occupies a Fixed Eight-Cell Grid".
// `equip.length` is always 8 under this model, so the count the panel header shows is
// the number of CELLS HOLDING items — the holes must not be counted as equipment.
export const selectEquipCount = createSelector([selectLoadout], (l) => l.equip.filter(Boolean).length);

// Governing: issue #353, ADR-0009, ADR-0015. The over-capacity surface the equipment
// panel renders — null when the grid is legal, otherwise a structured reason. Reads
// through `equipOverCapacity` so the warning cannot disagree with the reducer's rules.
export const selectEquipOverCapacity = createSelector([selectLoadout], equipOverCapacity);

// A cell is effectively unavailable when it is either blocked or occupied; the
// panel drives per-cell blocked styling from this alongside `selectEquipEntry`.
export const selectBlockedCells = createSelector([selectLoadout], (l) => (Array.isArray(l.blocked) ? l.blocked : []));


export const selectEquipEntry = (index) =>
  createSelector([selectLoadout], (l) => l.equip[index]);

export const selectWeaponSlot = (slot) =>
  createSelector([selectLoadout], (l) => l.weapons[slot]);

/**
 * The NAME of the list a save would file into, or null when it would go to Unassigned.
 *
 * Governing: SPEC-0003 REQ "The Selected List Is Client State".
 *
 * Goes through `resolveSaveListId` rather than reading `ui.selectedListId`, so the label on the
 * save control and the destination of the save itself come from one rule.
 *
 * Stated precisely, because the obvious stronger claim is false: TODAY the two are
 * indistinguishable, since looking a name up by id performs the same existence check the
 * resolver does, and a stale id yields null down either path. The shared call is not fixing a
 * live bug — it is what keeps the two in step the day the resolution rule gains a condition
 * that ISN'T "the list exists". An archived flag, or a list the user may see but not file
 * into, would immediately make a raw read name a destination the save refuses to use, and it
 * would do so silently. `selectors.test.js` pins the agreement rather than the implementation,
 * so that drift fails a test instead of shipping.
 *
 * Returns a name and not a record: the caller is a label, and handing it the whole list would
 * re-render the button whenever anything on that record changed.
 */
export const selectSaveDestinationName = (state) => {
  const id = resolveSaveListId(state);
  return id ? (state.loadoutLists.items.find((l) => l.id === id)?.name ?? null) : null;
};
