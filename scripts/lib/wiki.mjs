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
  "TheOutfitterScrapeBot/1.0 (+https://github.com/jonstump/the-outfitter; contact: jmstump@gmail.com; " +
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
// Three things break that default and need the override table below:
//
//   1. Hunt's Update 2.0 ("1896") renamed most branded weapons — the catalog still carries a
//      number of pre-rename display names ("Sparks LRR", "Caldwell Pax") while the wiki moved to
//      the post-rename titles ("Sparks", "Pax").
//   2. Weapon *variants* live on subpages ("Sparks/Pistol", "Mosin-Nagant/Avtomat",
//      "Officer/Carbine"), which a flat display name can't express. Note the wiki flattens
//      compound variants into ONE segment — "Sparks/Pistol_Silencer", never
//      "Sparks/Pistol/Silencer" — so a path is at most three segments deep.
//   3. A few catalog items sit under a different wiki category than the catalog's own — the
//      Katana is a Tool here but a Weapon on the wiki.
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

export const WIKI_TITLE_OVERRIDES = {
  weapons: {
    "caldwell-conversion-pistol": "Weapons/Conversion",
    "caldwell-conversion-uppercut": "Weapons/Uppercut",
    "caldwell-pax": "Weapons/Pax",
    "caldwell-rival-78": "Weapons/Rival_78",
    "crown-king-auto-5": "Weapons/Auto-5",
    "krag-m1894": "Weapons/Krag",
    "lemat-mark-ii": "Weapons/LeMat",
    "martini-henry-ic1": "Weapons/Martini-Henry",
    "mosin-nagant-avtomat": "Weapons/Mosin-Nagant/Avtomat",
    "mosin-nagant-m1891": "Weapons/Mosin-Nagant",
    "nagant-officer-carbine": "Weapons/Officer/Carbine",
    "scottfield-model-3": "Weapons/Scottfield",
    "sparks-lrr": "Weapons/Sparks",
    "sparks-pistol": "Weapons/Sparks/Pistol",
    "vetterli-71-karabiner": "Weapons/Vetterli_71",
    "winfield-1876-centennial": "Weapons/Centennial",
    // Not a duplicate: this IS the live weapon the wiki now calls "Ranger 73". It was mapped to
    // null until the wiki audit, on the mistaken belief that a separate "Ranger 73" catalog row
    // covered it — there is no such row, so the only entry for this weapon was being skipped
    // outright. Per ADR-0005 the id stays `winfield-m1873`; only the display name is stale.
    "winfield-m1873": "Weapons/Ranger_73",
    // Genuine duplicate — see KNOWN_CATALOG_DUPLICATES.
    "winfield-m1873c": null,
  },
  tools: {
    // The wiki files the Katana under Weapons even though the catalog treats it as a Tool.
    katana: "Weapons/Katana",
    // The wiki pluralizes the placeable trap pages; the catalog uses the singular in-game label.
    "alert-trip-mine": "Tools/Alert_Trip_Mines",
    "concertina-trip-mine": "Tools/Concertina_Trip_Mines",
    "poison-trip-mine": "Tools/Poison_Trip_Mines",
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
 * Skipping a duplicate here is a stopgap, not the fix — the entry still shows up in the picker
 * with a fallback thumb. Deleting the row from catalog.js is the real remedy and is now safe to
 * do: loadoutCodec.js pins the pre-versioning catalog order in its own frozen table (issue #68),
 * so a mid-array delete no longer shifts what a legacy record resolves to. This used to warn the
 * opposite, because the legacy decoder read the live arrays positionally and a splice silently
 * remapped old saved loadouts. "Choke Bomb" was the first entry retired that way (issue #67).
 */
export const KNOWN_CATALOG_DUPLICATES = {
  "winfield-m1873c":
    'stale pre-1896 name; duplicates the "Frontier 73C" entry, which is already in the catalog ' +
    "and maps to Weapons/Frontier_73C",
};

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
