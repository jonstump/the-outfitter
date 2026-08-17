import { describe, expect, it } from "vitest";
import { canPlaceRun } from "./stacking.js";

// Governing: ADR-0009 (fixed eight-cell grid), SPEC-0006 REQ "Repeated Consumables
// Read as One Stack", issue #464.
//
// Direct unit tests for the pure destination predicate `moveEquip` and the drag
// handlers rely on. Per the requirement text: "A stack of length N MAY be dropped
// only onto a destination region of N consecutive cells each of which is empty,
// unblocked, or already part of the dragged run. Any other drop SHALL be rejected
// as a no-op. Stack drops SHALL NOT swap." These pin the three-way destination-cell
// test (empty-and-unblocked / part of the dragged run / neither) plus bounds and
// purity, independent of the reducer or the drag handlers that call it.

const V = { t: "C", i: 0 }; // stand-in consumable entry
const K = { t: "T", i: 0 }; // stand-in tool entry — a FOREIGN item, never part of a run

describe("canPlaceRun", () => {
  it("accepts a destination of entirely empty, unblocked cells", () => {
    const equip = [V, V, null, null, null, null, null, null];
    expect(canPlaceRun(equip, [], [0, 1], 4)).toBe(true);
  });

  it("accepts a destination that overlaps the run's OWN origin cells", () => {
    // A ×3 run at 0,1,2 dropped at target 1 -> destination 1,2,3. Cells 1 and 2 are
    // part of the dragged run itself, so they are legal landing cells even though
    // they currently hold the run's own items — the run is what will occupy them
    // after the move completes.
    const equip = [V, V, V, null, null, null, null, null];
    expect(canPlaceRun(equip, [], [0, 1, 2], 1)).toBe(true);
  });

  it("rejects a destination cell occupied by a FOREIGN item — this is the no-swap rule", () => {
    // A ×2 run at 0,1 dropped at target 3 -> destination 3,4. Cell 3 holds a Tool
    // that is not part of the dragged run. SPEC-0006: "Stack drops SHALL NOT swap."
    const equip = [V, V, null, K, null, null, null, null];
    expect(canPlaceRun(equip, [], [0, 1], 3)).toBe(false);
  });

  it("rejects a destination region containing a blocked cell", () => {
    // A ×3 run dropped at target 3 -> destination 3,4,5, and cell 5 is blocked.
    const equip = [V, V, V, null, null, null, null, null];
    expect(canPlaceRun(equip, [5], [0, 1, 2], 3)).toBe(false);
  });

  it("rejects a destination that would run off the end of the grid", () => {
    const equip = [V, V, null, null, null, null, null, null];
    expect(canPlaceRun(equip, [], [0, 1], 7)).toBe(false); // 7,8 -- 8 is out of bounds
  });

  it("rejects a negative target start", () => {
    const equip = [V, V, null, null, null, null, null, null];
    expect(canPlaceRun(equip, [], [0, 1], -1)).toBe(false);
  });

  it("is a PURE predicate — it never mutates equip, blocked, or cells", () => {
    const equip = [V, V, null, null, null, null, null, null];
    const blocked = [5];
    const cells = [0, 1];
    canPlaceRun(equip, blocked, cells, 3);
    expect(equip).toEqual([V, V, null, null, null, null, null, null]);
    expect(blocked).toEqual([5]);
    expect(cells).toEqual([0, 1]);
  });
});
