// Governing: ADR-0005 (Scrape Item Stats and Descriptions into a Generated Data File — "two scripts,
// one shared wiki client"), ADR-0007 (Hunter Roster Dataset — extends ADR-0005 and consumes this same
// module), ADR-0002 (Source Weapon/Equipment Images from huntshowdown.wiki.gg via a One-Time,
// Self-Hosted Scrape)
// Implements: SPEC-0001 REQ "Ethical, Self-Hosted Image Sourcing", SPEC-0001 REQ "Error Handling
// Standards". This module is payload-agnostic — those requirements bind every consumer of it, not
// just the image scrape.
//
// scripts/lib/wiki.mjs
//
// The shared wiki client. Every piece in this file is something more than one scrape script needs and
// that must not diverge between them: slug derivation, robots.txt fetching and evaluation, the rate
// limiter, the user agent, the sentinel error classes, and the catalog -> scrape-target resolution.
//
// ADR-0005 calls this extraction "a prerequisite, not a follow-up" for exactly one reason: slugify()
// is a hard contract with the on-disk image path (client/public/images/{category}/{slug}.{ext}) and
// with ItemThumb's URL derivation. Two copies drift, and the failure mode is images silently not
// resolving. The same argument covers robots handling and the rate limiter, where a second copy would
// mean a second script quietly scraping on terms the first one honors.
//
// This module is import-only — it has no CLI entrypoint and performs no I/O on import. Consumers
// today: scripts/scrape-images.mjs (ADR-0002), scripts/scrape-hunters.mjs (ADR-0007), and
// scripts/scrape-stats.mjs (ADR-0005, SPEC-0007).
//
// Note on USER_AGENT: it previously described itself as an image scrape and carried a note to
// generalize it once a second consumer landed. Two have. The string is now payload-neutral,
// because the wiki sees it on every request any of the three scripts makes and a UA that
// misdescribes the run is worse than a generic one.
//
// Note for future work: ADR-0005's out-of-scope section anticipates a revision-history-driven
// refresh built on MediaWiki's API rather than HTML page fetches. Nothing here assumes HTML scraping
// is the only access mode — the robots, rate-limit, and user-agent pieces apply to either.

import { WEAPONS, TOOLS, TRAITS, CONS } from "../../client/src/data/catalog.js";

export const WIKI_ORIGIN = "https://huntshowdown.wiki.gg";
export const DEFAULT_DELAY_MS = 1500;
export const USER_AGENT =
  "BackwaterOutfittersScrapeBot/1.0 (+https://github.com/jonstump/the-outfitter; contact: jmstump@gmail.com; " +
  "offline, human-invoked catalog scrape per ADR-0002 and ADR-0005, not a crawler)";

// ---------------------------------------------------------------------------
// Sentinel errors (SPEC-0001 "Error Handling Standards": domain-specific failure modes the
// scrape scripts need to distinguish programmatically, e.g. "item page not found" vs. "image
// asset not found on an existing page" vs. "network/rate-limit failure").
// ---------------------------------------------------------------------------

export class ScrapeError extends Error {
  constructor(message, { cause, item, url } = {}) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = this.constructor.name;
    this.item = item;
    this.url = url;
  }
}

/** The catalog item's wiki page could not be located (e.g. HTTP 404). */
export class ItemPageNotFoundError extends ScrapeError {}

/** The item's wiki page loaded, but no usable image asset could be located on it. */
export class ImageAssetNotFoundError extends ScrapeError {}

/**
 * The item's wiki page loaded, but carries no infobox to read stats from.
 *
 * Distinct from ItemPageNotFoundError (no page at all) and from InfoboxFieldNotFoundError (an
 * infobox exists but lacks the field asked for). SPEC-0007 REQ "Error Handling Standards" requires
 * these three to stay distinguishable: a page with no infobox is usually a disambiguation or
 * category page that resolution landed on by mistake, while a missing field is a real gap in the
 * wiki's data for an item that is otherwise fine. Collapsing them hides which one happened.
 */
export class InfoboxNotFoundError extends ScrapeError {}

/** An infobox was located, but it carries no field under the requested name. */
export class InfoboxFieldNotFoundError extends ScrapeError {
  constructor(message, options = {}) {
    super(message, options);
    this.field = options.field;
  }
}

/** A network, HTTP, or rate-limit failure occurred while talking to the wiki. */
export class NetworkFailureError extends ScrapeError {}

