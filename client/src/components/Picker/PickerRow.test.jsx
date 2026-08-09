import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import PickerRow from "./PickerRow.jsx";
import { WEAPONS, weaponThumb } from "../../data/catalog.js";
import { slugify } from "../ItemThumb/ItemThumb.jsx";

// Governing: ADR-0002 (Source Weapon/Equipment Images from huntshowdown.wiki.gg via a One-Time,
// Self-Hosted Scrape)
// Covers: SPEC-0001 REQ "Image Coverage Across All Catalog Categories, with Fallback",
// SPEC-0001 REQ "Consistent Visual Presentation"
//
// PickerRow takes no Redux state directly — Picker.jsx builds a plain `row` object per catalog
// item (see buildRows() in Picker.jsx) and always passes showThumb={true} today, on all four
// tabs (Weapons/Tools/Consumables/Traits), not just Weapons. Both aspects are covered here.

const weaponIndex = WEAPONS.findIndex((w) => w[4] === "compact");
const def = WEAPONS[weaponIndex];

function makeRow(overrides) {
  return {
    key: weaponIndex,
    name: def[1],
    meta: "Compact ammo",
    badge: "Size " + def[2],
    badgeColor: "#b08d4f",
    category: "weapons",
    thumb: weaponThumb(def),
    costStr: "$" + def[3],
    enabled: true,
    onAdd: vi.fn(),
    ...overrides,
  };
}

describe("PickerRow", () => {
  it("renders the scraped image as the primary tier when showThumb is true", () => {
    const { container } = render(<PickerRow row={makeRow()} showThumb />);
    const img = container.querySelector("img");
    expect(img).toHaveAttribute("src", `/images/weapons/${slugify(def[1])}.jpg`);
    expect(container.querySelector(".picker-row-thumb")).toBeInTheDocument();
  });

  it("falls back to the SVG icon once every extension fails to load", () => {
    const { container } = render(<PickerRow row={makeRow()} showThumb />);
    let img = container.querySelector("img");
    ["jpeg", "png", "webp"].forEach(() => {
      fireEvent.error(img);
      img = container.querySelector("img");
    });
    fireEvent.error(img);

    expect(container.querySelector("img")).not.toBeInTheDocument();
    const svg = container.querySelector(".picker-row-thumb svg");
    expect(svg).toBeInTheDocument();
    expect(svg.querySelector("path")).toHaveAttribute("d", weaponThumb(def));
  });

  it("applies the shared .item-thumb container class regardless of photo-vs-SVG state", () => {
    const { container } = render(<PickerRow row={makeRow()} showThumb />);
    expect(container.querySelector(".picker-row-thumb")).toHaveClass(
      "item-thumb",
      "picker-row-thumb"
    );
  });

  it("renders no thumbnail when showThumb is false", () => {
    const { container } = render(<PickerRow row={makeRow()} showThumb={false} />);
    expect(container.querySelector(".item-thumb")).not.toBeInTheDocument();
  });

  it("invokes onAdd when an enabled row is clicked", () => {
    const row = makeRow();
    const { getByRole } = render(<PickerRow row={row} showThumb />);
    fireEvent.click(getByRole("button"));
    expect(row.onAdd).toHaveBeenCalledTimes(1);
  });
});
