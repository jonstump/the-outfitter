# Round 2 — Cross-examination of Seat 2's filing

**Challenger:** Round 2, assigned to `docs/audits/adversarial-data-qa-2026-08-14-seat2.md`.
I did not write that filing.
**Date:** 2026-08-14 · **Round:** 2 · **Repo state:** `ff76d03`

**Charge.** Break every finding in Seat 2's filing, in the prescribed order — reproduce it, attack
the evidence, attack the consequence, check for the correlated-recall trap. Merge duplicates across
filings and flag genuine independent corroboration.

---

## Verdict summary

| # | Seat 2's claim | Filed | Verdict | Reproduced |
|---|---|---|---|---|
| F1 | Conversion / Chain Pistol priced out of the wrong ammo pool | **P1** CONFIRMED | **DOWNGRADED → P2**, CONFIRMED | Yes, exactly |
| F2 | Nine `special` weapons vanish under any ammo filter | P2 CONFIRMED | **UPHELD** P2 (one clause struck) | Yes, exactly |
| F3 | `dark-dynamite-satchel` may be mis-typed | P2 SUSPECTED | **DOWNGRADED → P3**, SUSPECTED | Yes, exactly |
| F4 | `AMMO` price table has no provenance | P3 CONFIRMED | **UPHELD** P3 — **PROMOTED** (corroborated) | Yes, exactly |
| F5 | Consumable `type` has no scraped counterpart | P3 CONFIRMED | **UPHELD** P3 | Yes, exactly |
| F6 | `itemStats.test.js` skip comment is stale | P3 CONFIRMED | **UPHELD** P3, strengthened | Yes, exactly |
| F7 | `special`-pool comment names six; there are nine | P3 CONFIRMED | **UPHELD** but **MERGED** into Seat 1 F9 | Yes, exactly |
| F8 | Three pages ~3,900 revisions behind the rest | P3 CONFIRMED/SUSPECTED | **UPHELD** P3 as filed | Yes, exactly |
| F9 | `catalog.test.js` "verified against the wiki" block pins literals | P3 CONFIRMED | **UPHELD** P3, one clause **STRUCK** | Yes, exactly |

