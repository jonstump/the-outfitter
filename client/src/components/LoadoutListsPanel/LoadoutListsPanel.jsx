// Governing: ADR-0006 (Organize Saved Loadouts into User-Named Lists Illustrated with
// Hunter Portraits), SPEC-0003 REQ "New Lists Default Their Name from the Chosen
// Portrait", SPEC-0003 REQ "List Ordering and Sorting", SPEC-0003 REQ "The Selected List
// Is Client State"
//
// Replaces the flat SavedLoadoutsPanel with a roster of lists that expand in place.
// Expanding a list IS selecting it, so the two states cannot drift apart and no separate
// selection affordance is needed.
//
// Also: SPEC-0003 REQ "Hunter Dataset Consumption Contract", SPEC-0003 REQ "Lists Are
// Visually Distinguishable Independent of Portrait and Name" (issue #88). Portraits render
// through HunterPortrait, which owns the portrait-then-placeholder fallback ladder — one
// asset per hunter, no size chosen here (#148); the accent renders as the card frame and
// the expanded header's rule, and is editable there.
//
// The accent is never the only thing separating two lists — the name is on every card, in
// the expanded header, and in the move-to-list select. The palette separates by hue rather
// than luminance, so anything that made the accent load-bearing would be unreadable to a
// colour-blind user.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import HunterPortrait from "../HunterPortrait/HunterPortrait.jsx";
import HunterPicker from "../HunterPicker/HunterPicker.jsx";
import ItemThumb from "../ItemThumb/ItemThumb.jsx";
import {
  CONS,
  TOOLS,
  TRAITS,
  WEAPONS,
  consThumb,
  toolThumb,
  traitThumb,
  weaponThumb,
} from "../../data/catalog.js";
import { totalCost } from "../../utils/calc.js";
import { fromData } from "../../utils/loadoutCodec.js";
import { groupByList, sortLists, availableSortKeys, SORT_LABELS, UNASSIGNED } from "../../utils/listOrdering.js";
import { HUNTERS, hunterFor, hunterNameFor } from "../../data/hunters.js";
import { LIST_ACCENTS, accentName, accentVar, previewNextAccent } from "../../utils/listAccent.js";
import { useFocusTrap } from "../../utils/focusTrap.js";
import { loadSavedThunk } from "../../store/thunks.js";
import { deleteSaved, describeSaved, moveSaved } from "../../store/savedLoadoutsSlice.js";
import {
  createListThunk,
  renameListThunk,
  retireListThunk,
  setListAccentThunk,
} from "../../store/loadoutListsSlice.js";
import { favoriteHunterThunk, unfavoriteHunterThunk } from "../../store/hunterFavoritesSlice.js";
import { uiActions } from "../../store/uiSlice.js";

const monogram = (name) => (name || "?").trim().charAt(0).toUpperCase();

/**
 * What to say about a list's hunter under its name in the expanded header.
 *
 * Three distinct states, deliberately not collapsed into two: a list that chose no
 * portrait never claimed an identity, while a list whose hunter left the roster claimed one
 * the dataset can no longer resolve. Both stay fully usable; only the copy differs, and
 * saying "no portrait" for the second would quietly rewrite the user's choice.
 */
function hunterLine(hunterId) {
  if (!hunterId) return "no portrait";
  return hunterNameFor(hunterId) ?? "hunter missing from roster";
}

// ---------------------------------------------------------------------------------------
// The categorised loadout preview
//
// Governing: ADR-0006 (Organize Saved Loadouts into User-Named Lists Illustrated with
// Hunter Portraits), SPEC-0003 REQ "Filed Loadouts Preview Their Contents", SPEC-0003 REQ
// "Saved Loadouts Render as a Card Grid"
//
// Everything below derives from the loadout the card ALREADY decoded to show its cost. There
// is no summary field, no second fetch and no write: design.md ("Loadout previews are
// derived from the record, never stored") rejected caching precisely because a stored
// summary is a second source of truth that goes stale the moment the catalog changes.
//
// This REPLACES the compact strip that shipped in #139/#150, and the shed-by-width rule that
// strip implemented is withdrawn rather than merely unused — `previewEntries`,
// `shedPreview`, `previewCapacity` and the resize listener are gone, not dormant. A
// fixed-cell grid has no ordered list to degrade along, and dropping cells would destroy the
// constant shape the grid exists to hold. Responsiveness is the CARD's concern now
// (design.md, "Loadouts become cards, and must not read as lists").
//
// Unresolvable items are not special-cased for a placeholder: `fromData` drops ids the
// catalog no longer carries, and a cell with nothing in it renders as an empty cell rather
// than shifting its neighbours forward. Any per-item placeholder written here would be a
// second, divergent copy of that rule.
// ---------------------------------------------------------------------------------------

/**
 * Cell counts, fixed — the load-bearing choice, per design.md.
 *
 * Eight equipment cells and fifteen trait cells are constants, NOT functions of what the
 * loadout holds. A grid whose shape depends on its contents cannot be scanned across a list:
 * the eye has to re-find each category in every card. Fixing the shape means a filled cell
 * is information and an empty cell is information too.
 *
 * Eight-as-two-rows-of-four mirrors the builder's own `.equip-grid` (EquipmentPanel), so a
 * loadout reads the same way in a list as in the panel that produced it.
 *
 * Fifteen is *Hunt: Showdown*'s per-hunter trait maximum. It is deliberately NOT derived
 * from the trait-point cap, which is user-settable — deriving it would make the grid reflow
 * when a setting changed, which is exactly what fixing the shape is meant to prevent. It is
 * a fact about the game, not an invariant this application enforces: `upBudgetOn` is off by
 * default, the catalog holds 32 traits and the server accepts 40, so a loadout holding more
 * than fifteen is an ordinary savable record. See `traitOverflow` below.
 */
export const WEAPON_CELLS = 2;
export const EQUIP_CELLS = 8;
export const EQUIP_COLUMNS = 4;
export const TRAIT_CELLS = 15;
export const TRAIT_COLUMNS = 5;

/**
 * The size floors the spec pins, as numbers rather than as stylesheet literals.
 *
 * These exist because the strip this replaces drew 512×128 weapon art at 34×24 — about 7% of
 * the width the asset carries — while conforming to a requirement that said only "preview".
 * An unassertable size rule is what let that ship, so every floor below is exported, is set
 * on the preview as a custom property, and is read from there by global.css. One number, one
 * place, and a test can reach it.
 *
 * The two floors meet by construction rather than by coincidence: five trait columns at the
 * 48px cell floor plus four 4px gaps is 256px, which is exactly half the weapon asset's
 * intrinsic width. So a single minimum width satisfies both, and no card can ever be wide
 * enough to draw one at full size and not the other.
 *
 * They are floors at the WIDEST supported viewport, which is where SPEC-0003 pins them. Every
 * rule in global.css that reads one caps it at the space available (`min(floor, 100%)`), so a
 * viewport too narrow to honour a floor scales below it rather than overflowing — the spec's
 * own degradation, and the one outcome "no card SHALL overflow horizontally" forbids.
 */
