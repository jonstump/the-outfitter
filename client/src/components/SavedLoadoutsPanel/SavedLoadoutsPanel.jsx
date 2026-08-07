import { useDispatch, useSelector } from "react-redux";
import { totalCost } from "../../utils/calc.js";
import { fromData } from "../../utils/loadoutCodec.js";
import { loadSavedThunk } from "../../store/thunks.js";
import { deleteSaved } from "../../store/savedLoadoutsSlice.js";

export default function SavedLoadoutsPanel() {
  const dispatch = useDispatch();
  const items = useSelector((s) => s.savedLoadouts.items);

  if (items.length === 0) return null;

  return (
    <div className="panel">
      <div className="panel-title">Saved loadouts</div>
      <div className="saved-list">
        {items.map((item) => (
          <div key={item.id} className="saved-row">
            <button className="saved-row-name" onClick={() => dispatch(loadSavedThunk(item))}>
              {item.name}
            </button>
            <span className="saved-row-cost">${totalCost(fromData(item.data))}</span>
            <button className="icon-btn" onClick={() => dispatch(deleteSaved(item.id))}>
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
