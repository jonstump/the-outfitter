import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { loadoutActions } from "../../store/loadoutSlice.js";
import { uiActions } from "../../store/uiSlice.js";
import { saveCurrent, saveCurrentAsNew } from "../../store/savedLoadoutsSlice.js";
import { randomizeThunk, clearBuildThunk, copyCodeThunk, importCodeThunk } from "../../store/thunks.js";
import { selectSaveDestinationName, selectShareCode, selectTotalCost, selectUpTotal } from "../../store/selectors.js";

export default function ActionsPanel() {
  const dispatch = useDispatch();
  const name = useSelector((s) => s.loadout.name);
  const savedId = useSelector((s) => s.loadout.savedId);
  const total = useSelector(selectTotalCost);
  const up = useSelector(selectUpTotal);
  const shareCode = useSelector(selectShareCode);
  const ui = useSelector((s) => s.ui);
  // Governing: item 4 of the 2026-08-16 feedback batch ("I want to use share codes").
  // Local, not Redux — this is a draft the user is typing/pasting, not a fact about the
  // build, the same reasoning `CreateList`'s `name` field (LoadoutListsPanel.jsx) already
  // uses for its own draft input.
  const [pasteValue, setPasteValue] = useState("");
  const loadFromPaste = () => {
    const ok = dispatch(importCodeThunk(pasteValue));
    if (ok) setPasteValue("");
  };
  // Governing: SPEC-0003 REQ "The Selected List Is Client State".
  //
  // Where the next save lands, named on the control that does it (issue #136). This used to
  // be announced by a badge at the top of the loadout-lists panel, which was styled as a
  // button, was not one, and stated the destination nowhere near the moment of action —
  // a user could easily have scrolled it off screen before pressing Save.
  //
  // null means Unassigned, which is stated rather than left blank: "Save" alone is what made
  // the filing behaviour undiscoverable in the first place, and Unassigned is a real
  // destination the user can deliberately choose (by closing every list), not an absence.
  const destination = useSelector(selectSaveDestinationName);

  const overBudget = ui.budgetOn && total > ui.budget;
  const overUp = ui.upBudgetOn && up > ui.upBudget;
  const budgetLabelColor = overBudget ? "#c96b5b" : "#e6d9ba";
  const upLabelColor = overUp ? "#c96b5b" : "#e6d9ba";

  // Governing: SPEC-0001 REQ "Accessibility Requirements" (Dynamic Content Regions).
  //
  // `ui.message` carries save/delete/fetch/share feedback, with a leading "!" marking a
  // failure (set by savedLoadoutsSlice.js and thunks.js). Both regions below stay mounted
  // permanently instead of rendering one node only when there's a message: a live region
  // has to already be in the accessibility tree when its text changes, and inserting the
  // region together with its content is the standard way to get silence from a screen
  // reader. Politeness is fixed per node rather than swapped on one node, because changing
  // aria-live after mount is unreliable across assistive tech — failures go to the
  // assertive region (a failed save shouldn't wait behind other speech), everything else
  // to the polite one. `.share-message:empty` in global.css collapses the flex gap the
  // idle regions would otherwise add to the panel.
  const isError = ui.message.startsWith("!");
  const messageText = ui.message.replace(/^!/, "");

  return (
    <div className="panel" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="actions-row">
        <button className="btn-primary" style={{ flex: 1, minWidth: 150 }} onClick={() => dispatch(randomizeThunk())}>
          Random loadout
        </button>
        <button className="btn" onClick={() => dispatch(clearBuildThunk())}>
          Clear
        </button>
      </div>

      <div className="budget-row">
        <span className="budget-group">
          <button
            className={`toggle-btn${ui.budgetOn ? " on" : ""}`}
            onClick={() => dispatch(uiActions.toggleBudgetOn())}
          >
            Budget {ui.budgetOn ? "ON" : "OFF"}
          </button>
          {ui.budgetOn && (
            <span className="budget-input-wrap">
              <span style={{ color: budgetLabelColor, fontSize: 16.5 }}>$</span>
              <input
                type="number"
                min="0"
                step="25"
                className="number-input"
                style={{ width: 80, color: budgetLabelColor }}
                value={ui.budget}
                onChange={(e) => dispatch(uiActions.setBudget(parseInt(e.target.value, 10) || 0))}
              />
            </span>
          )}
        </span>
        <span className="budget-group">
          <button
            className={`toggle-btn${ui.upBudgetOn ? " on" : ""}`}
            onClick={() => dispatch(uiActions.toggleUpBudgetOn())}
          >
            Trait cap {ui.upBudgetOn ? "ON" : "OFF"}
          </button>
          {ui.upBudgetOn && (
            <span className="budget-input-wrap">
              {/* No "UP" suffix — the toggle immediately to the left already says "Trait cap",
                  the same reasoning that took the suffix off the header stat (issue #66) and the
                  trait-cell hover. The dollar group keeps its "$" because "Budget" alone doesn't
                  name a currency; "Trait cap" names its own unit. The accessible name carries
                  the unit in words, where a bare number would be read out meaningless. */}
              <input
                type="number"
                min="0"
                step="1"
                className="number-input"
                aria-label="Trait point cap"
                style={{ width: 60, color: upLabelColor }}
                value={ui.upBudget}
                onChange={(e) => dispatch(uiActions.setUpBudget(parseInt(e.target.value, 10) || 0))}
              />
            </span>
          )}
        </span>
      </div>

      <div className="save-row">
        <input
          className="text-input"
          style={{ flex: 1, minWidth: 160 }}
          value={name}
          placeholder="Name this loadout…"
          onChange={(e) => dispatch(loadoutActions.setName(e.target.value))}
        />
        {/* The destination is part of the button's TEXT, not a title or an aria-label beside
            a bare "Save". A sighted user and a screen-reader user get the same sentence, and
            WCAG 2.5.3 (Label in Name) holds by construction because there is only one string.
            `.save-dest` bounds a long list name with an ellipsis visually while the accessible
            name stays whole — 2.5.3 asks the name to contain the visible label, and a truncated
            label is contained in the full one. */}
        <button className="btn-gold" onClick={() => dispatch(saveCurrent())}>
          Save to <span className="save-dest">{destination ?? "Unassigned"}</span>
        </button>
        {/* Governing: ADR-0022 "The exception, and what it costs" — visible only once there is
            a loaded record to diverge FROM. With no `savedId`, Save already upserts on
            (owner, listId, name) — the same thing this button does — so showing both would be
            two controls for one action (issue #136's follow-up, "a distinct way to save a
            loadout vs saving it as a new one"). */}
        {savedId && (
          <button className="btn-outline" onClick={() => dispatch(saveCurrentAsNew())}>
            Save as new
          </button>
        )}
      </div>

      {/* Governing: item 4 of the 2026-08-16 feedback batch ("I want to use share codes").
          Both directions — view/copy your own build's code, or paste someone else's — sit
          under one visible "Loadout Code" heading, matching this app's own vocabulary
          ("loadout" is the noun used everywhere else) rather than the generic "Copy code"
          wording. There used to be a "Share link" button that wrapped this same payload in
          a URL; it was removed outright rather than kept alongside this (the app has no
          live users yet, so there was nothing an old shared link needed to keep working
          for — see loadoutCodec.js's `decodeShareCode` for the fuller note). */}
      <div className="code-section-label">Loadout Code</div>

      {/* Export: always visible and live-computed from the current build (no button press
          needed to generate it) so a clipboard failure is never a dead end — the code is
          already on screen, selectable by hand, the moment there is one. `readOnly` rather
          than disabled: a disabled input cannot be focused or have its text selected, which
          would defeat the point of showing it. */}
      <div className="code-row">
        <input
          className="text-input code-field"
          style={{ flex: 1, minWidth: 160 }}
          value={shareCode}
          readOnly
          aria-label="Your loadout code"
          onFocus={(e) => e.target.select()}
        />
        <button className="btn-outline" onClick={() => dispatch(copyCodeThunk())}>
          Copy
        </button>
      </div>

      {/* Import: paste a code (or an old share link's URL, or just its "#L=..." fragment —
          extractShareCode accepts all three) and load it as the current build, live,
          without navigating anywhere. */}
      <div className="code-row">
        <input
          className="text-input"
          style={{ flex: 1, minWidth: 160 }}
          value={pasteValue}
          placeholder="Paste a loadout code…"
          aria-label="Paste a loadout code to load it"
          onChange={(e) => setPasteValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") loadFromPaste();
          }}
        />
        <button className="btn-outline" onClick={loadFromPaste} disabled={!pasteValue.trim()}>
          Load
        </button>
      </div>

      <div className="share-message error" role="alert" aria-live="assertive" aria-atomic="true">
        {isError ? messageText : ""}
      </div>
      <div className="share-message" role="status" aria-live="polite" aria-atomic="true">
        {isError ? "" : messageText}
      </div>
    </div>
  );
}
