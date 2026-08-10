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
// through HunterPortrait, which owns the size-then-placeholder fallback ladder; the accent
// renders as the card frame and the expanded header's rule, and is editable there.
//
// The accent is never the only thing separating two lists — the name is on every card, in
// the expanded header, and in the move-to-list select. The palette separates by hue rather
// than luminance, so anything that made the accent load-bearing would be unreadable to a
// colour-blind user.

import { useEffect, useMemo, useRef, useState } from "react";
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
import { HUNTERS, hunterNameFor } from "../../data/hunters.js";
import { LIST_ACCENTS, accentName, accentVar, previewNextAccent } from "../../utils/listAccent.js";
import { useFocusTrap } from "../../utils/focusTrap.js";
import { loadSavedThunk } from "../../store/thunks.js";
import { deleteSaved, moveSaved } from "../../store/savedLoadoutsSlice.js";
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
 */
export const WEAPON_ASSET_WIDTH = 512; // client/public/images/weapons/*.png are 512×128
export const WEAPON_MIN_DRAWN_PX = WEAPON_ASSET_WIDTH / 2;
export const CELL_MIN_PX = 48;
export const PREVIEW_GAP_PX = 4;
/** Card padding (12) + border (1) on each side, around a preview at its floor. */
export const CARD_MIN_PX = WEAPON_MIN_DRAWN_PX + 2 * 12 + 2 * 1;

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
          <HunterPortrait hunterId={hunterId} size="thumb" alt="" />
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
            {/* Full size here, thumbnail on the cards — and each falls back to the other
                before the placeholder (SPEC-0003 "Hunter Dataset Consumption Contract").
                Eager: it is one image, already on screen, and the header is the thing the
                user just opened. */}
            {list.hunterId ? (
              <HunterPortrait hunterId={list.hunterId} size="full" alt="" lazy={false} />
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
          to protect cannot drift — see the note on those constants. */}
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
    <article className="ll-lcard" data-testid={`loadout-card-${item.id}`}>
      <div className="ll-lcard-head">
        <button className="ll-lcard-name" onClick={() => dispatch(loadSavedThunk(item))}>
          {item.name}
        </button>
        <span className="ll-lcard-cost">${cost}</span>
      </div>

      {/* A description belongs here, between the head and the preview, when #140 lands
          (SPEC-0003 REQ "Loadouts Carry an Editable Description"). Nothing is rendered for
          it today — the position is reserved in the layout, not occupied by an empty node. */}

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
              <HunterPortrait hunterId={hunter.hunterId} size="thumb" alt="" lazy={false} />
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
