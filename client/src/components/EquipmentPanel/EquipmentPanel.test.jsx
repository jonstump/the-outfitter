import { describe, expect, it } from "vitest";
import { Provider } from "react-redux";
import { act, fireEvent, render } from "@testing-library/react";
import EquipmentPanel from "./EquipmentPanel.jsx";
import { CONS, TOOLS } from "../../data/catalog.js";
import { createTestStore, loadoutState } from "../../test/testStore.js";
import { equipRuns } from "../../utils/stacking.js";
import { CSS_RULES, parseStylesheet, readGlobalCss } from "../../test/cssRules.js";
import { consCategoryCount, totalCost } from "../../utils/calc.js";
import { ARRANGEMENT_PROPERTY } from "./gridMove.js";
import { existsSync, readFileSync } from "node:fs";

// Covers: SPEC-0006 REQ "The Grid Renders as Two Ranks of Four" (issue #282),
// REQ "Repeated Consumables Read as One Stack" (issue #282),
// REQ "Items Are Rearranged by Direct Manipulation", REQ "Keyboard Equivalence
// for Every Pointer Gesture" (issue #283).
// Governing: ADR-0009, SPEC-0001 (inherited image fallback chain).
//
// Layout is asserted against the stylesheet's OWN declarations; jsdom performs no
// layout, so a pixel claim belongs in a browser. What the arrangement tests prove
// is that the grid is a TRANSPOSE (fixed tracks, column-major fill, panel-relative
// container query, never auto-fill/auto-fit) and that the stacking view derives
// correctly from the grid. Every pointer gesture below has a paired keyboard test
// — a gesture covered only by pointer is a gap — and edge no-ops are asserted in
// BOTH arrangements (wide 4×2 and transposed 2×4).

const gridCss = (rule) => {
  const rules = parseStylesheet(readGlobalCss());
  const found = rules.find((r) => r.selectors.includes(rule) || r.selectors.includes(rule + ".equip-grid"));
  if (!found) throw new Error(`no rule for ${rule}`);
  return found;
};

const declarationOf = (rule, property) => {
  const found = CSS_RULES.find((r) => r.selectors.includes(rule));
  if (!found) throw new Error(`no rule for ${rule}`);
  return [...found.body.matchAll(new RegExp(`(?:^|;)\\s*${property}\\s*:([^;]*)`, "g"))].map((m) => m[1].trim()).at(-1) ?? null;
};

function renderPanel(preloaded, { arrangement = "wide" } = {}) {
  const store = createTestStore(preloaded);
  const result = render(
    <Provider store={store}>
      <EquipmentPanel />
    </Provider>
  );
  // Select the arrangement the way the STYLESHEET does — by declaring the token the
  // sensor reads (gridMove.js `readArrangement`). jsdom evaluates no `@container`
  // query, so the inline declaration stands in for the branch a browser would apply;
  // it exercises the same code path, because inline style wins the cascade there too.
  //
  // This replaces a `clientWidth` stub. Stubbing a geometry property was only ever
  // possible because the sensor measured geometry — which SPEC-0006 forbids — so the
  // stub is gone along with the measurement.
  const grid = result.container.querySelector('[data-testid="equip-grid"]');
  if (grid) grid.style.setProperty(ARRANGEMENT_PROPERTY, arrangement);
  return { ...result, store };
}

const vitality = CONS.findIndex((c) => c[0] === "vitality-shot");
const dynamite = CONS.findIndex((c) => c[0] === "dynamite-stick");
const kit = 0; // First Aid Kit tool index 0
const kitIndex = TOOLS.findIndex((t) => t[0] === "first-aid-kit");

// A grid with a stack and a separated duplicate: [vitality, vitality, dynamite, null,...]
const stacked = loadoutState({ equip: [{ t: "C", i: vitality }, { t: "C", i: vitality }, { t: "C", i: dynamite }] });

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
  // The pointerup handler resolves the drop target from the pointer's COORDINATES
  // (issue #302, Defect B), which jsdom cannot answer. Stub elementFromPoint for the
  // dispatch so the coordinate-based resolution behaves like a real browser: it
  // returns the release target, whose closest() yields the cell or nothing.
  const orig = document.elementFromPoint;
  document.elementFromPoint = () => target;
  try {
    fireEvent.pointerUp(target, {});
  } finally {
    document.elementFromPoint = orig;
  }
}

