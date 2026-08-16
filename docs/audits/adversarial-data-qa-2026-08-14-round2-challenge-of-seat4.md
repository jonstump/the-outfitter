# Adversarial Data QA — Round 2, challenge of Seat 4

**Target:** `docs/audits/adversarial-data-qa-2026-08-14-seat4.md` (hunter roster + image trees).
**Challenger:** Round 2 (did not file Seat 4's filing).
**Date:** 2026-08-14
**Procedure:** for each finding — reproduce → attack the evidence → attack the consequence → check the
correlated-recall trap. Read-only throughout; no source, data, image, test file or Seat 4's filing was
modified (`git status --porcelain` clean apart from this file).

---

## Method and its limits

### Wiki: unreachable

Independently checked; `huntshowdown.wiki.gg` answers `403` at `CONNECT`, as the chair states. **I make
no claim about any Hunt: Showdown game fact anywhere in this document.** Every verdict below rests on
disagreement between the repo's own artifacts, on code I read, or on a command I ran. Seat 4's filing is
in the same position and I have not credited it with anything the blocked case cannot support.

### Environment

- `git rev-parse --is-shallow-repository` was `true` (55 commits). I ran `git fetch --unshallow`;
  history is now complete (281 commits) and the roster-history judgement in F4-1 below is made against
  full history, not the truncated clone.
- `npm test` at the root does not run (Node v22.22.2 vs pinned `^20`; `vitest` not on PATH). I ran
  suites directly.
- **Client suite, run by me:** `client/ $ ../node_modules/.bin/vitest run` → **33 files, 759 passed**.
- **Server suite, run by me, alone, private `OUTFITTER_DB_FILE`** → **7 files, 161 passed, 1 skipped**.
- Every repro below was run with a **private db path** under my scratch directory, never against
  `server/data/db.test.json`, and never concurrently with another suite.
- I did not run any scraper.

### What I re-derived rather than accepted

Seat 4's filing is unusually scriptable, which is to its credit and also what made it attackable. I
rebuilt the three load-bearing checks from scratch rather than re-running Seat 4's code:

1. the favorites lifecycle, through the real Express router and `supertest`, with a private db;
2. the image cross-reference in both directions, through the real `slugify()` **and through the exact
   `name` prop each `ItemThumb` call site actually passes**;
3. the roster census (field domains, duplicates, generator re-derivation).

Where my numbers match Seat 4's, that is two scripts agreeing, not one restated.

---

## Verdicts at a glance

| # | Claim | Reproduced | Verdict |
|---|---|---|---|
| F4-1 | Favorite for a departed hunter is undeletable | **Yes**, exactly | **DOWNGRADED** P2 → **P3** (latent; trigger has never fired in the roster's full history) |
| F4-2 | `desolations-delegate` misfiled in the picker grid | **Yes**, exactly | **DOWNGRADED** P2 → **P3** (no UI asserts alphabetical order; the durable claim is silent future drift) |
| F4-3 | 26 hunter descriptions carry space-before-punctuation | **Yes**, 21 + 5 = 26 | **UPHELD P2** — and **PROMOTED**: independently corroborated in class by Seat 5 F9 on different data |
| F4-4 | "Not obtainable" can never match; tests use invented fixtures | **Yes**, exactly | **DOWNGRADED** P2 → **P3**; consequence sentence **STRUCK** (an explicit empty-state message exists) |
| F4-5 | Portrait tree has no on-disk coverage test | **Yes**, exactly | **UPHELD P3** |
| F4-6 | First-match rule ordering masks `event` for four rows | **Yes**, exactly | **UPHELD P3**, headline narrowed ("misfiled" overstates); one citation corrected |
| F4-7 | Two wasted requests per item thumbnail; `hunters` hint unreachable | **Yes**, mechanism | **UPHELD P3**, but the **"404" evidence is STRUCK** — in production those two responses are `200 text/html` |
| Negative result | 0 missing / 0 orphan / 0 collisions across 498 files, both directions | **Yes** — re-derived independently | **UPHELD in full**; no category was silently excluded |

Nothing in Seat 4's filing failed to reproduce. Nothing is struck in whole. Six sub-claims are struck or
corrected; they are listed together at the end.

---

## F4-1 — The undeletable favorite

### Reproduce: yes, exactly

Run in isolation, private db, real router, my own script (not Seat 4's):

```
rosterSize: 242   known the-foxhound: true   known retired-hunter-slug: false
PUT known      -> 201
GET            -> 200 [ 'the-foxhound' ]
DELETE known   -> 204
PUT unknown    -> 400 {"error":"unknown hunter"}
GET stale      -> 200 [ 'retired-hunter-slug' ]
DELETE stale   -> 400 {"error":"unknown hunter"}    <<<< cannot remove
GET after DEL  -> 200 [ 'retired-hunter-slug' ]
```

### Evidence: load-bearing, and every line citation is exact

- `server/src/routes/hunterFavorites.js:52` `assertKnownHunter`; `:101` GET (no validation); `:118` PUT
  and `:164` DELETE both call it at `:122` / `:168`. The asymmetry is real and is in the code, not
  inferred.
- `client/src/store/hunterFavoritesSlice.js:84` is exactly `state.ids = action.payload`, and
  `:23-30` shows the payload is the server's raw `hunterId` list. **No filtering against `HUNTERS`
  anywhere between the server and `favored`** — I traced it: `LoadoutListsPanel.jsx:1383`
  `useSelector((s) => s.hunterFavorites.ids)` → `:1504` `favorites={favorites}` → `HunterPicker`
  `favored = new Set(favorites)`.
- `HunterPicker.jsx:167` and `:190` are exactly the lines quoted.

### The premise the whole finding rests on: can a hunter leave the roster?

This is the question the chair asked me to settle, because if no hunter can ever leave, the finding is
about an unreachable state.

**Mechanically: yes.** `scripts/scrape-hunters.mjs:1198` seeds `idsByPortrait` from
`readExistingIds` (`:1104-1116`), which builds a **`portrait → id`** map. `:1024-1025` then does
`derivedId = portrait || slugify(name)` and `id = (portrait && idsByPortrait.get(portrait)) ||
derivedId`. So the stability map is keyed on the very field a wiki media-file rename changes: rename the
file, and the lookup misses, and the entry is re-keyed. Seat 4's claim that a *media* rename (not a
hunter's removal) suffices is correct, and it is the sharpest part of the finding. Separately,
`runScrape` writes `allEntries` wholesale, so a hunter dropped from the gallery is dropped from the file
— there is no retention of prior rows.

**Historically: it has never happened.** Full history (recovered by unshallowing) shows
`data/hunters.json` has exactly **three** commits — `5058699`, `9ae3ba7`, `1bc67cb`. Diffing them:

```
5058699 -> 9ae3ba7: dropped 0  added 0   portrait changed for a stable id: 0
9ae3ba7 -> 1bc67cb: dropped 0  added 0   portrait changed for a stable id: 0
```

242 entries at every revision, no id churn, no portrait churn. Seat 4 says "not live today"; the
stronger statement supported by the evidence is that across every scrape this repo has ever committed,
the trigger has not once fired.

### Consequence: real, but narrower than filed

I exercised the client half through the **real** `filterHunters`:

```
1 stale id, favoritesOnly=false: sections=[["roster",242]] total=242
1 stale id, favoritesOnly=true : sections=[]               total=0
11 stale ids, picker opens with default true: sections=[]  total=0
```

So the "zero tiles" state needs either the user checking the box, or **eleven or more** stale ids to
arrive on open (`FAVORITES_ONLY_DEFAULT_THRESHOLD = 10`, strictly greater, `HunterPicker.jsx:127`). With
one stale favorite and the toggle off, the picker shows all 242 — no defect visible.

And the empty state is **not silent**. `HunterPicker.jsx:530-540` renders a live count `0 of 242
hunters` plus:

> *"No hunters match those filters. Turn off “Favorites only”, clear the search or widen the filters —
> or pick “No portrait” below."*

Seat 4's "the exact state that comment exists to prevent, reached through a door it does not cover" is
rhetorically true about `filterHunters`, but the user does not meet an unexplained empty picker: they
meet an explained one that names the one-click fix. Seat 4 concedes recoverability; I am recording that
the explanation exists because their prose implies it does not.

### Verdict: **DOWNGRADED, P2 → P3. CONFIRMED as a defect.**

By the panel's own ladder — severity is "how wrong the player's answer gets and how recoverable it is" —
this displays no wrong value, is unreachable until a future re-scrape drops or re-keys a hunter (never
yet observed), and its worst visible state is an explained empty grid recoverable by one click. The one
genuinely unrecoverable part is the stored record itself, which no API call can remove; that is what
keeps it a finding rather than a note. The API asymmetry, the fix direction (drop the roster check from
DELETE, keep the length cap; intersect `ids` with `HUNTERS` before computing `favored.size`) and the
media-rename mechanism are all upheld unchanged.

### Correlated-recall check

No other seat filed anything about favorites, the roster, or the portrait tree (grepped all four
filings). Single-seat, no corroboration, no recall — the finding is entirely code-and-repro based.

---

## F4-2 — `desolations-delegate` out of alphabetical position

### Reproduce: yes, exactly

```
file is id-sorted: true          file is name-sorted: false
names starting "The ": 78        ids starting "the-": 77
the one exception: desolations-delegate | "The Statesman: Desolation's Delegate"
adjacent name-order inversions across the whole file: 1
  [ "The Statesman: Desolation's Delegate", "Devil's Advocate" ]
neighbours: desert-rose-dust-devil / desolations-delegate / devils-advocate
indices: desolations-delegate 37, the-statesman 208
```

Every number in Seat 4's table is exact, including the 78/77 split and the two indices. `scrape-hunters.mjs:1311`
is verbatim `allEntries.sort((a, b) => a.id.localeCompare(b.id));`.

### Evidence: load-bearing, with one caveat about what it proves

The `design.md` citations are accurate — `:189` does reason about "where the alphabet resumes" and
`:197` about "The alphabetical completeness it preserves". But both sentences appear inside the
*rationale for sectioning favorites*, arguing about a **different** ordering property (favorites lifted
out of the run). They are evidence that the design's mental model is name-alphabetical; they are not a
requirement that the grid be name-alphabetical. No spec REQ, no test, and **no UI string** asserts
alphabetical order — the picker labels the grid "Hunters" and gives the user a search box.

### Consequence: minimal today

One tile of 242 sits out of name order. Nothing numeric is wrong; nothing is unreachable (the free-text
filter matches on `name`, so typing "statesman" returns both variants). The favorites split already
breaks a strict single alphabetical run for any user who has favorited anything.

### Verdict: **DOWNGRADED, P2 → P3. CONFIRMED.**

The finding's durable content is Seat 4's own last paragraph — *"This will get monotonically worse as
hunters are renamed, and each new divergence is silent"* — which is the definition of P3: not
meaningfully wrong today, wrong eventually, with nothing to catch it. The fix direction (sort at the
consumption seam, never touch the ids, add a name-order test) is correct and I endorse it unchanged. The
culpability analysis (`hunter-roster-dataset/spec.md:90-92` sanctions id/name divergence) is right and
is the part that stops this becoming a bad "fix".

### Correlated-recall check

Single seat. Seat 5's handoff-adjacent charge covers `design.md` prose but filed nothing on ordering.

---

## F4-3 — 26 hunter descriptions carry stray whitespace before punctuation

### Reproduce: yes, exactly, with my own predicates

```
itemStats.test.js's own regex /\s[,;:.!?]/ over 242 descriptions -> 21
  bruja-crone dorothy-alice-dream dorothy-alice-nightmare felis jesse-buchanan-rookie
  joan-damon-rookie lilith marian-lee prudence-stallworth redneck ricky-leeds the-foxhound
  the-hanged-man the-hornback the-reverend the-scaled-warrior the-scarecrow the-sharpshooter
  the-skinned weird-sister worm-bite
space-before-possessive /\s['’]s\b/                              -> 5
  monroe the-cowl the-night-acolyte the-night-mother wight-raven
union                                                            -> 26
U+00B4 ACUTE ACCENT                                              -> luna-wolf mama-maye
```

Every quoted sample string is verbatim in the file. I printed three in full and they match character for
character.

### Evidence: load-bearing

`scrape-stats.mjs:1011-1021` `tidyProse` exists and is applied on the item path; `itemStats.test.js:161`
pins the item dataset with exactly the regex quoted; `scrape-hunters.mjs:220-231` `stripTags` ends at
`.replace(/\s+/g," ").trim()` with no equivalent; no test applies the predicate to `hunters.json`. The
asymmetry — same defect class, fixed on one side, unfixed and unpinned on the other — is exactly as
described.

### Consequence: real, and reachable today — I traced it to the pixel

Seat 4's consequence is the strongest in the filing and it holds. `descriptionOf`
(`LoadoutListsPanel.jsx:885-888`) returns the hunter's description; `:907-913` resolves it as the
inherited text; `DescriptionBlock` renders it at `:1143-1171` inside `<p className="ll-desc">{text}</p>`
with a "From {hunterName}" attribution. A list illustrated with The Reverend and carrying no stored
description of its own displays *"…tear each other apart in Stillwater Bayou . Barely escaping…"* on the
card. This is a wrong string on screen, today, with no wiki access required to know it is wrong — the
repo's own item-side test declares that shape a defect.

### Verdict: **UPHELD, P2, CONFIRMED.** And **PROMOTE**.

### Correlated-recall check — this is the panel's one genuine corroboration

**Seat 5 F9** files the same root class from a completely different direction: `/\s[,;:.!?]/` applied to
`itemStats.json`'s **non-description fields** finds five offenders (`"Burn , Scarce"` in `acquisition`
and `fields.Type` for four traits; `"Solo , Catalyst"` in `fields.ConditionalEffect` for
`frontiersman`), and observes that the guard at `itemStats.test.js:161` is description-only.

- **Different files** (`itemStats.json` vs `data/hunters.json`), **different scrapers**
  (`scrape-stats.mjs` field path vs `scrape-hunters.mjs` `stripTags`), **different consumers**
  (Seat 5's is latent with zero consumers today; Seat 4's renders to users today).
- Neither rests on recall. Both cite file+line and both are scripted.

This is *different evidence for the same conclusion* — the tag-to-space transform produces
space-before-punctuation, and the single guard that catches it covers one field of one file. Under the
brief's Round 2 rule that is the real thing, not an echo. **Recommend the chair promote the pair above
other P2s and state the remedy once: move `tidyProse` into `scripts/lib/wiki.mjs`, apply it to the
hunter description path (not to `stripTags` wholesale — `scrape-stats.mjs:1016-1018` gives the reason,
and it is a correct reason) and to multi-valued infobox fields, then extend the
`itemStats.test.js:161` predicate over `HUNTERS` and over `fields`.** Merging them into one finding
would lose the fact that two independent surfaces are affected; keep them as two findings with a shared
root and a shared fix.

---

## F4-4 — The "Not obtainable" filter

### Reproduce: yes. The `obtainable` claim is correct and the panel brief is wrong

```
obtainable domain over 242: [ ['true', 240], ['null', 2] ]     typeof: 240 boolean, 2 object
non-true rows: the-foxhound (null/null/null), the-ol-cowpoke (null/null/null)
any stored source matching /\bmythic\b/i: []
acquisition domain: blood-bonds 60, bloodline 10, dark-tribute 3, dlc 65, event 50,
                    null 2, prestige 9, progression 18, story-challenge 18, twitch-drop 7
```

**No hunter is `obtainable: false`.** The two exceptional entries are `obtainable: null`, and they are
the same two entries that are `acquisition: null` and `source: null`. Part II of the panel brief states
*"2 are `obtainable: false`"* — that is false against the shipped dataset, and Seat 4's handoff #5
flagging it to the chair is correct and worth acting on: it is a premise five seats read before touching
the data.

`false` is producible only via `deriveObtainable` (`scrape-hunters.mjs:483-487`, read verbatim) from
`acquisition === "mythic"`, and `mythic` is rule 6 of `ACQUISITION_RULES` (`:447`) which no stored
`source` matches. Four rule values are dormant: `soul-survivor`, `hunt-dollars`, `mythic`, `free`.
`OBTAINABLE_OPTIONS` at `HunterPicker.jsx:112-116` is a hardcoded literal offering "Not obtainable"
unconditionally, twenty lines above the acquisition select that gates its own sentinel on
`HAS_UNKNOWN_ACQUISITION` (`:475`). The asymmetry Seat 4 points at is exactly there in the file.

### The fixtures claim: fully confirmed, and it is the best part of this finding

- `client/src/data/hunterFavorites.test.js:27` — `{ id: "c", name: "Charlie", acquisition: "dlc",
  obtainable: false }` — a value production has never held.
- `:123` — `expect(flatIds(filterHunters(ROSTER, { obtainable: "no" }))).toEqual(["c"])`.
- `client/src/components/HunterPicker/HunterPicker.test.jsx:23` — `bad-hand`, `obtainable: false`;
  `:149-158` `"filters by availability, including the unknown case"` drives the real select to `"no"`
  and asserts the fixture hunter comes back.
- `HunterPicker.test.jsx:13` does say the *null* shape corresponds to "the two live entries that shape
  do exist for", and says nothing equivalent for `false`.

So the control is thoroughly tested and the tests cannot fail when the option goes dead, because they
test a roster that does not exist. That is precisely the brief's "a green suite is evidence about the
tests" case, and Seat 4 identified it correctly.

### Consequence: the stated consequence is wrong

> *"A user selects 'Not obtainable' and gets an empty picker with no explanation. It reads as a broken
> filter or a failed load, because it is indistinguishable from one."*

**Struck.** `HunterPicker.jsx:531-540` renders, unconditionally at `total === 0`:

> *"No hunters match those filters. Clear the search or widen the filters — or pick “No portrait”
> below."*

directly beneath an `aria-live` count reading `0 of 242 hunters`. The state is explained, announced, and
distinguishable from a failed load (a failed load leaves the count and the message absent). Nothing
mis-states a value; a control simply offers a bucket with no members.

### Verdict: **DOWNGRADED, P2 → P3. CONFIRMED (the dead option and the fixtures); consequence sentence STRUCK.**

P3 is where this belongs on the ladder: nothing displayed is wrong, and the finding's weight is entirely
in the `[UNVERIFIED]` half — *if* some hunter should be classified unobtainable, this is a missing
classification rather than a dead control, and no one can tell which from inside the repo. That is the
textbook P3: "not wrong today; wrong eventually, with nothing to catch it." Both halves of the fix
direction stand, and I would add Seat 4's own final sentence as the higher-value half: **a fixture
asserting a value the production dataset has never carried should say so in a comment, or the predicate
should additionally be asserted against `HUNTERS`.**

### Correlated-recall check

Single seat, no recall — `obtainable`'s domain is read off the committed file, not remembered. Note the
one thing that *looks* like corroboration is the panel brief itself, and it corroborates the **opposite**
value; treat the brief as an authored document that was wrong, not as evidence.

---

## F4-5 — The portrait tree has no on-disk coverage test

### Reproduce: yes, exactly

`scripts/scrape-images.test.mjs:786-807` reads the real directories with `readdirSync` and checks both
directions, and its `rows` object has exactly four keys:

```js
const rows = { weapons: WEAPONS, tools: TOOLS, traits: TRAITS, consumables: CONS };
```

`readdirSync` appears in exactly two places in the whole test surface — `scrape-images.test.mjs:787` and
`:793`. Nothing else anywhere reads `client/public/images/` from disk. Every hunter-scraper test that
touches a filesystem uses the in-memory fake (`fs.files.set('/images/hunters/…')`).
`client/src/utils/listOrdering.test.js:165-192` runs against the real `HUNTERS` and asserts id/name
presence, id uniqueness, the three classification fields, and truthy provenance — and never mentions
`portrait`. Confirmed by reading it.

### Evidence and consequence

Load-bearing and correctly characterised. The exposure is genuine and Seat 4 states it precisely: the
fallback at `HunterPortrait.jsx` → `hunterThumb` makes a *missing* portrait and a *deliberately art-less*
hunter render identically, and `hunters.js:64-70` records that this failed at full scale once already
(#147 deleted 242 `-thumb` files; every tile 404'd and fell back; a human caught it). No player-facing
wrongness today.

### Verdict: **UPHELD, P3, CONFIRMED.**

Correctly graded by Seat 4 — the largest tree by count (242 of 498 files, 2.49 MB, independently
measured) is the one tree nothing pins. Fix direction (extend the fifth tree keyed on `portrait` +
`.avif`, both directions) is right.

### Correlated-recall check

Single seat. Adjacent to Seat 5 F4 (`catalog.js`'s image-model header describes a two-tier lookup that
does not exist) only in subject matter — different artifact, different claim, no merge.

---

## F4-6 — First-match rule ordering

### Reproduce: yes, exactly — and I re-derived the multi-match set rather than trusting the four rows

Applying all 13 `ACQUISITION_RULES` patterns to every stored `source` and keeping rows that match more
than one:

```
multi-rule sources: 4
  bruja-crone  | 900 Blood Bonds / Garden of the Witch Event | stored: blood-bonds | hits: blood-bonds,event
  bruja-maiden | 900 Blood Bonds / Garden of the Witch Event | stored: blood-bonds | hits: blood-bonds,event
  welder-flame | 800 Blood Bonds / Garden of the Witch Event | stored: blood-bonds | hits: blood-bonds,event
  welder-torch | 800 Blood Bonds / Garden of the Witch Event | stored: blood-bonds | hits: blood-bonds,event
"Garden of the Witch" appears in exactly these 4 sources and nowhere else
acquisition === "event": 50
```

Exactly four, exactly the four named, and the Event bucket is exactly 50. Nothing else in the dataset has
a compound source.

### Evidence: one citation is wrong, harmlessly

Seat 4 says *"`blood-bonds` is rule 3, `event` is rule 12"*. Counting `ACQUISITION_RULES`
(`scrape-hunters.mjs:447-462`) 1-based: blood-bonds is **3** ✓, mythic is **6** ✓, **event is 11, not
12** (progression is 12, free is 13). The ordering argument is unaffected — event is below blood-bonds
either way — so this is a transcription slip, not a load-bearing error.

### Consequence: real, but "misfiled" overstates it

The heading says *"four hunters are misfiled today"*. The body says the opposite and is right: *"The
single-valued `acquisition` field cannot represent 'both', so this is a modelling limit surfacing as a
filter gap, not a parse error."* `acquisition` is documented (`:483-487`) as answering "how was this
obtained"; for a hunter sold for 900 Blood Bonds during an event, `blood-bonds` is a defensible — arguably
the correct — answer, and the rule list's specific-before-general comment (`:443-445`) is doing what it
says. What is genuinely defective is that a source matching two rules is reduced to one **with no
diagnostic**: `formatSummary` reports `unmappedSources` (`:1391-1394`) for the no-match case and has no
equivalent for the multi-match case.

The `[UNVERIFIED]` half — that `mythic` sits below three channel rules and is the only rule feeding
`deriveObtainable`, so a source like `"Mythic — 1000 Blood Bonds"` would silently lose the
unobtainability — is a hypothetical about a string that does not exist in this dataset. It is correctly
flagged `[UNVERIFIED]` and must stay `SUSPECTED`.

### Verdict: **UPHELD, P3. CONFIRMED for the four rows; SUSPECTED for the mythic half. Headline narrowed** from
"four hunters are misfiled" to "a compound source is silently reduced to one channel, with no
multi-match diagnostic". Both fix directions stand; (b) — report multi-match at scrape time, alongside
`unmappedSources` — is the one worth doing, because it is the one that keeps working as the wiki's
wording changes.

### Correlated-recall check

Single seat. Seat 4's own handoff #3 correctly routes the "does SPEC-0004's vocabulary match this rule
list" question to Seat 5; Seat 5 did not take it up, so it remains open — I flag it for the chair as an
uncovered question rather than a finding.

---

## F4-7 — Two wasted requests per item thumbnail

### Reproduce: mechanism yes; the "404" is wrong

Confirmed from source and from my own file census:

```
IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp"]        ItemThumb.jsx:22
EXTENSIONS_BY_CATEGORY = { hunters: ["avif"] }           ItemThumb.jsx:33
if (sources) return sources;                             ItemThumb.jsx:63
file census: weapons 147 png, tools 21 png, consumables 30 png, traits 58 png, hunters 242 avif
             — zero jpg, zero jpeg, zero webp anywhere in the tree
```

`onError` walks one candidate per failure (`ItemThumb.jsx:129-132`), so every item image costs two
failed loads before the png succeeds. `HunterPortrait.jsx:51-66` always passes `sources`, and it is the
only hunter call site outside tests (grepped), so `extensionsFor("hunters")` is never reached on a
production path — the justification comment at `:28-32` describes traffic that cannot occur. Both halves
reproduce.

### Evidence: the "404" characterisation is struck

Seat 4 says *"each distinct item thumbnail issues two failing requests"* (true) and *"two guaranteed
404s"* / *"a noisy console"* (not true in production). `server/src/index.js:144-155` registers
`express.static(clientDist)` followed by a catch-all SPA fallback middleware, so any unmatched path —
including `/images/weapons/nagant-m1895.jpg` — is answered with `index.html`. I reproduced it against a
faithful miniature of those lines:

```
/images/weapons/nagant-m1895.jpg   -> 200 text/html
/images/weapons/nagant-m1895.jpeg  -> 200 text/html
/images/weapons/nagant-m1895.png   -> 200 image/png   (12812 bytes)
```

So in production the two probes are `200 text/html` carrying the whole index document, not 404s — the
byte cost is *worse* than Seat 4 claims and the console cost is *smaller* (a decode failure, not a
network error line). In dev, Vite does 404 them, which is presumably where the observation came from.

This also sharpens Seat 4's own argument for why the finding belongs to this seat: a genuinely missing
asset in production does not 404 either — it returns 200 and an HTML body — so "missing art" and "wasted
probe" are indistinguishable *by status code*, not merely lost in noise.

### Consequence

No wrong number, no wrong label. Wasted bytes and latency per thumbnail.

### Verdict: **UPHELD at P3, with the 404 evidence struck and replaced.** Scope-marginal under Part IV
("a style or refactor opinion about code that produces correct data") — I am not striking it on scope,
because it is the fallback mechanism this seat owns and because the second half (a live comment
justifying an unreachable code path) is a comment-gone-false, which the brief explicitly asks for. The
fix direction — put `png` first, keep the rest of the chain, and either route `HunterPortrait` through
`category="hunters"` or delete the dead entry with its rationale — is right and cheap.

### Correlated-recall check

Single seat. Seat 5 F4 files a different false claim in a different file about the same subsystem
(`catalog.js`'s two-tier icon lookup). Same *class* — "an image-path comment that describes machinery
that isn't there" — but no shared evidence. Worth the chair noting as a pattern, not merging.

---

## The central negative result: re-derived, and it holds

Seat 4's headline is that the enumeration of items running on the SVG fallback is **empty** — 0 missing,
0 orphaned, 0 slug collisions, in five trees, in both directions. A negative result at that scale is
where a silently-excluded category would hide, so I rebuilt it from scratch.

**My method, deliberately different from Seat 4's in one way that matters.** Seat 4 computed item paths
through `slugify(name)`. I did the same, but first checked *what each call site actually passes as
`name`*, because a method that read the wrong tuple field would produce clean zeros for the wrong
reason. The catalog rows are **tuples**, not objects — `["nagant-m1895", "Nagant M1895", 1, 24,
"compact", "Pistols"]` — and every `ItemThumb` call site passes index **1**:

- `Picker.jsx:63,87,113,144` → `x.w[1]` / `x.t[1]` / `x.c[1]` / `x.t[1]`, with `category` literals
  `weapons` / `tools` / `consumables` / `traits`
- `WeaponSlot.jsx:44` → `def[1]`, `EquipmentSlot.jsx:252` → `def[1]`, `TraitsPanel.jsx:44` → the trait name
- `LoadoutListsPanel.jsx:156,167,176` → `def[1]` via `weaponCell`/`equipCell`/`traitCell`

No call site passes an id, a decorated name, or a variant label. The URL under test is therefore the URL
the browser really requests.

Result, computed through the real `client/src/utils/slugify.js`:

| Tree | Rows | Files | Distinct stems | Missing | Orphaned | Slug collisions |
|---|---|---|---|---|---|---|
| weapons | 147 | 147 | 147 | **0** | **0** | **0** |
| tools | 21 | 21 | 21 | **0** | **0** | **0** |
| consumables | 30 | 30 | 30 | **0** | **0** | **0** |
| traits | 58 | 58 | 58 | **0** | **0** | **0** |
| hunters | 242 | 242 | — | **0** | **0** | **0** |

- `find client/public/images -type d` returns exactly five directories and `-type f` exactly **498**
  files. There is no sixth tree and no category was excluded — the trees in the table are the trees on
  disk.
- Hunter portraits cross-referenced on the stored `portrait` field (which is what `portraitSources`
  reads at `hunters.js:88-92`), not on `slugify(name)` — the same choice Seat 4 made, and the correct
  one: `portrait !== slugify(name)` for exactly three entries (`desolations-delegate`, `union-suit-red`,
  `union-suit-white`), so cross-referencing on the name would have produced three false positives.
- No two hunter display names collide under `slugify` either.
- Integrity, re-measured: all 242 hunter files carry `ftypavif` at offset 4; all 256 item files start
  `89 50 4e 47`; **zero** files under 200 bytes; hunters total **2.49 MB**, 7.5–20.0 KiB, median 10.3
  KiB. (Seat 4 quotes 7.6–20.4 KB / median 10.5 — the difference is KB=1000 vs KiB=1024, not a
  disagreement.)
- `KNOWN_CATALOG_DUPLICATES` is `{}`, so the exemption at `scrape-images.test.mjs:797` currently exempts
  nothing and all 256 item rows are genuinely covered. Verified by importing it.

**Verdict: the negative result is UPHELD in full.** Two independently written scripts, one of them
checking the call-site name binding the other did not, produce identical zeros. The panel's coverage
claim on the image trees is sound.

I also re-derived the roster negative results:

```
242 entries; uniq id 242, name 242, portrait 242, description 242
one key-set across all 242: acquisition,description,id,ingestedAt,name,obtainable,portrait,source,sourceRevision
ingestedAt: single value 2026-08-11T00:15:01.470Z   (one scrape run — no stale corner)
sourceRevision: 242 numeric, range 6290..16307
normaliseAcquisition(source) vs stored acquisition:  0 drift
deriveObtainable(acquisition) vs stored obtainable:  0 drift
ACQUISITIONS: 9 values; acquisition buckets + Unknown cover 242/242; availability buckets cover 242/242
description lengths: max 404 = "The Night Seer", next 323 = "Zhong Kui", min 162, median 257
mojibake / wiki markup / entities / reference markers: 0
```

All match Seat 4. In particular `server/src/lib/descriptions.js:16`'s claim about the 404-character
Night Seer description is exact, and the generated file agrees with its generator on every row — which
is the check that would have caught a hand-edit of a do-not-hand-edit file.

---

## Struck and corrected sub-claims

None of these strikes removes a finding; each removes or repairs a supporting statement.

| Where | Claim | Disposition |
|---|---|---|
| F4-3 | *"`marian-lee` also ends with a trailing space that survived `.trim()`"* | **STRUCK.** The description continues *"…Elwood Finch . When the organization died…"* and ends *"…instead of traitors."* Zero of the 242 descriptions have leading or trailing whitespace. `marian-lee` does carry two space-before-punctuation instances, so it belongs in the 21 — only this sentence about it is wrong. |
| F4-4 | *"an empty picker with no explanation … indistinguishable from a failed load"* | **STRUCK.** `HunterPicker.jsx:531-540` renders an explicit empty-state message and an `aria-live` "0 of 242 hunters" count. |
| F4-1 | *"both sections come back empty, and the picker renders zero tiles — the exact state that comment exists to prevent"* | **PARTIALLY STRUCK.** True only with `favoritesOnly` on; with the toggle off a stale-only favorites set yields the full 242. Arriving pre-filtered needs ≥11 stale ids. The same explicit empty-state message applies. |
| F4-6 | *"`event` is rule 12"* | **CORRECTED** to rule 11. Non-load-bearing. |
| F4-6 | headline *"four hunters are misfiled today"* | **NARROWED** to a compound source reduced without diagnostic; Seat 4's own body says this. |
| F4-7 | *"two guaranteed 404s"*, *"a noisy console"* | **STRUCK for production.** The SPA fallback answers both probes `200 text/html`. Two wasted requests per image is upheld; their status code and console signature are not. |

---

## Challenge to Seat 4's handoffs

Handoffs go to the chair, so an incorrect one has a real cost.

**Handoff 1 (`npm test` does not run at the root): UPHELD.** Reproduced, and independently reported by
Seats 1, 2 and 5. Node v22.22.2 against a pinned `^20`, and `vitest` unresolved from the workspace
script.

**Handoff 2 (the server suite fails on a clean tree because vitest runs files in parallel): the
observation is real, the diagnosis is STRUCK, and the recommended fix is already in the repo.**

- `server/vitest.config.js:17` already sets **`fileParallelism: false`**, with a fifteen-line comment
  explaining that the suites share one lowdb store and that serialising them is the honest fix. Seat 4's
  `--no-file-parallelism` flag therefore restated a setting that was already in force, and their
  recommendation *"or `fileParallelism: false` in the server vitest config"* asks for something that
  exists.
- I ran the server suite **with default settings** (i.e. the repo's own serial config), alone, against a
  private `OUTFITTER_DB_FILE`: **7 files, 161 passed, 1 skipped, 6.1s.** It does not fail on a clean
  tree.
- The actual cause is what Seats 1 and 5 identified and the chair confirmed: the `test` script hardcodes
  `OUTFITTER_DB_FILE=./data/db.test.json` (`server/package.json:10`), so **concurrent panel seats**
  tear each other's JSON. Seat 4 observed a real failure and attributed it to the runner instead of to
  the neighbours.
- The half of the recommendation that survives is the good half: **give each run its own db path**
  (`mktemp`, or `$$` in the script) so the suite cannot be corrupted from outside its own process.

**Handoff 5 (the panel brief itself states `obtainable: false` for two hunters): UPHELD and important.**
Verified: the dataset has no `false`. The chair should correct the brief, because it is the one document
every seat reads before looking at the data.

**Handoffs 3, 4, 6: upheld as routed.** #3 (does SPEC-0004's vocabulary match `ACQUISITION_RULES`?) went
to Seat 5 and Seat 5 did not take it up — it is an **open, uncovered question**, not a closed one. #6
(roster completeness is invisible from inside the roster) is correct and matches the brief's own
"Unassigned by design" blind spot.

---

## Summary for the chair

- **Nothing in Seat 4's filing failed to reproduce.** Seven findings, seven reproductions, from scripts I
  wrote rather than theirs.
- **Three downgrades** (F4-1, F4-2, F4-4: P2 → P3), all on the same ground — no wrong value reaches the
  screen, and the states in question are either latent, explained on screen, or one click from recovery.
  Seat 4 declared up front that its surfaces carry no arithmetic and graded conservatively; these are
  adjustments within that honest frame, not corrections of inflation.
- **One promotion.** F4-3 + Seat 5 F9 are independent corroboration in the strict sense the brief
  defines: different files, different scrapers, different consumers, neither resting on recall. Seat 4's
  half is the one with a live player-facing consequence.
- **One evidentiary correction with teeth:** F4-7's "404" is not what production does, and the truth is
  slightly worse for bytes and slightly better for console noise.
- **One handoff diagnosis struck:** the server suite's parallelism is already disabled in
  `server/vitest.config.js`; the shared db *path* is the defect, and that is where the fix belongs.
- **The negative result survives independent re-derivation** — including a check Seat 4's method did not
  make (that every `ItemThumb` call site passes the catalog display name, tuple index 1), which is
  precisely where a silently-excluded category would have hidden. 498 files, five trees, both
  directions, zero missing, zero orphaned, zero collisions.

**Seat 4 may respond once.** The two places I expect a response are F4-1's severity (the stored record is
genuinely unremovable, which is the strongest argument for keeping it at P2) and F4-7's scope. An
unresolved disagreement on either is a result; the chair should record both positions rather than pick.
