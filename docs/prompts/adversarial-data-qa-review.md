# Adversarial QA Panel Review — Data Correctness

A prompt for a **panel** tasked with finding wrong data in The Outfitter: five reviewers holding
distinct charges, working independently, then cross-examining each other, then a chair who
consolidates. Paste the whole thing to every participant. It is written to be self-contained — no
seat should need to be told anything else about the repo.

**How to run it.** Each seat needs its own context: separate agent instances, separate sessions, or
separate people. The mechanism does not matter; **the independence does**. A seat that reads another
seat's findings before filing its own is no longer a second opinion, it is an echo. If you are
orchestrating agents, launch the five seats concurrently with no shared scratch space, collect their
filings, and only then open Round 2.

---

# Part I — The common brief

*Every seat reads this. Nothing in it is optional.*

## Your role

You are an adversarial QA reviewer. Your job is not to confirm that this app works — it is to find
the places where **the data it shows a player is wrong**.

The Outfitter is a Hunt: Showdown loadout builder. Almost everything it does is arithmetic over a
game dataset: slot capacity, dollar cost, upgrade points, what stacks, what a hunter is. If a number
in that dataset is wrong, every one of those answers is quietly wrong too, the UI looks completely
healthy, the test suite stays green, and the only symptom is a player building a loadout in this app
that they cannot afford or cannot equip in the actual game. **That silent class of defect is what the
panel exists to catch.** Interface polish, code style, and architecture are out of scope unless they
are the mechanism by which a wrong number reaches the screen.

Adopt this posture:

- **Assume the data is wrong until you have checked it.** Do not reason from "this looks plausible"
  or "someone clearly thought about this." Several of the trickiest values in this repo are
  load-bearing precisely because they look ordinary.
- **A green test suite is evidence about the tests, not about the data.** This repo has an unusually
  thorough suite (`npm test`) that pins the catalog against a generated dataset. That pinning proves
  two files agree with each other. It cannot prove either matches the game. Where a test asserts a
  fact, the assertion is part of your review surface.
- **Finding nothing is a failed seat, not a passed one.** If you reach the end of your charge with
  zero findings, say so explicitly and enumerate what you checked and how, so the emptiness is
  auditable. Do not pad your filing to avoid an empty one — Round 2 will strip padding out and the
  panel will see it.

## Where the data lives

Run `npm test` once before you start so you know the baseline is green (or which suites are already
red). Then work the surfaces your charge covers:

| Path | What it holds | Scale |
|---|---|---|
| `client/src/data/catalog.js` | **Hand-authored.** The game dataset the app does math with — `WEAPONS`, `TOOLS`, `CONS`, `TRAITS`, the `AMMO` price table, and the group/category taxonomies | 147 weapons, 21 tools, 30 consumables, 58 traits |
| `client/src/data/itemStats.json` | **Generated, committed.** One record per catalog item, keyed by catalog id, carrying `wikiUrl`, `sourceRevision`, scraped `fields`, and prose descriptions | ~258 KB |
| `client/src/data/itemStats.js` | Accessors — `statsFor`, `statFieldFor`, `descriptionFor`, `dualWieldFor` | 91 lines |
| `data/hunters.json` | **Generated, committed.** The hunter roster — `id`, `name`, `description`, `portrait`, `source`, `acquisition`, `obtainable`, `sourceRevision` | 242 hunters |
| `client/src/data/hunters.js` | Roster accessors, the `ACQUISITIONS` vocabulary, filtering | 221 lines |
| `client/src/utils/calc.js` | The rules that consume the data: `capMax`, `capUsed`, `hasFreeCell`, `consAllowed`, `upTotal`, `totalCost`, `TRAIT_MAX` | 160 lines |
| `client/src/utils/loadoutCodec.js` | The wire format — `FORMAT_VERSION = 2`, the frozen `LEGACY_*_IDS` tables, ammo encoded as a **bare index** | 526 lines |
| `client/src/utils/randomize.js` | The generator, which must respect every cap the manual path does | 112 lines |
| `client/src/utils/stacking.js` | Consumable stacking as a render-time view over adjacent identical cells | 42 lines |
| `client/public/images/` | `weapons/`, `tools/`, `traits/`, `consumables/`, `hunters/` (242 AVIF portraits) | — |
| `scripts/scrape-*.mjs` | The offline scrapers that produce the generated files. Never run by dev/build/CI | — |
| `docs/adrs/`, `docs/openspec/specs/` | 22 ADRs and 8 specs, stating the intended rules in RFC 2119 language | — |
| `docs/audits/` | Two prior wiki-reconciliation audits. **Read their "Method and its limits" sections first** — they document what was and was not actually verified | — |

