import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import HunterPortrait from "./HunterPortrait.jsx";
import { portraitSources } from "../../data/hunters.js";

// Governing: ADR-0007 (as amended 2026-08-10), SPEC-0004 REQ "Consumption Contract
// Compatibility", SPEC-0003 REQ "Hunter Dataset Consumption Contract"
//
// EVERY case in this file is synthesized, and that is not laziness — it is forced.
// The shipped roster has 242 entries, all with a non-null `portrait`, and all 242 assets
// exist on disk. So "portrait missing" and "hunterId absent from the dataset" have no live
// data that can reach them, while being exactly the paths the spec requires to degrade
// gracefully. Untestable-against-real-data is precisely when a fixture earns its place.
//
// The mock is on hunters.JSON, not on hunters.js: the real seam logic (slug -> path
// derivation, the empty-array cases) is the thing under test, so mocking the module that
// computes it would only test the mock.
// Path is relative to THIS file and must resolve to the same repo-root artifact
// `client/src/data/hunters.js` imports; a mismatch makes the mock a no-op.
vi.mock("../../../../data/hunters.json", () => ({
  default: [
    {
      id: "one-asset",
      name: "One Asset",
      portrait: "one-asset",
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

// REWRITTEN, not deleted (#148). This block used to be "HunterPortrait size fallback" and
// asserted a three-rung ladder: the size suited to the context, the OTHER size, then the
// placeholder. ADR-0007's 2026-08-10 amendment removed the second size, so the middle rung
// has nothing to be — but the degradation path it protected is unchanged in importance and
// is asserted here at its new length. The interesting cases moved rather than vanished:
// where the old block proved the middle rung EXISTS, this one proves it is GONE, which is
// the actual regression risk now (a reintroduced `-thumb` retry is a 404 per tile).
describe("HunterPortrait fallback ladder", () => {
  it("asks for the hunter's one portrait, derived from the slug with no size segment", () => {
    const { container } = render(<HunterPortrait hunterId="one-asset" />);
    expect(srcOf(container)).toBe("/images/hunters/one-asset.avif");
  });

  it("renders the same URL in every context, because there is no per-context variant", () => {
    // The card, the expanded header and the picker tile differ in CSS box, never in asset.
    const card = render(<HunterPortrait hunterId="one-asset" />);
    const header = render(<HunterPortrait hunterId="one-asset" lazy={false} />);
    expect(srcOf(card.container)).toBe(srcOf(header.container));
  });

  it("reaches the neutral placeholder on the FIRST failure — there is no second size to try", () => {
    // The old ladder retried the other size here. Retrying anything now would be a request
    // for a file the scrape has never emitted.
    const { container } = render(<HunterPortrait hunterId="one-asset" />);
    fireEvent.error(container.querySelector("img"));
    expect(container.querySelector("img")).not.toBeInTheDocument();
    // A silhouette, never a broken image. An empty tile remains a defect.
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("never requests a path carrying a size segment", () => {
    // The regression this file exists to catch: #147 deleted all 242 `-thumb` files, so any
    // candidate matching this pattern is a guaranteed 404 issued once per rendered portrait.
    const { container } = render(<HunterPortrait hunterId="one-asset" />);
    expect(srcOf(container)).not.toMatch(/-thumb|-full|\d+px/);
  });

  it("offers exactly one candidate, so the ladder cannot silently grow a rung", () => {
    expect(portraitSources("one-asset")).toEqual(["/images/hunters/one-asset.avif"]);
  });
});

// Governing: SPEC-0003 — "The `size` argument ... SHALL be removed rather than defaulted,
// so no call site can ask for a size that no longer exists."
describe("HunterPortrait takes no size", () => {
  it("declares a single parameter, so no size can be threaded through the seam", () => {
    // Arity is the load-bearing assertion: a DEFAULTED `size` would keep this at 1 named
    // parameter only if it were removed outright, which is exactly what the spec asks for.
    expect(portraitSources).toHaveLength(1);
  });

  it("ignores a stale size prop rather than resurrecting the old behaviour", () => {
    // A call site left unmigrated must not be able to reach a `-thumb` URL by asking.
    const { container } = render(<HunterPortrait hunterId="one-asset" size="full" />);
    expect(srcOf(container)).toBe("/images/hunters/one-asset.avif");
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
    const { container } = render(<HunterPortrait hunterId="one-asset" />);
    expect(container.querySelector("img")).toHaveAttribute("loading", "lazy");
  });

  it("loads eagerly when the caller says the image is already on screen", () => {
    const { container } = render(<HunterPortrait hunterId="one-asset" lazy={false} />);
    expect(container.querySelector("img")).not.toHaveAttribute("loading");
  });

  it("serves its candidate from the application's own origin", () => {
    // ADR-0002 / SPEC-0003: the wiki is a build-time source, never a runtime one.
    const { container } = render(<HunterPortrait hunterId="one-asset" />);
    expect(srcOf(container).startsWith("/images/hunters/")).toBe(true);
    expect(srcOf(container)).not.toContain("wiki.gg");
  });

  it("marks the portrait decorative by default, since the list name is adjacent", () => {
    const { container } = render(<HunterPortrait hunterId="one-asset" />);
    expect(container.querySelector("img")).toHaveAttribute("alt", "");
  });
});
