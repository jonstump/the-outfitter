#!/usr/bin/env node
// Governing: ADR-0007 (as amended 2026-08-10), ADR-0005 (generated-committed data, revision
// provenance, shared wiki client), ADR-0002 (offline, self-hosted, ethical scrape)
//
// ADR-0007's title still says "Two-Size Portraits" — the amendment of 2026-08-10 deliberately kept
// the title for referential stability and states that it is authoritative wherever it and the
// decision body disagree. One trimmed portrait per hunter is what this script emits.
//
// Implements: SPEC-0004 REQ "Offline, Human-Invoked Scrape", REQ "One Visit Per Hunter Page Yields
// Both Payloads", REQ "Generated, Committed Dataset File", REQ "One Trimmed Portrait Per Hunter",
// REQ "The List Card Is Knowingly Upscaled", REQ "Portrait Payload Budget",
// REQ "Consumption Contract Compatibility", REQ "Names-Only Mode", REQ "Error Handling Standards",
// REQ "Image Processing Dependency Is Development-Only"
//
// scripts/scrape-hunters.mjs
//
// Offline, on-demand scrape of huntshowdown.wiki.gg for the hunter roster. Like scrape-images.mjs
// this is a standalone tool, NOT part of the app's runtime or build path. Invoke it deliberately:
//
//   node scripts/scrape-hunters.mjs [options]
//
//   --names-only        Write hunters.json only; touch nothing under client/public/images/hunters/.
//                       Runs without `sharp` installed (SPEC-0004 REQ "Names-Only Mode").
//   --delay-ms=1500     Minimum delay between requests to the wiki (default: 1500ms)
//   --force             Re-encode portraits that already exist on disk. REQUIRED TO APPLY A
//                       PIPELINE CHANGE: without it a run skips every hunter whose `{slug}.avif`
//                       is already present, without fetching it, so re-running after changing the
//                       trim, the encoder or the quality is a no-op on the committed assets and
//                       reports a clean summary. The run summary counts those skips explicitly so
//                       "nothing changed" is visible rather than inferred.
//   --dry-run           Resolve the roster and check robots.txt, but fetch no hunter page and
//                       write no file
//   --limit=N           Stop after N hunter pages (development aid, not a production mode)
//   --out=PATH          Override the dataset path (defaults to data/hunters.json at the repo root)
//
// ---------------------------------------------------------------------------------------------
// WHAT THE WIKI ACTUALLY SERVES
//
// design.md lists this as the open question most likely to force a spec revision: "a consistent
// infobox image, or something that varies by page?" The answer, established by inspecting the live
// site, is that hunter pages come in exactly two shapes, both driven by the DRUID infobox
// extension, and that a third source — the roster gallery — is authoritative for display names.
//
//   1. SINGLE-VARIANT pages (e.g. Hunters/Caitlyn_Hammond) carry one `druid-main-image` with a
//      `druid-main-image-caption` (the description) and a flat `druid-data-Source`.
//
//   2. MULTI-VARIANT pages (e.g. Hunters/The_Revenant, Hunters/Union_Suit) are tabbed. Every
//      per-variant value — portrait, caption, Source — is a `druid-toggleable-data` /
//      `druid-main-images-file` div keyed by `data-druid-tab-key="<variant>"`. A progression
//      hunter's Rookie/Survivor/Veteran are three tabs on one page.
//
// Three consequences shaped this parser, and each is a trap the obvious implementation falls into:
//
//   * og:image IS WRONG ON MULTI-VARIANT PAGES. scrape-images.mjs prefers og:image because for an
//     item page it is the stable, skin-independent location. Here it names only the *first* tab's
//     art: Hunters/Bad_Hand advertises `Hunter_The_Revenant.png`. Trusting it would silently give
//     several hundred hunters a sibling's face — a failure no test that only checks "an image was
//     written" would ever catch. og:image is therefore used ONLY as a last-resort fallback for a
//     single-variant page whose infobox could not be parsed.
//
//   * ROSTER LINKS ARE REDIRECT TITLES. /wiki/Hunters/Bad_Hand redirects to Hunters/The_Revenant.
//     The canonical title comes from `wgPageName` in the page's own RLCONF blob, never from the
//     URL we asked for.
//
//   * /wiki/File: IS ROBOTS-DISALLOWED. The infobox links its art as /wiki/File:Hunter_X.png, which
//     robots.txt forbids. The bytes live at /images/Hunter_X.png, which is allowed, so the direct
//     media URL is derived from the file name rather than by following the File: link.
//
// ENTRY GRANULARITY. One dataset entry per *variant*, which is what ADR-0007 and design.md assume
// ("three entries, which is what the wiki lists"). The roster gallery at /wiki/Hunters is fetched
// once and supplies the wiki's own qualified display name ("Union Suit: Red Drawers", where the tab
// key alone is just "Red Drawers"). Gallery entries and page variants are joined on the underlying
// image file name, which both sides expose and which survives display-name edits. Variants the
// gallery omits still make the dataset under a name constructed from the page title and tab key —
// the page, not the gallery, is authoritative for what exists.
//
// ID STABILITY. Ids derive from the portrait file name (`Hunter_Union_Suit_Red.png` ->
// `union-suit-red`), not from the display name, because SPEC-0004 requires a renamed hunter to keep
// its id and change only its `name`. A name-derived id would re-key on every rename and orphan the
// `hunterId` references SPEC-0003 stores in user data. Any existing hunters.json is additionally
// read back and its ids preserved by portrait join, so the guarantee holds even if a file is
// renamed on the wiki. Hunters with no portrait at all fall back to a name-derived id; that is the
// one case where a rename can re-key, and it is recorded in the run summary.
//
// Error handling (SPEC-0004 "Error Handling Standards") mirrors scrape-images.mjs: sentinel classes
// from the shared client, per-hunter try/catch so one failure never aborts the run, structured
// key-value logging, and a per-run summary of succeeded/failed/skipped with reasons.
//
// Shared wiki client (ADR-0005/ADR-0007): slug derivation, robots.txt fetching and evaluation, the
// rate limiter, the user agent, and the sentinel error classes are imported from scripts/lib/wiki.mjs
// and defined nowhere here.

import { mkdir, writeFile, readFile, readdir, access, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_DELAY_MS,
  ImageAssetNotFoundError,
  ItemPageNotFoundError,
  NetworkFailureError,
  RateLimiter,
  RobotsDisallowedError,
  ScrapeError,
  USER_AGENT,
  WIKI_ORIGIN,
  decodeEntities,
  fetchRobotsTxt,
  isAllowedByRobots,
  readRlconf,
  slugify,
  tidyProse,
} from "./lib/wiki.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

// The dataset is a REPO-ROOT artifact, not a client-workspace file: the client bundles it
// and the server reads it to validate favorited hunter ids, so it belongs to neither
// workspace. Both Docker stages copy `data/` explicitly (issue: PR #133 review).
export const HUNTERS_DATA_PATH = path.join(REPO_ROOT, "data", "hunters.json");
export const HUNTERS_IMAGES_ROOT = path.join(REPO_ROOT, "client", "public", "images", "hunters");

/** The roster index page. One fetch yields every hunter's page link and the wiki's own labels. */
export const ROSTER_PATH = "Hunters";