## Source of truth, and the honesty rule

The upstream source of truth is **huntshowdown.wiki.gg**, per ADR-0002 and ADR-0005.

**In the environment this prompt was written for, outbound access to that host is blocked** (the
proxy answers `403` to `CONNECT`). Check for yourself — `curl -sS -o /dev/null -w '%{http_code}\n'
https://huntshowdown.wiki.gg/wiki/Nagant_M1895` — and state in your filing which case you were in,
because it changes what your findings are worth.

If the wiki is unreachable, your oracle is the committed scrape: `itemStats.json` records each item's
`wikiUrl` and the `sourceRevision` it was read from. That is a real, citable snapshot, and it is
enough to find disagreements *between* the app's own artifacts. It is not enough to find a value
where the catalog and the scrape agree and both are stale.

If the wiki *is* reachable, use it, and cite page and revision for every value you quote.

### The honesty rule

**Never state a game number from memory.** Not in a finding, not in a file, not as "I believe the
Sparks Pistol costs…". Recall of a live-service game's balance patches is exactly the failure mode
this repo's scraper exists to eliminate, and a confidently-wrong correction is worse than the bug it
claims to fix. Every numeric claim carries a citation to a file+line, a wiki URL+revision, or an
explicit `[UNVERIFIED]` marker. A finding you cannot evidence is still worth filing — file it as a
question, flagged as such.

### The correlated-recall trap — read this twice

This is the specific way a panel fails, and it is worse than the way a single reviewer fails.

Five reviewers drawing on the same training data can produce the **same wrong game number
independently**, then corroborate each other in Round 2, and the agreement will look like exactly the
signal a panel is built to produce. It is not signal. It is one error counted five times.

Therefore: **agreement between seats is worth nothing unless each seat cites a source.** In Round 2,
"the other reviewer found the same thing" is not a confirmation — ask what they cited. If the answer
is recall, both findings collapse to `SUSPECTED` together. Two seats citing the same
`itemStats.json` record is one piece of evidence, not two. Two seats citing *different* evidence for
the same conclusion is the real thing, and is worth flagging as high-confidence.

## Rules of engagement

1. **Read-only.** Do not fix what you find. The deliverable is the report. A reviewer who patches as
   they go stops reviewing, and a panel that patches concurrently corrupts everyone else's baseline.
2. **Never hand-edit a generated file.** `itemStats.json` and `data/hunters.json` carry a
   do-not-hand-edit marker and are rewritten wholesale by their scrapers. A wrong value there is a
   finding against the scraper or the wiki, never a diff.
3. **Do not run the scrapers.** They make live requests to a third-party wiki and rewrite committed
   data. "Re-run `scrape-stats.mjs`" is a recommendation in the report, not an action you take.
4. **Reproduce before you file.** Every finding needs a command, a file+line, or a click-path another
   seat can follow to see the same thing. Prefer a throwaway `node --input-type=module` one-liner
   over prose — the data files are plain ES modules and JSON, and five lines that print the offending
   rows beat a paragraph of argument, and survive cross-examination better.
5. **Separate `CONFIRMED` from `SUSPECTED`** on every finding. Do not average them into one
   confident voice.
6. **Stay in your seat during Round 1.** If you notice something outside your charge, note it in a
   short "handoff" section rather than investigating — another seat owns it, and duplicated effort
   costs the panel its coverage. Handoffs are read by the chair, not by the other seats, until
   Round 2.

---

# Part II — The seats

Five charges. They overlap at the edges on purpose: where two seats reach the same row from different
directions, independent agreement is the strongest evidence this panel can produce. Each seat works
its charge to exhaustion — until a full pass turns up nothing new, not until it has "enough" findings.

## Seat 1 — Persistence and the wire format

*The most severe seat. You own the defects that corrupt data a player already saved.*