/** robots.txt disallows fetching the resource this script needed. */
export class RobotsDisallowedError extends ScrapeError {}

// ---------------------------------------------------------------------------
// Slugification — the {slug} half of the shared asset-path contract:
// client/public/images/{category}/{slug}.{ext}, keyed by catalog item name (e.g.
// "Nagant M1895" -> "nagant-m1895").
//
// IMPORTED, NOT DEFINED HERE. ADR-0005 requires one definition, and it was previously read as
// "one definition under scripts/" — which the confirmation criterion literally says. That left
// the reader end of the same contract, client/src/components/ItemThumb/ItemThumb.jsx, carrying
// a second copy that had already drifted: it neither stripped diacritics nor dropped
// apostrophes. A scrape writing hunters-respite.png against a client requesting
// hunter-s-respite.png loses the art with no error anywhere (issue #119).
//
// The canonical definition therefore lives on the client side, which both ends can reach:
// scripts/ may import from client/src/, but the client must never import from scripts/.
// ---------------------------------------------------------------------------

// Imported AND re-exported: this module uses it internally (collectCatalogItems), and every
// existing consumer imports it from here rather than reaching past the wiki client.
import { slugify } from "../../client/src/utils/slugify.js";

export { slugify };

// ---------------------------------------------------------------------------
// Catalog -> scrape target list. Deliberately narrow: only the four categories and the specific
// items the catalog defines, never a wholesale wiki mirror.
// ---------------------------------------------------------------------------

export const CATEGORY_SOURCES = {
  weapons: WEAPONS,
  tools: TOOLS,
  traits: TRAITS,
  consumables: CONS,
};

export const CATEGORIES = Object.keys(CATEGORY_SOURCES);

/** Catalog category -> the wiki's own top-level namespace segment for that category. */
export const WIKI_CATEGORY = {
  weapons: "Weapons",
  tools: "Tools",
  traits: "Traits",
  consumables: "Consumables",
};

// ---------------------------------------------------------------------------
// Catalog id -> wiki page path.
//
// The wiki namespaces every item page under its category ("/wiki/Weapons/Nagant_M1895", not
// "/wiki/Nagant_M1895"), so the default resolution is `${WIKI_CATEGORY[category]}/${title}`,
// derived from the item's display name.
//
// Two things break that default and need the override table below:
//
//   1. Weapon *variants* live on subpages ("Sparks/Pistol", "Mosin-Nagant/Avtomat",
//      "Officer/Carbine"), which a flat display name can't express. Note the wiki flattens
//      compound variants into ONE segment — "Sparks/Pistol_Silencer", never
//      "Sparks/Pistol/Silencer" — so a path is at most three segments deep.
//   2. A few catalog items sit under a different wiki category than the catalog's own — the
//      Katana is a Tool here but a Weapon on the wiki.
//
// THREE, until #232. Hunt's Update 2.0 ("1896") renamed most branded weapons, and the catalog kept
// the pre-rename display names ("Sparks LRR", "Caldwell Pax") while the wiki moved on ("Sparks",
// "Pax") — so an override supplied the difference for seventeen items. #232 brought the names
// current, which makes the default correct for all of them, and those entries are gone. Recorded
// rather than deleted because "the catalog's names may be stale" is the assumption a reader would
// otherwise carry into this table, and it is no longer true: a rename now shows up as a rename
// candidate in the scrape's own report, not as a silent mismatch this table has to absorb.
//
// Values are paths relative to /wiki/ and INCLUDE the category segment, precisely so a cross-
// category item can be expressed. A `null` value means "deliberately has no wiki page" — see
// KNOWN_CATALOG_DUPLICATES below; those items are skipped without spending a request.
//
// KEYED BY CATALOG `id`, NOT BY DISPLAY NAME. This matters, and it is not stylistic:
// ADR-0005 makes the wiki authoritative for display names and has scrape-stats.mjs write
// renames back into catalog.js, while guaranteeing that `id` is never rewritten. A
// name-keyed table silently stops matching the first time that write-through runs — and the
// failure is invisible, because resolution then falls back to `Weapons/{new name}`, which is
// *usually* right for a plain rename and wrong exactly where it matters. "Nagant Officer
// Carbine" -> "Officer Carbine" would fall back to "Weapons/Officer_Carbine"; the real page is
// "Weapons/Officer/Carbine". Keying on the one field the ADR promises never changes makes the
// table survive its own success.
//
// Verified against the wiki's own sitemap (sitemap-huntshowdown_en-NS_0), not by probing URLs one
// at a time. When a DLC ships or the catalog changes, re-verify the same way: pull the sitemap
// index at /sitemaps/sitemap-index-huntshowdown_en.xml, expand the NS_0 gzip, and diff the
// resolved paths against it — two requests instead of one per item. Note the sitemap lags live
// edits by months, so treat "absent from the sitemap" as "check this one by hand", not "gone".
// For discovering pages the catalog does not yet have (every variant, and a dozen-odd base
// weapons), /wiki/Category:Weapons is the authority, not the sitemap — see
// docs/audits/weapon-catalog-wiki-audit.md.
// ---------------------------------------------------------------------------

