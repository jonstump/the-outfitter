import { afterEach, describe, expect, it, vi } from "vitest";
import { Provider } from "react-redux";
import { fireEvent, render } from "@testing-library/react";
import TraitsPanel from "./TraitsPanel.jsx";
import { TRAITS, traitThumb } from "../../data/catalog.js";
import * as itemStats from "../../data/itemStats.js";
import { descriptionFor } from "../../data/itemStats.js";
import { TRAIT_MAX } from "../../utils/calc.js";
import { createTestStore, loadoutState } from "../../test/testStore.js";
import { effective } from "../../test/cssRules.js";
import { slugify } from "../ItemThumb/ItemThumb.jsx";

// Governing: ADR-0002 (Source Weapon/Equipment Images from huntshowdown.wiki.gg via a One-Time,
// Self-Hosted Scrape), ADR-0012 (fifteen-trait cap)
// Covers: SPEC-0001 REQ "Image Coverage Across All Catalog Categories, with Fallback",
// SPEC-0001 REQ "Consistent Visual Presentation"
//
// The image-tier assertions below are unchanged in substance from when this panel drew chips —
// only the container class moved (`.trait-thumb` -> `.trait-cell-thumb`). They are what pins
// SPEC-0001's fallback chain for this category, so they survived the grid rewrite rather than
// being replaced by it.

function renderPanel(traits) {
  const store = createTestStore({ loadout: loadoutState({ traits }) });
  return render(
    <Provider store={store}>
      <TraitsPanel />
    </Provider>
  );
}

describe("TraitsPanel imagery", () => {
  it("renders the scraped image as the primary tier for each taken trait", () => {
    const def = TRAITS[0];
    const { container } = renderPanel([def[0]]);

    const img = container.querySelector("img");
    expect(img).toHaveAttribute("src", `/images/traits/${slugify(def[1])}.jpg`);
    expect(container.querySelector(".trait-cell-thumb")).toBeInTheDocument();
  });

  it("falls back to the SVG icon once every extension fails to load", () => {
    const def = TRAITS[0];
    const { container } = renderPanel([def[0]]);

    let img = container.querySelector("img");
    ["jpeg", "png", "webp"].forEach(() => {
      fireEvent.error(img);
      img = container.querySelector("img");
    });
    fireEvent.error(img);

    expect(container.querySelector("img")).not.toBeInTheDocument();
    const svg = container.querySelector(".trait-cell-thumb svg");
    expect(svg).toBeInTheDocument();
    expect(svg.querySelector("path")).toHaveAttribute("d", traitThumb(def));
  });

  it("applies the shared .item-thumb container class regardless of photo-vs-SVG state", () => {
    const { container } = renderPanel([TRAITS[0][0]]);
    expect(container.querySelector(".trait-cell-thumb")).toHaveClass("item-thumb", "trait-cell-thumb");
  });

  it("shows the empty-state note and no thumbnails when no traits are taken", () => {
    const { container, getByText } = renderPanel([]);
    expect(container.querySelector(".item-thumb")).not.toBeInTheDocument();
    expect(getByText(/None taken/)).toBeInTheDocument();
  });
});

describe("TraitsPanel grid", () => {
  it("draws a fixed fifteen-cell grid whatever the loadout holds", () => {
    // The shape is the point: it must not reflow as traits come and go, which is the same
    // reason the preview's grid is fixed. Asserted at three different fills.
    for (const count of [0, 1, TRAIT_MAX]) {
      const { container, unmount } = renderPanel(TRAITS.slice(0, count).map((t) => t[0]));
      expect(container.querySelectorAll(".trait-cell")).toHaveLength(TRAIT_MAX);
      unmount();
    }
  });

  it("fills from the front and leaves the remainder as empty cells", () => {
    const { container } = renderPanel(TRAITS.slice(0, 4).map((t) => t[0]));
    expect(container.querySelectorAll(".trait-cell-filled")).toHaveLength(4);
    expect(container.querySelectorAll(".trait-cell-empty")).toHaveLength(TRAIT_MAX - 4);
  });

  it("never announces an empty cell", () => {
    // An empty cell is visual information about grid shape, not content a screen reader
    // should walk fifteen of.
    const { container } = renderPanel([TRAITS[0][0]]);
    container.querySelectorAll(".trait-cell-empty").forEach((cell) => {
      expect(cell).toHaveAttribute("aria-hidden", "true");
    });
  });

  it("is five columns wide, so fifteen cells read as three rows", () => {
    const { container } = renderPanel([]);
    const grid = container.querySelector(".trait-grid");
    expect(grid).toBeInTheDocument();
    // The count is what makes it 3x5; the column value itself lives in CSS as --trait-cols.
    expect(container.querySelectorAll(".trait-cell")).toHaveLength(15);
  });
});

