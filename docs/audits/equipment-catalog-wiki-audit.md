# Equipment Catalog vs. huntshowdown.wiki.gg — Reconciliation Audit

**Date:** 2026-08-10
**Scope:** `client/src/data/catalog.js` → `TOOLS` (22), `CONS` (30), `TRAITS` (32), plus the
cross-cutting `AMMO`/`AMMO_LABEL` pools, the four group taxonomies, and the loadout rules encoded
in `calc.js` / `loadoutSlice.js`.
**Out of scope:** `WEAPONS` — covered by
[the weapon catalog audit](./weapon-catalog-wiki-audit.md), referenced rather than redone.
Hunters (`client/src/data/hunters.json`) — governed by SPEC-0004, tickets #127 and #147.
**Source of truth:** `https://huntshowdown.wiki.gg/`
**Purpose:** The second half of the seed spec for `scripts/scrape-stats.mjs`
([ADR-0005](../adrs/ADR-0005-scrape-item-stats-into-generated-data-file.md)). Its
"Scrape Targets Summary" is designed to concatenate with the weapon audit's into one crawler queue.

---

## Method and its limits — read this first

### Wiki access is still blocked

**Re-verified at the top of this audit, not assumed.** Both access paths were tried:

| Probe | Result |
|---|---|
| `curl https://huntshowdown.wiki.gg/wiki/Category:Tools` | `curl: (56) CONNECT tunnel failed, response 403` |
| `WebFetch` on the same URL | `{"error_type":"EGRESS_BLOCKED","domain":"huntshowdown.wiki.gg"}` |

So the weapon audit's constraint still binds: **no page was fetched and no infobox was parsed.**
If a later reader finds this changed, everything below marked `[VERIFY]` should be re-derived by
running the scraper rather than by re-reading this document.

### Sources, in descending order of reliability

1. **The repo itself** — `scripts/lib/wiki.mjs`'s sitemap-verified override tables, the frozen
   legacy tables in `loadoutCodec.js`, and the catalog test suite.
