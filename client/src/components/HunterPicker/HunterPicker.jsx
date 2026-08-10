// Governing: ADR-0006 (Organize Saved Loadouts into User-Named Lists Illustrated with
// Hunter Portraits), ADR-0007 (hunter roster dataset), SPEC-0003 REQ "The Hunter Picker Is
// Filterable and Bounded", SPEC-0003 REQ "The Hunter Picker Does Not Restrict or Mark
// Reuse", SPEC-0003 REQ "Focus Management", SPEC-0003 REQ "Keyboard Navigation"
//
// 242 hunters. Three properties follow from that number and none of them are refinements:
//
//   Filtering is functional.  A free-text name filter plus acquisition/obtainable. The
//     name filter carries the design — the three largest acquisition buckets hold 72% of
//     the roster, so filtering to `dlc` still leaves 65 tiles to scroll.
//   Loading is lazy.  Portraits carry loading="lazy" (via HunterPortrait), so bytes are
//     proportional to what was scrolled to rather than to the roster.
//   Reuse is invisible.  This component is never told which hunters other lists already
//     reference, which is the strongest available guarantee that it cannot mark them.
//     There is no badge to remove later and no prop to accidentally thread through.
//
// The picker is a modal dialog rather than the inline section the design handoff sketches
// (§5). Two reasons: SPEC-0003 "Focus Management" requires a trap, focus-in, and
// focus-return, which are dialog semantics and read as a bug on an inline region a user can
// still tab past; and an inline 242-tile grid inside the roster panel buries the roster it
// is being chosen for. The create-list form around it stays inline exactly as designed.

import { useMemo, useRef, useState } from "react";
import HunterPortrait from "../HunterPortrait/HunterPortrait.jsx";
import { useFocusTrap } from "../../utils/focusTrap.js";
import {
  ACQUISITIONS,
  HAS_UNKNOWN_ACQUISITION,
  HUNTERS,
  UNKNOWN_ACQUISITION,
  acquisitionLabel,
  filterHunters,
} from "../../data/hunters.js";

const OBTAINABLE_OPTIONS = [
  { value: "yes", label: "Obtainable" },
  { value: "no", label: "Not obtainable" },
  { value: UNKNOWN_ACQUISITION, label: "Unknown" },
];

