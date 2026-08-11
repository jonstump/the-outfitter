#!/usr/bin/env node
// Governing: ADR-0005 (Scrape Item Stats and Descriptions from huntshowdown.wiki.gg into a
// Generated, Committed Data File), ADR-0002 (the ethics posture this inherits unchanged)
// Implements: SPEC-0007 REQ "Offline, Human-Invoked Stats Scrape", SPEC-0007 REQ "Error Handling
// Standards"
//
// scripts/scrape-stats.mjs
//
// Offline, human-invoked scrape of huntshowdown.wiki.gg for catalog item stats. Like its two
// siblings it is a standalone tool, NOT part of the app's runtime or build path:
//
//   - It is NOT wired into `npm run build`, `npm run dev`, `npm start`, or any CI job. CI reaches
//     it only through `npm test` -> `test:scrape`, which runs the unit tests with an injected
//     fetchFn and makes zero requests to huntshowdown.wiki.gg.
//   - It must be invoked manually and deliberately by a human:
//
//       node scripts/scrape-stats.mjs [options]
//
//     Options:
//       --only=weapons,tools,traits,consumables   Limit the run to these categories (default: all)
//       --delay-ms=1500                           Minimum delay between requests (default: 1500ms)
//       --limit=N                                 Stop after N items (useful for a smoke run)
//       --out=PATH                                Override the dataset path
//       --allow-shrink                            Permit a write that drops already-covered items
//       --write-catalog                           Apply scraped values over hand-authored ones
//       --dry-run                                 Resolve URLs and check robots.txt, but fetch
//                                                  nothing and write nothing
//
// WHAT THIS SCRIPT WRITES
//
// By default, exactly one file: `client/src/data/itemStats.json` — generated, committed, keyed by
// catalog id, never hand-edited (#184). A default run cannot change a single number the app does
// budget math with.
//
// Under `--write-catalog` it also reconciles `catalog.js`, which is the dangerous half of ADR-0005
// and the reason everything else here is additive (#185). The wiki is authoritative for values the
// catalog also carries — cost, size, UP — and automating that reconciliation is the whole point of
// the decision. It is also the one place a parser bug becomes a correctness bug: a wiki markup
// change that yields a wrong-but-well-formed number corrupts budget math invisibly, because a
// Winfield that costs $3 instead of $76 just looks like a bargain.
//
// Four things stand between a bad parse and a corrupted catalog:
//
//   1. It is opt-in. The flag is the operator saying "reconcile", not a default.
//   2. Every intended overwrite is printed BEFORE anything is applied, item by item, old -> new.
//   3. Values are range-asserted against what the game actually uses. A value outside the range
//      fails that field and is reported; it never lands, and it never aborts the other items.
//   4. The edit is surgical and lands as a reviewable `git diff` hunk against a hand-authored file,
//      not a regenerated one — so a wrong value is visible in review rather than buried in churn.
//
// Some fields the wiki describes are still never written, because a CORRECT value would break
// something downstream: `ammoClass` (a saved ammo selection is a bare index into that pool) and the
// display `name` (it feeds slugify() and therefore the on-disk image path). See
// GATED_CATALOG_FIELDS. And `group`, `type` and the whole `AMMO` table are never derived at all —
// see NEVER_DERIVED.
//
// A partial run (`--limit` or `--only`) reports but does not write. Otherwise the dataset would be
// truncated to whatever that run happened to visit, and the deletion would look like a scrape
// result rather than a flag. "Partial" counts DISTINCT categories, so a repeated `--only` value
// cannot pad the count back up to a full run.
//
// The same reasoning covers coverage lost to failure rather than to a flag: the write replaces the
// file wholesale, so a run that failed most of its items would delete every record it could not
// re-derive. A run that would drop already-covered ids writes nothing and names them; `--allow-shrink`
// is how a genuine catalog removal gets through. That path is deliberately the loud one — ADR-0005's
// worst realistic failure is a wiki markup change the parser stops matching, and its first symptom
// is a run that succeeds for a handful of items and fails the rest.
//
// Error handling (SPEC-0007 REQ "Error Handling Standards"):
//   - Every layer boundary (robots fetch, page fetch, infobox extraction, field read) wraps its
//     failure with contextual information: item name, URL, and reason.
//   - Four sentinel classes stay distinguishable rather than collapsing into one generic error —
//     ItemPageNotFoundError (no page), InfoboxNotFoundError (page but no infobox),
//     InfoboxFieldNotFoundError (infobox but no such field), and NetworkFailureError (transport or
//     rate limit). They mean different things: the first two usually indicate resolution landed on
//     the wrong page, the third is a genuine gap in the wiki's data, and the fourth is transient.
//   - A single item's failure is caught per-item and never aborts the run. robots.txt being
//     unreadable IS fatal, because we cannot honor a policy we cannot read.
//
// Shared wiki client (ADR-0005): slug derivation, robots handling, the rate limiter, the user
// agent, the sentinel errors, catalog -> scrape-target resolution, and the run-summary helpers all
// live in scripts/lib/wiki.mjs and are imported here. This file defines none of them. A second
// copy of slugify() in particular would drift from the on-disk asset path contract, which is the
// exact failure ADR-0005 extracted that module to prevent (and which issue #119 already caught
// once, on the client end).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CONS, TOOLS, TRAITS, WEAPONS } from "../client/src/data/catalog.js";

import {
  CATEGORIES,
  DEFAULT_DELAY_MS,
  InfoboxFieldNotFoundError,
  InfoboxNotFoundError,
  ItemPageNotFoundError,
  KNOWN_CATALOG_DUPLICATES,
  NetworkFailureError,
  RateLimiter,
  RobotsDisallowedError,
  ScrapeError,
  USER_AGENT,
  WIKI_CATEGORY,
  buildItemPageUrl,
  collectCatalogItems,
  createSummary,
  decodeEntities,
  fetchRobotsTxt,
  isAllowedByRobots,
  logStructured,
  readRlconf,
  recordResult,
  resolveWikiPath,
} from "./lib/wiki.mjs";

