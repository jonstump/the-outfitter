import { useDispatch, useSelector } from "react-redux";
import { TRAITS } from "../../data/catalog.js";
import { loadoutActions } from "../../store/loadoutSlice.js";

export default function TraitsPanel() {
  const dispatch = useDispatch();
  const traits = useSelector((s) => s.loadout.traits);

  return (
    <div className="panel">
      <div className="panel-title">Traits</div>
      {traits.length === 0 && (
        <div className="empty-note" style={{ marginTop: 8 }}>
          None taken — pick from the ledger.
        </div>
      )}
      <div className="trait-chips">
        {traits.map((i) => (
          <button
            key={i}
            className="trait-chip"
            title="Remove"
            onClick={() => dispatch(loadoutActions.removeTrait(i))}
          >
            <span>{TRAITS[i][0]}</span>
            <span className="trait-chip-up">{TRAITS[i][1]} UP</span>
          </button>
        ))}
      </div>
    </div>
  );
}
