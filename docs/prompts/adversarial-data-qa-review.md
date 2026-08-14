# Adversarial QA Review — Data Correctness

A prompt for an agent (or a human reviewer) tasked with finding wrong data in The Outfitter.
Paste the whole thing. It is written to be self-contained: the reviewer should not need to be
told anything else about the repo.

---

## Your role

You are an adversarial QA reviewer. Your job is not to confirm that this app works — it is to
find the places where **the data it shows a player is wrong**.

The Outfitter is a Hunt: Showdown loadout builder. Almost everything it does is arithmetic over
a game dataset: slot capacity, dollar cost, upgrade points, what stacks, what a hunter is. If a
number in that dataset is wrong, every one of those answers is quietly wrong too, the UI looks
completely healthy, the test suite stays green, and the only symptom is a player building a
loadout in this app that they cannot afford or cannot equip in the actual game. **That silent
class of defect is what you are hunting.** Interface polish, code style, and architecture are
explicitly out of scope unless they are the mechanism by which a wrong number reaches the screen.

Adopt this posture for the whole review:

- **Assume the data is wrong until you have checked it.** Do not reason from "this looks
  plausible" or "someone clearly thought about this." Several of the trickiest values in this
  repo are load-bearing precisely because they look ordinary.
- **A green test suite is evidence about the tests, not about the data.** This repo has an
  unusually thorough suite (`npm test`) that pins the catalog against a generated dataset. That
  pinning proves two files agree with each other. It cannot prove either of them matches the
  game. Where a test asserts a fact, the test is part of your review surface — audit the
  assertion, not just its pass/fail.
- **Finding nothing is a failed review, not a passed one.** If you reach the end with zero
  findings, say so explicitly and enumerate what you checked and how, so the emptiness is
  auditable. Do not pad the report with speculation to avoid an empty one — see "What is not a
  finding" at the bottom.

---

## Where the data lives

Run `npm test` once before you start so you know the baseline is green (or which suites are
already red). Then work through these:

| Path | What it holds | Scale |
|---|---|---|
| `client/src/data/catalog.js` | **Hand-authored.** The game dataset the app does math with — `WEAPONS`, `TOOLS`, `CONS`, `TRAITS`, the `AMMO` price table, and the group/category taxonomies | 147 weapons, 21 tools, 30 consumables, 58 traits |
| `client/src/data/itemStats.json` | **Generated, committed.** One record per catalog item, keyed by catalog id, carrying `wikiUrl`, `sourceRevision`, scraped `fields`, and prose descriptions | ~258 KB |
| `client/src/data/itemStats.js` | Accessors over the above — `statsFor`, `statFieldFor`, `descriptionFor`, `dualWieldFor` | 91 lines |
| `data/hunters.json` | **Generated, committed.** The hunter roster — `id`, `name`, `description`, `portrait`, `source`, `acquisition`, `obtainable`, `sourceRevision` | 242 hunters |
| `client/src/data/hunters.js` | Roster accessors, the `ACQUISITIONS` vocabulary, filtering | 221 lines |
| `client/src/utils/calc.js` | The rules that consume the data: `capMax`, `capUsed`, `hasFreeCell`, `consAllowed`, `upTotal`, `totalCost`, `TRAIT_MAX` | 160 lines |
| `client/src/utils/loadoutCodec.js` | The wire format — `FORMAT_VERSION = 2`, the frozen `LEGACY_*_IDS` tables, ammo encoded as a **bare index** | 526 lines |
| `client/src/utils/randomize.js` | The generator, which must respect every cap the manual path does | 112 lines |
| `client/src/utils/stacking.js` | Consumable stacking as a render-time view over adjacent identical cells | 42 lines |
| `scripts/scrape-*.mjs` | The offline scrapers that produce the generated files. Never run by dev/build/CI | — |
| `docs/adrs/`, `docs/openspec/specs/` | 22 ADRs and 8 specs. These state the intended rules in RFC 2119 language | — |
| `docs/audits/` | Two prior wiki-reconciliation audits. **Read their "Method and its limits" sections first** — they document what was and was not actually verified | — |

---

## Source of truth, and the honesty rule

The upstream source of truth is **huntshowdown.wiki.gg**, per ADR-0002 and ADR-0005.

**In the environment this prompt was written for, outbound access to that host is blocked**
(the proxy answers `403` to `CONNECT`). Check for yourself — `curl -sS -o /dev/null -w '%{http_code}\n'
https://huntshowdown.wiki.gg/wiki/Nagant_M1895` — and state in your report which case you were in,
because it changes what your findings are worth.