Nothing was struck in full. One finding downgraded two rungs' worth of consequence (F1), one
downgraded one rung (F3), one merged away as a duplicate (F7), two individual clauses struck (F2's
recovery-affordance clause, F9's "only … `ammoClass`" clause), one promoted for genuine
independent corroboration (F4).

**Honesty-rule audit of the target filing.** I checked every numeric claim in Seat 2's nine findings
against its stated citation. Each one carries a file+line or a named `itemStats.json` record at a
named revision. **No Seat 2 finding rests on recall**, so none is downgraded on that ground. Seat 2's
self-description ("None of them is a claim about the game") is accurate and I confirm it.

---

## Method and its limits

**Wiki reachability — checked, not inherited.**
`curl -sS -o /dev/null -w '%{http_code}\n' --max-time 20 https://huntshowdown.wiki.gg/wiki/Nagant_M1895`
→ `curl: (56) CONNECT tunnel failed, response 403`. I am in the blocked case, as Seat 2 was. No
finding here is struck for resting on the committed scrape; findings resting on recall would be, and
none did.

**Baseline, run by me.** Client suite `vitest run` from `client/` with the root `.bin` on `PATH`:
**33 files, 759 passed**. I did not run the server suite (shared `server/data/db.test.json`; the
chair's baseline of 161 + 1 skipped is accepted rather than re-derived, and no finding below turns
on it).

**Git history recovered.** The working tree is a shallow clone. Several of Seat 2's claims cite
issue numbers and commit-era facts, so I mirrored the full repository into scratch space
(`git clone --mirror`, 470 commits across all refs, working-tree HEAD present) and judged those
claims against it rather than against the truncated log. Three history claims were checkable; two
hold and one is wrong in a detail — recorded under F2, F6 and F7.

**Read-only.** I modified no source, data, or test file, did not edit Seat 2's filing, and ran no
scraper. My only write is this file.

**A second oracle Seat 2 did not use.** Seat 2's oracle was `itemStats.json`. There is a third
committed artifact bearing on its charge: `docs/reports/suggested-adrs.md`, dated 2026-08-12, whose
method section records the wiki as **reachable at the time** (`/wiki/Ammo` → `200`), states that
every quote was string-matched against its cached source rather than retyped (18 of 18), and is
cited for provenance by **ADR-0014, which is accepted**. It carries live-wiki readings of the
Conversion's own page. That artifact is load-bearing against F1 and I use it below.

*Caveat, stated rather than buried:* that document carries an amendment retracting §4 and §G,
because the corpus behind it was pulled through MediaWiki API paths that `robots.txt` disallows. The
amendment is explicit that the retraction covers the *recommendation to adopt the API*, not the
readings — "Everything in §4 other than its recommendation" stands, and "Nothing outside §4 and §G
changes." The Conversion readings are in §A and §3, and ADR-0014 rests on them. I weight them as
real wiki readings of contested provenance, and I say so at each use.

---

## F1 — Conversion / Conversion Chain Pistol `ammoClass`

### Verdict: **DOWNGRADED, P1 → P2. CONFIRMED as a disagreement; the P1 consequence does not survive.**

This is the panel's most consequential non-P0 claim, so I worked it hardest.

### 1. Reproduce — exact

Seat 2's one-liner reproduces verbatim. I also re-derived the full cross-tabulation independently
rather than re-reading Seat 2's table:

```
node --input-type=module -e '
import fs from "node:fs";
const mod = await import("/home/user/the-outfitter/client/src/data/catalog.js");
const I = JSON.parse(fs.readFileSync("client/src/data/itemStats.json","utf8")).items;
const tab={}; let total=0;
for (const w of mod.WEAPONS){ const at = I[w[0]]?.fields?.AmmoType ?? "null";
  (tab[w[4]+" -> "+at] ??= []).push(w[0]); total++; }
console.log("total:", total);
for(const k of Object.keys(tab).sort()) console.log(String(tab[k].length).padStart(4), k);'
```
```
total: 147
   1 bow -> Special          32 compact -> Compact      1 hxbow -> Special
  18 long -> Long             2 medium -> Compact      32 medium -> Medium
   1 none -> Special          6 none -> null            3 shotgun -> Medium
  19 shotgun -> Shells       21 slong -> Special Long    1 special -> Oil
   8 special -> Special       2 xbow -> Special
```

147 rows, and exactly two exceptions: `caldwell-conversion-pistol`, `conversion-chain-pistol`.
Seat 2's table is accurate to the row.

### 2. Attack the evidence — it holds, and it is stronger than Seat 2 argued

**Is the scrape reading the right page?** This was my first line of attack, because a mis-selected
infobox would explain `AmmoType: "Compact"` without any catalog defect. It does not:

```
caldwell-conversion-pistol  wikiUrl .../Weapons/Conversion              selectedBy canonical-title
                            infoboxTitle "Conversion"    Price "55"  Size "1"   variantCount 12
conversion-chain-pistol     wikiUrl .../Weapons/Conversion/Chain_Pistol selectedBy canonical-title
                            infoboxTitle "Conversion Chain Pistol"  Price "84" Size "1" variantCount 14
```

The pages are canonical-title selections, and the `Price`/`Size` in the same infobox equal the
catalog's cost and size for both rows — which `itemStats.test.js` pins and which pass. So the
infobox that supplied `AmmoType: "Compact"` is demonstrably the same infobox that supplied two values
the repo already treats as authoritative. The evidence is load-bearing, not adjacent.

**Is it a documented exception? No — and Seat 2 did not miss a comment.** The chair asked me to
settle this independently. I did three things:

1. Read `catalog.js:236-242` in full. It documents exactly two collapses: the wiki's `"Special"`
   covering `hxbow`/`bow`/`xbow`/`special`/`none`, and `"Medium"` covering both `medium` and
   `shotgun` — *"(the Drilling)"*, named. There is no clause in which `"Compact"` covers `medium`.
2. Grepped the entire repo for `Conversion` across `.js/.jsx/.mjs/.md`. Every hit is a catalog row,
   a wiki-path override, a test fixture, an ADR mention, or a prior audit's *unverified* list. **No
   comment anywhere covers the Conversion's ammo class.**
3. Checked whether it is the dual-family case that excuses the Drilling. It is not. ADR-0014 and
   `suggested-adrs.md` §A4 both enumerate the dual-family rows as **exactly 7**, diagnosed by a
   slash-separated `Loaded`/`Extra` — Drilling ×3, LeMat ×3, Haymaker. The Conversion's `Loaded` is
   `"6"` and `Extra` is `"18"`; no slash. It is single-family.

**Recovered git history strengthens it.** Tracing the tuple across full history: the Conversion has
carried `"medium"` since the initial commit `1572027` (2026-08-07) — `["Caldwell Conversion Pistol",
1, 34, "medium", "Pistols"]` — and the only later touch was `663cb40` (#232/#242), a display-name
change. The value is original hand-authored data that has never been reconciled against any source.
`weapon-catalog-wiki-audit.md:218-222` independently lists Conversion among the families it left as
`[VERIFY AGAINST LIVE WIKI]`. Seat 2 cited that; it checks out.

**So the disagreement is real, undocumented, unpinned, and never sourced.** That half of F1 is
UPHELD without qualification, and it is a good find.

### 3. Attack the consequence — this is where the P1 breaks

Seat 2's player-facing case is a table showing the app charging medium-pool prices where compact-pool
prices belong, concluding: *"the **cost line is overstated** on every Conversion loadout with ammo
selected."* Both the direction and the attribution fail against committed evidence.

**`docs/reports/suggested-adrs.md`, written while the wiki was reachable, read the Conversion's own
ammo section.** §A2 quotes it: `{{Ammo|Dumdum Ammo}} - Scarce {{Scarce}}` and
`{{Ammo|FMJ Ammo}} - 50 {{Hunt Dollars}}`. Its worked example is the Conversion by name:

> *"the app offers FMJ 22, Spitzer 60, Dumdum 28, Incendiary 24, Poison 21. The wiki lists exactly
> two rounds — Dumdum (Scarce) and FMJ at **50**. So three phantom rounds (Spitzer, Incendiary,
> Poison), and the one round both agree on is priced **22 against 50** — a 2.3× under-charge."*

Three consequences follow, and they invert F1's:

- **The direction is backwards.** On the only Hunt-Dollar round the wiki lists for this weapon, the
  app charges **22** against a stated **50**. The cost line is **understated**, not overstated.
- **The directed fix makes the player's answer worse.** `AMMO.compact` prices FMJ at **15**
  (`catalog.js:47`). Re-classing the Conversion to `compact` moves the app from 22 to 15 against a
  stated 50 — further from the source, not closer. Seat 2's delta table is a comparison of two
  app-internal pools, neither of which matches the page, presented as the magnitude of the player's
  error. It is not that.
- **The phantom-round consequence is not fixed either.** Seat 2 objects that the picker offers
  "Spitzer", absent from the compact pool. True — but the compact pool offers High Velocity,
  Incendiary and Poison, none of which the wiki lists for this weapon. Re-classing trades one set of
  phantom rounds for another. It resolves nothing.

**And the cost defect is not attributable to this row.** ADR-0014 — **accepted**, 2026-08-12 — opens
by measuring exactly this at scale: the app offers **587** (weapon, round) pairs where the wiki lists
**491**; **243** are rounds the weapon cannot take, **147** are rounds it can take and the app cannot
express, and **137 of 140** weapons are wrong in at least one direction. It concludes that price is
per-(weapon, round) and *not derivable from the class*, and that **"`ammoClass` is retired as a rules
input. It survives, if at all, as a display grouping."* The Conversion's wrong cost line is one
instance of a defect already recorded in an accepted ADR, and it would remain wrong after the change
Seat 2 directs.

**What actually survives, and it is genuinely Conversion-specific.** `ammoClass` has two live
consumers besides the price pool, and ADR-0014 explicitly preserves the role both serve:

- `Picker.jsx:41` — `aOK = (cls) => !ui.ammoF || AMMO_FILTERS[ui.ammoF].includes(cls)`. A player who
  selects the **Compact** chip does not see the Conversion or the Chain Pistol; a player who selects
  **Medium** sees two weapons the scrape types Compact.
- `Picker.jsx:60` / `AMMO_LABEL` — the picker's `meta` line reads **"Medium ammo"** on both rows.

That is a reachable, today, attributable wrong answer: a wrong **label** and a wrong **filter
bucket**, on the field the accepted ADR says survives precisely as a display grouping. By the panel's
own ladder that is **P2 — wrong presentation**, not P1.

### 4. Correlated-recall check

No recall involved on either side. Seat 2 cites `itemStats.json` records at named revisions; my
counter-evidence is a committed document citing a live page at a stated date. Two artifacts, two
different reads, and they disagree about which side of the catalog/scrape split is wrong — which is
the honest result, not a tie to be split.

**Related but not duplicate:** Seat 5 F1 files the *general* version — the ammo select asserts a
per-weapon compatibility and a price the app does not model — citing `WeaponSlot.jsx` for the
mechanism and ADR-0014 for the magnitude. Different evidence, broader conclusion, and it **subsumes**
F1's cost consequence entirely. The chair should list Seat 5 F1 as the cost finding and Seat 2 F1 as
the narrower label/filter finding beneath it, rather than presenting them as two costs.

### What I am not striking

Seat 2's **fix-direction hazard flag is correct and is the most valuable part of the finding**:
`AMMO.medium` and `AMMO.compact` are both length 5, so a bare re-class re-points every saved
selection with no bounds check tripping, and `catalog.js:122-131` records that this exact cost was
*accepted rather than migrated* for `frontier-73c`. That coupling is right, it is well cited, and it
should survive into the chair's report even at P2. It is also the reason the downgrade matters: at
P1 this reads as "fix the row"; at P2 with the hazard attached it correctly reads as "do not fix the
row until ADR-0014 lands."

---

## F2 — Nine `special` weapons vanish under any active ammo filter

### Verdict: **UPHELD, P2, CONFIRMED.** One clause struck, one number corrected.

**Reproduces exactly.** `AMMO_FILTERS` (`Picker.jsx:28-35`) covers nine of the ten `ammoClass`
values; `special` is in no bucket, and `Other` is `["none","bow","xbow","hxbow"]` only. Nine rows are
therefore excluded by `aOK` under any active chip: `dolch-96`, `nitro-express`, `bomb-launcher`,
`chu-ko-nu`, `flame-rifle`, `shredder`, and the three Dolch variants. Evidence is load-bearing —
I read `AMMO_FILTERS` and `aOK` from source rather than from the filing.

*(Minor: Seat 2 cites `Picker.jsx:51` for the unconditional application. The `aOK` call site is `:51`
and the predicate is `:41`. Both are correct in context; no impact.)*

**Clause STRUCK — "Clearing the filter is the only recovery, and nothing signals that."** False.
`Picker.jsx:246-253` renders `[""].concat(Object.keys(AMMO_FILTERS))`, so an **"All"** chip is always
the first item in the row and the active chip carries an `active` class. The recovery affordance is
present and visibly signalled.

**What survives is better than what was struck.** The real defect is that the **`Other` chip is a
false claim of exhaustiveness.** A player who reads six chips as a partition and picks "Other" to
find the unusual weapons gets a list that silently omits the entire Dolch 96 family, the $1015 Nitro
Express, the Bomb Launcher, the Chu Ko Nu, the Flame Rifle and the Shredder. That is a wrong answer
from a control that presents itself as complete, and P2 is right for it.

**Evidence correction from recovered history.** Seat 2 writes that #254 *"tripled the `special`
roster from 3 to 6 to 9."* The full history says **2 → 6 → 9**:

```
2  077e747 2026-08-09  Fix stale catalog data and complete missing rosters   (dolch-96, nitro-express)
6  261cfc8 2026-08-12  add 19 missing weapons … (#233) (#244)
9  192aac5 2026-08-12  import 89 weapon variants as ordinary catalog rows (#254) (#257)
```

Adjacent to the claim, not load-bearing — the finding is about today's coverage gap, which stands.
Recorded so the chair does not propagate the 3.

**Duplication:** none. Seat 1 F9 and Seat 2 F7 both observe the roster is nine, but neither reaches
the filter consequence. F2 is single-seat and novel, and it is the strongest thing in Seat 2's filing
that no other seat found.

**Fix direction endorsed.** The subset assertion Seat 2 proposes — every `WEAPONS[i][4]` is a member
of `new Set(Object.values(AMMO_FILTERS).flat())` — is the right shape and would have caught this at
#254.

---

## F3 — `dark-dynamite-satchel` cap category

### Verdict: **DOWNGRADED, P2 → P3. Stays SUSPECTED.** Not struck; the question is legitimate.

**Reproduces exactly.** 18 `Throwable` rows, of which only `dark-dynamite-satchel` has no
`ThrowRange`; the three `Placeable` rows also have none.

**Attack the evidence — the argument from absence is weaker than filed, because a positive
counter-signal sits in the same record and Seat 2 did not weigh it.** Comparing the satchel's full
field set against both candidate classes:

| id | type | Damage | EffectRadius | FuseTimer | ThrowRange | MeleeDamage / Heavy |
|---|---|---|---|---|---|---|
| `dynamite-stick` | Throwable | 750 | 8 | 4 | 22 | **13 / 27** |
| `dynamite-bundle` | Throwable | 1500 | 10 | 4 | 22 | **13 / 27** |
| `waxed-dynamite-stick` | Throwable | 750 | 8 | 4 | 22 | **13 / 27** |
| `hellfire-bomb` | Throwable | 49 | 6 | — | 22 | **13 / 27** |
| **`dark-dynamite-satchel`** | Throwable | **3000** | **11** | **1** | *absent* | **13 / 27** |
| `medical-pack` | Placeable | — | — | — | — | 13 / 31 |
| `ammo-box` | Placeable | — | — | — | — | 31 / 90 |
| `tool-box` | Placeable | — | — | — | — | 31 / 90 |

The satchel carries `Damage`, `EffectRadius` and `FuseTimer`, and **no Placeable carries any of the
three**. Its melee profile `13 / 27` matches every dynamite Throwable exactly and matches none of the
three Placeables. So the record points *toward* Throwable on four fields and away on one. Seat 2's
Signal 1 is real but is one field against four, and Seat 2 surfaced only the one.

Signal 2 (the prose reading as a placeable) is fairly reported and fairly hedged.

**I checked whether any committed artifact settles it. None does.** `suggested-adrs.md` §I was
written with the wiki reachable and quotes `/wiki/Update/2.8` for the four cap categories —
*"Throwables, Placeables, Shots and Tarot Cards"* — but never assigns the satchel.
`equipment-catalog-wiki-audit.md:371` names it only as present-in-roster. Seat 2's own reason for
SUSPECTED (the deciding axis is page-category membership, which the scrape does not persist) is
correct and I confirm it.

**Consequence is reachable, granting the defect.** `CONS_CAP_CATEGORIES` is
`["Shot","Throwable","Placeable","Tarot Cards"]`, `capCategoryOf` resolves through it
(`calc.js:82-87`), and the grid is eight shared cells — so 4 satchels + 4 bombs is exactly the
boundary case Seat 2 describes. The consequence claim is sound *if* the premise is.

**Why the rung moves.** "P2 as filed, rises to P1 if confirmed" does not map onto the ladder: the
described defect is a rules error, never a presentation one, so P2 is not available to it. An
unresolvable suspicion about a row nothing pins is the P3 definition verbatim — *"a row nothing pins
… not wrong today; wrong eventually, with nothing to catch it."* **P3, SUSPECTED, escalating to P1
on confirmation of the page category.** The escalation condition is preserved, not dropped.

**Relationship to F5.** F3 is the live candidate and F5 is the mechanism. They should be adjacent in
the chair's report and F3 should not be read without F5.

---

## F4 — The `AMMO` price table has no provenance

### Verdict: **UPHELD, P3, CONFIRMED. PROMOTED — genuine independent corroboration.**

**Reproduces exactly:** 31 `[roundName, price]` pairs across 8 non-empty pools, $13–$90. I verified
the "no test asserts any of them" claim myself rather than accepting it: grepping the client test
tree for `AMMO` returns only `controlScale.test.jsx:534` (a `findIndex` helper looking for any weapon
with a non-empty pool) and one comment in `loadoutCodec.test.js:169`. Grepping for `Spitzer`,
`High Velocity` and `Dumdum` across all tests returns **nothing**. No round name and no price is
asserted anywhere.

Evidence load-bearing on every clause. `catalog.js:43-45` does state the scraper can never write it,
and the coverage contrast (weapon size 147/147, weapon cost 143/147, tool 21/21, cons 30/30, trait UP
50/58 — all re-derived by me under F6) is accurate.

### Correlated-recall check — this is the real thing

**Seat 1 F6 reaches the same conclusion from different evidence.** Seat 2 argues from *provenance*:
no `itemStats` record exists for any pool row, SPEC-0007 forbids the scraper from ever writing one,
and no consumer validates. Seat 1 argues from *enforcement*: a grep of the test tree showing no
assertion pins any pool or any weapon's class, and that all three historical wire-format violations
landed green. Two seats, two distinct evidence bases, one conclusion — **promote**.

**One defect in the corroborating seat's evidence, recorded because the merged finding inherits it.**
Seat 1 F6 states *"There is no assertion anywhere that `AMMO.compact[1]` is High Velocity, that
`AMMO.medium` has five entries, or that `frontier-73c` draws from `compact`."* The first two are
correct. **The third is false:** `loadoutCodec.test.js:587` asserts
`expect(WEAPONS[FRONTIER][4]).toBe("compact")`, and `:532` asserts `WEAPONS[KATANA_WEAPON][4]` is
`"none"`. Seat 1's grep searched for the literal string `ammoClass` and so missed assertions that
index tuple position `[4]`. Two weapons' classes *are* pinned — the frontier being one of them, which
is the row its own F1 is about. The merged finding should read "no assertion pins any `AMMO` pool,
and only two of 147 weapons' classes are pinned."

### One observation for the chair, not a severity change I am making unilaterally

Seat 2 scopes F4 tightly and honestly: *"CONFIRMED (that it is unpinned; no specific value is claimed
wrong)."* That is true of its own evidence and I do not upgrade it. But the chair should know the
gap is not merely theoretical: ADR-0014's Decision Drivers record, from the 2026-08-12 live pass,
that *"Five pool rows charge 22–90 for rounds the wiki marks Scarce on every weapon that lists
them"* and `suggested-adrs.md` §3.9 names two rounds filed under the wrong weapon entirely
(`Poison Bolt` belongs to the Hand Crossbow, `Concertina Bolt` to the Hunting Bow). The P1-shaped
version of this gap already exists in Seat 5 F1 and in an accepted ADR. F4 is the right P3 for what
Seat 2 could see; the chair should place it under Seat 5 F1 rather than beside it.

---

## F5 — Consumable `type` has no scraped counterpart

### Verdict: **UPHELD, P3, CONFIRMED.**

**Reproduces exactly.** The consumable field histogram across all 30 records is
`Price 30 · Update 30 · Unlock 30 · MeleeDamage 30 · HeavyMeleeDamage 30 · ThrowRange 17 · Damage 16 ·
EffectRadius 16 · EffectDuration 11 · FuseTimer 8 · ControlRange 3 · DamageperTick 2`. No `Category`,
no `Type`. `acquisitionClasses` is non-empty for exactly 58 records, all of them traits, and for **0**
consumables.

**One sharpening, which strengthens rather than weakens the finding.** A `fields.Category` *does*
exist in `itemStats.json` — but only on traits, and it is the trait **infobox** field
(`Supportive` 30 / `Offensive` 12 / `Defensive` 10 / `Movement` 6), not a page-category axis. Weapons,
tools and consumables have it on 0 of 147, 0 of 21 and 0 of 30 rows respectively. So the absence
Seat 2 reports is real and is specifically an absence for consumables.

**The fix direction is mechanically sound and I verified it.** `scrape-stats.mjs:468-470` does parse
whole-page categories (`parsePageCategories(html)`, with the comment *"Whole-page, NOT per-infobox"*),
carries them on the result at `:481`, and `:527` passes them into `acquisitionOf` — which persists
only the filtered acquisition axis. Persisting a second filtered axis for consumables costs no new
crawl, exactly as Seat 2 says.

**Consequence correctly rated.** No player-facing effect today; a rules input with no source of truth
in the repo is the P3 definition. Parent of F3.

---

## F6 — `itemStats.test.js` documents its own skip with a row that no longer exists

### Verdict: **UPHELD, P3, CONFIRMED — and strengthened by evidence Seat 2 did not use.**

**Reproduces exactly, to the digit.** I re-derived the skip table with my own `asNumber`
reimplementation rather than trusting Seat 2's:

| case | compared | skipped | which |
|---|---|---|---|
| weapon cost | 143/147 | 4 | `flame-rifle`, `homestead-78`, `shredder`, `wildland` — `fields.Price === "Scarce"` |
| weapon size | 147/147 | 0 | — |
| tool cost | 21/21 | 0 | — |
| consumable cost | 30/30 | 0 | — |
| trait UP | 50/58 | 8 | `berserker`, `catalyst`, `death-cheat`, `rampage`, `relentless`, `remedy`, `shadow`, `shadow-leap` — no `Cost` row |

`winfield-m1873c` is in neither the catalog nor `itemStats`; `KNOWN_CATALOG_DUPLICATES` is `{}`;
`TRAITS.length` is 58; the multi-paragraph set is exactly the nine named ids. Every clause of the
comment at `:41-43` is stale, as filed.

**Strengthened.** Seat 2 attributes the retirement to #243. Against recovered full history that is
right — `c3b6bba`, *"fix(catalog): retire the winfield-m1873c duplicate behind a legacy alias (#243)
(#250)"*. What Seat 2 did not note is that **the same test file already knows this**: `:399-401`
reads *"`winfield-m1873c` has no wiki page of its own, so it can have no verdict, and **#243 retires
it**."* So the file contradicts itself across 360 lines — one comment says the skip covers that id
today, another says it was retired. That makes the rot self-evident from inside the file and raises
the value of the finding without changing its rung.

**The `:406` slack claim verified.** `expect(covered.length).toBeGreaterThan(WEAPONS.length - 3)`
passes at 145 of 147, so two weapons may lose their scrape record silently. Correct as filed.

### Duplicate — merge, do not promote

The item Seat 2 folds in at `:150` (*"9 of the **32** traits"*, denominator stale, should be 58) is
**the same finding as Seat 5 F10**, at the same file and lines, with the same verified nine ids and
the same corrected denominator. **Same source, one finding, not two.** No promotion — this is exactly
the arithmetic the correlated-recall rule exists to prevent, in its benign form. The chair should
record it once, note both seats independently reached it, and attribute the fuller write-up (Seat 5
F10 additionally sources the "32" to `catalog.js:604-606` as the pre-#157 count) alongside Seat 2's.

---

## F7 — `catalog.js`'s `special`-pool comment names six weapons; there are nine

### Verdict: **UPHELD as a fact, but MERGED into Seat 1 F9. One finding, not two.**

Reproduces: nine rows carry `ammoClass: "special"`; the comment at `catalog.js:55-57` names six.

**This is a duplicate, and of the same-source kind.** Seat 1 F9 is the identical claim, at the
identical file and lines, with the identical `node --input-type=module` enumeration over
`catalog.js`, reaching the identical conclusion and the identical "restate as derived" fix direction.
Neither seat brings evidence the other lacks; Seat 1 additionally names the commit (`192aac5`), and I
confirmed that against recovered history. **Two seats reading the same comment is one piece of
evidence.** The chair should carry Seat 1 F9 and cross-reference Seat 2 F7, not list both.

Both seats correctly note the consequence is nil — the pool is empty either way — and both correctly
observe the comment's substantive claim still holds. Seat 2 adds one thing worth keeping in the merge:
this is the comment that would have flagged F2, because three rows joined a class whose downstream
consumers nobody re-checked.

*(Related but distinct, and not part of this merge:* `suggested-adrs.md` §3.1 and ADR-0014 record
from the live wiki that the comment's substantive claim — "none of their custom rounds can be bought
with Hunt Dollars" — is itself **false** for Bomb Launcher and Chu Ko Nu. That is a stronger finding
than either seat filed, it is already recorded in an accepted ADR, and neither seat reached it. Noted
for the chair's blind-spot section.)*

---

## F8 — Three consumable/tool pages ~3,900 revisions behind the rest

### Verdict: **UPHELD, P3. CONFIRMED as a revision gap, SUSPECTED as to any wrong value — exactly as filed.**

Reproduces exactly: `decoys` 10076, `chaos-bomb` 10096, `flash-bomb` 10105, next-oldest
`blank-fire-decoys` 13984 (gap 3,879). Per-category medians re-derived independently: weapons 15976,
tools 16044, consumables 15286, traits 15641; file max 16390. All 256 `ingestedAt` values fall in the
single hour bucket `2026-08-12T22`, so the spread is page currency and not scrape currency — Seat 2's
key methodological point, and it is correct.

**Evidence load-bearing.** `sourceRevision` is `wgCurRevisionId` at scrape time
(`scrape-stats.mjs:453-455`), a wiki-global counter, exactly as described.

**Consequence attacked and it survives, because Seat 2 already conceded it.** The filing says "None
demonstrated" and explicitly declines to claim any of the three values wrong. Under the honesty rule
this is the model of how to file a rot-risk observation, and I have nothing to strike.

**One framing caution for the chair.** Revision distance measures *edit recency*, not correctness or
age — a low-revision page can be low-revision because nobody has needed to touch it. Seat 2 says this
in substance ("orders pages by how recently each was *edited*"), but the headline "~3,900 revisions
behind" invites reading it as an age measurement it is not. Keep the finding; keep Seat 2's own
wording over the headline.

---

## F9 — `catalog.test.js`'s "verified against huntshowdown.wiki.gg" block pins literals, not a source

### Verdict: **UPHELD, P3, CONFIRMED. One clause STRUCK.**

Reproduces. `catalog.test.js:31` is titled *"data accuracy (verified against huntshowdown.wiki.gg,
Update 2.8.1)"*; its assertions through `:107` are whole-tuple literals with no URL, no revision, and
no read through `statFieldFor`. The contrast Seat 2 draws is real and checks out: the block at
`:419-432` opens by stating it reads the wiki values through `statFieldFor` off the generated dataset
(`const wikiCategories = TRAITS.map((t) => statFieldFor(t[0], "Category"))`), and does.

**Clause STRUCK.** Seat 2 writes that these literals are *"the **only** thing asserting the two
hand-authored, uncheckable columns: `ammoClass` … and consumable `type`."* For consumable `type`
that holds — I grepped every `.test.js`/`.test.jsx` in the client and every `Throwable` assertion
outside the block is a synthetic fixture or a comment. **For `ammoClass` it is false:**

```
client/src/utils/loadoutCodec.test.js:532   expect(WEAPONS[KATANA_WEAPON][4]).toBe("none");
client/src/utils/loadoutCodec.test.js:587   expect(WEAPONS[FRONTIER][4]).toBe("compact");
```

Two weapons' ammo classes are pinned outside the block — and `:587` pins the exact Frontier 73C
correction that F1 leans on as its precedent, with a comment explaining why the alias is safe only
because both rows share a class. The overstatement is the kind Round 2 exists to trim.

**The conclusion survives the strike**, because it rests on the title and the literals, not on
exhaustiveness: a reader counting what is "verified against the wiki" will count this block, and it
is a regression pin on values corrected in #36/#37/#40, not a source comparison. Seat 2's fix
direction — retitle rather than delete — is right, and the block genuinely is the mechanism by which
F3's `Throwable` is frozen against itself.

---

## Cross-filing bookkeeping

### Merged — same source, one finding

| Seat 2 | Duplicate of | Basis |
|---|---|---|
| **F7** (`special` comment names six) | **Seat 1 F9** | Same file+lines, same enumeration, same conclusion. Carry Seat 1 F9. |
| **F6, folded item at `:150`** (9 of 32 traits) | **Seat 5 F10** | Same file+lines, same nine ids, same corrected denominator. Record once. |

### Promoted — different evidence, same conclusion

| Conclusion | Seats | Distinct evidence |
|---|---|---|
| The `AMMO` table and `ammoClass` have no control of any kind | **Seat 2 F4** + **Seat 1 F6** | Seat 2: zero `itemStats` coverage, SPEC-0007's never-written rule, no validating consumer. Seat 1: no test assertion exists, and three historical violations landed green. **Promote at P3**, with Seat 1's "`frontier-73c` is unpinned" clause corrected — it *is* pinned, at `loadoutCodec.test.js:587`. |

### Subsumed — list beneath, not beside

| Seat 2 | Subsumed by | Basis |
|---|---|---|
| **F1**'s cost consequence | **Seat 5 F1** + ADR-0014 | Seat 5 files the general defect (whole-pool offered per weapon, with prices) citing `WeaponSlot.jsx` for mechanism and the accepted ADR for magnitude. The Conversion is one of the 137 of 140 weapons already counted there. What remains uniquely Seat 2's is the label/filter defect. |

### Not corroboration

Seat 1 F6, Seat 2 F4 and Seat 2 F7 all touch the `special` pool and the `AMMO` table. Only the
F4/Seat-1-F6 pair is independent corroboration. The rest is one comment read by two seats.

---

## What I could not break, and what I could not check

**Could not break.** F2's coverage gap, F5's absence of a scraped cap axis, F6's stale comment, F8's
revision gap, and F1's underlying catalog/scrape disagreement all reproduce exactly and resist every
line of attack I could mount from committed data. F1's disagreement in particular survived the three
strongest attacks available — wrong page, mis-selected infobox, and undocumented-but-real exception —
and is a good find that the severity downgrade does not diminish.

**Could not check.** The same blind spot Seat 2 declares binds me: with the wiki blocked I cannot
adjudicate a case where the catalog and the scrape agree and both are stale, and I cannot resolve F3
because the deciding axis is not in committed data. Where I contradicted F1's consequence I did so
from a committed 2026-08-12 wiki read of contested transport provenance, not from a fetch of my own,
and I have flagged that provenance rather than laundering it. I ran no scraper and made no live
request beyond the two reachability probes.

**One thing neither Seat 2 nor I could do.** Seat 2's handoff #6 proposes a partial oracle for the
panel's declared blind spot — comparing each record's `variantCount` against the catalog's row count
per family, entirely offline. I did not run it either; it is outside my charge as a challenger. It
remains a live, cheap, unexploited lead and the chair should assign it rather than record the blind
spot as total.
