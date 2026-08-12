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
//       --discover                                Crawl the wiki's category indexes and report
//                                                  coverage, classifying what the catalog lacks.
//                                                  Traits are read from three indexes (Regular,
//                                                  Scarce, Event) and de-duplicated; see
//                                                  CATEGORY_INDEX.
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
  // Whole-page, NOT per-infobox: catlinks describe the page, and a page's variant infoboxes share
  // its categories. Read here so the rarity set comes from the same fetch as the fields.
  const categories = parsePageCategories(html);
  // Also whole-page. A page's description describes the base item; variant sub-pages have their own.
  const description = parseDescription(html);

  return {
    status: "succeeded",
    category,
    id,
    item,
    url: pageUrl,
    canonicalTitle,
    categories,
    description,
    // SPEC-0007 REQ "Canonical Titles Are Read From the Page": an HTTP 200 does not confirm the
    // catalog's display name is current, because MediaWiki serves renamed pages through redirects.
    // Comparing what the page calls itself against what the catalog calls it turns a rename into a
    // reported candidate instead of something absorbed silently.
    renamed: canonicalTitle && canonicalTitle.trim().toLowerCase() !== item.trim().toLowerCase()
      ? { from: item, to: canonicalTitle }
      : null,
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
    // Prose, read from the page body rather than the infobox — see parseDescription. `null` when the
    // page states none, which is a real outcome rather than a parse failure: some pages carry only a
    // hatnote above their first section. Untrusted output; a consumer MUST render it as text.
    description: result.description ?? null,
    // Lifted OUT of the description string, which is the point of #178: "a scraper that captures the
    // description string satisfies §3.0 while leaving dual-wieldability locked inside a blob of text —
    // it must be lifted to its own boolean to be queryable." Three-valued; see dualWieldFrom.
    dualWield: dualWieldFrom(result.description),
    // Scrape metadata, never a catalog field, and never `group` (SPEC-0007 REQ "Acquisition Class
    // Is Captured So Roster Membership Is Checkable"). This is what makes "should this item have a
    // row?" checkable instead of arguable.
    //
    // `acquisitionClasses` is the authoritative set; `acquisition` is retained as the infobox's own
    // single-string answer, because the two can disagree and the disagreement is worth seeing. Both
    // are observation. Neither says what a Scarce item COSTS — that mapping is a game rule, and
    // ADR-0005 keeps game rules out of this file.
    ...acquisitionOf(result.fields, { categories: result.categories ?? [] }),
    fields: result.fields,
    sourceRevision: result.revision,
    ingestedAt: now(),
  };
}

// ---------------------------------------------------------------------------
// Discovery (SPEC-0007 REQ "Discovery Classifies Every Unmatched Page Before Proposing It",
// REQ "Roster Coverage Is Reported Against the Wiki's Own Categories").
//
// A wiki page existing does not mean the item exists. `Category:Tools` has 23 members and two are
// tombstones — the Electric Lamp, removed in Update 2.0 and deleted from TOOLS in e0076d3 with a
// legacy carve-out still held at LEGACY_TOOL_IDS[9], and the Multitool, a prototype that never
// shipped. That is 9% of one category, and a diff that treats "in the category, not in the catalog"
// as "missing" proposes re-adding both.
//
// So every unmatched member is classified before it can be proposed. The default is `live`
// deliberately: a live item wrongly proposed is a suggestion a human rejects, while a live item
// wrongly hidden as a tombstone is information nobody sees again.
// ---------------------------------------------------------------------------

/**
 * The wiki categories that enumerate each catalog category's membership.
 *
 * A LIST per catalog category, because one index does not enumerate the traits. `traits` previously
 * read `Category:Purchasable_Traits`, which is a **redirect to `Category:Traits/Regular`** — the
 * server follows it, so the crawl returned 58 Regular traits and a coverage figure that looked
 * complete while 14 Scarce and 18 Event traits were outside the frame entirely. A Scarce trait could
 * not be reported as missing, as unpurchasable, or as a tombstone, because it was never enumerated.
 * The name is what hid it: "Purchasable Traits" reads as every trait you can obtain and means the
 * Regular ones. (#231, ADR-0013.)
 *
 * Burn and Catalyst are deliberately absent. Five of the six Burn traits are members of the Scarce
 * or Event indexes and Necromancer is already in the catalog, so Burn adds no page a union of these
 * three would miss; Catalyst is on the functional axis per SPEC-0007 and its five members are
 * already modelled as Regular traits.
 *
 * Governing: ADR-0013, SPEC-0007 REQ "Roster Coverage Is Reported Against the Wiki's Own Categories"
 */
export const CATEGORY_INDEX = {
  weapons: ["Category:Weapons"],
  tools: ["Category:Tools"],
  traits: ["Category:Traits/Regular", "Category:Traits/Scarce", "Category:Traits/Event"],
  consumables: ["Category:Consumables"],
};

/**
 * Pages this project has already decided about, so a diff cannot re-litigate them.
 *
 * Keyed by wiki page path. The reason is recorded rather than implied — #164's whole point is that
 * skipping silently is indistinguishable from a parse failure.
 */
