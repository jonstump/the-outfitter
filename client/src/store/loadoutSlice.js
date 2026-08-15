import { createSlice } from "@reduxjs/toolkit";
import { WEAPONS } from "../data/catalog.js";
import { dualWieldFor } from "../data/itemStats.js";
import { TRAIT_MAX, capMax, consAllowed, hasFreeCell, heldItems, weaponSize } from "../utils/calc.js";
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

// Governing: ADR-0023, SPEC-0009 REQ "The Pair Flag Is Refused Wherever the Data Does Not
// Permit It", REQ "Dual-Wieldability Is a Stored Attribute, Never Derived".
//
// The pair flag, as it enters loadout STATE. `d` is struck to a boolean and refused when
// the stored per-weapon attribute does not permit a pair. Absence is not permission: a
// weapon with no scraped `dualWield` record cannot be paired (the attribute is asserted
// positively by the wiki; `false`/null there is an inference from absence, never proof of
// pairability — see dualWieldFor's doc comment).
function normalizeWeaponPairFlag(w) {
  if (w === null) return null;
  if (w.d === true && dualWieldFor(WEAPONS[w.i][0]) !== true) return { ...w, d: false };
  return { ...w, d: w.d === true };
}

// Governing: ADR-0022, SPEC-0003 REQ "A Loadout's Name Is Derived From Its Weapons Until
// the User Owns It".
//
// `nameIsDerived` tracks whether the loadout's name is still auto-derived from its
// weapons — true for a fresh build, false once the user types in the name field or
// loads a saved record. It is client-only and ephemeral: not persisted, not sent to
// the server, and not part of the wire format (`toData()` never reads it). A derived
// name is stored as an ordinary string, indistinguishable from a typed one.
function weaponDisplayName(w) {
  return w ? WEAPONS[w.i][1] : null;
}

// Derive the loadout name from its weapons: "{first} and {second}", or the one
// weapon's name alone, or "" for no weapons. Never a dangling "and".
function derivedName(weapons) {
  const names = weapons.map(weaponDisplayName).filter(Boolean);
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  return `${names[0]} and ${names[1]}`;
}