// Re-exported so the test file and any future consumer import the shared definitions through this
// module rather than reaching past it. Defined exactly once, in scripts/lib/wiki.mjs.
export {
  CATEGORIES,
  DEFAULT_DELAY_MS,
  InfoboxFieldNotFoundError,
  InfoboxNotFoundError,
  ItemPageNotFoundError,
  NetworkFailureError,
  RateLimiter,
  RobotsDisallowedError,
  ScrapeError,
  USER_AGENT,
  buildItemPageUrl,
  collectCatalogItems,
  createSummary,
  recordResult,
  resolveWikiPath,
  slugify,
} from "./lib/wiki.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Where the generated dataset lands (SPEC-0007 REQ "Generated, Committed Stats File").
 *
 * Beside `catalog.js` in the client workspace, per ADR-0005 — deliberately NOT the repo root that
 * `data/hunters.json` uses. That one sits at the root because the server reads it too; nothing on
 * the server reads item stats, so the generated blob stays adjacent to the hand-authored table it
 * annotates. If a server consumer ever appears, this moves and SPEC-0007 says so first.
 */
export const STATS_DATA_PATH = path.join(REPO_ROOT, "client", "src", "data", "itemStats.json");

/**
 * The hand-authored catalog, and the ONLY file outside the dataset this script may write —
 * exclusively under --write-catalog. ADR-0005: scrape-stats.mjs is the only script that ever
 * writes it; scrape-images.mjs stays write-only to client/public/images/.
 */
export const CATALOG_PATH = path.join(REPO_ROOT, "client", "src", "data", "catalog.js");

// ---------------------------------------------------------------------------
// Infobox extraction — the payload-specific half, and the seam #184 builds the dataset on.
//
// huntshowdown.wiki.gg renders item stats with the Druid skin's infobox, not MediaWiki's
// portable-infobox. That is good news for parsing: every field carries its own name in a class
// rather than being positional or label-matched, so a field read is
//
//     <div class="druid-data druid-data-Price druid-data-nonempty">75&#160;<a>…</a></div>
//              -> fields.Price === "75"
//
// Observed field names on a weapon page: Price, Size, Update, Source, AmmoType, Loaded, Extra,
// Damage, MuzzleVelocity, DropRange, RateofFire, CycleTime, Spread, Sway, VerticalRecoil,
// ReloadSpeed, MeleeDamage, HeavyMeleeDamage, StaminaConsumption, Description. That set covers
// the weapon audit's §3.0 list, which is a floor on what a stats scrape must capture rather than
// a ceiling — dual-wieldability, for one, lives in the Description prose and not in any field
// (issue #178).
//
// A page carries SEVERAL infoboxes — one per variant, six on Weapons/Ranger_73 — and the first is
// not reliably the base weapon. Deciding which infobox describes the catalog row is #184's
// problem, not this story's; extractInfoboxes returns all of them in document order and lets the
// caller choose.
// ---------------------------------------------------------------------------