// SEVENTEEN ENTRIES REMOVED 2026-08-12 (#232), and the reason is worth reading before adding one
// back. Most of this table existed to compensate for stale display names: the catalog said "Caldwell
// Pax" while the wiki page was "Weapons/Pax", so an override supplied the difference. #232 brought
// the names current, which makes the DEFAULT path correct for all of them — an override that merely
// restates the default is dead weight that also cannot be told apart from a live mapping.
//
// What remains is only what the default genuinely cannot produce, and each is a different reason:
// three variant SUB-PAGES (the default joins with `_`, the wiki nests with `/`) and one deliberate
// null. The cross-namespace entry that used to sit alongside them — the Katana — went away with
// #156, which fixed the classification the override had been papering over. `resolveWikiPathIsNeeded`
// in the tests asserts every entry still differs from its default, so the table cannot silently
// regrow redundant rows the next time names move.
export const WIKI_TITLE_OVERRIDES = {
  weapons: {
    // Variant sub-pages. The default would join the name with an underscore
    // ("Weapons/Mosin-Nagant_Avtomat"); the wiki nests the variant under its base weapon.
    "mosin-nagant-avtomat": "Weapons/Mosin-Nagant/Avtomat",
    "nagant-officer-carbine": "Weapons/Officer/Carbine",
    "sparks-pistol": "Weapons/Sparks/Pistol",
    // Variant subpages appended by #254 — resolveWikiPath builds `Weapons/{DisplayName}`,
    // and every one of these lives two segments deep (`Weapons/{Family}/{Variant}`). Compound
    // variants collapse into ONE segment (`Centennial/Shorty_Silencer`, `Officer/Carbine_Deadeye`),
    // which is why these are recorded rather than derived from the display name.
    "1865-carbine-aperture": "Weapons/1865_Carbine/Aperture",
    "1865-carbine-silencer": "Weapons/1865_Carbine/Silencer",
    "berthier-1892-deadeye": "Weapons/Berthier_1892/Deadeye",
    "berthier-1892-marksman": "Weapons/Berthier_1892/Marksman",
    "berthier-1892-riposte": "Weapons/Berthier_1892/Riposte",
    "bornheim-no-3-extended": "Weapons/Bornheim_No._3/Extended",
    "bornheim-no-3-match": "Weapons/Bornheim_No._3/Match",
    "bornheim-no-3-silencer": "Weapons/Bornheim_No._3/Silencer",
    "centennial-pointman": "Weapons/Centennial/Pointman",
    "centennial-shorty": "Weapons/Centennial/Shorty",
    "centennial-shorty-silencer": "Weapons/Centennial/Shorty_Silencer",
    "centennial-sniper": "Weapons/Centennial/Sniper",
    "centennial-trauma": "Weapons/Centennial/Trauma",
    "conversion-chain-pistol": "Weapons/Conversion/Chain_Pistol",
    "crossbow-deadeye": "Weapons/Crossbow/Deadeye",
    "dolch-96-bullseye": "Weapons/Dolch_96/Bullseye",
    "dolch-96-claw": "Weapons/Dolch_96/Claw",
    "dolch-96-precision": "Weapons/Dolch_96/Precision",
    "drilling-hatchet": "Weapons/Drilling/Hatchet",
    "drilling-shorty": "Weapons/Drilling/Shorty",
    "frontier-73c-marksman": "Weapons/Frontier_73C/Marksman",
    "frontier-73c-silencer": "Weapons/Frontier_73C/Silencer",
    "infantry-73l-bayonet": "Weapons/Infantry_73L/Bayonet",
    "infantry-73l-sniper": "Weapons/Infantry_73L/Sniper",
    "krag-bayonet": "Weapons/Krag/Bayonet",
    "krag-silencer": "Weapons/Krag/Silencer",
    "krag-sniper": "Weapons/Krag/Sniper",
    "lebel-1886-aperture": "Weapons/Lebel_1886/Aperture",
    "lebel-1886-marksman": "Weapons/Lebel_1886/Marksman",
    "lebel-1886-talon": "Weapons/Lebel_1886/Talon",
    "lemat-carbine": "Weapons/LeMat/Carbine",
    "lemat-carbine-marksman": "Weapons/LeMat/Carbine_Marksman",
    "mako-1895-aperture": "Weapons/Mako_1895/Aperture",
    "mako-1895-claw": "Weapons/Mako_1895/Claw",
    "marathon-swift": "Weapons/Marathon/Swift",
    "martini-henry-deadeye": "Weapons/Martini-Henry/Deadeye",
    "martini-henry-ironside": "Weapons/Martini-Henry/Ironside",
    "martini-henry-marksman": "Weapons/Martini-Henry/Marksman",
    "martini-henry-riposte": "Weapons/Martini-Henry/Riposte",
    "maynard-sniper-silencer": "Weapons/Maynard_Sniper/Silencer",
    "mosin-obrez-extended": "Weapons/Mosin_Obrez/Extended",
    "mosin-obrez-mace": "Weapons/Mosin_Obrez/Mace",
    "mosin-obrez-match": "Weapons/Mosin_Obrez/Match",
    "mosin-obrez-sharpeye": "Weapons/Mosin_Obrez/Sharpeye",
    "mosin-nagant-bayonet": "Weapons/Mosin-Nagant/Bayonet",
    "mosin-nagant-sniper": "Weapons/Mosin-Nagant/Sniper",
    "nagant-m1895-deadeye": "Weapons/Nagant_M1895/Deadeye",
    "nagant-m1895-precision": "Weapons/Nagant_M1895/Precision",
    "nagant-m1895-silencer": "Weapons/Nagant_M1895/Silencer",
    "new-army-swift": "Weapons/New_Army/Swift",
    "officer-brawler": "Weapons/Officer/Brawler",
    "officer-carbine-deadeye": "Weapons/Officer/Carbine_Deadeye",
    "pax-claw": "Weapons/Pax/Claw",
    "pax-trueshot": "Weapons/Pax/Trueshot",
    "ranger-73-aperture": "Weapons/Ranger_73/Aperture",
    "ranger-73-swift": "Weapons/Ranger_73/Swift",
    "ranger-73-talon": "Weapons/Ranger_73/Talon",
    "rival-78-mace": "Weapons/Rival_78/Mace",
    "rival-78-shorty": "Weapons/Rival_78/Shorty",
    "rival-78-trauma": "Weapons/Rival_78/Trauma",
    "romero-77-alamo": "Weapons/Romero_77/Alamo",
    "romero-77-hatchet": "Weapons/Romero_77/Hatchet",
    "romero-77-shorty": "Weapons/Romero_77/Shorty",
    "romero-77-talon": "Weapons/Romero_77/Talon",
    "scottfield-brawler": "Weapons/Scottfield/Brawler",
    "scottfield-precision": "Weapons/Scottfield/Precision",
    "scottfield-spitfire": "Weapons/Scottfield/Spitfire",
    "scottfield-swift": "Weapons/Scottfield/Swift",
    "slate-riposte": "Weapons/Slate/Riposte",
    "sparks-pistol-silencer": "Weapons/Sparks/Pistol_Silencer",
    "sparks-silencer": "Weapons/Sparks/Silencer",
    "sparks-sniper": "Weapons/Sparks/Sniper",
    "specter-1882-bayonet": "Weapons/Specter_1882/Bayonet",
    "specter-1882-shorty": "Weapons/Specter_1882/Shorty",
    "springfield-1866-bayonet": "Weapons/Springfield_1866/Bayonet",
    "springfield-1866-bullseye": "Weapons/Springfield_1866/Bullseye",
    "springfield-1866-marksman": "Weapons/Springfield_1866/Marksman",
    "springfield-1866-shorty": "Weapons/Springfield_1866/Shorty",
    "springfield-1866-striker": "Weapons/Springfield_1866/Striker",
    "terminus-shorty": "Weapons/Terminus/Shorty",
    "uppercut-deadeye": "Weapons/Uppercut/Deadeye",
    "uppercut-precision": "Weapons/Uppercut/Precision",
    "vandal-73c-bullseye": "Weapons/Vandal_73C/Bullseye",
    "vandal-73c-striker": "Weapons/Vandal_73C/Striker",
    "vetterli-71-bayonet": "Weapons/Vetterli_71/Bayonet",
    "vetterli-71-cyclone": "Weapons/Vetterli_71/Cyclone",
    "vetterli-71-deadeye": "Weapons/Vetterli_71/Deadeye",
    "vetterli-71-marksman": "Weapons/Vetterli_71/Marksman",
    "vetterli-71-silencer": "Weapons/Vetterli_71/Silencer",
  },
  tools: {
    // Empty, and it emptied from both ends within a day. #232 removed the three trip-mine entries:
    // the wiki pluralizes those pages and the catalog said the singular, so an override supplied the
    // difference until the names were brought current and the default produced the same path.
    //
    // #156 removed the last one, `katana: "Weapons/Katana"`, by moving the row into WEAPONS where the
    // default resolves to that same path. Worth recording why it was there: it made the scrape work
    // while leaving the classification wrong, so every run reported success against a page that
    // disagreed with the catalog about what kind of item this is. An override that silences a
    // mismatch can hide one — the mismatch is the signal.
  },
  traits: {},
  consumables: {},
};

