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
import { totalCost } from "../../utils/calc.js";
import { fromData } from "../../utils/loadoutCodec.js";
import { groupByList, sortLists, SORT_KEYS, SORT_LABELS, UNASSIGNED } from "../../utils/listOrdering.js";
import { loadSavedThunk } from "../../store/thunks.js";
import { deleteSaved, moveSaved } from "../../store/savedLoadoutsSlice.js";
import { createListThunk, renameListThunk, retireListThunk } from "../../store/loadoutListsSlice.js";
import { uiActions } from "../../store/uiSlice.js";

const monogram = (name) => (name || "?").trim().charAt(0).toUpperCase();

export default function LoadoutListsPanel() {
  const dispatch = useDispatch();
  const loadouts = useSelector((s) => s.savedLoadouts.items);
  const lists = useSelector((s) => s.loadoutLists.items);
  const { selectedListId, listSort, creatingList, renamingListId, confirmRetireListId } = useSelector((s) => s.ui);

  const groups = useMemo(() => groupByList(loadouts, lists), [loadouts, lists]);
  const countFor = (id) => (groups.get(id) || []).length;
  const ordered = useMemo(
    () => sortLists(lists, listSort, { countFor }),
    // countFor closes over groups; recompute whenever either input changes.
    [lists, listSort, groups]
  );

  if (loadouts.length === 0 && lists.length === 0) return null;

  const unassigned = groups.get(UNASSIGNED) || [];
  const openList = selectedListId === UNASSIGNED ? null : lists.find((l) => l.id === selectedListId);
  const isOpen = (id) => selectedListId === id;

  const toggle = (id) => dispatch(uiActions.selectList(isOpen(id) ? null : id));

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
            {SORT_KEYS.map((k) => (
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
            count={countFor(l.id)}
            open={isOpen(l.id)}
            onToggle={() => toggle(l.id)}
          />
        ))}
      </div>

      {selectedListId && (
        <ExpandedList
          list={openList}
          unassigned={selectedListId === UNASSIGNED}
          loadouts={groups.get(selectedListId) || []}
          lists={lists}
          renaming={renamingListId === selectedListId}
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

function ListCard({ id, name, count, open, onToggle, unassigned = false }) {
  return (
    <button
      type="button"
      className={`ll-card${unassigned ? " ll-card-unassigned" : ""}${open ? " ll-card-open" : ""}`}
      aria-pressed={open}
      onClick={onToggle}
      data-testid={`list-card-${id}`}
    >
      <span className="ll-card-mono" aria-hidden="true">
        {unassigned ? "∴" : monogram(name)}
      </span>
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
    <div className="ll-expanded">
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
          <span className="ll-badge">Default list for saved loadouts</span>
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
          value={item.listId ?? ""}
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

  const submit = (e) => {
    e.preventDefault();
    // An empty name with no hunter falls back to a generic default in the thunk. The
    // hunter picker that supplies hunterId/hunterName is issue #88.
    dispatch(createListThunk({ name }));
    setName("");
    onDone();
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
      <button className="btn-primary" type="submit">
        Create list
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
  const close = () => dispatch(uiActions.setConfirmRetireListId(null));

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  if (!list) return null;

  return (
    <div className="ll-overlay" onClick={close}>
      <div
        className="ll-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ll-retire-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") close();
        }}
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
            onClick={() => {
              dispatch(retireListThunk({ id: list.id, name: list.name }));
              dispatch(uiActions.selectList(null));
              close();
            }}
          >
            Retire list
          </button>
        </div>
      </div>
    </div>
  );
}