A saved ammo selection persists as a **bare index** into `AMMO[ammoClass]` — the array position, not
the round's name. Inserting, removing, or reordering any entry inside an existing `AMMO` pool
silently re-points every already-saved loadout in that class to a different round. Nothing throws;
the cost line just changes. Appending to the end of a pool is the one safe edit.

- Does `git log -p -- client/src/data/catalog.js` show any historical non-append edit inside an
  `AMMO` pool that was not accompanied by a `FORMAT_VERSION` bump and a migration?
- `FORMAT_VERSION` is 2. Do the frozen `LEGACY_WEAPON_IDS` / `LEGACY_TOOL_IDS` / `LEGACY_CONS_IDS` /
  `LEGACY_TRAIT_IDS` tables in `loadoutCodec.js` still faithfully describe the *pre-versioning* array
  order, or has one drifted to track the current array? A drifted legacy table decodes old share URLs
  to the wrong items.
- Ids are documented as never reused after removal; `choke-bomb` is explicitly retired. Is any retired
  id back under a new meaning? Does any id appear in two categories?
- A weapon's `ammoClass` is documented as never machine-written. Confirm nothing in
  `scrape-stats.mjs --write-catalog` can reach it.
- Round-trip a share URL and a localStorage record through both decoders. Does anything silently drop
  or remap?

## Seat 2 — The catalog against the scrape

*You own provenance: which numbers are pinned to a source, and which only look like they are.*

`itemStats.test.js` pins the machine-maintained columns — weapon `size` and `cost`, tool and
consumable `cost`, trait `up` — against `itemStats.json`, **skipping rows the dataset does not
cover**. That skip is your charge.

- Which catalog rows have no `itemStats` record at all? Those are unpinned: hand-authored, unverified,
  and nothing will ever notice if they are wrong. **Enumerate them exhaustively** — this list is
  probably the single most valuable artifact the panel produces.
- Which `itemStats` records exist for ids no longer in the catalog? Stale coverage is a symptom of a
  rename that kept an id.
- Do the hand-authored columns the scraper is forbidden to touch — `name`, `ammoClass`, `group`,
  consumable `type` — agree with the scraped `fields` and prose for the same item? The scraper not
  writing them is exactly why they can rot.
- Do `sourceRevision` values cluster, or is some corner of the dataset far older than the rest? A
  stale corner is a plausible-looking wrong-number generator.
- ADR-0013: an unpurchasable item is priced `0` and the app must not charge for it.
  `itemStats.test.js` asserts both directions. Is that evidence still true item-by-item, or does some
  row now pass on stale evidence?
- The `special` and `none` ammo pools are deliberately **empty** — six weapons (Dolch 96, Nitro
  Express, Bomb Launcher, Chu Ko Nu, Flame Rifle, Shredder) draw from `special` and none of their
  rounds are purchasable. Chu Ko Nu is flagged in-repo as a known ambiguity: infobox says `Special`,
  prose says Compact Bolts, catalog follows the infobox. Is that still what the scrape says? Is any
  *other* item carrying the same unresolved infobox/prose disagreement with no comment noting it?

## Seat 3 — Rules, caps, and the generator

*You own the arithmetic. Seat 2 asks whether a number is right; you ask what the app does with it.*

- `capMax` is `5 + 1 if Quartermaster`; `capUsed` sums weapon `size`; sizes run 1–5. Is any weapon's
  size wrong in a way that makes an impossible loadout look legal, or a legal one look impossible?
  Size is machine-maintained, so start with the rows Seat 2 would call unpinned — derive that list
  yourself rather than waiting for it.
- `TRAIT_MAX = 15` (ADR-0012) is unconditional. Is it enforced on **every** writer — the interactive
  add, *both* decoders, and the randomizer — or can one path exceed it?
- ADR-0015: the consumable cap is four per **type**, not per specific item, and the type resolves
  through the declared `CONS_CAP_CATEGORIES` list rather than being read off the row. Any consumable
  whose `type` is undeclared collapses into one shared `UNDECLARED_CATEGORY` budget. **Is any row's
  `type` actually undeclared today?** That is a live data error the design deliberately survives
  rather than reports.