/**
 * Catalog entries that have no wiki page of their own because they duplicate another entry.
 * These are skipped deliberately (no request spent, not counted as failures) and reported in the
 * run summary so the duplication stays visible rather than looking like a scrape bug.
 *
 * Keyed by catalog id, for the same reason WIKI_TITLE_OVERRIDES is.
 *
 * EMPTY as of #243, which retired the last entry — and the paragraph that used to sit here was wrong
 * in a way worth recording, because it invited exactly the mistake it was warning about.
 *
 * It said deleting a duplicate row "is now safe to do: loadoutCodec.js pins the pre-versioning
 * catalog order in its own frozen table (issue #68), so a mid-array delete no longer shifts what a
 * legacy record resolves to." The first half is right and the conclusion did not follow. A delete no
 * longer SHIFTS anything — the frozen table still maps index 16 to the id `winfield-m1873c` — but
 * `fromLegacy` then resolves that id against the LIVE catalog, and with the row gone it resolved to
 * nothing. Deleting on the strength of this note would have dropped the weapon from the oldest
 * records in the wild rather than landing it on `frontier-73c`, the identical gun.
 *
 * So the real remedy is an ALIAS, not a delete: see RETIRED_WEAPON_ALIASES in loadoutCodec.js, which
 * both decoders route through. A duplicate added here in future is still a stopgap — the row shows in
 * the picker with a fallback thumb — but retiring it means giving the old id somewhere to land first.
 * "Choke Bomb" was the first entry retired (issue #67), before the frozen tables existed.
 */
