#!/usr/bin/env node
// Governing: ADR-0016 (Detect Dataset Staleness in Two Tiers over Allowed HTML, Not the MediaWiki
// API), ADR-0002 (the robots.txt posture and the "not re-scraping needlessly" duty this
// discharges), SPEC-0007 REQ "Offline, Human-Invoked Stats Scrape", issue #534.
//
// TIER 1 — ROSTER DRIFT. Seven fetches, about eleven seconds, safe to schedule.
//
// This answers exactly one question: has the wiki's roster changed since our datasets were built?
// It reads the six category indexes and the hunter gallery, diffs their membership against the
// committed data, and reports pages added and removed. It does NOT read a single item page.
//
// WHY IT IS CAPPED AND WHY THE CAP IS ENFORCED IN CODE
//
// ADR-0016 Confirmation 4: "The roster check must issue no more than the 7 documented fetches. A
// regression that walks item pages during the cheap tier turns a scheduled job into the spider
// robots.txt complains about." That file's own preamble asks visitors not to generate exactly that
// traffic, so the bound is a promise to someone else's infrastructure rather than a performance
// target. A test asserting 7 would catch it in CI; a counter that throws catches it in production
// too, which is where a scheduled job actually runs. Both exist.
//
// This is deliberately NOT `scrape-stats.mjs --discover`. Discovery fetches every unmatched page to
// classify it — it says so in its own console output — which is around 160 requests. It answers a
// richer question and costs accordingly. Tier 1 trades that richness for a cost that can run weekly.
//
// WHAT IT CANNOT SEE
//
// Roster changes only. A weapon whose price moved with no page added or removed is invisible here,
// and a balance patch is mostly price changes. That is tier 2's job (the per-page revision sweep),
// which is human-invoked precisely because it costs 512 fetches. ADR-0016 records this trade-off as
// a known Bad consequence rather than an oversight: tier 1 firing is the evidence that tier 2 is
// worth running, so the expensive sweep is triggered by a finding rather than by a clock.
//
// USAGE
//
//   node scripts/check-drift.mjs              Run the check; exit 1 if the roster moved
//   node scripts/check-drift.mjs --dry-run    Resolve URLs and check robots.txt, fetch nothing
//   node scripts/check-drift.mjs --json       Emit the report as JSON instead of a table
//
// Exit codes: 0 clean, 1 drift found, 2 the check itself failed (network, robots, rate limit).

import fs from "node:fs/promises";

import {
  DEFAULT_DELAY_MS,
  NetworkFailureError,
  RateLimiter,
  RobotsDisallowedError,
  USER_AGENT,
  assertNotRateLimited,
  buildItemPageUrl,
  collectCatalogItems,
  fetchRobotsTxt,
  isAllowedByRobots,
  logStructured,
} from "./lib/wiki.mjs";
import { CATEGORY_INDEX, KNOWN_TOMBSTONES, parseCategoryMembers } from "./scrape-stats.mjs";
import { HUNTERS_DATA_PATH, ROSTER_PATH, parseRoster, portraitSlugFromFile } from "./scrape-hunters.mjs";

/**
 * The documented cost of tier 1: six category indexes plus the hunter gallery.
 *
 * Derived from CATEGORY_INDEX rather than written as `7`, so that adding a seventh index page makes
 * the budget move with it instead of turning a correct change into a spurious failure. The ADR's
 * literal "7" is asserted against this in the tests — if the two ever disagree, that is a decision
 * to re-make rather than a number to update quietly.
 */
export const TIER1_FETCH_BUDGET = Object.values(CATEGORY_INDEX).reduce((n, pages) => n + pages.length, 0) + 1;

/** Raised when the check tries to spend more requests than tier 1 is allowed. */
export class FetchBudgetExceededError extends Error {
  constructor(budget, url) {
    super(
      `tier 1 tried to exceed its ${budget}-fetch budget (next would have been ${url}). ` +
        `ADR-0016 Confirmation 4 caps the roster check; a walk over item pages belongs in tier 2.`
    );
    this.name = "FetchBudgetExceededError";
    this.budget = budget;
    this.url = url;
  }
}

/**
 * Wrap a fetch so the budget is enforced on the way out rather than audited afterwards.
 *
 * Counting after the fact would report the violation once the requests had already been made, which
 * is the one thing the cap exists to prevent.
 */
export function budgetedFetch(fetchFn, budget) {
  let spent = 0;
  const urls = [];
  const wrapped = (url, init) => {
    if (spent >= budget) throw new FetchBudgetExceededError(budget, url);
    spent += 1;
    urls.push(String(url));
    return fetchFn(url, init);
  };
  wrapped.spent = () => spent;
  wrapped.urls = () => [...urls];
  return wrapped;
}

/** Page paths compare case- and separator-insensitively; the wiki uses both spellings freely. */
const norm = (p) => String(p).replace(/_/g, " ").trim().toLowerCase();

