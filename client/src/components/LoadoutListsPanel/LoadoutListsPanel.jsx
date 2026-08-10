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
import { CONS, TOOLS, WEAPONS, consThumb, toolThumb, weaponThumb } from "../../data/catalog.js";
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
// Loadout row previews
//
// Governing: ADR-0006 (Organize Saved Loadouts into User-Named Lists Illustrated with
// Hunter Portraits), SPEC-0003 REQ "Filed Loadouts Preview Their Contents"
//
// Everything below derives from the loadout the row ALREADY decoded to show its cost. There
// is no summary field, no second fetch and no write: design.md ("Loadout previews are
// derived from the record, never stored") rejected caching precisely because a stored
// summary is a second source of truth that goes stale the moment the catalog changes.
//
// Unresolvable items are not handled here on purpose. `fromData` drops ids the catalog no
// longer carries — a weapon slot decodes to null, an equip entry is filtered out — so a
// preview of a loadout referencing a removed item is simply a preview of what survives. Any
// per-item placeholder written here would be a second, divergent copy of that rule.
// ---------------------------------------------------------------------------------------

/**
 * The loadout's weapons and equipment, in DRAW order — which is also PRIORITY order.
 *
 * Weapons first (slot 0 then slot 1), then equipment in slot order. Because the shedding
 * order the spec mandates is "equipment before weapons, and within each, later slots before
 * earlier ones", that ranking is exactly this list reversed, and shedding is therefore a
 * truncation from the tail rather than a second ordering that could drift from this one.
 */
export function previewEntries(loadout) {
  const weapons = loadout.weapons
    .map((w, slot) => {
      if (!w) return null; // dropped by fromData: the id left the catalog
      const def = WEAPONS[w.i];
      return { key: `w${slot}`, kind: "weapon", category: "weapons", name: def[1], svgPath: weaponThumb(def) };
    })
    .filter(Boolean);

  const equip = loadout.equip.map((e, slot) => {
    const tool = e.t === "T";
    const def = tool ? TOOLS[e.i] : CONS[e.i];
    return {
      key: `e${slot}`,
      kind: tool ? "tool" : "consumable",
      category: tool ? "tools" : "consumables",
      name: def[1],
      svgPath: tool ? toolThumb(def) : consThumb(def),
    };
  });

  return [...weapons, ...equip];
}

/**
 * The row's ONE text equivalent.
 *
 * Governing: SPEC-0003 Accessibility Requirements, "Loadout Previews Are Supplementary, Not
 * the Row's Identity". A dozen tiles must not become a dozen announcements, and the text
 * describes everything that RESOLVES rather than the subset currently drawn — so what a
 * screen-reader user hears does not change when the viewport narrows.
 *
 * Weapons are named because a build is identified by them; equipment and traits summarise as
 * counts because eight tool names in one label is not a summary. Traits appear here (and
 * nowhere else in the preview) as the count the spec leaves open — they are textual rather
 * than iconographic, so a strip of trait tiles would buy nothing.
 */
export function previewSummary(entries, traitCount = 0) {
  const named = entries.filter((e) => e.kind === "weapon").map((e) => e.name);
  const plural = (n, word) => `${n} ${n === 1 ? word : `${word}s`}`;
  const tools = entries.filter((e) => e.kind === "tool").length;
  const cons = entries.filter((e) => e.kind === "consumable").length;

  const parts = [...named];
  if (tools) parts.push(plural(tools, "tool"));
  if (cons) parts.push(plural(cons, "consumable"));
  if (traitCount) parts.push(plural(traitCount, "trait"));

  return parts.length ? `Holds ${parts.join(", ")}` : "Holds nothing";
}

/**
 * How many preview tiles a row may draw at a given viewport width.
 *
 * The spec deliberately specifies a shedding ORDER rather than a breakpoint table, so this
 * table is an implementation detail and can move freely; what it may never do is return a
 * number large enough to push the name, the cost or the move control out of the row. The
 * floor is 2 — at most the two weapon slots — because weapons are the last thing to shed.
 */
const PREVIEW_CAPACITY = [
  [1180, 10],
  [980, 8],
  [820, 6],
  [660, 4],
  [520, 3],
  [0, 2],
];