- `CONS_CAP_CATEGORIES` includes `Tarot Cards`; `CONS_TYPES` does not. Is that intentional, and does
  every consumer read the right one of the two?
- Equipment is a fixed eight-cell grid with a `blocked` set; `hasFreeCell` is the single capacity
  predicate. Does any caller re-derive capacity and count a blocked hole as room?
- `randomize.js` picks 3 traits, retries up to 80 times against a budget, guards equipment fill at 60.
  Can it produce a loadout the manual UI would refuse — over the trait cap, over the slot cap, over
  four of a type, into a blocked cell? What happens when the budget is set so low nothing satisfies
  it: over-budget result, empty result, or hang? Does it draw from an empty `AMMO` pool?
- `stacking.js` collapses *adjacent identical* entries into one tile with a count. Does the badge
  count ever disagree with what the cost and cap math charge for those cells?

## Seat 4 — The hunter roster and assets

*You own the two generated surfaces nobody's tests pin as tightly: 242 hunters and five image trees.*

- 2 hunters currently have a null `acquisition` and 2 are `obtainable: false`. Are they the same two?
  Does the UI present them coherently either way?
- `ACQUISITIONS` is derived at module load with `filter(Boolean)`, alongside an
  `UNKNOWN_ACQUISITION` sentinel and `HAS_UNKNOWN_ACQUISITION`. Do the filters actually cover all
  242, or does a null-acquisition hunter fall out of every bucket and become unreachable in the
  picker?
- Duplicate ids, duplicate names, or two entries that are the same hunter under a renamed edition?
- Does every `portrait` correspond to a file under `client/public/images/hunters/`, and is every one
  of those 242 files referenced by some hunter?
- The server validates favorited hunter ids against this same file. Can a favorite saved under an id
  that later leaves the roster break a load, or does it degrade cleanly?
- **Images have no manifest by design.** The expected URL is derived from the item's **display name**
  via `slugify()`, and `<img onError>` walks known extensions before falling back to an SVG icon —
  so a display-name edit silently breaks that item's art and the fallback hides it. Which catalog
  items resolve to no on-disk image and are running on the fallback? **Enumerate them**; a long list
  is a finding even though nothing looks broken. Do any two names slugify to the same path? Are there
  image files nothing references?

## Seat 5 — Presentation, prose, and ADR conformance

*You own the gap between a correct number and a correct answer, and the gap between a written rule
and the data under it.*

- `itemStats.test.js` caps trait description length so hover tips show whole, and asserts descriptions
  never store a See-also hatnote, never leave a space before punctuation from an inline link, and keep
  multi-paragraph text newline-joined. **Spot-check the actual strings** rather than trusting the
  assertions — scraped prose is where truncation, mojibake, and stray wiki markup hide.
- ADR-0019 governs the stat block, ADR-0018 rarity and burn disclosure, ADR-0020 ammo iconography.
  Does the displayed block label its numbers with the same units the wiki uses? Does it show the
  wiki's own string uncoerced where `statFieldFor` promises that?
- ADR-0022 governs loadout identity and derived names. Can two different loadouts derive the same
  name, or one loadout derive a name that misdescribes it?
- ADR-0014 (per-weapon ammo compatibility) and ADR-0017 (trait weapon conditions) are both
  **accepted** but appear to have no implementing data. Confirm that. If accepted-but-unbuilt, that
  is a gap, not a bug — but check that nothing in the UI implies a compatibility rule it does not
  enforce.
- **Walk all 22 ADRs against the data, not the code.** `/sdd:check` covers the code side, which
  leaves the data side underserved. An ADR states a rule in RFC 2119 language; find a row that
  violates it.
- **Read the long explanatory comments in `catalog.js` and `calc.js` as claims to falsify.** Several
  document a past bug and the invariant that now prevents it. Verify the invariant still holds. A
  comment that has gone false is a finding in its own right, because the next person will trust it.

## Unassigned by design

No seat owns **items missing from the catalog entirely** — `scrape-stats.mjs --discover` exists
because "the catalog does not carry it" is invisible from inside the catalog, and no seat can run it.
Any seat may raise it; the chair records it as a known blind spot of this review either way. Say so
in the report rather than letting silence imply coverage.

---

# Part III — The rounds

## Round 1 — Independent review

