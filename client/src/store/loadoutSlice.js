import { createSlice } from "@reduxjs/toolkit";
import { CONS, WEAPONS } from "../data/catalog.js";
import { capMax, catCount, slotMax } from "../utils/calc.js";
import { emptyLoadout } from "../utils/loadoutCodec.js";

const loadoutSlice = createSlice({
  name: "loadout",
  initialState: emptyLoadout(),
  reducers: {
    addWeapon(state, action) {
      const weaponIndex = action.payload;
      const w = WEAPONS[weaponIndex];
      const slot = state.weapons[0] ? 1 : 0;
      const other = state.weapons[1 - slot] ? WEAPONS[state.weapons[1 - slot].i][1] : 0;
      if (w[1] + other > capMax(state)) return;
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
      if (t === "T" && state.equip.some((e) => e.t === "T" && e.i === i)) return;
      if (t === "C" && catCount(state, CONS[i][2]) >= 4) return;
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
    setLoadout(state, action) {
      Object.assign(state, action.payload);
    },
  },
});

export const loadoutActions = loadoutSlice.actions;
export default loadoutSlice.reducer;