export const WEAPON_ASSET_WIDTH = 512; // client/public/images/weapons/*.png are 512×128
export const WEAPON_MIN_DRAWN_PX = WEAPON_ASSET_WIDTH / 2;
export const CELL_MIN_PX = 48;
export const PREVIEW_GAP_PX = 4;
/** `.item-thumb` frames every cell, and under `box-sizing: border-box` its border comes out of
 *  the image's content box — so the weapon needs its two pixels back, or a card at exactly the
 *  minimum track draws the art at 254px: 49.6% of 512, not the 50% required. */
const THUMB_BORDER_PX = 1;
const CARD_PADDING_PX = 12;
const CARD_BORDER_PX = 1;
/** The narrowest card that still draws a preview at its floors: `.ll-cards` sets this as the
 *  minimum grid track, capped there at the width available. */
export const CARD_MIN_PX = WEAPON_MIN_DRAWN_PX + 2 * (THUMB_BORDER_PX + CARD_PADDING_PX + CARD_BORDER_PX);

const TRAIT_BY_ID = new Map(TRAITS.map((t) => [t[0], t]));

function weaponCell(w, slot) {
  const def = w ? WEAPONS[w.i] : null;
  if (!def) return null;
  return { key: `w${slot}`, kind: "weapon", category: "weapons", name: def[1], svgPath: weaponThumb(def) };
}

function equipCell(e, slot) {
  if (!e) return null;
  const tool = e.t === "T";
  const def = tool ? TOOLS[e.i] : CONS[e.i];
  if (!def) return null;
  return {
    key: `e${slot}`,
    kind: tool ? "tool" : "consumable",
    category: tool ? "tools" : "consumables",
    name: def[1],
    svgPath: tool ? toolThumb(def) : consThumb(def),
  };
}

function traitCell(id, slot) {
  const def = TRAIT_BY_ID.get(id);
  if (!def) return null;
  return { key: `t${slot}`, kind: "trait", category: "traits", name: def[1], svgPath: traitThumb(def) };
}

/**
 * The loadout, arranged into the three category groups the preview draws.
 *
 * Every group is a FIXED-LENGTH array whose holes are `null`. That is the whole contract:
 * a cell index is a position in the grid, and an item that does not resolve leaves its cell
 * empty rather than shifting later items forward.
 *
 * Stated as cells occupied rather than as an array shape, deliberately. SPEC-0006 changes
 * `state.equip` from a packed array to a fixed sparse one; a packed array fills cells in
 * order and a sparse one places them where the user put them, and indexing by cell is
 * correct under both. Nothing here needs rewriting when that lands.
 */
export function previewGroups(loadout) {
  const weapons = Array.from({ length: WEAPON_CELLS }, (_, slot) => weaponCell(loadout.weapons[slot], slot));
  const equipment = Array.from({ length: EQUIP_CELLS }, (_, slot) => equipCell(loadout.equip[slot], slot));
  const traits = Array.from({ length: TRAIT_CELLS }, (_, slot) => traitCell(loadout.traits[slot], slot));

  // What the loadout HOLDS, which is not the same as what the grid can draw. More than
  // fifteen traits is reachable today, so the sixteenth is counted and announced even though
  // there is no cell for it — the grid must not grow, scroll or clip to accommodate it.
  const traitsHeld = loadout.traits.filter((id) => TRAIT_BY_ID.has(id)).length;
  const traitOverflow = Math.max(0, traitsHeld - traits.filter(Boolean).length);

  return {
    weapons,
    equipment,
    traits,
    traitsHeld,
    traitOverflow,
    // "Holding nothing" is all three categories, not just the two that used to be drawn.
    // A traits-only loadout has contents and gets grids; only a genuinely empty one is
    // stated in words rather than rendered as three empty grids.
    empty: !weapons.some(Boolean) && !equipment.some(Boolean) && traitsHeld === 0,
  };
}

/**
 * The preview's ONE text equivalent.
 *
 * Governing: SPEC-0003 Accessibility Requirements, "Loadout Previews Are Supplementary, Not
 * the Card's Identity". Twenty-five cells must not become twenty-five announcements, and the
 * empty ones must not be announced at all — a fifteen-cell trait grid holding four traits
 * must not read as eleven blanks.
 *
 * Weapons are named because a build is identified by them; everything else summarises as a
 * count, because eight tool names in one label is not a summary. The counts describe what the
 * loadout HOLDS and resolves in the catalog, not what is currently drawn: eighteen traits
 * announce as eighteen while fifteen cells are filled.
 */
const plural = (n, word) => `${n} ${n === 1 ? word : `${word}s`}`;

export const PREVIEW_EMPTY_LABEL = "Empty — no weapons, equipment or traits";

export function previewSummary(groups) {
  const parts = groups.weapons.filter(Boolean).map((c) => c.name);
  const tools = groups.equipment.filter((c) => c?.kind === "tool").length;
  const cons = groups.equipment.filter((c) => c?.kind === "consumable").length;

  if (tools) parts.push(plural(tools, "tool"));
  if (cons) parts.push(plural(cons, "consumable"));
  if (groups.traitsHeld) parts.push(plural(groups.traitsHeld, "trait"));

  return parts.length ? `Holds ${parts.join(", ")}` : PREVIEW_EMPTY_LABEL;
}