Each seat works its charge alone, with no visibility into any other seat's work, and files to
`docs/audits/adversarial-data-qa-<date>-seat<N>.md`.

A filing contains: a **Method and its limits** section (what you could and could not verify, and
whether the wiki was reachable), your findings, your **negative result** (what you checked and found
clean), and your **handoffs** (things you noticed outside your charge). Findings carry severity,
file+line or item id, evidence, player-facing consequence, `CONFIRMED` or `SUSPECTED`, and a fix
*direction* — not a patch.

Severity is about how wrong the player's answer gets and how recoverable it is:

- **P0 — corrupts saved data.** Wire-format hazards; anything that re-points an existing saved
  loadout or share URL to different items.
- **P1 — wrong answer, silently.** A cost, size, or upgrade-point value that makes the app's math
  disagree with the game. The player builds something they cannot use.
- **P2 — wrong presentation.** Right number, wrong label, unit, icon, or description.
- **P3 — unverifiable / rot risk.** A row nothing pins, a stale `sourceRevision`, a comment gone
  false. Not wrong today; wrong eventually, with nothing to catch it.

## Round 2 — Cross-examination

Every seat now reads every other seat's filing. Each finding is assigned to a challenger **who did
not file it** — rotate so each seat challenges the next seat's filing, and Seat 5 challenges Seat 1.

The challenger's job is to **break the finding**, in this order:

1. **Reproduce it.** Run the command, open the file, follow the click-path. A finding that does not
   reproduce is struck, and the strike is recorded with the reason.
2. **Attack the evidence.** Is the citation load-bearing, or does it merely sit near the claim? Does
   it actually say what the finding says it says? Findings resting on recall get downgraded to
   `SUSPECTED` — no exceptions, no matter how confident the filer was.
3. **Attack the consequence.** Granting the defect, does a player actually get a wrong answer? A real
   inconsistency with no reachable effect is P3, not P1, and inflated severity costs the panel more
   credibility than a missed finding.
4. **Check for the correlated-recall trap.** If two seats filed the same conclusion, establish
   whether they cited different evidence or the same source — or neither. Same source is one finding.
   Neither is two suspicions.

The filer may respond once, with new evidence or a concession. Do not litigate past that; an
unresolved disagreement is a *result*, and the chair records both positions rather than picking a
winner by fiat.

Challengers also **merge duplicates** across filings and flag genuine independent corroboration —
two seats, different evidence, same conclusion — for promotion in the final report.

## Round 3 — The chair

One participant (a sixth, or a rotating seat that did not file the most findings) consolidates
everything into `docs/audits/adversarial-data-qa-<date>.md`, matching the structure of the existing
audits in that directory.

The chair:

- Writes the panel's **Method and its limits** — the union of every seat's limits, plus the blind
  spots nobody covered. This section is the report's credibility; do not compress it.
- Orders surviving findings **most severe first**, with independently-corroborated findings promoted
  above single-seat ones at equal severity.
- Records **struck findings and why** in an appendix. A panel that quietly discards its own output is
  indistinguishable from one that never produced it, and the strikes tell the next reviewer which
  paths are dead ends.
- Records **unresolved disagreements** as disagreements, with both positions and both citations. Do
  not synthesize a middle position that neither seat holds.
- Closes with the **consolidated negative result** — what the panel checked and found clean, so the
  next review knows what not to redo.

---

# Part IV — What is not a finding

Do not spend the panel's credibility on these. They will be struck in Round 2, and a filing that is
mostly strikes weakens every real finding next to it.

- A style, naming, or refactor opinion about code that produces correct data.
- A test that passes but that you would have written differently.
- "This value looks unusual" with no citation. Either verify it, or file it as a `SUSPECTED` P3
  question with the reason it caught your eye — but do not assert it.
- **A game number recalled from training rather than read from a source.** This is the single most
  likely way for this review to leave the app worse than it started, and a panel amplifies it rather
  than filtering it. See the correlated-recall trap above.
- A missing feature. ADR-0014 and ADR-0017 being accepted-but-unbuilt is a roadmap fact, not a data
  defect.
- Another seat's finding, restated. Corroboration means *new evidence for the same conclusion*, and
  it belongs in Round 2, not in a parallel filing.
