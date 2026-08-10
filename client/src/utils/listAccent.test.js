import { describe, expect, it } from "vitest";
import { ACCENT_VALUES, LIST_ACCENTS, accentName, accentVar, previewNextAccent } from "./listAccent.js";

// Governing: ADR-0006, SPEC-0003 REQ "Lists Are Visually Distinguishable Independent of
// Portrait and Name"

describe("the accent palette", () => {
  it("is the six settled values, in assignment order", () => {
    expect(ACCENT_VALUES).toEqual(["#b04a3e", "#7a8a4e", "#5a6e96", "#5e8a8a", "#8a5e86", "#a3703e"]);
  });

  it("excludes --gold, which would read as selected rather than as an identity", () => {
    expect(ACCENT_VALUES).not.toContain("#c4a05e");
  });

  it("gives every value a human name, because a bare swatch announces as nothing", () => {
    for (const a of LIST_ACCENTS) expect(a.name).toBeTruthy();
  });
});

describe("accentVar", () => {
  it("resolves a stored hex to the custom property that paints it", () => {
    // Never the raw hex: the stylesheet stays the one place a palette value is written.
    expect(accentVar("#5a6e96")).toBe("var(--list-accent-3)");
    expect(accentVar("#a3703e")).toBe("var(--list-accent-6)");
  });

  it("degrades an unrecognised or absent accent to the neutral border", () => {
    // A record carrying an off-palette value must not paint an unvetted colour that may
    // fail SC 1.4.11 — and the list stays usable regardless, identified by its name.
    expect(accentVar("#ff00ff")).toBe("var(--border)");
    expect(accentVar(undefined)).toBe("var(--border)");
    expect(accentVar(null)).toBe("var(--border)");
  });

  it("names a known accent and refuses to invent one for an unknown", () => {
    expect(accentName("#7a8a4e")).toBe("Olive");
    expect(accentName("#123456")).toBeNull();
  });
});

describe("previewNextAccent", () => {
  it("starts at the first palette value when nothing is held", () => {
    expect(previewNextAccent([])).toBe("#b04a3e");
    expect(previewNextAccent()).toBe("#b04a3e");
  });

  it("picks the least-used value, ties broken by palette order", () => {
    expect(previewNextAccent([{ accent: "#b04a3e" }])).toBe("#7a8a4e");
    expect(previewNextAccent([{ accent: "#b04a3e" }, { accent: "#7a8a4e" }])).toBe("#5a6e96");
  });

  it("wraps to a duplicate once every value is in use, rather than running out", () => {
    // Duplicates are permitted by design — six values against an unbounded number of lists
    // makes collision inevitable, and the name carries identity when it happens.
    const held = ACCENT_VALUES.map((accent) => ({ accent }));
    expect(previewNextAccent(held)).toBe("#b04a3e");
    expect(previewNextAccent([...held, { accent: "#b04a3e" }])).toBe("#7a8a4e");
  });

  it("ignores lists whose accent is off-palette or missing", () => {
    expect(previewNextAccent([{ accent: "#ff00ff" }, { accent: null }, {}])).toBe("#b04a3e");
  });
});
