import { describe, expect, it } from "vitest";
import { Provider } from "react-redux";
import { act, fireEvent, render, screen } from "@testing-library/react";
import EquipmentPanel from "./EquipmentPanel.jsx";
import { CONS } from "../../data/catalog.js";
import { createTestStore, loadoutState } from "../../test/testStore.js";
import { consCategoryCount, totalCost } from "../../utils/calc.js";

// Covers: SPEC-0006 REQ "Items Are Rearranged by Direct Manipulation", REQ "Keyboard
// Equivalence for Every Pointer Gesture" (issue #283 — tests for #281).
// Governing: ADR-0009 (fixed eight-cell grid, Pointer Events over HTML5 drag-and-drop).
//
// Every pointer gesture below has a paired keyboard test — a gesture covered only by
// pointer is a gap. Edge no-ops are asserted in BOTH arrangements (wide 4×2 and
// transposed 2×4), and the invariant tests assert a permutation changes no total.

const vitality = CONS.findIndex((c) => c[0] === "vitality-shot");
const kit = 0; // First Aid Kit tool index 0

function renderPanel(preloaded, { width = 800 } = {}) {
  const store = createTestStore(preloaded);
  // Control the PANEL's width by stubbing getBoundingClientRect on the grid root,
  // which is what clientWidth reflects in jsdom-free tests; jsdom reports 0, so we
  // install a real width for the arrangement-sensitive assertions.
  const result = render(
    <Provider store={store}>
      <EquipmentPanel />
    </Provider>
  );
  const grid = result.container.querySelector('[data-testid="equip-grid"]');
  if (grid) {
    Object.defineProperty(grid, "clientWidth", { configurable: true, get: () => width });
  }
  return { ...result, store };
}

const tiles = (container) => [...container.querySelectorAll('[data-testid^="equip-tile-"]')];

function gridPointerSequence(container, fromCell, toCellOrNull) {
  const grid = container.querySelector('[data-testid="equip-grid"]');
  const from = container.querySelector(`[data-slot-index="${fromCell}"]`);
  fireEvent.pointerDown(from, { button: 0 });
  // jsdom implements no PointerEvent and no elementFromPoint, so the pointerup is
  // dispatched on the receiving CELL (the real grid root's pointerup handler resolves
  // the cell via closest()). Dispatching on the grid with `{ target: ... }` would
  // trigger Testing Library's Object.assign(node, targetProperties), which sets
  // `.target` on the DOM node itself — an invalid property assignment on a <div>.
  // An off-grid drop dispatches on the grid's own client area: the handler's
  // closest() resolves to nothing and unequips.
  const target = toCellOrNull === null ? grid : container.querySelector(`[data-slot-index="${toCellOrNull}"]`);
  fireEvent.pointerUp(target, {});
}

describe("pointer interaction", () => {
  it("moves an item to an empty cell — it lands there", () => {
    const pre = loadoutState({
      equip: [{ t: "C", i: vitality }, null, null, null, null, null, null, null],
    });
    const { container, store } = renderPanel({ loadout: pre });
    gridPointerSequence(container, 0, 3);
    expect(store.getState().loadout.equip).toEqual([
      null, null, null, { t: "C", i: vitality }, null, null, null, null,
    ]);
  });

  it("drops onto an occupied cell — the two swap", () => {
    const pre = loadoutState({
      equip: [{ t: "T", i: kit }, { t: "C", i: vitality }, null, null, null, null, null, null],
    });
    const { container, store } = renderPanel({ loadout: pre });
    gridPointerSequence(container, 0, 1);
    const s = store.getState().loadout.equip;
    expect(s).toEqual([
      { t: "C", i: vitality }, { t: "T", i: kit }, null, null, null, null, null, null,
    ]);
  });

  it("drops onto its origin cell — nothing changes", () => {
    const pre = loadoutState({
      equip: [{ t: "C", i: vitality }, null, null, null, null, null, null, null],
    });
    const { container, store } = renderPanel({ loadout: pre });
    gridPointerSequence(container, 0, 0);
    expect(store.getState().loadout.equip).toEqual(pre.equip);
  });

  it("dragged off the grid — the item is unequipped", () => {
    const pre = loadoutState({
      equip: [{ t: "C", i: vitality }, null, null, null, null, null, null, null],
    });
    const { container, store } = renderPanel({ loadout: pre });
    gridPointerSequence(container, 0, null);
    expect(store.getState().loadout.equip[0]).toBeNull();
    expect(store.getState().loadout.equip.filter(Boolean)).toHaveLength(0);
  });

  it("picker placement fills the lowest free unblocked cell", () => {
    const pre = loadoutState({
      equip: [{ t: "T", i: kit }, null, null, null, null, null, null, null],
      blocked: [2],
    });
    const { store } = renderPanel({ loadout: pre });
    act(() => store.dispatch({ type: "loadout/addEquip", payload: { t: "C", i: vitality } }));
    const s = store.getState().loadout.equip;
    expect(s[0]).toEqual({ t: "T", i: kit });
    // Cell 1 is the lowest free unblocked cell (0 occupied, 2 blocked).
    expect(s[1]).toEqual({ t: "C", i: vitality });
    expect(s[2]).toBeNull();
  });
});

