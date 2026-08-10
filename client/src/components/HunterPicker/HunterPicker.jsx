// Governing: ADR-0006 (Organize Saved Loadouts into User-Named Lists Illustrated with
// Hunter Portraits), ADR-0007 (hunter roster dataset), SPEC-0003 REQ "The Hunter Picker Is
// Filterable and Bounded", SPEC-0003 REQ "The Hunter Picker Does Not Restrict or Mark
// Reuse", SPEC-0003 REQ "Favorite Hunters", SPEC-0003 REQ "Focus Management", SPEC-0003
// REQ "Keyboard Navigation"
//
// 242 hunters. Four properties follow from that number and none of them are refinements:
//
//   Filtering is functional.  A free-text name filter plus acquisition/obtainable. The
//     name filter carries the design — the three largest acquisition buckets hold 72% of
//     the roster, so filtering to `dlc` still leaves 65 tiles to scroll.
//   Loading is lazy.  Portraits carry loading="lazy" (via HunterPortrait), so bytes are
//     proportional to what was scrolled to rather than to the roster.
//   Reuse is invisible.  This component is never told which hunters other lists already
//     reference, which is the strongest available guarantee that it cannot mark them.
//     There is no badge to remove later and no prop to accidentally thread through.
//   Favorites sort, they do not gate.  See below.
//
// The picker is a modal dialog rather than the inline section the design handoff sketches
// (§5). Two reasons: SPEC-0003 "Focus Management" requires a trap, focus-in, and
// focus-return, which are dialog semantics and read as a bug on an inline region a user can
// still tab past; and an inline 242-tile grid inside the roster panel buries the roster it
// is being chosen for. The create-list form around it stays inline exactly as designed.
//
// ---------------------------------------------------------------------------------------
// WHY THE TILES ARE A GRID AND NOT A LISTBOX (changed in #114)
//
// #88 modelled the tiles as role="listbox" / role="option", which was right while a tile
// did exactly one thing. A tile now does two — choose this hunter, and favorite this hunter
// — and `option` is a "children presentational" role: a <button> inside one is pruned from
// the accessibility tree, so the favorite control would be invisible to a screen reader
// while looking fine on screen. SPEC-0003 requires an accessible name on every icon-only
// control that names both the action and its subject ("Favorite The Rat"), which that
// structure cannot deliver.
//
// So the tiles are a role="grid": one row per tile, two cells — choose, and favorite. The
// roving tabindex, the arrow-key navigation, the measured column count, and the lazy
// portraits are all carried over unchanged in behaviour; only the roles and the focus
// bookkeeping (an index becomes a row/column pair) differ.
//
// ---------------------------------------------------------------------------------------
// FAVORITES ARE A FILTER AND A SORT, NEVER A GATE (SPEC-0003 REQ "Favorite Hunters")
//
// Every hunter stays reachable no matter what is favorited. Favorited hunters sort ahead
// WITHIN the active filter — the sort is applied by filterHunters after narrowing, so a
// favorite that fails the acquisition filter is already gone before the sort runs and no
// non-matching hunter can appear because it is favorited. "Favorites only" is an explicit,
// opt-in toggle; with it off the roster shows in full, and an empty favorites set behaves
// as no filter at all rather than as an empty picker.
//
// The toggle is LOCAL COMPONENT STATE and is never sent anywhere. It is a view preference,
// client state under the same rule as the selected list and the sort order. What favorites
// were is durable and lives on the server; which of them you are looking at right now is
// not.
//
// Favoriting is NOT reuse marking and the two must never be conflated. Reuse is a fact
// about the user's other lists, which this component still cannot see. A favorited hunter
// that another list already uses therefore shows the favorite indicator and nothing else —
// not because that case is special-cased, but because the in-use half does not exist here.

import { useEffect, useMemo, useRef, useState } from "react";
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

