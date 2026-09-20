// Governing: ADR-0016 Confirmations 1, 2, 4 and 5; issue #534.
//
// Confirmation 5: "npm test covers 1-4 offline against fixtures, consistent with ADR-0005's posture
// that the app and its tests never call the wiki." Nothing here opens a socket — every fetch is a
// stub, and the robots fixture is committed.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  NetworkFailureError,
  RateLimitedError,
  assertNotRateLimited,
  isAllowedByRobots,
  parseRobotsTxt,
  fetchRobotsTxt,
} from "./lib/wiki.mjs";
import { scrapeItemStats } from "./scrape-stats.mjs";
import {
  FetchBudgetExceededError,
  TIER1_FETCH_BUDGET,
  budgetedFetch,
  diffMembership,
  formatRosterReport,
  runRosterCheck,
} from "./check-drift.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROBOTS_FIXTURE = fs.readFileSync(path.join(HERE, "fixtures", "robots.txt"), "utf8");

/** The throttled response ADR-0016 documents: HTTP 200, JSON error body. */
const RATE_LIMITED_BODY = JSON.stringify({ error: { code: "ratelimited", info: "you are doing that too often" } });

const ok = (body) => ({ ok: true, status: 200, text: async () => body });

// node:assert's throws/rejects resolve to undefined rather than handing back the error, and several
// assertions below are about WHICH error came out. These capture it.
function caught(fn) {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return assert.fail("expected the call to throw, and it did not");
}

async function caughtAsync(fn) {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  return assert.fail("expected the call to reject, and it did not");
}

// A no-op limiter: the real one sleeps 1500 ms per request, which would make this suite take a
// quarter of a minute to assert something that has nothing to do with pacing.
const noWait = { wait: async () => {} };

// ---------------------------------------------------------------------------
// Confirmation 1 — "A test asserts the robots gate covers the access mode."
// ---------------------------------------------------------------------------

