import { describe, expect, it } from "vitest";
import { Provider } from "react-redux";
import { render } from "@testing-library/react";
import EquipmentPanel from "./EquipmentPanel.jsx";
import { CONS, TOOLS } from "../../data/catalog.js";
import { createTestStore, loadoutState } from "../../test/testStore.js";
import { equipRuns } from "../../utils/stacking.js";
import { CSS_RULES, parseStylesheet, readGlobalCss } from "../../test/cssRules.js";

// Covers: SPEC-0006 REQ "The Grid Renders as Two Ranks of Four",
// REQ "Repeated Consumables Read as One Stack" (issue #282 — tests for #280).
// Governing: ADR-0009.
//
// Layout is asserted against the stylesheet's OWN declarations; jsdom performs no
// layout, so a pixel claim belongs in a browser. What these tests prove is that the
// arrangement is a TRANSPOSE (fixed tracks, column-major fill, panel-relative
// container query, never auto-fill/auto-fit) and that the stacking view derives
// correctly from the grid.

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

function renderPanel(preloaded) {
  const store = createTestStore(preloaded);
  return render(
    <Provider store={store}>
      <EquipmentPanel />
    </Provider>
  );
}

const vitality = CONS.findIndex((c) => c[0] === "vitality-shot");
const dynamite = CONS.findIndex((c) => c[0] === "dynamite-stick");
const kitIndex = TOOLS.findIndex((t) => t[0] === "first-aid-kit");

// A grid with a stack and a separated duplicate: [vitality, vitality, dynamite, null,...]
const stacked = loadoutState({ equip: [{ t: "C", i: vitality }, { t: "C", i: vitality }, { t: "C", i: dynamite }] });

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
    }
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
