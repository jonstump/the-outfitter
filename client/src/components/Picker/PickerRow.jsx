import ItemThumb from "../ItemThumb/ItemThumb.jsx";

// Governing: ADR-0002 (Source Weapon/Equipment Images from huntshowdown.wiki.gg via a One-Time,
// Self-Hosted Scrape)
// Implements: SPEC-0001 REQ "Image Coverage Across All Catalog Categories, with Fallback",
// SPEC-0001 REQ "Consistent Visual Presentation"

export default function PickerRow({ row, showThumb, thumbVariant = "square" }) {
  return (
    <button
      className={`picker-row${row.enabled ? "" : " disabled"}`}
      style={{ cursor: row.enabled ? "pointer" : "default", opacity: row.enabled ? 1 : 0.38 }}
      onClick={row.onAdd}
    >
      {showThumb && (
        <ItemThumb
          category={row.category}
          name={row.name}
          svgPath={row.thumb}
          svgFill="#6b5a3a"
          className={`picker-row-thumb ${thumbVariant}`}
        />
      )}
      <span className="picker-row-body">
        <span className="picker-row-name">{row.name}</span>
        <span className="picker-row-meta">{row.meta}</span>
      </span>
      <span className="picker-row-badge" style={{ color: row.badgeColor }}>
        {row.badge}
      </span>
      {/* costColor carries ADR-0018's spur colour for a Scarce/Burn row (issue #362);
          undefined leaves the default `.picker-row-cost` gold from global.css alone. */}
      <span className="picker-row-cost" style={row.costColor ? { color: row.costColor } : undefined}>
        {row.costStr}
      </span>
    </button>
  );
}
