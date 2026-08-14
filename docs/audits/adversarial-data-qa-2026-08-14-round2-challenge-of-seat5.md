# Adversarial Data QA — Round 2 cross-examination of Seat 5

**Challenger:** Round 2, assigned to `docs/audits/adversarial-data-qa-2026-08-14-seat5.md`.
**I did not file Seat 5.** **Date:** 2026-08-14 · **Round:** 2 (cross-examination)

---

## Method

Read-only throughout. No source, data, ADR, spec or test file was modified; Seat 5's filing was not
edited. No scraper was run.

**Wiki:** unreachable, confirmed by the chair (`403` at `CONNECT`). Every wiki-side figure in Seat 5's
filing is therefore unreplicable *by anyone on this panel*, and I say so per finding rather than once.

**Baseline I generated myself.** `npm test` does not run as written (Node v22 against a pinned `^20`;
`vitest` not on the workspace `PATH`). Run directly:

```
$ cd client && npx vitest run
Test Files  33 passed (33)
Tests  759 passed (759)
```

I did **not** re-run the server suite — one gitignored `server/data/db.test.json` is shared by every
run and the chair's instruction is not to run it concurrently. The chair's stated real baseline
(server 161 + 1 skipped) **vindicates Seat 5's Method section**, which called the 43 server failures a
panel artifact from concurrent seats rather than a repo defect. That call was right and no finding
below depends on it.

**Git history.** `git rev-parse --is-shallow-repository` returns `true`, but `git rev-list --all | wc
-l` returns **285** and `git log -S` searches them. The commit that decides F6 (`c3b6bba`) is present
in this tree and was recoverable without deepening. Seat 5's Method does not record consulting git
history at all, and that omission is the direct cause of its one strike.

**Rendering.** Where Seat 5 argued from a code path, I rendered the component instead. Harness: a
throwaway script in scratch space run through `npx vite-node --root client`, importing the real
components and the repo's own `createTestStore`, rendered with `react-dom/server`. Nothing was written
into the tree. Rendered output is quoted verbatim below.

---

## Verdicts

