import { createSlice } from "@reduxjs/toolkit";
import { CONS, WEAPONS } from "../data/catalog.js";
import { capMax, catCount, slotMax } from "../utils/calc.js";
import { emptyLoadout } from "../utils/loadoutCodec.js";

// Shape of a valid loadout state object. setLoadout() rejects payloads that don't
// conform so a malformed/partial payload can't silently poison the store (issue #27).
// `name`/`blocked` are optional and defaulted — randomize's payload intentionally
// omits them (a random build has no name and keeps the current blocked count).
function isValidLoadoutShape(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  if (typeof payload.weapons !== "object" || !Array.isArray(payload.weapons) || payload.weapons.length !== 2) return false;
  if (payload.blocked !== undefined && (typeof payload.blocked !== "number" || payload.blocked < 0 || payload.blocked > 8)) return false;
  if (payload.name !== undefined && typeof payload.name !== "string") return false;
  if (!Array.isArray(payload.equip) || !Array.isArray(payload.traits)) return false;
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
    setAmmo(state, action) {
      const { slot, ammoIndex } = action.payload;
      if (state.weapons[slot]) state.weapons[slot].a = ammoIndex;
    },
    addEquip(state, action) {
      const { t, i } = action.payload;
      if (state.equip.length >= slotMax(state)) return;
      // One of each specific Tool per loadout — re-verified against the wiki as still
      // in force after Update 2.8's equipment-slot rework (issue #41).
      if (t === "T" && state.equip.some((e) => e.t === "T" && e.i === i)) return;
      if (t === "C" && catCount(state, CONS[i][3]) >= 4) return;
      state.equip.push({ t, i });
    },
    removeEquip(state, action) {
      state.equip.splice(action.payload, 1);
    },
    toggleBlockedSlot(state, action) {
      const slotPosition = action.payload;
      const isBlocked = slotPosition >= slotMax(state);
      state.blocked = isBlocked ? state.blocked - 1 : Math.min(state.blocked + 1, 8 - state.equip.length);
    },
    addTrait(state, action) {
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
      state.equip = [];
      state.traits = [];
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