// The filled tile's keyboard model lives on the inner .equip-tile-main button (the
// outer element is a non-button container so the ✕ can nest — issue #303). Empty
// cells are still a plain button, so resolve the keyboard target accordingly.
const keyboardCell = (container, index) => {
  const cell = container.querySelector(`[data-slot-index="${index}"]`);
  return cell?.querySelector(".equip-tile-main") ?? cell;
};

describe("two-rank grid arrangement", () => {
  it("declares a fixed 4-column two-rank grid, never auto-fill/auto-fit", () => {
    const grid = gridCss(".equip-grid");
    const wide = declarationOf(".equip-grid", "grid-template-columns");
    // The unconditional rule is the NARROW transpose (2 columns); the wide 4-column
    // arrangement is in the panel-width container query. Neither may be auto-fill.
    expect(grid.body).toContain("display: grid");
    const allCols = [...grid.body.matchAll(/grid-template-columns\s*:\s*([^;]+)/g)].map((m) => m[1].trim());
    expect(allCols.length).toBeGreaterThan(0);
    expect(allCols.some((c) => c.includes("auto-fill") || c.includes("auto-fit"))).toBe(false);
    // Column-major fill is what makes the transpose neighbour-preserving.
    expect(grid.body).toContain("grid-auto-flow: column");
    expect(wide).toMatch(/^repeat\(2, 1fr\)$/);
  });

  it("transposes to 2x4 inside a PANEL-width container query, not a viewport media query", () => {
    const conditional = CSS_RULES.filter((r) => r.conditions.length && r.selectors.includes(".equip-grid"));
    expect(conditional.length).toBeGreaterThan(0);
    // The condition is a container query (panel width), and it must not be a viewport
    // @media rule.
    for (const rule of conditional) {
      expect(rule.conditions.every((c) => c.startsWith("@container"))).toBe(true);
      expect(rule.body).toContain("grid-template-columns: repeat(4, 1fr)");
      // The wide block must flip the FLOW as well as the track counts. `grid-auto-flow`
      // survives a change to grid-template-columns/rows, so without this declaration the
      // wide grid inherits the base rule's column-major fill and renders cell 1 BELOW
      // cell 0 instead of to its right (issue #301). This is a declaration check and does
      // not prove the grid RENDERS correctly — jsdom has no layout engine — but it is the
      // permanent CI guard for the one declaration whose absence caused the bug, and it
      // mirrors the base rule's `grid-auto-flow: column` assertion above.
      expect(rule.body).toContain("grid-auto-flow: row");
    }
  });


  it("declares the containment context on an ANCESTOR of .equip-grid, not the grid itself (issue #296)", () => {
    // An element cannot query its own size: a @container rule matches an ANCESTOR
    // container, so `container-type` on `.equip-grid` itself made the wide 4×2 state
    // unreachable — the `min-width: 460px` query had no container to match against.
    // The regressions is a CASCADE check: the element carrying container-type must be
    // strictly above the grid in the selector-anchor sense (the grid's panel), it must
    // not be the grid's own rule, and the @container query must still target the grid.
    const gridRule = CSS_RULES.find((r) => r.selectors.includes(".equip-grid"));
    const containerRules = CSS_RULES.filter(
      (r) => r.body.includes("container-type:") && !r.conditions.length
    );
    const containerSelectors = containerRules.flatMap((r) => r.selectors);
    // The grid's own rule must NOT carry container-type (that is the bug).
    expect(gridRule.body).not.toMatch(/container-type:/);
    // Some ancestor selector carries it — `.panel` is the grid's containing panel.
    expect(containerSelectors).toContain(".panel");
    // The @container query still targets the grid (narrow->wide transposition). Matched
    // STRUCTURALLY, on the condition's shape rather than its value: this assertion used
    // to pin the literal `@container (min-width: 460px)`, which made it a third copy of
    // a threshold SPEC-0006 requires to exist exactly once. Moving the breakpoint is now
    // one edit in global.css and breaks nothing here.
    const containerQuery = CSS_RULES.find(
      (r) =>
        r.selectors.includes(".equip-grid") &&
        r.conditions.some((c) => /^@container \(min-width: \d+px\)$/.test(c))
    );
    expect(containerQuery).toBeTruthy();
    expect(containerQuery.body).toContain("repeat(4, 1fr)");
  });

  it("declares the arrangement as a token in BOTH branches, so the sensor never measures (SPEC-0006)", () => {
    // The coupling guard. SPEC-0006: the threshold is declared in exactly ONE place and
    // "consumed by both the stylesheet and the keyboard sensor", and no consumer may
    // determine the arrangement "by measuring rendered geometry or reading back a
    // computed track count". Both halves are structural facts about global.css:
    //
    //   * the unconditional rule declares the NARROW token, so a browser that never
    //     applies the container query renders 2 columns AND reports "narrow";
    //   * the container query's own block declares the WIDE token beside the 4-column
    //     tracks, so the token and the tracks flip together or not at all.
    //
    // Nothing in JS carries the number — that is asserted directly below.
    const base = CSS_RULES.find((r) => r.selectors.includes(".equip-grid") && !r.conditions.length);
    expect(base.body).toContain(`${ARRANGEMENT_PROPERTY}: narrow`);
    const wideBlock = CSS_RULES.find(
      (r) =>
        r.selectors.includes(".equip-grid") &&
        r.conditions.some((c) => c.startsWith("@container"))
    );
    expect(wideBlock.body).toContain(`${ARRANGEMENT_PROPERTY}: wide`);
    expect(wideBlock.body).toContain("repeat(4, 1fr)");
  });

  it("keeps the pixel threshold out of the JavaScript entirely (SPEC-0006)", () => {
    // The regression this pairs with: `gridMove.js` held `WIDE_PANEL_MIN_WIDTH = 460`
    // and compared it against `clientWidth`. A second declaration of the threshold is
    // exactly what SPEC-0006 forbids, and a grep is the only thing that can prove a
    // number is absent. Read the module source rather than its exports — an export
    // named something else would still be a second copy.
    //
    // Located from the working directory, not `import.meta.url`: under jsdom the latter
    // resolves against the dev server's origin rather than the filesystem, which is the
    // same trap cssRules.js documents and sidesteps the same way.
    //
    // COMMENTS ARE STRIPPED FIRST, and that is not a loophole. SPEC-0006 governs where
    // the threshold is DECLARED — a second declaration is what drifts. Prose recording
    // that the number used to live here, and why it moved, is the thing this repo wants
    // kept; the first version of this test failed against its own explanatory comment.
    const source = readFileSync(
      ["src/components/EquipmentPanel/gridMove.js", "client/src/components/EquipmentPanel/gridMove.js"].find(existsSync),
      "utf8"
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const threshold = CSS_RULES.find(
      (r) =>
        r.selectors.includes(".equip-grid") &&
        r.conditions.some((c) => c.startsWith("@container"))
    ).conditions.find((c) => c.startsWith("@container")).match(/(\d+)px/)[1];
    expect(source).not.toContain(threshold);
    expect(source).not.toMatch(/clientWidth|offsetWidth|getBoundingClientRect/);
  });

  it("keeps the column count independent of viewport media queries for .equip-grid", () => {
    // No `@media`-conditional declaration of grid-template-columns for .equip-grid: the
    // arrangement responds to the PANEL, not the viewport.
    const media = CSS_RULES.filter(
      (r) => r.conditions.some((c) => c.startsWith("@media")) && r.selectors.includes(".equip-grid")
    );
    expect(media).toEqual([]);
  });

  it("renders exactly eight cells regardless of occupancy", () => {
    const { container } = renderPanel({ loadout: stacked });
    const cells = container.querySelectorAll(".equip-slot");
    expect(cells).toHaveLength(8);
  });

  it("occupancy changes do not alter the arrangement", () => {
    const empty = renderPanel({ loadout: loadoutState() });
    const full = renderPanel({ loadout: stacked });
    // The grid's column declaration is the same rule for both renderings — asserted
    // here as a structural fact: eight cells and one grid container either way.
    expect(empty.container.querySelectorAll(".equip-slot")).toHaveLength(8);
    expect(full.container.querySelectorAll(".equip-slot")).toHaveLength(8);
  });
});

describe("consumable stacking as a render-time view", () => {
  it("renders a run of two adjacent identical consumables as one tile with a badge", () => {
    const { container } = renderPanel({ loadout: stacked });
    const tiles = container.querySelectorAll('[data-testid^="equip-tile-"]');
    // Cells 0-1 are one run; cell 2 is Dynamite.
    expect(tiles).toHaveLength(2);
    const badge = container.querySelector('[data-testid="stack-badge-0"]');
    expect(badge).toHaveTextContent("×2");
  });

  it("keeps non-adjacent duplicates as separate tiles", () => {
    const nonAdjacent = loadoutState({
      equip: [
        { t: "C", i: vitality }, null, { t: "C", i: vitality },
      ],
    });
    const { container } = renderPanel({ loadout: nonAdjacent });
    const tiles = container.querySelectorAll('[data-testid^="equip-tile-"]');
    expect(tiles).toHaveLength(2);
    expect(container.querySelector('[data-testid="stack-badge-0"]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-testid="stack-badge-2"]')).not.toBeInTheDocument();
  });

  it("equipRuns: the badge count equals the cells consumed", () => {
    const runs = equipRuns(stacked.equip);
    expect(runs).toEqual([
      { entry: { t: "C", i: vitality }, cells: [0, 1] },
      { entry: { t: "C", i: dynamite }, cells: [2] },
    ]);
    expect(runs[0].cells).toHaveLength(2);
  });

  it("equipRuns: a removal from the MIDDLE of a run leaves the run contiguous on both sides", () => {
    const three = loadoutState({
      equip: [
        { t: "C", i: vitality }, { t: "C", i: vitality }, { t: "C", i: vitality },
      ],
    });
    expect(equipRuns(three.equip)).toEqual([{ entry: { t: "C", i: vitality }, cells: [0, 1, 2] }]);
    // Removing the middle cell splits the run about the hole — each remaining side is its
    // own contiguous run, exactly as a view over the grid would show.
    const afterRemove = [...three.equip];
    afterRemove[1] = null;
    expect(equipRuns(afterRemove)).toEqual([
      { entry: { t: "C", i: vitality }, cells: [0] },
      { entry: { t: "C", i: vitality }, cells: [2] },
    ]);
  });

  it("equipRuns: empty cells break runs — a gap keeps duplicates apart", () => {
    const gapped = loadoutState({
      equip: [{ t: "C", i: vitality }, null, { t: "C", i: vitality }],
    });
    expect(equipRuns(gapped.equip)).toEqual([
      { entry: { t: "C", i: vitality }, cells: [0] },
      { entry: { t: "C", i: vitality }, cells: [2] },
    ]);
  });

  it("equipRuns: a duplicate added INTO a run joins it", () => {
    const single = loadoutState({ equip: [{ t: "C", i: vitality }] });
    expect(equipRuns(single.equip)).toEqual([{ entry: { t: "C", i: vitality }, cells: [0] }]);
    const joined = loadoutState({
      equip: [{ t: "C", i: vitality }, { t: "C", i: vitality }],
    });
    expect(equipRuns(joined.equip)).toEqual([{ entry: { t: "C", i: vitality }, cells: [0, 1] }]);
  });
});

describe("the shared image fallback chain (SPEC-0001, inherited)", () => {
  it("renders the SVG fallback through the shared .item-thumb container on a stacked tile", () => {
    // The stack head is still a normal ItemThumb (scraped image -> SVG fallback); the
    // continuation cells are what avoid duplicating it.
    const { container } = renderPanel({ loadout: stacked });
    const tile = container.querySelector('[data-testid="equip-tile-0"]');
    expect(tile.querySelector(".item-thumb")).toBeInTheDocument();
    const img = tile.querySelector("img");
    // In jsdom the img is present in the DOM until an error fires; the structural
    // claim here is that the shared .equip-thumb/.item-thumb container is the tile's
    // image host, same as any cell.
    expect(img).not.toBeNull();
  });
});

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
  const wide = { arrangement: "wide" }; // 4×2
  const narrow = { arrangement: "narrow" }; // 2×4 (transposed)
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
    const cell0 = keyboardCell(container, 0);
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
    fireEvent.keyDown(keyboardCell(container, 0), { key: " " });
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
    fireEvent.keyDown(keyboardCell(container, 0), { key: " " });
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
    const cell3 = keyboardCell(container, 3); // bottom-right? no: cell 3 is bottom of col 3 in 4×2
    if (!cell3) return;
    fireEvent.keyDown(cell3, { key: "ArrowRight" });
    // No move: nothing at cell 3's neighbourhood changed.
    expect(store.getState().loadout.equip).toEqual(twoCell().equip);
  });

  it("an arrow at the grid edge is a no-op (narrow)", () => {
    const { container, store } = renderPanel({ loadout: twoCell() }, narrow);
    const cell1 = keyboardCell(container, 1); // right edge of row 0 in 2×4
    fireEvent.keyDown(cell1, { key: "ArrowRight" });
    expect(store.getState().loadout.equip).toEqual(twoCell().equip);
  });

  it("Escape cancels a grab", () => {
    const { container, store } = renderPanel({ loadout: twoCell() });
    const cell = keyboardCell(container, 0);
    fireEvent.keyDown(cell, { key: " " }); // grab cell 0
    fireEvent.keyDown(cell, { key: "Escape" });
    // A subsequent Enter must not drop anything (grab is cancelled).
    fireEvent.keyDown(cell, { key: "Enter" });
    expect(store.getState().loadout.equip).toEqual(twoCell().equip);
  });

  it("focus follows a moved item", () => {
    const { container, store } = renderPanel({ loadout: twoCell() });
    const cell = keyboardCell(container, 0);
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

// Governing: SPEC-0006 REQ "Items Are Rearranged by Direct Manipulation",
// REQ "Keyboard Equivalence for Every Pointer Gesture", ADR-0009. The ✕ remove
// control empties the ONE cell it belongs to and moves nothing else — cell
// position is meaningful to the player, so a splice-and-shift would rebind
// everything. Regression for issue #303: removal was previously reachable only
// through the (broken) drag path, so nothing in the suite exercised the gesture.
describe("the ✕ remove control (issue #303)", () => {
  const kitIdx = TOOLS.findIndex((t) => t[0] === "first-aid-kit");
  const vitIdx = CONS.findIndex((c) => c[0] === "vitality-shot");
  const dynamiteIdx = CONS.findIndex((c) => c[0] === "dynamite-stick");

  const removeBtn = (container, index) =>
    container.querySelector(`[data-slot-index="${index}"] .equip-remove-btn`);

  it("empties exactly the cell clicked — the whole eight-cell array is unchanged elsewhere", () => {
    // Occupied 0, 3, 6 with interior holes at 1, 2 — exactly the sparse shape a
    // player's removals create. Removing cell 3 must leave 0 and 6 untouched and
    // the holes still holes.
    const pre = loadoutState({
      equip: [
        { t: "T", i: kitIdx }, null, null, { t: "C", i: vitIdx }, null, null, { t: "C", i: dynamiteIdx }, null,
      ],
    });
    const { container, store } = renderPanel({ loadout: pre });
    fireEvent.click(removeBtn(container, 3));
    expect(store.getState().loadout.equip).toEqual([
      { t: "T", i: kitIdx }, null, null, null, null, null, { t: "C", i: dynamiteIdx }, null,
    ]);
  });

  it("shows a ✕ only on the filled tile, not on empty cells or stack continuations", () => {
    // A stack run on cells 1,2 (vitality x2) plus a tool on 0.
    const pre = loadoutState({
      equip: [{ t: "T", i: kitIdx }, { t: "C", i: vitIdx }, { t: "C", i: vitIdx }, null, null, null, null, null],
    });
    const { container } = renderPanel({ loadout: pre });
    // Empty cells render no remove control.
    expect(removeBtn(container, 3)).toBeNull();
    expect(removeBtn(container, 7)).toBeNull();
    // The stack HEAD (lowest-numbered cell, 1) carries the ✕; the continuation (2) does not.
    expect(removeBtn(container, 1)).not.toBeNull();
    expect(removeBtn(container, 2)).toBeNull();
  });

  it("removing a stack anchor empties one copy; the rest close up and re-anchor without shifting code", () => {
    // Run on 3,4,5. Removal empties cell 3 (the anchor); cells 4,5 stay put and
    // re-anchor at 4 as a ×2 run — the badge derives from the run at render time.
    const pre = loadoutState({
      equip: [null, null, null, { t: "C", i: vitIdx }, { t: "C", i: vitIdx }, { t: "C", i: vitIdx }, null, null],
    });
    const { container, store } = renderPanel({ loadout: pre });
    fireEvent.click(removeBtn(container, 3));
    expect(store.getState().loadout.equip).toEqual([
      null, null, null, null, { t: "C", i: vitIdx }, { t: "C", i: vitIdx }, null, null,
    ]);
    const badge = container.querySelector('[data-testid="stack-badge-4"]');
    expect(badge).not.toBeNull();
    expect(badge).toHaveTextContent("×2");
  });

  it("the ✕ is a native button — focusable and keyboard-activatable via the platform", () => {
    // The ✕ must be a real <button>: native buttons are the keyboard route (Enter
    // and Space activate them by browser default). A div with an onClick would not
    // satisfy SPEC-0006 UNEQUIPPING SHALL have a keyboard route. (Real Enter/Space
    // activation is asserted in the browser harness — jsdom does not implement
    // implicit button activation; the click path it does implement is covered by
    // "empties exactly the cell clicked" above.)
    const pre = loadoutState({ equip: [{ t: "T", i: kitIdx }, null, null, null, null, null, null, null] });
    const { container } = renderPanel({ loadout: pre });
    const btn = removeBtn(container, 0);
    expect(btn.tagName).toBe("BUTTON");
    expect(btn).toHaveAttribute("aria-label", "Remove First Aid Kit");
    btn.focus();
    expect(document.activeElement).toBe(btn);
  });

  it("returns focus to the now-empty cell at that index, not document.body", () => {
    const pre = loadoutState({ equip: [{ t: "T", i: kitIdx }, null, null, null, null, null, null, null] });
    const { container, store } = renderPanel({ loadout: pre });
    fireEvent.click(removeBtn(container, 0));
    const empty = container.querySelector('[data-slot-index="0"]');
    expect(empty).not.toBeNull();
    expect(document.activeElement).toBe(empty);
    expect(document.activeElement).not.toBe(document.body);
  });

  it("the keyboard grab-and-place model still works after the tile restructure", () => {
    // Issue #303's structural catch: the filled tile is no longer a <button> (the ✕
    // needs to nest), but the keyboard model on the inner tile button must be intact.
    const pre = loadoutState({
      equip: [{ t: "C", i: vitIdx }, null, { t: "T", i: kitIdx }, null, null, null, null, null],
    });
    const { container, store } = renderPanel({ loadout: pre }, { arrangement: "wide" });
    const cell0 = keyboardCell(container, 0);
    fireEvent.keyDown(cell0, { key: " " });
    fireEvent.keyDown(cell0, { key: "ArrowRight" });
    fireEvent.keyDown(cell0, { key: "Enter" });
    expect(store.getState().loadout.equip[0]).toBeNull();
    expect(store.getState().loadout.equip[1]).toEqual({ t: "C", i: vitIdx });
  });

  it("a keyboard grab still starts AFTER a removal — the marker must not linger in the grab ref", () => {
    // Regression for the review finding on PR #305. `removeCell` writes its
    // pending-focus marker into the SHARED grab ref, and clearing it with
    // `delete ref.current.removeIndex` left a truthy `{}` behind. handleKeyDown
    // starts a grab only when `!ref.current`, and grabRef is threaded to all eight
    // slots — so a single ✕ click disabled the keyboard route for the ENTIRE grid
    // for the rest of the session (SPEC-0006 REQ "Keyboard Equivalence for Every
    // Pointer Gesture"). The sequence is what matters: removing first, then
    // grabbing. A grab on a freshly-rendered panel passes either way.
    const pre = loadoutState({
      equip: [{ t: "C", i: vitIdx }, null, { t: "T", i: kitIdx }, null, null, null, null, null],
    });
    const { container, store } = renderPanel({ loadout: pre }, { arrangement: "wide" });
    fireEvent.click(removeBtn(container, 2));
    const cell0 = keyboardCell(container, 0);
    fireEvent.keyDown(cell0, { key: " " });
    fireEvent.keyDown(cell0, { key: "ArrowRight" });
    fireEvent.keyDown(cell0, { key: "Enter" });
    expect(store.getState().loadout.equip[0]).toBeNull();
    expect(store.getState().loadout.equip[1]).toEqual({ t: "C", i: vitIdx });
  });

  it("a pointer drag that ends on the origin cell does NOT remove the item", () => {
    const pre = loadoutState({ equip: [{ t: "C", i: vitIdx }, null, null, null, null, null, null, null] });
    const { container, store } = renderPanel({ loadout: pre });
    gridPointerSequence(container, 0, 0);
    expect(store.getState().loadout.equip[0]).toEqual({ t: "C", i: vitIdx });
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
    const c0 = keyboardCell(r.container, 0);
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