export default function HunterPicker({
  selectedHunterId = null,
  favorites = [],
  onToggleFavorite = () => {},
  onSelect,
  onClose,
}) {
  const dialogRef = useRef(null);
  const gridRef = useRef(null);
  const [query, setQuery] = useState("");
  const [acquisition, setAcquisition] = useState("");
  const [obtainable, setObtainable] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  // Roving tabindex: exactly one cell is tabbable at a time, so Tab reaches the grid in one
  // stop instead of walking 242 tiles, and the arrow keys do the navigating within it.
  const [activeRow, setActiveRow] = useState(0);
  const [activeCol, setActiveCol] = useState(0);

  const close = () => {
    returnFocus();
    onClose();
  };

  const { onKeyDown, returnFocus } = useFocusTrap(dialogRef, { onEscape: close });

  const favored = useMemo(() => new Set(favorites), [favorites]);

  // Unfavoriting the LAST favorite must clear the toggle, not just grey it out. The
  // checkbox renders `favoritesOnly && !noFavorites`, so an unreset `true` hides behind a
  // disabled, unchecked box while the roster comes back — the filter looks off. Favorite
  // anything else and it reactivates, collapsing the picker to that one hunter without the
  // user ever re-checking the box (PR #133 review). Resetting the state is what makes the
  // control's internal value match what it visually communicates.
  //
  // An effect rather than a branch in `toggleFavorite`: `favorites` is a prop driven by a
  // server round-trip, so the set can also empty from a refetch, another tab, or a failed
  // write rolling back — none of which pass through this component's own handler.
  const noFavorites = favored.size === 0;
  useEffect(() => {
    if (noFavorites) setFavoritesOnly(false);
  }, [noFavorites]);

  // 242 entries filtered on every keystroke; memoised on the inputs it reads.
  const matches = useMemo(
    () => filterHunters(HUNTERS, { query, acquisition, obtainable, favorites: favored, favoritesOnly }),
    [query, acquisition, obtainable, favored, favoritesOnly]
  );

  const resetActive = () => {
    setActiveRow(0);
    setActiveCol(0);
  };

  const rowEls = () => Array.from(gridRef.current?.querySelectorAll('[role="row"]') ?? []);
  const cellsIn = (row) => Array.from(row?.querySelectorAll("[data-hp-focus]") ?? []);

  // The grid is `auto-fill`, so the column count is decided by CSS at the current width and
  // can only be read back from layout. Falls back to a single column when layout has not
  // happened (which also makes Up/Down degrade to Previous/Next rather than misfire).
  //
  // "No layout yet" cannot be inferred from offsetTop alone: unlaid-out tiles all report 0,
  // and so do the tiles of a genuine single row. Counting equal offsetTops would then yield
  // the whole tile count in BOTH cases — which is right for one row and badly wrong before
  // layout, where it sends Up/Down to the last/first tile instead of one step. Ask about
  // layout directly instead: an unlaid-out element has no box, so its offset size is 0.
  const columnCount = () => {
    const rows = rowEls();
    if (rows.length < 2) return 1;
    const first = rows[0];
    if (first.offsetWidth === 0 && first.offsetHeight === 0) return 1;
    const top = first.offsetTop;
    let n = 0;
    for (const el of rows) {
      if (el.offsetTop !== top) break;
      n += 1;
    }
    return Math.max(1, n);
  };

  /** Move focus to (row, col), clamping both to what actually exists. */
  const focusCell = (r, c) => {
    const rows = rowEls();
    if (!rows.length) return;
    const row = Math.max(0, Math.min(rows.length - 1, r));
    const cells = cellsIn(rows[row]);
    if (!cells.length) return;
    const col = Math.max(0, Math.min(cells.length - 1, c));
    setActiveRow(row);
    setActiveCol(col);
    cells[col].focus();
  };

  const choose = (hunter) => {
    returnFocus();
    onSelect(hunter ? { hunterId: hunter.id, hunterName: hunter.name } : { hunterId: null, hunterName: null });
  };

  const toggleFavorite = (hunter) => {
    onToggleFavorite({ hunterId: hunter.id, hunterName: hunter.name, favorite: !favored.has(hunter.id) });
  };

  // COLS_END is any index past the widest row; focusCell clamps it to that row's last cell.
  const COLS_END = 99;

  const onGridKeyDown = (e) => {
    const rows = rowEls();
    const lastRow = rows.length - 1;
    const cols = columnCount();
    const inRow = cellsIn(rows[activeRow]).length;
    switch (e.key) {
      case "ArrowRight":
        e.preventDefault();
        // Along the row's own cells first, then on to the next tile — so Right always means
        // "the next thing to the right", whether that is this tile's star or the next tile.
        if (activeCol < inRow - 1) focusCell(activeRow, activeCol + 1);
        else if (activeRow < lastRow) focusCell(activeRow + 1, 0);
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (activeCol > 0) focusCell(activeRow, activeCol - 1);
        else if (activeRow > 0) focusCell(activeRow - 1, COLS_END);
        break;
      case "ArrowDown":
        e.preventDefault();
        focusCell(activeRow + cols, activeCol);
        break;
      case "ArrowUp":
        e.preventDefault();
        focusCell(activeRow - cols, activeCol);
        break;
      case "Home":
        e.preventDefault();
        focusCell(0, 0);
        break;
      case "End":
        e.preventDefault();
        focusCell(lastRow, COLS_END);
        break;
      default:
        break;
    }
  };

  // A filter change can leave the active row past the end of the shorter list. Clamp on
  // render rather than in an effect: an effect would paint one frame with a tabindex on
  // nothing, which is exactly the frame a Tab press lands in.
  const rowCount = matches.length + 1; // + the always-present "no portrait" tile
  const aRow = Math.min(activeRow, rowCount - 1);
  // The "no portrait" tile has nothing to favorite, so its row holds one focusable cell.
  const aCol = aRow === matches.length ? 0 : activeCol;

  const onChooseKeyDown = (e, hunter) => {
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
                resetActive();
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
                resetActive();
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
                resetActive();
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

        {/* Offered unconditionally so the feature is discoverable, but inert until there is
            something to filter TO: with nothing favorited it would narrow 242 hunters to
            zero, which is exactly the empty picker SPEC-0003 forbids. The hint says so
            rather than leaving a control that appears broken. */}
        <div className="hp-fav-only-row">
          <label className="hp-fav-only">
            <input
              type="checkbox"
              checked={favoritesOnly && !noFavorites}
              disabled={noFavorites}
              aria-describedby={noFavorites ? "hp-fav-only-hint" : undefined}
              onChange={(e) => {
                setFavoritesOnly(e.target.checked);
                resetActive();
              }}
            />
            <span>Favorites only</span>
          </label>
          {/* Outside the label deliberately: inside, it would be read as part of the
              checkbox's NAME ("Favorites only Favorite a hunter to use this") rather than as
              its description. */}
          {noFavorites && (
            <span id="hp-fav-only-hint" className="hp-fav-only-hint">
              Favorite a hunter to use this.
            </span>
          )}
        </div>

        {/* A count of MATCHES, which the spec's own scenario expects to fall as a filter
            narrows. Not to be confused with the count of already-used hunters that "Does
            Not Restrict or Mark Reuse" forbids — this component cannot compute that one. */}
        <p className="hp-count" aria-live="polite">
          {matches.length} of {HUNTERS.length} hunters
        </p>

        {matches.length === 0 && (
          <p className="hp-empty">
            No hunters match those filters.{" "}
            {favoritesOnly && !noFavorites ? "Turn off “Favorites only”, clear" : "Clear"} the
            search or widen the filters — or pick “No portrait” below.
          </p>
        )}

        <div
          ref={gridRef}
          className="hp-grid"
          role="grid"
          aria-label="Hunters"
          onKeyDown={onGridKeyDown}
        >
          {matches.map((h, r) => {
            const favorite = favored.has(h.id);
            return (
              // The only conditional classes are the CURRENT selection in THIS picker and
              // the user's own favorite. Neither is reuse: an already-used hunter is
              // rendered by this exact branch, indistinguishably from an unused one.
              <div
                key={h.id}
                role="row"
                className={`hp-tile${selectedHunterId === h.id ? " hp-tile-picked" : ""}${
                  favorite ? " hp-tile-fav" : ""
                }`}
              >
                <div
                  role="gridcell"
                  data-hp-focus=""
                  aria-selected={selectedHunterId === h.id}
                  tabIndex={r === aRow && aCol === 0 ? 0 : -1}
                  className="hp-tile-choose"
                  data-testid={`hunter-tile-${h.id}`}
                  onClick={() => choose(h)}
                  onKeyDown={(e) => onChooseKeyDown(e, h)}
                  onFocus={() => {
                    setActiveRow(r);
                    setActiveCol(0);
                  }}
                >
                  <span className="hp-tile-art">
                    {/* alt="" — the name is rendered right below, so announcing the portrait
                        would read the hunter twice. The cell's own text is its name. */}
                    <HunterPortrait hunterId={h.id} size="thumb" alt="" />
                  </span>
                  <span className="hp-tile-name">{h.name}</span>
                </div>

                <div role="gridcell" className="hp-fav-cell">
                  {/* The accessible name carries BOTH the action and the hunter, per
                      SPEC-0003's rule for icon-only controls — "Favorite The Rat", not a
                      bare star repeated 242 times. aria-pressed carries the state, so the
                      glyph is decoration and is hidden. */}
                  <button
                    type="button"
                    data-hp-focus=""
                    className="hp-fav"
                    tabIndex={r === aRow && aCol === 1 ? 0 : -1}
                    aria-pressed={favorite}
                    aria-label={`${favorite ? "Unfavorite" : "Favorite"} ${h.name}`}
                    data-testid={`hunter-fav-${h.id}`}
                    onClick={() => toggleFavorite(h)}
                    onFocus={() => {
                      setActiveRow(r);
                      setActiveCol(1);
                    }}
                  >
                    <span aria-hidden="true">{favorite ? "★" : "☆"}</span>
                  </button>
                </div>
              </div>
            );
          })}

          {/* Always present, never filtered: "no portrait" is not a hunter, so no filter
              can exclude it — and it must stay reachable when nothing matched. */}
          <div
            role="row"
            className={`hp-tile hp-tile-none${selectedHunterId === null ? " hp-tile-picked" : ""}`}
          >
            <div
              role="gridcell"
              data-hp-focus=""
              aria-selected={selectedHunterId === null}
              tabIndex={aRow === matches.length ? 0 : -1}
              className="hp-tile-choose"
              data-testid="hunter-tile-none"
              onClick={() => choose(null)}
              onKeyDown={(e) => onChooseKeyDown(e, null)}
              onFocus={() => {
                setActiveRow(matches.length);
                setActiveCol(0);
              }}
            >
              <span className="hp-tile-art hp-tile-mono" aria-hidden="true">
                ?
              </span>
              <span className="hp-tile-name hp-tile-name-none">No portrait</span>
            </div>
            {/* Not a hunter, so there is nothing to favorite — but a row with fewer cells
                than its siblings is a malformed grid, so the cell exists and is empty. */}
            <div role="gridcell" className="hp-fav-cell" />
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