export const KNOWN_TOMBSTONES = {
  "Tools/Electric_Lamp": {
    state: "removed",
    reason:
      "removed from the game in Update 2.0; deleted from TOOLS in e0076d3, with a null placeholder " +
      "still held at LEGACY_TOOL_IDS[9] so legacy saved loadouts keep resolving",
  },
  // Its own class, not a synonym for removed: nothing was ever taken away, so there is no legacy id
  // to preserve and no saved loadout that could reference it.
  "Tools/Multitool": {
    state: "never-shipped",
    reason: "a cut prototype; lockpicking was removed as a feature before release",
  },
};

/**
 * The mirror of KNOWN_TOMBSTONES: pages whose removal language is historical, and whose item is in
 * the game today.
 *
 * It exists because Hunt takes items out and later brings them back. Shredder was removed in Update
 * 2.2.2 and returned as a Scarce weapon in the Murder Circus Encore event, so its page states both
 * — and the first live `--discover` run (2026-08-12) filed it as a tombstone, because a whole-page
 * scan for removal language reads whichever sentence comes first. That is the hazard #164 exists to
 * fix, pointing the other way: the classifier hid a live item instead of proposing a dead one.
 *
 * Recorded from the live game rather than inferred from the page. In-game state is the authority
 * that a page's update history is merely evidence about, and when the two disagree the game wins.
 *
 * Unlike tombstones these are NOT short-circuited before the fetch: a returned item is a real item
 * with a real price, and whether it lands in `unpurchasable` or `missing` turns on reading it.
 */
export const KNOWN_LIVE = {
  "Weapons/Shredder": {
    reason:
      "removed in Update 2.2.2, then returned as a Scarce weapon in the Murder Circus Encore event; " +
      "confirmed present in game 2026-08-11",
  },
};

const REMOVED_SIGNALS = [
  /removed from the game/i,
  /was removed in update/i,
  /no longer (?:available|obtainable|in the game)/i,
];
// Checked only AFTER a removal signal hits, and only later in the text than that hit — see
// classifyPage. On their own these match ordinary prose ("the event returns as a seasonal mode"),
// so they are a supersedes-check on a removal claim, never a verdict of their own.
const RETURN_SIGNALS = [
  /returns? as a/i,
  /returned to the game/i,
  /re-?(?:added|introduced|released)/i,
  /brought back/i,
];
const NEVER_SHIPPED_SIGNALS = [/\bprototype\b/i, /early alpha/i, /never (?:released|implemented|shipped)/i];

/**
 * Classify one wiki page as live, removed, or never-shipped, with the evidence that decided it.
 *
 * Evidence is returned rather than just a verdict so a run summary can be audited without
 * re-fetching every page — "removed, because the page says 'Iron Repeater removed from the game'"
 * is checkable; "removed" alone is a claim.
 */
export function classifyPage(html, { page } = {}) {
  const known = page ? KNOWN_TOMBSTONES[page] : null;
  if (known) return { ...known, evidence: "recorded in KNOWN_TOMBSTONES" };
  const confirmedLive = page ? KNOWN_LIVE[page] : null;
  if (confirmedLive) return { state: "live", reason: confirmedLive.reason, evidence: "recorded in KNOWN_LIVE" };
  const text = textContent(html);
  // Update-history prose runs chronologically, so the LAST thing the page says about availability is
  // the operative one. Compared as latest-removal against latest-return across every pattern, not
  // first-pattern-that-matches: the earlier version returned on the first matching PATTERN in array
  // order and anchored the return-check at that index, so a later removal phrased with a different
  // pattern was never consulted — "removed ... returns ... no longer available" read as live.
  // (Review of #230.)
  //
  // Leaning live on a tie is deliberate and matches this module's stated default: a live item wrongly
  // proposed is a suggestion a human rejects, while a live item wrongly buried is information nobody
  // sees again.
  const lastRemoval = lastMatchOf(text, REMOVED_SIGNALS);
  if (lastRemoval) {
    const lastReturn = lastMatchOf(text, RETURN_SIGNALS);
    if (lastReturn && lastReturn.index > lastRemoval.index) {
      return {
        state: "live",
        reason: "the page states it was removed and later returned",
        evidence: excerptAround(text, lastReturn.index),
      };
    }
    return {
      state: "removed",
      reason: "the page states it was removed",
      evidence: excerptAround(text, lastRemoval.index),
    };
  }
  for (const rx of NEVER_SHIPPED_SIGNALS) {
    const hit = rx.exec(text);
    if (hit) {
      return {
        state: "never-shipped",
        reason: "the page describes it as a prototype or alpha-only",
        evidence: excerptAround(text, hit.index),
      };
    }
  }
  return { state: "live", reason: "no removal or prototype language on the page", evidence: null };
}

function excerptAround(text, index, span = 90) {
  return text.slice(Math.max(0, index - span / 2), index + span).trim();
}

/**
 * The LATEST match of any pattern anywhere in `text`, or null. Patterns must be non-global.
 *
 * Every occurrence of every pattern is considered, not the first of each: "which statement comes
 * last" cannot be answered by a per-pattern first-match, and answering it wrongly is what let a
 * re-removal read as a return.
 */
function lastMatchOf(text, patterns) {
  let best = null;
  for (const rx of patterns) {
    const scan = new RegExp(rx.source, rx.flags.includes("g") ? rx.flags : `${rx.flags}g`);
    let hit;
    while ((hit = scan.exec(text)) !== null) {
      if (best === null || hit.index > best.index) best = { index: hit.index, match: hit[0] };
      // A zero-width match would spin forever on the same index.
      if (hit.index === scan.lastIndex) scan.lastIndex += 1;
    }
  }
  return best;
}