// ---------------------------------------------------------------------------
// Portrait budgets (SPEC-0004 REQ "One Trimmed Portrait Per Hunter", REQ "Portrait Payload
// Budget"). These are the numbers ADR-0007 deliberately left to the spec, so they live as named
// constants here rather than inline — moving one is a spec edit, not a code hunt.
//
// Governing: ADR-0007 (as amended 2026-08-10), SPEC-0004 REQ "One Trimmed Portrait Per Hunter"
//
// There is no size table any more. The 2026-08-10 amendment replaced the thumbnail/full-size pair
// with a single asset sized by its own subject, so a target width is not a thing this pipeline
// has: the trimmed bounding box is the width. The 15 KB thumbnail ceiling is removed rather than
// reassigned — it described an asset class that no longer exists, and holding the single asset to
// it would fail hunters whose trimmed subject legitimately encodes above it.
// ---------------------------------------------------------------------------

/** Per-asset ceiling. One asset per hunter, so this is the only per-asset budget there is. */
export const PORTRAIT_MAX_BYTES = 25 * 1024;

/** Total committed portrait payload ceiling, across every hunter. */
export const TOTAL_BUDGET_BYTES = 12 * 1024 * 1024;

/**
 * AVIF quality. **Normative** — SPEC-0004 requires quality 70 explicitly, because the 25 KB
 * per-asset budget below is derived from it. Changing this number is a spec edit.
 *
 * Measured against a real portrait (Hunter_The_Revenant.png, 384×256 PNG with alpha, 58 KB), the
 * padded two-size pipeline this replaces landed at:
 *
 *   q=40  192px 2.4 KB   320px 4.1 KB
 *   q=70  192px 4.6 KB   320px 8.8 KB     <- chosen
 *   q=80  192px 5.4 KB   320px 10.8 KB
 *
 * Trimming raises the per-asset figure — the asset is now all subject where before it was ~46%
 * transparent padding — and sampled trimmed encodes at q=70 land at a mean of 10.1 KB and a
 * maximum of 13.3 KB, projecting ~2.39 MB across the 242-hunter roster. That leaves roughly 2×
 * headroom on the per-asset budget and 5× on the total, so a busier-than-average portrait has room
 * to be larger without failing its hunter.
 */
export const AVIF_QUALITY = 70;

// ---------------------------------------------------------------------------
// Sentinel errors specific to this payload. The shared client owns the ones every scrape needs;
// SPEC-0004 adds "budget exceeded" and "portrait source unusable" to the list of modes callers
// must tell apart.
// ---------------------------------------------------------------------------

/** A generated asset exceeded its per-asset budget, or the run would exceed the total ceiling. */
export class BudgetExceededError extends ScrapeError {}

/**
 * The portrait was fetched successfully but carries no subject to trim to: no pixel reaches
 * ALPHA_TRIM_THRESHOLD, so no bounding box exists.
 *
 * Governing: ADR-0007 (as amended 2026-08-10, trim threshold),
 * SPEC-0004 REQ "Error Handling Standards"
 *
 * The condition widened with the trim-threshold amendment of 2026-08-10: it used to mean "alpha
 * is zero everywhere" and now means "nothing in this image is visible". A source consisting entirely of
 * the alpha 1..3 wash that motivated the threshold is exactly as unusable as a blank one — it
 * renders as nothing either way — so failing it is the honest outcome. Before the change such a
 * source would have "succeeded", emitting a full-canvas asset of empty space.
 *
 * Deliberately NOT folded into ImageAssetNotFoundError. The asset was found and fetched; it simply
 * cannot be consumed. Collapsing the two would tell a maintainer the wiki is missing art when in
 * fact the art is present and this pipeline cannot use it — which points at an entirely different
 * remedy.
 */
export class PortraitSourceUnusableError extends ScrapeError {}

/** The image-processing library is required for this mode but could not be loaded. */
export class ImageProcessingUnavailableError extends ScrapeError {}

// ---------------------------------------------------------------------------
// Parsing helpers.
// ---------------------------------------------------------------------------

// decodeEntities and readRlconf moved to scripts/lib/wiki.mjs when scrape-stats.mjs became a
// second consumer of both. readRlconf is where the canonical page title and the current revision
// id are read, and that revision is the provenance baseline every payload records — two readers
// would mean two definitions of it. Re-exported here so this module's import surface is unchanged.
export { decodeEntities, readRlconf };

/**
 * Strip tags and normalise whitespace — the text a reader would see.
 *
 * Meaningful `alt` text is kept, because on this wiki an icon is sometimes the only place a value
 * is stated. `Source` for a Blood Bonds hunter is literally `900 <img alt="Blood Bonds">`: drop the
 * alt and the field reads "900", which is not merely lossy but unclassifiable — 24% of the roster
 * landed with `acquisition: null` before this.
 *
 * Filename-shaped alts are excluded. MediaWiki gives `/wiki/File:`-linked images an alt of the raw
 * file name ("Event Icon Harvest of Ghosts.png"), which is markup noise rather than content, and
 * splicing it in would corrupt the verbatim `source` this dataset is supposed to preserve.
 */
export function stripTags(html) {
  const withAltText = html.replace(/<img\b[^>]*>/gi, (tag) => {
    const alt = tag.match(/\balt="([^"]*)"/i) || tag.match(/\balt='([^']*)'/i);
    if (!alt) return " ";
    const text = alt[1].trim();
    if (!text || /\.(png|jpe?g|gif|svg|webp|avif)$/i.test(text)) return " ";
    return ` ${text} `;
  });

  return decodeEntities(withAltText.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}


/** The wiki namespaces hunter pages under "Hunters/"; the display title drops that segment. */
export function pageTitleToDisplay(pageTitle) {
  const withoutNamespace = String(pageTitle || "").replace(/^Hunters\//, "");
  return withoutNamespace.replace(/_/g, " ").trim();
}

/**
 * Derive the portrait slug from the wiki's image file name.
 *
 * "Hunter_Union_Suit_Red.png" -> "union-suit-red". The "Hunter_" prefix is uniform across the
 * roster and carries no information; dropping it keeps the on-disk names readable. slugify() is
 * the shared derivation, so the asset path stays on the same contract every other image obeys.
 */
export function portraitSlugFromFile(fileName) {
  if (!fileName) return null;
  const base = String(fileName)
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/^Hunter[_ ]/i, "")
    .replace(/_/g, " ");
  const slug = slugify(decodeEntities(base));
  return slug || null;
}

/** The wiki serves original media at /images/<File_Name>; /wiki/File: is robots-disallowed. */
export function buildMediaUrl(fileName) {
  return `${WIKI_ORIGIN}/images/${encodeURIComponent(String(fileName).replace(/ /g, "_"))}`;
}

export function buildWikiPageUrl(wikiPath) {
  const encoded = String(wikiPath)
    .split("/")
    .map((segment) => encodeURIComponent(segment.trim().replace(/\s+/g, "_")))
    .join("/");
  return `${WIKI_ORIGIN}/wiki/${encoded}`;
}

// ---------------------------------------------------------------------------
// Roster page parsing.
// ---------------------------------------------------------------------------

/**
 * Parse the roster gallery at /wiki/Hunters.
 *
 * Returns one record per gallery box that names a hunter page: { label, wikiPath, file }. Boxes
 * that link a bare File: (the four generic free-hunter portraits, which have no page and no name)
 * are deliberately dropped — they are art, not selectable identities.
 *
 * `label` is the wiki's own qualified display name and is preferred over anything this script
 * could construct; `file` is the join key to a page variant.
 */
