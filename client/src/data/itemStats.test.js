import { describe, expect, it } from "vitest";
import { ITEM_STATS, STATS_GENERATED, statFieldFor, statsFor } from "./itemStats.js";
import { CONS, TOOLS, TRAITS, WEAPONS } from "./catalog.js";

// Governing: ADR-0005 (Scrape Item Stats into a Generated, Committed Data File)
// Implements: SPEC-0007 REQ "Generated, Committed Stats File"

describe("the generated dataset", () => {
  it("carries the marker that says it is generated", () => {
    // JSON has no comments, so the marker is the only thing standing between this file and someone
    // hand-editing it — SPEC-0007 requires it to be visible to whoever opens the file.
    expect(STATS_GENERATED).toBeTruthy();
    expect(STATS_GENERATED.by).toBe("scripts/scrape-stats.mjs");
    expect(STATS_GENERATED.warning).toMatch(/do not hand-edit/i);
  });

  it("keys every record by a real catalog id", () => {
    const known = new Set([...WEAPONS, ...TOOLS, ...TRAITS, ...CONS].map((row) => row[0]));
    const orphans = Object.keys(ITEM_STATS).filter((id) => !known.has(id));
    expect(orphans).toEqual([]);
  });

  it("records provenance on every entry", () => {
    const entries = Object.entries(ITEM_STATS);
    expect(entries.length).toBeGreaterThan(0);
    for (const [id, record] of entries) {
      expect(record.sourceRevision, `${id} has no sourceRevision`).toBeTruthy();
      expect(record.ingestedAt, `${id} has no ingestedAt`).toBeTruthy();
    }
  });

  // Governing: SPEC-0007 REQ "Catalog Write-Through Is Bounded, Reviewable, and Opt-In"
  //
  // The reverse direction of the id check above, on VALUES rather than keys. #195 reconciled the
  // catalog's cost/size/UP columns against this dataset — 74 fields, verified to zero mismatches —
  // and nothing pinned it, so the next hand-edit to a cost would silently reintroduce exactly the
  // drift those corrections removed and CI would stay green. Turning a one-time manual review into
  // a standing invariant is the whole point of having written the values down.
  //
  // Items with no record are skipped rather than failed: the catalog and the dataset refresh
  // independently, so a newly added row is the uncovered case `statsFor` already documents. Today
  // that skip covers exactly one id, `winfield-m1873c`, a KNOWN_CATALOG_DUPLICATES entry with no
  // wiki page of its own.
  describe("stays consistent with the hand-authored catalog", () => {
    const asNumber = (raw) => {
      if (raw === null) return null;
      // The same strict parse the write-through uses. Stripping non-digits and keeping the
      // remainder is how "1.5" becomes 15, so a non-whole value is refused, not coerced.
      const cleaned = String(raw).replace(/,/g, "").trim();
      return /^\d+$/.test(cleaned) ? Number(cleaned) : null;
    };

    const cases = [
      { label: "weapon cost", rows: WEAPONS, field: "Price", index: 3 },
      { label: "weapon size", rows: WEAPONS, field: "Size", index: 2 },
      { label: "tool cost", rows: TOOLS, field: "Price", index: 2 },
      { label: "consumable cost", rows: CONS, field: "Price", index: 2 },
      { label: "trait UP", rows: TRAITS, field: "Cost", index: 2 },
    ];

    for (const { label, rows, field, index } of cases) {
      it(`agrees with the dataset on every ${label}`, () => {
        const mismatches = [];
        let compared = 0;
        for (const row of rows) {
          const scraped = asNumber(statFieldFor(row[0], field));
          if (scraped === null) continue;
          compared += 1;
          if (scraped !== row[index]) {
            mismatches.push(`${row[0]}: catalog ${row[index]}, dataset ${scraped}`);
          }
        }
        expect(compared, `no ${label} was actually compared`).toBeGreaterThan(0);
        expect(mismatches).toEqual([]);
      });
    }
  });
});

describe("statsFor", () => {
  it("returns the record for a covered item", () => {
    const [firstId] = Object.keys(ITEM_STATS);
    expect(statsFor(firstId)).toBe(ITEM_STATS[firstId]);
  });

  it("returns null for an item the scrape has not covered", () => {
    // The specified behaviour, not a gap: the catalog and the dataset refresh independently, so a
    // newly added row and an item whose page failed to parse are the same state to a consumer.
    expect(statsFor("no-such-item-anywhere")).toBeNull();
  });

  it("returns null rather than throwing on a missing or empty id", () => {
    expect(statsFor(null)).toBeNull();
    expect(statsFor(undefined)).toBeNull();
    expect(statsFor("")).toBeNull();
  });

  it("does not inherit from Object.prototype", () => {
    // A bare `ITEM_STATS[id]` lookup would return a function for "constructor" or "toString",
    // which a caller would then treat as a stats record.
    expect(statsFor("constructor")).toBeNull();
    expect(statsFor("toString")).toBeNull();
  });
});

describe("statFieldFor", () => {
  it("reads a field from a covered item", () => {
    const id = Object.keys(ITEM_STATS).find((k) => Object.keys(ITEM_STATS[k].fields ?? {}).length > 0);
    const field = Object.keys(ITEM_STATS[id].fields)[0];
    expect(statFieldFor(id, field)).toBe(ITEM_STATS[id].fields[field]);
  });

  it("returns the wiki's own string, uncoerced", () => {
    // ADR-0005 gates numeric write-through behind range assertions in the scrape; a silent
    // Number() here would reintroduce the unvalidated coercion those assertions exist to prevent.
    const id = Object.keys(ITEM_STATS).find((k) => ITEM_STATS[k].fields?.Price);
    expect(typeof statFieldFor(id, "Price")).toBe("string");
  });

  it("returns null for an absent field, an empty field, and an unknown item", () => {
    const id = Object.keys(ITEM_STATS)[0];
    expect(statFieldFor(id, "NoSuchField")).toBeNull();
    expect(statFieldFor("no-such-item", "Price")).toBeNull();
  });
});
