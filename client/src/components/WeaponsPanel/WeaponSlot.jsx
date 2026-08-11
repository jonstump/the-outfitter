import { useDispatch, useSelector } from "react-redux";
import { useMemo } from "react";
import { AMMO, AMMO_LABEL, WEAPONS, weaponThumb } from "../../data/catalog.js";
import { selectWeaponSlot } from "../../store/selectors.js";
import { loadoutActions } from "../../store/loadoutSlice.js";
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
  const variants = AMMO[def[4]];
  const ammoCost = w.a >= 0 ? variants[w.a][1] : 0;

  return (
    <div className="weapon-slot filled-slot">
      <div className="weapon-slot-row">
        <div className="weapon-slot-main">
          <ItemThumb category="weapons" name={def[1]} svgPath={weaponThumb(def)} className="weapon-thumb" />
          <div>
            <div className="weapon-name">{def[1]}</div>
            <div className="weapon-meta">
              Size {def[2]} · {AMMO_LABEL[def[4]]}
              {w.a >= 0 ? ` · ${variants[w.a][0]}` : ""}
            </div>
          </div>
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
            value={String(w.a)}
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
    </div>
  );
}
