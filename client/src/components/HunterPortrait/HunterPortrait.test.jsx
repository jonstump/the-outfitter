import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import HunterPortrait from "./HunterPortrait.jsx";

// Governing: ADR-0007, SPEC-0003 REQ "Hunter Dataset Consumption Contract"
//
// EVERY case in this file is synthesized, and that is not laziness — it is forced.
// The shipped roster has 242 entries, all with a non-null `portrait`, and all 484 assets
// exist on disk. So "portrait missing", "only one size present", and "hunterId absent from
// the dataset" have no live data that can reach them, while being exactly the paths the
// spec requires to degrade gracefully. Untestable-against-real-data is precisely when a
// fixture earns its place.
//
// The mock is on hunters.JSON, not on hunters.js: the real seam logic (slug -> path
// derivation, size ordering, the empty-array cases) is the thing under test, so mocking the
// module that computes it would only test the mock.
// Path is relative to THIS file and must resolve to the same repo-root artifact
// `client/src/data/hunters.js` imports; a mismatch makes the mock a no-op.
vi.mock("../../../../data/hunters.json", () => ({
  default: [
    {
      id: "two-sizes",
      name: "Two Sizes",
      portrait: "two-sizes",
      acquisition: "dlc",
      obtainable: true,
    },
    {
      // A dataset entry carrying no portrait slug at all. There is nothing to derive a
      // path from, so this must reach the placeholder without a request.
      id: "slugless",
      name: "Slugless",
      portrait: null,
      acquisition: "event",
      obtainable: true,
    },
  ],
}));

const srcOf = (container) => container.querySelector("img")?.getAttribute("src");

describe("HunterPortrait size fallback", () => {
  it("asks for the thumbnail first in a card/tile context", () => {
    const { container } = render(<HunterPortrait hunterId="two-sizes" />);
    expect(srcOf(container)).toBe("/images/hunters/two-sizes-thumb.avif");
  });

  it("asks for the full size first in an expanded-header context", () => {
    const { container } = render(<HunterPortrait hunterId="two-sizes" size="full" />);
    expect(srcOf(container)).toBe("/images/hunters/two-sizes.avif");
  });

  it("falls back to the full size when the thumbnail is absent — not to the placeholder", () => {
    // "A too-large image is a performance cost; an empty tile is a defect."
    const { container } = render(<HunterPortrait hunterId="two-sizes" />);
    fireEvent.error(container.querySelector("img"));
    expect(srcOf(container)).toBe("/images/hunters/two-sizes.avif");
    expect(container.querySelector("svg")).not.toBeInTheDocument();
  });

  it("falls back to the thumbnail when only the thumbnail exists", () => {
    const { container } = render(<HunterPortrait hunterId="two-sizes" size="full" />);
    fireEvent.error(container.querySelector("img"));
    expect(srcOf(container)).toBe("/images/hunters/two-sizes-thumb.avif");
  });

  it("reaches the neutral placeholder only after BOTH sizes have failed", () => {
    const { container } = render(<HunterPortrait hunterId="two-sizes" />);
    fireEvent.error(container.querySelector("img"));
    fireEvent.error(container.querySelector("img"));
    expect(container.querySelector("img")).not.toBeInTheDocument();
    // A silhouette, never a broken image.
    expect(container.querySelector("svg")).toBeInTheDocument();
  });
});

describe("HunterPortrait degradation", () => {
  it("renders the placeholder with no request when the entry carries no portrait", () => {
    const { container } = render(<HunterPortrait hunterId="slugless" />);
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders the placeholder with no request when the hunter left the dataset", () => {
    // A list outlives the roster it references. Guessing a URL from the stored id would be
    // a guaranteed 404 per orphaned list, so no request is issued at all.
    const { container } = render(<HunterPortrait hunterId="retired-last-season" />);
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders nothing at all when the list chose no hunter", () => {
    // Distinct from "cannot resolve the hunter": there is no identity to depict, so the
    // caller draws its name monogram rather than a stranger's silhouette.
    const { container } = render(<HunterPortrait hunterId={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("HunterPortrait loading and origin", () => {
  it("defers the fetch by default, so a 242-tile picker loads what was scrolled to", () => {
    const { container } = render(<HunterPortrait hunterId="two-sizes" />);
    expect(container.querySelector("img")).toHaveAttribute("loading", "lazy");
  });

  it("loads eagerly when the caller says the image is already on screen", () => {
    const { container } = render(<HunterPortrait hunterId="two-sizes" size="full" lazy={false} />);
    expect(container.querySelector("img")).not.toHaveAttribute("loading");
  });

  it("serves every candidate from the application's own origin", () => {
    // ADR-0002 / SPEC-0003: the wiki is a build-time source, never a runtime one.
    const { container } = render(<HunterPortrait hunterId="two-sizes" />);
    for (let i = 0; i < 2; i++) {
      const src = srcOf(container);
      expect(src.startsWith("/images/hunters/")).toBe(true);
      expect(src).not.toContain("wiki.gg");
      fireEvent.error(container.querySelector("img"));
    }
  });

  it("marks the portrait decorative by default, since the list name is adjacent", () => {
    const { container } = render(<HunterPortrait hunterId="two-sizes" />);
    expect(container.querySelector("img")).toHaveAttribute("alt", "");
  });
});
