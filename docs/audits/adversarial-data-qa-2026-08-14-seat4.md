# Adversarial Data QA — Round 1 filing, Seat 4

**Charge:** the hunter roster (`data/hunters.json`, 242 entries) and the five image trees under
`client/public/images/`.
**Date:** 2026-08-14
**Reviewer:** Seat 4 (independent; no other seat's filing was read)

---

## Method and its limits

### Was the wiki reachable? **No.**

```
$ curl -sS -o /dev/null -w '%{http_code}\n' https://huntshowdown.wiki.gg/wiki/Nagant_M1895
curl: (56) CONNECT tunnel failed, response 403
```

The repo root (`/`) and the MediaWiki API endpoint were tried as well; all three answer `403` at
`CONNECT`. **I was in the blocked case for the entire review.** Consequently:

- I have made **no claim about any Hunt: Showdown game fact** — not a hunter's provenance, not which
  DLC or event anything shipped in, not whether a hunter is still obtainable. Nothing in this filing
  requires you to trust my recall of the game, and nothing in it should be read as asserting one.
- Every finding below is a disagreement **between the app's own artifacts**, or between an artifact
  and a rule the repo states about itself. That is what the blocked case permits and it is the
  entire evidentiary basis here.
- The one place where the wiki would have changed a verdict is marked inline as `[UNVERIFIED]`.

### Baseline

`npm test` at the repo root **does not run** in this environment:

```
$ npm test
> npm run test -w client && ...
sh: 1: vitest: not found      # npm error code 127
```

The binary is present at `node_modules/.bin/vitest`; the workspace script does not resolve it. I ran
the three suites directly instead:

| Suite | Command | Result |
|---|---|---|
| client | `client/ $ ../node_modules/.bin/vitest run` | **33 files, 759 tests, all pass** |
| scrape | `node --test scripts/*.test.mjs` | **321 tests, all pass** |
| server | `server/ $ ../node_modules/.bin/vitest run` | **4 files failed, 94/162 tests failed** |
| server | same, `--no-file-parallelism`, fresh `OUTFITTER_DB_FILE` | **161 pass, 1 skipped** |

The server failure is a **test-harness artifact, not a data defect**: all seven server test files
share one JSON db file and vitest runs files in parallel, so a shorter write lands inside a longer
one and leaves trailing garbage (`SyntaxError: Unexpected non-whitespace character after JSON at
position 329`). It reproduces on a clean tree and clears entirely when the files are serialised. I
treated the serial run as my baseline. See Handoffs.

### What I actually did

Everything in the Findings and Negative-result sections is scripted and rerunnable, not eyeballed.
The three scripts are reproduced inline where they matter. In outline:

1. **Roster field census.** Every one of the 242 records, every field: key-set uniformity, value
   domains, null/empty detection, duplicate detection on `id` / `name` / `portrait` / `description`.
2. **Acquisition re-derivation.** Re-ran the scraper's own `normaliseAcquisition()` and
   `deriveObtainable()` (imported live from `scripts/scrape-hunters.mjs`) over all 242 stored
   `source` strings and diffed against the stored `acquisition` / `obtainable`. This checks the
   generated file against the generator without running the scraper or touching the network.
3. **Image cross-reference, both directions, all five trees.** Catalog items → expected path through
   the **real** `slugify()` imported from `client/src/utils/slugify.js`; and on-disk files → back to
   the row that claims them. Plus slug-collision detection per category, magic-byte validation on all
   498 files, and a size sweep.
4. **Prose sweep** over all 242 descriptions for the defect classes `itemStats.test.js` pins on the
   *item* side (space-before-punctuation, mojibake, wiki markup, hatnotes, truncation, entities).
5. **Favorites lifecycle**, exercised against the real Express router with `supertest`.

### Limits a reader should hold against this filing

- **I cannot tell you whether any hunter's `source` string is what the wiki says today.** The
  `source` field is stored verbatim and I have no oracle for it. If the wiki renamed an event, or a
  hunter's Source row changed, this review cannot see it. Every `acquisition` in the dataset is
  *internally consistent* with its stored `source`; whether that `source` is current is unknown.
- **`sourceRevision` cannot be validated.** Values span 6290–16307. Those are per-page MediaWiki
  revision ids, so a low number means "this page has not been edited in a long time", not "this
  entry is stale" — the two are indistinguishable without the wiki. I did confirm `ingestedAt` is a
  single value across all 242 (`2026-08-11T00:15:01.470Z`), so there is no stale *corner*: the whole
  file is one scrape run.
- **Image *content* is unverified.** I checked that every referenced file exists, is non-trivial in
  size, and carries correct magic bytes. I did not and cannot check that `nagant-m1895.png` depicts a
  Nagant M1895. A correctly-named file showing the wrong gun is invisible to this review.
- **I did not run the scrapers**, per the brief. Every statement about scraper behaviour is read off
  the source or exercised through its exported pure functions.
- **Read-only.** The working tree is unmodified apart from this file; verified with `git status`.

---

## Findings

Seven findings. **None is P0 or P1** — my two surfaces carry no arithmetic, so they cannot make the
app's cost or capacity math disagree with the game. I want to say that plainly rather than inflate
severity to make the seat look productive. The wrongness available here is wrong *presentation* and
*unpinned rot*, and that is what these are graded as.

---

### F4-1 — A favorite whose hunter leaves the roster can never be deleted — P2 — CONFIRMED

**Where:** `server/src/routes/hunterFavorites.js:168` (DELETE handler), `:52-65`
(`assertKnownHunter`), `:101-110` (GET handler).

**Evidence.** `PUT /:hunterId` and `DELETE /:hunterId` both call `assertKnownHunter`, which rejects
any id absent from `data/hunters.json` with a 400. `GET /` does not validate at all. The three
behaviours together make a stored favorite for a departed hunter permanently unreachable *and*
permanently undeletable. Executable repro, run against the real router:

```js
// scratchpad/fav.mjs — express + the real hunterFavoritesRouter + supertest
r = await auth(request(app).put('/api/hunter-favorites/the-foxhound'));      // 201
r = await auth(request(app).delete('/api/hunter-favorites/the-foxhound'));   // 204  (normal path)

// the post-rescrape state: a stored favorite for an id the roster no longer carries
db.data.hunterFavorites.push({ id: '1111…', owner: TOKEN, hunterId: 'retired-hunter-slug', … });
await db.write();
```
```
GET                -> 200 ids: [ 'retired-hunter-slug' ]
DELETE stale       -> 400 {"error":"unknown hunter"}   <<<< cannot remove
GET after DELETE   -> 200 ids: [ 'retired-hunter-slug' ]
```

**Player-facing consequence.** The record is invisible and immortal. No tile renders for it —
`filterHunters` (`client/src/data/hunters.js:192-209`) matches over `HUNTERS`, which no longer
contains the id — so the user cannot click the star that would issue the DELETE. Even if they could,
it 400s. Meanwhile the id still counts:

- `client/src/store/hunterFavoritesSlice.js:84` sets `state.ids` to the server's raw response with no
  filtering against `HUNTERS`, so the stale id enters client state.
- `HunterPicker.jsx:167` seeds `favoritesOnly` from `favoritesOnlyDefault(favored.size)` — a raw
  count. Enough stale ids and the picker opens pre-filtered to a Favorites section smaller than the
  count that triggered it.
- `HunterPicker.jsx:190`, `const noFavorites = favored.size === 0`, is the guard that implements
  `hunters.js:211-213`'s promise that "an empty favorites set is not an empty picker". A set of
  *only* stale ids has `size > 0`, so it takes the split path, both sections come back empty, and
  the picker renders **zero tiles** — the exact state that comment exists to prevent, reached
  through a door it does not cover. Recoverable by unchecking the box, which is why this is P2 and
  not higher.

**Not live today.** Every stored favorite necessarily references a current hunter, because PUT
validates. This becomes reachable the moment a re-scrape drops or re-keys a hunter. Note that the
id is portrait-derived (`scrape-hunters.mjs:1024-1025`), so a wiki *media file* rename — not a
hunter's removal — is enough to re-key an entry and orphan every favorite pointing at it.

**Fix direction.** The asymmetry is the bug, and the file's own comment (`:48-50`) argues for it
one-directionally: "a favorite has no reason to exist for a hunter the picker can never show, so an
unknown id is rejected rather than stored." That reasoning justifies validating **PUT**. It argues
the opposite for **DELETE** — removing a favorite the picker can never show is exactly what the
caller should be allowed to do. Drop the roster check from DELETE (keep the length cap), and decide
separately whether GET should filter unknown ids or the client should intersect `ids` with `HUNTERS`
before computing `favored.size`. One of those two is needed regardless, or the threshold keeps
counting hunters that do not exist.

---

### F4-2 — One hunter is misfiled in the picker grid, splitting a two-variant family by 171 tiles — P2 — CONFIRMED

**Where:** `data/hunters.json` entries `desolations-delegate` (index 37) and `the-statesman`
(index 208). Mechanism at `scripts/scrape-hunters.mjs:1024-1025` and `:1311`.

**Evidence.** The dataset is sorted by `id`, not by `name`:

```
scrape-hunters.mjs:1311   allEntries.sort((a, b) => a.id.localeCompare(b.id));
```

and `id` is derived from the **wiki media filename**, not the display name:

```
scrape-hunters.mjs:1024   const derivedId = portrait || slugify(name);
scrape-hunters.mjs:1025   const id = (portrait && idsByPortrait.get(portrait)) || derivedId;
```

For 239 of 242 entries `id === slugify(name)`, so id-order and name-order coincide. Three diverge:

| id | name |
|---|---|
| `desolations-delegate` | `The Statesman: Desolation's Delegate` |
| `union-suit-red` | `Union Suit: Red Drawers` |
| `union-suit-white` | `Union Suit: Sunday Best` |

The two Union Suit rows happen to stay in the right place (`red` < `white` matches
`Red Drawers` < `Sunday Best`). The third does not. Its neighbours in render order:

```
    desert-rose-dust-devil    "Desert Rose: Dust Devil"
>>> desolations-delegate      "The Statesman: Desolation's Delegate"
    devils-advocate           "Devil's Advocate"
```

**78 hunters have names beginning `The `. 77 of them have ids beginning `the-`.** This is the only
one that does not, and it is therefore the only tile out of alphabetical position in the entire grid.
A family-contiguity check over all 71 variant families finds exactly one non-contiguous family:

```
base="The Statesman" spread 37 -> 208
  [[37,"desolations-delegate","The Statesman: Desolation's Delegate"],
   [208,"the-statesman","The Statesman"]]
```

**Player-facing consequence.** The picker renders dataset order —
`client/src/data/hunters.js:139-140`, "relative order is the dataset's own" — into a 242-tile grid
whose only other navigation aid is a free-text name filter. `hunter-loadout-lists/design.md:189`
calls that grid "the alphabetical roster" and reasons about "where the alphabet resumes";
`design.md:197` weighs "the alphabetical completeness it preserves". The design's own model of this
control is alphabetical-by-display-name, and for this one hunter it is false. A user scanning for
"The Statesman" finds one variant under T and must already know to look under D for the other.

**Note on culpability.** The id/name divergence is **spec-sanctioned, not a bug**:
`hunter-roster-dataset/spec.md:90-92` requires that a renamed hunter "SHALL keep its original `id`
and update only its `name`". Portrait-derived ids are the right call and the comment at
`scrape-hunters.mjs:1023` says why. The defect is that a *consumer* treats id-order as name-order.
This will get monotonically worse as hunters are renamed, and each new divergence is silent.

**Fix direction.** Do not touch the ids — that would break stored `hunterId` references and violate
the spec scenario above. Sort at the consumption seam instead: have the picker order by
`name.localeCompare(name)` rather than inheriting file order, or have `hunters.js` export a
name-ordered view. Either makes the grid's order a property of the display name, which is what the
design already assumes. A test asserting `HUNTERS` is name-ordered would then pin it.

---

### F4-3 — 26 hunter descriptions carry stray whitespace before punctuation; the item scraper fixes this exact defect and the hunter scraper does not — P2 — CONFIRMED

**Where:** `scripts/scrape-hunters.mjs:220-231` (`stripTags`), versus
`scripts/scrape-stats.mjs:1011-1021` (`tidyProse`) and `client/src/data/itemStats.test.js:161`.

**Evidence.** Both scrapers replace every tag with a space, which mangles prose that links mid
sentence. The item scraper noticed and fixed it:

```js
// scrape-stats.mjs:1011-1018
/**
 * Close the gap an inline link leaves before punctuation.
 * … `restored by <a>First Aid Kit</a>.` reads back as "restored by First Aid Kit ." …
 */
function tidyProse(text) {
  return text.replace(/\s+([,;:.!?%])/g, "$1").trim();
}
```

and pinned it across the whole item dataset:

```js
// itemStats.test.js:161-166
it("never leaves a space before punctuation from an inline link", () => {
  const offenders = Object.keys(ITEM_STATS).filter((k) => /\s[,;:.!?]/.test(…));
  expect(offenders).toEqual([]);
});
```

The hunter scraper's `stripTags` ends at `.replace(/\s+/g," ").trim()` with no equivalent, and no
test applies that predicate to `hunters.json`. Running the item suite's own predicate over the
roster:

```js
const offenders = H.filter(h => /\s+[,.;:!?](\s|$)/.test(h.description));  // 21
const possessive = H.filter(h => /\s['’]s\b/.test(h.description));         // 5
```

**26 of 242 descriptions are affected.** Samples, each verifiable at the cited id:

```
the-foxhound      "…sought out a pair of legendary trappers , he learned…"
the-reverend      "…tear each other apart in Stillwater Bayou . Barely escaping…"
the-scarecrow     "Caught stealing from Golden Acres , Jeremy Albano was beaten…"
marian-lee        "…the fallen AHA , originally an informer for Elwood Finch . "
the-hanged-man    "…witches and gardens . Tents and trials . The drawing of…"
monroe            "…compared to what he experienced at Huff 's hands."
the-night-mother  "…to stand by her dear Weird Sister ’s side."
```

Note `marian-lee` also ends with a trailing space that survived `.trim()` because the space precedes
the final `.` rather than following it.

**Related, same root, 3 more rows.** A character sweep of all 242 descriptions found no mojibake and
no wiki markup — the text is clean UTF-8 — but three instances of `U+00B4 ACUTE ACCENT` standing in
for an apostrophe, in `luna-wolf` ("her son´s footsteps") and `mama-maye` ("you´ll", "don´t"). That
is faithful to the wiki and arguably correct for a verbatim scrape; I record it here rather than as
its own finding because the remedy is the same normalisation pass.

**Player-facing consequence.** These strings render. `descriptionOf` at
`client/src/components/LoadoutListsPanel/LoadoutListsPanel.jsx:885-888` returns the hunter's
description, and a list with no stored description inherits it as its displayed body text. So a
user who names a list after The Reverend reads "…in Stillwater Bayou . Barely escaping…" on the card.

**Fix direction.** This is a scraper fix and a re-scrape, never a hand-edit of the generated file
(the file carries the do-not-hand-edit contract). `tidyProse` is already written, tested, and lives
one directory away; the two scrapers already share `scripts/lib/wiki.mjs`. Move it there and apply
it on the hunter description path — **not** to `stripTags` wholesale, for the reason
`scrape-stats.mjs:1016-1018` gives: `stripTags` is shared with the infobox `Source` parse, and
loosening it there would rewrite the verbatim classification strings this dataset deliberately
preserves. Then port `itemStats.test.js:161` to run against `HUNTERS` so it cannot regress.

---

### F4-4 — The "Not obtainable" filter can never match anything, and the tests that cover it use fixtures the real dataset contradicts — P2 — CONFIRMED

**Where:** `client/src/components/HunterPicker/HunterPicker.jsx:112-116`;
`scripts/scrape-hunters.mjs:483-487` (`deriveObtainable`); `client/src/data/hunterFavorites.test.js:27`
and `client/src/components/HunterPicker/HunterPicker.test.jsx:23`.

**Evidence.** The full domain of `obtainable` across all 242 records:

```
obtainable: [ [ 'true', 240 ], [ 'null', 2 ] ]
```

**No hunter is `obtainable: false`.** The brief for this panel states that "2 are
`obtainable: false`"; the two exceptional entries (`the-foxhound`, `the-ol-cowpoke`) are
`obtainable: null`, with `source: null` and `acquisition: null`. They are the same two entries in
both respects — that half of my charge's question resolves cleanly and coherently.

`false` is producible by exactly one path:

```js
// scrape-hunters.mjs:483-487
export function deriveObtainable(acquisition) {
  if (acquisition === null) return null;
  if (acquisition === "mythic") return false;
  return true;
}
```

and `mythic` is never produced — no stored `source` string matches `/\bmythic\b/i`. Four rule values
in `ACQUISITION_RULES` (`scrape-hunters.mjs:447`) are dormant in the same way: `soul-survivor`,
`hunt-dollars`, `mythic`, `free`.

Meanwhile the picker offers the option unconditionally:

```jsx
// HunterPicker.jsx:112-116
const OBTAINABLE_OPTIONS = [
  { value: "yes", label: "Obtainable" },
  { value: "no", label: "Not obtainable" },      // <-- always empty
  { value: UNKNOWN_ACQUISITION, label: "Unknown" },
];
```

The asymmetry is the tell. The **acquisition** select twenty lines below derives its options from
the data and gates its sentinel on a computed predicate —
`{HAS_UNKNOWN_ACQUISITION && <option …>Unknown</option>}` at `:475` — precisely so a bucket with no
members is not offered. The **availability** select beside it is a hardcoded literal.

This is the brief's "a green suite is evidence about the tests" case, exactly. The filter is
thoroughly tested — `hunterFavorites.test.js:123` asserts
`filterHunters(ROSTER, { obtainable: "no" })` returns `["c"]` — against a fixture
(`hunterFavorites.test.js:27`) that invents `obtainable: false`, a value the production dataset has
never held. `HunterPicker.test.jsx:23` invents a second one, `bad-hand`. The comment at
`HunterPicker.test.jsx:13` shows the author checked that the *null* shape was live ("the two live
entries that shape do exist for") and did not apply the same check to `false`.

**Player-facing consequence.** A user selects "Not obtainable" and gets an empty picker with no
explanation. It reads as a broken filter or a failed load, because it is indistinguishable from one.

**`[UNVERIFIED]`** — whether any hunter in the game *should* be classified mythic/unobtainable is
precisely the question the blocked wiki prevents me from answering. If some hunter should be, this
is not a dead option but a **missing classification**, and the finding is worse rather than better.
I am asserting only that no row currently carries the value and that the option is therefore
unmatchable today.

**Fix direction.** Two independent halves, and both are worth doing. (a) Gate the option on the data
the way the sibling select already does — a `HAS_UNOBTAINABLE` predicate computed in `hunters.js`
alongside `HAS_UNKNOWN_ACQUISITION`, so the control stays honest whichever way the dataset moves.
(b) Separately, resolve the `[UNVERIFIED]` half against the wiki when it is reachable, since a
permanently-empty bucket is equally consistent with "correctly empty" and "the rule never fires".
Fixtures asserting values absent from the real dataset should be labelled as hypothetical, or the
predicate should be additionally asserted against `HUNTERS`.

---

### F4-5 — The 242-portrait tree is the only image tree with no on-disk coverage test — P3 — CONFIRMED

**Where:** `scripts/scrape-images.test.mjs:786-807` versus `scripts/scrape-hunters.test.mjs`.

**Evidence.** The four *item* trees are pinned by a real filesystem assertion, and it is a good one —
it reads the directory rather than a fixture, checks both directions, and its comment records the two
occasions the contract broke silently (`#157`, and `#232` renaming 18 items):

```js
// scrape-images.test.mjs:786-788
test("image coverage: every catalog row has art, and no file is orphaned", async () => {
  const { readdirSync } = await import("node:fs");
  const rows = { weapons: WEAPONS, tools: TOOLS, traits: TRAITS, consumables: CONS };
```

`rows` has four keys. **Hunters are not among them** — and hunters are 242 of the 498 committed
image files, the largest tree by count and 2.49 MB of payload. Every test in
`scrape-hunters.test.mjs` that touches the filesystem does so through an in-memory fake
(`fs.files.set('/images/hunters/…')`, e.g. `:859`, `:876`, `:990`), which exercises the scraper's
logic and says nothing about the committed artifact.

Nor does the roster's own shape test cover it. `client/src/utils/listOrdering.test.js:165-192` runs
against the real `HUNTERS` and asserts id uniqueness, non-empty `id`/`name`, presence of
`acquisition`/`obtainable`/`source`, and truthy `sourceRevision`/`ingestedAt` — genuinely useful, and
it independently corroborates several of my negative results below. It does not mention `portrait`.

**So:** nothing in the repo asserts that a hunter's `portrait` slug resolves to a file, or that a
file in `images/hunters/` is claimed by a hunter. **I checked both directions manually and both are
clean today** (see Negative result). The finding is that this cleanliness is held by nothing.

**Player-facing consequence.** None today. The exposure is that a broken portrait is *invisible*: the
ladder at `HunterPortrait.jsx:9-11` falls through to `hunterThumb`'s deterministic silhouette, which
is a legitimate design state for a hunter with no art. A missing portrait and an intentionally
art-less hunter render identically. `hunters.js:64-70` records that this already happened once at
full scale — after `#147` deleted all 242 `-thumb` files, "every tile in the picker requested a file
that no longer existed, 404'd, and fell back", and it took a human noticing to catch it.

**Fix direction.** Extend `scrape-images.test.mjs:786` to a fifth tree, or add the equivalent to
`scrape-hunters.test.mjs`, keyed on `portrait` and the `.avif` extension rather than on
`slugify(name)`. Both directions — missing and orphaned — since the roster's failure mode is a
re-scrape re-keying an entry, which produces one of each simultaneously.

---

### F4-6 — First-match rule ordering silently masks one acquisition with another; four hunters are misfiled today — P3 — CONFIRMED (with one `[UNVERIFIED]` half)

**Where:** `scripts/scrape-hunters.mjs:447-462` (`ACQUISITION_RULES`).

**Evidence.** The rule list is first-match-wins and documents that as deliberate
(`scrape-hunters.mjs:443-445`: "Order matters… the specific patterns precede the general ones"). Four
hunters have a compound `source` naming two channels, and the higher rule wins:

```
bruja-crone    source="900 Blood Bonds / Garden of the Witch Event"  acquisition="blood-bonds"
bruja-maiden   source="900 Blood Bonds / Garden of the Witch Event"  acquisition="blood-bonds"
welder-flame   source="800 Blood Bonds / Garden of the Witch Event"  acquisition="blood-bonds"
welder-torch   source="800 Blood Bonds / Garden of the Witch Event"  acquisition="blood-bonds"
```

`blood-bonds` is rule 3, `event` is rule 12, so `event` never gets a look. **"Garden of the Witch"
does not appear as a standalone source anywhere in the dataset** — these four rows are the only
mention of it — so filtering the picker to `Event` returns 50 hunters and silently omits the only
four the app knows to be associated with that event.

**Player-facing consequence.** Small but real: a user filtering by Event to find a hunter they
remember from an event will not find these four. The single-valued `acquisition` field cannot
represent "both", so this is a modelling limit surfacing as a filter gap, not a parse error.

**The `[UNVERIFIED]` half, and why it matters more than the confirmed half.** The same masking
applies to `mythic`, which sits at rule 6 — below `blood-bonds` (3), `hunt-dollars` (4) and `twitch`
(5). `mythic` is the **only** rule that changes `obtainable` (F4-4). A source reading
`"Mythic — 1000 Blood Bonds"` would classify as `blood-bonds` and `obtainable: true`, and the
unobtainability would be lost with no diagnostic. Whether any such source string exists on the wiki
today I cannot check. What I can confirm is that the *ordering* does not protect the one rule whose
misclassification has a consequence beyond a filter label.

**Fix direction.** Two separable changes. (a) Hoist `mythic` above the channel rules, since it
answers a different question ("can I still get it") from the rest ("how was it sold") and is the only
one feeding `deriveObtainable`. (b) More durably, have `normaliseAcquisition` report when a source
matches **more than one** rule, the way `formatSummary` already reports `unmappedSources`
(`scrape-hunters.mjs:1391-1394`) — the machinery for surfacing classification ambiguity at scrape
time exists and covers only the no-match case, not the multi-match case.

---

### F4-7 — Every item thumbnail costs two guaranteed 404s, and the ordering hint that exists to prevent exactly that is unreachable — P3 — CONFIRMED

**Where:** `client/src/components/ItemThumb/ItemThumb.jsx:22`, `:33`, `:63`.

**Evidence.** The extension chain tries jpg and jpeg before png:

```js
ItemThumb.jsx:22   const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];
```

A file-type census of the whole image tree:

```
242 avif   (hunters)
256 png    (weapons 147, traits 58, consumables 30, tools 21)
```

**Every single item image is a png**; there is not one jpg, jpeg, or webp in the repo. So each
distinct item thumbnail issues two failing requests before it succeeds — 512 across a full catalog
render, 294 for the weapons picker tab alone.

The file already knows this is the wrong trade. `EXTENSIONS_BY_CATEGORY` was introduced for exactly
this reason, and its comment (`:28-32`) argues that "a shared chain would cost either one wasted
request per item image (avif first) or several per portrait (avif last). **Neither is acceptable at
roster scale**". The principle is right and it is applied to hunters and withheld from items, where
the cost is two per image rather than one.

Second half: the `hunters` entry in that table is **unreachable in production**.

```js
ItemThumb.jsx:33   const EXTENSIONS_BY_CATEGORY = { hunters: ["avif"] };
ItemThumb.jsx:63   if (sources) return sources;      // <-- returns before extensionsFor() is consulted
```

`HunterPortrait` is the only hunter call site and always passes `sources`
(`HunterPortrait.jsx:55-62`), so `extensionsFor("hunters")` is never called on any real path. The
justification comment describes traffic that cannot occur.

**Player-facing consequence.** Slow tiles and a noisy console, not a wrong number — hence P3. It is
in this seat's charge because it is **the mechanism that hides F4-5 and the whole no-manifest
hazard**: when two 404s per thumbnail are the normal, healthy state, a third 404 from a genuinely
missing asset is not distinguishable from background noise by anyone watching the network tab. That
is the invisibility the fallback design trades for, made twice as opaque as it needs to be.

**Fix direction.** Reorder `IMAGE_EXTENSIONS` to put `png` first — it costs nothing, breaks nothing,
and the chain still walks the rest. Do not remove the other extensions; the whole point of the chain
(`:16-20`) is that the scrape can re-extension its output without a code change. Separately, either
route `HunterPortrait` through `category="hunters"` so the table is live, or delete the entry and its
rationale so the next reader is not misled about which path serves portraits.

---

## Negative result

Checked, and clean. Listed so the next review knows what not to redo, and so the emptiness is
auditable rather than assumed.

### The roster (242 entries)

- **Schema uniformity.** All 242 records carry an identical nine-key set
  (`acquisition, description, id, ingestedAt, name, obtainable, portrait, source, sourceRevision`).
  No record has an extra or missing key.
- **Duplicate ids: none.** 242 distinct. (Independently pinned by `listOrdering.test.js:175`.)
- **Duplicate names: none.** 242 distinct.
- **Duplicate portraits: none.** 242 distinct.
- **Duplicate descriptions: none** — no copy-paste between variants of the same hunter, which was
  the plausible failure given 71 colon-variant entries.
- **No same-hunter-under-a-renamed-edition pairs.** I checked for this specifically. The two Union
  Suit entries and the two Statesman entries are distinct hunters with distinct portraits and
  distinct sources, not one hunter recorded twice. The Statesman pair's *ordering* is F4-2; their
  identity is fine.
- **Empty/missing fields: only the two disclosed ones.** `the-foxhound` and `the-ol-cowpoke` have
  `source: null` / `acquisition: null` / `obtainable: null`; every other field on every other record
  is present and non-empty. This matches `scrape-hunters.mjs:404-406`, which names
  `Hunters/Union_Suit` as a page with no `Source` row and requires such a hunter to appear in the
  dataset anyway rather than be dropped.
- **The two null hunters are coherently presented, both directions.** `ACQUISITIONS`
  (`hunters.js:102`) is built with `filter(Boolean)` and yields 9 values; the null pair is served by
  the `UNKNOWN_ACQUISITION` sentinel, offered in the acquisition select at `HunterPicker.jsx:475`
  behind `HAS_UNKNOWN_ACQUISITION`, and by `"Unknown"` in the availability select. **No hunter falls
  out of every bucket and becomes unreachable** — I verified that the union of all offered filter
  values selects all 242. The tile itself renders only name and portrait
  (`HunterPicker.jsx:568-600`), so a null `acquisition` displays nothing anomalous.
- **`acquisition` is 100% consistent with `source`.** I re-imported `normaliseAcquisition` from the
  scraper and re-derived all 242 from their stored `source` strings: **zero drift**. The generated
  file agrees with its generator. (This is the check that would have caught a hand-edit, and it is
  clean.)
- **`obtainable` is 100% consistent with `acquisition`** under `deriveObtainable`: zero drift.
- **`sourceRevision`** is a non-empty numeric string on all 242. Range 6290–16307.
- **`ingestedAt`** is a single value across all 242 — one scrape run, so **no stale corner exists**
  within this dataset.
- **Text quality.** No mojibake (`Ã`, `â€`, `Â`, `U+FFFD`), no wiki markup (`[[`, `{{`, tags, named
  or numeric entities), no `[1]`-style reference markers, no See-also hatnotes, no embedded newlines,
  no tabs, no non-breaking spaces, no leading/trailing whitespace on `name`, no double spaces. All
  non-ASCII characters are legitimate typography (`’ – — “ ” î á ñ ç é …`). Description lengths run
  162–404 chars, median 257. The 26 punctuation-spacing rows are F4-3; the acute-accent rows are
  folded into it.
- **The comment at `server/src/lib/descriptions.js:16` is true.** It claims "the hunters dataset's
  longest description is 404 ('The Night Seer')" as the floor justifying `DESCRIPTION_MAX_CHARS`.
  Measured: max is 404, and it is `The Night Seer`. Exact. Next longest is `Zhong Kui` at 323.

### The image trees (498 files)

The headline for this seat's charge: **the enumeration of items running on the SVG fallback is
empty.** Not "short" — empty, in all five trees, in both directions.

| Tree | Rows | Files | Missing (on fallback) | Orphaned files | Slug collisions |
|---|---|---|---|---|---|
| weapons | 147 | 147 | **0** | **0** | **0** |
| tools | 21 | 21 | **0** | **0** | **0** |
| consumables | 30 | 30 | **0** | **0** | **0** |
| traits | 58 | 58 | **0** | **0** | **0** |
| hunters | 242 | 242 | **0** | **0** | **0** |

- Item paths were computed through the **real** `slugify()` imported from
  `client/src/utils/slugify.js` — the same module `ItemThumb` and `scripts/lib/wiki.mjs` use — not a
  reimplementation. This is the check that would catch issue #119's apostrophe/diacritic drift class,
  and it is clean.
- **No two display names in any category slugify to the same path.** Each category's item count
  equals its distinct-stem count exactly (147/147, 21/21, 30/30, 58/58).
- **Hunter portraits** were cross-referenced on the stored `portrait` slug (the field
  `portraitSources` actually reads at `hunters.js:89-91`), not on `slugify(name)`. All 242 resolve;
  all 242 files are claimed; no `.avif` file is unreferenced; no non-`.avif` file is present in the
  tree. Separately, no two hunter *display names* collide under `slugify` either.
- **`KNOWN_CATALOG_DUPLICATES` is empty** (`scripts/lib/wiki.mjs:331`), so the exemption at
  `scrape-images.test.mjs:797` that lets a row skip the coverage assertion currently exempts nothing.
  All 256 item rows are genuinely covered by that test. Worth stating because an exemption list is
  where a silently-uncovered row would hide, and this one is inert.
- **File integrity.** All 242 hunter files carry the `ftypavif` box; all 256 item files carry the PNG
  signature `89 50 4e 47`. No file anywhere under `client/public/images/` is under 200 bytes.
  Portraits run 7.6 KB–20.4 KB, median 10.5 KB, 2.49 MB total.
- **Category strings match directory names everywhere.** A mismatched category string would send an
  entire category to the fallback in one stroke, so I traced all four producers:
  `Picker.jsx:63,87,113,144` (`weapons`/`tools`/`consumables`/`traits`),
  `EquipmentSlot.jsx:157` (`entry.t === "T" ? "tools" : "consumables"`),
  `LoadoutListsPanel.jsx:156,167,176`, `WeaponSlot.jsx:44`, `TraitsPanel.jsx:44`. All correct.
- **Empty `sources` does not produce a guessed URL.** `portraitSources` returns `[]` for a hunter
  with no `portrait`, and `candidateSources` (`ItemThumb.jsx:63`) returns it unchanged — `[]` is
  truthy, so the guard behaves as its comment claims and the SVG renders with no network request.
  No hunter is in that state today, but the path is correct for when one is.

### Favorites, beyond F4-1

- PUT is correctly idempotent and validates (`201` then the existing record).
- DELETE of a *known* hunter that is not favorited returns `204`, not `404`, as
  `hunterFavorites.js:154-162` specifies.
- Ownership is enforced through the single `ownedBy` predicate with no inline restatement; a foreign
  token's favorite is invisible rather than deletable.
- A stale favorite **does not break a load**: `GET /` returns `200` and the client renders normally.
  The degradation is clean in the read path. It is only the *removal* path that fails, which is why
  F4-1 is scoped to deletion rather than filed as a load failure.

---

## Handoffs

Noticed outside my charge. Noted, **not investigated**, per Round 1 rules.

1. **`npm test` does not run at the repo root** — `sh: 1: vitest: not found`, exit 127, before any
   test executes. The binary exists at `node_modules/.bin/vitest`. Any seat reporting a green
   baseline from `npm test` did not get one. Infrastructure, not data.

2. **The server suite fails on a clean tree, and it is a harness bug, not a data bug.** All seven
   server test files share one `OUTFITTER_DB_FILE` and vitest runs files in parallel by default, so
   concurrent writes tear the JSON (`SyntaxError … at position 329`). 94/162 failed for me;
   `--no-file-parallelism` gives 161 pass / 1 skipped. Worth a real fix (per-file db path, or
   `fileParallelism: false` in the server vitest config) because it makes the suite untrustworthy in
   exactly the way this panel is meant to distrust suites. Chair may want to note that Seats testing
   server behaviour need to know this.

3. **For Seat 2 / Seat 5.** `scripts/scrape-hunters.mjs:447` declares four acquisition rule values
   the dataset never produces (`soul-survivor`, `hunt-dollars`, `mythic`, `free`). I established that
   none is currently produced (F4-4, F4-6) but did **not** examine whether SPEC-0004's stated
   acquisition vocabulary matches this rule list, or whether the spec's closed vocabulary and the
   scraper's have drifted. That comparison is a spec-conformance question and belongs to Seat 5.

4. **For Seat 5.** `hunter-loadout-lists/design.md:189/193/197` reasons about the hunter picker as
   "the alphabetical roster". F4-2 shows that description is false for one entry. I checked only the
   ordering claim; the surrounding design prose in that file may contain other claims about the
   picker worth falsifying, and ADR-conformance-against-data is Seat 5's charge.

5. **Panel-level, for the chair.** Part II of the review prompt itself states that "2 hunters …
   are `obtainable: false`". The dataset contains no `false` at all — those two entries are
   `obtainable: null` (F4-4). I flag this because the brief is a document five seats read before
   looking at the data, and a seat that took it as given would have started from a false premise. It
   is also mild independent evidence that this field is genuinely easy to misread.

6. **Acknowledged blind spot, per the prompt's "Unassigned by design".** Nothing in this review can
   see a hunter that exists in the game but was never scraped. My cross-references are all internal:
   roster ↔ files, catalog ↔ files, generated ↔ generator. A hunter absent from
   `data/hunters.json` is invisible from inside `data/hunters.json`, and I did not run
   `scrape-hunters.mjs --names-only` (or anything else that would make a live request) to find out.
   Roster *completeness* is uncovered by this seat and, as far as I can tell from the prompt, by the
   panel.