/**
 * Member page paths listed under a category index page, in document order.
 *
 * Reads the FIRST page of the index only — there is no follow of MediaWiki's "next page" link. Not
 * currently reachable: the largest category is `Category:Weapons` at 147 against MediaWiki's
 * 200-per-page default. A category crossing 200 would silently under-report coverage, which is the
 * exact failure mode the coverage table exists to prevent, so the bound is recorded here rather
 * than discovered later from a number that looks plausible.
 */
export function parseCategoryMembers(html) {
  const anchor = html.indexOf('id="mw-pages"');
  if (anchor === -1) return [];
  const seg = html.slice(anchor);
  const seen = [];
  for (const m of seg.matchAll(/<a href="\/wiki\/([^"?#]+)"[^>]*title="/g)) {
    const page = decodeURIComponent(m[1]).replace(/_/g, " ");
    if (/^(?:Category|File|Special|Template|Help):/i.test(page)) continue;
    if (!seen.includes(page)) seen.push(page);
  }
  return seen;
}

/**
 * The acquisition metadata that decides whether an item belongs in the catalog at all.
 *
 * SPEC-0007 REQ "Acquisition Class Is Captured": this is scrape metadata, not a catalog field, and
 * it MUST NOT be written into `group`. Traits carry a literal `Category` field ("Supportive",
 * "Offensive") that looks exactly like `group` and is the wiki's functional taxonomy — it is
 * deliberately not read here.
 *
 * Two signals, both stated by the wiki rather than inferred:
 *   - Traits carry `Type`: Regular / Burn / Scarce / Event, which is SPEC-0007's vocabulary exactly.
 *   - Everything else carries `Price`, and an unpurchasable item says so in words: a Tarot Card's
 *     price is the literal string "Scarce". `parseNumeric` already refuses it rather than coercing,
 *     which is why purchasability falls out of the same strict parse the write-through uses.
 *
 * `purchasable` is deliberately THREE-valued — `true`, `false`, `null` — because two of them cannot
 * carry the difference that matters:
 *
 *   - `false` means the page stated a price this parser refuses. That is a determination the wiki
 *     made, and it is what makes the Tarot Card boundary machine-checkable.
 *   - `null` means no `Price` or `Cost` field was found at all. That is no evidence either way.
 *
 * Folding the second into the first reported an ABSENT field as a deliberate exclusion, which is
 * exactly what SPEC-0007 REQ "Budget-Affecting Attributes Are Stored, Never Inferred" forbids: an
 * attribute the scrape cannot resolve is recorded as unresolved, never defaulted to a value that
 * reads as a determination. (Review of #186.)
 */
export function acquisitionOf(fields = {}, { categories = null } = {}) {
  const acquisition = fields.Type ?? null;
  const priceRaw = fields.Price ?? fields.Cost ?? null;
  const priceValue = parseNumeric(priceRaw);

  let purchasable = null;
  if (priceValue !== null && priceValue > 0) purchasable = true;
  else if (priceRaw !== null && String(priceRaw).trim() !== "") purchasable = false;

  return {
    acquisition,
    ...(categories === null ? {} : { acquisitionClasses: acquisitionClassesFrom(categories) }),
    priceStated: priceRaw,
    purchasable,
  };
}

/**
 * The rarity axis of the wiki's trait category tree — exactly the four classes SPEC-0007 names.
 *
 * Order is the reported order, deliberately not alphabetical: `Regular` first because it is the
 * common case, then the rest in a fixed sequence. A stable order means two runs produce the same
 * array for the same trait, so the dataset diffs cleanly.
 *
 * `Catalyst` was wrongly listed here and is now on the functional axis below, where SPEC-0007 REQ
 * "Fields the Scraper Must Not Derive" always put it. The data agrees and is what settles it: all
 * five Catalyst traits carry `Type: "Regular"` and nothing else, where a genuinely two-rarity trait
 * lists both of its classes in that field (Relentless is `"Burn , Scarce"`). Catalyst never appears
 * on the acquisition axis, so `Regular + Catalyst` was one rarity plus one function reported as two
 * rarities. (Review of #230.)
 */
export const ACQUISITION_CLASS_CATEGORIES = ["Regular", "Scarce", "Burn", "Event"];

/**
 * The FUNCTIONAL axis, listed here only so it is visibly excluded — and matching SPEC-0007's
 * taxonomy sentence term for term, including `Solo` and `Catalyst`.
 *
 * `Traits/Supportive` sits in the same `#catlinks` block as `Traits/Scarce` and is the wiki's
 * functional taxonomy — which is exactly `group`, and SPEC-0007 REQ "Fields the Scraper Must Not
 * Derive" forbids the scrape writing it. Naming the axis is how that exclusion stays deliberate
 * rather than looking like an oversight in the filter above.
 */
export const FUNCTIONAL_CLASS_CATEGORIES = [
  "Offensive",
  "Defensive",
  "Movement",
  "Supportive",
  "Solo",
  "Catalyst",
];

/**
 * `Category:Traits/Pact` exists on the wiki, has ZERO members as of 2026-08-11, and states no axis:
 * its category page carries a display title and a pointer back to `Category:Traits`, nothing more.
 * SPEC-0007's taxonomy sentence does not list it on either axis either.
 *
 * So it is deliberately in neither list above. A Pact trait appearing would come back with no rarity
 * class rather than a guessed one, which under ADR-0013's bidirectional test surfaces as a failure
 * to explain rather than as a silently-endorsed zero. Assigning it an axis is a decision to make
 * when there is something to look at.
 */
export const UNASSIGNED_AXIS_CATEGORIES = ["Pact"];

/**
 * Which rarity classes a page's own category membership puts it in.
 *
 * A SET, not a scalar, because the wiki's own data is a set: Relentless and Rampage are both Scarce
 * and Burn, and All Ears is both Scarce and Event. The infobox `Type` field carries the same truth
 * as a comma-joined string ("Burn , Scarce"), so reading it as one value collapsed a two-element set
 * into an opaque label that neither equals "Scarce" nor "Burn" — unusable for the membership check
 * SPEC-0007 asks for. Category membership is preferred because it survives an infobox that omits
 * `Type` entirely, which Scarce trait pages do: they carry no `Cost` row at all.
 */
// The literal sentence the wiki uses, anchored rather than loosened. Every dual-wieldable page states
// it the same way, so a tight pattern is both sufficient and the thing that keeps this honest: a looser
// match on "dual" would hit prose about the concept rather than a claim about this weapon.
const DUAL_WIELD_SIGNAL = /can be dual[-\s]?wielded/i;

/**
 * Whether the page says this weapon can be dual wielded, or null when it says nothing either way.
 *
 * Governing: #178. THREE-VALUED, on the same reasoning as `purchasable`, and the asymmetry matters
 * more here than anywhere else in this file:
 *
 *   true   the description states it outright — "Can be dual wielded." A read, not a guess.
 *   false  a description WAS read and does not state it. That is an inference from absence, and it is
 *          weaker than the `true` case: the wiki asserts dual-wieldability positively and never denies
 *          it, so an editorial omission is indistinguishable from a two-handed weapon.
 *   null   no description was read at all. No evidence in either direction.
 *
 * Recording `false` and `null` separately is what #178 asks for — "any row the scrape cannot resolve
 * is recorded as unresolved rather than defaulted to false" — and the distinction is load-bearing
 * because #178 also notes this attribute "feeds the budget math the same way `size` and `cost` do". A
 * wrong `false` becomes a slot-cost error once #179 consumes it, so a consumer must treat `false` as
 * "not stated" rather than as "denied".
 *
 * Read from the page's OWN description, which is what defuses the trap #178 flags. `Officer` (a
 * dual-wieldable pistol) and `Officer Carbine` (a rifle) share a near-identical description prefix —
 * both open "Nagant made, double-action revolver. High fire-rate, muzzle velocity" — and differ only
 * in that one ends with the dual-wield sentence. Any match on name or description SIMILARITY would
 * conflate them; matching per page cannot.
 *
 * What the wiki does NOT give us, recorded because #178 asks the right question and the answer is
 * negative: there is no `hands` field in any weapon infobox, and no infobox field mentions hands,
 * wielding, or dual anything. #178 argues `hands` is the real discriminator — Haymaker and Uppercut
 * are both size 2 and split on it — and it is not scrapable. Only five weapons state hands anywhere,
 * all melee, all in prose. So a stored boolean here cannot be backed by `hands` yet; that is a gap in
 * the source, not in the extraction.
 */
export function dualWieldFrom(description) {
  if (description === null || description === undefined || String(description).trim() === "") return null;
  return DUAL_WIELD_SIGNAL.test(String(description));
}

export function acquisitionClassesFrom(categories = []) {
  // Matched on the last path segment rather than a `Traits/` prefix, so a rarity category added under
  // another tree is picked up without an edit here. Today there is none: a Scarce WEAPON carries no
  // rarity category whatsoever — Flame Rifle's catlinks are `Weapons/Size 2`, `Weapons` and two
  // maintenance categories — and states its rarity only as the literal Price string "Scarce".
  //
  // That asymmetry is the wiki's, and both halves are recorded rather than reconciled here:
  // `acquisitionClasses` answers for traits, `priceStated`/`purchasable` answers for everything else.
  // Collapsing them into one synthesised "rarity" field would mean inventing a value for whichever
  // half of the wiki did not state one.
  const names = new Set(categories.map((c) => String(c).split("/").pop().trim()));
  return ACQUISITION_CLASS_CATEGORIES.filter((c) => names.has(c));
}

// A hatnote is navigation, not description: weapon and consumable pages open with an italicised
// "See also: Frontier 73C, Infantry 73L, Vandal 73C". Taking the first paragraph blindly would have
// written that string into `description` for most of the catalog, where it would read as data.
const HATNOTE_PREFIXES = [/^see also\b/i, /^for (?:the|other)\b/i, /^not to be confused\b/i, /^this article\b/i];

/**
 * The item's description prose, as plain text, or null when the page states none.
 *
 * Realizes the half of ADR-0005's title — "Scrape Item Stats **and Descriptions**" — that was never
 * built. `itemStats.json` carried 34 field names and not one of them was prose, because the scrape
 * only ever read infobox rows and the description lives in the page body. (#228)
 *
 * The wiki puts it in two different places, so this reads both:
 *
 *   - **Weapons, tools and consumables** carry an explicit `Description` section. That is preferred
 *     wherever it exists, because it is the page saying which prose is the description rather than
 *     us inferring it from position.
 *   - **Traits** have no such section — their headings are `Information`, `Gallery` and `Update
 *     History` — and their description is the lead prose above the first one.
 *
 * Sections are located by MediaWiki's `mw-headline` span rather than by `<h2>`, which matters for
 * more than tidiness: the table of contents is itself an `<h2 id="mw-toc-heading">Contents</h2>` with
 * no headline span, so anchoring on `<h2>` put the lead boundary *before* the description on every
 * page that has a TOC and reported no description at all.
 *
 * Multiple paragraphs are joined with a newline rather than collapsed, because the second one is
 * load-bearing where it exists. 9 of the 32 traits carry one — beastface, conduit, frontiersman,
 * kiteskin, magpie, necromancer, pain-sense, serpent, vigilant — and each is a conditional rule
 * (`SOLO:`, `CATALYST:` or `SOLO CATALYST:`) that replaces the base effect rather than restating
 * it. Collapsing to the first paragraph would drop a mechanic from more than a quarter of them.
 *
 * The result is plain text with tags stripped. SPEC-0003 already requires the hunter descriptions be
 * treated as untrusted and never inserted as markup; the same applies here, and stripping at the
 * scrape does not relieve a consumer of rendering it as text.
 */
export function parseDescription(html) {
  const start = html.indexOf("mw-parser-output");
  if (start === -1) return null;
  const body = html.slice(start);

  // The page's own answer, where it gives one.
  const described = /<span\b[^>]*class="mw-headline"[^>]*id="Description"[^>]*>[\s\S]*?<\/span>\s*<\/h[23]>/i.exec(body);
  let region;
  if (described) {
    const after = body.slice(described.index + described[0].length);
    const nextHeading = after.search(/<h[23]\b/i);
    region = nextHeading === -1 ? after : after.slice(0, nextHeading);
  } else {
    const firstHeadline = body.search(/<span\b[^>]*class="mw-headline"/i);
    region = firstHeadline === -1 ? body : body.slice(0, firstHeadline);
  }

  const paragraphs = [];
  for (const m of region.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = tidyProse(textContent(m[1]));
    if (!text) continue;
    if (HATNOTE_PREFIXES.some((rx) => rx.test(text))) continue;
    paragraphs.push(text);
  }
  return paragraphs.length === 0 ? null : paragraphs.join("\n");
}

/**
 * Close the gap an inline link leaves before punctuation.
 *
 * `textContent` replaces every tag with a space, which is right for infobox values — it keeps
 * `<a>Compact</a><img>` from becoming one word — and wrong for prose, where wiki bodies link mid
 * sentence: `restored by <a>First Aid Kit</a>.` reads back as "restored by First Aid Kit ." and
 * `<b>SOLO</b>:` as "SOLO :". Applied here rather than in `textContent` because that helper is shared
 * with the field parse, and loosening it there would rewrite stat values to fix a prose artifact.
 */
function tidyProse(text) {
  return text.replace(/\s+([,;:.!?%])/g, "$1").trim();
}

/**
 * The categories a page declares itself a member of, read from MediaWiki's own `#catlinks` block.
 *
 * Free: this is on every page the scrape already fetches, so the full rarity set costs no extra
 * request. Scoped to the catlinks block rather than the whole document because category-shaped links
 * appear in body prose and infobox rows too — `SIZE_ROW`'s value links to `Category:Weapons/Size_4`,
 * and reading that as membership would tag every weapon with its own size. That reasoning applies in
 * BOTH directions, which the first cut got wrong: it ended the block at a fixed run of three closing
 * divs and, on no match, fell through to the entire rest of the document. Three was already the
 * wrong number — `#catlinks` wraps `#mw-normal-catlinks`, so two closes the block and the third was
 * the page wrapper — and any page not closing three deep tagged a Regular trait with whatever
 * category-shaped link appeared later in the DOM. (Review of #230.)
 *
 * Depth-counted now, through the same helper `parseInfoboxFields` uses. Unbalanced markup fails
 * CLOSED, returning no categories: a missing class is incomplete data that ADR-0013's bidirectional
 * test catches, where a false `Scarce` would make the side table endorse a wrong zero instead.
 */
export function parsePageCategories(html) {
  const anchor = html.search(/<div\b[^>]*\bid="catlinks"/i);
  if (anchor === -1) return [];
  const block = sliceBalancedDiv(html, anchor);
  if (block === null) return [];
  const found = [];
  for (const m of block.matchAll(/href="\/wiki\/Category:([^"?#]+)"/g)) {
    const name = decodeURIComponent(m[1]).replace(/_/g, " ");
    if (!found.includes(name)) found.push(name);
  }
  return found;
}

/**
 * Crawl each category index, diff it against the catalog, and classify what does not match.
 *
 * Deliberately its own phase behind `--discover`: the unmatched set is ~190 pages (109 of the 147
 * weapon-category members are variants and skins the catalog does not model, and the trait indexes
 * add ~32 more unmatched pages), and a stats run should not quietly triple its request count.
 *
 * A catalog category maps to a LIST of wiki indexes. Members are unioned across them and
 * de-duplicated by page path before any arithmetic — see CATEGORY_INDEX for why traits need three.
 */
export async function runDiscovery(options, deps) {
  const { categories = CATEGORIES, delayMs = DEFAULT_DELAY_MS, dryRun = false } = options;
  const { fetchFn, userAgent = USER_AGENT, log = logStructured, robotsGroups, rateLimiter } = deps;

  const limiter = rateLimiter ?? new RateLimiter(delayMs);
  const report = {};

  for (const category of categories) {
    const indexPages = CATEGORY_INDEX[category];
    if (!indexPages || indexPages.length === 0) continue;

    const indexUrls = indexPages.map((page) => ({ page, url: buildItemPageUrl(page) }));

    // The index fetches are the FIRST requests this phase makes, and they were the one request that
    // went out without asking. Every other path here and in scrapeItemStats consults robots first,
    // and runStatsScrape fails closed when robots.txt cannot even be read — an un-consented request
    // to establish the crawl is the one place that posture cannot afford an exception. Every index in
    // the list is checked, not just the first, or adding one would reintroduce the exception.
    // (Review of #186; extended for #231.)
    for (const { page, url } of indexUrls) {
      if (!isAllowedByRobots(robotsGroups, userAgent, new URL(url).pathname)) {
        throw new RobotsDisallowedError(`robots.txt disallows ${page}`, { url });
      }
    }

    // `--dry-run` promises "resolve URLs and check robots.txt, but fetch nothing". Discovery is the
    // most expensive phase in the script (~160 live requests), so ignoring the flag here meant the
    // one mode chosen to avoid requests made the most of them. Report what would be crawled.
    if (dryRun) {
      report[category] = {
        indexPages,
        indexUrls: indexUrls.map((i) => i.url),
        dryRun: true,
        wikiMembers: null,
        catalogRows: collectCatalogItems([category]).length,
        matched: null,
        unmatched: [],
        missing: [],
        unpurchasable: [],
        unresolved: [],
        tombstones: [],
        failures: [],
      };
      for (const { url } of indexUrls) log({ level: "info", event: "discovery-dry-run", category, indexUrl: url });
      continue;
    }

    // De-duplicated by page path BEFORE any coverage arithmetic, because a page can be enumerated by
    // more than one index — six traits are members of both the Scarce and the Event index. `matched`
    // below is `members.length - unmatched.length`, so a page counted twice would inflate the member
    // total and silently inflate `matched` with it, which is the opposite of what this table is for.
    // Insertion order is preserved so a run's output stays stable across runs.
    // Governing: SPEC-0007 REQ "Roster Coverage Is Reported Against the Wiki's Own Categories"
    // One normalisation, used for the de-duplication key, the `listedIn` lookup, and the catalog
    // target map below. Three callers needing the same key is exactly where two copies drift, and a
    // drift here is silent: members would de-duplicate under one rule and be looked up under another.
    const norm = (p) => String(p).replace(/_/g, " ").trim().toLowerCase();

    const members = [];
    const seenMembers = new Set();
    const memberIndexes = new Map();
    for (const { page, url } of indexUrls) {
      await limiter.wait();
      // eslint-disable-next-line no-await-in-loop
      const res = await fetchFn(url, { headers: { "User-Agent": userAgent } });
      if (!res.ok) {
        throw new NetworkFailureError(`failed to fetch ${page}: HTTP ${res.status} at ${url}`, { url });
      }
      // eslint-disable-next-line no-await-in-loop
      const listed = parseCategoryMembers(await res.text());
      for (const member of listed) {
        const key = norm(member);
        // Which indexes listed a page is recorded rather than discarded: it is the difference between
        // "this trait is Scarce" and "this trait was found while crawling Scarce", and only the
        // per-page category read decides the former.
        if (!memberIndexes.has(key)) memberIndexes.set(key, []);
        memberIndexes.get(key).push(page);
        if (seenMembers.has(key)) continue;
        seenMembers.add(key);
        members.push(member);
      }
      log({ level: "info", event: "discovery-index", category, indexPage: page, listed: listed.length });
    }

    // The catalog's own targets, normalised the same way the member list is.
    const catalogTargets = new Map(
      collectCatalogItems([category])
        .filter((item) => item.wikiPath)
        .map((item) => [norm(item.wikiPath), item])
    );

    const unmatched = [];
    for (const page of members) {
      if (catalogTargets.has(norm(page))) continue;

      let classification = { state: "live", reason: "not fetched", evidence: null };
      if (KNOWN_TOMBSTONES[page.replace(/ /g, "_")] || KNOWN_TOMBSTONES[page]) {
        classification = classifyPage("", { page: page.replace(/ /g, "_") });
      } else {
        const url = buildItemPageUrl(page);
        if (!isAllowedByRobots(robotsGroups, userAgent, new URL(url).pathname)) {
          // "unreadable" rather than "live": we learned nothing about this page. Calling it live
          // filed it under `missing`, so a wiki with tighter robots rules than today's would report
          // false missing counts with no signal that a fetch was skipped. (Review of #186.)
          classification = { state: "unreadable", reason: "robots.txt disallows fetching it", evidence: null };
        } else {
          await limiter.wait();
          try {
            // eslint-disable-next-line no-await-in-loop
            const pageRes = await fetchFn(url, { headers: { "User-Agent": userAgent } });
            if (pageRes.ok) {
              const html = await pageRes.text();
              classification = classifyPage(html, { page: page.replace(/ /g, "_") });
              // The page is already in hand, so purchasability costs nothing extra — and it is what
              // separates "the catalog is missing this" from "the catalog excludes this on purpose".
              // A Tarot Card is a live page the catalog deliberately lacks; its price is the literal
              // string "Scarce", so the boundary is machine-checkable rather than re-argued.
              //
              // Selected through selectBaseInfobox rather than taking index 0: that helper exists
              // because a page's first infobox is often a variant or skin, and reading a variant's
              // price as the base item's is how a base-page price goes missing on exactly the
              // multi-infobox pages this crawl visits most.
              const boxes = extractInfoboxes(html);
              if (boxes.length > 0) {
                const canonicalTitle = canonicalTitleFromPageName(readRlconf(html, "wgPageName"));
                const selection = selectBaseInfobox(boxes, { canonicalTitle, displayName: page });
                const box = selection.index === -1 ? boxes[0] : boxes[selection.index];
                Object.assign(
                  classification,
                  acquisitionOf(parseInfoboxFields(box), { categories: parsePageCategories(html) }),
                  { infoboxMethod: selection.method }
                );
              }
            } else {
              classification = { state: "unreadable", reason: `HTTP ${pageRes.status}`, evidence: null };
            }
          } catch (err) {
            // Per-page, matching runStatsScrape's own posture: one page's transport failure must not
            // end a ~160-page crawl the way an uncaught throw here did.
            classification = { state: "unreadable", reason: err.message, evidence: null };
          }
        }
      }
      const listedIn = memberIndexes.get(norm(page)) ?? [];
      unmatched.push({ page, listedIn, ...classification });
      log({
        level: classification.state === "unreadable" ? "warn" : "info",
        event: "discovery-unmatched",
        category,
        page,
        listedIn,
        state: classification.state,
        ...(classification.reason ? { reason: classification.reason } : {}),
        // Parsed twenty lines up and then dropped here, which meant a completed run's own log could
        // not answer "which of the missing traits are Burn" or "which pages are Scarce" — the report
        // object held it, the durable record did not, and the first live run had to be reconstructed
        // from the raw JSON by hand. `purchasable` is absent (not null) when no infobox was read at
        // all, so a missing key and a three-valued `null` stay distinguishable.
        ...(classification.purchasable === undefined
          ? {}
          : {
              acquisition: classification.acquisition,
              acquisitionClasses: classification.acquisitionClasses,
              priceStated: classification.priceStated,
              purchasable: classification.purchasable,
            }),
      });
    }

    const live = unmatched.filter((u) => u.state === "live");
    report[category] = {
      indexPages,
      // Both counted from the de-duplicated set. A page listed by two indexes is one member and one
      // catalog gap, not two of either.
      wikiMembers: members.length,
      catalogRows: collectCatalogItems([category]).length,
      matched: members.length - unmatched.length,
      unmatched,
      // Five buckets, not three. `missing` now requires a POSITIVE purchasability signal, so a page
      // whose price could not be read lands in `unresolved` rather than being proposed as a catalog
      // gap — and a page that could not be read at all lands in `failures` rather than either.
      missing: live.filter((u) => u.purchasable === true),
      unpurchasable: live.filter((u) => u.purchasable === false),
      unresolved: live.filter((u) => u.purchasable == null),
      tombstones: unmatched.filter((u) => u.state === "removed" || u.state === "never-shipped"),
      failures: unmatched.filter((u) => u.state === "unreadable"),
    };
    log({
      level: "info",
      event: "discovery-category",
      category,
      wikiMembers: report[category].wikiMembers,
      catalogRows: report[category].catalogRows,
      missing: report[category].missing.length,
      unpurchasable: report[category].unpurchasable.length,
      unresolved: report[category].unresolved.length,
      tombstones: report[category].tombstones.length,
      failures: report[category].failures.length,
    });
  }

  return report;
}

/**
 * The coverage table SPEC-0007 asks for.
 *
 * "Page exists but the item does not" and "item missing from the catalog" are reported as separate
 * columns on purpose: the audit's trait delta of 26 was read as 26 missing traits, and at least one
 * of them — Iron Repeater — is a tombstone sitting in the Regular trait index. A single "delta"
 * number invites that reading; two columns do not.
 *
 * The indexes behind a multi-index category are printed above its row for the same reason. A member
 * count is not checkable without knowing what was enumerated to produce it, and the failure #231
 * fixed was precisely a total that looked complete because nobody could see its frame.
 */
/**
 * The rarity set, printed only when the page declared one.
 *
 * An empty array is printed as nothing rather than "[]": no rarity category means the page is not a
 * trait, which is true of every weapon, tool and consumable, and a bracket on all ~105 of those
 * lines would read as a finding.
 */
function classSuffix(u) {
  return u?.acquisitionClasses?.length ? `, classes ${u.acquisitionClasses.join("+")}` : "";
}

export function formatCoverage(report) {
  const lines = ["coverage against the wiki's own category indexes:"];
  for (const [category, r] of Object.entries(report)) {
    if (r.dryRun) {
      for (const url of r.indexUrls ?? []) lines.push(`  ${category.padEnd(12)} dry-run — would crawl ${url}`);
      continue;
    }
    // Which indexes produced the number, printed when there is more than one. A member count for
    // `traits` is not checkable without knowing whether it came from one index or three, and the whole
    // point of #231 is that a single-index total looked complete while being a third of the roster.
    if ((r.indexPages ?? []).length > 1) {
      lines.push(`  ${category.padEnd(12)} indexes: ${r.indexPages.join(", ")} (members de-duplicated)`);
    }
    lines.push(
      `  ${category.padEnd(12)} wiki ${String(r.wikiMembers).padStart(3)}  catalog ${String(r.catalogRows).padStart(3)}` +
        `  matched ${String(r.matched).padStart(3)}  missing ${String(r.missing.length).padStart(3)}` +
        `  unpurchasable ${String((r.unpurchasable ?? []).length).padStart(3)}` +
        `  unresolved ${String((r.unresolved ?? []).length).padStart(3)}` +
        `  not-an-item ${String(r.tombstones.length).padStart(3)}` +
        `  unreadable ${String((r.failures ?? []).length).padStart(3)}`
    );
    // `missing` is the only bucket that names real work, and it was the only one with no detail
    // line: the table said 18 traits and 105 weapons, and the names lived nowhere but the raw JSON
    // log. Verbose by design — 105 weapon lines, most of them variant sub-pages — because a count
    // that cannot be read back item by item is the coverage claim this table exists to refuse.
    for (const u of r.missing ?? []) {
      lines.push(`      missing       ${u.page} — price ${JSON.stringify(u.priceStated ?? null)}${classSuffix(u)}`);
    }
    for (const u of r.unpurchasable ?? []) {
      lines.push(`      unpurchasable ${u.page} — price stated as ${JSON.stringify(u.priceStated)}${classSuffix(u)}`);
    }
    // Reported, not silently folded into `missing`: "no price field was found" is not a finding
    // about the item, it is a finding about the parse, and the two must not read the same.
    //
    // The class suffix matters most here. A Scarce TRAIT states no cost at all — no `Price`, no
    // `Cost` row — so it lands in this bucket looking identical to a parse failure, while a Scarce
    // WEAPON writes the literal string "Scarce" and lands in `unpurchasable`. Printing the classes
    // is what separates "the wiki says this cannot be bought" from "this parser found nothing".
    for (const u of r.unresolved ?? []) {
      lines.push(
        `      unresolved    ${u.page} — no Price or Cost field found; purchasability unknown${classSuffix(u)}`
      );
    }
    // The excerpt is why the verdict is checkable. `classifyPage` collects it precisely so a summary
    // can be audited without re-fetching, and printing only the generic reason threw that away —
    // which matters most here, because the classification is whole-page regex over content that
    // includes update-history and trivia, so a live item whose VARIANT was removed can match.
    for (const t of r.tombstones) {
      lines.push(`      ${t.state.padEnd(13)} ${t.page} — ${t.reason}`);
      if (t.evidence) lines.push(`                      evidence: ${t.evidence}`);
    }
    for (const f of r.failures ?? []) {
      lines.push(`      unreadable    ${f.page} — ${f.reason}`);
    }
  }
  return lines.join("\n");
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
  const renames = [];

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
        ...(result.renamed ? { renamedFrom: result.renamed.from, renamedTo: result.renamed.to } : {}),
      });
      if (result.renamed) renames.push({ id: target.id, ...result.renamed, url: result.url });
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
    ...(renames.length ? { renameCandidates: renames.length } : {}),
    ...(catalogSkipped ? { catalogSkipped } : {}),
  });

  summary.records = records;
  summary.renames = renames;
  summary.datasetPath = written;
  summary.droppedIds = dropped;
  summary.catalogPlan = catalogPlan;
  summary.catalogWritten = catalogWritten;
  summary.catalogSkipped = catalogSkipped;
  // Handed back so a --discover phase can reuse both rather than re-fetching robots.txt and
  // starting a second, independent rate limiter that knows nothing about the requests just made.
  summary.robotsGroups = robotsGroups;
  summary.rateLimiter = rateLimiter;
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
    discover: false,
  };
  for (const arg of argv) {
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--allow-shrink") options.allowShrink = true;
    else if (arg === "--write-catalog") options.writeCatalog = true;
    else if (arg === "--discover") options.discover = true;
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

  if (options.discover) {
    if (options.dryRun) {
      console.log("scrape-stats: --discover under --dry-run — resolving index URLs, fetching none.");
    } else {
      console.log("scrape-stats: --discover — crawling category indexes. Unmatched pages are fetched to");
      console.log("              classify them, so this makes materially more requests than a stats run.");
    }
    // robots.txt and the rate limiter come from the run that just finished rather than being
    // re-established: a second fetch of robots.txt is a request we already made, and a second
    // limiter would let discovery burst against a site the stats phase was just pacing itself for.
    const report = await runDiscovery(options, {
      fetchFn: fetch,
      robotsGroups: summary.robotsGroups,
      rateLimiter: summary.rateLimiter,
    });
    console.log(formatCoverage(report));
    summary.discovery = report;
  }

  if (summary.renames?.length) {
    console.log(`rename candidates: ${summary.renames.length} item(s) whose page title differs from the catalog`);
    for (const r of summary.renames) console.log(`  ${r.id}: "${r.from}" -> "${r.to}"   ${r.url}`);
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
