import path from "node:path";
import { fileURLToPath } from "node:url";
import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Data file location. Defaults to server/data/db.json; OUTFITTER_DB_FILE overrides it
// so the test suite can point at a throwaway file instead of a developer's real data.
// The suite exercises the real lowdb JSONFile store rather than a mock, which is worth
// keeping — but it must not share a file with dev data. An inverted cleanup predicate
// in loadouts.test.js previously deleted real loadouts on every run, and because this
// file is gitignored there was no history to recover them from.
const dbFile = process.env.OUTFITTER_DB_FILE
  ? path.resolve(process.env.OUTFITTER_DB_FILE)
  : path.join(__dirname, "..", "data", "db.json");

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
  //
  // Anything without a token-shaped owner is treated as legacy. Client tokens
  // are either a UUID (crypto.randomUUID) or "t-" + rng (the client fallback);
  // per-request anonymous identities are "request-scoped:<uuid>". Hardcoded
  // sentinels from any past version ("anon", "unowned") intentionally do NOT
  // count as token-shaped — enumerating known-bad values one at a time is how
  // this check drifted in the first place.
  const TOKEN_SHAPED_OWNER = /^(?=[a-f0-9-]{36}$|[tT]-[A-Za-z0-9]{10,}|request-scoped:[a-f0-9-]{36}$)/;
  for (const record of db.data.loadouts) {
    if (!record.owner || !TOKEN_SHAPED_OWNER.test(record.owner)) {
      delete record.owner;
      record.legacy = true;
    }
  }

  await db.write();
} catch (err) {
  console.error("Unable to read/write JSON store; starting with empty data:", err);
  db.data = { loadouts: [] };
}