2. **A live scrape run recorded in git history.** This audit has one source of evidence the weapon
   audit did not, and it is the strongest single item in the list. Commit `cd8cda9` ("Add scraped
   catalog images as self-hosted static assets", 2026-08-09) records a real, rate-limited run of
   `scrape-images.mjs` against the live wiki:

   > Run summary: 122 succeeded, 0 failed, 3 skipped. … `weapons 37 tools 23 consumables 30
   > traits 32` … Every category was dry-run against live pages before any bytes were downloaded.

   A success there means the item's resolved wiki URL returned a page **and** an image asset was
   found on it. That makes the run a per-item page-existence oracle for **every** tool, consumable,
   and trait row, taken one day before this audit. The bytes are still on disk: 22/22 tool images,
   30/30 consumable images, 32/32 trait images, filenames matching `slugify(displayName)` exactly.
   This is why List 1 is empty in all three parts — not by assumption, but because each row was
   observed resolving to a live page.

   **What it does not prove:** MediaWiki serves renamed pages through redirects, so a 200 does not
   confirm the display name is *current*. It confirms the path resolves.
3. **`WebSearch` scoped to `huntshowdown.wiki.gg`** — returns page titles, URLs, and snippets.
   Category member *counts* quoted below came from this and are treated as high-confidence
   (they are page furniture, not stats). Item *names* likewise. Numeric stat values are not.
4. **Domain knowledge**, used only to interpret 1–3, never standalone.

### The one thing this audit's category is unusually exposed to

Commit `077e747` ("Fix stale catalog data and complete missing rosters (Update 2.8 era)") states
every value in `TOOLS`, `CONS`, and `TRAITS` was **verified against the wiki through Update 2.8.1**
— and that commit is one day old. Weapons were explicitly excluded from it ("the broader weapon
cost/size/rename corrections … are intentionally out of scope").

This inverts the weapon audit's prior. There, the expectation was broad staleness. Here, the
expectation should be that **costs are largely right and the interesting failures are elsewhere** —
in roster completeness, in category/type assignment, and in rules the data model cannot express.
That expectation is confirmed below, with two qualifications: the trait roster is *not* complete
despite the comment implying a full pass, and three consumable `type` values are wrong in a way
that is a rules bug rather than a cosmetic one.

### Confidence and `[VERIFY]` conventions

Same as the weapon audit. Every number not read from a wiki page is marked `[VERIFY]`, every
finding carries a confidence level, and **no number in this document may be hand-copied into
`catalog.js`.** Transcription is the toil ADR-0005 exists to remove. Page identity and page
structure are things this audit can be authoritative about; stat values are not.

---

## File inventory and record shapes

| Export | Count | Shape | Notes |
|---|---|---|---|
| `TOOLS` | 22 | `[id, name, cost, group]` | `catalog.js:124`. **No `size` field** — see A.0. |
| `CONS` | 30 | `[id, name, cost, type, group]` | `catalog.js:156`. `type` is load-bearing (see B.0). |
| `TRAITS` | 32 | `[id, name, up, group]` | `catalog.js:206`. `up` = Upgrade Points. |
| `AMMO` | 10 pools | `{ class: [[variantName, price], …] }` | `catalog.js:32-46`. No provenance. |
| `AMMO_LABEL` | 10 | `{ class: label }` | `catalog.js:48-59`. Display only. |
| `*_GROUPS` | 4 × 5 | `string[]` | App-side UI buckets. |

`id` is the wire format — `loadoutCodec.js`, localStorage, saved loadouts, share URLs. **Never
rewritten, never re-slugged, never reused after retirement.** Every recommendation below is keyed
by id for that reason.

### Where each field is actually consumed

Worth stating explicitly, because it is what makes a "cosmetic" field a rules input:

- `TOOLS[i][2]`, `CONS[i][2]` → `totalCost()` (`calc.js:35`) — budget math.
- **`CONS[i][3]` (`type`) → `catCount()` (`calc.js:18`) → the 4-per-category cap
  (`loadoutSlice.js:46`).** A wrong `type` silently changes which loadouts the app permits.
- `TRAITS[i][2]` (`up`) → `upTotal()` (`calc.js:24`) → the optional UP budget (`thunks.js:40`).
- `group` (all four) → picker section headers and the SVG fallback-icon dispatch only. Never a rule.

---

# Part A — TOOLS

## A.0 — Do tools have a slot cost post-2.8? **No. The app is right to omit it.**

The brief asked whether tools carry a slot cost that the app simply isn't modeling. They do not.

Update 2.8 merged the old 4 tool + 4 consumable slots into a single flexible pool of 8, and within
that pool **every tool occupies exactly one slot**. Wiki-sourced phrasing: each hunter can carry
"two weapons, up to eight Tools and/or Consumables and up to 15 Traits", and players "can freely
equip any tool or consumable to any slot, in any combination". Slot *sizes* (1–5) are a weapons-only
concept; the wiki's slot categories (`Category:Weapons/Small_Slot` and siblings) exist only under
`Weapons`.

**Verdict: not a schema gap.** `[id, name, cost, group]` is the correct shape for a tool.
**Confidence: HIGH.** Corroborated independently by the app's own arithmetic — `slotMax()` counts
`equip.length` against 8, which is only coherent if each entry costs exactly 1.

The one apparent exception is not an exception: the **Katana** is a size-2 item, because on the
wiki it is a *weapon*, not a tool. See A.2 and A.3.1.

## A.1 — List 1: Tools in the app that no longer exist

**Empty. Confirmed, not assumed.**

All 22 `TOOLS` rows resolved to a live wiki page during the `cd8cda9` scrape run and have an image
on disk today. No tool row is a rename casualty, a duplicate, or a removal.

This is a genuinely different result from the weapon audit, where 14 of 39 rows carried stale
pre-`1896` names. Tools were never branded, so Update 2.0's rename wave did not touch them.

**One historical note, already handled:** the **Electric Lamp** was removed from the game in Update
2.0 and was deleted from `TOOLS` in commit `e0076d3`. Its wiki page still exists, and
`loadoutCodec.js`'s `LEGACY_TOOL_IDS[9]` holds a `null` placeholder for it. Correct on all counts —
recorded here only so a future crawler diff does not "rediscover" it. See A.2 and structural
concern #3.

**Confidence: HIGH.**

## A.2 — List 2: Tools missing from the app

### Coverage delta

**`/wiki/Category:Tools` reports 23 pages. The app has 22 rows. The gap reconciles exactly to
zero missing live tools.**

| Wiki page | In app? | Disposition |
|---|---|---|
| Alert Trip Mines | ✅ `alert-trip-mine` | override already in `wiki.mjs` (plural) |
| Bear Traps | ✅ `bear-traps` | |
| Blank Fire Decoys | ✅ `blank-fire-decoys` | |
| Choke Bombs | ✅ `choke-bombs` | |
| Concertina Trip Mines | ✅ `concertina-trip-mine` | override (plural) |
| Decoy Fuses | ✅ `decoy-fuses` | |
| Decoys | ✅ `decoys` | |
| Derringer Pennyshot | ✅ `derringer-pennyshot` | |
| Dusters | ✅ `dusters` | |
| **Electric Lamp** | ❌ | **Removed from the game in Update 2.0.** Page is a tombstone. Do not add. |
| First Aid Kit | ✅ `first-aid-kit` | |
| Flare Pistol | ✅ `flare-pistol` | |
| Fusees | ✅ `fusees` | |
| Heavy Knife | ✅ `heavy-knife` | |
| Knife | ✅ `knife` | |
| Knuckle Knife | ✅ `knuckle-knife` | |
| **Multitool** | ❌ | **Never shipped.** Cut prototype — lockpicking was removed as a feature. Do not add. |
| Poison Trip Mines | ✅ `poison-trip-mine` | override (plural) |
| Quad Derringer | ✅ `quad-derringer` | |
| Spyglass | ✅ `spyglass` | |
| Throwing Axes | ✅ `throwing-axes` | |
| Throwing Knives | ✅ `throwing-knives` | |
| Throwing Spear | ✅ `throwing-spear` | |
| *(not in this category)* | ✅ `katana` | Filed under `Weapons` on the wiki — see A.3.1 |

**23 wiki pages − 2 tombstones = 21 live tools, all 21 present. Plus the Katana (filed elsewhere)
= 22 rows. The tool roster is complete.**

**Confidence: HIGH** on the membership list (a category listing is page furniture, and it matches
the 23-item scrape run in `cd8cda9` exactly, including `electric-lamp` which was still a row then).
**MEDIUM-HIGH** on the two tombstone rationales, which came from wiki prose rather than an infobox.

> **This is the single most important finding in Part A for the scraper**, and it generalizes:
> a wiki category contains *removed* items alongside live ones. A crawler that diffs
> `Category:Tools` against `TOOLS` and proposes the difference as "missing" will propose re-adding
> the Electric Lamp — an item this repo deliberately deleted and holds a `null` legacy slot for —
> and the Multitool, which never shipped. See structural concern #3.

### Nothing here needs a schema change

Unlike the weapon audit's List 2 (which required a `variantOf` field before ~100 variants could
land), Part A's List 2 is empty, so no tool schema work is implied. Tools have no variants, no
subpages, and no family structure.

## A.3 — List 3: Tools present with incorrect or outdated data

### A.3.1 — `katana` / "Katana" — **category error, not a value error**

- **File:** `client/src/data/catalog.js:131`
- **Wiki:** `/wiki/Weapons/Katana`

| Stat | App Value | Expected Wiki Value | Status |
|---|---|---|---|
| category | `TOOLS` | Weapons | **wrong table** |
| cost | `100` | `115` `[VERIFY]` | changed |
| size | *(absent — tools have none)* | `2` `[VERIFY]` | **unrepresentable** |
| group | `Melee` | *(app-side)* | n/a |
| melee / heavy melee damage | *(absent)* | `165` / `280` `[VERIFY]` | new field missing |

The Katana is a two-handed melee **weapon** occupying 2 of the hunter's 5 weapon slots, not an
equipment-pool tool. `scripts/lib/wiki.mjs` already knows this — it is the sole reason the
`tools.katana → "Weapons/Katana"` cross-category override exists.

**The consequence is a live budget-math error, in both directions:** the app lets a player equip
the Katana without spending any of `capMax()`'s 5 weapon slots, while consuming one of the 8
equipment slots it should not touch.

**Do not fix this by moving the row.** Reclassifying `katana` from `TOOLS` to `WEAPONS` is a
wire-format change with three coupled consequences, and it needs its own ticket:

1. `loadoutCodec.js`'s `LEGACY_TOOL_IDS[6]` is `"katana"`, and `resolveLegacyEquip()` resolves
   legacy equipment slots against `TOOL_BY_ID`/`CONS_BY_ID` only — **never against weapons**. A
   legacy record naming the Katana would start resolving to `null` and be silently dropped.
2. `fromV1` encodes equipment as `["T", id]`; existing *current-format* saved loadouts carrying
   `["T","katana"]` would fail the `TOOL_BY_ID.has()` filter at `loadoutCodec.js:53` and be dropped
   too. This is not a legacy-only hazard.
3. The image lives at `client/public/images/tools/katana.png` and would need to move to
   `weapons/` — ADR-0002's `{category}/{slug}` contract makes the category segment part of the path.

**Confidence: HIGH** that the classification is wrong (the wiki page path is sitemap-verified
in-repo, and the override predates this audit). **MEDIUM** on `115`/`2`, quoted from search snippets
rather than read from the infobox — and the wiki text itself carries a caveat that Update 1.16 moved
the Katana to a Small Slot while the infobox still reads 2, which is exactly the kind of internal
inconsistency the scraper must resolve rather than this document.

### A.3.2 — `knife` and `heavy-knife` — flagged, **not** asserted

| Item | App Value | Search-surfaced value | Status |
|---|---|---|---|
| `knife` / "Knife" | `30` | `20` `[VERIFY]` | **unresolved** |
| `heavy-knife` / "Heavy Knife" | `15` | `25` `[VERIFY]` | **unresolved** |

I am deliberately not calling these errors. The search that produced `20`/`25` also returned
`/wiki/Update/1.0.3` and `/wiki/Update/1.4.2` among its top hits, and the snippet described the
prices as "having been reduced from their previous costs" — phrasing that belongs to a patch note,
not an infobox. These may well be 2019-era historical values, and `heavy-knife` moving *up* from 15
to 25 runs against `077e747`'s claim that tool costs were verified through 2.8.1 one day ago.

**Confidence: LOW.** Recorded so the scraper resolves them, explicitly *not* because they are
likely wrong. This is the "well-formed wrong answer" failure mode this audit is supposed to catch,
demonstrated on itself — see structural concern #6.

### A.3.3 — Whole-table cost verification

| Stat | App Value | Expected Wiki Value | Status |
|---|---|---|---|
| `cost` (all 22) | as authored | `[VERIFY]` | verify |

`077e747` verified these against 2.8.1 on 2026-08-09, and `catalog.test.js:71-74,101` locks four of
them (`bear-traps` 70, `knuckle-knife` 50, `throwing-spear` 80, `derringer-pennyshot` 63,
`choke-bombs` 25) as regression tests. `first-aid-kit` at `30` matched the one clean spot-check
available.

**Confidence: MEDIUM-HIGH that this column is broadly correct** — the opposite prior from the
weapon audit's §3.6, and for a documented reason. Still worth a scrape pass to confirm, but it is
not the highest-value target.

### A.3.4 — All 22 tools are missing their entire stat block

| Stat | App Value | Expected Wiki Value | Status |
|---|---|---|---|
| description, unlock rank, quantity carried, damage/effect values, duration, radius | *(absent)* | present in every tool infobox | **new field missing** |

Stated once rather than 22 times. **Confidence: HIGH** — this is ADR-0005's premise.

---

# Part B — CONSUMABLES

## B.0 — Why `type` is the field that matters here

`CONS[i][3]` is the only value in this table that changes what the app *permits*. `calc.js:18`
counts equipped consumables by it, and `loadoutSlice.js:46` refuses a fifth of any one type. The
app models exactly two types: `Shot` (10 rows) and `Throwable` (20 rows).

**The game has four.** Update 2.8's own wording: consumables are "restricted to 4 instances of the
same type (**Throwables, Placeables, Shots and Tarot Cards**)".

So the app is missing two of the four cap categories. One of them (Tarot Cards) is defensibly out
of scope; the other (**Placeables**) is not, and three current rows are misfiled into it.

## B.1 — List 1: Consumables in the app that no longer exist

**Empty.** All 30 rows resolved to live wiki pages in the `cd8cda9` run and have images on disk.

The one historical duplicate — `choke-bomb`, which shadowed the `choke-bombs` **tool** — was
already retired in issue #67 / commit `4b1ab50`. `LEGACY_CONS_IDS[13]` correctly redirects that
legacy slot to the surviving tool id `choke-bombs`, and `catalog.test.js:102-103` asserts the row
and id are gone. Nothing further to do.

**Confidence: HIGH.**

> **Note for the weapon audit's reader:** that document's file inventory says `CONS (31)`. It is
> 30 as of `4b1ab50`. Corrected in this pass — see "Corrections to the weapon audit" below.

## B.2 — List 2: Consumables missing from the app

### Coverage delta

**`/wiki/Category:Consumables` reports 54 pages. The app has 30 rows. Delta: 24.**

That delta is *not* 24 missing purchasable items. It decomposes as follows.

#### B.2a — Tarot Cards (~13 pages) — deliberately excluded, but for the wrong stated reason

| | |
|---|---|
| **Wiki index** | `/wiki/Category:Tarot_Cards` |
| **Page paths** | `/wiki/Consumables/The_Chariot`, `/wiki/Consumables/The_World`, … (confirmed live) |
| **Named cards** | The Chariot, The Devil, The Empress, The Fool, The Garden, The Hanged Man, The High Priestess, The Judgement, The Magician, The Pathfinder, The Sun, The Tower, The World `[VERIFY count — issue #37 lists 13 names]` |
| **Introduced** | Update 2.5 ("Web of the Empress") |
| **Status in 2.8.1** | **Permanent.** Not event-limited. |
| **Acquisition** | **Scarce — cannot be bought with Hunt Dollars.** Found in-world (Bileweaver-infested compounds, Postal Supply, Clockmaker's Supply, Sealed Hoard). |
| **Cap behaviour** | Their own 4-per-loadout category, per Update 2.8. |

**The exclusion is correct; the recorded justification is factually wrong.** Commit `077e747`
excluded Tarot Cards on the grounds that they were "a limited-time event item rather than a
permanent roster addition… revisit if/when they become a permanent item." They *are* permanent —
`/wiki/Category:Tarot_Cards` is live, individual card pages are live, and Update 2.8.1 shipped a
balance fix for a Tarot stacking exploit. The stated trigger for revisiting has already fired.

The *durable* reason to exclude them is different and stronger: **they are Scarce and cannot be
purchased with Hunt Dollars**, so they have no price to contribute to a Hunt-Dollar budget planner.
That is precisely the reasoning already applied to `AMMO.special` (`catalog.js:41-44`), where Dolch
and Nitro custom ammo is excluded for being Scarce since 2.8. Two identical judgments; only one is
written down correctly.

**This is a documentation fix, not a data fix.** See ticket reconciliation for #37.

**Caveat the boundary carries:** because Tarot Cards occupy equipment slots and have their own cap
category, a loadout built in the app can never be quite the loadout a player fields. That is an
accepted, statable limit of a dollar-cost planner — it just needs stating.

**Confidence: HIGH** that they are permanent and Scarce. **MEDIUM** on the exact card count.

#### B.2b — The residual delta (~11 pages) — unresolved, and deliberately so

54 total − 30 app rows − ~13 Tarot = **~11 pages unaccounted for.** Search did not enumerate them,
and I will not guess. Candidate explanations, each testable in one crawl:

1. **Removed-item tombstones**, exactly like Tools' Electric Lamp and Multitool. Given Part A's
   result (2 of 23 pages were tombstones, ~9%), this likely accounts for several.
2. **Category redirects and index pages** counted as members.
3. **Genuinely missing purchasable consumables.**

**This is the highest-value crawl target in Part B**, and the honest answer today is a count with
no names attached. The weapon audit made the same call for its ~30 unenumerated pages; the
instruction there applies verbatim here: **seed the crawler from the category index, not from this
document.**

**Confidence: HIGH** on the 54 count. **NONE** on the composition of the residual — stated as an
open question, not a finding.

#### B.2c — What is *not* missing

`077e747` closed the roster gap issue #37 raised: Fire Beetle, Ammo Box, Tool Box, Hellfire Bomb,
Waxed Dynamite Stick, Dark Dynamite Satchel, Poison Bomb, Medical Pack, Recovery Shot, and all four
`(Weak)` Shot variants are present, and `catalog.test.js:65-93` locks their tuples.

A useful independent corroboration: **`/wiki/Category:Healing_Consumables` reports 10 pages**
(Antidote Shots, Medical Pack, Recovery Shot, Regeneration Shots, Stamina Shots, Vitality Shots),
and the app's `Shots` group is **exactly 10 rows** covering exactly those items. The healing roster
is complete and independently confirmed.

## B.3 — List 3: Consumables present with incorrect or outdated data

### B.3.1 — `ammo-box` / "Ammo Box" — **rules bug**

- **File:** `client/src/data/catalog.js:190`
- **Wiki:** `/wiki/Consumables/Ammo_Box`

| Stat | App Value | Expected Wiki Value | Status |
|---|---|---|---|
| `type` | `Throwable` | **Placeable** | **changed — rules bug** |
| cost | `65` | `65` | ok |
| group | `Utility` | *(app-side)* | n/a |

**Patch:** Update 2.8, which introduced Placeables as a distinct cap category.
**Confidence: MEDIUM-HIGH.** The wiki files it under `Category:Placeable_Consumables`, and its own
page describes it as "placed in the world" to be resupplied from.

### B.3.2 — `tool-box` / "Tool Box" — **rules bug**

- **File:** `client/src/data/catalog.js:191`
- **Wiki:** `/wiki/Consumables/Tool_Box`

| Stat | App Value | Expected Wiki Value | Status |
|---|---|---|---|
| `type` | `Throwable` | **Placeable** | **changed — rules bug** |
| cost | `70` | `70` | ok |

**Confidence: MEDIUM-HIGH.** Same evidence shape as B.3.1.

### B.3.3 — `medical-pack` / "Medical Pack" — **rules bug**

- **File:** `client/src/data/catalog.js:185`
- **Wiki:** `/wiki/Consumables/Medical_Pack`

| Stat | App Value | Expected Wiki Value | Status |
|---|---|---|---|
| `type` | `Shot` | **Placeable** | **changed — rules bug** |
| cost | `35` | `35` | ok |
| group | `Shots` | *(app-side)* | see note |

The Medical Pack appears in **both** `Category:Healing_Consumables` (an *effect* category) and
`Category:Placeable_Consumables` (the *cap* category). The app conflated the two, taking the
healing classification and writing it into the field that drives the cap.

**Its `group` of `Shots` is fine** — that is the UI bucket, and grouping it with healing items is
right. Only `type` is wrong. This item is the clearest illustration of why the two must not be
derived from the same wiki signal.

**Confidence: MEDIUM.** Lower than B.3.1/B.3.2 because the dual-category membership makes it the
one case where a careful reader could land either way; the tiebreak is that the game's cap
categories are *mechanical* (how the item is used), not thematic.

### B.3.4 — Why these three are a rules bug and not a typo

Today, a player can equip 4 Ammo Boxes **and** 4 Frag Bombs; the app permits only 4 of the two
combined, because it counts them in the same bucket. Conversely it allows 4 Medical Packs *plus*
4 Ammo Boxes where the game allows 4 Placeables total. The error is bidirectional — it both
over- and under-constrains — which is why it cannot be dismissed as cosmetic.

**Corroborating arithmetic, offered as suggestive rather than probative:**
`/wiki/Category:Throwable_Consumables` reports **17 pages**; the app types **20** rows `Throwable`.
Removing the three above leaves 17. The two sets are not directly comparable — the wiki category
spans items the app lacks and vice versa — so this is a coincidence worth noticing, **not** a proof.
Treat it as a reason to prioritize the check, not as the check.

### B.3.5 — The fix needs a schema decision first

Correcting these three is **not** a three-character edit, because `Placeable` is not a value the app
currently understands. `catCount()` compares `CONS[e.i][3]` against a string, so a new type
propagates cleanly through the cap logic — but:

- `catalog.test.js` asserts exact tuples for `medical-pack` and would need updating in lockstep.
- Whether `Tarot Card` should also be added as a fourth type depends on the B.2a scope call. If
  Tarot Cards stay out, three types suffice; if they ever come in, the field already generalizes.
- No migration is needed. `type` is read positionally out of the *live* catalog at render time and
  is never persisted — `toData()` stores only `["C", id]`. **Unlike `ammoClass`, changing `type`
  cannot corrupt a saved loadout.** This is the rare write-through field with no hidden coupling,
  and it is worth recording as such given ADR-0005's amendment found two that did.

**Confidence: HIGH** on the migration-safety analysis (read directly from `loadoutCodec.js:37`).

### B.3.6 — Whole-table cost verification

| Stat | App Value | Expected Wiki Value | Status |
|---|---|---|---|
| `cost` (all 30) | as authored | `[VERIFY]` | verify |

Same reasoning as A.3.3: verified 2026-08-09 against 2.8.1, with 12 tuples locked by
`catalog.test.js:65-93`. Both spot-checks available (`ammo-box` 65, `tool-box` 70) matched.
**Confidence: MEDIUM-HIGH that this column is broadly correct.**

### B.3.7 — All 30 consumables are missing their stat block

Damage, radius, duration, burn/poison tick values, quantity carried, unlock rank, description —
all absent. **Confidence: HIGH.**

---

# Part C — TRAITS

## C.0 — The comment's claim, tested

`catalog.js:199-205` reads:

> UP costs re-verified against huntshowdown.wiki.gg (current through Update 2.8.1). Update 2.8
> changed exactly three costs (Quartermaster 6→8, Frontiersman 5→6, Hundred Hands 2→3); the rest of
> the old table was stale from the 1.x/2.0 era. "Iron Repeater" was removed from the game (merged
> into Iron Eye, 3 UP, Update 1.15) and "Poison Sense" was renamed to "Pain Sense" (3 UP, Update 2.1).

The brief asked whether this still holds **and** whether the roster is complete. Those two questions
have different answers.

- **The cost claim: holds, and is well-defended.** It is scoped to "UP costs", is one day old, and
  `catalog.test.js:27-49` locks the three changed values plus a full-table cost fixture and the two
  rename assertions. Every trait row also resolved to a live page in the `cd8cda9` run.
- **The roster claim: the comment never makes one — and that is the problem.** It says nothing about
  completeness, and a reader is likely to infer from "the full table is re-audited" (`077e747`'s
  message) that the roster was checked too. **It was not.** See C.2.
- **One embedded factual claim is contradicted by the wiki: "Iron Repeater was removed."** See C.1.

## C.1 — List 1: Traits in the app that no longer exist

**Empty as to rows.** All 32 trait rows resolved to live pages in the `cd8cda9` run, all 32 images
are on disk, and the two documented renames (`Poison Sense` → `Pain Sense`, `Iron Repeater` →
`Iron Eye`) are already applied in place with their legacy positions preserved
(`loadoutCodec.js:133-140`).

**But one claim *about* a removed trait is wrong:**

| Claim in `catalog.js:202-203` | Wiki evidence | Status |
|---|---|---|
| "*Iron Repeater* was removed from the game (merged into Iron Eye, 3 UP, Update 1.15)" | **`Iron Repeater` is a current member of `/wiki/Category:Purchasable_Traits`**, appearing in that category's alphabetical listing alongside `Iron Devastator`, `Iron Eye`, and `Iron Sharpshooter` | **contradicted** |

Hunt 1896 carries a family of weapon-class traits (`Iron Devastator`, `Iron Eye`, `Iron Repeater`,
`Iron Sharpshooter`, `Deadeye Scopesmith`). If `Iron Repeater` is live, then it is not a removal —
it is one of the 26 missing traits in C.2, and the app deleted a real trait on a wrong premise.

**Important: this does not make the code wrong, only the comment and the roster.** Removing the row
was safe and remains safe: `LEGACY_TRAIT_IDS[12]` maps that legacy position to `iron-eye`, and
whatever the truth about Iron Repeater, a legacy record from that era did mean the trait that is
Iron Eye today. Re-adding `Iron Repeater` would be an **append** with a fresh id, never a revival of
the old slot.

**Confidence: MEDIUM-HIGH.** The category membership came from a `Category:Purchasable_Traits`
listing (page furniture, reliable), but I could not open the `Iron Repeater` page to confirm it is
not itself a tombstone — and Part A proved tombstones sit in category listings. **This is exactly
the ambiguity the scraper resolves in one request**, and it should be the first trait page it
fetches.

## C.2 — List 2: Traits missing from the app

### Coverage delta

**`/wiki/Category:Purchasable_Traits` ("All Regular Traits") reports 58 pages. The app has 32 rows.
26 purchasable traits are missing — 45% of the roster.**

The wider `/wiki/Category:Traits` reports **85** traits in total, decomposing as:

| Wiki bucket | Count | Purchasable with UP? | In scope for the app? |
|---|---|---|---|
| **Regular / Purchasable** | **58** | ✅ yes | **✅ yes — this is the target set** |
| Burn | 6 | Only `Necromancer` | Partially — see below |
| Scarce | 14 | ❌ no, world-found only | ❌ no |
| Event | 18 | ❌ (event-gated) | ❌ no |

*(Buckets overlap — most Burn traits are also Scarce — so they do not sum to 85.)*

**The app's roster boundary is coherent, which is worth stating.** Of the 6 Burn traits, exactly one
(`Necromancer`, 4 UP) is purchasable, and it is exactly the one the app carries — at the correct
cost. The app is not missing a *category* of traits; it is missing 26 members of the one category
it does model.

### Named missing traits

**Seed the crawler from `/wiki/Category:Purchasable_Traits`, not from this table.** The list below
is a verified subset assembled from search results — mostly the alphabetical head of the category
listing (A–I) — for prioritization only.

| Trait name | Wiki page path | UP cost | Evidence |
|---|---|---|---|
| Adrenaline | `/wiki/Traits/Adrenaline` | `[VERIFY]` | Purchasable + Defensive listings |
| Assailant | `/wiki/Traits/Assailant` | `1` `[VERIFY]` | Purchasable + Offensive listings |
| Blade Seer | `/wiki/Traits/Blade_Seer` `[VERIFY path]` | `[VERIFY]` | Purchasable listing |
| Blast Sense | `/wiki/Traits/Blast_Sense` `[VERIFY path]` | `[VERIFY]` | Purchasable listing |
| Bloodless | `/wiki/Traits/Bloodless` | `[VERIFY]` | Purchasable + Defensive listings |
| Bulwark | `/wiki/Traits/Bulwark` | `2` `[VERIFY]` | Purchasable + Defensive listings |
| Deadeye Scopesmith | `/wiki/Traits/Deadeye_Scopesmith` `[VERIFY path]` | `[VERIFY]` | Purchasable listing |
| Decoy Supply | `/wiki/Traits/Decoy_Supply` | `[VERIFY]` | Purchasable listing (URL seen in results) |
| Dewclaw | `/wiki/Traits/Dewclaw` `[VERIFY path]` | `[VERIFY]` | Purchasable listing |
| Fast Fingers | `/wiki/Traits/Fast_Fingers` `[VERIFY path]` | `[VERIFY]` | Purchasable + Offensive listings |
| Gator Legs | `/wiki/Traits/Gator_Legs` | `2` `[VERIFY]` | Purchasable + Movement listings |
| Hornskin | `/wiki/Traits/Hornskin` `[VERIFY path]` | `[VERIFY]` | Defensive listing |
| Iron Devastator | `/wiki/Traits/Iron_Devastator` `[VERIFY path]` | `[VERIFY]` | Purchasable listing |
| **Iron Repeater** | `/wiki/Traits/Iron_Repeater` `[VERIFY path]` | `[VERIFY]` | Purchasable listing — **see C.1** |
| Iron Sharpshooter | `/wiki/Traits/Iron_Sharpshooter` `[VERIFY path]` | `[VERIFY]` | Purchasable listing |
| Martialist | `/wiki/Traits/Martialist` | `[VERIFY]` | URL seen in results; Offensive listing |
| Mithridatist | `/wiki/Traits/Mithridatist` | `[VERIFY]` | URL seen in results; Defensive listing |
| Scopesmith | `/wiki/Traits/Scopesmith` `[VERIFY path]` | `[VERIFY]` | Offensive listing |
| Surefoot | `/wiki/Traits/Surefoot` | `[VERIFY]` | URL seen in results; Movement listing |
| Vigor | `/wiki/Traits/Vigor` | `[VERIFY]` | URL seen in results; Defensive listing |

**20 of the 26 named.** The remaining ~6 fall in the J–Z tail of the category listing that search
did not surface. Absence of evidence is not evidence of absence — resolve from the index.

**A useful negative check:** every one of the app's 14 traits whose names fall in the A–I range
(`Ambidextrous`, `Beastface`, `Bolt Thrower`, `Bulletgrubber`, `Conduit`, `Dauntless`,
`Determination`, `Doctor`, `Fanning`, `Frontiersman`, `Ghoul`, `Greyhound`, `Hundred Hands`,
`Iron Eye`) also appears in the wiki's A–I purchasable listing. **The app's traits are all real and
current; they are simply a subset.** This is the same conclusion the weapon audit reached — the app
is current on content, incomplete on coverage.

**Confidence: HIGH** on the 58/32 delta. **HIGH** on the named traits existing.
**LOW** on every UP cost, and on the four page paths marked `[VERIFY path]` (constructed from the
`Traits/{Name}` pattern, not observed).

### Schema check: do missing traits fit the current tuple?

**Yes.** `[id, name, up, group]` accommodates all 26 with no schema change — the only invented
field is `group`, which has no wiki source and must be hand-assigned (see D.2). This is materially
easier than the weapon audit's List 2, which was blocked on a `variantOf` field.

Two caveats worth recording before a bulk import:

- Adding 26 rows nearly doubles the trait picker. `TRAIT_GROUPS` currently has 5 buckets for 32
  traits (~6 each); at 58 that becomes ~12 each, which may want the wiki's finer
  Offensive/Defensive/Movement/Supportive/Solo/Catalyst scheme after all. See D.2 and #42.
- Rows must be **appended, never inserted**, per the `catalog.js` rule — though as established in
  the corrections section below, that rule is now belt-and-braces rather than load-bearing.

## C.3 — List 3: Traits present with incorrect or outdated data

### C.3.1 — The completeness comment

- **File:** `client/src/data/catalog.js:199-205`

| | App Value | Expected | Status |
|---|---|---|---|
| implied roster completeness | "the full table is re-audited" (`077e747`) | 32 of 58 purchasable traits | **misleading** |
| "Iron Repeater was removed from the game" | removed | listed as purchasable | **contradicted** `[VERIFY]` |

**Confidence: HIGH** that the comment invites a false completeness inference. **MEDIUM-HIGH** on
the Iron Repeater contradiction.

### C.3.2 — UP costs

| Stat | App Value | Expected Wiki Value | Status |
|---|---|---|---|
| `up` (all 32) | as authored | `[VERIFY]` | verify — **but see below** |

The strongest-defended column in the entire catalog: re-verified one day ago against 2.8.1, locked
by a full-table fixture in `catalog.test.js:31-41`, with the two spot-checks available from search
(`Necromancer` 4 ✓) agreeing. **Confidence: HIGH that this column is correct.** Lowest-value
scrape target in this audit.

### C.3.3 — All 32 traits are missing description and unlock rank

Effect description, Bloodline unlock rank, and trait classification (Regular/Burn/Scarce) are all
absent. The Regular/Burn/Scarce distinction is worth scraping into `itemStats.json` even though it
is not a catalog field — it is the machine-readable form of the roster boundary C.2 had to
reconstruct by hand. **Confidence: HIGH.**

---

# Part D — Cross-cutting data and rules

## D.1 — `AMMO` / `AMMO_LABEL`

- **File:** `client/src/data/catalog.js:32-46` (`AMMO`), `48-59` (`AMMO_LABEL`)

The weapon audit flagged this "verify all" and did not verify it. **This audit could not verify it
either, and the reason is structural rather than a lack of effort — which is itself the finding.**

### D.1.1 — There is no wiki page to scrape this table from

`AMMO` models ammo as **10 shared per-class pools**, each a list of `[variantName, price]`. The
wiki does not organize ammo that way. Searching for a consolidated price table surfaced:

- `/wiki/Ammo` — describes ammo *types* (FMJ penetration, Incendiary ignition, Poison behaviour)
  in prose. **No price table.**
- `/wiki/Category:Dumdum_Ammo` — titled "**All Dumdum Ammo Weapons**". Likewise
  `Category:Incendiary_Ammo`, `Category:Poison_Ammo`. These are indexes **of weapons**, not of
  ammo variants.

**The wiki models a custom-ammo variant as a per-weapon unlock with a per-weapon price**, living in
the weapon-tree table on each weapon's page — exactly the "Pax High Velocity Ammo" / "Centennial
Dumdum Ammo" rows the weapon audit's §2C identified as page sections rather than pages.

**Therefore the app's shared-pool model is a genuine app-side abstraction with no wiki equivalent,
in the same sense `group` is.** A scraper cannot populate `AMMO` from any single page. It can only
collect per-weapon ammo prices and then either (a) leave `AMMO` alone, or (b) verify that every
weapon in a class quotes the same price — the assumption the pool model silently encodes and which
nobody has ever checked.

**Assessment of the current values: status `verify all`, unchanged from the weapon audit.
Confidence: LOW-MEDIUM.** No specific error identified; no provenance exists; it feeds budget math
directly. The one substantive claim in the table — `special: []`, on the grounds that Dolch and
Nitro custom ammo has been Scarce and unpurchasable since 2.8 — is **consistent with everything
this audit learned about Scarce items** (Tarot Cards, Scarce traits), which raises confidence in
the *judgment* even though the prices remain unverified.

`AMMO_LABEL` is display-only, contains no numbers, and its 10 keys match `AMMO`'s exactly.
**No action. Confidence: HIGH.**

### D.1.2 — The pool model's real hazard is already documented

ADR-0005's amendment records it: ammo selection is persisted as a **bare index** into
`AMMO[ammoClass]` (`loadoutCodec.js:36`, read back at `calc.js:32`). Any change to a *pool's
ordering or length* — not just to a weapon's `ammoClass` — silently re-points every saved selection.
**The amendment covers `ammoClass` changes but not `AMMO` reordering, which has the same shape.**
A scraper that rewrites `AMMO` in bulk needs the same `FORMAT_VERSION` gate. Recorded as an
addition to ADR-0005 below.

## D.2 — The four group taxonomies — explicit verdicts

All four are app-side UI buckets that dispatch picker section headers and SVG fallback icons
(`catalog.js:314-348`). None is a rule. The wiki has its own taxonomies, and they do not match.

**The wiki's actual schemes, for comparison:**

| Category | Wiki's subcategories |
|---|---|
| Tools | Throwable, Placeable, Rending, Healing, Noise, Explosive, Fire, Poison, Vision, Light, Melee |
| Consumables | *(the same scheme)* Throwable, Placeable, Rending, Healing, Noise, Explosive, Fire, Poison, Vision, Light |
| Traits | Regular/Burn/Scarce/Event (acquisition) × Offensive/Defensive/Movement/Supportive/Solo/Catalyst (function) |
| Weapons | by ammo type and slot size |

Note the wiki uses **one unified scheme across Tools and Consumables**, and it is
**multi-valued** — the Medical Pack is both Healing and Placeable. That is the crux.

### Verdicts

**`WEAPON_GROUPS` (`Pistols | Rifles | Shotguns | Melee | Bows`) — DEFENSIBLE. Keep.**
The wiki has no equivalent; organizing by ammo class or slot size would produce buckets a player
does not think in. **Confidence: HIGH.** (Restated from the weapon audit for completeness.)

**`TOOL_GROUPS` (`Medical | Melee | Throwing | Traps | Utility`) — DEFENSIBLE. Keep.**
The wiki's 11 tool subcategories over 21 live tools average under two members each, which is a
worse picker than five buckets of 1/5/3/4/9. The app's scheme is a legitimate coarsening: `Traps`
covers the wiki's Placeable tools, `Throwing` its Throwable tools. **Confidence: HIGH.**
One blemish: `Utility` holds 9 of 22 tools, nearly half. Worth splitting for balance, but that is a
UI judgment, not a correctness finding.

**`CONS_GROUPS` (`Shots | Explosives | Fire | Gas | Utility`) — DEFENSIBLE, WITH ONE CAVEAT. Keep.**
The scheme is sound (`Gas` is a reasonable rename of the wiki's `Poison`; `Shots` maps cleanly onto
`Healing`, confirmed 10-for-10 in B.2c). **The caveat is the one thing that matters:** `group` and
`type` must stay independent. B.3.3 shows what happens when they are conflated — the Medical Pack's
`group` of `Shots` is *right* while its `type` of `Shot` is *wrong*, because one is thematic and the
other is mechanical. **The scraper must never derive `type` from a wiki subcategory that looks
thematic, and must never derive `group` at all.** **Confidence: HIGH.**

**`TRAIT_GROUPS` (`Combat | Medical | Mobility | Stealth | Utility`) — DEFENSIBLE TODAY, BUT AT
58 TRAITS IT NEEDS REVISITING. Keep for now; this is the call issue #42 asked for.**

Issue #42 wondered whether the wiki's `Offensive / Defensive / Movement / Supportive / Solo /
Catalyst` scheme reflects an in-game UI grouping the app should match. **It does not.** It is the
wiki's own functional-classification layer (`Category:Traits/Offensive` and siblings), and it is
**multi-valued** — traits appear under several. It sits alongside a *second*, orthogonal wiki
scheme (Regular/Burn/Scarce/Event) that is about acquisition. Neither is a single-valued UI category
the app can adopt wholesale into a `group` field that renders one section header per item.

So the app's five-bucket scheme is an **intentional, reasonable simplification**, exactly as #42
suspected — not a defect. Two qualifications that keep this from being a bare "won't fix":

1. **It does not scale to C.2's 26 new traits.** 58 traits across 5 buckets is ~12 per section.
   Whoever lands the roster import should reconsider granularity *then*, informed by real counts.
2. **The Regular/Burn/Scarce distinction is genuinely missing and is not cosmetic** — it is the
   boundary that decides which traits belong in the catalog at all (C.2). It belongs in
   `itemStats.json` as scraped metadata, not in `group`.

**Confidence: HIGH** that the wiki scheme is descriptive rather than an in-game UI category, and
that `TRAIT_GROUPS` should not be mechanically realigned to it.

**Cross-cutting rule for the scraper: `group` is unscrapable in all four categories.** A new row's
`group` must be hand-assigned. ADR-0005's amendment already says this for weapons; it holds for all
four.

## D.3 — Loadout rules encoded in code, not data

These are game rules living in a rules engine. **If 2.8 changed one, the fix is a code change with
tests, not a catalog edit** — the distinction the brief asked to be called out explicitly. Verdicts:

| Rule | Location | App behaviour | Wiki | Verdict |
|---|---|---|---|---|
| Weapon slot capacity | `calc.js:5-7` | `5 + (Quartermaster ? 1 : 0)` | 2 weapons within a slot budget; QM grants a large-slot bonus | ✅ **correct** `[VERIFY QM mechanic]` |
| Equipment pool ceiling | `calc.js:13-15` | `8 - blocked` | "up to eight Tools and/or Consumables" | ✅ **correct — confirmed** |
| One-per-Tool | `loadoutSlice.js:45` | duplicate tool rejected | "each Tool has to be a different one" | ✅ **correct — resolves #41** |
| 4-per-consumable-category | `loadoutSlice.js:46` | `catCount(type) >= 4` rejected | "4 instances of the same type (Throwables, Placeables, Shots and Tarot Cards)" | ⚠️ **logic correct, inputs wrong** |
| Trait UP budget | `thunks.js:40`, `uiSlice.js:32` | opt-in, default 10 | "newly recruited Hunters start with 10 Upgrade Points" | ✅ **correct** |
| **Max 15 traits** | *(absent)* | unlimited | "up to 15 Traits" | ❌ **missing constraint** |

### D.3.1 — The 8-slot ceiling is correct

Worth recording because a mid-audit search snippet said "Tools and Consumables have four available
slots", which would have made `slotMax()` wrong by half. **That snippet is pre-2.8 framing.** The
2.8 inventory rework merged the old 4+4 into one pool of 8, and a 4-per-type cap would be nearly
vacuous in a 4-slot pool. `slotMax()` is right. **Confidence: HIGH.**

### D.3.2 — One-per-Tool is still in force (**resolves #41**)

Issue #41 could not confirm whether 2.8's "freely equip any tool or consumable to any slot, in any
combination" relaxed the one-per-Tool rule. **It did not.** The wiki's Tools page states, in the
same breath as the free-placement rule, that **"each Tool has to be a different one"**. The two
statements are about different axes: *placement* is free, *duplication* is not.

`loadoutSlice.js:44-45`'s comment ("re-verified against the wiki as still in force after Update
2.8's equipment-slot rework") is correct and is now independently corroborated.

**Confidence: MEDIUM-HIGH.** Quoted from wiki prose, not an infobox — but it is a direct statement
of the rule, on the page that owns it, and it agrees with the prior verification. Note the
asymmetry that makes this rule coherent: tools are *reusable*, consumables are *single-use*, so a
duplicate tool would be strictly redundant while a duplicate consumable is not.

### D.3.3 — The 4-per-category cap: right logic, wrong inputs

`catCount()`/`addEquip` implement the rule correctly. They are fed a `type` field that models 2 of
the game's 4 categories and misfiles 3 rows (B.3.1–B.3.3). **This is a data fix, not a code fix** —
`catCount()` needs no change once `type` carries `Placeable`. Recorded here because it is the one
place where a data defect surfaces as a rules defect.

### D.3.4 — The 15-trait cap is missing — **new finding**

`addTrait` (`loadoutSlice.js:57-59`) rejects only duplicates. `thunks.js:40` enforces the UP budget
**only when `ui.upBudgetOn` is true, and it defaults to `false`** (`uiSlice.js:28`). So in the
default configuration a user can add all 32 traits — and after C.2's roster import, all 58.

The game permits at most **15**. This is a real missing constraint, and it is a **code change in
the rules engine**, not a catalog edit: a count check in `addTrait`, unconditional (unlike the
opt-in UP budget), plus `randomize.js` needing the same bound.

**Confidence: MEDIUM-HIGH** on the cap's existence and value (stated on both `/wiki/Traits` and
`/wiki/Hunters`); **HIGH** that the app does not enforce it (read from source).

Two design questions for whoever picks this up, flagged rather than answered: whether the 15-trait
cap should be unconditional or ride the same opt-in toggle as the UP budget (the UP budget varies
with hunter level; 15 does not, which argues for unconditional), and whether `blocked` slots
interact with it (they do not — `blocked` is equipment-only).

---

# Scrape Targets Summary

Deduplicated, sorted case-insensitively. Mirrors the weapon audit's format so the two lists
concatenate into one crawler queue. **Index pages first — they supersede the enumerated lists
below and will surface what hand-enumeration missed** (~11 consumable pages, ~6 traits).

**Index pages (crawl first — these are the seed):**

```
/wiki/Category:Consumables
/wiki/Category:Purchasable_Traits
/wiki/Category:Tools
/wiki/Category:Traits
```

**Secondary index pages** (disambiguate the cap categories and the roster boundary — crawl before
acting on any diff):

```
/wiki/Category:Healing_Consumables
/wiki/Category:Placeable_Consumables
/wiki/Category:Rending_Consumables
/wiki/Category:Tarot_Cards
/wiki/Category:Throwable_Consumables
/wiki/Category:Traits/Burn
/wiki/Category:Traits/Event
/wiki/Category:Traits/Scarce
```

**Tool pages (23 — the full category, tombstones included so they can be classified and skipped):**

```
/wiki/Tools/Alert_Trip_Mines
/wiki/Tools/Bear_Traps
/wiki/Tools/Blank_Fire_Decoys
/wiki/Tools/Choke_Bombs
/wiki/Tools/Concertina_Trip_Mines
/wiki/Tools/Decoy_Fuses
/wiki/Tools/Decoys
/wiki/Tools/Derringer_Pennyshot
/wiki/Tools/Dusters
/wiki/Tools/Electric_Lamp
/wiki/Tools/First_Aid_Kit
/wiki/Tools/Flare_Pistol
/wiki/Tools/Fusees
/wiki/Tools/Heavy_Knife
/wiki/Tools/Knife
/wiki/Tools/Knuckle_Knife
/wiki/Tools/Multitool
/wiki/Tools/Poison_Trip_Mines
/wiki/Tools/Quad_Derringer
/wiki/Tools/Spyglass
/wiki/Tools/Throwing_Axes
/wiki/Tools/Throwing_Knives
/wiki/Tools/Throwing_Spear
```

**Cross-category (Tool in the catalog, Weapon on the wiki):**

```
/wiki/Weapons/Katana
```

**Consumable pages (the 30 catalog rows, plus the Tarot pages confirmed by search):**

```
/wiki/Consumables/Ammo_Box
/wiki/Consumables/Antidote_Shot
/wiki/Consumables/Antidote_Shot_(Weak)
/wiki/Consumables/Big_Dynamite_Bundle
/wiki/Consumables/Chaos_Bomb
/wiki/Consumables/Choke_Beetle
/wiki/Consumables/Concertina_Bomb
/wiki/Consumables/Dark_Dynamite_Satchel
/wiki/Consumables/Dynamite_Bundle
/wiki/Consumables/Dynamite_Stick
/wiki/Consumables/Fire_Beetle
/wiki/Consumables/Fire_Bomb
/wiki/Consumables/Flash_Bomb
/wiki/Consumables/Frag_Bomb
/wiki/Consumables/Hellfire_Bomb
/wiki/Consumables/Hive_Bomb
/wiki/Consumables/Liquid_Fire_Bomb
/wiki/Consumables/Medical_Pack
/wiki/Consumables/Poison_Bomb
/wiki/Consumables/Recovery_Shot
/wiki/Consumables/Regeneration_Shot
/wiki/Consumables/Regeneration_Shot_(Weak)
/wiki/Consumables/Stalker_Beetle
/wiki/Consumables/Stamina_Shot
/wiki/Consumables/Stamina_Shot_(Weak)
/wiki/Consumables/Sticky_Bomb
/wiki/Consumables/The_Chariot
/wiki/Consumables/The_World
/wiki/Consumables/Tool_Box
/wiki/Consumables/Vitality_Shot
/wiki/Consumables/Vitality_Shot_(Weak)
/wiki/Consumables/Waxed_Dynamite_Stick
```

> ⚠️ The four `(Weak)` paths are **constructed, not observed** — `[VERIFY path]`. The catalog's
> display names are `"Vitality Shot (Weak)"` etc., and the default resolver only substitutes
> underscores for spaces, so it emits `Vitality_Shot_(Weak)`. Those four images **were** fetched
> successfully in the `cd8cda9` run, which is strong evidence the paths resolve — but parentheses
> in MediaWiki titles are a classic disambiguation-suffix pattern and deserve one explicit probe.

**Trait pages (the 32 catalog rows):**

```
/wiki/Traits/Ambidextrous
/wiki/Traits/Beastface
/wiki/Traits/Bolt_Thrower
/wiki/Traits/Bulletgrubber
/wiki/Traits/Conduit
/wiki/Traits/Dauntless
/wiki/Traits/Determination
/wiki/Traits/Doctor
/wiki/Traits/Fanning
/wiki/Traits/Frontiersman
/wiki/Traits/Ghoul
/wiki/Traits/Greyhound
/wiki/Traits/Hundred_Hands
/wiki/Traits/Iron_Eye
/wiki/Traits/Kiteskin
/wiki/Traits/Levering
/wiki/Traits/Lightfoot
/wiki/Traits/Magpie
/wiki/Traits/Necromancer
/wiki/Traits/Packmule
/wiki/Traits/Pain_Sense
/wiki/Traits/Physician
/wiki/Traits/Pitcher
/wiki/Traits/Quartermaster
/wiki/Traits/Resilience
/wiki/Traits/Salveskin
/wiki/Traits/Serpent
/wiki/Traits/Silent_Killer
/wiki/Traits/Steady_Aim
/wiki/Traits/Vigilant
/wiki/Traits/Vulture
/wiki/Traits/Whispersmith
```

**Missing trait pages (List 2 — prioritization subset; the index supersedes this):**

```
/wiki/Traits/Adrenaline
/wiki/Traits/Assailant
/wiki/Traits/Blade_Seer
/wiki/Traits/Blast_Sense
/wiki/Traits/Bloodless
/wiki/Traits/Bulwark
/wiki/Traits/Deadeye_Scopesmith
/wiki/Traits/Decoy_Supply
/wiki/Traits/Dewclaw
/wiki/Traits/Fast_Fingers
/wiki/Traits/Gator_Legs
/wiki/Traits/Hornskin
/wiki/Traits/Iron_Devastator
/wiki/Traits/Iron_Repeater
/wiki/Traits/Iron_Sharpshooter
/wiki/Traits/Martialist
/wiki/Traits/Mithridatist
/wiki/Traits/Scopesmith
/wiki/Traits/Surefoot
/wiki/Traits/Vigor
```

**Ancillary pages (rules verification and the revision-diff baseline):**

```
/wiki/Ammo
/wiki/Consumables
/wiki/Hunters
/wiki/The_Manual
/wiki/Tools
/wiki/Traits
/wiki/Update/2.8
/wiki/Update/2.8.1
```

---

# Structural concerns for the scraper

Numbered in the weapon audit's form and **deliberately non-overlapping with it** — its twelve
concerns still apply. These are the ways a parser gets a well-formed wrong answer in *these*
categories.

**1. The wiki pluralizes some tool titles; the catalog uses the in-game singular.**
`Tools/Alert_Trip_Mines`, `Tools/Concertina_Trip_Mines`, `Tools/Poison_Trip_Mines` against the
catalog's `"Alert Trip Mine"` etc. All three overrides already exist in `wiki.mjs`. The rule is not
"pluralize placeables" — `Bear_Traps`, `Decoys`, `Fusees`, `Throwing_Knives`, `Throwing_Axes`,
`Choke_Bombs` are plural in the catalog *too*, and `Alert_Trip_Mines` is the only family where the
two disagree. **There is no derivable singular/plural rule. The override table is mandatory.**

**2. Cross-category items exist, and the Katana is not merely a mapping quirk.** It is a Tool in
`TOOLS` and a Weapon on the wiki, resolved by a `Weapons/Katana` override whose value includes the
category segment. Preserve that property. But note the deeper issue (A.3.1): the override makes the
*scrape* work while leaving the *classification* wrong, so a scraper that trusts its own override
table as evidence of correct categorization will never surface it. **An override is a workaround,
not a ratification.**

**3. Category listings contain removed items.** `Category:Tools` has 23 members, of which
**Electric Lamp** (removed in Update 2.0) and **Multitool** (never shipped) are tombstones — 9% of
that category. A crawler diffing the index against the catalog and proposing the difference as
"missing items" will propose re-adding both, and the Electric Lamp is an item this repo already
deleted deliberately (commit `e0076d3`, with a `null` legacy slot held for it). **Discovery diffs
must be classified before they are actioned.** This is the same shape as the weapon audit's
world-weapon concern (#7), generalized: *a page existing does not mean the item exists.* Expect
tombstones in every category, and expect them to be a meaningful fraction of the ~11 unresolved
consumable pages.

**4. The wiki's item subcategories are multi-valued; the catalog's fields are single-valued.**
The Medical Pack is in **both** `Category:Healing_Consumables` and `Category:Placeable_Consumables`.
A parser that assigns `type` from "the item's subcategory" will pick whichever it encounters first
and be right half the time. The cap category is the **mechanical** one (Throwable / Placeable /
Shot / Tarot Card); Healing, Rending, Fire, Poison, Noise, Vision, and Light are **effect**
categories that must never populate `type`. Getting this backwards is a silent rules bug, not a
parse failure — it will never appear in a run summary.

**5. Tools and Consumables share one subcategory scheme across two namespaces.** Both use
Throwable/Placeable/Rending/Healing/Noise/Explosive/Fire/Poison/Vision/Light. A parser keying on
subcategory name alone cannot tell a Throwable *Tool* from a Throwable *Consumable*, and the two
obey different loadout rules (one-per-Tool vs. 4-per-type). **Namespace, not subcategory, decides
which catalog table a row belongs to.**

**6. Search snippets and update pages leak historical values into the present tense.** The
`knife`/`heavy-knife` figures in A.3.2 arrived alongside `/wiki/Update/1.0.3` and
`/wiki/Update/1.4.2` hits, phrased as a reduction from a previous cost. Update pages are
**prose about a change at a point in time** and are structurally indistinguishable from current
values to a naive extractor. **Only the item page's infobox is a current value.** Never parse a
number out of an `/wiki/Update/*` page into a catalog field.

**7. Traits may live in one table rather than on per-trait pages.** `/wiki/Traits` carries a
consolidated table of all traits with UP costs, and individual `Traits/{Name}` pages also exist
(`Traits/Necromancer`, `Traits/Bulwark`, `Traits/Gator_Legs`, `Traits/Martialist` were all confirmed
as real URLs). Two extractors are therefore possible and they can disagree. **Prefer the per-trait
page for the value and use the summary table only to cross-check** — a single table is one edit away
from being wholly wrong, and a mismatch between the two is a useful signal.

**8. Tools and consumables have no variant subpages.** Unlike weapons, paths are exactly two
segments (`Tools/{Name}`, `Consumables/{Name}`, `Traits/{Name}`). The weapon audit's compound-variant
and family-inference concerns (#2, #3) **do not apply here**, and a parser that generalizes them
will look for parents that do not exist. The only three-segment paths in these categories are the
`Category:Traits/Offensive`-style *index* pages, which are not items at all.

**9. Parenthesized display names round-trip through `slugify()` but not obviously through the
URL.** Four consumables carry `(Weak)`. `resolveWikiPath()` emits `Consumables/Vitality_Shot_(Weak)`;
MediaWiki commonly reserves parentheses for disambiguation suffixes. The `cd8cda9` run fetched all
four successfully, so the paths almost certainly resolve — but this is the one place where the
default resolver produces a URL shape the override table has never had to cover. Probe once.

**10. A page returning 200 does not confirm the display name is current.** The image scrape's 122
successes prove every path resolves; MediaWiki serves renamed pages through redirects, so a rename
would still return 200 with an image. **The scraper must read the canonical title from the page
(or follow the redirect chain explicitly) rather than treating fetch success as name validation.**
This is why Part A/B/C's List 1 sections are stated as "no removals" and not as "no renames".
Counter-evidence that redirects are *not* universal: `Tools/Alert_Trip_Mine` needed an override at
all, which means the singular form did **not** redirect to the plural. **Redirect coverage on this
wiki is inconsistent — do not depend on it in either direction.**

**11. Acquisition class decides catalog membership and is not a catalog field.** Tarot Cards and
the 14 Scarce traits are Scarce (world-found, unpurchasable); 18 traits are event-gated. These are
legitimately excluded from a Hunt-Dollar/UP planner, but nothing in the catalog records *why*, so
each roster diff re-litigates it by hand — as issue #37 has now done twice. **Scrape the
Regular/Burn/Scarce/Event classification into `itemStats.json`** so the boundary becomes machine-
checkable. Directly analogous to the weapon audit's world-weapon classification (#7).

**12. `type` is the one write-through field with no hidden coupling — and that is worth
knowing.** ADR-0005's amendment found that display name couples to the image path and `ammoClass`
couples to the saved-ammo index. `CONS[i][3]` couples to neither: it is never persisted
(`toData()` stores `["C", id]`) and never feeds a slug. It can be corrected freely with no
`FORMAT_VERSION` bump. Recorded because the amendment's warning ("check what else reads it
positionally") deserves a documented negative result, so the check is not repeated from scratch.

**13. `AMMO` has no source page — do not try to scrape it.** See D.1.1. The wiki prices custom
ammo per weapon in weapon-tree rows; `Category:Dumdum_Ammo` and siblings index *weapons*, not ammo
variants. A scraper looking for a shared price table will find `/wiki/Ammo`, which is prose, and
either fail or extract something plausible from the wrong place. **Collect per-weapon ammo prices
into `itemStats.json` and leave `AMMO` alone** until the pool model is revisited under its own
decision.

**14. Reordering an `AMMO` pool is a wire-format change.** Ammo selection persists as a bare index
into `AMMO[ammoClass]`. ADR-0005's amendment gates `ammoClass` changes behind a `FORMAT_VERSION`
bump but says nothing about the pools themselves — yet inserting a variant, removing one, or
reordering one has exactly the same effect on every saved loadout. **Same gate, same reason.**

---

# Concrete delta for `scripts/lib/wiki.mjs`

Keyed by catalog `id`, never by display name — ADR-0005's amendment explains why (a name
write-through silently invalidates a name-keyed table, and falls back to a *mostly*-working path,
which is the worst failure mode).

### `WIKI_TITLE_OVERRIDES.tools`

**No additions required.** The existing four (`katana`, `alert-trip-mine`, `concertina-trip-mine`,
`poison-trip-mine`) cover every divergence between the 22 rows and their pages. Confirmed against
the full 23-member category listing in A.2.

Add a comment recording the *negative* result, so the next audit does not redo it:

```js
  tools: {
    // The wiki files the Katana under Weapons even though the catalog treats it as a Tool.
    // NOTE: this override makes the scrape resolve; it does NOT ratify the classification.
    // The Katana is a size-2 melee WEAPON (see docs/audits/equipment-catalog-wiki-audit.md A.3.1).
    katana: "Weapons/Katana",
    // The wiki pluralizes the placeable trap pages; the catalog uses the singular in-game label.
    // Verified complete against /wiki/Category:Tools (23 members, 2026-08-10): these three are
    // the ONLY tools whose wiki title differs from the catalog's display name. Bear Traps,
    // Decoys, Fusees, Throwing Knives/Axes and Choke Bombs are already plural in both.
    "alert-trip-mine": "Tools/Alert_Trip_Mines",
    "concertina-trip-mine": "Tools/Concertina_Trip_Mines",
    "poison-trip-mine": "Tools/Poison_Trip_Mines",
  },
```

### `WIKI_TITLE_OVERRIDES.consumables`

**No additions required**, and the empty object should stay empty — but it currently carries no
explanation, which invites someone to "fix" it. Recommended comment:

```js
  // Empty by verification, not by omission: all 30 consumable rows resolved to
  // Consumables/{display name} in the 2026-08-09 image run (commit cd8cda9), including the four
  // "(Weak)" variants whose titles carry parentheses. See the equipment audit's concern #9 —
  // the parenthesized paths are the only ones worth re-probing if a run starts 404ing.
  consumables: {},
```

### `WIKI_TITLE_OVERRIDES.traits`

**No additions required for the current 32 rows** — all resolved in the `cd8cda9` run.

**Forward-looking note for the C.2 import:** four of the twenty named missing traits have
multi-word names (`Blade Seer`, `Blast Sense`, `Deadeye Scopesmith`, `Decoy Supply`, `Fast Fingers`,
`Gator Legs`, `Iron Devastator`, `Iron Repeater`, `Iron Sharpshooter`). The default
space→underscore resolution should handle all of them, so **do not pre-emptively add overrides** —
add them only for paths a real run proves wrong. Speculative overrides are indistinguishable from
verified ones once written, which is how the `winfield-m1873` bug survived.

### `KNOWN_CATALOG_DUPLICATES`

**No additions.** There are no duplicate rows in `TOOLS`, `CONS`, or `TRAITS`. The one historical
consumable duplicate (`choke-bomb` shadowing the `choke-bombs` tool) was retired in issue #67, and
its id is permanently retired.

### One correction to an existing comment

The `KNOWN_CATALOG_DUPLICATES` docstring is **correct** and should be left alone — see the
corrections section below. It is the *weapon audit* that is stale, not this comment.

---

# Ticket reconciliation

### #37 — "Consumables roster is missing an entire item type (Tarot Cards) and multiple named items"

**Verdict: REWRITE, then close the original.**

- The "multiple named items" half is **done** (`077e747`; verified present and test-locked, B.2c).
- The "entire item type" half was excluded on a **now-falsified premise**. The commit deferred Tarot
  Cards as "a limited-time event item… revisit if/when they become a permanent item." They are
  permanent as of 2.8.1 (B.2a). **The stated revisit trigger has fired**, so leaving the ticket open
  with that rationale attached is actively misleading.
- The **correct** and durable reason to exclude them is that they are **Scarce and unpurchasable
  with Hunt Dollars** — identical to the reasoning already applied to `AMMO.special`.

So: close #37 as delivered, and open a small **documentation** ticket to record the scope boundary
in `catalog.js` next to `CONS`, in the same form the `AMMO.special` comment uses. The roster half is
complete for purchasable items; the ~11 unresolved category pages (B.2b) are a separate discovery
ticket, not a reason to hold this one open.

### #41 — "Max 1 of each Tool per loadout rule may have been relaxed in Update 2.8"

**Verdict: CLOSE. Resolved — the rule still stands.**

The evidence #41 asked for is the wiki's Tools page stating, alongside 2.8's free-placement rule,
that **"each Tool has to be a different one."** Free *placement* and free *duplication* are
different axes, which is the ambiguity the original patch-note phrasing created. The existing code
and its comment (`loadoutSlice.js:44-45`) are correct and now independently corroborated
(D.3.2).

**Confidence: MEDIUM-HIGH**, which I consider sufficient to close a nice-to-have verification
ticket. Stating precisely what would reopen it, as the brief asked: **a direct quote from
`/wiki/Tools` or `/wiki/The_Manual`, read from the live page rather than a search snippet, saying
duplicate tools are permitted** — or an in-game screenshot of two identical tools equipped
simultaneously. Nothing weaker should move it.

### #42 — "Trait group taxonomy may not match current in-game categorization"

**Verdict: CLOSE as "working as intended", with one carve-out spun out.**

The call the ticket asked a human to make (D.2): the wiki's
`Offensive/Defensive/Movement/Supportive/Solo/Catalyst` scheme is the **wiki's own descriptive
functional classification**, not an in-game UI category. It is multi-valued (traits appear under
several) and sits beside a second orthogonal scheme (Regular/Burn/Scarce/Event) about acquisition.
Neither can populate a single-valued `group` field that renders one section header per item.
`TRAIT_GROUPS` is an intentional, reasonable simplification — exactly what the ticket suspected.

The triage bot's separate observation stands and should be fixed while closing: **the rationale was
never written into the tree.** Close #42 by landing the rationale as a comment above `TRAIT_GROUPS`,
citing this audit's D.2.

**Carve-out — do not fold into #42:** the taxonomy should be *revisited* if C.2's 26 missing traits
land, because 58 traits across 5 buckets is ~12 per section. That is a consequence of the roster
import, so it belongs to that ticket, not this one.

---

# Corrections to the weapon audit

The brief asked me to check one stale claim. **It is stale, and it is load-bearing** — ADR-0005
cites the weapon audit as "the closest thing this decision has to an implementation spec".

### The claim

`docs/audits/weapon-catalog-wiki-audit.md` §"Correction (2026-08-10): deleting a duplicate row is
not safe" asserts that `loadoutCodec.js`'s legacy decoder "resolves weapons by **raw array
position** — `fromLegacy()` returns the stored index and uses it directly against the current
`WEAPONS` array", so removing a row "shifts every later weapon down one".

### The verification

**That was true when written and is false now.** Read from `client/src/utils/loadoutCodec.js`:

- Lines 93-142 define four **frozen** tables — `LEGACY_WEAPON_IDS`, `LEGACY_TOOL_IDS`,
  `LEGACY_CONS_IDS`, `LEGACY_TRAIT_IDS` — reconstructed from `catalog.js` at `2a6bd05^`, the last
  commit before the versioned format landed.
- `fromLegacy()` (line 167) resolves through them: `legacyId(LEGACY_WEAPON_IDS, w[0])` yields a
  **stable id**, and only then `indexOfItem(WEAPONS, id)` finds its current position.
- The tables are explicitly documented as a historical record that "MUST NOT be re-sorted or trimmed
  to match edits to `catalog.js`; deleting or reordering a live catalog row is now free, because
  these resolve through stable ids."
- `loadoutCodec.test.js:181-184` asserts every non-null legacy entry still resolves against the live
  catalog — the enforcement the old comment lacked.

**A mid-array deletion therefore cannot shift legacy resolution.** The `catalog.js` "appended, never
inserted" convention is now belt-and-braces rather than the sole protection.

This landed in commit `9fbcba2` ("Pin the legacy catalog order instead of decoding against the live
arrays", issue #68), and **Choke Bomb was retired on that basis** in `4b1ab50` (issue #67) — a
completed, merged mid-array deletion that is the existence proof. `scripts/lib/wiki.mjs`'s
`KNOWN_CATALOG_DUPLICATES` docstring describes this correctly; the weapon audit does not.

**Verified by running the suite:** `catalog.test.js` (24 tests) and `loadoutCodec.test.js`
(32 tests) both pass on this branch — 56 tests, 0 failures. *(Note: `npm ci` required
`--engine-strict=false`; the repo pins Node ^20 and this environment runs v22.22.2.)*

**Confidence: HIGH.** Read directly from source, corroborated by a merged precedent and a green
test suite. No wiki access involved.

### What was corrected

The weapon audit's correction section has been rewritten in place to record the actual constraint
(retiring a row requires a deliberate `LEGACY_*_IDS` decision — resolve to a replacement id or
`null` — enforced by test), and its stale `CONS (31)` count updated to 30. **The recommendation to
retire `winfield-m1873c` is now unblocked**, and its sequencing item has been updated to say so.

---

# Proposed issue list

Not filed — for review first. Ordered by severity, then by whether they are blocked on a scrape.

| # | Title | Severity | Label | "Done" means |
|---|---|---|---|---|
| 1 | Consumable `type` misfiles three rows into the wrong 4-per-category cap bucket | **should-fix** | `data` | `Placeable` exists as a `CONS` type; `ammo-box`, `tool-box`, `medical-pack` carry it; `catalog.test.js` locks all three tuples and asserts a 5th Placeable is rejected while a 5th Throwable alongside 4 Placeables is allowed. |
| 2 | Katana is modelled as a Tool but is a size-2 melee Weapon | **should-fix** | `data` | Either the row moves to `WEAPONS` with a documented migration for `["T","katana"]` in **both** `fromV1` and `LEGACY_TOOL_IDS[6]`, and `katana.png` moves to `images/weapons/`; **or** a comment records why it deliberately stays a Tool. Not left silently wrong. |
| 3 | Trait roster is 32 of 58 purchasable traits | **should-fix** | `data` | `/wiki/Category:Purchasable_Traits` is crawled and diffed; every missing purchasable trait is appended with a hand-assigned `group`; the `TRAITS` comment states roster coverage explicitly, not just cost provenance. |
| 4 | `catalog.js` claims Iron Repeater was removed; the wiki lists it as purchasable | **should-fix** | `data` | `/wiki/Traits/Iron_Repeater` is fetched. Either the comment is corrected and the trait is appended with a **new** id, or the page is confirmed a tombstone and the comment cites that. `LEGACY_TRAIT_IDS[12]` stays `iron-eye` either way. |
| 5 | The 15-trait cap is not enforced | **should-fix** | `bug` | `addTrait` rejects a 16th trait unconditionally (not gated on `upBudgetOn`); `randomize.js` respects the same bound; both covered by tests. |
| 6 | Weapon audit's "deleting a duplicate row is not safe" correction is stale | **should-fix** | `docs` | ✅ **Done in this pass.** Section rewritten against `loadoutCodec.js`; `CONS` count fixed to 30; sequencing item updated. |
| 7 | Record the Tarot Card / Scarce-item scope boundary in `catalog.js` | nice-to-have | `docs` | A comment above `CONS` states Tarot Cards are excluded as **Scarce/unpurchasable** (not as "event items"), mirroring the `AMMO.special` comment. #37 closes on it. |
| 8 | Record the `TRAIT_GROUPS` taxonomy rationale in the tree | nice-to-have | `docs` | A comment above `TRAIT_GROUPS` explains why the wiki's multi-valued functional scheme is not adopted, citing D.2. #42 closes on it. |
| 9 | Close #41 — the one-per-Tool rule is confirmed still in force | nice-to-have | `data` | #41 closed with the `/wiki/Tools` "each Tool has to be a different one" evidence recorded in the closing comment. |
| 10 | Resolve the ~11 unaccounted-for `Category:Consumables` pages | nice-to-have | `data` | The 54 category members are enumerated and each is classified live / tombstone / Tarot / non-item. Genuinely missing purchasables get rows. |
| 11 | `AMMO` has no provenance and no scrapable source page | nice-to-have | `data` | Either per-weapon ammo prices are collected into `itemStats.json` and the pool model is confirmed (all weapons in a class agree), or an ADR revisits the shared-pool model. Includes the `FORMAT_VERSION` gate for pool reordering (concern #14). |
| 12 | Teach the scraper that category listings contain removed items | nice-to-have | `enhancement` | A discovery diff classifies each unmatched page before proposing it; Electric Lamp and Multitool are skipped by name with a recorded reason, the way world weapons are. |
| 13 | Split `TOOL_GROUPS`' `Utility` bucket | nice-to-have | `enhancement` | `Utility` holds 9 of 22 tools; no bucket exceeds ~5 after the split. Pure UI, no rules impact. |

**Sequencing note.** Items 1, 5, and 6 need no wiki access — 1 and 5 are decided by evidence in this
document plus the repo, and 6 is already done. Items 2, 3, 4, and 10 are blocked on a scrape and
should follow the first `scrape-stats.mjs` run rather than being hand-transcribed from the tables
above. That ordering is ADR-0005's whole point.