/** A page this project has already decided about, so a diff cannot re-litigate it. */
function isTombstoned(page) {
  return Boolean(KNOWN_TOMBSTONES[String(page).replace(/ /g, "_")] || KNOWN_TOMBSTONES[page]);
}

/**
 * Diff what the wiki lists against what we committed.
 *
 * `added` is what the wiki has and we do not — a new weapon, a new variant, a returning item.
 * `removed` is what we have and the wiki no longer lists — a retirement, or a page rename, which
 * this cannot tell apart from a retirement because it never reads the page. Both are reported as
 * evidence for a human, never acted on.
 *
 * Tombstones are dropped from `added` only. A page we deliberately do not carry is not news when the
 * wiki still lists it; but if it vanished from our data some other way, that IS news.
 */
export function diffMembership({ listed, committed }) {
  const listedByKey = new Map();
  for (const page of listed) if (!listedByKey.has(norm(page))) listedByKey.set(norm(page), page);

  const committedByKey = new Map();
  for (const page of committed) if (!committedByKey.has(norm(page))) committedByKey.set(norm(page), page);

  const added = [];
  for (const [key, page] of listedByKey) {
    if (committedByKey.has(key)) continue;
    if (isTombstoned(page)) continue;
    added.push(page);
  }

  const removed = [];
  for (const [key, page] of committedByKey) {
    if (!listedByKey.has(key)) removed.push(page);
  }

  return { added, removed, listedCount: listedByKey.size, committedCount: committedByKey.size };
}

/**
 * Tier 1 proper.
 *
 * Every dependency is injected so the whole thing runs offline against fixtures, per ADR-0016
 * Confirmation 5 — the app and its tests never call the wiki.
 */
export async function runRosterCheck(options = {}, deps = {}) {
  const { dryRun = false, delayMs = DEFAULT_DELAY_MS } = options;
  const {
    fetchFn = fetch,
    userAgent = USER_AGENT,
    log = logStructured,
    readFile = fs.readFile,
    huntersPath = HUNTERS_DATA_PATH,
    // Injected rather than imported at the call site so the diff can be exercised against a known
    // membership. Reading the real catalog here would make every fixture-based test assert against
    // 270 committed rows, which tests the catalog rather than the diff.
    collectItems = collectCatalogItems,
    rateLimiter = new RateLimiter(delayMs),
  } = deps;

  // robots.txt is fetched before anything else and is NOT counted against the budget: it is the
  // permission to make the other seven, and ADR-0016's figure counts the pages the check reads.
  // Failing closed here is deliberate — a check that cannot read robots.txt does not get to guess.
  const robotsGroups = deps.robotsGroups ?? (dryRun ? [] : await fetchRobotsTxt(fetchFn, userAgent));

  const budgeted = budgetedFetch(fetchFn, TIER1_FETCH_BUDGET);

  const targets = [];
  for (const [category, pages] of Object.entries(CATEGORY_INDEX)) {
    for (const page of pages) targets.push({ kind: "category", category, page, url: buildItemPageUrl(page) });
  }
  targets.push({ kind: "roster", category: "hunters", page: ROSTER_PATH, url: buildItemPageUrl(ROSTER_PATH) });

  // Every URL is consented to before any of them is fetched. Checking each as we go would leave a
  // disallowed seventh page discovered only after six requests had gone out.
  for (const { page, url } of targets) {
    if (!isAllowedByRobots(robotsGroups, userAgent, new URL(url).pathname)) {
      throw new RobotsDisallowedError(`robots.txt disallows the tier 1 index ${page} at ${url}`, { url });
    }
  }

  if (dryRun) {
    return {
      dryRun: true,
      fetches: 0,
      budget: TIER1_FETCH_BUDGET,
      urls: targets.map((t) => t.url),
      categories: {},
      hunters: null,
      drift: false,
    };
  }

  // --- the six item indexes ------------------------------------------------
  const membersByCategory = new Map();
  for (const target of targets.filter((t) => t.kind === "category")) {
    await rateLimiter.wait();
    // eslint-disable-next-line no-await-in-loop
    const res = await budgeted(target.url, { headers: { "User-Agent": userAgent } });
    if (!res.ok) {
      throw new NetworkFailureError(`failed to fetch ${target.page}: HTTP ${res.status} at ${target.url}`, {
        url: target.url,
      });
    }
    // eslint-disable-next-line no-await-in-loop
    const html = await res.text();
    // Governing: ADR-0016 Confirmation 2. parseCategoryMembers returns [] for a page with no
    // "mw-pages" anchor, so an unguarded throttled index reads as a category that lost every member
    // — which this script would then report as the wiki deleting an entire weapon class.
    assertNotRateLimited(html, { url: target.url });
    const listed = parseCategoryMembers(html);

    if (!membersByCategory.has(target.category)) membersByCategory.set(target.category, []);
    membersByCategory.get(target.category).push(...listed);
    log({ level: "info", event: "tier1-index", category: target.category, indexPage: target.page, listed: listed.length });
  }

  const categories = {};
  let drift = false;
  for (const [category, listed] of membersByCategory) {
    const committed = collectItems([category])
      .filter((item) => item.wikiPath)
      .map((item) => item.wikiPath);
    const diff = diffMembership({ listed, committed });
    categories[category] = diff;
    if (diff.added.length || diff.removed.length) drift = true;
  }

  // --- the hunter gallery --------------------------------------------------
  const rosterTarget = targets.find((t) => t.kind === "roster");
  await rateLimiter.wait();
  const rosterRes = await budgeted(rosterTarget.url, { headers: { "User-Agent": userAgent } });
  if (!rosterRes.ok) {
    throw new NetworkFailureError(`failed to fetch the roster: HTTP ${rosterRes.status} at ${rosterTarget.url}`, {
      url: rosterTarget.url,
    });
  }
  const rosterHtml = await rosterRes.text();
  assertNotRateLimited(rosterHtml, { url: rosterTarget.url });

  // The gallery is joined to the dataset on the PORTRAIT SLUG, not on the page path, and that is a
  // correctness choice rather than a convenience. Roster links are redirect titles
  // (/wiki/Hunters/Bad_Hand serves Hunters/The_Revenant), so page paths are not stable identities;
  // and one page yields several hunters, because variants share it. The portrait file is per-variant
  // and `portrait` is committed on every row — 242 of 242, each distinct — so this joins exactly.
  const listedPortraits = parseRoster(rosterHtml)
    .map((entry) => portraitSlugFromFile(entry.file))
    .filter(Boolean);

  const huntersRaw = JSON.parse(await readFile(huntersPath, "utf8"));
  const huntersRows = Array.isArray(huntersRaw) ? huntersRaw : Object.values(huntersRaw);
  const committedPortraits = huntersRows.map((row) => row.portrait).filter(Boolean);

  const hunters = diffMembership({ listed: listedPortraits, committed: committedPortraits });
  if (hunters.added.length || hunters.removed.length) drift = true;
  log({ level: "info", event: "tier1-roster", listed: hunters.listedCount, committed: hunters.committedCount });

  return {
    dryRun: false,
    fetches: budgeted.spent(),
    budget: TIER1_FETCH_BUDGET,
    urls: budgeted.urls(),
    categories,
    hunters,
    drift,
  };
}