export const KNOWN_CATALOG_DUPLICATES = {};

/**
 * Resolve a catalog item to its wiki page path (relative to /wiki/, category segment included),
 * or null when the item is a known duplicate with no page of its own.
 *
 * `id` selects the override; `name` only feeds the default namespaced path. Passing an id with
 * no override (or no id at all) falls back to the display name, which is correct for the
 * majority of the catalog.
 */
export function resolveWikiPath(category, id, name) {
  const overrides = WIKI_TITLE_OVERRIDES[category];
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, id)) {
    return overrides[id];
  }
  const namespace = WIKI_CATEGORY[category];
  if (!namespace) return null;
  return `${namespace}/${name.trim().replace(/\s+/g, "_")}`;
}

export function collectCatalogItems(categories = CATEGORIES) {
  const items = [];
  for (const category of categories) {
    const rows = CATEGORY_SOURCES[category];
    if (!rows) continue;
    for (const row of rows) {
      // Catalog tuples are id-first ([id, name, ...]) since the stable-id refactor. The id
      // selects any wiki-path override; the display name (row[1]) drives the default path and
      // the on-disk image slug.
      const id = row[0];
      const name = row[1];
      items.push({
        category,
        id,
        name,
        slug: slugify(name),
        wikiPath: resolveWikiPath(category, id, name),
      });
    }
  }
  return items;
}

