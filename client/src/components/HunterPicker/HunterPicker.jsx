// Governing: ADR-0006 (Organize Saved Loadouts into User-Named Lists Illustrated with
// Hunter Portraits), ADR-0007 (hunter roster dataset), SPEC-0003 REQ "The Hunter Picker Is
// Filterable and Bounded", SPEC-0003 REQ "The Hunter Picker Does Not Restrict or Mark
// Reuse", SPEC-0003 REQ "Favorite Hunters", SPEC-0003 REQ "Favorites-Only Becomes the
// Default Past a Threshold", SPEC-0003 REQ "Focus Management", SPEC-0003 REQ "Keyboard
// Navigation", SPEC-0003 Accessibility "The Favorites Section Is Exposed, Not Merely Drawn"
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
//   Favorites section, they do not gate.  See below.
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
// FAVORITES ARE A SECTION AND A FILTER, NEVER A GATE (SPEC-0003 REQ "Favorite Hunters")
//
// Every hunter stays reachable no matter what is favorited. Favorited hunters occupy their
// own labelled, counted section AHEAD of the rest, WITHIN the active filter — the split is
// applied by filterHunters after narrowing, so a favorite that fails the acquisition filter
// is already gone before the split runs and no non-matching hunter can appear because it is
// favorited. A hunter appears in exactly one section. "Favorites only" is a user-operable
// toggle; with it off the roster shows in full, and an empty favorites set behaves as no
// filter at all rather than as an empty picker.
//
// REVERSAL, 2026-08-10 (#138). Favorites used to sort inline to the front of one undivided
// grid. Sectioning REPLACES that sort rather than layering on it: doing both would place a
// hunter above the very section it is also inside. See design.md, "Favorites are sectioned,
// not sorted inline".
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
//
// ---------------------------------------------------------------------------------------
// HOW SECTIONS STAY ONE COMPOSITE WIDGET
// (SPEC-0003 Accessibility "The Favorites Section Is Exposed, Not Merely Drawn")
//
// One role="grid", several role="rowgroup" children. That is the whole trick, and it is why
// nothing about the keyboard model had to change shape: `rowEls()` collects every row in the
// grid in DOM order regardless of which rowgroup holds it, so the flat row index the roving
// tabindex has always used still spans the whole widget. Arrow keys therefore cross a
// section boundary without knowing sections exist, and Tab still reaches the grid in exactly
// ONE stop rather than one per section.
//
// Two grids, or a section that was its own role="grid", would have bought the visual split
// at the price of both properties.
//
// The COLUMN half of that bookkeeping did have to change (#138, PR #151 review). `.hp-grid`
// is a flex column now and `.hp-section` is the CSS grid, so there is no longer one column
// count for the widget to read: each section is laid out on its own, and a Favorites section
// with fewer members than a row is narrower than the roster below it. Down and Up therefore
// measure the section holding the active row and cross the boundary deliberately — see
// `columnsIn`/`verticalTarget`. Left, Right, Home and End never needed the column count and
// still walk the flat row sequence unchanged.
//
// Sections are also separate DOM PARENTS, so favoriting a hunter unmounts its tile from one
// and mounts a new one in the other. Focus does not survive that on its own and has to be
// handed to the moved tile explicitly — see `pendingFocus`.
//
// The visible section caption is aria-hidden and the ROWGROUP carries the accessible name
// including the count ("Favorites, 3 hunters"). A bare heading element between rows would be
// an invalid child of a grid; hiding it and naming the rowgroup gives assistive technology
// the same information through a structure the grid role actually permits.

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import HunterPortrait from "../HunterPortrait/HunterPortrait.jsx";
import { useFocusTrap } from "../../utils/focusTrap.js";
import {
  ACQUISITIONS,
  FAVORITES_SECTION,
  HAS_UNKNOWN_ACQUISITION,
  HUNTERS_BY_NAME,
  UNKNOWN_ACQUISITION,
  acquisitionLabel,
  filterHunters,
} from "../../data/hunters.js";

