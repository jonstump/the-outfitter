import { useDispatch, useSelector } from "react-redux";
import { TRAITS, traitThumb } from "../../data/catalog.js";
import { loadoutActions } from "../../store/loadoutSlice.js";
import { TRAIT_MAX } from "../../utils/calc.js";
import ItemThumb from "../ItemThumb/ItemThumb.jsx";

// Governing: ADR-0002 (Source Weapon/Equipment Images from huntshowdown.wiki.gg via a One-Time,
// Self-Hosted Scrape), ADR-0012 (fifteen-trait cap)
// Implements: SPEC-0001 REQ "Image Coverage Across All Catalog Categories, with Fallback",
// SPEC-0001 REQ "Consistent Visual Presentation"
//
// The panel draws a FIXED fifteen-cell grid, five across, rather than a chip per trait.
//
// Fifteen is the cap ADR-0012 enforces, and the grid is deliberately the same shape the saved
// loadout preview already draws (`.ll-lp-traits`) — SPEC-0003 REQ "Filed Loadouts Preview Their
// Contents" says the preview's "categories SHALL match the builder's grouping and cell counts,
// so a loadout is read the same way in a list as in the panel that produced it". Until now the
// preview had the grid and the builder had chips, so that parity was one-sided. This closes it
// from the builder's end.
//
// The cell count does NOT derive from the trait-point budget. That budget is user-settable and
// off by default, so deriving from it would reflow the grid when a setting changed — the same
// reasoning the preview's CSS already records.

/** Empty cells are drawn, not omitted: the grid's shape is the point, so it never reflows. */
function EmptyCell() {
  return <span className="trait-cell trait-cell-empty" aria-hidden="true" />;
}

function TraitCell({ trait, onRemove }) {
  const [id, name, up] = trait;
  // The tooltip is decorative duplication — the button's accessible name carries the same
  // facts, so a screen reader never depends on a hover surface it cannot reach.
  const label = `${name}, ${up} upgrade point${up === 1 ? "" : "s"}. Activate to remove.`;
  return (
    <button
      type="button"
      className="trait-cell trait-cell-filled"
      aria-label={label}
      onClick={() => onRemove(id)}
    >
      <ItemThumb category="traits" name={name} alt="" svgPath={traitThumb(trait)} className="trait-cell-thumb" />
      <span className="trait-cell-up" aria-hidden="true">
        {up}
      </span>
      <span className="trait-cell-tip" aria-hidden="true">
        <span className="trait-cell-tip-name">{name}</span>
        <span className="trait-cell-tip-up">{up} UP</span>
      </span>
    </button>
  );
}

export default function TraitsPanel() {
  const dispatch = useDispatch();
  const traits = useSelector((s) => s.loadout.traits);
  const remove = (id) => dispatch(loadoutActions.removeTrait(id));

  const resolved = traits.map((id) => TRAITS.find((t) => t[0] === id)).filter(Boolean);
  const cells = Array.from({ length: TRAIT_MAX }, (_, i) => resolved[i] ?? null);

  return (
    <div className="panel">
      <div className="panel-title">Traits</div>
      {resolved.length === 0 && (
        <div className="empty-note" style={{ marginTop: 8 }}>
          None taken — pick from the ledger.
        </div>
      )}
      {/* `role="group"` rather than a list: every filled cell is a button, and wrapping each in
          a listitem put a bare span between the grid and its cell — which made filled and empty
          cells size differently, since only one of them was the grid item. Both are direct
          children here, so one rule sizes both. */}
      <div className="trait-grid" role="group" aria-label={`Traits, ${resolved.length} of ${TRAIT_MAX}`}>
        {cells.map((trait, slot) =>
          trait ? (
            <TraitCell key={trait[0]} trait={trait} onRemove={remove} />
          ) : (
            <EmptyCell key={`empty-${slot}`} />
          )
        )}
      </div>
    </div>
  );
}