describe("ADR-0016 Confirmation 1: the robots gate covers the access mode", () => {
  const groups = parseRobotsTxt(ROBOTS_FIXTURE);
  const UA = "BackwaterOutfittersScrapeBot/1.0";

  // The four paths ADR-0016 names. These are the cheap signals the ADR wanted and had to give up:
  // this test is the one that would have caught the API being off-limits BEFORE it was designed
  // around, which is the mistake the ADR records having nearly made in the opposite direction.
  for (const blocked of ["/api.php", "/api.php?action=query", "/rest.php", "/wiki/Special:RecentChanges"]) {
    it(`disallows ${blocked}`, () => {
      assert.equal(isAllowedByRobots(groups, UA, blocked), false);
    });
  }

  for (const allowed of ["/wiki/Weapons/Sparks_LRR", "/wiki/Category:Weapons", "/wiki/Hunters"]) {
    it(`allows ${allowed}`, () => {
      assert.equal(isAllowedByRobots(groups, UA, allowed), true);
    });
  }

  it("parses the fixture into more than one User-agent group", () => {
    // The merge in selectRobotsRules exists because wiki.gg publishes a Cloudflare `*` block with
    // only `Allow: /` ahead of its own `*` block with ~99 Disallow rules. A fixture that collapsed
    // to one group would silently stop exercising that, and the gate would pass by accident.
    assert.ok(groups.length > 1, `expected several groups, got ${groups.length}`);
  });

  it("still carries every disallow this decision rests on", () => {
    // Guards the fixture itself. ADR-0016's "Revisit when" names a robots.txt change as a trigger to
    // re-open the decision, so this failing is a signal to re-read the ADR, not to edit the fixture.
    for (const rule of ["/api.php", "/rest.php", "/*?action=", "/wiki/Special:"]) {
      assert.ok(ROBOTS_FIXTURE.includes(`Disallow: ${rule}`), `fixture no longer disallows ${rule}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Confirmation 2 — "Rate limiting is asserted on content, not status."
// ---------------------------------------------------------------------------

describe("ADR-0016 Confirmation 2: rate limiting is asserted on content, not status", () => {
  it("throws on the documented HTTP-200 ratelimited body", () => {
    assert.throws(() => assertNotRateLimited(RATE_LIMITED_BODY, { url: "u" }), RateLimitedError);
  });

  it("throws even when the envelope is preceded by whitespace", () => {
    assert.throws(() => assertNotRateLimited(`\n  ${RATE_LIMITED_BODY}`, { url: "u" }), RateLimitedError);
  });

  it("classifies a non-ratelimited envelope as a network failure, not a rate limit", () => {
    const err = caught(() => assertNotRateLimited(JSON.stringify({ error: { code: "toomanyvalues" } }), { url: "u" }));
    assert.ok(err instanceof NetworkFailureError);
    assert.ok(!(err instanceof RateLimitedError));
  });

  it("keeps RateLimitedError catchable as a NetworkFailureError", () => {
    // Deliberate subclassing: existing handlers that already distinguish transport from parse
    // failures must keep working without being taught about a new sibling.
    const err = caught(() => assertNotRateLimited(RATE_LIMITED_BODY, { url: "u" }));
    assert.ok(err instanceof NetworkFailureError);
  });

  it("lets a normal HTML page through untouched", () => {
    assert.doesNotThrow(() => assertNotRateLimited("<!DOCTYPE html><html><body>ok</body></html>", { url: "u" }));
    assert.doesNotThrow(() => assertNotRateLimited("\n <html>ok</html>", { url: "u" }));
  });

  it("ignores a body that opens like JSON but is not, and JSON with no error key", () => {
    assert.doesNotThrow(() => assertNotRateLimited("{not json", { url: "u" }));
    assert.doesNotThrow(() => assertNotRateLimited(JSON.stringify({ ok: true }), { url: "u" }));
  });

  // The wiring, not just the helper. A guard nobody calls is the bug it was written to prevent.
  it("fires at the item-page site in scrapeItemStats, as a rate limit rather than a missing infobox", async () => {
    const err = await caughtAsync(() =>
      scrapeItemStats(
        { category: "weapons", id: "sparks-lrr", name: "Sparks LRR", wikiPath: "Weapons/Sparks_LRR" },
        {
          fetchFn: async () => ok(RATE_LIMITED_BODY),
          rateLimiter: noWait,
          robotsGroups: parseRobotsTxt(ROBOTS_FIXTURE),
        }
      )
    );
    assert.ok(err instanceof RateLimitedError, `expected RateLimitedError, got ${err.constructor.name}`);
    // The whole point: unguarded this is InfoboxNotFoundError, which sends the reader after the
    // page instead of after the pacing.
    assert.match(err.message, /rate-limited/);
  });

  it("fires at the robots.txt fetch, so a throttled robots.txt cannot read as allow-all", async () => {
    await assert.rejects(
      () => fetchRobotsTxt(async () => ok(RATE_LIMITED_BODY), "UA"),
      (err) => err instanceof RateLimitedError
    );
  });
});

// ---------------------------------------------------------------------------
// Confirmation 4 — "Tier 1 is asserted to be tier 1."
// ---------------------------------------------------------------------------

const CATEGORY_HTML = (pages) =>
  `<html><body><div id="mw-pages">${pages
    .map((p) => `<a href="/wiki/${p.replace(/ /g, "_")}" title="${p}">${p}</a>`)
    .join("")}</div></body></html>`;

const ROSTER_HTML = (entries) =>
  `<html><body>${entries
    .map(
      ({ page, label, file }) =>
        `<li class="gallerybox"><img src="/images/thumb/${file}/120px-${file}">` +
        `<div class="gallerytext"><a href="/wiki/${page}" title="${label}">${label}</a></div></li>`
    )
    .join("")}</body></html>`;

/** Serve a category index or the roster by URL, and count every request. */
function fixtureWiki({ categoryPages = [], rosterEntries = [] } = {}) {
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith("/wiki/Hunters")) return ok(ROSTER_HTML(rosterEntries));
    return ok(CATEGORY_HTML(categoryPages));
  };
  return { fetchFn, calls };
}

describe("ADR-0016 Confirmation 4: tier 1 is tier 1", () => {
  it("derives its budget as the ADR's literal 7", () => {
    // The budget is computed from CATEGORY_INDEX so adding an index moves it. If that ever makes it
    // disagree with the ADR, the ADR is the thing to revisit — hence asserting the literal here.
    assert.equal(TIER1_FETCH_BUDGET, 7);
  });

  it("issues exactly 7 fetches and never touches an item page", async () => {
    const { fetchFn, calls } = fixtureWiki({
      categoryPages: ["Weapons/Sparks LRR"],
      rosterEntries: [{ page: "Hunters/The_Revenant", label: "The Revenant", file: "Hunter_The_Revenant.png" }],
    });

    await runRosterCheck(
      {},
      { fetchFn, robotsGroups: parseRobotsTxt(ROBOTS_FIXTURE), rateLimiter: noWait, log: () => {},
        collectItems: () => [{ wikiPath: "Weapons/Sparks LRR" }],
        readFile: async () => JSON.stringify([{ portrait: "the-revenant" }]) }
    );

    assert.equal(calls.length, 7, `tier 1 spent ${calls.length} fetches:\n${calls.join("\n")}`);
    const indexOrRoster = (u) => /\/wiki\/Category(%3A|:)/.test(u) || u.endsWith("/wiki/Hunters");
    for (const url of calls) {
      assert.ok(indexOrRoster(url), `tier 1 fetched a non-index page, which belongs in tier 2: ${url}`);
    }
  });

  it("refuses to spend an eighth fetch even if the code asks for one", () => {
    // Enforced in production, not only in CI: a scheduled job is exactly where a regression would
    // otherwise run unobserved against someone else's infrastructure.
    const budgeted = budgetedFetch(async () => ok("<html></html>"), 2);
    budgeted("a");
    budgeted("b");
    assert.throws(() => budgeted("c"), FetchBudgetExceededError);
  });

  it("fetches nothing under --dry-run", async () => {
    const { fetchFn, calls } = fixtureWiki();
    const report = await runRosterCheck({ dryRun: true }, { fetchFn, log: () => {} });
    assert.equal(calls.length, 0);
    assert.equal(report.urls.length, 7);
  });

  it("fails closed when the throttled index would otherwise read as an empty category", async () => {
    // Without the Confirmation 2 guard this reports "the wiki deleted every weapon", which is drift
    // a human would act on.
    await assert.rejects(
      () =>
        runRosterCheck(
          {},
          {
            fetchFn: async () => ok(RATE_LIMITED_BODY),
            robotsGroups: parseRobotsTxt(ROBOTS_FIXTURE),
            rateLimiter: noWait,
            log: () => {},
          }
        ),
      (err) => err instanceof RateLimitedError
    );
  });
});

// ---------------------------------------------------------------------------
// The membership diff itself.
// ---------------------------------------------------------------------------

describe("tier 1 membership diff", () => {
  it("reports a page the wiki lists and we do not as added", () => {
    const d = diffMembership({ listed: ["Weapons/New Gun", "Weapons/Sparks LRR"], committed: ["Weapons/Sparks LRR"] });
    assert.deepEqual(d.added, ["Weapons/New Gun"]);
    assert.deepEqual(d.removed, []);
  });

  it("reports a page we carry and the wiki no longer lists as removed", () => {
    const d = diffMembership({ listed: ["Weapons/Sparks LRR"], committed: ["Weapons/Sparks LRR", "Weapons/Gone"] });
    assert.deepEqual(d.removed, ["Weapons/Gone"]);
    assert.deepEqual(d.added, []);
  });

  it("matches across the wiki's underscore and space spellings", () => {
    const d = diffMembership({ listed: ["Weapons/Sparks_LRR"], committed: ["Weapons/Sparks LRR"] });
    assert.deepEqual(d.added, []);
    assert.deepEqual(d.removed, []);
  });

  it("suppresses a known tombstone from added, so a settled decision is not re-litigated", () => {
    // Electric Lamp was removed from the game in Update 2.0 and deliberately dropped from TOOLS.
    // The wiki still lists its page, so without this it is permanent, unactionable drift.
    const d = diffMembership({ listed: ["Tools/Electric Lamp"], committed: [] });
    assert.deepEqual(d.added, []);
  });

  it("does not suppress a tombstone from removed", () => {
    const d = diffMembership({ listed: [], committed: ["Tools/Electric Lamp"] });
    assert.deepEqual(d.removed, ["Tools/Electric Lamp"]);
  });
});

describe("tier 1 roster join and reporting", () => {
  it("joins the gallery to the dataset on the portrait slug, not the page path", async () => {
    // Bad_Hand is a redirect title for The Revenant's page. Joining on page path would report a
    // hunter we already carry as both added and removed; joining on the portrait file does not.
    const { fetchFn } = fixtureWiki({
      categoryPages: [],
      rosterEntries: [{ page: "Hunters/Bad_Hand", label: "The Revenant", file: "Hunter_The_Revenant.png" }],
    });
    const report = await runRosterCheck(
      {},
      {
        fetchFn,
        robotsGroups: parseRobotsTxt(ROBOTS_FIXTURE),
        rateLimiter: noWait,
        log: () => {},
        collectItems: () => [],
        readFile: async () => JSON.stringify([{ portrait: "the-revenant" }]),
      }
    );
    assert.deepEqual(report.hunters.added, []);
    assert.deepEqual(report.hunters.removed, []);
  });

  it("flags a new hunter and sets the drift flag", async () => {
    const { fetchFn } = fixtureWiki({
      rosterEntries: [
        { page: "Hunters/The_Revenant", label: "The Revenant", file: "Hunter_The_Revenant.png" },
        { page: "Hunters/The_New_One", label: "The New One", file: "Hunter_The_New_One.png" },
      ],
    });
    const report = await runRosterCheck(
      {},
      {
        fetchFn,
        robotsGroups: parseRobotsTxt(ROBOTS_FIXTURE),
        rateLimiter: noWait,
        log: () => {},
        collectItems: () => [],
        readFile: async () => JSON.stringify([{ portrait: "the-revenant" }]),
      }
    );
    assert.deepEqual(report.hunters.added, ["the-new-one"]);
    assert.equal(report.drift, true);
    // Listed, not merely counted: the cheap tier's whole job is saying WHAT moved.
    assert.match(formatRosterReport(report), /\+ the-new-one/);
  });

  it("reports no drift, and says content drift is still invisible, when membership matches", async () => {
    const { fetchFn } = fixtureWiki({
      rosterEntries: [{ page: "Hunters/The_Revenant", label: "The Revenant", file: "Hunter_The_Revenant.png" }],
    });
    const report = await runRosterCheck(
      {},
      {
        fetchFn,
        robotsGroups: parseRobotsTxt(ROBOTS_FIXTURE),
        rateLimiter: noWait,
        log: () => {},
        collectItems: () => [],
        readFile: async () => JSON.stringify([{ portrait: "the-revenant" }]),
      }
    );
    assert.equal(report.hunters.added.length, 0);
    assert.match(formatRosterReport(report), /balance patch moves prices, not membership/);
  });
});