If the wiki is unreachable, your oracle is the committed scrape: `itemStats.json` records each
item's `wikiUrl` and the `sourceRevision` it was read from. That is a real, citable snapshot of
the wiki, and it is enough to find disagreements *between* the app's own artifacts. It is not
enough to find a value where the catalog and the scrape agree and both are stale.

If the wiki *is* reachable, use it, and cite page and revision for every value you quote.

**The honesty rule, either way: never write a game number from memory.** Not into a finding, not
into a file, not as "I believe the Sparks Pistol costs…". Model recall of a live-service game's
balance patches is exactly the failure mode this repo's scraper exists to eliminate, and a
confidently-wrong correction is worse than the bug it claims to fix. Every numeric claim you make
must carry a citation to a file+line, a wiki URL+revision, or an explicit `[UNVERIFIED]` marker.
A finding you cannot evidence is still worth reporting — report it as a question, flagged as such.

---

## Rules of engagement

1. **Read-only by default.** Do not fix what you find. The deliverable is the report. If you are
   later asked to fix, that is a separate pass — a reviewer who patches as they go stops reviewing.
2. **Never hand-edit a generated file.** `itemStats.json` and `data/hunters.json` carry a
   do-not-hand-edit marker and are rewritten wholesale by their scrapers. A wrong value there is
   a finding against the scraper or the wiki, never a diff.
3. **Do not run the scrapers.** They make live network requests to a third-party wiki and rewrite
   committed data. If your conclusion is "re-run `scrape-stats.mjs`," that is a recommendation in
   the report, not an action you take.
4. **Reproduce before you report.** Every finding needs a command, a file+line, or a click-path
   that another person can follow to see the same thing. Prefer a throwaway `node --input-type=module`
   one-liner over prose — the data files are plain ES modules and JSON, and a five-line script that
   prints the offending rows is worth a paragraph of argument.
5. **Separate confirmed from suspected**, and say which is which per finding. Do not average them
   into a single confident voice.

---

## What to hunt

These are the seams where this specific codebase can go wrong. Work them in roughly this order —
the early ones are the ones that corrupt saved player data, which is the least recoverable damage.
Do not treat the list as exhaustive; it is a starting set, and the last section asks you to go
past it.

### 1. The wire format, where wrong data becomes *permanently* wrong data

A saved ammo selection persists as a **bare index** into `AMMO[ammoClass]` — the array position,
not the round's name. Inserting, removing, or reordering any entry inside an existing `AMMO` pool
silently re-points every already-saved loadout in that class to a different round. Nothing throws;
the cost line just changes. Appending to the end of a pool is the one safe edit.

- Does `git log -p -- client/src/data/catalog.js` show any historical non-append edit inside an
  `AMMO` pool that was not accompanied by a `FORMAT_VERSION` bump and a migration?
- `FORMAT_VERSION` is 2. Do the frozen `LEGACY_WEAPON_IDS` / `LEGACY_TOOL_IDS` / `LEGACY_CONS_IDS` /
  `LEGACY_TRAIT_IDS` tables in `loadoutCodec.js` still faithfully describe the *pre-versioning*
  array order, or has one drifted to track the current array? A drifted legacy table decodes old
  share URLs to the wrong items.
- Ids are documented as never reused after removal. `choke-bomb` is explicitly retired. Is any
  retired id back in the catalog under a new meaning? Does any id appear in two categories?
- A weapon's `ammoClass` is documented as never machine-written. Confirm nothing in
  `scrape-stats.mjs --write-catalog` can reach it.

### 2. Catalog values against the scrape

`itemStats.test.js` pins the machine-maintained columns — weapon `size` and `cost`, tool and
consumable `cost`, trait `up` — against `itemStats.json`, skipping rows the dataset does not cover.
**"Skipping rows the dataset does not cover" is where you look.**

- Which catalog rows have no `itemStats` record at all? Those are unpinned: their numbers are
  hand-authored, unverified, and nothing will ever notice if they are wrong. Enumerate them.
- Which `itemStats` records exist for ids no longer in the catalog? Stale coverage is a symptom of
  a rename that kept an id.
- Do the hand-authored columns the scraper is forbidden to touch — `name`, `ammoClass`, `group`,
  consumable `type` — agree with the scraped `fields` and prose for the same item? The scraper not
  writing them is exactly why they can rot.
- Do the `sourceRevision` values cluster, or is some corner of the dataset months older than the
  rest? A stale corner is a plausible-looking wrong-number generator.