const OBTAINABLE_OPTIONS = [
  { value: "yes", label: "Obtainable" },
  { value: "no", label: "Not obtainable" },
  { value: UNKNOWN_ACQUISITION, label: "Unknown" },
];

// Governing: SPEC-0003 REQ "Favorites-Only Becomes the Default Past a Threshold"
//
// THE threshold — one named constant, so moving it is one edit rather than a search. Past
// this many favorites the picker OPENS with "favorites only" already enabled.
//
// Ten is a product judgement, not a measurement; design.md ("'Favorites only' defaults on
// past ten") says so explicitly, so nobody goes looking for the study behind it.
//
// Strictly greater than: at exactly ten the picker opens with the toggle off.
export const FAVORITES_ONLY_DEFAULT_THRESHOLD = 10;

/** Whether a freshly-opened picker starts with "favorites only" enabled. */
export function favoritesOnlyDefault(favoriteCount) {
  return favoriteCount > FAVORITES_ONLY_DEFAULT_THRESHOLD;
}

/**
 * Section captions. "Other hunters" only reads correctly with a Favorites section above it,
 * so the wording depends on whether the split actually happened.
 */
function sectionLabel(sectionId, hasFavoritesSection) {
  if (sectionId === FAVORITES_SECTION) return "Favorites";
  return hasFavoritesSection ? "Other hunters" : "All hunters";
}