export default function HunterPicker({ selectedHunterId = null, onSelect, onClose }) {
  const dialogRef = useRef(null);
  const gridRef = useRef(null);
  const [query, setQuery] = useState("");
  const [acquisition, setAcquisition] = useState("");
  const [obtainable, setObtainable] = useState("");
  // Roving tabindex: exactly one option is tabbable at a time, so Tab reaches the grid in
  // one stop instead of walking 242 tiles, and the arrow keys do the navigating within it.
  const [activeIndex, setActiveIndex] = useState(0);

  const close = () => {
    returnFocus();
    onClose();
  };

  const { onKeyDown, returnFocus } = useFocusTrap(dialogRef, { onEscape: close });

  // 242 entries filtered on every keystroke; memoised on the three inputs it reads.
  const matches = useMemo(
    () => filterHunters(HUNTERS, { query, acquisition, obtainable }),
    [query, acquisition, obtainable]
  );

  const optionEls = () =>
    Array.from(gridRef.current?.querySelectorAll('[role="option"]') ?? []);

  // The grid is `auto-fill`, so the column count is decided by CSS at the current width and
  // can only be read back from layout. Falls back to a single column when layout has not
  // happened (which also makes Up/Down degrade to Previous/Next rather than misfire).
  //
  // "No layout yet" cannot be inferred from offsetTop alone: unlaid-out tiles all report 0,
  // and so do the tiles of a genuine single row. Counting equal offsetTops would then yield
  // the whole option count in BOTH cases — which is right for one row and badly wrong before
  // layout, where it sends Up/Down to the last/first tile instead of one step. Ask about
  // layout directly instead: an unlaid-out element has no box, so its offset size is 0.
  const columnCount = () => {
    const opts = optionEls();
    if (opts.length < 2) return 1;
    const first = opts[0];
    if (first.offsetWidth === 0 && first.offsetHeight === 0) return 1;
    const top = first.offsetTop;
    let n = 0;
    for (const el of opts) {
      if (el.offsetTop !== top) break;
      n += 1;
    }
    return Math.max(1, n);
  };

  const move = (next) => {
    const opts = optionEls();
    if (!opts.length) return;
    const clamped = Math.max(0, Math.min(opts.length - 1, next));
    setActiveIndex(clamped);
    opts[clamped]?.focus();
  };

  const choose = (hunter) => {
    returnFocus();
    onSelect(hunter ? { hunterId: hunter.id, hunterName: hunter.name } : { hunterId: null, hunterName: null });
  };

  const onGridKeyDown = (e) => {
    const cols = columnCount();
    switch (e.key) {
      case "ArrowRight":
        e.preventDefault();
        move(activeIndex + 1);
        break;
      case "ArrowLeft":
        e.preventDefault();
        move(activeIndex - 1);
        break;
      case "ArrowDown":
        e.preventDefault();
        move(activeIndex + cols);
        break;
      case "ArrowUp":
        e.preventDefault();
        move(activeIndex - cols);
        break;
      case "Home":
        e.preventDefault();
        move(0);
        break;
      case "End":
        e.preventDefault();
        move(optionEls().length - 1);
        break;
      default:
        break;
    }
  };

  // A filter change can leave the active index past the end of the shorter list. Clamp on
  // render rather than in an effect: an effect would paint one frame with a tabindex on
  // nothing, which is exactly the frame a Tab press lands in.
  const optionCount = matches.length + 1; // + the always-present "no portrait" option
  const active = Math.min(activeIndex, optionCount - 1);

  const onOptionKeyDown = (e, hunter) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(hunter);
    }
  };

  return (
    <div className="ll-overlay" onClick={close}>
      <div
        ref={dialogRef}
        className="ll-dialog hp-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hp-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <h2 id="hp-title">Choose a portrait</h2>

        <div className="hp-filters">
          <label className="hp-filter">
            <span className="sr-only">Filter hunters by name</span>
            <input
              className="text-input"
              type="search"
              placeholder="Search hunters…"
              aria-label="Filter hunters by name"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIndex(0);
              }}
            />
          </label>
          <label className="hp-filter">
            <span className="sr-only">Filter by acquisition</span>
            <select
              aria-label="Filter by acquisition"
              value={acquisition}
              onChange={(e) => {
                setAcquisition(e.target.value);
                setActiveIndex(0);
              }}
            >
              <option value="">Any acquisition</option>
              {ACQUISITIONS.map((a) => (
                <option key={a} value={a}>
                  {acquisitionLabel(a)}
                </option>
              ))}
              {/* The two entries with a null acquisition are ordinary selectable hunters;
                  without this bucket they would be unreachable through this control. */}
              {HAS_UNKNOWN_ACQUISITION && <option value={UNKNOWN_ACQUISITION}>Unknown</option>}
            </select>
          </label>
          <label className="hp-filter">
            <span className="sr-only">Filter by availability</span>
            <select
              aria-label="Filter by availability"
              value={obtainable}
              onChange={(e) => {
                setObtainable(e.target.value);
                setActiveIndex(0);
              }}
            >
              <option value="">Any availability</option>
              {OBTAINABLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* A count of MATCHES, which the spec's own scenario expects to fall as a filter
            narrows. Not to be confused with the count of already-used hunters that "Does
            Not Restrict or Mark Reuse" forbids — this component cannot compute that one. */}
        <p className="hp-count" aria-live="polite">
          {matches.length} of {HUNTERS.length} hunters
        </p>

        {matches.length === 0 && (
          <p className="hp-empty">
            No hunters match those filters. Clear the search or widen the filters — or pick
            “No portrait” below.
          </p>
        )}

        <div
          ref={gridRef}
          className="hp-grid"
          role="listbox"
          aria-label="Hunters"
          onKeyDown={onGridKeyDown}
        >
          {matches.map((h, i) => (
            // No conditional class, no badge, no dimming, no reordering: an already-used
            // hunter is rendered by this exact branch, indistinguishably.
            <div
              key={h.id}
              role="option"
              aria-selected={selectedHunterId === h.id}
              tabIndex={i === active ? 0 : -1}
              className={`hp-tile${selectedHunterId === h.id ? " hp-tile-picked" : ""}`}
              data-testid={`hunter-tile-${h.id}`}
              onClick={() => choose(h)}
              onKeyDown={(e) => onOptionKeyDown(e, h)}
              onFocus={() => setActiveIndex(i)}
            >
              <span className="hp-tile-art">
                {/* alt="" — the name is rendered right below, so announcing the portrait
                    would read the hunter twice. The option's own text is its name. */}
                <HunterPortrait hunterId={h.id} size="thumb" alt="" />
              </span>
              <span className="hp-tile-name">{h.name}</span>
            </div>
          ))}

          {/* Always present, never filtered: "no portrait" is not a hunter, so no filter
              can exclude it — and it must stay reachable when nothing matched. */}
          <div
            role="option"
            aria-selected={selectedHunterId === null}
            tabIndex={active === matches.length ? 0 : -1}
            className={`hp-tile hp-tile-none${selectedHunterId === null ? " hp-tile-picked" : ""}`}
            data-testid="hunter-tile-none"
            onClick={() => choose(null)}
            onKeyDown={(e) => onOptionKeyDown(e, null)}
            onFocus={() => setActiveIndex(matches.length)}
          >
            <span className="hp-tile-art hp-tile-mono" aria-hidden="true">
              ?
            </span>
            <span className="hp-tile-name hp-tile-name-none">No portrait</span>
          </div>
        </div>

        <div className="ll-dialog-actions">
          <button className="btn-outline" type="button" onClick={close}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