| # | Seat 5's claim | Reproduced | Citation load-bearing | Player gets a wrong answer | Verdict |
|---|---|---|---|---|---|
| F1 | Ammo select asserts per-weapon compatibility and a price | Yes (mechanism) | Partly — magnitude is single-source and unreplicable | Not demonstrable from here | **DOWNGRADED P1 → P2** |
| F2 | Scarce rows render "0 pts" / "$0" incl. screen reader | Yes — rendered | Yes; one of three surfaces is quoted from ADR-0018 | Yes (disclosure, not arithmetic) | **UPHELD P2** |
| F3 | ADR-0018's Confirmation #1 unmeetable from `acquisitionClasses` | Yes — exact | Yes | No (unbuilt ADR) | **UPHELD P3**, one framing trimmed |
| F4 | Image-model header describes a two-tier lookup that does not exist | Yes | Yes | No | **UPHELD P3** (split: half is ADR-0020's, half is novel) |
| F5 | `catalog.js:130-131` contradicts the scraper about `ammoClass` | Yes | Yes | No | **UPHELD P3 — MERGE into Seat 1 F8** |
| F6 | Frontier 73C note claims two rows are the same weapon; scrape says not | No | No — wrong pair compared | No | **STRUCK** |
| F7 | Event hold-back rests on a premise ADR-0018 disproved | Yes — exact | Yes (but conclusion is ADR-0018's) | No | **UPHELD P3**, framing dispute recorded |
| F8 | Marathon Swift carries its base weapon's description | Yes — every statistic | Yes, and self-generated | No today; yes the day a description surface ships | **UPHELD P3 · SUSPECTED — promote above the other P3s** |
| F9 | Five scraped values carry a space before a comma | Yes — exact | Yes | No (zero consumers) | **UPHELD P3** |
| F10 | Test comment's denominator stale by 26 rows | Yes | Yes | No | **UPHELD P3** (lowest value on the filing, as filed) |
| F11 | SPEC-0001 mandates non-empty `alt`; trait cell passes `alt=""` | Yes, but enumeration is wrong | Weakened | No — filer says the code is right | **DOWNGRADED to an observation** |
| F12 | The "Trait cap" control does not cap traits | Yes | Yes | **No — consequence is unreachable** | **DOWNGRADED — evidence upheld, consequence struck** |

---

## The self-correction the chair asked me to test — VERIFIED TRUE

Seat 5 grades several findings P3 on the strength of a late self-correction that cuts against its own
filing: that `descriptionFor` has two consumers, both traits-only, so 198 of 256 committed
descriptions never render. If that were false, F8 and F9 would rise.

It is true, and it is true more broadly than Seat 5 claimed.

```
$ grep -rn "descriptionFor" client/src server scripts --include=*.js --include=*.jsx --include=*.mjs | grep -v '\.test\.'
client/src/components/Picker/Picker.jsx:19:import { descriptionFor } ...
client/src/components/Picker/Picker.jsx:136:        meta: descriptionFor(x.t[0]) ?? x.t[3] + " trait",
client/src/components/TraitsPanel/TraitsPanel.jsx:3:import { descriptionFor } ...
client/src/components/TraitsPanel/TraitsPanel.jsx:33:  const description = descriptionFor(id);
client/src/data/itemStats.js:73:export function descriptionFor(id) {
```

`Picker.jsx:136` sits inside the `TRAITS.map(...)` return that begins at `Picker.jsx:121`; the
Weapons, Tools and Consumables branches (`:51`, `:72`, `:96`) never call it. `TraitsPanel.jsx:33` is
traits by construction. So **58 trait descriptions render and 198 (147 weapons + 21 tools + 30
consumables) have no render path at all** — 256 records confirmed by direct count of
`itemStats.json`.

The same trace extends further than Seat 5 stated: `statsFor`, `statFieldFor`, `dualWieldFor`,
`ITEM_STATS` and `STATS_GENERATED` have **zero** non-test consumers anywhere in `client/src`, and
`acquisitionClasses` is read nowhere in `client/src` outside comments in `catalog.js`. Seat 5's P3
grades on F8 and F9 are therefore justified rather than deflationary, and its "accepted-but-unbuilt
ledger" is accurate.

---

## Finding-by-finding

### F1 — **DOWNGRADED, P1 → P2**

**Reproduces at the mechanism level, and I strengthened one of its numbers.**

Rendered `WeaponSlot` for `caldwell-conversion-pistol` with ammo index 1:

```html
<div class="weapon-meta">Size 1 · Medium ammo · Spitzer</div>
<div class="weapon-cost">$115</div>
<div class="ammo-row"><span class="panel-meta">AMMO</span>
  <select class="select-sm">
    <option value="-1">Standard</option>
    <option value="0">FMJ (+$22)</option>
    <option value="1" selected="">Spitzer (+$60)</option>
    <option value="2">Dumdum (+$28)</option>
    <option value="3">Incendiary (+$24)</option>
    <option value="4">Poison (+$21)</option>
  </select></div>
```

So the mechanism is exactly as filed: the class pool is offered whole, priced, inside this weapon's
own slot, and the selection is added to this weapon's cost line.

**The 587 figure is now verified, not quoted.** Seat 5 marked it cited-not-verified. It is derivable
from the committed data alone and I derived it:

```
$ node --input-type=module -e "import {WEAPONS,AMMO} from './client/src/data/catalog.js';
  let p=0; for (const w of WEAPONS) p += (AMMO[w[4]]||[]).length; console.log(p);"
587
```

Also verified from data: 147 weapons, 140 non-melee (7 rows are `ammoClass: "none"`), 31 `AMMO` rows
across 8 non-empty pools, and the report's worked example — `["caldwell-conversion-pistol",
"Conversion", 1, 55, "medium", "Pistols"]` against `AMMO.medium = FMJ 22 · Spitzer 60 · Dumdum 28 ·
Incendiary 24 · Poison 21` — matches `docs/reports/suggested-adrs.md:402-410` character for
character. **That is the app-side half of ADR-0014's diff, and it is sound.**

**Attack on the evidence.** Everything that makes the mechanism a *defect* is wiki-side and rests on
one measurement: ADR-0014's live pass of 2026-08-12, recorded at `docs/reports/suggested-adrs.md:400-411`.
`491`, `243`, `147`, `137 of 140`, and the `13 of 46` price-variance figure are all from that single
pass. Seat 5 cited it to file+line and refused to assert it, which satisfies the honesty rule — these
are **not** recall. But one unreplicable measurement cited twice is still one piece of evidence.
**Mark `491 / 243 / 147 / 137 / 13-of-46` `[UNVERIFIED]` in the consolidated report.** `587` should be
promoted out of that bracket to `CONFIRMED`, citing this challenge.

**Attack on the consequence.** P1 is defined as "makes the app's math disagree with the game." Seat 5
states plainly that it cannot demonstrate that, and neither can I. What survives is: the app renders a
class-derived price list inside a per-weapon control, with no disclosure anywhere that compatibility
is unmodelled. Right number *for the model the repo documents at `catalog.js:43-45`*, wrong label —
which is the P2 definition.

**One mitigation Seat 5 did not engage.** The meta line renders the class by name (`Size 1 · Medium
ammo · Spitzer`) immediately above the control, so the UI is not wholly silent about the pool being
class-derived. It is a hint, not a disclosure — nothing tells a player that some listed rounds are
unavailable on this weapon — so it reduces the claim rather than removing it. It belongs in the record
because Seat 5's fix direction ("label the control as a class-wide price list") is half-implemented
already.

**Correlated-recall / duplication.** Not a recall duplicate. **Genuine independent corroboration
exists and it is Seat 2's F1**, which reaches the same conclusion for two rows from *different*
evidence that is fully offline-verifiable — `fields.AmmoType` in the committed scrape against
`ammoClass` in the catalog. I re-derived Seat 2's whole cross-tabulation independently:

```
compact -> "Compact" x32   medium -> "Medium" x32   medium -> "Compact" x2
long -> "Long" x18         slong -> "Special Long" x21
shotgun -> "Shells" x19    shotgun -> "Medium" x3    special -> "Special" x8 / "Oil" x1
xbow/hxbow/bow -> "Special" x2/x1/x1                 none -> null x6 / "Special" x1
```

The two `medium -> "Compact"` rows are `caldwell-conversion-pistol` and `conversion-chain-pistol`.
**The P1 belongs to Seat 2's F1, not to Seat 5's F1** — Seat 2 can show a specific wrong dollar figure
from repo artifacts alone; Seat 5 cannot. Recommend the chair rank Seat 2 F1 as the panel's ammo P1
and file Seat 5 F1 beneath it as the P2 disclosure defect, alongside Seat 1 F6 (nothing pins the
pools) and Seat 2 F4 (31 unpinned prices), as one consolidated ammo-model entry.

---

### F2 — **UPHELD, P2**

**Reproduced from rendered output, not the code path,** as the chair required. All three surfaces
fire. `Picker`, Traits tab:

```
| Berserker   | All melee attacks do double damage. | 0 pts |
| Catalyst    | Unlock Conditional Trait Effects ... | 0 pts |
| Shadow      | Monsters can't see and won't attack you ... | 0 pts |
| Shadow Leap | Using Dark Sight, channel a Monster ... | 0 pts |
```

`Picker`, Weapons tab:

```
| Flame Rifle  | Special ammo | Size 2 | $0 |
| Homestead 78 | Shotgun      | Size 4 | $0 |
| Shredder     | Special ammo | Size 4 | $0 |
| Wildland     | Medium ammo  | Size 4 | $0 |
```

`TraitsPanel` with Berserker equipped:

```
aria-label="Berserker, 0 upgrade points. Activate to remove."
```

The twelve zero-cost rows enumerate exactly as filed: 8 traits (`berserker`, `catalyst`,
`death-cheat`, `rampage`, `relentless`, `remedy`, `shadow`, `shadow-leap`) and 4 weapons
(`flame-rifle`, `homestead-78`, `shredder`, `wildland`). `PickerRow.jsx:8-32` renders `row.badge` and
`row.costStr` inside a `<button>` with no `aria-label`, so the accessible name is composed from that
text — Seat 5's claim that the zero reaches AT on the picker as well is correct.

**Shared source vs. corroboration — the chair's specific question.** The panel brief does *not* state
this conclusion; it only names ADR-0018 as a document Seat 5 should read. But **ADR-0018 itself states
one of the three surfaces verbatim**, including the same example weapon:

> `TraitsPanel.jsx:36` builds `` `${name}, ${up} upgrade point...` `` — so a Scarce trait announces
> **"Berserker, 0 upgrade points"**. (`ADR-0018:18-21`)

So the screen-reader surface is **shared source, not corroboration**, and the chair should not count
it as a panel-independent confirmation of ADR-0018. What is Seat 5's own: the picker `0 pts` badge,
the picker `$0` weapon cost, and the observation that `PickerRow`'s nameless button carries the zero
into the accessible name — none of which appear in ADR-0018, which discusses only the trait cell. No
other seat filed this. Two of three surfaces are new; the finding stands, at reduced novelty.

**Attack on the consequence — and why it cannot rise to P1.** The `0` is arithmetically *correct*
under ADR-0013: a Scarce item is a row costing zero and the app charges zero. Nothing in `upTotal` or
`totalCost` is wrong. The defect is that zero renders identically for "free" and "cannot be bought".
That is precisely "right number, wrong label" = P2. Seat 5 graded it P2 and resisted the inflation
available to it. Correct grade.

---

### F3 — **UPHELD, P3.** One framing trimmed.

Reproduces exactly:

```
non-empty acquisitionClasses: 58 of 256   {Regular:49, Scarce:4, Burn+Scarce:4, Burn:1}
flame-rifle   ac=[] acquisition=null priceStated="Scarce" fields.Price="Scarce"
homestead-78  ac=[] acquisition=null priceStated="Scarce" fields.Price="Scarce"
shredder      ac=[] acquisition=null priceStated="Scarce" fields.Price="Scarce"
wildland      ac=[] acquisition=null priceStated="Scarce" fields.Price="Scarce"
```

49 + 8 Scarce + 5 Burn = 58 = the trait roster, exactly as filed, and `SPEC-0007` scopes the field to
traits by specification. ADR-0018's Confirmation #1 ("Every zero-cost catalog row renders a rarity")
cannot be met from the field ADR-0018 names for **4 of the 12** rows. That is load-bearing and
survives.

**Trimmed:** Seat 5's rhetorical hinge — that the ADR "reads [the trait counts] as *per item*" — is an
over-read. `acquisitionClasses` genuinely *is* a per-item field: all 256 records carry the key. The
ADR's phrase describes where the field lives, not how many items populate it, and the ADR nowhere
claims 256. Drop the phrase; the finding does not need it, and it is the only part a filer could
contest.

No other seat filed this. Not a duplicate.

---

### F4 — **UPHELD, P3.** Split: one half is ADR-0020's, one half is novel.

Both claims reproduce. The four dispatch functions are single-tier group lookups
(`catalog.js:881-890`, `:928`, `:932`, `:936`) with no per-item map anywhere in the file, against a
header at `:16-21` describing a two-tier lookup with "empty" per-item maps.

Counts verified by reading the objects: `THUMBS` **7** (pistol, carbine, rifle, shotgun, melee, bow,
xbow), `TOOL_THUMBS` **7**, `TRAIT_THUMBS` **5**, `CONS_THUMBS` **5** — against `:894`'s "5 groups per
category". Seat 5's proposed correction (weapons 7, tools 7, traits 5, consumables 5) is right.

**Duplication.** The two-tier half is **ADR-0020's own recorded finding**, and Seat 5 says so
honestly:

> Lines 16-21 describe dispatch functions that "check a per-item override map first" ... a two-tier
> lookup the code does not implement ... The comment is `catalog.js`'s to fix. (`ADR-0020:109-113`)

Same source; the chair should credit ADR-0020 and note the panel confirmed it is still unfixed.

**The "5 groups per category" half is novel.** I searched `docs/` and `client/src` for any prior
record of it: the only hits are `catalog.js:894` itself and Seat 5's filing. No ADR, spec, audit or
other seat has it. That half is the finding's original contribution and should be preserved when the
chair merges.

**Minor correction.** Seat 5 says the contradiction sits "twelve lines later" at `:899-902`. It is
five lines later. Immaterial to the claim.

---

### F5 — **UPHELD, P3 — but MERGE into Seat 1 F8.** Not independent corroboration.

Same line, same conclusion, overlapping sources. **Seat 1 F8** targets `catalog.js:131` and cites
`catalog.js:91-94`, `scrape-stats.mjs:56-59` and `GATED_CATALOG_FIELDS`, **plus a behavioural
verification** (its N4: the scraper cannot in fact write `ammoClass`). Seat 5 cites `catalog.js:91-94`,
`CATALOG_FIELD_MAP`, `GATED_CATALOG_FIELDS` and `SPEC-0007:89`. Both read the same scraper. **Same
evidence class → one finding, not two.** Seat 1 is the stronger filing because it verified behaviour
rather than only reading the field map.

Seat 5's additive contribution is real and I verified it: the scraper has **three** tiers, not two —
`CATALOG_FIELD_MAP` (`scrape-stats.mjs:1374-1381`, writes weapons `Price`→cost / `Size`→size, tools
and consumables `Price`→cost, traits `Cost`→up), `GATED_CATALOG_FIELDS` (`:1391-1400`, holds
`ammoClass` and `name`, gated pending a `FORMAT_VERSION` bump), and `NEVER_DERIVED` (`:1403+`, holds
`group`, `type`). Seat 5's fix direction — state the three tiers once in `catalog.js`'s header — is
better than Seat 1's single-clause correction and should be the one the chair records.

**Trimmed.** Seat 5's secondary claim that `catalog.js:91-94` is "imprecise in the other direction"
should be struck. That comment says `ammoClass` is never written by a scrape, and Seat 1's N4 shows
that is behaviourally **true today**. Per the brief, "a comment that is merely imprecise is not a
finding."

---

### F6 — **STRUCK.** Does not reproduce; the wrong pair was compared.

Seat 5 quotes `catalog.js:118-121`:

> *"Compact, not medium: this entry and **"Winfield M1873C" above** are the same weapon under its
> post- and pre-1896 names…"*

and argues that because no catalog row is named `Winfield M1873C`, the comment must mean the row
physically above (`["winfield-m1873", "Ranger 73", 4, 75, "compact", "Rifles"]`), then shows from the
scrape that Ranger 73 and Frontier 73C are two distinct weapons on two distinct pages.

**They are distinct, and the comment never said otherwise.** `Winfield M1873C` was a real catalog row
that sat directly above `winfield-m1873` until it was retired:

```
$ git log --oneline -S 'Winfield M1873C' -- client/src/data/catalog.js
c3b6bba fix(catalog): retire the winfield-m1873c duplicate behind a legacy alias (#243) (#250)
...
$ git show c3b6bba -- client/src/data/catalog.js
-  ["winfield-m1873c", "Winfield M1873C", 3, 44, "compact", "Rifles"],
   ["winfield-m1873", "Ranger 73", 4, 75, "compact", "Rifles"],
```

The commit message states the comment's claim as the *reason for the deletion*:

> `winfield-m1873c` was the pre-1896 name for the weapon the wiki now calls Frontier 73C, and
> `frontier-73c` already sat two rows away — two rows, one gun…

Three further corroborations that the comment is true: `loadoutCodec.js:292` carries
`RETIRED_WEAPON_ALIASES = Object.freeze({ "winfield-m1873c": "frontier-73c" })`, whose entire
existence presupposes the identity; `loadoutCodec.js:272-284` restates it in prose; and **Seat 2's F6**
independently confirms the id is gone from the catalog, from `itemStats.json` and from
`KNOWN_CATALOG_DUPLICATES`.

Seat 5's evidence — that the Frontier 73C is "a lightened Ranger 73", a derived variant — is a true
statement about a *different pair* and does not bear on the comment.

**The recommended fix is actively harmful and I am flagging it separately.** Seat 5 proposes
rewriting the note to say "Frontier 73C is a lightened Ranger 73". That would delete the only in-file
record of why `winfield-m1873c` was retired and why the alias exists, and would leave a future
maintainer looking at `RETIRED_WEAPON_ALIASES` with no justification in the data file it governs. Do
not apply it.

**Residual finding, available to the chair at P3, materially weaker than filed.** The comment is a
**dangling reference**: the row it points at with "above" no longer exists, so "above" now resolves to
the wrong row for any reader — which is exactly how Seat 5 was misled. The correction is to name the
retirement ("the row retired by #243, aliased in `loadoutCodec.js`"), not to change the claim. This is
the same class as Seat 2's F6, which found the same retirement leaving a stale comment in a different
file, and the two should be merged as one "the #243 retirement left two comments pointing at a
deleted row" entry.

**Root cause of the strike, for the record.** The retirement commit is present in this shallow tree
and `git log -S` finds it. Seat 5's Method section does not record consulting git history at any
point; every other finding in the filing is derived from the current tree only. That worked for F1–F5
and F7–F12 and failed exactly once, on the one claim whose subject was a past state of the file.

---

### F7 — **UPHELD, P3.** Framing dispute recorded rather than resolved.

Data reproduces exactly:

```
TRAITS.length 58
shadow-crush in TRAITS?     false
shadow-crush in itemStats?  false
shadow-leap  acquisitionClasses ["Scarce"] · fields.Category "Movement" · fields.Type "Scarce"
```

which matches ADR-0018's reading. `catalog.js:625-630` and `:639-641` say what Seat 5 quotes.

**Shared source.** The conclusion is ADR-0018's own, in its "Consequence for the Event-trait hold-back"
section (`:134-159`), including the sentence Seat 5 quotes. Seat 5's contribution is confirming
against the committed data that `shadow-crush` is absent and `shadow-leap` matches. Credit ADR-0018
for the conclusion, the panel for the data check. No other seat filed it.

**Dispute I am recording rather than adjudicating.** Both ADR-0018 and Seat 5 say the trigger's second
clause "can never fire". The clause reads:

> "or when Shadow Crush is **resolved either way**, since it is the concrete case this boundary was
> drawn around."

A plainer reading of *either way* is that ADR-0018's 2026-08-12 page read **is** the resolution — it
resolved in the direction "not a replacement". Under that reading the clause has **already fired** on
2026-08-12 and the revisit of the 17 held-back Event traits is overdue, which is a sharper finding
than "half the trigger is dead". Both readings condemn the comment; they differ on what the fix is
(strike the clause, versus honour it). The chair should record both positions per the Round 2 rules
rather than picking one.

---

### F8 — **UPHELD, P3 · SUSPECTED. Promote above the other P3s.**

This is the strongest original finding in the filing and every statistic in it reproduces
independently.

```
identical description pairs across all 256 records:
  ["marathon","marathon-swift"] :: "Caldwell made, pump-action rifle. Good cycle rate and
                                    high capacity, but has a wasteful reload."
marathon        rev 16303  sel canonical-title  ReloadSpeed 19.2  /wiki/Weapons/Marathon
marathon-swift  rev 16305  sel canonical-title  ReloadSpeed 10    /wiki/Weapons/Marathon/Swift
```

It is the **only** byte-identical description pair in the file. The family statistics reproduce to the
digit: **55** base pages, **35** multi-row families, 127 members in them (so **92** variant subpages),
and **34 of 35** families give every member distinct prose — Marathon is the sole exception. The
comparison set holds too:

```
new-army-swift    RS 5.6  "... Uses a speed-loader for faster reloading. Can be dual wielded."
ranger-73-swift   RS 8.4  "... Uses a speed-loader for faster reloading."
scottfield-swift  RS 4.3  "... Uses a speed-loader for faster reloading. Can be dual wielded."
marathon-swift    RS 10   "... but has a wasteful reload."
```

**`SUSPECTED` is the correct grade and Seat 5 reached it for the right reason** — with the wiki
blocked, "the scrape fell back to the base page" and "the wiki page genuinely repeats the base text"
are indistinguishable, and Seat 5 says so rather than picking the one that reads better.

**P3 is correct, and it is correct *because* of the self-correction verified above** — no weapon
description has a render path. This is the one place in the filing where Seat 5's late discovery
demonstrably lowered a grade it could have inflated.

No other seat filed it. Recommend the chair rank it first among the surviving P3s.

---

### F9 — **UPHELD, P3.**

Reproduces exactly. Applying the test's own regex `/\s[,;:.!?]/` to every string-bearing field other
than `description`:

```
death-cheat | acquisition          | "Burn , Scarce"     death-cheat | fields.Type | "Burn , Scarce"
rampage     | acquisition          | "Burn , Scarce"     rampage     | fields.Type | "Burn , Scarce"
relentless  | acquisition          | "Burn , Scarce"     relentless  | fields.Type | "Burn , Scarce"
remedy      | acquisition          | "Burn , Scarce"     remedy      | fields.Type | "Burn , Scarce"
frontiersman| fields.ConditionalEffect | "Solo , Catalyst"
```

Nine (field, item) hits across five items — Seat 5's "five scraped values" counts items and its table
states the field breakdown correctly. The guard at `itemStats.test.js:161-166` is `description`-only,
as filed.

**Seat 5 weakens its own finding honestly** and the weakening is correct: `SPEC-0007` documents
`"Burn , Scarce"` verbatim and routes around it, so four of the five are known and harmless.
`ConditionalEffect`'s `"Solo , Catalyst"` is documented nowhere — I searched — so one item is a
genuinely unrecorded artifact. Latent, with zero consumers (confirmed: `statFieldFor` has no non-test
caller). P3 is right; do not let a later reader raise it on the four documented instances.

Distinct from Seat 4's F4-3 (26 *hunter* descriptions with stray whitespace before punctuation, in
`data/hunters.json` via the hunter scraper). Different file, different scraper, different guard.
**Different evidence, adjacent conclusion** — worth the chair noting that two independent scrapers
produce the same class of artifact, which is a stronger signal than either finding alone.

---

### F10 — **UPHELD, P3.** Trivial, and filed as trivial.

`itemStats.test.js:150-153` says "9 of the 32 traits" and "more than a quarter of them". Verified: the
nine named ids are exactly the nine multi-paragraph records in the entire 256-item file, and
`TRAITS.length` is **58**, so the real share is 15.5%. Seat 5's "16%" is right.

Seat 5 files it saying "Low value on its own", which is the correct posture. Not a duplicate. Keep it
at the bottom of the P3 list.

---

### F11 — **DOWNGRADED to an observation, not a finding.**

The divergence reproduces: `SPEC-0001` § Image Alternative Text (`spec.md:111`) says item images
"MUST carry appropriate `alt` text identifying the item by name … rather than empty/decorative
`alt=""`", and `TraitsPanel.jsx:44` passes `alt=""`. Seat 5's reading that the spec's § Icon-Only
Controls (`:107`) pulls the other way is fair.

Three reasons to demote it:

1. **The enumeration is wrong.** Seat 5 calls `TraitsPanel.jsx:44` "the one call site that opts out".
   It is not. `LoadoutListsPanel.jsx:739-750` (`PreviewCell`) passes `alt=""` to `ItemThumb` for
   **every** weapon, tool, consumable and trait tile in the saved-loadout preview. That is at least
   two item-image call sites, not one. The error widens rather than narrows the divergence, so the
   finding's conclusion survives it — but the evidence as filed is inaccurate.
2. **`ItemThumb` does not document what Seat 5 says it documents.** `ItemThumb.jsx:69-71` licenses
   `alt=""` "where the name is already visible adjacent to the image". At the trait cell the name is
   **not** visible — it lives in an `aria-hidden` tooltip (`TraitsPanel.jsx:60-63`). The real
   justification is the button's `aria-label` at `:41`, which is a different (and better) rule than
   the one the component's comment states. If anything that is a small separate observation.
3. **No player gets a wrong answer, by the filer's own argument** — Seat 5 concludes the code is right
   and the spec is wrong. And this is code-versus-spec, which the panel brief explicitly routes away
   from this review ("`/sdd:check` covers the code side, which leaves the data side underserved").

Recommend the chair carry it as a SPEC-0001 internal-inconsistency note with the second call site
added, not as a panel finding.

---

### F12 — **DOWNGRADED: evidence upheld, consequence struck.**

The label mismatch reproduces exactly. `ActionsPanel.jsx:85` renders `Trait cap {ui.upBudgetOn ? "ON"
: "OFF"}` on a toggle that bounds `upBudget` (upgrade points); the input it reveals carries
`aria-label="Trait point cap"` (`:99`); `Header.jsx:38` names the quantity "Trait points"; and
`calc.js:19`'s `TRAIT_MAX = 15` is documented at `:10-13` as unconditional and explicitly not gated on
`ui.upBudgetOn`. The file even argues against itself in a comment at `:90-93`: *"'Trait cap' names its
own unit"* — which is the confusion, stated as the justification.

**The stated consequence does not survive.** Seat 5 writes that "a user who turns 'Trait cap OFF' may
reasonably conclude no limit on traits applies, when fifteen still does." They cannot: `TraitsPanel`
draws a **fixed fifteen-cell grid** (`:74`, `Array.from({length: TRAIT_MAX})`) with an unconditional
group label. Rendered:

```
aria-label="Traits, 1 of 15"
```

Neither the grid nor the label is gated on `ui.upBudgetOn`, so the fifteen-cap is disclosed — visually
and to assistive technology — on the very panel it governs, whatever the toggle says. The harm Seat 5
describes has no reachable path.

What remains is a genuine label-consistency defect with no demonstrated consequence: keep it at P3
with the consequence paragraph struck, and keep the fix direction (make the visible label match the
accessible one), which is right regardless.

---

## Coverage miss in Seat 5's own charge

Seat 5's Method states it read `catalog.js` end to end "treating each explanatory comment as a claim
to falsify", and F4–F7 plus F10 are all comment-gone-false findings. It missed one that sits in the
same file, in the same class, in the block Seat 5 quoted from for F1:

`catalog.js:55-57` — *"Six weapons draw from it as of #233 — Dolch 96, Nitro Express, Bomb Launcher,
Chu Ko Nu, Flame Rifle and Shredder."* Nine do:

```
$ node --input-type=module -e "import {WEAPONS} from './client/src/data/catalog.js';
  console.log(WEAPONS.filter(w=>w[4]==='special').map(w=>w[0]).join(' '))"
dolch-96 nitro-express bomb-launcher chu-ko-nu flame-rifle shredder
dolch-96-bullseye dolch-96-claw dolch-96-precision
```

The three Dolch variants arrived with `192aac5` (#254). **Seat 1's F9 and Seat 2's F7 both caught it**
— two seats, same conclusion, same data probe, so **merge them as one finding rather than promoting**
(same source, per the correlated-recall rule). Recording the miss because Seat 5 read the very
comment block that contains it, four lines above the `special: []` line its F1 depends on.

---

## Summary for the chair

**Struck:** F6, in full. The comment it attacks is true; its subject is a row retired by `#243`
(`c3b6bba`) and preserved in `RETIRED_WEAPON_ALIASES`. Seat 5 compared `winfield-m1873`/"Ranger 73"
against `frontier-73c` when the comment names `winfield-m1873c`/"Winfield M1873C". Its proposed fix
would delete the justification for a live alias and should not be applied. A weaker residual (a
dangling "above" reference) is available and should be merged with Seat 2's F6.

**Downgraded:** F1 (P1 → P2, magnitude marked `[UNVERIFIED]`), F11 (finding → observation), F12
(evidence kept, consequence struck).

**Merged:** F5 into Seat 1's F8 (same line, overlapping sources, Seat 1 verified behaviour; keep Seat
5's three-tier fix direction).

**Promoted / strengthened:**
- **`587` moves from cited to CONFIRMED** — I derived it from `catalog.js` alone. The rest of
  ADR-0014's diff (`491 / 243 / 147 / 137 / 13-of-46`) stays `[UNVERIFIED]`, single-source.
- **Seat 2's F1 corroborates Seat 5's F1 from different, offline-verifiable evidence** and should
  carry the ammo P1; Seat 5's F1 files beneath it as the P2 disclosure defect.
- **F8 should lead the surviving P3s** — every statistic in it reproduces, it is original to this
  seat, and its `SUSPECTED` grade is honest.
- **F4's "5 groups per category" half is novel**; its two-tier half is ADR-0020's and should be
  credited there.
- Seat 5's negative results are reliable where I sampled them: ADR-0019's 34-field census and all
  spot-checked coverage counts (198/171/147/2), `dualWield` true = 25, max description 296,
  `sourceRevision` span 10076–16390, the twelve zero-cost rows, and `TRAITS.length` 58 all reproduce
  exactly. That materially raises confidence in the arithmetic behind F2, F3, F9 and F10.

**Shared-source, not corroboration** (do not count as panel confirmation): F2's screen-reader surface
(ADR-0018:18-21), F4's two-tier half (ADR-0020:109-113), F7's conclusion (ADR-0018:134-159), F1's
magnitude (`suggested-adrs.md:400-411`, one pass, one date).

**Unresolved disagreement to record:** F7's revisit trigger. ADR-0018 and Seat 5 read "resolved either
way" as unfireable; I read ADR-0018's own page comparison as having fired it, making the revisit
overdue rather than impossible. Both positions condemn the comment and imply different fixes.
