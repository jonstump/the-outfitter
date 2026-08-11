import { useDispatch } from "react-redux";
import { randomizeThunk, clearBuildThunk } from "../../store/thunks.js";

// Governing: ADR-0010 (Generate Random Loadouts from Weighted Archetypes with an Injectable RNG)
//
// Split out of ActionsPanel so it can sit beside the traits grid rather than under it. The
// split is along a real seam: generating a build and clearing one are both "make the loadout
// something else in one press", while the budget toggles, the name field and Share link are
// about a build that already exists. Those stayed behind.
//
// The panel is deliberately roomier than its two buttons need. SPEC-0008 replaces the
// generator with archetype-driven selection, and an archetype control has to live somewhere;
// provisioning the space now means that lands as an addition rather than as another layout
// argument.

export default function RandomizerPanel() {
  const dispatch = useDispatch();

  return (
    <div className="panel randomizer-panel">
      <div className="panel-title">Randomize</div>
      <div className="randomizer-actions">
        <button className="btn-primary randomizer-go" onClick={() => dispatch(randomizeThunk())}>
          Random loadout
        </button>
        <button className="btn" onClick={() => dispatch(clearBuildThunk())}>
          Clear
        </button>
      </div>
    </div>
  );
}
