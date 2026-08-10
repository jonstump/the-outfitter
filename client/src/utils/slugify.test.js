import { describe, it, expect } from "vitest";

// Governing: ADR-0002, ADR-0005; Implements: SPEC-0001 REQ "Image Coverage Across All
// Catalog Categories, with Fallback"
//
// The cases that matter here are the ones that used to differ between the scrape's copy of
// slugify and the client's (issue #119). A plain-ASCII name slugged identically under both,
// which is why the drift survived: every one of the 121 committed images resolved, and
// nothing in the catalog exercised the divergence.
import { slugify } from "./slugify.js";
import { slugify as fromItemThumb } from "../components/ItemThumb/ItemThumb.jsx";

describe("slugify", () => {
  it("lowercases and hyphenates the ordinary case", () => {
    expect(slugify("Nagant M1895")).toBe("nagant-m1895");
    expect(slugify("LeMat Mark II")).toBe("lemat-mark-ii");
    expect(slugify("Winfield M1873C")).toBe("winfield-m1873c");
  });

  it("collapses non-alphanumeric runs and trims the edges", () => {
    expect(slugify("Crown & King Auto-5")).toBe("crown-king-auto-5");
    expect(slugify("  Caldwell Rival 78  ")).toBe("caldwell-rival-78");
    expect(slugify("--Test--")).toBe("test");
  });

  it("drops apostrophes rather than turning them into hyphens", () => {
    // The client's old copy produced "hunter-s-respite" here, against a file on disk named
    // by the scrape's copy — the exact mismatch #119 was filed for.
    expect(slugify("Hunter's Respite")).toBe("hunters-respite");
    expect(slugify("O'Brien's Special")).toBe("obriens-special");
  });

  it("strips combining diacritics instead of hyphenating them away", () => {
    // The client's old copy produced "l-gion-tranger" for this.
    expect(slugify("Légion Étrangère")).toBe("legion-etrangere");
    expect(slugify("Bornheim No. 3 Match")).toBe("bornheim-no-3-match");
  });

  it("is idempotent", () => {
    const once = slugify("Mosin-Nagant M1891");
    expect(slugify(once)).toBe(once);
  });

  // The guard that actually prevents recurrence. Value-equality tests would pass again the
  // moment someone reintroduced a local copy that happened to agree on the cases above;
  // identity fails the instant the reader stops being the canonical function.
  it("is the same function ItemThumb resolves image URLs with", () => {
    expect(fromItemThumb).toBe(slugify);
  });
});
