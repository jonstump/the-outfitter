import { useDispatch, useSelector } from "react-redux";
import { TRAITS, traitThumb } from "../../data/catalog.js";
import { loadoutActions } from "../../store/loadoutSlice.js";
import ItemThumb from "../ItemThumb/ItemThumb.jsx";

// Governing: ADR-0002 (Source Weapon/Equipment Images from huntshowdown.wiki.gg via a One-Time,
// Self-Hosted Scrape)
// Implements: SPEC-0001 REQ "Image Coverage Across All Catalog Categories, with Fallback",
// SPEC-0001 REQ "Consistent Visual Presentation"

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
        {traits.map((id) => {
          const trait = TRAITS.find((t) => t[0] === id);
          if (!trait) return null;
          return (
            <button
              key={id}
              className="trait-chip"
              title="Remove"
              onClick={() => dispatch(loadoutActions.removeTrait(id))}
            >
              <ItemThumb category="traits" name={trait[1]} svgPath={traitThumb(trait)} className="trait-thumb" />
              <span>{trait[1]}</span>
              <span className="trait-chip-up">{trait[2]} UP</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
