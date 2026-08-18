import { TRAITS } from "../data/catalog.js";
import { totalCost, upTotal } from "../utils/calc.js";
import { decodeShareCode, encodeShareCode, extractShareCode, fromData } from "../utils/loadoutCodec.js";
import { randomizeLoadout } from "../utils/randomize.js";
import { loadoutActions } from "./loadoutSlice.js";
import { uiActions } from "./uiSlice.js";

export function randomizeThunk() {
  return (dispatch, getState) => {
    const { loadout, ui } = getState();
    const result = randomizeLoadout({
      // Blocked cells travel as their own array (ADR-0009, SPEC-0006 REQ "Cells Are
      // Individually Blockable"); the generator respects them and keeps them holes.
      blocked: loadout.blocked,
      budgetOn: ui.budgetOn,
      budget: ui.budget,
      upBudgetOn: ui.upBudgetOn,
      upBudget: ui.upBudget,
    });
    dispatch(loadoutActions.setLoadout(result));
    // Governing: SPEC-0008, issue #380. Related: #211, #208.
    // When budgetOn, randomizeLoadout retries a bounded number of uniform draws and
    // falls back to the cheapest one it saw if none landed at or under budget — it
    // never reports that fallback happened. Without this, a miss looks identical to
    // any other result: the total merely recolors red, with nothing to tell the player
    // a retry would very likely land in budget. Disclose the miss here instead of
    // unconditionally clearing the banner; a subsequent in-budget (or budget-off)
    // press clears it again.
    if (ui.budgetOn && totalCost(result) > ui.budget) {
      dispatch(
        uiActions.setMessage(
          "No in-budget build found after several tries — this is the cheapest of the bunch. Press Randomize again for another shot."
        )
      );
    } else {
      dispatch(uiActions.setMessage(""));
    }
  };
}

export function clearBuildThunk() {
  return (dispatch) => {
    dispatch(loadoutActions.clearBuild());
    dispatch(uiActions.setMessage(""));
  };
}

// Traits have a cross-slice legality check (the UP budget lives in `ui`), so this
// stays a thunk rather than a plain reducer — mirrors the original's picker-side `ok` guard.
// Traits are stored by stable catalog id (see catalog.js), resolved through the index
// action.payload carries (Picker already looks the entry up by array position).
export function addTraitIfAllowed(index) {
  return (dispatch, getState) => {
    const { loadout, ui } = getState();
    const trait = TRAITS[index];
    if (!trait) return;
    if (loadout.traits.includes(trait[0])) return;
    if (ui.upBudgetOn && upTotal(loadout) + trait[2] > ui.upBudget) return;
    dispatch(loadoutActions.addTrait(trait[0]));
  };
}

export function loadSavedThunk(record) {
  return (dispatch) => {
    // Governing: ADR-0022, SPEC-0003 REQ "Loadout Identity Is Scoped to Its List" —
    // carry the record's id as `savedId` so a subsequent save addresses this record
    // instead of matching on the name triple. `fromData` decodes the wire payload and
    // knows nothing about record ids; the id is attached alongside its result.
    const decoded = fromData(record.data);
    dispatch(loadoutActions.setLoadout({ ...decoded, savedId: record.id }));
    // Governing: issue #359. Surface a notice when decode dropped an ammo selection
    // that was valid when the record was saved but no longer resolves.
    if (decoded.decodeNotices?.some((n) => n.kind === "ammo-dropped")) {
      dispatch(uiActions.setMessage(`Loaded “${record.name}”. This build's ammo selection is no longer available.`));
    } else {
      dispatch(uiActions.setMessage(`Loaded “${record.name}”.`));
    }
  };
}

// Governing: item 4 of the 2026-08-16 feedback batch ("I want to use share codes"). This
// used to sit alongside a `shareThunk` that copied the same payload wrapped in a URL — the
// share-LINK feature was removed outright (the app has no live users yet, so there was
// nothing an old shared link needed to keep working for; see loadoutCodec.js's
// `decodeShareCode` for the fuller note). ActionsPanel also renders this code in a plain,
// always-visible, read-only field (computed the same way, via `encodeShareCode`), so a
// clipboard failure here is an inconvenience, not a dead end: the code is already on
// screen and selectable by hand either way, which is why the fallback message below points
// at it — there is no address bar to point at for a bare code that never touches a URL.
export function copyCodeThunk() {
  return (dispatch, getState) => {
    const { loadout } = getState();
    let code;
    try {
      code = encodeShareCode(loadout);
    } catch {
      dispatch(uiActions.setMessage("Could not generate a share code for this loadout."));
      return;
    }
    const done = () => dispatch(uiActions.setMessage("Share code copied to clipboard."));
    const fallback = () =>
      dispatch(uiActions.setMessage("Couldn't copy automatically — select the code below and copy it."));
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(done, fallback);
    } else {
      fallback();
    }
  };
}

// Governing: item 4 of the 2026-08-16 feedback batch, ADR-0024 (the decoder's contract is
// "produce a loadable loadout, not a legal one"). `rawInput` is whatever the user pasted —
// a bare code, a full share URL, or just its "#L=..." fragment — and `extractShareCode`
// (loadoutCodec.js) is what accepts all three rather than demanding the user strip a URL
// down to the code themselves.
//
// Two distinct failure messages, not one generic "couldn't load": "that doesn't look like
// a code" (extraction found nothing code-shaped) and "couldn't load that code" (it looked
// like a code but didn't decode) are different problems with different fixes on the user's
// end — mistyped/wrong paste versus a genuinely corrupted or foreign-format string — and
// collapsing them loses the one piece of information that tells the user which.
//
// A successful decode replaces the CURRENT build, the same way the now-removed share-link
// feature once did on page load (`App.jsx`'s mount effect used to try `readHashLoadout()`
// first) — this is the same kind of load, triggered from a paste instead of a URL, so it
// carries no `savedId`: the decoded loadout is a fresh, never-saved build.
// Returns `true` on a successful load and `false` on either failure, so the paste field
// that calls this (ActionsPanel) can decide whether to clear itself — cleared on success,
// left in place on failure so the user can see what they actually pasted alongside the
// error message explaining why it didn't work.
export function importCodeThunk(rawInput) {
  return (dispatch) => {
    const code = extractShareCode(rawInput);
    if (!code) {
      dispatch(uiActions.setMessage("!That doesn't look like a share code."));
      return false;
    }
    const decoded = decodeShareCode(code);
    if (!decoded) {
      dispatch(
        uiActions.setMessage("!Couldn't load that code — it may be corrupted or from a version this app no longer reads.")
      );
      return false;
    }
    dispatch(loadoutActions.setLoadout(decoded));
    // Governing: issue #359, mirrored from loadSavedThunk's identical notice.
    if (decoded.decodeNotices?.some((n) => n.kind === "ammo-dropped")) {
      dispatch(uiActions.setMessage("Loaded from code. This build's ammo selection is no longer available."));
    } else {
      dispatch(uiActions.setMessage("Loaded from code."));
    }
    return true;
  };
}
