import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import ItemThumb, { extensionsFor, slugify } from "./ItemThumb.jsx";

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

describe("hunter portraits (SPEC-0004 assets)", () => {
  it("requests the AVIF the scrape actually writes, first try", () => {
    // SPEC-0004 encodes portraits as AVIF only. Walking jpg/jpeg/png/webp first would cost four
    // guaranteed 404s per portrait on a picker that renders the whole roster.
    const { container } = render(
      <ItemThumb category="hunters" name="bad-hand" alt="" svgPath={SVG_PATH} />
    );
    expect(container.querySelector("img")).toHaveAttribute("src", "/images/hunters/bad-hand.avif");
  });

  it("falls straight to the silhouette when the portrait is absent", () => {
    // SPEC-0003 requires a hunter with no portrait asset to render the placeholder, not a broken
    // image — and to get there in one step, not five.
    const { container } = render(
      <ItemThumb category="hunters" name="no-art" alt="" svgPath={SVG_PATH} />
    );
    fireEvent.error(container.querySelector("img"));
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("leaves every other category's chain untouched", () => {
    expect(extensionsFor("weapons")).toEqual(["jpg", "jpeg", "png", "webp"]);
    expect(extensionsFor("traits")).toEqual(["jpg", "jpeg", "png", "webp"]);
    expect(extensionsFor(undefined)).toEqual(["jpg", "jpeg", "png", "webp"]);
    expect(extensionsFor("hunters")).toEqual(["avif"]);
  });
});

describe("explicit source chain (SPEC-0003 portraits)", () => {
  // Hunter portraits need the chain to walk two SIZES rather than two extensions, so the
  // caller supplies the candidates instead of having them derived from category + name.
  // Same onError machinery, different candidate list.
  it("walks the caller's candidates in order before the SVG", () => {
    const { container } = render(
      <ItemThumb sources={["/a.avif", "/b.avif"]} name="x" alt="" svgPath={SVG_PATH} />
    );
    expect(container.querySelector("img")).toHaveAttribute("src", "/a.avif");
    fireEvent.error(container.querySelector("img"));
    expect(container.querySelector("img")).toHaveAttribute("src", "/b.avif");
    fireEvent.error(container.querySelector("img"));
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders the SVG immediately for an empty candidate list, issuing no request", () => {
    const { container } = render(<ItemThumb sources={[]} name="x" alt="" svgPath={SVG_PATH} />);
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("lets sources override the category derivation rather than racing it", () => {
    const { container } = render(
      <ItemThumb category="hunters" sources={["/explicit.avif"]} name="the-rat" alt="" svgPath={SVG_PATH} />
    );
    expect(container.querySelector("img")).toHaveAttribute("src", "/explicit.avif");
  });

  it("defers loading only when asked", () => {
    // 242 picker tiles must load what was scrolled to; a handful of item rows should not
    // pay the deferral cost, so eager stays the default.
    const { container: lazy } = render(
      <ItemThumb sources={["/a.avif"]} name="x" alt="" svgPath={SVG_PATH} loading="lazy" />
    );
    expect(lazy.querySelector("img")).toHaveAttribute("loading", "lazy");

    const { container: eager } = render(<ItemThumb category="weapons" name="Winfield" svgPath={SVG_PATH} />);
    expect(eager.querySelector("img")).not.toHaveAttribute("loading");
  });
});

describe("decorative mode", () => {
  it("labels the image with its name by default", () => {
    render(<ItemThumb category="weapons" name="Winfield M1873" svgPath="M0 0h1v1H0z" />);
    expect(screen.getByAltText("Winfield M1873")).toBeInTheDocument();
  });

  it('hides the SVG fallback from assistive tech when alt="" is passed', () => {
    // Without this, a silhouette announces the raw internal id (e.g. "the-rat") next to a
    // visible list name — read twice, and once meaninglessly.
    const { container } = render(<ItemThumb name="the-rat" alt="" svgPath="M0 0h1v1H0z" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).not.toHaveAttribute("aria-label");
  });

  it("labels the SVG fallback when no alt is given", () => {
    const { container } = render(<ItemThumb name="Knife" svgPath="M0 0h1v1H0z" />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-label", "Knife");
  });
});

// Covers: SPEC-0003 REQ "Hunter Dataset Consumption Contract"
//
// How far the fallback chain has walked is state about one candidate list. A component
// instance reused at a stable JSX position — the expanded-list header as the open list
// switches, the create-form preview across successive picks — must not carry one subject's
// exhausted chain onto the next. jsdom loads no images, so the failures are driven with
// fireEvent.error, exactly as the cascade tests above do.
describe("fallback state across subjects", () => {
  it("re-derives from the new candidates when sources change on a reused instance", () => {
    const { rerender, container } = render(
      <ItemThumb name="a" alt="" sources={["/images/hunters/a-thumb.avif", "/images/hunters/a.avif"]} svgPath={SVG_PATH} />
    );

    // Exhaust A's chain: both candidates 404, so A lands on the silhouette.
    fireEvent.error(container.querySelector("img"));
    fireEvent.error(container.querySelector("img"));
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).toBeInTheDocument();

    // Same position, different hunter. B's portrait exists — it must be attempted, not
    // skipped because A's attempt failed.
    rerender(
      <ItemThumb name="b" alt="" sources={["/images/hunters/b-thumb.avif", "/images/hunters/b.avif"]} svgPath={SVG_PATH} />
    );
    expect(container.querySelector("img")).toHaveAttribute("src", "/images/hunters/b-thumb.avif");
  });

  it("restarts at the first candidate rather than mid-chain", () => {
    const { rerender, container } = render(
      <ItemThumb name="a" alt="" sources={["/images/hunters/a-thumb.avif", "/images/hunters/a.avif"]} svgPath={SVG_PATH} />
    );

    // One failure only: A has advanced to its SECOND candidate but has not given up.
    fireEvent.error(container.querySelector("img"));
    expect(container.querySelector("img")).toHaveAttribute("src", "/images/hunters/a.avif");

    rerender(
      <ItemThumb name="b" alt="" sources={["/images/hunters/b-thumb.avif", "/images/hunters/b.avif"]} svgPath={SVG_PATH} />
    );
    expect(container.querySelector("img")).toHaveAttribute("src", "/images/hunters/b-thumb.avif");
  });

  it("leaves the walked chain alone when the candidates are unchanged", () => {
    const { rerender, container } = render(
      <ItemThumb name="a" alt="" sources={["/images/hunters/a-thumb.avif", "/images/hunters/a.avif"]} svgPath={SVG_PATH} />
    );
    fireEvent.error(container.querySelector("img"));
    expect(container.querySelector("img")).toHaveAttribute("src", "/images/hunters/a.avif");

    // An unrelated prop changing must not rewind progress — otherwise a re-render mid-chain
    // re-requests a URL already known to 404.
    rerender(
      <ItemThumb name="a" alt="" className="x" sources={["/images/hunters/a-thumb.avif", "/images/hunters/a.avif"]} svgPath={SVG_PATH} />
    );
    expect(container.querySelector("img")).toHaveAttribute("src", "/images/hunters/a.avif");
  });
});
