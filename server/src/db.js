import path from "node:path";
import { fileURLToPath } from "node:url";
import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbFile = path.join(__dirname, "..", "data", "db.json");

const defaultData = { loadouts: [] };

export const db = new Low(new JSONFile(dbFile), defaultData);

// Boot-time load (issue #18). A corrupted on-disk file must not crash the
// process before the request-time try/catch handlers even exist — fall back to
// defaults, log, and let a POST attempt surface the failure as a clean 500.
try {
  await db.read();
  db.data ||= defaultData;
  db.data.loadouts ||= [];

  // Records written before per-user ownership (issue #17) have no `owner` field.
  // They are marked with a `legacy` flag rather than folded into any named
  // scope: a well-known owner value (e.g. "anon"/"unowned") is trivially
  // forgeable via the header and would reproduce the cross-user leak #17 closes.
  // Legacy records are excluded from every live query below (see loadouts.js) —
  // they remain on disk for archival purposes but can never be read, overwritten,
  // or deleted through the API, by any token.
  for (const record of db.data.loadouts) {
    if (!record.owner || record.owner === "unowned") {
      delete record.owner;
      record.legacy = true;
    }
  }

  await db.write();
} catch (err) {
  console.error("Unable to read/write JSON store; starting with empty data:", err);
  db.data = { loadouts: [] };
}
