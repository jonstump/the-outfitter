// Governing: ADR-0007 (Scrape the Full Hunter Roster into a Generated Dataset), SPEC-0003
// REQ "Favorite Hunters", SPEC-0003 Security Requirements "Request Body Size Limits"
// ("`hunterId` SHALL be length-capped and validated against the known library")
//
// The server's read-only view of the hunter roster, for validating a `hunterId` a client
// asks to favorite.
//
// The roster is READ FROM the generated dataset the client already consumes
// (client/src/data/hunters.json), not copied into the server workspace. A copy would be a
// second source of truth that drifts the moment `node scripts/scrape-hunters.mjs` reruns,
// and "unknown hunter" would then mean "unknown to whichever copy answered". One file,
// one answer.
//
// It is read with fs rather than an `import ... with { type: "json" }` on purpose: the
// JSON import attribute is still flagged experimental on Node 20 and prints a warning on
// every boot, and a plain read lets a missing/corrupt file be handled here rather than
// crashing module evaluation.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// server/src/lib -> repo root -> client/src/data/hunters.json
const ROSTER_FILE = path.join(__dirname, "..", "..", "..", "client", "src", "data", "hunters.json");

function loadRosterIds() {
  try {
    const parsed = JSON.parse(readFileSync(ROSTER_FILE, "utf8"));
    if (!Array.isArray(parsed)) throw new Error("hunters.json is not an array");
    return new Set(parsed.map((h) => h?.id).filter((id) => typeof id === "string" && id));
  } catch (err) {
    // Structured, loud, and non-fatal to boot (SPEC-0003 "Error Handling Standards").
    // Validation then FAILS CLOSED: with no roster, every id is unknown and every favorite
    // write is rejected. The alternative — falling back to "any string up to the length
    // cap" — would turn a missing data file into a silently weaker validator, which is the
    // failure mode the check exists to prevent.
    console.error("unable to read hunter roster; favorites will reject every id", {
      file: ROSTER_FILE,
      reason: err.message,
    });
    return new Set();
  }
}

const HUNTER_IDS = loadRosterIds();

/** How many hunters the roster carried at boot. Exported so a test can assert it loaded. */
export const rosterSize = () => HUNTER_IDS.size;

/** True when `id` names a hunter in the generated dataset. */
export function isKnownHunterId(id) {
  return typeof id === "string" && HUNTER_IDS.has(id);
}