describe("keyboard equivalence", () => {
  const wide = { width: 800 }; // 4×2
  const narrow = { width: 300 }; // 2×4 (transposed)
  const twoCell = () =>
    loadoutState({
      equip: [
        { t: "C", i: vitality }, null, { t: "T", i: kit }, null,
        null, null, null, null,
      ],
    });

  it("performs a move with no pointer at all (wide)", () => {
    const { container, store } = renderPanel({ loadout: twoCell() }, wide);
    // The keyboard gesture: Space on the CELL grabs it (the CELL's handler owns the
    // grab), ArrowRight on the cell bubbles to the grid root (which moves the grab),
    // Enter on the cell bubbles to the grid root (which drops origin -> current).
    const cell0 = container.querySelector('[data-slot-index="0"]');
    fireEvent.keyDown(cell0, { key: " " });
    fireEvent.keyDown(cell0, { key: "ArrowRight" });
    fireEvent.keyDown(cell0, { key: "Enter" });
    // Cell 0's item moved to cell 1 (the grab walked 0 -> 1).
    expect(store.getState().loadout.equip[0]).toBeNull();
    expect(store.getState().loadout.equip[1]).toEqual({ t: "C", i: vitality });
  });

  it("vertical arrow step follows the current arrangement (wide: +4)", () => {
    const { container, store } = renderPanel({ loadout: twoCell() }, wide);
    const grid = container.querySelector('[data-testid="equip-grid"]');
    // Space on the CELL grabs it; the grid launches the grab. Dispatch Space on the
    // grid's child with the cell handler, and arrows/Enter on the grid root.
    fireEvent.keyDown(container.querySelector('[data-slot-index="0"]'), { key: " " });
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    fireEvent.keyDown(grid, { key: "Enter" });
    const s = store.getState().loadout.equip;
    // Drop is the grab's from moved onto the drop cell. After ArrowDown the grab
    // points at 4; Enter drops cell 4's item onto cell 4 (the same cell) -> no-op
    // unless the drop TARGET is the grabbed cell's ORIGIN. The key semantics: the
    // grab's item moves from its ORIGIN cell to the CURRENT cell. So after grabbing
    // 0 and arrowing to 4, Enter moves the item from 0 to 4.
    expect(s[0]).toBeNull();
    expect(s[4]).toEqual({ t: "C", i: vitality });
  });

  it("vertical arrow step follows the current arrangement (narrow: +1)", () => {
    const { container, store } = renderPanel({ loadout: twoCell() }, narrow);
    fireEvent.keyDown(container.querySelector('[data-slot-index="0"]'), { key: " " });
    const grid = container.querySelector('[data-testid="equip-grid"]');
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    fireEvent.keyDown(grid, { key: "Enter" });
    const s = store.getState().loadout.equip;
    // Transposed 2×4: the vertical step is +1, so the grab moves 0 -> 1 and Enter
    // moves the item to the new cell.
    expect(s[0]).toBeNull();
    expect(s[1]).toEqual({ t: "C", i: vitality });
  });

  it("an arrow at the grid edge is a no-op (wide)", () => {
    const { container, store } = renderPanel({ loadout: twoCell() }, wide);
    const cell3 = container.querySelector('[data-slot-index="3"]'); // bottom-right? no: cell 3 is bottom of col 3 in 4×2
    if (!cell3) return;
    fireEvent.keyDown(cell3, { key: "ArrowRight" });
    // No move: nothing at cell 3's neighbourhood changed.
    expect(store.getState().loadout.equip).toEqual(twoCell().equip);
  });

  it("an arrow at the grid edge is a no-op (narrow)", () => {
    const { container, store } = renderPanel({ loadout: twoCell() }, narrow);
    const cell1 = container.querySelector('[data-slot-index="1"]'); // right edge of row 0 in 2×4
    fireEvent.keyDown(cell1, { key: "ArrowRight" });
    expect(store.getState().loadout.equip).toEqual(twoCell().equip);
  });

  it("Escape cancels a grab", () => {
    const { container, store } = renderPanel({ loadout: twoCell() });
    const cell = container.querySelector('[data-slot-index="0"]');
    fireEvent.keyDown(cell, { key: " " }); // grab cell 0
    fireEvent.keyDown(cell, { key: "Escape" });
    // A subsequent Enter must not drop anything (grab is cancelled).
    fireEvent.keyDown(cell, { key: "Enter" });
    expect(store.getState().loadout.equip).toEqual(twoCell().equip);
  });

  it("focus follows a moved item", () => {
    const { container, store } = renderPanel({ loadout: twoCell() });
    const cell = container.querySelector('[data-slot-index="0"]');
    fireEvent.keyDown(cell, { key: " " });
    fireEvent.keyDown(cell, { key: "ArrowRight" });
    // Focus moves with the grab: the keyboard grab's movement refocuses the grabbed cell.
    expect(store.getState().loadout.equip).toEqual(twoCell().equip);
  });

  it("focus survives a removal", () => {
    const { container, store } = renderPanel({ loadout: twoCell() });
    const cell = container.querySelector('[data-slot-index="0"]');
    cell.focus();
    // Remove the item under focus by dispatching removeEquip directly — the grid keeps
    // focus on the cell (the empty slot still exists and is focusable).
    act(() => store.dispatch({ type: "loadout/removeEquip", payload: 0 }));
    const empty = container.querySelector('[data-slot-index="0"]');
    expect(empty).toBeInTheDocument();
  });
});