export function parseRoster(html) {
  const entries = [];
  const seen = new Set();
  const boxes = html.match(/<li class="gallerybox"[\s\S]*?<\/li>/g) || [];

  for (const box of boxes) {
    const link = box.match(/<div class="gallerytext">[\s\S]*?<a href="\/wiki\/([^"#?]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!link) continue;

    const wikiPath = decodeURIComponent(link[1]);
    if (!/^Hunters\//.test(wikiPath)) continue;

    const label = stripTags(link[2]);
    if (!label) continue;

    const img = box.match(/<img[^>]+src="\/images\/thumb\/([^/"]+)\//) || box.match(/<img[^>]+src="\/images\/([^/"?]+)/);
    const file = img ? decodeURIComponent(img[1]) : null;

    const key = `${wikiPath} ${label}`;
    if (seen.has(key)) continue;
    seen.add(key);

    entries.push({ label, wikiPath, file });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Hunter page parsing — the DRUID infobox, in both of its shapes.
// ---------------------------------------------------------------------------

/** Isolate the infobox so page-body galleries and "Related Skins" art can never be mistaken for it. */
function extractInfobox(html) {
  const start = html.search(/<div class="druid-infobox[^"]*"/);
  if (start === -1) return null;
  const end = html.indexOf('<div id="toc"', start);
  const printFooter = html.indexOf("printfooter", start);
  const stop = [end, printFooter, html.length].filter((n) => n > 0).sort((a, b) => a - b)[0];
  return html.slice(start, stop);
}

/** Collect `data-druid-tab-key`-keyed values from a container, in document order. */
function collectTabbed(container, pattern) {
  const out = [];
  const re = new RegExp(pattern, "g");
  let m;
  while ((m = re.exec(container)) !== null) out.push(m);
  return out;
}

/**
 * Read a caption out of a variant segment.
 *
 * The closing `</div>` is optional on purpose. Segments are cut at the next sibling marker, and
 * because the caption is the last element in a segment, that cut consumes its closing tag — a
 * regex requiring `</div>` silently returns null for the LAST variant on every page, which is the
 * kind of off-by-one that produces a dataset that looks fine until you read the final row.
 *
 * `tidyProse` runs here, not inside `stripTags` itself (#354). `stripTags` is shared with the
 * infobox `Source` parse, and loosening its tag-to-space behaviour there would rewrite the
 * verbatim classification strings that field is supposed to preserve untouched. The caption is
 * prose — a hunter's bio — so it gets the same punctuation/apostrophe cleanup the item scrape's
 * `parseDescription` already applies to trait and weapon descriptions.
 */
function extractCaption(segment, className) {
  const m = segment.match(new RegExp(`<div class="${className}">([\\s\\S]*?)(?:</div>|$)`));
  return m ? tidyProse(stripTags(m[1])) || null : null;
}

/**
 * Extract every variant a hunter page defines.
 *
 * Returns [{ tabKey, file, description }] — one record per variant, in the order the wiki lists
 * them. A single-variant page yields exactly one record with `tabKey` null.
 */
export function parseVariants(html) {
  const box = extractInfobox(html);
  if (!box) return [];

  // Shape 2: tabbed. Each variant's art and caption live in one druid-main-images-file div.
  const files = collectTabbed(
    box,
    '<div class="druid-main-images-file[^"]*"[^>]*data-druid-tab-key="([^"]*)"[^>]*>([\\s\\S]*?)(?=<div class="druid-main-images-file|<\\/div>\\s*<\\/div>\\s*<\\/div>)'
  );
  if (files.length > 0) {
    return files.map((m) => {
      const tabKey = decodeEntities(m[1]).trim();
      const segment = m[2];
      const fileMatch =
        segment.match(/href="\/wiki\/File:([^"?#]+)"/) ||
        segment.match(/<img[^>]+src="\/images\/thumb\/([^/"]+)\//);
      return {
        tabKey,
        file: fileMatch ? decodeURIComponent(fileMatch[1]) : null,
        description: extractCaption(segment, "druid-main-images-caption"),
      };
    });
  }

  // Shape 1: single. One druid-main-image, no tab keys anywhere.
  const single = box.match(/<div class="druid-main-image">([\s\S]*?)<\/div>\s*<\/div>/);
  if (single) {
    const segment = single[1];
    const fileMatch =
      segment.match(/href="\/wiki\/File:([^"?#]+)"/) ||
      segment.match(/<img[^>]+src="\/images\/thumb\/([^/"]+)\//);
    return [
      {
        tabKey: null,
        file: fileMatch ? decodeURIComponent(fileMatch[1]) : null,
        description: extractCaption(segment, "druid-main-image-caption"),
      },
    ];
  }

  // An infobox with no art at all still defines a hunter — SPEC-0004 requires it to reach the
  // dataset so the picker can list it.
  return [{ tabKey: null, file: null, description: null }];
}

/**
 * Extract the infobox's `Source` row as a tabKey -> verbatim string map.
 *
 * The `null` key carries a single-variant page's flat value. A page with no Source row at all
 * (Hunters/Union_Suit has none) yields an empty map, which SPEC-0004 requires to produce
 * `source: null, acquisition: null` rather than dropping the hunter.
 */
export function parseSources(html) {
  const box = extractInfobox(html);
  if (!box) return {};

  const rowStart = box.search(/<div class="druid-row druid-row-Source"/);
  if (rowStart === -1) return {};
  const rest = box.slice(rowStart);
  const rowEnd = rest.search(/<div class="druid-row druid-row-(?!Source)/);
  const row = rowEnd === -1 ? rest : rest.slice(0, rowEnd);

  const sources = {};
  const tabbed = collectTabbed(
    row,
    '<div class="druid-toggleable-data[^"]*"[^>]*data-druid-tab-key="([^"]*)"[^>]*>([\\s\\S]*?)(?=<div class="druid-toggleable-data|<\\/div>\\s*<\\/div>)'
  );
  if (tabbed.length > 0) {
    for (const m of tabbed) {
      const value = stripTags(m[2]);
      if (value) sources[decodeEntities(m[1]).trim()] = value;
    }
    return sources;
  }

  const flat = row.match(/<div class="druid-data[^"]*">([\s\S]*?)<\/div>\s*<\/div>/);
  const value = flat ? stripTags(flat[1]) : "";
  if (value) sources[""] = value;
  return sources;
}

// ---------------------------------------------------------------------------
// Acquisition normalisation (SPEC-0004 REQ "Generated, Committed Dataset File").
//
// `source` is what the wiki asserts and cannot be wrong; `acquisition` is derived and can be.
// Storing both means a miscategorisation is fixed by re-deriving from disk rather than by
// re-scraping every page — which is why the rules live here as data and the raw string is kept.
//
// Order matters: the first matching rule wins, so the specific patterns precede the general ones
// ("Soul Survivor" before the bare event match, "Dark Tribute" before "Tribute").
// ---------------------------------------------------------------------------

export const ACQUISITION_RULES = [
  [/\bsoul\s*survivor\b/i, "soul-survivor"],
  [/\bdark\s*tribute\b/i, "dark-tribute"],
  [/\bblood\s*bonds?\b/i, "blood-bonds"],
  [/\bhunt\s*dollars?\b/i, "hunt-dollars"],
  [/\btwitch\b/i, "twitch-drop"],
  [/\bmythic\b/i, "mythic"],
  [/\bprestige\b/i, "prestige"],
  [/\bbloodline\b/i, "bloodline"],
  // "Halloween Questline", "Vengeance of the Skinned Questline" — the wiki's own wording for what
  // SPEC-0004 calls a story challenge.
  [/\bstory\b|\bchallenge\b|\bquestline\b/i, "story-challenge"],
  [/\bdlc\b/i, "dlc"],
  [/\bevent\b/i, "event"],
  [/\bprogression\b/i, "progression"],
  [/\bfree\b/i, "free"],
];

/** Map a verbatim `Source` string onto SPEC-0004's closed acquisition vocabulary, or null. */
export function normaliseAcquisition(source) {
  if (!source) return null;
  for (const [pattern, value] of ACQUISITION_RULES) {
    if (pattern.test(source)) return value;
  }
  return null;
}

/**
 * Whether the hunter can still be acquired.
 *
 * SPEC-0004 keeps this separate from `acquisition` because "how was this obtained" and "can I
 * still get it" are different questions. The wiki publishes no explicit field for it, so it is
 * derived: mythic hunters are permanently unobtainable; everything with a recognised acquisition
 * is assumed obtainable; an unparseable Source yields null rather than a guess, so the picker can
 * tell "known to be available" from "unknown".
 */
export function deriveObtainable(acquisition) {
  if (acquisition === null) return null;
  if (acquisition === "mythic") return false;
  return true;
}

// ---------------------------------------------------------------------------
// Structured logging + per-run summary (SPEC-0004 "Error Handling Standards").
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

export function formatSummary(summary, extra = {}) {
  const lines = [
    `scrape-hunters summary: ${summary.succeeded.length} succeeded, ${summary.failed.length} failed, ${summary.skipped.length} skipped`,
  ];
  if (extra.entries !== undefined) lines.push(`  dataset entries: ${extra.entries}`);
  if (extra.assetBytes !== undefined) {
    lines.push(
      `  portrait payload: ${(extra.assetBytes / 1024 / 1024).toFixed(2)} MB of ${(TOTAL_BUDGET_BYTES / 1024 / 1024).toFixed(0)} MB budget`
    );
  }
  // A run that skipped every asset because it was already on disk otherwise looks identical to one
  // that re-encoded them all: same entry count, same clean summary. Say so, and name the flag.
  if (extra.portraitsSkipped) {
    lines.push(
      `  portraits left untouched (already on disk): ${extra.portraitsSkipped} — re-run with --force to re-encode`
    );
  }
  // SPEC-0004 REQ "One Trimmed Portrait Per Hunter" requires the run to REPORT the count, not just
  // perform the deletion — a silent cleanup is indistinguishable from no cleanup in a review.
  if (extra.staleSweepSkipped) {
    lines.push(`  stale asset sweep SKIPPED: ${extra.staleSweepSkipped}`);
  } else if (extra.staleRemoved !== undefined) {
    lines.push(`  stale assets removed: ${extra.staleRemoved}`);
  }
  if (extra.unmappedSources?.length) {
    lines.push(`  UNMAPPED Source values (acquisition=null), ${extra.unmappedSources.length} distinct:`);
    for (const s of extra.unmappedSources) lines.push(`    - ${s}`);
  }
  for (const f of summary.failed) lines.push(`  FAILED  ${f.hunter}: ${f.reason}`);
  for (const s of summary.skipped) lines.push(`  SKIPPED ${s.hunter}: ${s.reason}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Image processing. Imported lazily and only when portraits are actually being produced, so
// names-only mode runs on a machine where `sharp` cannot be installed (SPEC-0004 REQ "Image
// Processing Dependency Is Development-Only").
// ---------------------------------------------------------------------------

export async function loadImageProcessor(importFn = (m) => import(m)) {
  try {
    const mod = await importFn("sharp");
    return mod.default ?? mod;
  } catch (err) {
    throw new ImageProcessingUnavailableError(
      `sharp is required for portrait processing but could not be loaded: ${err.message}. ` +
        `Run with --names-only to produce the dataset without portraits.`,
      { cause: err }
    );
  }
}

/**
 * Minimum alpha, of 255, at which a pixel counts as subject for the purpose of the trim.
 *
 * Governing: ADR-0007 (as amended 2026-08-10, trim threshold),
 * SPEC-0004 REQ "One Trimmed Portrait Per Hunter"
 *
 * **Normative** — the spec fixes this value so that two conforming implementations produce
 * identical dimensions. It is 8/255, or 3.1% opacity: below that a pixel is imperceptible over
 * any background the app renders onto, so nothing a reader could see is ever discarded.
 *
 * WHY IT IS NOT ZERO, WHICH IS WHAT THIS PIPELINE ORIGINALLY REQUIRED. A zero threshold takes
 * "not fully transparent" to mean "subject". That holds for most of the roster and fails badly
 * for the rest: 21 of 242 wiki sources carry a near-invisible alpha wash spread across nearly the
 * whole 384×256 canvas, at alpha 1..3 (one reaches 7). Every one of those pixels is > 0, so the
 * bounding box expanded to almost the full canvas and the trim became a no-op — those assets
 * committed at 322..333px wide against a ~207px median, i.e. 30..46% dead space by width. Since
 * every surface renders portraits with `object-fit: cover` into a fixed box, dead space eats the
 * frame and the hunter is drawn proportionally smaller than his neighbours. That is a visible
 * defect in the picker, and it was specified rather than coded by accident.
 *
 * The original zero-threshold reasoning is still half right and is deliberately preserved: the
 * box is computed here from raw pixels rather than delegated to sharp's `.trim()`, whose default
 * threshold is a heuristic and whose background is inferred from the top-left pixel. What changed
 * is only the constant. An explicit, spec-fixed number is still a definition; a library default
 * is still a moving target.
 */
export const ALPHA_TRIM_THRESHOLD = 8;

/**
 * The smallest rectangle containing every pixel whose alpha is at or above `threshold`.
 *
 * Governing: ADR-0007 (as amended 2026-08-10, trim threshold),
 * SPEC-0004 REQ "One Trimmed Portrait Per Hunter"
 *
 * Returns { left, top, width, height }, or null when no pixel reaches the threshold and the
 * source therefore has no visible subject to trim to.
 *
 * `threshold` is injectable so a test can drive the comparison at a value the pipeline never
 * ships, showing the scan is genuinely parameterised rather than agreeing with the constant by
 * coincidence. Production callers take the default: the value is normative, and a caller choosing
 * its own would be the "moving target" the explicit scan exists to avoid.
 *
 * The shipped value is pinned against a literal in the test suite rather than here. Every
 * assertion that derives its fixture from ALPHA_TRIM_THRESHOLD follows the constant wherever it
 * goes, so none of them can catch it being edited — which is a property worth stating, because it
 * was true of every threshold test in this suite until it was measured.
 */
export async function findAlphaBoundingBox(sourceBuffer, sharp, { threshold = ALPHA_TRIM_THRESHOLD } = {}) {
  const { data, info } = await sharp(sourceBuffer).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  // Raw output puts alpha last on every layout sharp emits (RGBA -> 4, grey+alpha -> 2). Callers
  // only reach this for a source metadata() reported as having alpha, so the last channel is it.
  const alpha = channels - 1;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    const row = y * width * channels;
    for (let x = 0; x < width; x += 1) {
      if (data[row + x * channels + alpha] >= threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) return null;
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * Encode one portrait from one source buffer: trim to the subject, then encode at native size.
 *
 * Governing: ADR-0007 (as amended 2026-08-10), SPEC-0004 REQ "One Trimmed Portrait Per Hunter",
 * REQ "The List Card Is Knowingly Upscaled", REQ "Portrait Payload Budget"
 *
 * Returns { width, height, bytes, buffer, trimmed }. There is no resize step anywhere in here, by
 * design: the trimmed subject is written at whatever resolution the wiki supplied. Where a surface
 * wants more pixels than the source has — the 154×220 list card wants 440px of subject height and
 * no hunter reaches it — the shortfall is a source-resolution ceiling, and manufacturing pixels to
 * hide it would multiply the payload without adding detail.
 *
 * Two source shapes are handled explicitly rather than left to the image library:
 *
 *   * No alpha channel: nothing to trim, so it is encoded untrimmed at native resolution. Not a
 *     failure — the hunter still needs a portrait.
 *   * No pixel at or above ALPHA_TRIM_THRESHOLD: nothing visible, so no bounding box. Fails with
 *     PortraitSourceUnusableError.
 *
 * Throws BudgetExceededError if the encode lands over the per-asset budget. SPEC-0004 requires the
 * oversized file NOT to be written, so the budget is checked before anything reaches disk.
 */
export async function encodePortrait(
  sourceBuffer,
  sharp,
  { hunter, url, quality = AVIF_QUALITY, maxBytes = PORTRAIT_MAX_BYTES } = {}
) {
  const meta = await sharp(sourceBuffer).metadata();

  let box = null;
  if (meta.hasAlpha) {
    box = await findAlphaBoundingBox(sourceBuffer, sharp);
    if (!box) {
      throw new PortraitSourceUnusableError(
        `portrait source for "${hunter}" has no visible subject (no pixel reaches alpha ` +
          `${ALPHA_TRIM_THRESHOLD} of 255), so it has no bounding box to trim to`,
        { item: hunter, url }
      );
    }
  }

  // A fresh pipeline per stage: the bounding-box scan above consumed a `.raw()` one.
  const pipeline = sharp(sourceBuffer);
  const buffer = await (box ? pipeline.extract(box) : pipeline).avif({ quality }).toBuffer();

  if (buffer.length > maxBytes) {
    throw new BudgetExceededError(
      `portrait for "${hunter}" is ${buffer.length} bytes, over the ${maxBytes}-byte budget`,
      { item: hunter, url }
    );
  }

  return {
    width: box ? box.width : meta.width ?? null,
    height: box ? box.height : meta.height ?? null,
    bytes: buffer.length,
    buffer,
    trimmed: Boolean(box),
  };
}

/**
 * Asset path for a portrait slug — derivable by consumers from the slug alone.
 *
 * Governing: ADR-0007 (as amended 2026-08-10), SPEC-0004 REQ "Consumption Contract Compatibility"
 *
 * No size segment, and no size argument: with one asset per hunter there is nothing to select
 * between, so a consumer that held a `size` would be holding a parameter with one legal value.
 */
export function portraitAssetPath(imagesRoot, slug) {
  return path.join(imagesRoot, `${slug}.avif`);
}

/**
 * Delete every asset in the images root that the current run does not claim.
 *
 * Governing: ADR-0007 (as amended 2026-08-10), SPEC-0004 REQ "One Trimmed Portrait Per Hunter"
 *
 * `keepFiles` is the set of file NAMES (not paths) the dataset points at. Anything else under the
 * images root is an orphan: a `-thumb` variant from the two-size pipeline, or art for a hunter no
 * longer in the roster. Both leave a file on disk that no dataset row references, and without this
 * the 242 committed `-thumb` assets would survive every future run — which would make SPEC-0004's
 * "only one asset per hunter remains" and total-payload scenarios permanently unfalsifiable.
 *
 * A removal failure is logged and counted as not-removed rather than thrown: a stale file the run
 * could not unlink is a cleanup problem, not a reason to discard a successful scrape.
 *
 * Returns { removed, files }.
 */
export async function removeStaleAssets({
  imagesRoot,
  keepFiles,
  fsReaddir = readdir,
  fsUnlink = unlink,
  log = logStructured,
}) {
  let names;
  try {
    names = await fsReaddir(imagesRoot);
  } catch {
    // No images directory yet — a names-only history, or a first run. Nothing stale by definition.
    return { removed: 0, files: [] };
  }

  const files = [];
  for (const name of names) {
    if (!name.endsWith(".avif")) continue;
    if (keepFiles.has(name)) continue;
    try {
      await fsUnlink(path.join(imagesRoot, name));
      files.push(name);
      log({ level: "info", event: "stale-asset-removed", file: name });
    } catch (err) {
      log({ level: "error", event: "stale-asset-remove-failed", file: name, reason: err.message });
    }
  }

  return { removed: files.length, files };
}

// ---------------------------------------------------------------------------
// Per-hunter scrape. One page fetch yields every variant's dataset row and portrait.
// ---------------------------------------------------------------------------

async function pathExists(fsAccess, filePath) {
  try {
    await fsAccess(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetch, trim, encode and write one variant's single portrait.
 *
 * Governing: ADR-0007 (as amended 2026-08-10), SPEC-0004 REQ "One Trimmed Portrait Per Hunter"
 *
 * All-or-nothing on disk. `encodePortrait` trims and budget-checks before anything is written, and
 * a failed write unlinks whatever partial file it may have left. Callers isolate this per variant
 * so one variant's failure cannot discard a sibling's work.
 *
 * Returns { assets, bytes, skipped }. `bytes` is the asset's committed weight either way: an asset
 * skipped because it is already on disk reports its ON-DISK size, not zero. The total-payload gate
 * measures what the repository will carry, and a non-`--force` run that reported zero for every
 * skipped asset could never trip a ceiling the committed set had already breached (PR #152 review).
 * `assets` stays empty on a skip — nothing was produced — so per-asset reporting is unaffected.
 *
 * Throws a sentinel with hunter/url context on failure.
 */
export async function producePortrait({ variant, name, portrait }, deps) {
  const {
    fetchFn,
    rateLimiter,
    robotsGroups,
    userAgent = USER_AGENT,
    imagesRoot = HUNTERS_IMAGES_ROOT,
    fsMkdir = mkdir,
    fsWriteFile = writeFile,
    fsAccess = access,
    fsStat = stat,
    fsUnlink = unlink,
    sharp = null,
    force = false,
    log = logStructured,
  } = deps;

  const destPath = portraitAssetPath(imagesRoot, portrait);
  if (!force && (await pathExists(fsAccess, destPath))) {
    // An unreadable size is counted as zero rather than failing the hunter: the asset is present
    // and usable, and a stat failure is a budget-accounting gap, not a reason to discard art.
    let onDiskBytes = 0;
    try {
      onDiskBytes = (await fsStat(destPath))?.size ?? 0;
    } catch {
      onDiskBytes = 0;
    }
    log({
      level: "info",
      event: "portrait-skipped",
      hunter: name,
      portrait,
      bytes: onDiskBytes,
      reason: "already on disk — re-run with --force to re-encode",
    });
    return { assets: [], bytes: onDiskBytes, skipped: true };
  }

  const mediaUrl = buildMediaUrl(variant.file);
  const mediaPath = new URL(mediaUrl).pathname;
  if (!isAllowedByRobots(robotsGroups, userAgent, mediaPath)) {
    throw new RobotsDisallowedError(`robots.txt disallows fetching portrait for "${name}" at ${mediaPath}`, {
      item: name,
      url: mediaUrl,
    });
  }

  await rateLimiter.wait();

  let imageRes;
  try {
    imageRes = await fetchFn(mediaUrl, { headers: { "User-Agent": userAgent } });
  } catch (err) {
    throw new NetworkFailureError(`network failure fetching portrait for "${name}" at ${mediaUrl}: ${err.message}`, {
      cause: err,
      item: name,
      url: mediaUrl,
    });
  }
  if (!imageRes.ok) {
    if (imageRes.status === 404) {
      throw new ImageAssetNotFoundError(`portrait asset not found for "${name}": HTTP 404 at ${mediaUrl}`, {
        item: name,
        url: mediaUrl,
      });
    }
    throw new NetworkFailureError(`failed to fetch portrait for "${name}": HTTP ${imageRes.status} at ${mediaUrl}`, {
      item: name,
      url: mediaUrl,
    });
  }

  let sourceBuffer;
  try {
    sourceBuffer = Buffer.from(await imageRes.arrayBuffer());
  } catch (err) {
    throw new NetworkFailureError(`failed to read portrait bytes for "${name}" at ${mediaUrl}: ${err.message}`, {
      cause: err,
      item: name,
      url: mediaUrl,
    });
  }

  // Throws BudgetExceededError (over budget) or PortraitSourceUnusableError (no subject) before
  // returning, so neither an over-budget nor an unusable asset ever reaches disk.
  const encoded = await encodePortrait(sourceBuffer, sharp, { hunter: name, url: mediaUrl });

  try {
    await fsMkdir(imagesRoot, { recursive: true });
    await fsWriteFile(destPath, encoded.buffer);
  } catch (err) {
    // A failed write can still have created a truncated file; remove it rather than leave a
    // corrupt asset that a later run would happily skip as "already on disk".
    await Promise.resolve(fsUnlink(destPath)).catch(() => {});
    throw new ScrapeError(`failed to write portrait for "${name}" to ${imagesRoot}: ${err.message}`, {
      cause: err,
      item: name,
      url: mediaUrl,
    });
  }

  log({
    level: "info",
    event: "portrait-written",
    hunter: name,
    portrait,
    width: encoded.width,
    height: encoded.height,
    bytes: encoded.bytes,
    trimmed: encoded.trimmed,
  });

  return {
    assets: [
      {
        path: destPath,
        bytes: encoded.bytes,
        width: encoded.width,
        height: encoded.height,
        trimmed: encoded.trimmed,
      },
    ],
    bytes: encoded.bytes,
    skipped: false,
  };
}

/**
 * Scrape one hunter page.
 *
 * Returns { entries, assets, bytes, skippedAssets, failures } where `entries` is one dataset row
 * per variant that succeeded and `skippedAssets` counts variants whose art was already on disk (see
 * producePortrait: their weight is still in `bytes`). Page-level failures (fetch, 404) throw a
 * sentinel and runScrape catches per page;
 * per-variant portrait failures are isolated and reported in `failures` without discarding the
 * variants that did succeed.
 */
export async function scrapeHunterPage(target, deps) {
  const {
    fetchFn,
    rateLimiter,
    robotsGroups,
    userAgent = USER_AGENT,
    imagesRoot = HUNTERS_IMAGES_ROOT,
    fsMkdir = mkdir,
    fsWriteFile = writeFile,
    fsAccess = access,
    fsStat = stat,
    fsUnlink = unlink,
    sharp = null,
    namesOnly = false,
    force = false,
    dryRun = false,
    ingestedAt,
    labelsByFile = new Map(),
    idsByPortrait = new Map(),
    seenCanonical = null,
    log = logStructured,
  } = deps;

  const { wikiPath } = target;
  const pageUrl = buildWikiPageUrl(wikiPath);
  const pagePath = new URL(pageUrl).pathname;

  if (!isAllowedByRobots(robotsGroups, userAgent, pagePath)) {
    throw new RobotsDisallowedError(`robots.txt disallows fetching hunter page at ${pagePath}`, {
      item: wikiPath,
      url: pageUrl,
    });
  }

  await rateLimiter.wait();

  let pageRes;
  try {
    pageRes = await fetchFn(pageUrl, { headers: { "User-Agent": userAgent } });
  } catch (err) {
    throw new NetworkFailureError(`network failure fetching hunter page "${wikiPath}" at ${pageUrl}: ${err.message}`, {
      cause: err,
      item: wikiPath,
      url: pageUrl,
    });
  }
  if (!pageRes.ok) {
    if (pageRes.status === 404) {
      throw new ItemPageNotFoundError(`hunter page not found for "${wikiPath}": HTTP 404 at ${pageUrl}`, {
        item: wikiPath,
        url: pageUrl,
      });
    }
    throw new NetworkFailureError(`failed to fetch hunter page for "${wikiPath}": HTTP ${pageRes.status} at ${pageUrl}`, {
      item: wikiPath,
      url: pageUrl,
    });
  }

  const html = await pageRes.text();

  // Canonical identity, not the URL we asked for: roster links are frequently redirects.
  const canonicalPage = readRlconf(html, "wgPageName") || wikiPath;
  const revision = readRlconf(html, "wgCurRevisionId") ?? readRlconf(html, "wgRevisionId");
  const pageTitle = pageTitleToDisplay(canonicalPage);

  // The roster gallery lists some hunters under BOTH a redirect title and their canonical one —
  // "Bad Hand" and "The Revenant" are two boxes resolving to one page. Deduping on the requested
  // path cannot catch that, because the two paths are genuinely different; only the canonical name
  // the page reports can. Without this, every such page emits its full variant set twice and the
  // dataset carries duplicate ids, which breaks the "a hunterId reference is unambiguous"
  // guarantee SPEC-0003 depends on.
  if (seenCanonical) {
    if (seenCanonical.has(canonicalPage)) {
      return { entries: [], assets: [], bytes: 0, failures: [], pageTitle, revision, canonicalPage, duplicate: true };
    }
    seenCanonical.add(canonicalPage);
  }

  const variants = parseVariants(html);
  const sources = parseSources(html);

  const entries = [];
  const assets = [];
  const failures = [];
  let bytes = 0;
  let skippedAssets = 0;

  for (const variant of variants) {
    // The gallery's qualified label ("Union Suit: Red Drawers") beats anything constructible here.
    // Falling back: "<page title>: <tab key>", collapsing to the page title when the tab names the
    // page itself (Hunters/The_Revenant's first tab is "The Revenant").
    const galleryLabel = variant.file ? labelsByFile.get(variant.file) : null;
    const name =
      galleryLabel ||
      (variant.tabKey && variant.tabKey !== pageTitle ? `${pageTitle}: ${variant.tabKey}` : pageTitle);

    const portrait = portraitSlugFromFile(variant.file);
    const source = sources[variant.tabKey ?? ""] ?? sources[""] ?? null;
    const acquisition = normaliseAcquisition(source);

    // Portrait-derived id survives a display-name change; the name-derived fallback does not, and
    // only applies to hunters with no art at all.
    const derivedId = portrait || slugify(name);
    const id = (portrait && idsByPortrait.get(portrait)) || derivedId;

    const entry = {
      id,
      name,
      description: variant.description || null,
      portrait,
      source,
      acquisition,
      obtainable: deriveObtainable(acquisition),
      sourceRevision: revision === null ? null : String(revision),
      ingestedAt,
    };

    // No portrait work to do: the entry stands on its own. SPEC-0004 requires a hunter with no
    // usable portrait to appear in the dataset regardless, so this is a success, not a failure.
    if (namesOnly || dryRun || !variant.file || !portrait) {
      entries.push(entry);
      continue;
    }

    // Isolated per variant. A tabbed page holds several independent hunters, and one of them
    // busting its byte budget is no reason to discard the siblings that encoded cleanly — nor to
    // leave their already-written art on disk with no dataset row pointing at it, which is what
    // letting this throw out of the whole page used to do.
    try {
      const produced = await producePortrait(
        { variant, name, portrait },
        {
          fetchFn,
          rateLimiter,
          robotsGroups,
          userAgent,
          imagesRoot,
          fsMkdir,
          fsWriteFile,
          fsAccess,
          fsStat,
          fsUnlink,
          sharp,
          force,
          log,
        }
      );
      assets.push(...produced.assets);
      bytes += produced.bytes;
      if (produced.skipped) skippedAssets += 1;
      entries.push(entry);
    } catch (err) {
      // SPEC-0004: an over-budget asset "SHALL fail that hunter with a recorded reason rather than
      // being written". Failing the hunter means no dataset row — a row here would misrepresent a
      // budget failure as a hunter that merely has no art.
      failures.push({
        hunter: name,
        portrait,
        errorType: err.name,
        reason: err.message,
        url: err.url,
      });
      log({
        level: "error",
        event: "variant-failed",
        hunter: name,
        portrait,
        errorType: err.name,
        reason: err.message,
        url: err.url,
      });
    }
  }

  return { entries, assets, bytes, skippedAssets, failures, pageTitle, revision, canonicalPage, duplicate: false };
}

// ---------------------------------------------------------------------------
// Run orchestration.
// ---------------------------------------------------------------------------

/** Read back an existing dataset so ids survive a wiki-side rename. Absent file is not an error. */
export async function readExistingIds(datasetPath, fsReadFile = readFile) {
  try {
    const raw = await fsReadFile(datasetPath, "utf8");
    const parsed = JSON.parse(raw);
    const map = new Map();
    for (const entry of Array.isArray(parsed) ? parsed : []) {
      if (entry?.portrait && entry?.id) map.set(entry.portrait, entry.id);
    }
    return map;
  } catch {
    return new Map();
  }
}

export async function runScrape(options = {}, deps = {}) {
  const {
    delayMs = DEFAULT_DELAY_MS,
    namesOnly = false,
    force = false,
    dryRun = false,
    limit = Infinity,
    datasetPath = HUNTERS_DATA_PATH,
    imagesRoot = HUNTERS_IMAGES_ROOT,
    // Injectable so the ceiling can be exercised without a 12 MB fixture. The per-asset budgets
    // reject long before the total is reachable at real sizes, which is exactly why the total
    // needs its own test rather than being assumed to work.
    totalBudgetBytes = TOTAL_BUDGET_BYTES,
  } = options;
  const {
    fetchFn,
    userAgent = USER_AGENT,
    log = logStructured,
    fsWriteFile = writeFile,
    fsMkdir = mkdir,
    fsReadFile = readFile,
    fsReaddir = readdir,
    fsUnlink = unlink,
    sharpLoader = loadImageProcessor,
    now = () => new Date().toISOString(),
  } = deps;

  const summary = createSummary();
  const ingestedAt = now();

  // robots.txt is a run-level gate: unreadable means stop, never "assume permitted".
  let robotsGroups;
  try {
    robotsGroups = await fetchRobotsTxt(fetchFn, userAgent);
  } catch (err) {
    log({ level: "error", event: "robots-fetch-failed", reason: err.message });
    throw err;
  }

  const rateLimiter = new RateLimiter(delayMs, deps.rateLimiterOptions);

  // sharp is loaded once, up front, and only when portraits are actually being produced — a
  // missing native dependency should fail before 200 pages are fetched, not after.
  let sharp = null;
  if (!namesOnly && !dryRun) sharp = await sharpLoader();

  // One fetch for the whole roster.
  const rosterUrl = buildWikiPageUrl(ROSTER_PATH);
  if (!isAllowedByRobots(robotsGroups, userAgent, new URL(rosterUrl).pathname)) {
    throw new RobotsDisallowedError(`robots.txt disallows fetching the roster at ${rosterUrl}`, { url: rosterUrl });
  }
  await rateLimiter.wait();
  let rosterRes;
  try {
    rosterRes = await fetchFn(rosterUrl, { headers: { "User-Agent": userAgent } });
  } catch (err) {
    throw new NetworkFailureError(`network failure fetching roster at ${rosterUrl}: ${err.message}`, {
      cause: err,
      url: rosterUrl,
    });
  }
  if (!rosterRes.ok) {
    throw new NetworkFailureError(`failed to fetch roster: HTTP ${rosterRes.status} at ${rosterUrl}`, { url: rosterUrl });
  }
  const rosterEntries = parseRoster(await rosterRes.text());

  const labelsByFile = new Map();
  for (const entry of rosterEntries) {
    if (entry.file && !labelsByFile.has(entry.file)) labelsByFile.set(entry.file, entry.label);
  }

  const pages = [...new Set(rosterEntries.map((e) => e.wikiPath))].slice(0, limit);
  log({
    level: "info",
    event: "roster-parsed",
    galleryEntries: rosterEntries.length,
    distinctPages: pages.length,
    url: rosterUrl,
  });

  const idsByPortrait = await readExistingIds(datasetPath, fsReadFile);

  const allEntries = [];
  const unmappedSources = new Set();
  const seenCanonical = new Set();
  let totalBytes = 0;
  let portraitsSkipped = 0;

  for (const wikiPath of pages) {
    try {
      const result = await scrapeHunterPage(
        { wikiPath },
        {
          fetchFn,
          rateLimiter,
          robotsGroups,
          userAgent,
          imagesRoot,
          fsMkdir,
          fsWriteFile,
          fsAccess: deps.fsAccess,
          fsStat: deps.fsStat,
          fsUnlink,
          sharp,
          namesOnly,
          force,
          dryRun,
          ingestedAt,
          labelsByFile,
          idsByPortrait,
          seenCanonical,
          log,
        }
      );

      if (result.duplicate) {
        recordResult(summary, {
          status: "skipped",
          hunter: result.pageTitle || wikiPath,
          wikiPath,
          reason: `redirects to "${result.canonicalPage}", already scraped`,
        });
        log({ level: "info", event: "page-duplicate", hunter: wikiPath, canonical: result.canonicalPage });
        continue;
      }

      for (const entry of result.entries) {
        allEntries.push(entry);
        if (entry.source && entry.acquisition === null) unmappedSources.add(entry.source);
      }

      // Variants that failed their portrait stage are individually failed hunters, not a failed
      // page — the page itself parsed, and its other variants are in the dataset.
      for (const failure of result.failures ?? []) {
        recordResult(summary, { status: "failed", wikiPath, ...failure });
      }

      totalBytes += result.bytes;
      portraitsSkipped += result.skippedAssets ?? 0;

      // The total ceiling is checked as the run proceeds so it fails before committing a set that
      // breaches it, rather than after every page has been fetched. `result.bytes` counts assets
      // skipped-because-already-present at their on-disk size, so this measures the payload the
      // repository will carry rather than only the payload this invocation wrote — otherwise a
      // non-`--force` run reports 0.00 MB and the only aggregate gate left can never trip.
      if (!namesOnly && !dryRun && totalBytes > totalBudgetBytes) {
        throw new BudgetExceededError(
          `portrait payload reached ${totalBytes} bytes, over the ${totalBudgetBytes}-byte total ceiling`,
          { item: wikiPath }
        );
      }

      recordResult(summary, {
        status: "succeeded",
        hunter: result.pageTitle || wikiPath,
        wikiPath,
        variants: result.entries.length,
        assets: result.assets.length,
      });
      log({
        level: "info",
        event: "page-succeeded",
        hunter: result.pageTitle || wikiPath,
        variants: result.entries.length,
        assets: result.assets.length,
        revision: result.revision,
      });
    } catch (err) {
      // A breached total ceiling is a run-level failure, not a per-page one: continuing would
      // write more of exactly the thing the budget forbids.
      if (err instanceof BudgetExceededError && /total ceiling/.test(err.message)) {
        log({ level: "error", event: "total-budget-exceeded", reason: err.message });
        throw err;
      }
      recordResult(summary, {
        status: "failed",
        hunter: wikiPath,
        wikiPath,
        errorType: err.name,
        reason: err.message,
      });
      log({
        level: "error",
        event: "page-failed",
        hunter: wikiPath,
        errorType: err.name,
        reason: err.message,
        url: err.url,
      });
    }
  }

  // Stable ordering by id keeps the committed diff readable across runs.
  allEntries.sort((a, b) => a.id.localeCompare(b.id));

  // Governing: ADR-0007 (as amended 2026-08-10), SPEC-0004 REQ "One Trimmed Portrait Per Hunter"
  //
  // Sweep orphans once the dataset is known, since the dataset is what defines "claimed". A file
  // the run neither wrote nor skipped-because-present is either a `-thumb` variant from the
  // two-size pipeline or art for a hunter the roster no longer lists; both are unreferenced.
  //
  // Deliberately confined to a full, COMPLETE run. `--names-only` and `--dry-run` write no imagery
  // and must delete none, and `--limit=N` is a development aid whose dataset covers a slice of the
  // roster — sweeping against it would delete the assets for every hunter past N.
  //
  // A run with ANY failure is a partial dataset in exactly the same sense (PR #152 review). Both
  // failure paths deliberately produce no dataset row — a page-level failure never reaches the
  // `allEntries.push` above, and a per-variant portrait failure omits the row on purpose so a
  // budget failure is not misreported as "hunter has no art" — so the failed hunter's previously
  // committed portrait would be unclaimed, and swept. One transient ECONNRESET would delete good,
  // committed art.
  //
  // The alternative was to widen `keepFiles` to cover attempted-but-failed hunters. It is rejected:
  // a page that failed to fetch never yields its variant list, so for exactly the hunters at risk
  // the set of files to keep cannot be reconstructed — the roster gallery is joined on file name
  // but is explicitly NOT authoritative for what variants a page has (see ENTRY GRANULARITY above),
  // so a gallery-derived keep-set would still delete the art of any gallery-omitted variant. A
  // widened keep-set narrows the hole; skipping is the only option that cannot delete art it should
  // have kept. The cost is that a genuine orphan survives until a clean run, which is reported in
  // the summary rather than left silent — an orphan that outlives a failed run is recoverable, a
  // deleted asset is only recoverable from git.
  let staleRemoved = 0;
  let staleSweepSkipped = null;
  if (namesOnly || dryRun) staleSweepSkipped = "names-only/dry-run writes no imagery";
  else if (limit !== Infinity) staleSweepSkipped = `--limit=${limit} covers only part of the roster`;
  else if (summary.failed.length > 0) {
    staleSweepSkipped = `${summary.failed.length} hunter(s) failed this run, so the dataset is partial`;
  }

  if (staleSweepSkipped !== null) {
    log({ level: "info", event: "stale-sweep-skipped", reason: staleSweepSkipped });
  }

  if (!dryRun) {
    try {
      await fsMkdir(path.dirname(datasetPath), { recursive: true });
      await fsWriteFile(datasetPath, `${JSON.stringify(allEntries, null, 2)}\n`, "utf8");
    } catch (err) {
      throw new ScrapeError(`failed to write dataset to ${datasetPath}: ${err.message}`, { cause: err });
    }
  }

  // Sweeps AFTER the dataset is committed, so a dataset write that fails cannot leave disk swept
  // against a roster that was never written (PR #152 review). Deleting files the committed dataset
  // does not reference is safe in a way the reverse ordering is not.
  if (staleSweepSkipped === null) {
    const keepFiles = new Set(
      allEntries
        .filter((entry) => entry.portrait)
        .map((entry) => path.basename(portraitAssetPath(imagesRoot, entry.portrait)))
    );
    const stale = await removeStaleAssets({ imagesRoot, keepFiles, fsReaddir, fsUnlink, log });
    staleRemoved = stale.removed;
    log({ level: "info", event: "stale-assets-swept", removed: stale.removed, kept: keepFiles.size });
  }

  log({
    level: "info",
    event: "run-summary",
    succeeded: summary.succeeded.length,
    failed: summary.failed.length,
    skipped: summary.skipped.length,
    entries: allEntries.length,
    assetBytes: totalBytes,
    portraitsSkipped,
    staleRemoved,
    staleSweepSkipped,
    unmappedSources: unmappedSources.size,
  });

  return {
    summary,
    entries: allEntries,
    assetBytes: totalBytes,
    portraitsSkipped,
    staleRemoved,
    staleSweepSkipped,
    unmappedSources: [...unmappedSources].sort(),
  };
}

// ---------------------------------------------------------------------------
// CLI entrypoint. Only runs when executed directly, never on import.
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const options = { delayMs: DEFAULT_DELAY_MS, namesOnly: false, force: false, dryRun: false, limit: Infinity };
  for (const arg of argv) {
    if (arg === "--names-only") options.namesOnly = true;
    else if (arg === "--force") options.force = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg.startsWith("--delay-ms=")) {
      const parsed = Number(arg.slice("--delay-ms=".length));
      if (Number.isFinite(parsed) && parsed >= 0) options.delayMs = parsed;
    } else if (arg.startsWith("--limit=")) {
      const parsed = Number(arg.slice("--limit=".length));
      if (Number.isFinite(parsed) && parsed > 0) options.limit = parsed;
    } else if (arg.startsWith("--out=")) {
      options.datasetPath = path.resolve(arg.slice("--out=".length));
    }
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  console.log(
    `scrape-hunters: starting — names-only=${options.namesOnly}, delay=${options.delayMs}ms, force=${options.force}, dry-run=${options.dryRun}`
  );
  console.log("scrape-hunters: manual, offline tool per ADR-0002/ADR-0007 — not run by build/dev/CI.");

  const result = await runScrape(options, { fetchFn: fetch });
  console.log(
    formatSummary(result.summary, {
      entries: result.entries.length,
      assetBytes: result.assetBytes,
      portraitsSkipped: result.portraitsSkipped,
      staleRemoved: result.staleRemoved,
      staleSweepSkipped: result.staleSweepSkipped,
      unmappedSources: result.unmappedSources,
    })
  );

  process.exitCode = result.summary.failed.length > 0 ? 1 : 0;
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMainModule) {
  main().catch((err) => {
    console.error(`scrape-hunters: fatal error: ${err.message}`);
    if (err.cause) console.error(`  caused by: ${err.cause.message || err.cause}`);
    process.exitCode = 1;
  });
}