export function previewCapacity(width) {
  const w = Number.isFinite(width) ? width : 0;
  return (PREVIEW_CAPACITY.find(([min]) => w >= min) ?? [0, 2])[1];
}

/**
 * Truncate to `capacity`, reporting what was dropped so the row can summarise it as a count.
 *
 * Truncating the tail of `previewEntries` IS the specified order: equipment sits after
 * weapons and later slots after earlier ones, so the last thing in the list is always the
 * least identifying thing in the loadout.
 */
export function shedPreview(entries, capacity) {
  const keep = Math.max(0, Math.min(entries.length, Number.isFinite(capacity) ? capacity : entries.length));
  return { shown: entries.slice(0, keep), dropped: entries.length - keep };
}

/**
 * Viewport width, as a re-rendering value.
 *
 * Read once per expanded list rather than once per row: a list of twenty loadouts would
 * otherwise attach twenty identical resize listeners to compute twenty identical numbers.
 */
function useViewportWidth() {
  const [width, setWidth] = useState(() => (typeof window === "undefined" ? 1280 : window.innerWidth));
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    onResize(); // the window may have been resized between the initial state and this effect
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
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
  // One subscription for the whole group; every row sheds against the same number.
  const previewCap = previewCapacity(useViewportWidth());

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

      <div className="ll-rows">
        {loadouts.length === 0 ? (
          <p className="ll-empty">No loadouts filed yet. Save one while this list is open.</p>
        ) : (
          loadouts.map((item) => (
            <LoadoutRow key={item.id} item={item} lists={lists} previewCap={previewCap} />
          ))
        )}
      </div>
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

function LoadoutRow({ item, lists, previewCap }) {
  const dispatch = useDispatch();
  // One decode serves both the cost and the preview — the contents were already in hand,
  // which is the whole reason the preview costs nothing (design.md).
  const loadout = useMemo(() => fromData(item.data), [item.data]);
  const cost = totalCost(loadout);
  const entries = useMemo(() => previewEntries(loadout), [loadout]);
  const summary = previewSummary(entries, loadout.traits.length);
  const { shown, dropped } = shedPreview(entries, previewCap);

  return (
    <div className="ll-row">
      <button className="ll-row-name" onClick={() => dispatch(loadSavedThunk(item))}>
        {item.name}
      </button>
      <span className="ll-row-cost">${cost}</span>

      {/* SPEC-0003: an explicit, keyboard-operable control — not drag-and-drop. Modelling
          it as state ("which list is this in?") rather than an action means keyboard
          operation, type-ahead and Escape-to-cancel come from the platform. */}
      <label className="ll-row-move">
        <span className="sr-only">List for {item.name}</span>
        <select
          // Degrade exactly as groupByList does: a dangling listId matches no <option>, so
          // the row would sit under Unassigned with a blank control.
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

      {/* Governing: ADR-0006 (Organize Saved Loadouts into User-Named Lists Illustrated with
          Hunter Portraits), SPEC-0003 REQ "Filed Loadouts Preview Their Contents".

          Last in the row, and last in the tab/reading order: the name is the row's identity
          and the preview only annotates it (SPEC-0003 "Loadout Previews Are Supplementary").

          `role="img"` + `aria-label` is what makes the whole strip ONE announcement instead
          of a dozen. It also makes the "+N more" count decorative by construction, which is
          required rather than incidental — the label describes everything that resolves, so
          it must not change when the viewport does. */}
      {entries.length === 0 ? (
        <span className="ll-row-preview ll-row-preview-empty" data-testid={`row-preview-${item.id}`}>
          Empty — no weapons or equipment
        </span>
      ) : (
        <span
          className="ll-row-preview"
          role="img"
          aria-label={summary}
          data-testid={`row-preview-${item.id}`}
        >
          {shown.map((e) => (
            // Decorative: the summary above already names everything. Lazy, because an
            // expanded list of twenty loadouts is well over a hundred icons and SPEC-0003
            // requires the bytes to follow what was scrolled to.
            <ItemThumb
              key={e.key}
              category={e.category}
              name={e.name}
              alt=""
              svgPath={e.svgPath}
              className="ll-row-preview-thumb"
              loading="lazy"
            />
          ))}
          {dropped > 0 && (
            <span className="ll-row-preview-more" aria-hidden="true">
              +{dropped} more
            </span>
          )}
        </span>
      )}
    </div>
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