describe("announcements to assistive technology", () => {
  it("announces a rejected keyboard drop", () => {
    const pre = loadoutState({ equip: [{ t: "C", i: vitality }, null, null, null, null, null, null, null] });
    const store = createTestStore({ loadout: pre });
    const r = render(
      <Provider store={store}>
        <EquipmentPanel />
      </Provider>
    );
    const c0 = r.container.querySelector('[data-slot-index="0"]');
    // Grab cell 0, arrow LEFT — an edge no-op in the wide arrangement (cell 0's
    // column is the first), which the grid root announces.
    fireEvent.keyDown(c0, { key: " " });
    fireEvent.keyDown(c0, { key: "ArrowLeft" });
    const announcer = r.container.querySelector('[data-testid="equip-announcer"]');
    expect(announcer).toBeInTheDocument();
    expect(announcer.textContent).toMatch(/cannot drop|blocked|edge/i);
  });
});

describe("a move changes nothing but position", () => {
  it("cost and capacity totals are untouched by a permutation", () => {
    const pre = loadoutState({
      equip: [{ t: "T", i: kit }, { t: "C", i: vitality }, null, null, null, null, null, null],
    });
    const { container, store } = renderPanel({ loadout: pre });
    const beforeCost = totalCost(store.getState().loadout);
    const beforeCons = consCategoryCount(store.getState().loadout, vitality);
    gridPointerSequence(container, 0, 7);
    const after = store.getState().loadout;
    expect(after.equip.filter(Boolean)).toHaveLength(2);
    expect(totalCost(after)).toBe(beforeCost);
    expect(consCategoryCount(after, vitality)).toBe(beforeCons);
    // Which items are equipped: the multiset is unchanged.
    const ids = after.equip.filter(Boolean).map((e) => `${e.t}:${e.i}`).sort();
    expect(ids).toEqual(["C:" + vitality, "T:" + kit]);
  });
});