const loadoutSlice = createSlice({
  name: "loadout",
  // `savedId` is client-only provenance (SPEC-0003 REQ "The Saved-Loadout Wire Format Is
  // Unchanged"): it records which stored record a loaded loadout came from, so an edited
  // save writes back to that record by id instead of matching on the name triple. It
  // MUST NOT be persisted, sent to the server inside `data`, or written into a share URL
  // — `toData()` never reads it. A new, randomized, or shared loadout has no provenance,
  // so it defaults to null.
  //
  // `nameIsDerived` starts true: a fresh build's name tracks its weapons until the user
  // takes ownership by typing.
  initialState: { ...emptyLoadout(), savedId: null, nameIsDerived: true },
  reducers: {
    addWeapon(state, action) {
      const weaponIndex = action.payload;
      const w = WEAPONS[weaponIndex];
      const slot = state.weapons[0] ? 1 : 0;
      const other = state.weapons[1 - slot] ? weaponSize(state.weapons[1 - slot]) : 0;
      if (weaponSize({ i: weaponIndex, d: false }) + other > capMax(state)) return;
      // Governing: ADR-0023, SPEC-0009 REQ "The Pair Flag Is Refused Wherever the Data Does
      // Not Permit It".
      //
      // The interactive path adds SINGLES, always — `d: false`, never read from the payload.
      // The payload here is a bare catalog index (every caller dispatches `addWeapon(i)`), so
      // there is nothing to carry a flag: a guard reading `action.payload?.d` off a number
      // could never fire, and an object payload would already have thrown at `WEAPONS[...]`
      // above. Writing `false` outright is the honest statement of what this route does.
      //
      // The pair toggle is a SEPARATE reducer (`togglePair`), with its own refusal — the
      // stored-attribute check and the capacity check both live there, not here.
      state.weapons[slot] = { i: weaponIndex, a: -1, d: false };
      // Re-derive the name only while the user has not taken ownership (SPEC-0003 REQ
      // "A Loadout's Name Is Derived From Its Weapons Until the User Owns It").
      if (state.nameIsDerived) state.name = derivedName(state.weapons);
    },
    removeWeapon(state, action) {
      state.weapons[action.payload] = null;
      if (state.nameIsDerived) state.name = derivedName(state.weapons);
    },
    // Picker placement fills the LOWEST-NUMBERED free (unblocked, empty) cell:
    // cells 0..7 in order, and `blocked` names the exact cells to skip (ADR-0009).
    setAmmo(state, action) {
      const { slot, ammoIndex } = action.payload;
      if (state.weapons[slot]) state.weapons[slot].a = ammoIndex;
    },
    // Governing: ADR-0023, SPEC-0009 REQ "The Pair Affordance Lives on the Weapon Slot",
    // REQ "The Pair Flag Is Refused Wherever the Data Does Not Permit It".
    //
    // The interactive pair toggle, driven by the slot affordance (#333). Refuses ON ITS
    // OWN — the affordance's locked state is the visible half, but this guard is the
    // enforcement, exactly as addWeapon's capMax check refuses an over-budget weapon.
    // Two independent refusals:
    //   - the stored attribute must permit the pair (dualWieldFor === true);
    //   - the paired entry's occupied size (weaponSize, the shared +1) must fit under
    //     capMax alongside the other entry.
    // The capacity guard applies ONLY when marking a pair (`!w.d`). Un-pairing only ever
    // lowers occupied capacity, so it never needs a budget check — and must NOT get one:
    // an over-capacity loadout (e.g. after Quartermaster is removed, or via a decoded
    // save) is exactly when un-pairing is the fix (issue #400).
    // Computing the cost via the shared `weaponSize({ ...w, d: true })` keeps this route
    // and the affordance's enabled state unable to disagree about what a pair costs.
    // `setLoadout` does NOT enforce capacity — for pairs or singles — so this is the one
    // place an interactive write is budget-checked.
    togglePair(state, action) {
      const slot = action.payload;
      const w = state.weapons[slot];
      if (!w || dualWieldFor(WEAPONS[w.i][0]) !== true) return;
      if (!w.d && weaponSize({ ...w, d: true }) + weaponSize(state.weapons[1 - slot] || null) > capMax(state)) return;
      state.weapons[slot] = { ...w, d: !w.d };
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
    //
    // Governing: issue #352. The source cell MUST be occupied — a move from an empty
    // cell is not a permutation and used to duplicate the destination item into both
    // cells (`moving` bound to `equip[to]`, then both assigned it). The guard is
    // stated once, here, so the reducer and the grab-ref lifetime cannot disagree
    // about whether a move is real.
    moveEquip(state, action) {
      const { from, to } = action.payload;
      if (from === to) return;
      // Dragged off the grid unequips: the drop handler passes `to: -1` (or null)
      // for a release outside any cell (SPEC-0006 "dragged off the grid").
      if (to === null || to === -1) {
        if (from < 0 || from >= 8 || state.equip[from] === null) return;
        state.equip[from] = null;
        return;
      }
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= 8 || to < 0 || to >= 8) return;
      if (state.blocked.includes(from) || state.blocked.includes(to)) return;
      // The source must be occupied — a move from an empty cell is not a permutation.
      // This guard replaces the dead `moving === null` check below, which could never
      // fire because `moving` was read from the destination when `from` was empty.
      if (state.equip[from] === null) return;
      // Dropping onto an empty cell moves the item; dropping onto an occupied cell
      // swaps the two. Both are permutations — the set of equipped items is unchanged.
      const moving = state.equip[from];
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
    // Governing: ADR-0022, SPEC-0003 REQ "A Loadout's Name Is Derived From Its Weapons
    // Until the User Owns It". Typing in the name field takes ownership: once false,
    // `nameIsDerived` stays false for the rest of the editing session — no later weapon
    // change re-derives. It returns to true only via `clearBuild` or a `setLoadout`
    // that starts a fresh build. Even clearing the field is an act of ownership.
    setName(state, action) {
      state.name = action.payload;
      state.nameIsDerived = false;
    },
    // Governing: ADR-0022, SPEC-0003 REQ "Loadout Identity Is Scoped to Its List" —
    // set after a successful save so the loadout becomes "loaded" and subsequent saves
    // address the record by id. Dispatched from `saveCurrent` on fulfilment.
    setSavedId(state, action) {
      state.savedId = action.payload;
    },
    // Governing: ADR-0022, SPEC-0003 REQ "A Loadout's Name Is Derived From Its Weapons
    // Until the User Owns It". Clearing the build resets to a fresh state: the name
    // re-derives (back to ""), and `nameIsDerived` returns to true.
    clearBuild(state) {
      state.weapons = [null, null];
      state.equip = Array(8).fill(null);
      state.traits = [];
      state.blocked = [];
      state.name = "";
      state.nameIsDerived = true;
    },
    // Bulk merge — used by hydrate-on-load, loading a saved build, and randomize.
    // Rejects payloads that don't match the loadout shape so a bad call fails
    // loudly at the source instead of silently corrupting derived math later.
    setLoadout(state, action) {
      const payload = action.payload;
      if (!isValidLoadoutShape(payload)) {
        throw new Error("setLoadout: payload does not match the expected loadout shape");
      }
      state.weapons = payload.weapons.map(normalizeWeaponPairFlag);
      state.equip = payload.equip;
      state.traits = payload.traits;
      state.blocked = payload.blocked ?? state.blocked;
      state.name = payload.name ?? state.name;
      // `?? null` so any payload that does not carry a savedId CLEARS it — a new,
      // randomized, or shared loadout must never inherit the previous one's provenance
      // (SPEC-0003 REQ "The Saved-Loadout Wire Format Is Unchanged").
      state.savedId = payload.savedId ?? null;
      // Governing: ADR-0022, SPEC-0003 REQ "A Loadout's Name Is Derived From Its Weapons
      // Until the User Owns It". Derive only for a payload that brought no name of its
      // own. Two signals, and BOTH are needed:
      //
      //   - `savedId` — a loadout loaded from a saved record has a name the user owns.
      //   - `name` — the payload carried a name, so there is nothing to default.
      //
      // `savedId` alone is not enough, because two of this reducer's three callers are
      // hydration paths that carry a name and no id. `readStoredLoadout()` returns the
      // local draft the store subscriber persists on every change (store/index.js), and
      // `readHashLoadout()` returns a decoded share URL; `n` is in the wire format and
      // every decoder sets it. Deriving over those overwrites a name the user typed —
      // silently, on every page reload. ADR-0022 leaves reload persistence explicitly
      // out of scope, so this resolves it the non-destructive way.
      //
      // Randomize is unaffected: `randomizeLoadout()` returns { weapons, equip, traits }
      // with no `name` at all, which `isValidLoadoutShape` above records as deliberate.
      // It still derives, as does any hydrated payload whose stored name was empty.
      //
      // This does mean a share URL's name survives for the recipient, where ADR-0022
      // says a shared loadout "derives freely". That line reads as an oversight rather
      // than an intent — the wire format carries `n` precisely so a name travels, and
      // deriving over it would make the field dead weight on the receiving end.
      //
      // When derived, re-derive from the weapons the payload just set: randomize and
      // hydration replace weapons without going through addWeapon/removeWeapon, so the
      // derivation has to happen here too.
      state.nameIsDerived = !payload.savedId && !payload.name;
      if (state.nameIsDerived) state.name = derivedName(state.weapons);
    },
  },
});

export const loadoutActions = loadoutSlice.actions;
export default loadoutSlice.reducer;