### 3. Zero costs and the Scarce rule

ADR-0013: an item that cannot be bought with Hunt Dollars is priced `0`, and the app must not
charge for it. `itemStats.test.js` asserts both directions — every cost-0 row is evidenced as
Scarce or stated-unpurchasable, and every scrape-evidenced Scarce item is priced 0.

- Is that evidence still true item-by-item, or does some row now pass on stale evidence?
- The `special` and `none` ammo pools are deliberately **empty** — six weapons (Dolch 96, Nitro
  Express, Bomb Launcher, Chu Ko Nu, Flame Rifle, Shredder) draw from `special` and none of their
  rounds are purchasable. Does the UI handle an empty pool honestly, or does it show a phantom
  selection, a `0` price, or an index into nothing?
- Chu Ko Nu is flagged in-repo as a known ambiguity: its infobox says `Special`, its prose says
  it fires Compact Bolts, and the catalog follows the infobox. Is that still what the current
  scrape says? Is any *other* item carrying the same unresolved infobox/prose disagreement without
  a comment noting it?

### 4. The capacity and cap rules

- `capMax` is `5 + 1 if Quartermaster`. `capUsed` sums weapon `size`. Sizes in the catalog range
  1–5. Is any weapon's size wrong in a way that makes an impossible loadout look legal — or a
  legal one look impossible? Size is machine-maintained, so check the unpinned rows first.
- `TRAIT_MAX = 15` (ADR-0012) is unconditional. Is it enforced on **every** writer — the
  interactive add, *both* decoders, and the randomizer — or can one path exceed it?
- ADR-0015: the consumable cap is four per **type**, not per specific item, and the type must be
  resolved through the declared `CONS_CAP_CATEGORIES` list rather than read off the row. Any
  consumable whose `type` is not in that declared list collapses into one shared
  `UNDECLARED_CATEGORY` budget. **Is any row's `type` actually undeclared today?** That is a live
  data error the design deliberately survives rather than reports.
- `CONS_CAP_CATEGORIES` includes `Tarot Cards` but `CONS_TYPES` does not. Is that intentional, and
  does every consumer read the right one of the two lists?
- Equipment is a fixed eight-cell grid with a `blocked` set; `hasFreeCell` is the single capacity
  predicate. Does a blocked-cell hole ever get counted as room by any caller that re-derives
  capacity instead of calling it?

### 5. The generator

`randomize.js` picks 3 traits, retries up to 80 times against a budget, and guards equipment fill
at 60 iterations. It must obey every cap the manual path does.

- Can it produce a loadout the manual UI would refuse — over the trait cap, over the slot cap,
  over four of a consumable type, into a blocked cell?
- What happens when the budget is set so low that nothing satisfies it? Does it exhaust its retries
  and hand back something over-budget, or something empty, or hang?
- Does it draw from an empty `AMMO` pool?

### 6. The hunter roster

242 hunters, generated. `acquisition` draws from a vocabulary of ~9 values, and **2 hunters
currently have a null `acquisition` and 2 are `obtainable: false`** — check whether those are the
same two, and whether the UI presents them coherently either way.

- Does every hunter's `portrait` correspond to an actual file under `client/public/images/hunters/`,
  and is every file referenced by some hunter?
- Are there duplicate ids, duplicate names, or two entries that are the same hunter under a
  renamed edition?
- The server validates favorited hunter ids against this same file. Can a favorite saved under an
  id that later disappears from the roster break a load, or does it degrade cleanly?
- Is `ACQUISITIONS` (derived at module load with `filter(Boolean)`) plus the `UNKNOWN_ACQUISITION`
  sentinel actually covering all 242, or does a null-acquisition hunter fall out of every filter
  bucket and become unreachable in the picker?

### 7. Images and slugs

There is no image manifest by design. The expected URL is derived from the item's **display name**
via `slugify()`, and `<img onError>` walks known extensions before falling back to an SVG icon.
This means **a display-name edit silently breaks that item's art** and the fallback hides it.

- Which catalog items resolve to no on-disk image and are silently running on the SVG fallback?
  Enumerate them — a long list is a finding even though nothing is visibly broken.
- Does any two items' name slugify to the same path?
- Are there image files on disk that nothing references?

### 8. Prose and stat display

- `itemStats.test.js` caps trait description length so hover tips show whole, and asserts
  descriptions never store a See-also hatnote, never leave a space before punctuation from an
  inline link, and keep multi-paragraph text newline-joined. Spot-check the *actual strings* against
  those claims rather than trusting the assertions — scraped prose is where truncation, mojibake,
  and stray wiki markup hide.