/** The human-facing report. Drift is listed page by page, never merely counted. */
export function formatRosterReport(report) {
  const lines = [];
  if (report.dryRun) {
    lines.push(`tier 1 dry run — ${report.urls.length} page(s) would be fetched, none were:`);
    for (const url of report.urls) lines.push(`  ${url}`);
    return lines.join("\n");
  }

  lines.push(`tier 1 roster check — ${report.fetches}/${report.budget} fetches spent`);
  lines.push("");

  const rows = [
    ...Object.entries(report.categories).map(([name, d]) => [name, d]),
    ...(report.hunters ? [["hunters", report.hunters]] : []),
  ];

  lines.push("| category    | wiki | committed | added | removed |");
  lines.push("|-------------|------|-----------|-------|---------|");
  for (const [name, d] of rows) {
    lines.push(
      `| ${name.padEnd(11)} | ${String(d.listedCount).padStart(4)} | ${String(d.committedCount).padStart(9)} | ` +
        `${String(d.added.length).padStart(5)} | ${String(d.removed.length).padStart(7)} |`
    );
  }

  // Listed rather than counted, on the same rule the discovery report follows: a count tells you
  // something moved, and the whole point of the cheap tier is to say WHAT so a human can decide
  // whether the expensive tier is worth running.
  for (const [name, d] of rows) {
    if (!d.added.length && !d.removed.length) continue;
    lines.push("");
    lines.push(`${name}:`);
    for (const page of d.added) lines.push(`  + ${page}   (on the wiki, not in our data)`);
    for (const page of d.removed) lines.push(`  - ${page}   (in our data, no longer listed)`);
  }

  lines.push("");
  lines.push(
    report.drift
      ? "ROSTER MOVED. Run tier 2 (the per-page revision sweep) to pick up content changes too, then re-scrape."
      : "No roster drift. Content drift is invisible to tier 1 — a balance patch moves prices, not membership."
  );
  return lines.join("\n");
}

function parseArgs(argv) {
  const options = { dryRun: false, json: false };
  for (const arg of argv) {
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    console.error("usage: node scripts/check-drift.mjs [--dry-run] [--json]");
    process.exit(2);
  }
  if (options.help) {
    console.log("usage: node scripts/check-drift.mjs [--dry-run] [--json]");
    console.log("  Tier 1 roster-drift check (ADR-0016). Seven fetches. Exit 1 if the roster moved.");
    return;
  }

  let report;
  try {
    report = await runRosterCheck(options);
  } catch (err) {
    console.error(`tier 1 check failed: ${err.message}`);
    process.exit(2);
  }

  console.log(options.json ? JSON.stringify(report, null, 2) : formatRosterReport(report));
  process.exit(report.drift ? 1 : 0);
}

// Only when run directly, so importing this module for tests costs nothing.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
