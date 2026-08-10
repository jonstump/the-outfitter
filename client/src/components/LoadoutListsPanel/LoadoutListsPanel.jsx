// Governing: ADR-0006 (Organize Saved Loadouts into User-Named Lists Illustrated with
// Hunter Portraits), SPEC-0003 REQ "New Lists Default Their Name from the Chosen
// Portrait", SPEC-0003 REQ "List Ordering and Sorting", SPEC-0003 REQ "The Selected List
// Is Client State"
//
// Replaces the flat SavedLoadoutsPanel with a roster of lists that expand in place.
// Expanding a list IS selecting it, so the two states cannot drift apart and no separate
// selection affordance is needed.
//
// Portraits and per-list accent colours are issue #88. This is the names-only phase the
// design handoff describes: monogram tiles stand in for portraits, and the layout is
// otherwise final.

import { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { hunterThumb } from "../../data/catalog.js";
import ItemThumb from "../ItemThumb/ItemThumb.jsx";
import { totalCost } from "../../utils/calc.js";
import { fromData } from "../../utils/loadoutCodec.js";
import { groupByList, sortLists, AVAILABLE_SORT_KEYS, SORT_LABELS, UNASSIGNED } from "../../utils/listOrdering.js";
import { loadSavedThunk } from "../../store/thunks.js";
import { deleteSaved, moveSaved } from "../../store/savedLoadoutsSlice.js";
import { createListThunk, renameListThunk, retireListThunk } from "../../store/loadoutListsSlice.js";
import { uiActions } from "../../store/uiSlice.js";

const monogram = (name) => (name || "?").trim().charAt(0).toUpperCase();

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
    () => sortLists(lists, listSort, { countFor }),
    // countFor closes over groups; recompute whenever either input changes.
    [lists, listSort, groups]
  );

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
            {AVAILABLE_SORT_KEYS.map((k) => (
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

function ListCard({ id, name, hunterId, count, open, onToggle, unassigned = false }) {
  // A hunter with no portrait asset yet falls back to a schematic silhouette via ItemThumb's
  // existing photo-first chain. A list with NO hunter keeps its list-name monogram: there is
  // no identity to depict, and drawing a figure would imply one the list never claimed.
  const silhouette = unassigned ? null : hunterThumb(hunterId);

  return (
    <button
      type="button"
      className={`ll-card${unassigned ? " ll-card-unassigned" : ""}${open ? " ll-card-open" : ""}`}
      aria-pressed={open}
      onClick={onToggle}
      data-testid={`list-card-${id}`}
    >
      {silhouette ? (
        <span className="ll-card-art" data-testid={`list-art-${id}`}>
          {/* Decorative: the list name is in the plate below, so announcing the portrait
              too would read it twice (SPEC-0003 accessibility). Without an explicit alt="",
              ItemThumb would label it with the raw hunter id — "the-rat" — which is worse
              than either alternative. */}
          <ItemThumb category="hunters" name={hunterId} alt="" svgPath={silhouette} />
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
    <div className="ll-expanded" ref={rootRef}>
      <div className="ll-expanded-head">
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
          <span className="ll-badge">
            {unassigned ? "Not filed into any list" : "Default list for saved loadouts"}
          </span>
        </div>
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
          loadouts.map((item) => <LoadoutRow key={item.id} item={item} lists={lists} />)
        )}
      </div>
    </div>
  );
}

function LoadoutRow({ item, lists }) {
  const dispatch = useDispatch();
  const cost = totalCost(fromData(item.data));

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
    </div>
  );
}

function CreateList({ onDone }) {
  const dispatch = useDispatch();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    // An empty name with no hunter falls back to a generic default in the thunk. The
    // hunter picker that supplies hunterId/hunterName is issue #88.
    //
    // Await before closing: dismissing optimistically threw away the typed name whenever
    // the request failed, and the banner error then referred to a form no longer on screen.
    setSaving(true);
    try {
      await dispatch(createListThunk({ name })).unwrap();
      setName("");
      onDone();
    } catch {
      // Thunk already surfaced the failure; keep the form and the name intact.
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="ll-create" onSubmit={submit}>
      <label className="ll-create-label">
        <span>Name</span>
        <input
          autoFocus
          value={name}
          placeholder="defaults to the hunter's name"
          aria-label="New list name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onDone();
          }}
        />
      </label>
      <button className="btn-primary" type="submit" disabled={saving}>
        {saving ? "Creating…" : "Create list"}
      </button>
      <button className="btn-outline" type="button" onClick={onDone}>
        Cancel
      </button>
    </form>
  );
}

function RetireDialog({ list, count }) {
  const dispatch = useDispatch();
  const confirmRef = useRef(null);
  const dialogRef = useRef(null);
  const returnFocusRef = useRef(null);

  const close = () => {
    dispatch(uiActions.setConfirmRetireListId(null));
    // Return focus to whatever opened the dialog, rather than dropping it on <body>.
    returnFocusRef.current?.focus?.();
  };

  useEffect(() => {
    returnFocusRef.current = document.activeElement;
    confirmRef.current?.focus();
  }, []);

  // aria-modal tells assistive tech the rest of the page does not exist; without a trap,
  // Tab walks straight out of it. Keep Tab inside, and handle Escape at the dialog root so
  // it works wherever focus currently sits.
  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      close();
      return;
    }
    if (e.key !== "Tab") return;
    const focusable = dialogRef.current?.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

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