const INFOBOX_OPEN = /<div\b[^>]*class="[^"]*\bdruid-infobox\b[^"]*"[^>]*>/gi;

/**
 * Slice out the balanced <div>…</div> beginning at `startIdx`.
 *
 * Deliberately a scanner rather than a regex: infobox internals nest, and a lazy
 * `<div[^>]*>.*?</div>` stops at the first inner close tag, silently truncating the block. Returns
 * null when the document ends before the div closes (malformed HTML), so the caller can treat that
 * as "no usable infobox" rather than acting on a partial slice.
 */
export function sliceBalancedDiv(html, startIdx) {
  const tag = /<(\/?)div\b[^>]*?(\/?)>/gi;
  tag.lastIndex = startIdx;
  let depth = 0;
  let match;
  while ((match = tag.exec(html)) !== null) {
    const isClose = match[1] === "/";
    const isSelfClosing = match[2] === "/";
    if (isSelfClosing) continue;
    depth += isClose ? -1 : 1;
    if (depth === 0) return html.slice(startIdx, tag.lastIndex);
  }
  return null;
}

/** Every infobox block on the page, in document order. Empty array when the page carries none. */
export function extractInfoboxes(html) {
  const blocks = [];
  INFOBOX_OPEN.lastIndex = 0;
  let match;
  while ((match = INFOBOX_OPEN.exec(html)) !== null) {
    const block = sliceBalancedDiv(html, match.index);
    if (block) {
      blocks.push(block);
      INFOBOX_OPEN.lastIndex = match.index + block.length;
    }
  }
  return blocks;
}

/**
 * Strip tags and entities down to the text a reader would see, with whitespace collapsed.
 *
 * Entity decoding is delegated to the shared `decodeEntities`, which covers numeric, hex, and
 * named forms. The hand-rolled list this replaced handled only the half-dozen entities the first
 * fixtures happened to contain, so a `&#233;` would have survived into a stored value.
 *
 * DELIBERATELY NOT `stripTags` from the hunter scrape, which keeps `alt` text. That is right for
 * its payload — a Blood Bonds hunter's `Source` is literally `900 <img alt="Blood Bonds">`, and
 * dropping the alt makes it unclassifiable — and wrong for this one, where the icon restates a
 * value already in the text: `Price` is `75&#160;<img alt="Hunt Dollars">` and would read
 * "75 Hunt Dollars", `Size` is `<a>4</a> <img alt="4">` and would read "4 4". Same wiki, opposite
 * correct answer, so the two extractors stay separate on purpose.
 */
export function textContent(fragment) {
  return decodeEntities(
    fragment.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "").replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Turn a wiki page name into the title a reader sees.
 *
 * `wgPageName` is the namespaced path — "Weapons/Nagant_M1895", "Weapons/Sparks/Pistol". Dropping
 * the leading category segment and flattening the rest gives "Nagant M1895" and "Sparks Pistol",
 * which is what the infobox heading says. Taking only the LAST segment would turn
 * "Weapons/Sparks/Pistol" into "Pistol" and match nothing.
 *
 * DELIBERATELY NOT named `pageTitleToDisplay`, which is what `scrape-hunters.mjs` exports for the
 * same job with different rules — it drops only the "Hunters/" namespace and never flattens a
 * second segment, because no hunter page has one. Two exported functions sharing a name and not a
 * behaviour is the drift this project extracted `lib/wiki.mjs` to prevent; the names differ so a
 * reader cannot import the wrong one by muscle memory.
 */
export function canonicalTitleFromPageName(pageName) {
  const raw = String(pageName ?? "").trim();
  if (!raw) return null;
  const withoutNamespace = raw.replace(
    new RegExp(`^(?:${Object.values(WIKI_CATEGORY).join("|")})/`, "i"),
    ""
  );
  return withoutNamespace.replace(/[/_]+/g, " ").replace(/\s+/g, " ").trim() || null;
}

/** The infobox's own heading — `<div class="druid-title">Nagant M1895</div>`. */
export function extractInfoboxTitle(infoboxHtml) {
  const match = infoboxHtml.match(/<div\b[^>]*class="[^"]*\bdruid-title\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  return match ? textContent(match[1]) : null;
}

/** Compare titles the way a reader would: case- and punctuation-insensitive, whitespace-collapsed. */
function normalizeTitle(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[_‐-―-]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pick the infobox that describes the catalog row, out of the several a page carries.
 *
 * A weapon page carries one infobox per cosmetic skin — five on Nagant M1895 (Copperhead,
 * Steelroot, Red Azimuth, Motley Madness), six on Ranger 73 (Fifty Laurels, The Redmartin,
 * Soothsayer, …). Only one describes the purchasable weapon, and "take the first" is a positional
 * guess that happens to be right on the pages checked so far. Guessing is what #183 explicitly
 * refused to do, so this matches on the infobox's own title instead.
 *
 * Preference order, and why:
 *
 *   1. The **canonical page title** read from RLCONF. This is the wiki's current name for the page
 *      and survives redirects.
 *   2. The **catalog display name**. A fallback rather than the primary, because the audit found 14
 *      stale display names — matching on the catalog's own name would fail on exactly the items
 *      whose names the scrape exists to correct. `winfield-m1873` is named "Winfield M1873" here and
 *      "Ranger 73" on the wiki, and only the canonical title matches.
 *   3. **Unresolved.** If nothing matches, say so. Returning index 0 with a shrug is the trap: a
 *      skin's stat block would be written as the weapon's, and every number would be plausible.
 */
export function selectBaseInfobox(infoboxes, { canonicalTitle = null, displayName = null } = {}) {
  const titles = infoboxes.map((block) => extractInfoboxTitle(block));

  for (const [method, candidate] of [
    ["canonical-title", canonicalTitle],
    ["display-name", displayName],
  ]) {
    const wanted = normalizeTitle(candidate);
    if (!wanted) continue;
    const index = titles.findIndex((t) => normalizeTitle(t) === wanted);
    if (index !== -1) return { index, method, title: titles[index], titles };
  }

  return { index: -1, method: "unresolved", title: null, titles };
}

/**
 * Read every `druid-data-{Field}` value out of one infobox block into a plain object.
 *
 * `druid-data-nonempty` and `druid-data-wide` are presentation modifiers rather than field names
 * and are excluded — treating them as fields would invent two that no item has.
 */
const FIELD_MODIFIERS = new Set(["nonempty", "wide", "empty"]);

export function parseInfoboxFields(infoboxHtml) {
  const fields = {};
  const dataOpen = /<div\b[^>]*class="([^"]*\bdruid-data\b[^"]*)"[^>]*>/gi;
  let match;
  while ((match = dataOpen.exec(infoboxHtml)) !== null) {
    const names = (match[1].match(/druid-data-([A-Za-z0-9_]+)/g) || [])
      .map((c) => c.replace("druid-data-", ""))
      .filter((n) => !FIELD_MODIFIERS.has(n));
    if (names.length === 0) continue;

    const block = sliceBalancedDiv(infoboxHtml, match.index);
    if (block === null) continue;
    const inner = block.replace(/^<div\b[^>]*>/i, "").replace(/<\/div>$/i, "");
    const value = textContent(inner);
    for (const name of names) {
      // First occurrence wins: a field repeated within one infobox is a markup quirk, and taking
      // the last would silently prefer whichever the page happened to render second.
      if (!(name in fields)) fields[name] = value;
    }
    dataOpen.lastIndex = match.index + block.length;
  }
  return fields;
}

/**
 * Read one field, or throw. Use where a caller genuinely requires the field — a caller that can
 * proceed without it should read `fields[name]` directly rather than catching this.
 */
export function readInfoboxField(fields, name, { item, url } = {}) {
  const value = fields?.[name];
  if (value === undefined || value === "") {
    throw new InfoboxFieldNotFoundError(
      `infobox for "${item}" has no "${name}" field at ${url}`,
      { item, url, field: name }
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Failure classification at the page-fetch boundary.
// ---------------------------------------------------------------------------

export function classifyPageFetchError(status, item, url) {
  if (status === 404) {
    return new ItemPageNotFoundError(`item page not found for "${item}": HTTP 404 at ${url}`, { item, url });
  }
  return new NetworkFailureError(`failed to fetch item page for "${item}": HTTP ${status} at ${url}`, {
    item,
    url,
  });
}

// ---------------------------------------------------------------------------
// Per-item scrape.
// ---------------------------------------------------------------------------

/**
 * Scrape one catalog item's stats. Every failure throws a sentinel with item and url attached;
 * callers catch per-item (see runStatsScrape) so one item never aborts the run.
 */
export async function scrapeItemStats(target, deps) {
  const { fetchFn, rateLimiter, robotsGroups, userAgent = USER_AGENT, dryRun = false } = deps;

  const { category, id, name: item } = target;
  const wikiPath = target.wikiPath !== undefined ? target.wikiPath : resolveWikiPath(category, id, item);

  // Known duplicates have no page of their own. Skip before spending a request so they surface as
  // an explained skip rather than as a 404 in the failed bucket.
  if (wikiPath === null) {
    const reason = KNOWN_CATALOG_DUPLICATES[id] || "no wiki page mapped for this catalog entry";
    return { status: "skipped", category, id, item, reason: `no wiki page: ${reason}` };
  }

  const pageUrl = buildItemPageUrl(wikiPath);
  const pagePath = new URL(pageUrl).pathname;

  if (!isAllowedByRobots(robotsGroups, userAgent, pagePath)) {
    throw new RobotsDisallowedError(`robots.txt disallows fetching "${item}" at ${pagePath}`, {
      item,
      url: pageUrl,
    });
  }

  if (dryRun) {
    return { status: "skipped", category, id, item, reason: `dry-run: would fetch ${pageUrl}` };
  }

  await rateLimiter.wait();

  let res;
  try {
    res = await fetchFn(pageUrl, { headers: { "User-Agent": userAgent } });
  } catch (err) {
    throw new NetworkFailureError(`network failure fetching item page for "${item}" at ${pageUrl}: ${err.message}`, {
      cause: err,
      item,
      url: pageUrl,
    });
  }
  if (!res.ok) throw classifyPageFetchError(res.status, item, pageUrl);

  // Reading the body is its own transport failure point, not part of the fetch above: fetch()
  // resolves as soon as the headers arrive and the body streams afterward, so a connection reset
  // mid-response rejects here rather than there. Left unwrapped it escapes as a bare TypeError with
  // no url, which is exactly the collapse SPEC-0007's error contract forbids.
  let html;
  try {
    html = await res.text();
  } catch (err) {
    throw new NetworkFailureError(
      `network failure reading item page body for "${item}" at ${pageUrl}: ${err.message}`,
      { cause: err, item, url: pageUrl }
    );
  }

  const infoboxes = extractInfoboxes(html);
  if (infoboxes.length === 0) {
    throw new InfoboxNotFoundError(`no infobox on page for "${item}" at ${pageUrl}`, { item, url: pageUrl });
  }

  // Provenance, per ADR-0005: the revision this record was derived from, and when. Read from
  // RLCONF rather than from the URL, so a redirect resolves to one identity rather than two.
  const revision = readRlconf(html, "wgCurRevisionId") ?? readRlconf(html, "wgRevisionId");
  const canonicalTitle = canonicalTitleFromPageName(readRlconf(html, "wgPageName"));

  const selection = selectBaseInfobox(infoboxes, { canonicalTitle, displayName: item });
  if (selection.index === -1) {
    throw new InfoboxNotFoundError(
      `no infobox on the page for "${item}" matches its title at ${pageUrl} ` +
        `(canonical "${canonicalTitle}"; infobox titles: ${JSON.stringify(selection.titles)})`,
      { item, url: pageUrl }
    );
  }

  const fields = parseInfoboxFields(infoboxes[selection.index]);

  return {
    status: "succeeded",
    category,
    id,
    item,
    url: pageUrl,
    canonicalTitle,
    revision: revision === null ? null : String(revision),
    infoboxCount: infoboxes.length,
    selection: { index: selection.index, method: selection.method, title: selection.title },
    fields,
  };
}

/**
 * The record written to itemStats.json for one item.
 *
 * `id` is deliberately NOT stored inside the record — it is the key, and a second copy invites the
 * two to disagree. Nothing here is derived from the wiki except the field values themselves:
 * ADR-0005 makes the wiki authoritative for values and never for identity.
 */
export function buildStatsRecord(result, { now = () => new Date().toISOString() } = {}) {
  return {
    name: result.canonicalTitle || result.item,
    wikiUrl: result.url,
    infoboxTitle: result.selection.title,
    selectedBy: result.selection.method,
    variantCount: result.infoboxCount,
    fields: result.fields,
    sourceRevision: result.revision,
    ingestedAt: now(),
  };
}

// ---------------------------------------------------------------------------
// Catalog write-through (SPEC-0007 REQ "Catalog Write-Through Is Bounded, Reviewable, and Opt-In").
//
// The dangerous half of ADR-0005, and the reason every other part of this script is additive. The
// wiki is authoritative for values the catalog also carries, and automating that reconciliation is
// the point of the decision — but a wiki markup change that makes the parser extract a
// wrong-but-well-formed number corrupts budget math invisibly. A Winfield that costs $3 instead of
// $76 just looks like a bargain.
//
// So the write-through is opt-in (`--write-catalog`), prints every intended overwrite before
// applying it, and refuses values that fall outside the ranges the game actually uses.
// ---------------------------------------------------------------------------

/**
 * Which scraped field maps onto which catalog tuple position.
 *
 * Tuple shapes, from catalog.js:
 *   WEAPONS [id, name, size, cost, ammoClass, group]
 *   TOOLS   [id, name, cost, group]
 *   CONS    [id, name, cost, type, group]
 *   TRAITS  [id, name, up, group]
 *
 * Traits say `Cost` where every other category says `Price` — the wiki labels Upgrade Points
 * differently, and mapping it to `Price` would silently write nothing for all 32 traits.
 */
export const CATALOG_FIELD_MAP = {
  weapons: [
    { field: "Price", index: 3, label: "cost", rule: "cost" },
    { field: "Size", index: 2, label: "size", rule: "size" },
  ],
  tools: [{ field: "Price", index: 2, label: "cost", rule: "cost" }],
  consumables: [{ field: "Price", index: 2, label: "cost", rule: "cost" }],
  traits: [{ field: "Cost", index: 2, label: "up", rule: "up" }],
};

/**
 * Catalog fields the wiki can describe but this script still must not write, and why.
 *
 * Both are write-through hazards ADR-0005's amendments found the hard way — a scraped value that is
 * CORRECT and still breaks something downstream, because another part of the app reads the field
 * positionally or derives a path from it.
 */
export const GATED_CATALOG_FIELDS = {
  ammoClass:
    "an ammo selection persists as a bare index into AMMO[ammoClass] (loadoutCodec.js), so changing " +
    "a weapon's class silently re-points every saved selection on it. Needs a FORMAT_VERSION bump " +
    "and a saved-selection migration first.",
  name:
    "the display name feeds slugify() and therefore the on-disk image path " +
    "(client/public/images/{category}/{slug}). Renaming without re-running scrape-images.mjs loses " +
    "the art with no error anywhere.",
};

/** Fields no scrape may ever derive, in any category. */
export const NEVER_DERIVED = {
  group:
    "an app-side UI taxonomy with no wiki equivalent. The wiki's Tools/Consumables subcategories " +
    "are multi-valued and its trait schemes are two orthogonal ones (Regular/Burn/Scarce/Event by " +
    "acquisition, Offensive/Defensive/… by function). Traits even carry a literal `Category` field, " +
    "which is precisely the trap: it looks like `group` and is not.",
  type:
    "a rules input — calc.js counts consumables by it and loadoutSlice.js enforces the 4-per-category " +
    "cap on the result. It may only come from a mechanical cap category, never from an infobox field.",
  AMMO: "has no wiki source page at all; /wiki/Ammo is prose. Prices are per-weapon, not per-pool.",
};

/**
 * Plausible ranges, measured against the catalog and the wiki rather than assumed.
 *
 * NOTE: ADR-0005's confirmation criteria and SPEC-0007 as first written both said "size ∈ 1..3".
 * That is wrong, and implementing it literally would fail 17 of 38 weapons on a correct parse —
 * the wiki and the catalog agree that sizes run 1..5, and 5 is the entire weapon budget `capMax`
 * grants. SPEC-0007 has been corrected; this constant is the measured range.
 */
export const RANGE_RULES = {
  cost: { min: 1, max: 5000, why: "Hunt Dollars; the catalog's real spread is 10..1015" },
  size: { min: 1, max: 5, why: "slot sizes run 1..5; 5 fills the whole weapon budget (calc.js capMax)" },
  up: { min: 1, max: 12, why: "Upgrade Points; the catalog's real spread is 1..9" },
};

/**
 * Parse a scraped value into an integer, or return null.
 *
 * Deliberately strict. A lenient parse — stripping non-digits and taking what is left — is exactly
 * how "wrong but well-formed" gets written: `"1.5"` would become `15`, and `"75 Hunt Dollars"`
 * would become `75` on one page and `75000` on another that spells the currency differently.
 * Anything that is not a whole number, optionally comma-grouped, is a parse failure.
 */
export function parseNumeric(raw) {
  const match = /^\s*([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+)\s*$/.exec(String(raw ?? ""));
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, ""));
  return Number.isInteger(value) ? value : null;
}

/** Check a parsed value against its rule. Returns null when acceptable, else the reason it is not. */
export function rangeViolation(value, rule) {
  const spec = RANGE_RULES[rule];
  if (!spec) return `no range rule named "${rule}"`;
  if (value < spec.min || value > spec.max) {
    return `${value} is outside the plausible ${rule} range ${spec.min}..${spec.max} (${spec.why})`;
  }
  return null;
}

/**
 * Work out every catalog value this run would overwrite, without touching anything.
 *
 * Returns `{ changes, rejected }`. A value that cannot be parsed, or that parses outside its range,
 * lands in `rejected` and is reported — it never silently becomes a change, and it never aborts the
 * other items.
 */
export function planCatalogWrites(records, catalogRows) {
  const changes = [];
  const rejected = [];

  for (const [category, rows] of Object.entries(catalogRows)) {
    const maps = CATALOG_FIELD_MAP[category];
    if (!maps) continue;
    for (const row of rows) {
      const id = row[0];
      const record = records[id];
      if (!record?.fields) continue;

      for (const { field, index, label, rule } of maps) {
        const raw = record.fields[field];
        if (raw === undefined) continue;

        const value = parseNumeric(raw);
        if (value === null) {
          rejected.push({ id, category, label, raw, url: record.wikiUrl, reason: `not a whole number` });
          continue;
        }
        const violation = rangeViolation(value, rule);
        if (violation) {
          rejected.push({ id, category, label, raw, url: record.wikiUrl, reason: violation });
          continue;
        }
        if (value !== row[index]) {
          changes.push({ id, category, label, index, from: row[index], to: value, url: record.wikiUrl });
        }
      }
    }
  }
  return { changes, rejected };
}

/**
 * Replace one element of a single-line catalog tuple, preserving everything else on the line.
 *
 * Surgical rather than parse-and-regenerate: SPEC-0007 requires catalog.js to stay hand-authored
 * and human-readable, and regenerating it would flatten every comment in the file — including the
 * ones recording why rows were retired and why taxonomies are what they are. Splitting on
 * top-level commas keeps quoted values containing commas intact.
 */
export function replaceTupleField(line, index, nextValue) {
  const open = line.indexOf("[");
  const close = line.lastIndexOf("]");
  if (open === -1 || close === -1 || close < open) return null;

  const inner = line.slice(open + 1, close);
  const parts = [];
  let depth = 0;
  let quote = null;
  let current = "";
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (quote) {
      current += ch;
      if (ch === quote && inner[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "[" || ch === "{") depth += 1;
    if (ch === "]" || ch === "}") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  if (index >= parts.length) return null;

  // Preserve the original spacing around the value being replaced.
  const leading = parts[index].match(/^\s*/)[0];
  const trailing = parts[index].match(/\s*$/)[0];
  parts[index] = `${leading}${nextValue}${trailing}`;
  return `${line.slice(0, open + 1)}${parts.join(",")}${line.slice(close)}`;
}

/** The `export const NAME = [` each catalog category lives under. */
const CATEGORY_EXPORT = { weapons: "WEAPONS", tools: "TOOLS", traits: "TRAITS", consumables: "CONS" };

/**
 * The line range of one category's array, so a row search cannot wander into another category.
 *
 * Returns `[startLine, endLine)` or null when the export is not found.
 */
export function categoryLineRange(lines, category) {
  const exportName = CATEGORY_EXPORT[category];
  if (!exportName) return null;
  const start = lines.findIndex((line) => line.startsWith(`export const ${exportName} = [`));
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length && !/^\];?\s*$/.test(lines[end])) end += 1;
  return [start + 1, end];
}

/**
 * Apply planned changes to catalog.js source text.
 *
 * Rows are located by their id literal at the start of the tuple, so a reordered catalog still
 * lands its edits correctly, and a row that cannot be located is reported rather than guessed at.
 *
 * The search is SCOPED to the change's own category array. catalog.js's header states that an id is
 * "unique within its category" — which permits the same id string in two different categories. A
 * whole-file search would then find whichever line came first and apply the write at that index,
 * and the indices mean different things per category: 3 is `cost` in WEAPONS but `group` in TOOLS.
 * That would write a number into a group slot — precisely the wrong-but-well-formed corruption the
 * rest of this machinery exists to prevent. No collision exists in the catalog today; this makes it
 * unable to matter if one ever does. (Raised in review of #194.)
 */
export function applyCatalogWrites(source, changes) {
  const lines = source.split("\n");
  const applied = [];
  const unlocated = [];

  for (const change of changes) {
    const needle = `["${change.id}",`;
    const range = categoryLineRange(lines, change.category);
    if (!range) {
      unlocated.push(change);
      continue;
    }
    const [from, to] = range;
    let lineNo = -1;
    for (let i = from; i < to; i++) {
      if (lines[i].trimStart().startsWith(needle)) {
        lineNo = i;
        break;
      }
    }
    if (lineNo === -1) {
      unlocated.push(change);
      continue;
    }
    const next = replaceTupleField(lines[lineNo], change.index, change.to);
    if (next === null) {
      unlocated.push(change);
      continue;
    }
    lines[lineNo] = next;
    applied.push({ ...change, line: lineNo + 1 });
  }

  return { source: lines.join("\n"), applied, unlocated };
}

/** The per-field diff SPEC-0007 requires a write-through run to print BEFORE it applies anything. */
export function formatCatalogPlan({ changes, rejected }) {
  const lines = [];
  if (changes.length === 0) lines.push("catalog write-through: no hand-authored value differs from the wiki.");
  else {
    lines.push(`catalog write-through: ${changes.length} field(s) would change`);
    for (const c of changes) {
      lines.push(`  ${c.category}/${c.id}  ${c.label}: ${c.from} -> ${c.to}   ${c.url}`);
    }
  }
  if (rejected.length > 0) {
    lines.push(`  ${rejected.length} value(s) refused (item unchanged):`);
    for (const r of rejected) {
      lines.push(`    ${r.category}/${r.id}  ${r.label}: "${r.raw}" — ${r.reason}   ${r.url}`);
    }
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Run orchestration: per-item try/catch, never lets one item's failure abort the run.
// ---------------------------------------------------------------------------

/**
 * Was this run narrow enough that it cannot stand in for the whole catalog?
 *
 * Counted over DISTINCT categories, not the raw list. `--only=weapons,weapons,tools,traits` passes
 * the unknown-category check and has length 4, so a length comparison called it a full run and let
 * it rewrite the dataset without consumables — dropping ~30 committed records with no warning and
 * no failures, which is exactly the silent truncation this guard exists to prevent.
 *
 * Exported and used by both the run loop and the CLI banner so the two cannot disagree about what
 * "partial" means.
 */
export function isPartialRun({ categories = CATEGORIES, limit = null } = {}) {
  return limit !== null || new Set(categories).size !== CATEGORIES.length;
}

/**
 * The ids the committed dataset already covers.
 *
 * A missing file is not an error — the first run has nothing to compare against. A malformed one
 * is also not fatal here: the shrink guard's job is to prevent silent deletion, and refusing to
 * run because the file we are about to replace is unparseable would be the wrong failure.
 */
export async function readCoveredIds(datasetPath, fsReadFile = readFile) {
  try {
    const parsed = JSON.parse(await fsReadFile(datasetPath, "utf8"));
    return new Set(Object.keys(parsed?.items ?? {}));
  } catch {
    return new Set();
  }
}

export async function runStatsScrape(options, deps) {
  const {
    categories = CATEGORIES,
    delayMs = DEFAULT_DELAY_MS,
    dryRun = false,
    limit = null,
    datasetPath = STATS_DATA_PATH,
    allowShrink = false,
    writeCatalog = false,
    catalogPath = CATALOG_PATH,
  } = options;
  const {
    fetchFn,
    userAgent = USER_AGENT,
    log = logStructured,
    now = () => new Date().toISOString(),
    fsWriteFile = writeFile,
    fsMkdir = mkdir,
    fsReadFile = readFile,
    // The human-readable half of "printed before applied". `log` carries the same facts as JSON
    // events for machines; this prints the diff table for the operator, and it is injected rather
    // than called at the end of main() so it lands BEFORE the file is read, not after it is
    // rewritten. (Review of #194: the banner promised before, the call site delivered after.)
    printPlan = () => {},
  } = deps;

  const unknown = categories.filter((c) => !CATEGORIES.includes(c));
  if (unknown.length > 0) {
    // Fail loudly rather than visiting zero items and exiting 0. `collectCatalogItems` skips names
    // it does not recognise, so `--only=weapon` (typo'd singular) used to run clean and scrape
    // nothing, which reads as "the catalog is empty" rather than "the flag is wrong".
    throw new ScrapeError(
      `unknown categor${unknown.length === 1 ? "y" : "ies"}: ${unknown.join(", ")}. ` +
        `Valid values are: ${CATEGORIES.join(", ")}`
    );
  }

  const summary = createSummary();

  let robotsGroups;
  try {
    robotsGroups = await fetchRobotsTxt(fetchFn, userAgent);
  } catch (err) {
    // Fatal and run-level, not per-item: we cannot honor robots.txt if we cannot read it, so fail
    // closed rather than assume permission.
    log({ level: "error", event: "robots-fetch-failed", reason: err.message });
    throw err;
  }

  const rateLimiter = new RateLimiter(delayMs);
  // Deduplicated so a repeated `--only` value cannot fetch the same category's pages twice.
  let items = collectCatalogItems([...new Set(categories)]);
  if (limit !== null && limit >= 0) items = items.slice(0, limit);

  const records = {};

  for (const target of items) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await scrapeItemStats(target, { ...deps, robotsGroups, rateLimiter, userAgent, dryRun });
      recordResult(summary, result);
      if (result.status === "succeeded") records[result.id] = buildStatsRecord(result, { now });
      log({
        level: "info",
        event: `item-${result.status}`,
        category: target.category,
        item: target.name,
        id: target.id,
        ...(result.reason ? { reason: result.reason } : {}),
        ...(result.infoboxCount ? { infoboxes: result.infoboxCount } : {}),
        ...(result.selection ? { selectedBy: result.selection.method } : {}),
        ...(result.fields ? { fields: Object.keys(result.fields).length } : {}),
        ...(result.revision ? { revision: result.revision } : {}),
      });
    } catch (err) {
      recordResult(summary, {
        status: "failed",
        category: target.category,
        id: target.id,
        item: target.name,
        errorType: err.name,
        reason: err.message,
        url: err.url,
      });
      log({
        level: "error",
        event: "item-failed",
        category: target.category,
        item: target.name,
        id: target.id,
        errorType: err.name,
        reason: err.message,
        url: err.url,
      });
    }
  }

  // The dataset is written only for a run that could have covered the whole catalog. A --limit or
  // --only run would otherwise silently truncate itemStats.json to whatever it happened to visit,
  // and the deletion would look like a scrape result rather than a flag.
  const partial = isPartialRun({ categories, limit });

  // The same hazard reached by a path the operator did not choose. The write replaces the file
  // wholesale, so a run where most items FAILED — the shape ADR-0005 names as its worst realistic
  // risk, a wiki markup change the parser no longer matches — would delete every record it could
  // not re-derive, including the revision baseline this story exists to capture. Losing coverage is
  // therefore a decision, not a side effect: it needs --allow-shrink, which is also how a genuine
  // catalog removal gets through.
  const dropped = [];
  if (!dryRun && !partial && !allowShrink) {
    const covered = await readCoveredIds(datasetPath, fsReadFile);
    for (const id of covered) if (!(id in records)) dropped.push(id);
    dropped.sort();
  }

  const blockedByShrink = dropped.length > 0;
  let written = null;
  if (!dryRun && !partial && !blockedByShrink && Object.keys(records).length > 0) {
    written = await writeStatsFile(records, { datasetPath, fsWriteFile, fsMkdir });
  }

  // One reason, in precedence order — a dry run is why nothing was written even if the run was also
  // partial. Two spreads both keyed `datasetSkipped` silently dropped one of them.
  const datasetSkipped = dryRun
    ? "dry-run writes nothing"
    : partial
      ? "partial run (--limit or --only) never rewrites the dataset"
      : blockedByShrink
        ? `would drop ${dropped.length} already-covered item${dropped.length === 1 ? "" : "s"} — ` +
          `re-run with --allow-shrink if the loss is intended`
        : null;

  // Why the write-through did not happen, in the same precedence order and only when it was asked
  // for. A silent no-op on the run the shrink guard just tripped would read as "nothing to correct".
  const catalogSkipped = !writeCatalog
    ? null
    : dryRun
      ? "dry-run writes nothing"
      : partial
        ? "partial run never writes catalog.js"
        : blockedByShrink
          ? `shrink guard tripped — ${dropped.length} already-covered item${dropped.length === 1 ? "" : "s"} ` +
            `would be dropped, so this run's surviving parses are not trusted against catalog.js`
          : null;

  // Catalog write-through. Opt-in, and refused on exactly the runs that cannot stand in for the
  // whole catalog — a partial run's records say nothing about the items it never visited, and
  // reconciling against a subset is how a "correction" turns into a selective one.
  //
  // `blockedByShrink` gates this too, and that is the more important half. A mass-failure run is
  // ADR-0005's worst realistic risk (a wiki markup change the parser no longer matches), and the
  // items that FAILED are harmless here — they are absent from `records`, so nothing is planned for
  // them. The hazard is the items that SUCCEEDED against changed markup and produced a
  // wrong-but-in-range number. A shrink signal is the best evidence available that the surviving
  // parses should be distrusted, so spending it only on the regenerable dataset while catalog.js —
  // which carries the app's budget math — writes on unguarded is exactly backwards. (Review of #194.)
  let catalogPlan = null;
  let catalogWritten = null;
  if (writeCatalog && !dryRun && !partial && !blockedByShrink) {
    catalogPlan = planCatalogWrites(records, {
      weapons: WEAPONS,
      tools: TOOLS,
      traits: TRAITS,
      consumables: CONS,
    });
    // Printed BEFORE anything is applied — SPEC-0007 requires the operator to see every intended
    // overwrite while it is still an intention.
    log({
      level: "info",
      event: "catalog-plan",
      changes: catalogPlan.changes.length,
      rejected: catalogPlan.rejected.length,
    });
    for (const c of catalogPlan.changes) {
      log({ level: "info", event: "catalog-change", id: c.id, field: c.label, from: c.from, to: c.to, url: c.url });
    }
    for (const r of catalogPlan.rejected) {
      log({ level: "warn", event: "catalog-value-refused", id: r.id, field: r.label, raw: r.raw, reason: r.reason, url: r.url });
    }
    printPlan(catalogPlan);

    if (catalogPlan.changes.length > 0) {
      const source = await fsReadFile(catalogPath, "utf8");
      const result = applyCatalogWrites(source, catalogPlan.changes);
      for (const u of result.unlocated) {
        log({ level: "error", event: "catalog-row-not-located", id: u.id, field: u.label });
      }
      await fsWriteFile(catalogPath, result.source, "utf8");
      catalogWritten = { path: catalogPath, applied: result.applied.length, unlocated: result.unlocated.length };
    }
  }

  log({
    level: "info",
    event: "run-summary",
    succeeded: summary.succeeded.length,
    failed: summary.failed.length,
    skipped: summary.skipped.length,
    records: Object.keys(records).length,
    ...(written ? { wrote: written } : {}),
    ...(datasetSkipped ? { datasetSkipped } : {}),
    ...(blockedByShrink ? { wouldDrop: dropped } : {}),
    ...(catalogWritten ? { catalogWritten } : {}),
    ...(catalogSkipped ? { catalogSkipped } : {}),
  });

  summary.records = records;
  summary.datasetPath = written;
  summary.droppedIds = dropped;
  summary.catalogPlan = catalogPlan;
  summary.catalogWritten = catalogWritten;
  summary.catalogSkipped = catalogSkipped;
  return summary;
}

/**
 * Write itemStats.json.
 *
 * Keys are sorted so a re-scrape produces a diff that reflects what the wiki changed rather than
 * the order the catalog happened to iterate in. `_generated` is the in-file marker SPEC-0007 asks
 * for: JSON carries no comments, and this file must never be hand-edited.
 */
export async function writeStatsFile(records, { datasetPath = STATS_DATA_PATH, fsWriteFile = writeFile, fsMkdir = mkdir } = {}) {
  const sorted = {};
  for (const id of Object.keys(records).sort()) sorted[id] = records[id];

  const payload = {
    _generated: {
      by: "scripts/scrape-stats.mjs",
      governedBy: "ADR-0005, SPEC-0007 REQ \"Generated, Committed Stats File\"",
      warning: "Generated file — do not hand-edit. Re-running the scrape rewrites it in place.",
    },
    items: sorted,
  };

  try {
    await fsMkdir(path.dirname(datasetPath), { recursive: true });
    await fsWriteFile(datasetPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  } catch (err) {
    throw new ScrapeError(`failed to write dataset to ${datasetPath}: ${err.message}`, { cause: err });
  }
  return datasetPath;
}

export function formatSummary(summary) {
  const lines = [
    `scrape-stats summary: ${summary.succeeded.length} succeeded, ${summary.failed.length} failed, ` +
      `${summary.skipped.length} skipped`,
  ];
  for (const f of summary.failed) {
    lines.push(`  FAILED  ${f.category}/${f.id} ("${f.item}") [${f.errorType}]: ${f.reason}`);
  }
  for (const s of summary.skipped) {
    lines.push(`  SKIPPED ${s.category}/${s.id} ("${s.item}"): ${s.reason}`);
  }
  if (summary.droppedIds?.length > 0) {
    // Loud, and last, because it means the run produced no write at all.
    lines.push(
      `  DATASET NOT WRITTEN: ${summary.droppedIds.length} item(s) the committed dataset covers ` +
        `did not survive this run — writing would delete them.`
    );
    for (const id of summary.droppedIds) lines.push(`    would drop  ${id}`);
    lines.push("  Re-run with --allow-shrink if the loss is intended (a removed catalog item).");
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// CLI entrypoint (only when executed directly — never on import, so the tests importing the
// functions above never trigger a live run).
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const options = {
    categories: CATEGORIES,
    delayMs: DEFAULT_DELAY_MS,
    dryRun: false,
    limit: null,
    allowShrink: false,
    writeCatalog: false,
  };
  for (const arg of argv) {
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--allow-shrink") options.allowShrink = true;
    else if (arg === "--write-catalog") options.writeCatalog = true;
    else if (arg.startsWith("--only=")) {
      options.categories = arg
        .slice("--only=".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (arg.startsWith("--delay-ms=")) {
      const parsed = Number(arg.slice("--delay-ms=".length));
      if (Number.isFinite(parsed) && parsed >= 0) options.delayMs = parsed;
    } else if (arg.startsWith("--limit=")) {
      const parsed = Number(arg.slice("--limit=".length));
      if (Number.isInteger(parsed) && parsed >= 0) options.limit = parsed;
    } else if (arg.startsWith("--out=")) {
      const value = arg.slice("--out=".length).trim();
      if (value) options.datasetPath = path.resolve(value);
    }
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const partial = isPartialRun(options);
  console.log(
    `scrape-stats: starting (${options.categories.join(", ")}), delay=${options.delayMs}ms, ` +
      `dry-run=${options.dryRun}${options.limit === null ? "" : `, limit=${options.limit}`}`
  );
  console.log("scrape-stats: manual, offline tool per ADR-0002/ADR-0005 — not run by build/dev/CI.");
  if (options.dryRun) console.log("scrape-stats: dry-run — nothing will be written.");
  else if (partial) {
    console.log(
      "scrape-stats: partial run (--limit/--only) — reports only. The dataset is rewritten by a full run,"
    );
    console.log("              so a partial one cannot truncate it to whatever it happened to visit.");
  }
  if (options.allowShrink && !options.dryRun) {
    console.log(
      "scrape-stats: --allow-shrink — items the committed dataset covers but this run does not will"
    );
    console.log("              be deleted from it. Read the diff.");
  }

  if (options.writeCatalog && !options.dryRun && !partial) {
    console.log("scrape-stats: --write-catalog — the plan below is printed before anything is applied.");
  }

  const summary = await runStatsScrape(options, {
    fetchFn: fetch,
    // Printed from inside the run, before catalog.js is read — see the banner above.
    printPlan: (plan) => console.log(formatCatalogPlan(plan)),
  });

  if (summary.catalogSkipped) {
    console.log(`scrape-stats: --write-catalog refused — ${summary.catalogSkipped}`);
  }
  console.log(formatSummary(summary));

  process.exitCode = summary.failed.length > 0 ? 1 : 0;
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMainModule) {
  main().catch((err) => {
    console.error(`scrape-stats: fatal error: ${err.message}`);
    if (err.cause) console.error(`  caused by: ${err.cause.message || err.cause}`);
    process.exitCode = 1;
  });
}
