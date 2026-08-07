import { useDispatch, useSelector } from "react-redux";
import { AMMO, AMMO_LABEL, WEAPONS, weaponThumb } from "../../data/catalog.js";
import { loadoutActions } from "../../store/loadoutSlice.js";

export default function WeaponSlot({ slot }) {
  const dispatch = useDispatch();
  const w = useSelector((s) => s.loadout.weapons[slot]);

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
  const variants = AMMO[def[3]];
  const ammoCost = w.a >= 0 ? variants[w.a][1] : 0;

  return (
    <div className="weapon-slot filled-slot">
      <div className="weapon-slot-row">
        <div className="weapon-slot-main">
          <svg viewBox="0 0 96 40" className="weapon-thumb">
            <path d={weaponThumb(def)} fill="#8a6f42" />
          </svg>
          <div>
            <div className="weapon-name">{def[0]}</div>
            <div className="weapon-meta">
              Size {def[1]} · {AMMO_LABEL[def[3]]}
              {w.a >= 0 ? ` · ${variants[w.a][0]}` : ""}
            </div>
          </div>
        </div>
        <div className="weapon-slot-side">
          <button className="icon-btn" onClick={() => dispatch(loadoutActions.removeWeapon(slot))}>
            ✕
          </button>
          <div className="weapon-cost">${def[2] + ammoCost}</div>
        </div>
      </div>
      {variants.length > 0 && (
        <div className="ammo-row">
          <span className="panel-meta">AMMO</span>
          <select
            value={String(w.a)}
            onChange={(e) =>
              dispatch(loadoutActions.setAmmo({ slot, ammoIndex: parseInt(e.target.value, 10) }))
            }
            style={{ flex: 1, maxWidth: 260, fontSize: 14 }}
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