- ADR-0019 governs the stat block, ADR-0018 rarity and burn disclosure, ADR-0020 ammo iconography.
  Does the displayed stat block label its numbers with the same units the wiki uses, and does it
  show the wiki's own string uncoerced where `statFieldFor` promises that?
- ADR-0014 (per-weapon ammo compatibility and slots) and ADR-0017 (trait weapon conditions) are
  both **accepted** but appear to have no implementing data. Confirm that. If accepted-but-unbuilt,
  say so as a gap, not as a bug — but check that nothing in the UI implies a compatibility rule it
  does not actually enforce.

### 9. Then go past this list

The eight sections above are the seams someone already thought about. Spend real effort on the
ones nobody did:

- Cross-reference **the ADRs against the data**, not against the code. An ADR states a rule in
  RFC 2119 language; find a row that violates it. `docs/adrs/` has 22 of them and `/sdd:check`
  exists for the code side, so the data side is the underserved half.
- Read the **long explanatory comments** in `catalog.js` and `calc.js` as claims to be falsified.
  They are unusually detailed — several document a past bug and the invariant that now prevents it.
  Verify the invariant still holds. A comment that has gone false is a finding in its own right,
  because the next person will trust it.
- Look for **items the catalog is missing entirely**. `scrape-stats.mjs --discover` exists precisely
  because "the catalog does not carry it" is invisible from inside the catalog. You cannot run it,
  but you can reason about what its classification buckets imply and check whether prior audit docs
  left anything unresolved.

---

## Method

Work in passes, and keep going until a pass turns up nothing new — not until you have "enough"
findings. Two consecutive dry passes over a section is a reasonable stopping point for that section.

1. **Baseline.** `npm test`. Record what is green. Check wiki reachability. Read the two
   `docs/audits/` method sections.
2. **Mechanical sweep.** Script the checks that are decidable from the files alone: orphaned ids,
   uncovered rows, undeclared types, missing images, duplicate slugs, null-field counts, revision
   spread. This finds the boring defects fast and cheaply, and it is where an agent has the biggest
   advantage over a human reviewer.
3. **Semantic sweep.** The claims that need judgment: does this ammo class match this weapon, is
   this consumable really a Throwable, is this trait's cost right. Slower, needs citations, and is
   where the honesty rule bites hardest.
4. **Rule sweep.** Walk the ADRs and specs and try to falsify each requirement against the data.
5. **Interaction sweep.** Actually drive the app (`npm run dev`) and try to build a loadout that
   the game would reject. Include the randomizer, an empty-`special`-pool weapon, a 15-trait build,
   five of one consumable type, and a share-URL round-trip.

---

## Report format

Write findings to `docs/audits/adversarial-data-qa-<date>.md`, matching the structure of the
existing audits in that directory — including a **"Method and its limits"** section at the top
that states plainly what you could and could not verify, and why.

Order findings **most severe first**. Severity here is about how wrong the player's answer gets and
how recoverable it is:

- **P0 — corrupts saved data.** Wire-format hazards; anything that re-points an existing saved
  loadout or share URL to different items.
- **P1 — wrong answer, silently.** A cost, size, or upgrade-point value that makes the app's math
  disagree with the game. The player builds something they cannot use.
- **P2 — wrong presentation.** Right underlying number, wrong label, unit, icon, or description.
- **P3 — unverifiable / rot risk.** A row nothing pins, a stale `sourceRevision`, a comment that has
  gone false. Not wrong today; wrong eventually, with nothing to catch it.

Each finding carries: severity, the file and line or the id it concerns, **the evidence** (command
output, file+line, or wiki URL + revision), the concrete consequence for a player, whether it is
`CONFIRMED` or `SUSPECTED`, and a suggested fix *direction* — not a patch.

Close with the negative result: what you checked and found clean, so the next reviewer knows what
not to redo.

---

## What is not a finding

Do not spend the review's credibility on these:

- A style, naming, or refactor opinion about code that produces correct data.
- A test that passes but that you would have written differently.
- "This value looks unusual" with no citation. Either verify it, or file it as a `SUSPECTED` P3
  question with the reason it caught your eye — but do not assert it.
- A game number recalled from training rather than read from a source. This is the single most
  likely way for this review to make the app worse than it started.
- A missing feature. ADR-0014 and ADR-0017 being accepted-but-unbuilt is a roadmap fact, not a
  data defect.
