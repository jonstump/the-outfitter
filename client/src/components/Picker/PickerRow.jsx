export default function PickerRow({ row, showThumb }) {
  return (
    <button
      className={`picker-row${row.enabled ? "" : " disabled"}`}
      style={{ cursor: row.enabled ? "pointer" : "default", opacity: row.enabled ? 1 : 0.38 }}
      onClick={row.onAdd}
    >
      {showThumb && (
        <svg viewBox="0 0 96 40" className="picker-row-thumb">
          <path d={row.thumb} fill="#6b5a3a" />
        </svg>
      )}
      <span className="picker-row-body">
        <span className="picker-row-name">{row.name}</span>
        <span className="picker-row-meta">{row.meta}</span>
      </span>
      <span className="picker-row-badge" style={{ color: row.badgeColor }}>
        {row.badge}
      </span>
      <span className="picker-row-cost">{row.costStr}</span>
    </button>
  );
}
