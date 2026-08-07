import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import ItemThumb, { slugify } from "./ItemThumb.jsx";

// Governing: ADR-0002 (Source Weapon/Equipment Images from huntshowdown.wiki.gg via a One-Time,
// Self-Hosted Scrape)
// Covers: SPEC-0001 REQ "Image Coverage Across All Catalog Categories, with Fallback",
// SPEC-0001 REQ "Consistent Visual Presentation"
//
// ItemThumb is the shared render primitive behind all four category call sites (WeaponSlot,
// EquipmentSlot, TraitsPanel, PickerRow). It has no `IMAGES` manifest to look up — see the note at
// the top of ItemThumb.jsx and catalog.js — instead it optimistically renders an <img> pointed at
// the guessed scraped-image URL and only swaps to the SVG fallback once every known extension has
// 404'd via the browser's onError event. jsdom never actually loads <img src>, so both the
// "photo renders" and "cascades to SVG fallback" behaviors are driven explicitly here with
// fireEvent.error rather than relying on real network success/failure.

const SVG_PATH = "M10 12h44v7H30l-5 14H13l5-14h-8z";

describe("slugify", () => {
  it("lowercases, trims, and hyphenates non-alphanumeric runs", () => {
    expect(slugify("Nagant M1895")).toBe("nagant-m1895");
    expect(slugify("  Caldwell Rival 78  ")).toBe("caldwell-rival-78");
    expect(slugify("LeMat Mark II")).toBe("lemat-mark-ii");
  });

  it("trims leading/trailing hyphens produced by punctuation at the edges", () => {
    expect(slugify("--Test--")).toBe("test");
  });
});

describe("ItemThumb", () => {
  it("renders the scraped image as the primary tier when a category is given", () => {
    const { container } = render(
      <ItemThumb category="weapons" name="Nagant M1895" svgPath={SVG_PATH} />
    );
    const img = container.querySelector("img");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", "/images/weapons/nagant-m1895.jpg");
    expect(img).toHaveAttribute("alt", "Nagant M1895");
    // No SVG fallback yet — the photo tier hasn't failed.
    expect(container.querySelector("svg")).not.toBeInTheDocument();
  });

  it("cascades through known extensions on error before falling back to the SVG", () => {
    const { container } = render(
      <ItemThumb category="weapons" name="Nagant M1895" svgPath={SVG_PATH} />
    );
    let img = container.querySelector("img");
    expect(img).toHaveAttribute("src", "/images/weapons/nagant-m1895.jpg");

    fireEvent.error(img);
    img = container.querySelector("img");
    expect(img).toHaveAttribute("src", "/images/weapons/nagant-m1895.jpeg");

    fireEvent.error(img);
    img = container.querySelector("img");
    expect(img).toHaveAttribute("src", "/images/weapons/nagant-m1895.png");

    fireEvent.error(img);
    img = container.querySelector("img");
    expect(img).toHaveAttribute("src", "/images/weapons/nagant-m1895.webp");

    // Last known extension also fails -> falls back to the SVG icon (SVG-only-forever behavior
    // from before #8 is gone: this is a *last resort*, not the only tier, even for Weapons).
    fireEvent.error(img);
    expect(container.querySelector("img")).not.toBeInTheDocument();
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute("aria-label", "Nagant M1895");
    expect(svg.querySelector("path")).toHaveAttribute("d", SVG_PATH);
  });

  it("renders the SVG fallback immediately when no category is supplied", () => {
    const { container } = render(<ItemThumb name="Mystery Item" svgPath={SVG_PATH} />);
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("applies a custom svgFill only in the SVG fallback branch", () => {
    const { container } = render(
      <ItemThumb name="Mystery Item" svgPath={SVG_PATH} svgFill="#123456" />
    );
    expect(container.querySelector("svg path")).toHaveAttribute("fill", "#123456");
  });

  it("applies the shared .item-thumb container class consistently for both photo and SVG states", () => {
    const { container: photoContainer } = render(
      <ItemThumb category="weapons" name="Nagant M1895" svgPath={SVG_PATH} className="weapon-thumb" />
    );
    const photoSpan = photoContainer.querySelector("span");
    expect(photoSpan).toHaveClass("item-thumb", "weapon-thumb");

    const { container: svgContainer } = render(
      <ItemThumb name="Mystery Item" svgPath={SVG_PATH} className="weapon-thumb" />
    );
    const svgSpan = svgContainer.querySelector("span");
    expect(svgSpan).toHaveClass("item-thumb", "weapon-thumb");

    // Same wrapper class list regardless of which child (img vs svg) is inside it.
    expect(photoSpan.className).toBe(svgSpan.className);
  });

  it("renders without an extra modifier class when none is passed", () => {
    const { container } = render(<ItemThumb name="Mystery Item" svgPath={SVG_PATH} />);
    expect(container.querySelector("span")).toHaveClass("item-thumb");
  });
});
