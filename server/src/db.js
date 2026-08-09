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
  // They are left unowned rather than folded into a shared bucket: exposing them
  // to every request that simply omits the token would recreate the exact
  // cross-user leak #17 exists to close. They are preserved on disk but not
  // returned by any scope — a deliberate, documented tradeoff (the real client
  // always sends a per-browser token, so pre-token saves are not attributable to
  // any current browser anyway).
  for (const record of db.data.loadouts) {
    if (!record.owner) record.owner = "unowned";
  }

  await db.write();
} catch (err) {
  console.error("Unable to read/write JSON store; starting with empty data:", err);
  db.data = { loadouts: [] };
}