/**
 * Build the wiki URL for a page path produced by resolveWikiPath (e.g. "Weapons/Sparks/Pistol").
 *
 * Each path segment is encoded independently: encodeURIComponent over the whole path would turn
 * the namespace and variant separators into %2F and 404 every namespaced page.
 */
export function buildItemPageUrl(wikiPath) {
  const encoded = wikiPath
    .split("/")
    .map((segment) => encodeURIComponent(segment.trim().replace(/\s+/g, "_")))
    .join("/");
  return `${WIKI_ORIGIN}/wiki/${encoded}`;
}

// ---------------------------------------------------------------------------
// robots.txt: fetch, parse, and enforce.
// ---------------------------------------------------------------------------

/** Parse robots.txt text into an array of { userAgents: string[], rules: [{type, path}] } groups. */
export function parseRobotsTxt(text) {
  const groups = [];
  let current = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split("#")[0].trim();
    if (!line) continue;
    const sepIdx = line.indexOf(":");
    if (sepIdx === -1) continue;
    const key = line.slice(0, sepIdx).trim().toLowerCase();
    const value = line.slice(sepIdx + 1).trim();

    if (key === "user-agent") {
      if (current && current.rules.length === 0) {
        current.userAgents.push(value);
      } else {
        current = { userAgents: [value], rules: [] };
        groups.push(current);
      }
    } else if ((key === "allow" || key === "disallow") && current) {
      current.rules.push({ type: key, path: value });
    }
  }
  return groups;
}

/**
 * Collect the rules that apply to `userAgent`, merging EVERY matching group rather than taking
 * the first.
 *
 * The strict reading of the standard is "one group wins", but real files routinely split the same
 * agent across several blocks — huntshowdown.wiki.gg publishes a Cloudflare-managed `User-agent: *`
 * block containing only `Allow: /`, followed by wiki.gg's own `User-agent: *` block with ~99
 * Disallow rules. Taking the first match would silently discard the second block and let us fetch
 * paths the site explicitly disallows (e.g. /wiki/File:, /wiki/Special:). Merging fails closed.
 */
function selectRobotsRules(groups, userAgent) {
  const uaLower = userAgent.toLowerCase();
  const specific = groups.filter((g) => g.userAgents.some((a) => a !== "*" && uaLower.includes(a.toLowerCase())));
  const matched = specific.length > 0 ? specific : groups.filter((g) => g.userAgents.includes("*"));
  return matched.flatMap((g) => g.rules);
}

/** Longest-matching-prefix rule, ties broken in favor of Allow (standard robots.txt semantics). */
export function isAllowedByRobots(groups, userAgent, pathToCheck) {
  const rules = selectRobotsRules(groups, userAgent);
  if (rules.length === 0) return true;

  let winner = null;
  for (const rule of rules) {
    if (rule.path === "") continue; // "Disallow:" with no path means "allow everything"
    if (pathToCheck.startsWith(rule.path)) {
      if (
        !winner ||
        rule.path.length > winner.length ||
        (rule.path.length === winner.length && rule.type === "allow")
      ) {
        winner = { type: rule.type, length: rule.path.length };
      }
    }
  }
  return !winner || winner.type === "allow";
}

export async function fetchRobotsTxt(fetchFn, userAgent) {
  const url = `${WIKI_ORIGIN}/robots.txt`;
  let res;
  try {
    res = await fetchFn(url, { headers: { "User-Agent": userAgent } });
  } catch (err) {
    throw new NetworkFailureError(`failed to fetch robots.txt at ${url}: ${err.message}`, { cause: err, url });
  }
  if (res.status === 404) {
    // No robots.txt published: nothing to respect, treated as allow-all.
    return [];
  }
  if (!res.ok) {
    throw new NetworkFailureError(`failed to fetch robots.txt at ${url}: HTTP ${res.status}`, { url });
  }
  const text = await res.text();
  return parseRobotsTxt(text);
}

// ---------------------------------------------------------------------------
// Rate limiting: a minimum delay is enforced between any two requests to the wiki.
// ---------------------------------------------------------------------------

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class RateLimiter {
  constructor(minDelayMs, { now = () => Date.now(), sleep = defaultSleep } = {}) {
    this.minDelayMs = minDelayMs;
    this.now = now;
    this.sleep = sleep;
    this.lastRequestAt = null;
  }

  async wait() {
    if (this.lastRequestAt !== null) {
      const elapsed = this.now() - this.lastRequestAt;
      const remaining = this.minDelayMs - elapsed;
      if (remaining > 0) {
        await this.sleep(remaining);
      }
    }
    this.lastRequestAt = this.now();
  }
}