export default function HunterPicker({
  selectedHunterId = null,
  favorites = [],
  onToggleFavorite = () => {},
  onSelect,
  onClose,
}) {
  const dialogRef = useRef(null);
  const gridRef = useRef(null);
  const favored = useMemo(() => new Set(favorites), [favorites]);
  const [query, setQuery] = useState("");
  const [acquisition, setAcquisition] = useState("");
  const [obtainable, setObtainable] = useState("");
  // Governing: SPEC-0003 REQ "Favorites-Only Becomes the Default Past a Threshold"
  //
  // A LAZY INITIALISER, which is exactly the whole mechanism. The picker is mounted when it
  // opens and unmounted when it closes, so this runs once per picker session: the default is
  // applied on open, turning the toggle off holds for the rest of that session because
  // nothing re-runs it, and reopening re-applies it because a fresh mount re-runs it. There
  // is deliberately no effect syncing it to `favorites` afterwards — that would revert the
  // user's own click the moment a favorite changed, which is the gate this must not become.
  //
  // Nothing here is sent anywhere: the toggle is client state, like the selected list and
  // the sort order. The server's data file has no field for it.
  const [favoritesOnly, setFavoritesOnly] = useState(() => favoritesOnlyDefault(favored.size));
  // Roving tabindex: exactly one cell is tabbable at a time, so Tab reaches the grid in one
  // stop instead of walking 242 tiles, and the arrow keys do the navigating within it.
  const [activeRow, setActiveRow] = useState(0);
  const [activeCol, setActiveCol] = useState(0);

  const close = () => {
    returnFocus();
    onClose();
  };

  const { onKeyDown, returnFocus } = useFocusTrap(dialogRef, { onEscape: close });

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

  // 242 entries filtered on every keystroke; memoised on the inputs it reads. `sections`
  // arrives with empty groups already dropped, so mapping over it faithfully is what
  // satisfies "a section with no members SHALL be omitted rather than rendered as an empty
  // heading" — there is no empty-check to forget here.
  //
  // Governing: SPEC-0004, SPEC-0003, issue #387 — `HUNTERS_BY_NAME` rather than `HUNTERS`.
  // `HUNTERS` is scrape-id order, which equals name order for every hunter except
  // `the-statesman` (name "The Statesman", id without the "the-" prefix its name implies),
  // so consuming it directly here put that one hunter 171 tiles from its variant. Sorting at
  // this consumption seam fixes the picker's presentation without touching the generated
  // dataset or re-keying an id that stored `hunterId` references depend on.
  const { sections, total } = useMemo(
    () =>
      filterHunters(HUNTERS_BY_NAME, {
        query,
        acquisition,
        obtainable,
        favorites: favored,
        favoritesOnly,
      }),
    [query, acquisition, obtainable, favored, favoritesOnly]
  );

  // The roving tabindex indexes rows across the WHOLE grid, not within a section — that is
  // what keeps the sections one composite widget with one tab stop. Each section's first row
  // therefore needs its offset into that flat sequence.
  const sectionStart = [];
  let flatRows = 0;
  for (const section of sections) {
    sectionStart.push(flatRows);
    flatRows += section.hunters.length;
  }
  const hasFavoritesSection = sections.some((s) => s.id === FAVORITES_SECTION);

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
  // MEASURED PER ROWGROUP, not per grid (#138). `.hp-section` is the CSS grid now, not
  // `.hp-grid` — so "the rows sharing the FIRST row's offsetTop" answers a question about
  // the Favorites section rather than about the widget. A Favorites section shorter than one
  // row is the common case the whole feature exists for, and measuring it gave a 60-tile
  // roster below it a column count of 1..n favorites: Down stepped sideways instead of down.
  //
  // "No layout yet" cannot be inferred from offsetTop alone: unlaid-out tiles all report 0,
  // and so do the tiles of a genuine single row. Counting equal offsetTops would then yield
  // the whole tile count in BOTH cases — which is right for one row and badly wrong before
  // layout, where it sends Up/Down to the last/first tile instead of one step. Ask about
  // layout directly instead: an unlaid-out element has no box, so its offset size is 0.
  const columnsIn = (groupRows) => {
    if (groupRows.length < 2) return 1;
    const first = groupRows[0];
    if (first.offsetWidth === 0 && first.offsetHeight === 0) return 1;
    const top = first.offsetTop;
    let n = 0;
    for (const el of groupRows) {
      if (el.offsetTop !== top) break;
      n += 1;
    }
    return Math.max(1, n);
  };

  // Each rowgroup's slice of the flat row sequence, plus its own column count. Read from
  // the DOM rather than from `sections` so the "no portrait" rowgroup is described by the
  // same rule as the hunter sections instead of being a special case in the key handler.
  const rowGroups = () => {
    const groups = Array.from(gridRef.current?.querySelectorAll('[role="rowgroup"]') ?? []);
    let start = 0;
    return groups.map((el) => {
      const groupRows = Array.from(el.querySelectorAll('[role="row"]'));
      const g = { start, length: groupRows.length, cols: columnsIn(groupRows) };
      start += groupRows.length;
      return g;
    });
  };

  // Governing: SPEC-0003 Accessibility "The Favorites Section Is Exposed, Not Merely Drawn"
  //
  // The flat row index that Down (dir 1) or Up (dir -1) should land on. Inside a section a
  // row step is that section's own column count. At the section's edge the move CROSSES the
  // boundary and keeps the visual column, so Down out of Favorites lands directly below
  // rather than at the roster's start — and clamps when the neighbouring row is shorter.
  //
  // A section shorter than one row needs no special case: all of its tiles sit on one visual
  // row, so its measured column count equals its length and `index % cols` is still the
  // tile's real column. Every step out of such a section is a boundary crossing, which is
  // the truth about it.
  //
  // Past the first or last section there is no neighbour, so the plain step is returned and
  // focusCell clamps it to the end of the grid — the behaviour before sections existed.
  const verticalTarget = (row, dir) => {
    const groups = rowGroups();
    const i = groups.findIndex((g) => row >= g.start && row < g.start + g.length);
    if (i < 0) return row + dir;
    const g = groups[i];
    const within = row - g.start;
    const col = within % g.cols;
    const next = within + dir * g.cols;
    if (next >= 0 && next < g.length) return g.start + next;
    const neighbour = groups[i + dir];
    if (!neighbour) return row + dir * g.cols;
    if (dir > 0) return neighbour.start + Math.min(col, neighbour.length - 1);
    // Coming up INTO a section lands in its last visual row, not its last tile.
    const lastRowStart = Math.floor((neighbour.length - 1) / neighbour.cols) * neighbour.cols;
    return neighbour.start + Math.min(lastRowStart + col, neighbour.length - 1);
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

  // Governing: SPEC-0003 REQ "Focus Management", SPEC-0003 REQ "Keyboard Navigation"
  //
  // FAVORITING MOVES THE TILE BETWEEN TWO DOM PARENTS (#138). The sections are separate
  // elements, so React cannot relocate a keyed tile between them: it unmounts the tile from
  // one rowgroup and mounts a new one in the other — destroying the very button the user
  // just pressed. Focus falls to <body>, which is OUTSIDE dialogRef, so the focus trap never
  // sees the next Tab and cannot pull it back: pressing a control inside the dialog ejects a
  // keyboard user from the dialog. The tile is remembered here and re-found below.
  //
  // Only when focus is actually inside the grid. A mouse click on a star must not yank focus
  // across the widget, and in browsers that do not focus a button on mousedown it would.
  const pendingFocus = useRef(null);

  const toggleFavorite = (hunter) => {
    const active = document.activeElement;
    const activeRowEl = active?.closest?.('[role="row"]');
    pendingFocus.current =
      active && gridRef.current?.contains(active)
        ? { hunterId: hunter.id, col: Math.max(0, cellsIn(activeRowEl).indexOf(active)) }
        : null;
    onToggleFavorite({ hunterId: hunter.id, hunterName: hunter.name, favorite: !favored.has(hunter.id) });
  };

  // A stable identity for the favorite SET, not for the array carrying it. `favorites` is a
  // prop off a server round-trip and a caller re-rendering with an equal-but-new array must
  // not count as a change — that would reset the roving tabindex under a user mid-navigation.
  const favoritesKey = useMemo(() => [...favored].sort().join(" "), [favored]);

  // Every other input that reorders rows calls resetActive(); `favorites` was the one that
  // did not, leaving activeRow pointing at a flat index that now holds a different hunter.
  // Layout, not passive: focus must be back on a real element before the browser paints, or
  // the user gets a frame with focus on <body>.
  useLayoutEffect(() => {
    const pending = pendingFocus.current;
    pendingFocus.current = null;
    if (!pending) {
      resetActive();
      return;
    }
    const rows = rowEls();
    const moved = rows.findIndex((r) => r.dataset.hunterId === pending.hunterId);
    // Not found means the hunter left the grid entirely — unfavoriting while "favorites
    // only" is on. There is nothing to return focus TO, and leaving it on <body> is the bug
    // itself, so it goes to the top of the grid, which is where the shortened list starts.
    if (moved < 0) {
      resetActive();
      focusCell(0, 0);
      return;
    }
    focusCell(moved, pending.col);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [favoritesKey]);

  // COLS_END is any index past the widest row; focusCell clamps it to that row's last cell.
  const COLS_END = 99;

  const onGridKeyDown = (e) => {
    const rows = rowEls();
    const lastRow = rows.length - 1;
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
        focusCell(verticalTarget(activeRow, 1), activeCol);
        break;
      case "ArrowUp":
        e.preventDefault();
        focusCell(verticalTarget(activeRow, -1), activeCol);
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

  // A filter change — or a favorite moving a hunter between sections — can leave the active
  // row past the end of the shorter list. Clamp on render rather than in an effect: an
  // effect would paint one frame with a tabindex on nothing, which is exactly the frame a
  // Tab press lands in.
  const rowCount = total + 1; // + the always-present "no portrait" tile
  const aRow = Math.min(activeRow, rowCount - 1);
  // The "no portrait" tile has nothing to favorite, so its row holds one focusable cell.
  const noneRow = total;
  const aCol = aRow === noneRow ? 0 : activeCol;

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
            {/* `.select` — the default step of the control scale (issue #134), the same one
                `.text-input` beside it takes, so the three filters are one band rather than a
                tall search field flanked by two short dropdowns. */}
            <select
              className="select"
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
              className="select"
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
          {total} of {HUNTERS_BY_NAME.length} hunters
        </p>

        {total === 0 && (
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
          {sections.map((section, s) => {
            const label = sectionLabel(section.id, hasFavoritesSection);
            const count = section.hunters.length;
            return (
              <Fragment key={section.id}>
                {/* aria-hidden because the ROWGROUP below carries the same words as its
                    accessible name. A heading loose among rows would be an invalid child of
                    a grid, and naming it twice would announce the section twice. */}
                <p className="hp-section-label" aria-hidden="true">
                  {label} <span className="hp-section-count">{count}</span>
                </p>
                <div
                  role="rowgroup"
                  className="hp-section"
                  data-testid={`hp-section-${section.id}`}
                  // The count is part of the NAME, not a separate description: SPEC-0003
                  // requires a screen-reader user to know which group they are in and how
                  // large it is, at the moment they enter it.
                  aria-label={`${label}, ${count} ${count === 1 ? "hunter" : "hunters"}`}
                >
                  {section.hunters.map((h, i) => {
                    // The row index is the FLAT one, across every section — see the note at
                    // the top of this file on why the sections stay one composite widget.
                    const r = sectionStart[s] + i;
                    const favorite = favored.has(h.id);
                    return (
                      // The only conditional classes are the CURRENT selection in THIS picker
                      // and the user's own favorite. Neither is reuse: an already-used hunter
                      // is rendered by this exact branch, indistinguishably from an unused
                      // one, in whichever section it belongs to.
                      <div
                        key={h.id}
                        role="row"
                        // The hunter this row is for, so focus can be handed back to the
                        // same tile after a favorite moves it to the other section.
                        data-hunter-id={h.id}
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
                            {/* alt="" — the name is rendered right below, so announcing the
                                portrait would read the hunter twice. The cell's own text is
                                its name.

                                Governing: ADR-0007 (as amended 2026-08-10), SPEC-0004 REQ
                                "Consumption Contract Compatibility". No size is passed:
                                the tile asks for the hunter's one portrait. It used to ask
                                for a `-thumb` companion that #147 deleted, which made every
                                one of these 242 tiles issue a 404 before falling back. */}
                            <HunterPortrait hunterId={h.id} alt="" />
                          </span>
                          <span className="hp-tile-name">{h.name}</span>
                        </div>

                        <div role="gridcell" className="hp-fav-cell">
                          {/* The accessible name carries BOTH the action and the hunter, per
                              SPEC-0003's rule for icon-only controls — "Favorite The Rat",
                              not a bare star repeated 242 times. aria-pressed carries the
                              state, so the glyph is decoration and is hidden. */}
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
                </div>
              </Fragment>
            );
          })}

          {/* Always present, never filtered: "no portrait" is not a hunter, so no filter
              can exclude it — and it must stay reachable when nothing matched.
              Its own rowgroup rather than the tail of the last section: appended to
              "Favorites, 2 hunters" it would be counted as a favorited hunter, and it is
              neither. Being a rowgroup inside the SAME grid keeps it on the flat row
              sequence, so End still reaches it and it keeps its single focusable cell. */}
          <div role="rowgroup" className="hp-section" aria-label="Other options">
            <div
              role="row"
              className={`hp-tile hp-tile-none${selectedHunterId === null ? " hp-tile-picked" : ""}`}
            >
              <div
                role="gridcell"
                data-hp-focus=""
                aria-selected={selectedHunterId === null}
                tabIndex={aRow === noneRow ? 0 : -1}
                className="hp-tile-choose"
                data-testid="hunter-tile-none"
                onClick={() => choose(null)}
                onKeyDown={(e) => onChooseKeyDown(e, null)}
                onFocus={() => {
                  setActiveRow(noneRow);
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