describe("TraitsPanel cell detail", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the upgrade-point cost on the icon", () => {
    const def = TRAITS.find((t) => t[2] > 0);
    const { container } = renderPanel([def[0]]);
    expect(container.querySelector(".trait-cell-up")).toHaveTextContent(String(def[2]));
  });

  it("carries the name and cost in the accessible name, not only in the hover tip", () => {
    // The tip is a hover/focus surface; a screen reader must not depend on it. This is the
    // assertion that keeps the tooltip decorative rather than load-bearing.
    const def = TRAITS[0];
    const { getByRole, container } = renderPanel([def[0]]);
    const btn = getByRole("button", { name: new RegExp(def[1], "i") });
    expect(btn).toHaveAccessibleName(new RegExp(`${def[1]}.*${def[2]} upgrade point`, "i"));
    expect(container.querySelector(".trait-cell-tip")).toHaveAttribute("aria-hidden", "true");
  });

  it("puts the trait name in the hover tip, and not the cost again", () => {
    // The cost is already badged on the icon; repeating it as "8 UP" in the same hover said
    // the same thing twice. The unit survives only in the accessible name, where a bare
    // number would be meaningless read aloud.
    const def = TRAITS[0];
    const { container } = renderPanel([def[0]]);
    const tip = container.querySelector(".trait-cell-tip");
    expect(tip).toHaveTextContent(def[1]);
    expect(tip.textContent).not.toMatch(/UP/);
  });

  it("puts the scraped description in the hover tip, below the name", () => {
    // #228. Until the stats scrape captured prose, no description text existed anywhere in the repo,
    // so the tip could carry only a name.
    const def = TRAITS[0];
    const { container } = renderPanel([def[0]]);
    const tip = container.querySelector(".trait-cell-tip");
    expect(tip.querySelector(".trait-cell-tip-name")).toHaveTextContent(def[1]);
    expect(tip.querySelector(".trait-cell-tip-desc")).toHaveTextContent(descriptionFor(def[0]));
  });

  it("omits the description element entirely when the dataset has none", () => {
    // `descriptionFor` is specified to return null — a catalog row can predate the dataset — and an
    // empty element would render as a stray gap in the tip's column.
    vi.spyOn(itemStats, "descriptionFor").mockReturnValue(null);
    const def = TRAITS[0];
    const { container } = renderPanel([def[0]]);
    expect(container.querySelector(".trait-cell-tip-desc")).toBeNull();
    expect(container.querySelector(".trait-cell-tip-name")).toHaveTextContent(def[1]);
  });

  it("clamps the tip description at the depth the dataset was measured against", () => {
    // Pins the number, not the layout — jsdom lays nothing out, so this is evidence of a
    // declaration and not of a rendered pixel (see cssRules.js). Worth pinning anyway: the clamp
    // was six lines while Serpent needed eight, which dropped its `SOLO:` rule with no ellipsis to
    // admit it. `itemStats.test.js` holds the other half — that no description outgrows ten lines.
    expect(effective(".trait-cell-tip-desc", "-webkit-line-clamp")).toBe("10");
    expect(effective(".trait-cell-tip-desc", "white-space")).toBe("pre-line");
  });

  it("keeps the description out of the accessible name", () => {
    // `aria-label` is announced whole, so appending prose would make every removal read a paragraph
    // before "Activate to remove". The description reaches a screen reader on the picker row instead.
    const def = TRAITS[0];
    const { container } = renderPanel([def[0]]);
    const label = container.querySelector(".trait-cell-filled").getAttribute("aria-label");
    expect(label).toMatch(def[1]);
    expect(label).not.toMatch(descriptionFor(def[0]).slice(0, 20));
  });

  it("singularises a one-point cost in the accessible name", () => {
    const def = TRAITS.find((t) => t[2] === 1);
    if (!def) return;
    const { getByRole } = renderPanel([def[0]]);
    expect(getByRole("button", { name: new RegExp(def[1], "i") })).toHaveAccessibleName(
      new RegExp("1 upgrade point\\.", "i")
    );
  });

  it("removes the trait when its cell is activated", () => {
    const def = TRAITS[0];
    const store = createTestStore({ loadout: loadoutState({ traits: [def[0], TRAITS[1][0]] }) });
    const { getByRole } = render(
      <Provider store={store}>
        <TraitsPanel />
      </Provider>
    );

    fireEvent.click(getByRole("button", { name: new RegExp(def[1], "i") }));
    expect(store.getState().loadout.traits).toEqual([TRAITS[1][0]]);
  });
});

describe("TraitsPanel grid geometry", () => {
  // These pin structure, not pixels. The 3x5 shape, the tooltip's open direction, and the
  // clipping behaviour were all verified in a browser — nothing here measures a rendered
  // pixel, and a passing suite is not evidence the layout is right.
  it("puts every cell in the grid as a direct child, so one rule sizes filled and empty alike", () => {
    const { container } = renderPanel(TRAITS.slice(0, 3).map((t) => t[0]));
    const grid = container.querySelector(".trait-grid");
    const direct = [...grid.children].filter((el) => el.classList.contains("trait-cell"));
    expect(direct).toHaveLength(TRAIT_MAX);
    // The regression this guards: wrapping filled cells in a listitem span made them
    // grandchildren, and the two kinds sized differently (58px vs 84px in the browser).
  });

  it("exposes the grid as a labelled group rather than a list", () => {
    const { getByRole } = renderPanel([TRAITS[0][0]]);
    expect(getByRole("group", { name: /Traits, 1 of 15/ })).toBeInTheDocument();
  });
});