// ---------------------------------------------------------------------------
// Structured logging and the per-run summary.
//
// SPEC-0001 and SPEC-0007 both require structured run reporting rather than string interpolation,
// and a per-run summary of succeeded/failed/skipped with reasons. That is shared reporting
// infrastructure, so it lives here.
//
// NOTE: scrape-images.mjs and scrape-hunters.mjs each still carry their own byte-identical copy of
// logStructured, predating this one. They are not migrated here because doing so is a refactor of
// two working scripts and their suites, which is out of scope for the story that added this. The
// divergence risk is low — unlike slugify() or the robots rules, a drifting log helper has no
// silent failure mode — but it is real duplication and should be collapsed.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// HTML parsing helpers shared by every payload.
//
// Implements: SPEC-0007 REQ "Provenance Is Recorded and Ids Are Never Wiki-Derived" (readRlconf is
// where the recorded revision comes from), SPEC-0007 REQ "Canonical Titles Are Read From the Page"
//
// These moved here from scrape-hunters.mjs when scrape-stats.mjs became the second consumer.
// readRlconf in particular is the "must not diverge" class: it is where the canonical page title
// and the current revision id live, and both scrapes record that revision as provenance. Two
// implementations would mean two definitions of what "the revision I ingested" means.
// ---------------------------------------------------------------------------

const NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
};

/**
 * Decode the HTML entities MediaWiki actually emits.
 *
 * Non-breaking spaces are folded to ordinary ones. The wiki writes `Source: The Revenant&#160;DLC`,
 * and a U+00A0 surviving into a stored string would make it compare unequal to the visually
 * identical text anyone would type when checking or correcting a mapping.
 */
export function decodeEntities(text) {
  return text
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hx) => String.fromCodePoint(parseInt(hx, 16)))
    .replace(/&([a-z]+);/gi, (whole, name) => {
      const key = name.toLowerCase();
      return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, key) ? NAMED_ENTITIES[key] : whole;
    })
    .replace(/ /g, " ");
}

/**
 * Close the gap tag-stripping leaves before punctuation and possessive apostrophes.
 *
 * A prose-to-text pass that turns every tag into a space is right for infobox values — it keeps
 * `<a>Compact</a><img>` from becoming one word — and wrong for prose, where wiki bodies link mid
 * sentence: `restored by <a>First Aid Kit</a>.` reads back as "restored by First Aid Kit ." and
 * `<a>Huff</a>'s hands` as "Huff 's hands". Both fixes are scoped narrowly (trailing punctuation;
 * an apostrophe immediately before an `s`) so a legitimate space before an opening quote is left
 * alone. Shared by the item and hunter scrapes, both of which turn tags into spaces before handing
 * prose to this function — moved here rather than duplicated when the hunter roster scrape (#354)
 * became the second consumer.
 *
 * Also folds U+00B4 ACUTE ACCENT to the apostrophe the rest of the wiki's prose already uses
 * (U+2019). It has no other role in this corpus — every instance found in the hunter roster stood
 * in for an apostrophe a contributor's input method mangled, not a real diacritic — so the swap is
 * unconditional rather than context-sensitive.
 */
export function tidyProse(text) {
  return text
    .replace(/´/g, "’")
    .replace(/\s+([,;:.!?%])/g, "$1")
    .replace(/\s+(['’]s\b)/g, "$1")
    .trim();
}

/**
 * Pull a value out of the page's RLCONF blob.
 *
 * This is where the canonical page title and the current revision id live. Reading them from
 * RLCONF rather than from the URL is what makes redirects (Hunters/Bad_Hand -> Hunters/The_Revenant)
 * resolve to one identity instead of two.
 */
export function readRlconf(html, key) {
  const numeric = html.match(new RegExp(`"${key}"\\s*:\\s*(\\d+)`));
  if (numeric) return Number(numeric[1]);
  const str = html.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
  if (str) return decodeEntities(str[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\"));
  return null;
}

export function logStructured(event, { write = (line) => console.log(line) } = {}) {
  write(JSON.stringify({ ts: new Date().toISOString(), ...event }));
}

export function createSummary() {
  return { succeeded: [], failed: [], skipped: [] };
}

export function recordResult(summary, result) {
  summary[result.status].push(result);
  return summary;
}