export default function LoadoutListsPanel() {
  const dispatch = useDispatch();
  const loadouts = useSelector((s) => s.savedLoadouts.items);
  const lists = useSelector((s) => s.loadoutLists.items);
  // Narrow selectors: subscribing to the whole ui slice re-rendered the entire roster on
  // every tab switch, budget tweak and picker keystroke.
  const selectedListId = useSelector((s) => s.ui.selectedListId);
  const unassignedOpen = useSelector((s) => s.ui.unassignedOpen);
  const listSort = useSelector((s) => s.ui.listSort);
  const creatingList = useSelector((s) => s.ui.creatingList);
  const renamingListId = useSelector((s) => s.ui.renamingListId);
  const confirmRetireListId = useSelector((s) => s.ui.confirmRetireListId);

  const groups = useMemo(() => groupByList(loadouts, lists), [loadouts, lists]);
  const countFor = (id) => (groups.get(id) || []).length;
  const ordered = useMemo(
    // hunterNameFor is passed unconditionally. It resolves nothing until SPEC-0004's dataset
    // lands, which is exactly what the "hunter" comparator is specified to handle — and
    // wiring it now is what makes populating hunters.js the only remaining step (issue #120).
    () => sortLists(lists, listSort, { countFor, hunterNameFor }),
    // countFor closes over groups; recompute whenever either input changes.
    [lists, listSort, groups]
  );
  // The roster is module-level and cannot change within a session, so this is computed once.
  const sortKeys = useMemo(() => availableSortKeys({ hasHunterData: HUNTERS.length > 0 }), []);

  const unassigned = groups.get(UNASSIGNED) || [];
  // Resolve rather than trust: a selectedListId can outlive its list (retired in another
  // tab, or restored from localStorage against cleared server data). An unresolved id
  // previously rendered a ghost panel with no title and no controls.
  const openList = lists.find((l) => l.id === selectedListId) || null;
  const isOpen = (id) => (id === UNASSIGNED ? unassignedOpen : selectedListId === id && Boolean(openList));

  const toggle = (id) =>
    id === UNASSIGNED
      ? dispatch(uiActions.openUnassigned(!unassignedOpen))
      : dispatch(uiActions.selectList(isOpen(id) ? null : id));

  return (
    <div className="panel">
      <div className="ll-header">
        <div className="panel-title">Saved loadouts</div>
        <div className="panel-meta">
          {lists.length} {lists.length === 1 ? "list" : "lists"} · {loadouts.length}{" "}
          {loadouts.length === 1 ? "loadout" : "loadouts"}
        </div>
        <label className="ll-sort">
          <span className="sr-only">Order lists by</span>
          <select value={listSort} onChange={(e) => dispatch(uiActions.setListSort(e.target.value))}>
            {sortKeys.map((k) => (
              <option key={k} value={k}>
                Sort: {SORT_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <button className="btn-outline" onClick={() => dispatch(uiActions.setCreatingList(!creatingList))}>
          + New list
        </button>
      </div>

      {creatingList && <CreateList onDone={() => dispatch(uiActions.setCreatingList(false))} />}

      {lists.length === 0 && loadouts.length === 0 && !creatingList && (
        <p className="ll-empty ll-empty-roster">
          No lists yet. Create one to start filing loadouts, or just save — anything unfiled
          lands in Unassigned.
        </p>
      )}

      <div className="ll-grid">
        {/* Unassigned is pinned first regardless of sort — it is a permanent structural
            group, not a peer of the user's lists, so its position never moves. */}
        <ListCard
          id={UNASSIGNED}
          name="Unassigned"
          count={unassigned.length}
          open={isOpen(UNASSIGNED)}
          onToggle={() => toggle(UNASSIGNED)}
          unassigned
        />
        {ordered.map((l) => (
          <ListCard
            key={l.id}
            id={l.id}
            name={l.name}
            hunterId={l.hunterId}
            accent={l.accent}
            count={countFor(l.id)}
            open={isOpen(l.id)}
            onToggle={() => toggle(l.id)}
          />
        ))}
      </div>

      {(unassignedOpen || openList) && (
        <ExpandedList
          list={openList}
          unassigned={unassignedOpen}
          loadouts={unassignedOpen ? unassigned : groups.get(openList.id) || []}
          lists={lists}
          renaming={Boolean(openList) && renamingListId === openList.id}
        />
      )}

      {confirmRetireListId && (
        <RetireDialog
          list={lists.find((l) => l.id === confirmRetireListId)}
          count={countFor(confirmRetireListId)}
        />
      )}
    </div>
  );
}

function ListCard({ id, name, hunterId, accent, count, open, onToggle, unassigned = false }) {
  // A hunter that resolves to no portrait asset falls back to a schematic silhouette; one
  // absent from the dataset does the same without issuing a request. A list with NO hunter
  // keeps its list-name monogram: there is no identity to depict, and drawing a figure
  // would imply one the list never claimed.
  //
  // Decorative alt="": the list name is in the plate below, so announcing the portrait too
  // would read it twice (SPEC-0003 accessibility).
  const hasHunter = !unassigned && Boolean(hunterId);

  return (
    <button
      type="button"
      className={`ll-card${unassigned ? " ll-card-unassigned" : ""}${open ? " ll-card-open" : ""}`}
      // Unassigned is a structural group, never a peer of the user's lists, so it never
      // carries an accent — it keeps its neutral dashed frame (design handoff §2).
      //
      // Set as a custom PROPERTY rather than `borderColor` directly: an inline
      // border-color would outrank every stylesheet rule, silently killing the gold
      // hover/focus-visible frame that tells a keyboard user where they are.
      style={unassigned ? undefined : { "--ll-accent": accentVar(accent) }}
      data-accent={unassigned ? undefined : accent}
      aria-pressed={open}
      onClick={onToggle}
      data-testid={`list-card-${id}`}
    >
      {hasHunter ? (
        <span className="ll-card-art" data-testid={`list-art-${id}`}>
          {/* Governing: ADR-0007 (as amended 2026-08-10), SPEC-0004 REQ "Consumption
              Contract Compatibility". No size: the card upscales the one portrait by
              roughly 1.9×, which SPEC-0003 records as an accepted source-resolution
              ceiling rather than something a second asset could have fixed. */}
          <HunterPortrait hunterId={hunterId} alt="" />
        </span>
      ) : (
        <span className="ll-card-mono" aria-hidden="true">
          {unassigned ? "∴" : monogram(name)}
        </span>
      )}
      <span className="ll-card-plate">
        <span className="ll-card-name">{name}</span>
        <span className="ll-card-count">
          {count} {count === 1 ? "loadout" : "loadouts"}
        </span>
      </span>
    </button>
  );
}

function ExpandedList({ list, unassigned, loadouts, lists, renaming }) {
  const dispatch = useDispatch();
  const [draftName, setDraftName] = useState(list?.name ?? "");
  const inputRef = useRef(null);
  const rootRef = useRef(null);

  // The expanded panel renders below the whole grid; on a phone with several lists a tap
  // otherwise looks like it did nothing.
  useEffect(() => {
    rootRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [list?.id, unassigned]);

  useEffect(() => {
    setDraftName(list?.name ?? "");
  }, [list?.id, list?.name]);

  useEffect(() => {
    if (renaming) inputRef.current?.focus();
  }, [renaming]);

  const commitRename = () => {
    const next = draftName.trim();
    dispatch(uiActions.setRenamingListId(null));
    if (!next || next === list.name) return; // empty input is a no-op, not a rename
    dispatch(renameListThunk({ id: list.id, name: next }));
  };

  return (
    <div
      className="ll-expanded"
      ref={rootRef}
      // The group heading carries the same accent as the card, so a list is recognisable
      // in both places (SPEC-0003: "each SHALL render that accent in the list selector and
      // in its group heading"). Unassigned never carries one.
      style={unassigned ? undefined : { "--ll-accent": accentVar(list?.accent) }}
      data-accent={unassigned ? undefined : list?.accent}
      data-testid="list-expanded"
    >
      <div className="ll-expanded-head">
        {!unassigned && list && (
          <span className="ll-expanded-art" data-testid="list-expanded-art">
            {/* Governing: ADR-0007 (as amended 2026-08-10), SPEC-0004 REQ "Consumption
                Contract Compatibility". The same portrait the cards render — this header
                used to ask for a "full" size, and there is now only the one asset, so the
                ladder is the portrait then the placeholder.
                Eager: it is one image, already on screen, and the header is the thing the
                user just opened. */}
            {list.hunterId ? (
              <HunterPortrait hunterId={list.hunterId} alt="" lazy={false} />
            ) : (
              <span className="ll-card-mono ll-expanded-mono" aria-hidden="true">
                {monogram(list.name)}
              </span>
            )}
          </span>
        )}
        <div className="ll-expanded-title">
          {renaming ? (
            <input
              ref={inputRef}
              className="ll-rename-input"
              value={draftName}
              aria-label="List name"
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") {
                  setDraftName(list.name);
                  dispatch(uiActions.setRenamingListId(null));
                }
              }}
            />
          ) : (
            <>
              <span className="ll-expanded-name">{unassigned ? "Unassigned" : list?.name}</span>
              {!unassigned && (
                <button className="ll-rename" onClick={() => dispatch(uiActions.setRenamingListId(list.id))}>
                  rename
                </button>
              )}
            </>
          )}
          {!unassigned && list && <span className="ll-expanded-hunter">{hunterLine(list.hunterId)}</span>}
          <span className="ll-badge">
            {unassigned ? "Not filed into any list" : "Default list for saved loadouts"}
          </span>
        </div>
        {!unassigned && list && <AccentPicker list={list} />}
        {!unassigned && list && (
          <button
            className="btn-outline ll-retire"
            aria-label={`Retire list: ${list.name}`}
            onClick={() => dispatch(uiActions.setConfirmRetireListId(list.id))}
          >
            Retire
          </button>
        )}
        <button className="btn-outline" onClick={() => dispatch(uiActions.selectList(null))}>
          Close
        </button>
      </div>

      {/* Governing: SPEC-0003 REQ "Saved Loadouts Render as a Card Grid".

          `auto-fill` + `1fr` against a minimum track IS the whole responsive rule: cards
          reflow BY COUNT, never by shedding anything out of the preview inside them. The
          minimum track comes from CARD_MIN_PX so the layout and the size floors it exists
          to protect cannot drift — see the note on those constants. global.css caps that
          track at `min(..., 100%)`, so once the grid is down to one column the column is
          never wider than the panel holding it. */}
      {loadouts.length === 0 ? (
        <p className="ll-empty ll-empty-list">No loadouts filed yet. Save one while this list is open.</p>
      ) : (
        <div
          className="ll-cards"
          style={{ "--ll-card-min": `${CARD_MIN_PX}px` }}
          data-testid="loadout-card-grid"
        >
          {loadouts.map((item) => (
            <LoadoutCard key={item.id} item={item} lists={lists} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Edit a list's accent.
 *
 * Governing: SPEC-0003 REQ "Lists Are Visually Distinguishable Independent of Portrait and
 * Name".
 *
 * A radiogroup rather than six independent buttons: exactly one value is in effect, arrow
 * keys move between the swatches for free, and assistive tech announces "3 of 6" instead of
 * six unrelated toggles. Each swatch is labelled with its colour NAME, because a swatch
 * announced only as a colour block is nothing to a screen-reader user and the palette
 * separates by hue rather than luminance.
 *
 * Nothing here consults the other lists. Picking a colour a sibling already uses is a
 * permitted outcome, so there is no check to fail and no warning to render.
 */
function AccentPicker({ list }) {
  const dispatch = useDispatch();

  return (
    <div className="ll-accent-picker" role="radiogroup" aria-label={`Accent colour for ${list.name}`}>
      {LIST_ACCENTS.map((a) => (
        <button
          key={a.value}
          type="button"
          role="radio"
          aria-checked={list.accent === a.value}
          aria-label={a.name}
          title={a.name}
          className={`ll-accent-swatch${list.accent === a.value ? " ll-accent-swatch-on" : ""}`}
          style={{ background: `var(${a.cssVar})` }}
          onClick={() => dispatch(setListAccentThunk({ id: list.id, accent: a.value }))}
        />
      ))}
    </div>
  );
}

/**
 * One cell of the preview.
 *
 * Governing: ADR-0006 (Organize Saved Loadouts into User-Named Lists Illustrated with Hunter
 * Portraits), ADR-0002 (Source Weapon/Equipment Images from huntshowdown.wiki.gg via a
 * One-Time, Self-Hosted Scrape)
 * Implements: SPEC-0003 REQ "Filed Loadouts Preview Their Contents", SPEC-0001 REQ "Image
 * Coverage Across All Catalog Categories, with Fallback"
 *
 * Imagery goes through ItemThumb precisely so the `/images/{category}/{slug}` convention and
 * the extension-then-SVG fallback chain stay in one place (the same contract as PickerRow,
 * TraitsPanel and EquipmentSlot) rather than being restated here. Lazy, because an expanded
 * list of twenty loadouts is five hundred cells and SPEC-0003 requires the bytes fetched to
 * follow what was scrolled to.
 *
 * An empty cell is drawn and is never announced. It is real information — a loadout with two
 * tools is legible as a loadout with two tools only because the other six cells are visibly
 * empty — but a fifteen-cell trait grid holding four traits must not read as eleven blanks
 * (SPEC-0003, "Loadout Previews Are Supplementary, Not the Card's Identity"). The preview's
 * single `role="img"` already makes its whole subtree presentational; `aria-hidden` here says
 * so a second time, for anything that flattens it.
 */
function PreviewCell({ cell, className }) {
  if (!cell) return <span className={`ll-lp-cell ll-lp-cell-empty ${className}`} aria-hidden="true" />;
  return (
    <ItemThumb
      category={cell.category}
      name={cell.name}
      alt=""
      svgPath={cell.svgPath}
      className={`ll-lp-cell ${className}`}
      loading="lazy"
    />
  );
}

/**
 * The categorised panel.
 *
 * Governing: ADR-0006 (Organize Saved Loadouts into User-Named Lists Illustrated with Hunter
 * Portraits), SPEC-0003 REQ "Filed Loadouts Preview Their Contents"
 *
 * Three groups, in the order a build is read: what it shoots with, what it carries, what the
 * hunter can do. Weapons are drawn largest because a loadout is identified first by them —
 * each spans the preview's full width, which is floored at half the asset's intrinsic width.
 *
 * The category captions are visible and are `aria-hidden`: they label the groups for the eye,
 * while the single `aria-label` below is the whole preview's one announcement. Same for the
 * overflow count — it must not change what a screen-reader user hears, because the label
 * already states the true total.
 */
function LoadoutPreview({ item, loadout }) {
  const groups = useMemo(() => previewGroups(loadout), [loadout]);

  if (groups.empty) {
    return (
      <p className="ll-lp-empty" data-testid={`loadout-preview-${item.id}`}>
        {PREVIEW_EMPTY_LABEL}
      </p>
    );
  }

  return (
    <div
      className="ll-lp"
      role="img"
      aria-label={previewSummary(groups)}
      data-testid={`loadout-preview-${item.id}`}
      // The size floors, handed to the stylesheet rather than duplicated in it. global.css
      // reads every one of these; nothing about a cell's minimum size is written twice.
      style={{
        "--ll-weapon-min": `${WEAPON_MIN_DRAWN_PX}px`,
        "--ll-cell-min": `${CELL_MIN_PX}px`,
        "--ll-preview-gap": `${PREVIEW_GAP_PX}px`,
        "--ll-equip-cols": EQUIP_COLUMNS,
        "--ll-trait-cols": TRAIT_COLUMNS,
      }}
    >
      <div className="ll-lp-group" data-testid={`preview-weapons-${item.id}`}>
        <span className="ll-lp-cap" aria-hidden="true">
          Weapons
        </span>
        {groups.weapons.map((cell, slot) => (
          <PreviewCell key={`w${slot}`} cell={cell} className="ll-lp-weapon" />
        ))}
      </div>

      <div className="ll-lp-group" data-testid={`preview-equipment-${item.id}`}>
        <span className="ll-lp-cap" aria-hidden="true">
          Tools &amp; consumables
        </span>
        <div className="ll-lp-equip">
          {groups.equipment.map((cell, slot) => (
            <PreviewCell key={`e${slot}`} cell={cell} className="ll-lp-slot" />
          ))}
        </div>
      </div>

      <div className="ll-lp-group" data-testid={`preview-traits-${item.id}`}>
        <span className="ll-lp-cap" aria-hidden="true">
          Traits
        </span>
        <div className="ll-lp-traits">
          {groups.traits.map((cell, slot) => (
            <PreviewCell key={`t${slot}`} cell={cell} className="ll-lp-slot" />
          ))}
        </div>
        {groups.traitOverflow > 0 && (
          <span className="ll-lp-more" aria-hidden="true">
            +{groups.traitOverflow} more
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// The loadout description
//
// Governing: ADR-0006 (list filing model), ADR-0007 (dataset carries descriptions),
// SPEC-0003 REQ "Loadouts Carry an Editable Description"
//
// THREE states, and the whole point of the code below is that they never become two:
//
//   null / absent    never edited      -> the list hunter's description, resolved LIVE
//   ""               deliberately blank -> nothing
//   non-empty string the user's words   -> that text
//
// design.md's risk register names the failure directly: "the obvious implementation is a
// truthy check, which silently merges 'never edited' with 'deliberately blank' and makes the
// field impossible to empty". So the resolution is a named function returning a discriminated
// answer, rather than an expression like `item.description || inherited` sprinkled through the
// card — one place to read, one place to test, and `??` where it matters instead of `||`.
//
// The inheritance path is loadout -> list -> hunter -> description, and it is a read-time
// join: the hunters dataset is already indexed by id, so this costs one map access per card
// and writes nothing. A re-scrape that improves a hunter's prose therefore reaches every
// unedited loadout without touching a single stored record, and a loadout moved to another
// list picks up that list's hunter instead — both of those are the intended consequences,
// not side effects.
// ---------------------------------------------------------------------------------------

/**
 * The description a hunter dataset entry offers, or null when it offers none.
 *
 * SPEC-0003 REQ "Hunter Dataset Consumption Contract" requires consumers to tolerate an
 * entry whose description is absent or empty by "rendering no description rather than an
 * empty element". Null from `hunterFor` (a hunterId no longer in the dataset) is the same
 * answer as an entry with no prose in it — there is nothing to inherit either way.
 *
 * This is the ONE place a description may be collapsed to two states, and it is sound here
 * because it is a DEFAULT rather than a stored value: "" and absent both mean the dataset
 * has nothing to offer. The stored field's three states are resolved separately, below.
 */
export function descriptionOf(hunter) {
  const text = hunter?.description;
  return typeof text === "string" && text.length > 0 ? text : null;
}

/**
 * What a loadout card should render for its description, and where that text came from.
 *
 * Returns `{ text, inherited, hunterName }`, where `text` is null when nothing at all is to
 * be rendered — which is BOTH "deliberately blank" (stored "") and "nothing to inherit". The
 * two are indistinguishable on screen by design; they differ in what a subsequent write
 * means, and that difference lives in the stored value, not here.
 *
 * `item.description ?? null` is load-bearing twice over. `||` would send a stored `""` down
 * the inheritance path and make the field impossible to empty, and a strict `=== null` would
 * miss every record written before the field existed — design.md calls out that second one
 * as the same collapse "arriving through a comparison operator rather than through a truthy
 * check". Absent and null are one state; `""` is not part of it.
 */
export function resolveDescription(item, list) {
  const stored = item?.description ?? null;
  if (stored !== null) return { text: stored === "" ? null : stored, inherited: false, hunterName: null };

  const hunter = hunterFor(list?.hunterId);
  const text = descriptionOf(hunter);
  // A loadout in Unassigned, in a list with no portrait, or in one whose hunter has left the
  // roster has nothing to inherit. That is an ordinary state, not an error, and the card
  // stays fully usable.
  return { text, inherited: text !== null, hunterName: text === null ? null : hunter.name };
}

/**
 * The description block on a loadout card: render, edit, clear, restore.
 *
 * Governing: ADR-0006 (list filing model), ADR-0007 (dataset carries descriptions),
 * SPEC-0003 REQ "Loadouts Carry an Editable Description", SPEC-0003 Accessibility
 * Requirements ("Keyboard Navigation").
 *
 * Both texts it can render are UNTRUSTED — the user's own, and the dataset's, which was
 * scraped off-origin and is the less trustworthy of the two. Each is rendered as a JSX text
 * child and never as markup; there is no `dangerouslySetInnerHTML` here and there must not
 * be one added.
 *
 * The editor is a `<textarea>` with explicit save and cancel controls rather than a
 * commit-on-blur field like the list rename above it. A description can be a paragraph, so
 * Tab has to be able to LEAVE the field (SPEC-0003 says so outright) — and with
 * commit-on-blur, tabbing to "cancel" would save on the way there. Escape abandons the edit
 * without writing.
 *
 * "Restore" is offered whenever anything is stored, including the deliberately-blank state,
 * because clearing the field is explicitly NOT the path back to inheriting: it is a distinct
 * action that writes null. It is offered even when the list has no hunter to inherit from —
 * the state it restores is "inherit whatever this list offers", which is meaningful whether
 * or not the list offers anything today.
 *
 * No length cap is enforced here. The cap is the server's (DESCRIPTION_MAX_CHARS), and
 * restating it in the client would put the number in two places; an over-long write is
 * refused and surfaces through the same message banner every other failure uses — and,
 * since a refusal leaves the editor open, over the draft that provoked it.
 *
 * EVERY accessible name below CONTAINS its visible label (WCAG 2.5.3 Label in Name): a Voice
 * Control user says "click more", and a name of "Reveal the whole description" answers to
 * nothing they can see. The loadout's name stays in the name for the reason above; the
 * visible word leads it.
 */
function LoadoutDescription({ item, list }) {
  const dispatch = useDispatch();
  const { text, inherited, hunterName } = resolveDescription(item, list);
  const stored = item.description ?? null;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // What `draft` was SEEDED with. Kept beside it rather than recomputed, because the seed is
  // a snapshot of the moment the editor opened and the values it is derived from are live —
  // see `commit`.
  const [seed, setSeed] = useState("");
  // The reveal. Bounded height is the stylesheet's job (`.ll-lcard-desc-clamped` bounds the
  // collapsed state, `.ll-lcard-desc-open` bounds the revealed one); these are only the
  // states that switch between them.
  const [revealed, setRevealed] = useState(false);
  // Is there anything hidden to reveal? MEASURED, not assumed. The card's width is not
  // knowable from here, so the answer changes with reflow — hence a ResizeObserver rather
  // than a character threshold or an always-on control. Initialised to `true` because the
  // honest default for "not measured yet" is "assume there is more", and because jsdom lays
  // nothing out: under test the initial value is the answer.
  const [clamped, setClamped] = useState(true);

  const fieldRef = useRef(null);
  const triggerRef = useRef(null);
  const paraRef = useRef(null);
  // Which exit is waiting for focus to be re-homed: "editor" or "restore". See below.
  const pendingFocus = useRef(null);

  // `aria-controls` needs the paragraph to have an id, and the testid is already unique per
  // loadout — one string, both jobs.
  const descriptionId = `loadout-desc-${item.id}`;

  useEffect(() => {
    if (editing) fieldRef.current?.focus();
  }, [editing]);

  // Governing: SPEC-0003 Accessibility Requirements ("Focus Management"), WCAG 2.4.3.
  //
  // Every exit from this block unmounts the control that had focus — save, Escape and cancel
  // unmount the editor, and "use hunter's" unmounts ITSELF once the write lands. An unmount
  // drops focus on `<body>`, from which a keyboard user has to Tab back through the header,
  // the sort select, every list card and every preceding loadout card to get back here.
  //
  // So each exit ARMS this ref and the layout effect below hands focus to the control that
  // logically owns the result: the edit/add trigger, which survives all four. A ref plus a
  // layout effect rather than `autoFocus` — the target is chosen by IDENTITY, not by being
  // first in the tab order, and it is focused before the browser paints the new frame.
  //
  // The effect deliberately has no dependency array: it must run on whichever render the
  // departing control actually goes away on, and for "restore" that is a render driven by
  // the thunk resolving, not by any value in this component's own state.
  useLayoutEffect(() => {
    if (!pendingFocus.current) return;
    // Not yet: the control that has focus is still mounted, and moving focus off a live
    // control the user is still on would be the bug rather than the fix.
    if (pendingFocus.current === "editor" && editing) return;
    if (pendingFocus.current === "restore" && stored !== null) return;
    pendingFocus.current = null;
    triggerRef.current?.focus();
  });

  // Governing: SPEC-0003 REQ "Loadouts Carry an Editable Description" ("bounded in height,
  // with an affordance to reveal the rest").
  //
  // The control is offered only when something is actually hidden. An always-on control that
  // reports `aria-expanded="false"` over fully visible text tells a screen-reader user there
  // is more to read when there is not, so the answer has to be measured: `scrollHeight >
  // clientHeight` on the clamped paragraph, re-measured on every reflow.
  //
  // Skipped while revealed — an unclamped paragraph never overflows, so measuring there
  // would answer "nothing is hidden" and delete the control that collapses it again. The
  // last collapsed measurement stands for as long as the paragraph is open.
  useLayoutEffect(() => {
    const el = paraRef.current;
    if (!el || revealed) return undefined;
    const measure = () => {
      // jsdom implements no layout: every box measures 0×0. A zero client height therefore
      // means "nothing measured this", not "nothing is hidden" — so the state is left at its
      // initial `true` and the control stays reachable under test, while a real browser
      // (which always reports a non-zero height for rendered prose) overrules it.
      if (el.clientHeight === 0) return;
      setClamped(el.scrollHeight > el.clientHeight);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text, revealed]);

  const closeEditor = () => {
    pendingFocus.current = "editor";
    setEditing(false);
  };

  const commit = async () => {
    // Compare the draft against the value it was SEEDED with — never against `stored`.
    //
    // The two disagree in exactly one case, and it is the common one: a loadout showing an
    // INHERITED description seeds the field with the hunter's lore while `stored` is null.
    // Comparing against `stored` there makes "click edit to read it, click save" a write of
    // the hunter's prose into the record — which SPEC-0003 forbids outright ("The system
    // MUST NOT write that text into the record in order to display it"), and which silently
    // severs the loadout from its list's hunter for every future re-scrape and every move.
    // The same disagreement turns "add description" then save on an untouched empty field
    // into a write of "", permanently opting the loadout out of inheritance.
    //
    // Seeding is what makes the guard agree with cancel: leaving the editor without touching
    // it writes nothing, by whichever of the three exits the user takes.
    //
    // Adopting the inherited text as one's own therefore requires CHANGING it — which is the
    // deliberate trade. An unchanged save is indistinguishable from a cancel by construction,
    // and the failure mode of the alternative (silent, invisible except for the attribution
    // quietly vanishing) is far worse than "type a word to make it yours".
    if (draft === seed) {
      closeEditor();
      return;
    }
    try {
      await dispatch(describeSaved({ id: item.id, description: draft, loadoutName: item.name })).unwrap();
      closeEditor();
    } catch {
      // The server refused it — over the cap, over the body limit, or offline. The editor
      // stays OPEN with the draft intact: the prose is the whole feature, and closing before
      // the write settled would destroy what the user typed and leave the banner explaining
      // a failure they can no longer retry. The banner is raised by the thunk itself.
    }
  };

  const restore = async () => {
    pendingFocus.current = "restore";
    try {
      await dispatch(describeSaved({ id: item.id, description: null, loadoutName: item.name })).unwrap();
    } catch {
      // The control is still mounted and still has focus; nothing to re-home.
      pendingFocus.current = null;
    }
  };

  if (editing) {
    return (
      <div className="ll-lcard-desc-wrap" data-testid={`loadout-desc-wrap-${item.id}`}>
        <textarea
          ref={fieldRef}
          className="ll-lcard-desc-field"
          aria-label={`Description for ${item.name}`}
          value={draft}
          rows={4}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              // Abandon, writing nothing. Stopped from propagating so the panel's other
              // Escape handlers cannot also act on a key that was meant for this field.
              e.stopPropagation();
              closeEditor();
            }
          }}
        />
        <div className="ll-lcard-desc-controls">
          <button
            className="ll-lcard-desc-btn"
            aria-label={`Save description: ${item.name}`}
            onClick={commit}
          >
            save
          </button>
          <button
            className="ll-lcard-desc-btn"
            aria-label={`Cancel editing description: ${item.name}`}
            onClick={closeEditor}
          >
            cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ll-lcard-desc-wrap" data-testid={`loadout-desc-wrap-${item.id}`}>
      {text !== null && (
        <>
          {/* Visible AND announced. SPEC-0003: an inherited description must not be announced
              as though the user wrote it, and where the distinction is surfaced visually it
              must be available non-visually — so this is one plain element rather than a
              styled cue plus a separate screen-reader-only string that could drift from it. */}
          {inherited && (
            <span className="ll-lcard-desc-from" data-testid={`loadout-desc-from-${item.id}`}>
              From {hunterName}
            </span>
          )}
          <p
            ref={paraRef}
            id={descriptionId}
            // Revealed, the paragraph is a bounded scroll container (`.ll-lcard-desc-open`),
            // and a scroll container that cannot take focus cannot be scrolled by keyboard
            // at all in Chrome — WCAG 2.1.1. So it becomes a tab stop exactly while it is
            // scrollable, and no card adds a stop in its resting state.
            tabIndex={revealed ? 0 : undefined}
            className={`ll-lcard-desc${revealed ? " ll-lcard-desc-open" : " ll-lcard-desc-clamped"}`}
            data-source={inherited ? "inherited" : "own"}
            data-testid={descriptionId}
          >
            {text}
          </p>
          {(clamped || revealed) && (
            <button
              className="ll-lcard-desc-btn"
              aria-expanded={revealed}
              // Names what it expands, so `aria-expanded` describes a target rather than
              // hanging off a control with nothing attached to it.
              aria-controls={descriptionId}
              aria-label={`${revealed ? "Less" : "More"} of description: ${item.name}`}
              onClick={() => setRevealed(!revealed)}
            >
              {revealed ? "less" : "more"}
            </button>
          )}
        </>
      )}
      <button
        ref={triggerRef}
        className="ll-lcard-desc-btn"
        // Names the action AND the loadout, per SPEC-0003's icon/control naming rule: a grid
        // of cards otherwise presents a column of identically named "edit" stops.
        aria-label={`${text === null ? "Add" : "Edit"} description: ${item.name}`}
        onClick={() => {
          const value = stored ?? text ?? "";
          setDraft(value);
          setSeed(value);
          setEditing(true);
        }}
      >
        {text === null ? "add description" : "edit"}
      </button>
      {stored !== null && (
        <button
          className="ll-lcard-desc-btn"
          aria-label={`Use hunter's description: ${item.name}`}
          onClick={restore}
        >
          use hunter's
        </button>
      )}
    </div>
  );
}

/**
 * A saved loadout, as a card.
 *
 * Governing: ADR-0006 (Organize Saved Loadouts into User-Named Lists Illustrated with Hunter
 * Portraits), SPEC-0003 REQ "Saved Loadouts Render as a Card Grid", SPEC-0003 REQ "Filed
 * Loadouts Preview Their Contents"
 *
 * Replaces the flex row: a categorised preview does not fit a row, and stacking full-height
 * rows down a page makes a list of ten unreadable.
 *
 * **It must not read as a list card.** The list selector directly above is already a grid of
 * cards, and two nested card grids invite the reader to mistake a loadout for a list. The
 * distinction cannot rest on size, since both grids reflow — so a loadout card refuses the
 * list card's whole identity rather than shrinking it: no portrait, no accent frame, no
 * loadout count. What it has instead is a titled head with a cost, and three preview grids no
 * list card ever draws.
 *
 * Every control that was reachable on the row is reachable here, and the move affordance is
 * still an explicit `<select>` in the tab order rather than a drag target (SPEC-0003
 * "Keyboard Navigation": filing MUST be achievable without a pointer).
 */
function LoadoutCard({ item, lists }) {
  const dispatch = useDispatch();
  // One decode serves both the cost and the preview — the contents were already in hand,
  // which is the whole reason the preview costs nothing (design.md).
  const loadout = useMemo(() => fromData(item.data), [item.data]);
  const cost = totalCost(loadout);

  return (
    // Named, not bare. SPEC-0003 makes the loadout's name the accessible identity of its
    // card; without a label an `<article>` is announced as an unnamed region boundary, and a
    // grid of them is a run of identical "article" stops. The name is the label rather than
    // merely the first focusable thing inside it.
    <article className="ll-lcard" aria-label={item.name} data-testid={`loadout-card-${item.id}`}>
      <div className="ll-lcard-head">
        <button className="ll-lcard-name" onClick={() => dispatch(loadSavedThunk(item))}>
          {item.name}
        </button>
        <span className="ll-lcard-cost">${cost}</span>
      </div>

      {/* Between the head and the preview, which is the position the card reserved for it.
          The description annotates the loadout, so it reads before the contents it describes
          — and it sits OUTSIDE the preview, which is what keeps it from displacing the
          preview's category structure however long the prose is (SPEC-0003 REQ "Loadouts
          Carry an Editable Description").

          `lists` is passed rather than the resolved list: a dangling `listId` resolves to
          undefined here exactly as it does in the move control above, so a loadout filed
          into a retired list inherits nothing instead of throwing. */}
      <LoadoutDescription item={item} list={lists.find((l) => l.id === item.listId) || null} />

      <LoadoutPreview item={item} loadout={loadout} />

      <div className="ll-lcard-actions">
        {/* SPEC-0003: an explicit, keyboard-operable control — not drag-and-drop. Modelling
            it as state ("which list is this in?") rather than an action means keyboard
            operation, type-ahead and Escape-to-cancel come from the platform. */}
        <label className="ll-lcard-move">
          <span className="sr-only">List for {item.name}</span>
          <select
            // Degrade exactly as groupByList does: a dangling listId matches no <option>, so
            // the card would sit under Unassigned with a blank control.
            value={item.listId && lists.some((l) => l.id === item.listId) ? item.listId : ""}
            onChange={(e) => {
              const next = e.target.value || null;
              dispatch(
                moveSaved({
                  id: item.id,
                  listId: next,
                  loadoutName: item.name,
                  listName: lists.find((l) => l.id === next)?.name ?? null,
                })
              );
            }}
          >
            <option value="">Unassigned</option>
            {[...lists]
              .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
          </select>
        </label>

        <button
          className="icon-btn"
          aria-label={`Delete loadout: ${item.name}`}
          onClick={() => dispatch(deleteSaved(item.id))}
        >
          ✕
        </button>
      </div>
    </article>
  );
}

function CreateList({ onDone }) {
  const dispatch = useDispatch();
  const lists = useSelector((s) => s.loadoutLists.items);
  // Governing: SPEC-0003 REQ "Favorite Hunters". Read here and passed down rather than
  // read inside HunterPicker, which stays presentational — the same discipline that keeps
  // it unable to see `lists` and therefore unable to mark reuse.
  const favorites = useSelector((s) => s.hunterFavorites.ids);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  // `null` here means "no portrait chosen", which is also the value the picker's explicit
  // "No portrait" option produces — they are the same list, so they are the same state.
  const [hunter, setHunter] = useState(null);
  // Whether the user has typed a name of their own. Picking a portrait defaults the name
  // (design handoff §5), but only while the field is still the picker's to fill; once the
  // user has typed, changing portrait must never overwrite what they wrote.
  const [nameTouched, setNameTouched] = useState(false);

  // Preview only. The server assigns the real accent least-used-first against the owner's
  // persisted lists and returns it on the created record, which is what then renders.
  const accentPreview = previewNextAccent(lists);

  const submit = async (e) => {
    e.preventDefault();
    // An empty name with no hunter falls back to a generic default in the thunk; with a
    // hunter it defaults to the hunter's name.
    //
    // Await before closing: dismissing optimistically threw away the typed name whenever
    // the request failed, and the banner error then referred to a form no longer on screen.
    setSaving(true);
    try {
      const created = await dispatch(
        createListThunk({ name, hunterId: hunter?.hunterId ?? null, hunterName: hunter?.hunterName ?? null })
      ).unwrap();
      setName("");
      setHunter(null);
      setNameTouched(false);
      // Creating a list selects it, matching the design handoff: the new card expands
      // immediately, so "created" and "ready to file into" are the same moment.
      dispatch(uiActions.selectList(created.id));
      onDone();
    } catch {
      // Thunk already surfaced the failure; keep the form, the name and the portrait intact.
    } finally {
      setSaving(false);
    }
  };

  const portraitLabel = hunter?.hunterName ?? "No portrait";

  return (
    <>
      <form className="ll-create" onSubmit={submit}>
        <span className="ll-create-title">New list — choose a portrait</span>

        <button className="btn-outline ll-create-portrait" type="button" onClick={() => setPicking(true)}>
          <span className="ll-create-portrait-art" aria-hidden="true">
            {hunter?.hunterId ? (
              <HunterPortrait hunterId={hunter.hunterId} alt="" lazy={false} />
            ) : (
              "?"
            )}
          </span>
          <span>Portrait: {portraitLabel}</span>
        </button>

        <label className="ll-create-label">
          <span>Name</span>
          <input
            autoFocus
            value={name}
            placeholder="defaults to the hunter's name"
            aria-label="New list name"
            onChange={(e) => {
              setName(e.target.value);
              setNameTouched(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") onDone();
            }}
          />
        </label>

        {/* Decorative: the accent is a preview of a value the user did not choose and can
            change afterwards, and it is never the sole differentiator. The name field
            beside it is the identity that matters here. */}
        <span
          className="ll-create-accent"
          style={{ background: accentVar(accentPreview) }}
          title={`Accent: ${accentName(accentPreview)}`}
          aria-hidden="true"
          data-testid="create-accent-preview"
        />

        <button className="btn-primary" type="submit" disabled={saving}>
          {saving ? "Creating…" : "Create list"}
        </button>
        <button className="btn-outline" type="button" onClick={onDone}>
          Cancel
        </button>
      </form>

      {picking && (
        <HunterPicker
          selectedHunterId={hunter?.hunterId ?? null}
          favorites={favorites}
          // Favoriting never closes the picker and never changes the chosen portrait: it is
          // a preference about the roster, not a selection within it.
          onToggleFavorite={({ hunterId, hunterName, favorite }) =>
            dispatch(
              favorite
                ? favoriteHunterThunk({ hunterId, hunterName })
                : unfavoriteHunterThunk({ hunterId, hunterName })
            )
          }
          onClose={() => setPicking(false)}
          onSelect={(chosen) => {
            setHunter(chosen.hunterId ? chosen : null);
            if (!nameTouched) setName(chosen.hunterName ?? "");
            setPicking(false);
          }}
        />
      )}
    </>
  );
}

function RetireDialog({ list, count }) {
  const dispatch = useDispatch();
  const confirmRef = useRef(null);
  const dialogRef = useRef(null);

  const close = () => {
    dispatch(uiActions.setConfirmRetireListId(null));
    // Return focus to whatever opened the dialog, rather than dropping it on <body>.
    returnFocus();
  };

  // aria-modal tells assistive tech the rest of the page does not exist; without a trap,
  // Tab walks straight out of it. The trap, the entry focus and the return focus are now
  // shared with the portrait picker (utils/focusTrap.js) — the spec requires identical
  // behaviour from both dialogs, and two hand-written copies is how they stop matching.
  //
  // This dialog overrides the entry point to its confirm button rather than the generic
  // "first focusable": the destructive action is the one being confirmed, and Cancel is a
  // single Shift+Tab away.
  const { onKeyDown, returnFocus } = useFocusTrap(dialogRef, {
    onEscape: close,
    initialFocusRef: confirmRef,
  });

  if (!list) return null;

  return (
    <div className="ll-overlay" onClick={close}>
      <div
        ref={dialogRef}
        className="ll-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ll-retire-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <h2 id="ll-retire-title">Retire this list?</h2>
        <p>
          “{list.name}” will be removed.{" "}
          {count === 0
            ? "It holds no loadouts — nothing else changes."
            : `Its ${count} ${count === 1 ? "loadout" : "loadouts"} move to Unassigned, not deleted.`}
        </p>
        <div className="ll-dialog-actions">
          <button className="btn-outline" onClick={close}>
            Cancel
          </button>
          <button
            ref={confirmRef}
            className="btn-primary"
            onClick={async () => {
              // Deselecting before the request resolved collapsed the list out from under
              // the user on failure, when it was in fact still there.
              try {
                await dispatch(retireListThunk({ id: list.id, name: list.name })).unwrap();
                dispatch(uiActions.selectList(null));
                close();
              } catch {
                close(); // thunk surfaced the failure; leave the list selected
              }
            }}
          >
            Retire list
          </button>
        </div>
      </div>
    </div>
  );
}
