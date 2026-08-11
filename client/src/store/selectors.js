import { createSelector } from "@reduxjs/toolkit";
import { capMax, capUsed, slotMax, totalCost, upTotal } from "../utils/calc.js";
import { resolveSaveListId } from "./savedLoadoutsSlice.js";

// Governing: #24 (memoized derived-state selectors)
//
// Narrow, memoized selectors for the derived loadout values that several panels
// render. Components subscribe to just the slice they need instead of grabbing
// the whole `loadout` object, so unrelated state changes no longer re-render
// them (and re-compute totals) for nothing.

const selectLoadout = (state) => state.loadout;

export const selectWeaponCount = createSelector([selectLoadout], (l) => l.weapons.filter(Boolean).length);

export const selectSlotMax = createSelector([selectLoadout], slotMax);

export const selectCapMax = createSelector([selectLoadout], capMax);

export const selectCapUsed = createSelector([selectLoadout], capUsed);

export const selectUpTotal = createSelector([selectLoadout], upTotal);

export const selectTotalCost = createSelector([selectLoadout], totalCost);

export const selectEquipCount = createSelector([selectLoadout], (l) => l.equip.length);

export const selectEquipEntry = (index) =>
  createSelector([selectLoadout], (l) => l.equip[index]);

export const selectWeaponSlot = (slot) =>
  createSelector([selectLoadout], (l) => l.weapons[slot]);

/**
 * The NAME of the list a save would file into, or null when it would go to Unassigned.
 *
 * Governing: SPEC-0003 REQ "The Selected List Is Client State".
 *
 * Reads `resolveSaveListId` rather than `ui.selectedListId`, so the name on the save control
 * is derived from the same answer the save itself uses — see the note on that function. A
 * selection that no longer resolves to a live list yields null here and files into Unassigned
 * there, together, rather than promising a list that has gone.
 *
 * Returns a name and not a record: the caller is a label, and handing it the whole list would
 * re-render the button whenever anything on that record changed.
 */
export const selectSaveDestinationName = (state) => {
  const id = resolveSaveListId(state);
  return id ? (state.loadoutLists.items.find((l) => l.id === id)?.name ?? null) : null;
};
