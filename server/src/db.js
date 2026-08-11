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

// Governing: ADR-0006, SPEC-0003 REQ "List Identity Is User-Owned and Independent of
// Portrait", SPEC-0003 REQ "Favorite Hunters". `loadoutLists` and `hunterFavorites` are
// further token-scoped collections alongside `loadouts`, governed by identical rules.
const defaultData = { loadouts: [], loadoutLists: [], hunterFavorites: [] };

export const db = new Low(new JSONFile(dbFile), defaultData);

// Boot-time load (issue #18). A corrupted on-disk file must not crash the
// process before the request-time try/catch handlers even exist — fall back to
// defaults, log, and let a POST attempt surface the failure as a clean 500.
try {
  await db.read();
  db.data ||= defaultData;
  db.data.loadouts ||= [];
  // Absent on any data file written before SPEC-0003. An empty collection is the correct
  // starting state — there is nothing to migrate, since a loadout with no `listId` is
  // already Unassigned by definition.
  db.data.loadoutLists ||= [];
  // Same shape, same reasoning, for favorites (SPEC-0003 REQ "Favorite Hunters"). An empty
  // collection is the ONLY correct starting state here — the spec forbids pre-populating
  // favorites, so there is nothing to seed and nothing to migrate.
  db.data.hunterFavorites ||= [];

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
  // The same quarantine applies to every owned collection. A list whose owner is not
  // token-shaped can never be reached by any header value, exactly as for loadouts.
  for (const record of [...db.data.loadouts, ...db.data.loadoutLists, ...db.data.hunterFavorites]) {
    if (!record.owner || !TOKEN_SHAPED_OWNER.test(record.owner)) {
      delete record.owner;
      record.legacy = true;
    }
  }

  // Governing: issue #198.
  //
  // Reclaim records owned by a per-request anonymous identity.
  //
  // `callerToken` mints `request-scoped:<uuid>` for a request that carries no token header
  // (lib/ownership.js), and that identity is never disclosed to the caller — `publicRecord`
  // strips `owner` — so nothing written under it can be read, updated or deleted through the
  // API by anybody, ever. They are garbage from the moment the response is sent. Without a
  // sweep they are also permanent, and lowdb re-serialises every one of them on every write.
  //
  // The TTL is a courtesy rather than a safety margin: since the records are unreachable by
  // construction, dropping them immediately would lose nothing a user could still see. A day
  // is kept so that an operator debugging "my curl POST returned 201, where did it go" has
  // the evidence in front of them, and a record whose timestamp is missing or unparseable is
  // treated as expired — it cannot be shown to be recent, and it is unreachable regardless.
  const REQUEST_SCOPED_TTL_MS = 24 * 60 * 60 * 1000;
  const expiredAt = Date.now() - REQUEST_SCOPED_TTL_MS;
  const isExpiredAnonymous = (record) => {
    if (!record.owner?.startsWith("request-scoped:")) return false;
    const stamped = Date.parse(record.updatedAt ?? record.createdAt ?? "");
    return !Number.isFinite(stamped) || stamped <= expiredAt;
  };

  let swept = 0;
  for (const collection of ["loadouts", "loadoutLists", "hunterFavorites"]) {
    const kept = db.data[collection].filter((record) => !isExpiredAnonymous(record));
    swept += db.data[collection].length - kept.length;
    db.data[collection] = kept;
  }
  if (swept > 0) console.info("swept unreachable request-scoped records", { swept });

  await db.write();
} catch (err) {
  console.error("Unable to read/write JSON store; starting with empty data:", err);
  // Every collection, not just `loadouts` — a handler that reads an absent collection
  // throws a TypeError and turns a recoverable data-file problem into a 500 on a route
  // that had nothing to do with it.
  db.data = { loadouts: [], loadoutLists: [], hunterFavorites: [] };
}
