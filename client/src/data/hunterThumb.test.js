import { describe, expect, it } from "vitest";
import { hunterThumb } from "./catalog.js";

// Governing: ADR-0001 (schematic SVG fallback tier), ADR-0006, SPEC-0003 REQ "Hunter
// Dataset Consumption Contract"

describe("hunterThumb", () => {
  it("returns null when there is no hunter, so the caller draws a monogram instead", () => {
    expect(hunterThumb(null)).toBeNull();
    expect(hunterThumb(undefined)).toBeNull();
    expect(hunterThumb("")).toBeNull();
  });

  it("is deterministic — the same hunter always gets the same silhouette", () => {
    // A silhouette that shuffled between renders would read as a loading glitch.
    const first = hunterThumb("the-rat");
    for (let i = 0; i < 20; i++) expect(hunterThumb("the-rat")).toBe(first);
  });

  it("returns a usable SVG path", () => {
    const d = hunterThumb("the-rat");
    expect(typeof d).toBe("string");
    expect(d.startsWith("M")).toBe(true);
  });

  it("spreads hunters across the available silhouettes", () => {
    const ids = Array.from({ length: 60 }, (_, i) => `hunter-${i}`);
    const distinct = new Set(ids.map(hunterThumb));
    // Not asserting perfect distribution — just that it is not collapsing to one figure.
    expect(distinct.size).toBeGreaterThan(1);
  });
});
