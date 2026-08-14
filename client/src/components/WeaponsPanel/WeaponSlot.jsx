import { useDispatch, useSelector } from "react-redux";
import { useMemo, useState } from "react";
import { AMMO, AMMO_LABEL, WEAPONS, weaponThumb } from "../../data/catalog.js";
import { dualWieldFor } from "../../data/itemStats.js";
import { selectWeaponSlot } from "../../store/selectors.js";
import { loadoutActions } from "../../store/loadoutSlice.js";
import { capMax, capUsed } from "../../utils/calc.js";
import ItemThumb from "../ItemThumb/ItemThumb.jsx";

// Governing: ADR-0002 (Source Weapon/Equipment Images from huntshowdown.wiki.gg via a One-Time,
// Self-Hosted Scrape)
// Implements: SPEC-0001 REQ "Image Coverage Across All Catalog Categories, with Fallback",
// SPEC-0001 REQ "Consistent Visual Presentation"

export default function WeaponSlot({ slot }) {
  const dispatch = useDispatch();
  // selectWeaponSlot is a selector factory; memoize the instance so its
  // createSelector cache survives re-renders (issue #24/#25).
  const w = useSelector(useMemo(() => selectWeaponSlot(slot), [slot]));
  // ALL hooks run before the early return below — an empty slot must not change the
  // hook order React sees (Rules of Hooks), so the live-region state and the whole
  // loadout are selected unconditionally.
  const [announced, setAnnounced] = useState("");
  const l = useSelector((s) => s.loadout);

  if (!w) {
    return (
      <div className="weapon-slot empty-slot">
        <div className="empty-note">
          {slot === 0 ? "Primary — pick from the armory" : "Secondary — pick from the armory"}
        </div>
      </div>
    );
  }

  const def = WEAPONS[w.i];
  const variants = AMMO[def[4]] || [];
  // Governing: issue #201. `w.a` arrives from a decoded share link or from localStorage, and
  // an index past the end of this weapon's variant list used to be read unguarded — one
  // `undefined[1]` here throws during render, and React unmounts the whole tree, so the
  // symptom is a blank page rather than a wrong price. The decoder bounds the value now;
  // this resolves it to an object instead of asserting one, so a future decode bug degrades
  // to "Standard" rather than back to a white screen.
  const variant = w.a >= 0 ? variants[w.a] : null;
  const ammoCost = variant ? variant[1] : 0;

  // Governing: ADR-0023, SPEC-0009 REQ "The Pair Affordance Lives on the Weapon Slot".
  //
  // The affordance exists ONLY for a weapon the stored per-weapon attribute marks
  // dual-wieldable — read from itemStats.json, never derived from size/name/ammo. It is
  // one of three states, and the accessible name (aria-label) distinguishes them so a
  // screen reader user can tell available from locked without seeing the tile:
  //   - available (d: false, budget has room)  -> activating marks the pair
  //   - locked   (d: false, budget has no room) -> disabled, stays in the a11y tree
  //   - paired   (d: true)                      -> activating returns to a single
  const pairable = dualWieldFor(def[0]) === true;
  // The whole loadout is needed here for the OTHER slot's occupied size, so it is
  // selected directly rather than threaded through a slot-scoped selector.
  const used = capUsed(l);
  const max = capMax(l);
  // The single is ALREADY counted in `used`, so a pair costs only the MARGINAL extra
  // point: it is affordable when used + 1 <= max. This is the delta that decides the
  // locked vs available state; the reducer's toggle refuses using the shared weaponSize
  // cost, so the two routes cannot disagree about what a pair costs (SPEC-0009).
  const pairFits = used + 1 <= max;
  const isPair = w.d === true;
  const pairLocked = pairable && !isPair && !pairFits;
  const pairState = pairable ? (isPair ? "paired" : pairLocked ? "locked" : "available") : null;
  const pairLabel =
    pairState === "paired"
      ? `Unpair ${def[1]}`
      : pairState === "locked"
        ? `Dual-wield ${def[1]} — not enough budget`
        : `Dual-wield ${def[1]}`;

  return (
    <div className="weapon-slot filled-slot">
      <div className="weapon-slot-row">
        <div className="weapon-slot-main">
          <ItemThumb category="weapons" name={def[1]} svgPath={weaponThumb(def)} className="weapon-thumb" />
          <div>
            <div className="weapon-name">{def[1]}</div>
            <div className="weapon-meta">
              Size {def[2]} · {AMMO_LABEL[def[4]]}
              {variant ? ` · ${variant[0]}` : ""}
            </div>
          </div>
          {pairState && (
            <div className="pair-row">
              {/* The ghosted second copy: rendered beside the real tile whenever the
                  affordance exists. In the locked state it carries the locked styling
                  and the control exposes disabled programmatically while staying in
                  the accessibility tree (never display:none). */}
              <button
                type="button"
                className={`pair-toggle ${pairState}`}
                aria-label={pairLabel}
                disabled={pairState === "locked"}
                onClick={() => {
                  dispatch(loadoutActions.togglePair(slot));
                  if (pairState === "available") setAnnounced(`Dual-wielding ${def[1]}.`);
                  else if (pairState === "paired") setAnnounced(`${def[1]} is no longer dual-wielded.`);
                }}
              >
                <span className="pair-single">×1</span>
                <span className="pair-ghost">×2</span>
              </button>
            </div>
          )}
        </div>
        <div className="weapon-slot-side">
          <button className="icon-btn" onClick={() => dispatch(loadoutActions.removeWeapon(slot))}>
            ✕
          </button>
          <div className="weapon-cost">${def[3] + ammoCost}</div>
        </div>
      </div>
      {variants.length > 0 && (
        <div className="ammo-row">
          <span className="panel-meta">AMMO</span>
          {/* `.select-sm` — the dense step of the control scale (issue #134). The inline
              `fontSize: 15.5` this replaces was a local patch over the bare element rule, and
              is exactly the kind of per-site size override the scale exists to retire; only
              the WIDTH stays inline, because it is this slot's layout and nobody else's. */}
          <select
            className="select-sm"
            // An unresolved index has no <option> to match, which renders the control blank
            // and offers no way back; show what the loadout actually costs — Standard.
            value={String(variant ? w.a : -1)}
            onChange={(e) =>
              dispatch(loadoutActions.setAmmo({ slot, ammoIndex: parseInt(e.target.value, 10) }))
            }
            style={{ flex: 1, maxWidth: 260 }}
          >
            <option value="-1">Standard</option>
            {variants.map((v, idx) => (
              <option key={idx} value={String(idx)}>
                {v[0]} (+${v[1]})
              </option>
            ))}
          </select>
        </div>
      )}
      {/* Live region: capacity changes from pairing/unpairing are announced to assistive
          tech (SPEC-0009 "Operable and Named in Every State"). Rendered permanently —
          inserting a live region together with its content is the way to get silence from
          a screen reader (same pattern as ActionsPanel.jsx). */}
      <div className="sr-only pair-live-region" role="status" aria-live="polite" aria-atomic="true">
        {announced}
      </div>
    </div>
  );
}
