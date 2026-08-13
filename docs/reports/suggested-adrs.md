# Suggested ADRs — wiki-verified

**Date:** 2026-08-12
**Companion to:** `docs/reports/recommended-adrs-from-wiki-review.md` (on
`origin/claude/wiki-review-recommended-adrs-7q7qzv`; not present on `main`)
**Prompt:** `docs/reports/wiki-verification-prompt.md`
**Status:** committed alongside ADR-0014, which cites it for provenance. The verification pass that
produced it was **read-only**: no tracked file was modified and no scrape wrote to a tracked path.
Findings here are flagged, never fixed in place — §3 lists what contradicts an accepted ADR or spec
and deliberately leaves those documents alone.

> ## Amendment (2026-08-12): §4 and §G are superseded — `robots.txt` disallows the MediaWiki API
>
> **What this document got wrong.** §4 concludes that the API "is cheaper and more capable than
> ADR-0005 assumed" and that "G's research is largely done", and §G recommends adopting it.
> `huntshowdown.wiki.gg/robots.txt` **disallows it**, under `User-agent: *`: `/api.php`, `/rest.php`,
> `/index.php`, `/*?action=` and `/wiki/Special:` — so the API is blocked by path *and* by query
> pattern, and `Special:RecentChanges` with it. ADR-0002 commits this project to respecting
> `robots.txt` without qualification, and the repo's own `isAllowedByRobots` already returns `false`
> for `/api.php`.
>
> **How the error was made**, because it is an easy one to repeat: §4's caution reads "The API is not
> covered by the existing robots.txt gate" — that checked whether the *gate looked*, not whether
> `robots.txt` *forbade*. The gate is called with `/wiki/…` paths, so it passes, and nothing objects
> until someone reads the disallow list. Every API call behind this document was therefore made
> against a disallowed path. The HTML scrape the repo actually ships is compliant.
>
> **What supersedes it.** **ADR-0016** (two-tier staleness detection over allowed HTML) decides this
> instead: a 7-fetch scheduled roster check over the category index pages, and a 498-page
> human-invoked revision sweep. It deliberately **preserves §4's measurements** — 10 requests, ~15
> seconds, the API-stated 50-title limit — so the option reads as measured and declined rather than
> missed.
>
> **What still stands.** Everything in §4 other than its recommendation: the full-dataset watermark
> verification (256 of 256 matched), the rate-limit-returns-200 trap, and the category-vs-section
> reliability finding in §A2 — that one is about which *source* to trust, not which *transport*, and
> ADR-0014 relies on it. Nothing outside §4 and §G changes.
>
> Marked here rather than edited away, on the same principle the rest of this document follows: a
> retraction is more useful to the next reader than a clean page.

**The wiki was reachable.** `curl -sS -o /dev/null -w '%{http_code}' https://huntshowdown.wiki.gg/wiki/Ammo`
→ `200`. Every finding below was read from a live page or the live MediaWiki API on **2026-08-12**,
and every page is cited. Where a page contradicts the report or `catalog.js`, it is flagged in
§3 rather than corrected.

**Method.** 147 weapon pages (all of `Category:Weapons`) were pulled as wikitext through
`action=parse`, using the repo's own `USER_AGENT` from `scripts/lib/wiki.mjs` and its 1500 ms
`RateLimiter` delay. Nothing was written outside the session scratchpad. Judgment calls (skin vs
variant, what "Burn" means) were read by eye; enumeration was scripted.

Repo-side claims were computed from `main` at `192aac5` by importing `catalog.js` and
`itemStats.json` directly, and every "this is not recorded anywhere" claim was re-checked against
`docs/adrs/`, `docs/openspec/`, `docs/audits/` and the test suite. Where the repo already had a
finding, it is credited rather than re-presented as new — see §A2 and §3.1.

**Every quote in this report was string-matched against its cached source, not retyped** — 18 of 18
verified verbatim, including all four Update 2.8 bullets that §3.4 and §I rest on. Counts were
re-derived by script rather than read off a page; where the two disagreed, the script won, and the
retracted claims are marked inline.

> **Two tooling traps this session hit, for whoever repeats it.**
> 1. **The wiki rate-limits with HTTP 200.** Anonymous `api.php` traffic at ~120 ms spacing returns
>    `{"error":{"code":"ratelimited"}}` in a *200 response*, so a naive crawler records a successful
>    empty page. The first attempt here lost 136 of 147 pages that way and produced a confident,
>    wrong "these pages have no infobox" table. Use the repo's `USER_AGENT` and 1500 ms delay, and
>    assert on parsed content rather than status.
> 2. **`grep` without `-a` reports false "clean" on this repo's source files.** Several files are
>    classified as binary, so `grep -rn` silently returns nothing. An early pass here concluded
>    `itemStats.test.js` had no Scarce assertions when it has three. **Every absence claim in this
>    report was re-run with `grep -a`.**

---

## 0. Read this first: `main` has moved past the report

The report was written against `4e5d239`. `main` is now `192aac5`, six commits later, and two of those
commits land work the report recommends. **Four of the nine recommendations change scope as a result** —
named here rather than left vague, each traced to the commit responsible:

| Rec | What changed | Commit (verified by `git log -S`) |
|---|---|---|
| **B** | 89 variant rows imported; the recommendation is substantially implemented | `192aac5` |
| **F** | all 89 variant images shipped, so F2 is done and F narrows to ammo art | `192aac5` |
| **A** | `AMMO.special` went from 6 weapons to **9** — the three Dolch 96 variants joined it | `192aac5` |
| **I** | the `CONS` boundary comment that I quotes was rewritten, and now asserts the opposite of I's premise (§3.2) | `0d32096` |

`192aac5` is *feat(catalog): import 89 weapon variants as ordinary catalog rows (#254)*; `0d32096` is
*docs(catalog): record the Tarot Card boundary as a scope decision, not a price rule (#161)*.

*(**D** also shifts, but only numerically — the dataset grew 167 → 256 items — so its argument is
unaffected. That is why the count is four and not five.)*

*(Re-verified after a `git fetch --all --prune` on 2026-08-12: local `main` and `origin/main` are
both at `192aac5`, zero commits behind, so every count below is against current `main`. The fetch
also pruned 16 merged remote branches, which is why the feature branches behind these commits no
longer appear.)*

Corrected baseline. The "now" column is computed from `main` at `192aac5`; the "report said" column was
then checked against **the repo as it actually stood at `4e5d239`** rather than taken on trust — every
row reconciles except the field count:

| | Report said | Actually now |
|---|---|---|
| Weapon rows | 59 | **147** |
| Tools / Consumables / Traits | 21 / 30 / 58 | 21 / 30 / 58 (unchanged) |
| `itemStats.json` items | 167 | **256** |
| Distinct infobox fields | 32 *(the report's own figure; the repo at its base actually had **33**)* | **34** — `Total` is the one field added since |
| Weapons pointing at `AMMO.special` | 6 | **9** (the three Dolch 96 variants joined) |
| Weapons with `"(N per slot)"` reserve | 13 | **32** |
| Committed weapon images | 58 | **147** |
| `client/public/images/ammo/` | absent | **still absent (0 files)** |

---

## 1. The suggested ADRs, in recommended order

### A — Per-weapon ammo compatibility and ammo slots · Tier 1 · **write this first**

Every premise the report marked `[VERIFY]` is now confirmed, and the evidence is **stronger** than
the report argued. This is the one to write.

**A1 — `/wiki/Ammo` is prose. `catalog.js` is right.**
[`/wiki/Ammo`](https://huntshowdown.wiki.gg/wiki/Ammo), read 2026-08-12. Each variant gets a
`Description:` quote plus qualitative bullets — "Increased penetration", "Reduced muzzle velocity",
"No penetration". **There is no stat table and no numeric field anywhere on the page.**

Classifying **every digit run** in the page body (everything before `== Update History ==`) leaves no
room for doubt — there are **seven**, and only **two** are effect magnitudes:

| What the digits are | Count |
|---|---|
| **Numeric effect values** — "Decreased damage by 5%" (High Velocity); "Heals alive teammates for 100hp" (Revive Compact Bolt) | **2** |
| Caliber descriptor — "12-Gauge buckshot" | 2 |
| Update references — `{{Update\|2.3}}` | 2 |
| Weapon name — "Dolch 96" | 1 |

And **zero lines match a stat-field shape** (`Key=number`) anywhere in the body. So the two magnitudes
that exist are unlabelled, inconsistent in unit (a percentage and an absolute), and one of them
describes **a round removed from the game in Update 2.3**. There is nothing here to scrape as stats.

So the `AMMO` wire-format gate's stated reason holds, and **A does not merge with F** as the prompt's
A1 hypothesised. But it does touch **D**: per-variant stat deltas exist in quantity — **1,268 of them**
— just per *weapon*, as `{{StatChange}}` in each weapon's own ammo section (A2), never on this page.

**A2 — Compatibility is a scrape, not a hand-authored table. One authoritative source, plus a
cross-check that must not be trusted as primary.**

**The authoritative source is the `== Ammo Types ==` section**, present on **139 of 147** weapon pages
— which is *every* weapon that takes custom ammo (the 8 without are the six melee weapons plus Flame
Rifle and Shredder). It lists each accepted round with its **per-weapon price**. From
[`/wiki/Weapons/Conversion`](https://huntshowdown.wiki.gg/wiki/Weapons/Conversion):
`{{Ammo|Dumdum Ammo}} - Scarce {{Scarce}}` and `{{Ammo|FMJ Ammo}} - 50 {{Hunt Dollars}}`.

**It also carries a far larger stat payload than an earlier draft credited.** Every one of those 139
pages uses `{{StatChange|field|from|to}}`, and there are **1,268 of them** in total — per-(weapon,
round) deltas across six main fields:

| `Muzzle Velocity` | `Drop Range` | `Damage` | `Extra Ammo` | `Vertical Recoil` | `Spread` |
|---|---|---|---|---|---|
| 310 | 276 | 208 | 198 | 164 | 101 |

*(Plus a long tail: `Ammo` 7, `Variable Damage` 2, `Loaded Ammo` 1, `Rate of Fire` 1.)* So choosing a
round is not just a price change — the wiki states exactly how it moves six of the weapon's own stats,
and `Extra Ammo` appearing 198 times ties directly to A3's reserve arithmetic. **None of this is in
`itemStats.json` today**, which makes it input to **D** as much as to A: it is a second stat tier,
keyed on (weapon, round) rather than on the weapon alone.

**Category membership looks like a cheaper second source, and it is not reliable enough to be the
primary one.** `action=query&prop=categories` on
[`/wiki/Weapons/Ranger_73`](https://huntshowdown.wiki.gg/wiki/Weapons/Ranger_73) does return
`Category:FMJ Ammo`, `Category:High Velocity Ammo`, `Category:Incendiary Ammo`,
`Category:Poison Ammo`, `Category:Subsonic Ammo` — one API call, no HTML parsing. But comparing the
category set against each page's own section across all 147 pages:

| | |
|---|---|
| category set == section set | **138 of 147** |
| **pages disagreeing** | **9** |
|  ‑ of those, section lists a round the categories omit | 7 |
|  ‑ of those, categories list a round the section omits | 7 |

*(7 + 7 exceeds 9 because five pages fail in both directions at once.)*

The nine failures are **not random — they are concentrated exactly on the weapons A exists to fix**:

- **Bolt and charge rounds lose their identity.** Crossbow, Crossbow/Deadeye, Hand Crossbow and
  Chu Ko Nu are categorised under the *rifle* round name — `Category:Explosive Ammo`,
  `Category:Poison Ammo` — not `Explosive Bolt` or `Poison Compact Bolt`. **A scraper keyed on
  categories would map the Crossbow's Explosive Bolt onto Long Explosive Ammo, which is precisely
  the conflation `/wiki/Ammo` warns against** ("they do not share compatible ammo types despite
  sharing a name and description"). It would reintroduce the bug `catalog.js` avoided by hand.
- **Bomb Lance and Bomb Launcher** carry only `Category:Dragon Breath`; Harpoon, Steel Ball and
  Waxed Frag are uncategorised entirely.
- **Two flat contradictions.** `Weapons/Dolch 96/Claw` carries `Category:FMJ Ammo` but its section
  lists only Dumdum. `Weapons/Nitro Express` carries `Category:Dumdum Ammo` while its section lists
  Explosive and **Shredder** — wrong in both directions.
- *(Benign: `Weapons/Flame Rifle` carries `Category:Oil Ammo` with no section, consistent with
  `Ammo Type=Oil`.)*

Independent evidence that category tags are applied by hand and can silently lag: `Consumables/The
Moon` is a live Tarot Card page that is **missing `Category:Tarot Cards`** altogether (§3.5).

**The section itself is far more reliable than the categories, and its one failure mode is detectable.**
Comparing every sibling page inside each weapon family — 35 of the 55 families have more than one page —
only **3 families disagree** with themselves about a round, and two of those are the per-slot convention
rather than an error (A3: Martini-Henry/Ironside and Romero 77/Alamo pay an exact 2×). That leaves
**one genuine stale page in 35 families**: `Mako 1895/Claw` prices Explosive Ammo at **100** while its
base page and its `Aperture` sibling both say **Scarce**, and all three share the same single reserve —
so it is not a reserve effect, it is a page that was not updated when Update 2.8 made Explosive Scarce.

That gives A a concrete validation rule instead of blind trust: **scrape the section, then reconcile
within the family**, and flag any round whose value differs across siblings that share a reserve shape.
It would have caught the Mako drift, and it is cheap — the family is the URL's second segment (B4).

**Credit where it is due: the repo worked this out before I did.**
`docs/audits/equipment-catalog-wiki-audit.md` §D.1.1 already states, without having read a page,
that "**the wiki models a custom-ammo variant as a per-weapon unlock with a per-weapon price**,
living in the weapon-tree table on each weapon's page", that `Category:Dumdum_Ammo` and siblings are
"indexes **of weapons**, not of ammo variants", and that "the app's shared per-class pool is an
app-side abstraction with no wiki equivalent, in the same sense `group` is." ADR-0005 carries the
same conclusion. **A2 is therefore a confirmation with page-level evidence, not a discovery** — the
new content is the 138/147 category-reliability measurement and the nine named failures.

So compatibility *is* a scrape rather than a hand-authored table — but it is a **wikitext-section
parse**, with categories useful only as a reconciliation signal that flags the nine pages above for
human review. **Scope reduced against the report's "hand-authored table" fear, but not as far as a
one-call category lookup would have allowed.**

**A3 — The two ammo slots are independently chosen, and prices are quoted PER SLOT.** Confirmed.
The decisive quote is the Bomb Lance update history,
[`/wiki/Weapons/Bomb_Lance`](https://huntshowdown.wiki.gg/wiki/Weapons/Bomb_Lance):

> "Lance can now equip **two different custom ammo types**. Extra ammo has been halved.
> Bomb Lance Dragon Breath price decreased to 10 {{Hunt Dollars}} **per slot**."

Corroborated independently by
[`/wiki/Weapons/Hunting_Bow`](https://huntshowdown.wiki.gg/wiki/Weapons/Hunting_Bow): "Arrows
price reduced from 65 to 50 {{Hunt Dollars}} **(25 {{Hunt Dollars}} per slot)**." Two separate pages
state the per-slot convention in their own words, so the convention itself is not in doubt.

**But do NOT infer a halving rule from it — I tried, and it does not hold.** The tempting pattern is
that a `"(N per slot)"` weapon is charged exactly half what a single-reserve weapon pays for the same
round. Tested across every (Ammo Type, round) pair having both kinds of weapon: **9 of 11 groups are
exactly 2×, and 2 are not** — and worse, **per-slot weapons disagree with each other**:

| Ammo Type · round | per-slot weapon | price | per-slot weapon | price |
|---|---|---|---|---|
| Long · FMJ | 1890 Cavalry `18 (9 per slot)` | **60** | Martini-Henry `20 (10 per slot)` | **30** |
| Medium · High Velocity | Maynard Sniper `26 (13 per slot)` | **60** | Springfield 1866 `24 (12 per slot)` | **30** |

Both pairs share an ammo class *and* a per-slot reserve, and still differ 2:1. So the listed figure
is a genuine **per-weapon, per-slot** price — not a class price, and not a mechanical halving of one.
A cost model must store it per (weapon, round); it cannot derive it from slot count.

**The best evidence is within a single weapon family, and it is exact.** Comparing sibling pages —
same family, so the weapon is essentially held constant — the one member that *loses* the two-slot
split pays precisely **2× on every round**:

| Family | member | reserve | prices |
|---|---|---|---|
| Martini-Henry | base, Deadeye, Marksman, Riposte | `20 (10 per slot)` | FMJ **30** · HV **35** · Incendiary **35** |
| | **Ironside** | `15` — single | FMJ **60** · HV **70** · Incendiary **70** |
| Romero 77 | base, Hatchet, Shorty, Talon | `(N per slot)` | Dragon Breath **10** · Penny Shot **5** · Slug **65** |
| | **Alamo** | `12` — single | Dragon Breath **20** · Penny Shot **10** · Slug **130** |

Six round-pairs across two families, exact 2× in every one, and in both cases the outlier is the only
single-reserve member. **That is the per-slot convention demonstrated rather than inferred** — and it is
why the *total* for a two-slot weapon that fills both slots equals the single-reserve price.

**But the multiplier is family-local, not global.** An earlier draft of this document first claimed
"per-slot weapons pay exactly half", then retracted it. Both were partly wrong: the rule holds *within*
a family and fails *across* families, because different weapons simply have different base prices. 1890
Cavalry and Martini-Henry are both Long and both per-slot, yet pay 60 and 30 for FMJ — each half of its
*own* full price, not of a shared class price. So `"(N per slot)"` predicts the **within-family
doubling** and nothing about the base figure. *(This
strengthens A5 rather than weakening A3: A3's per-slot convention rests on the two explicit page
statements above, which stand on their own.)*

So the report's hardest claim stands: **the wire format needs two ammo selections per weapon, and
that is a `FORMAT_VERSION` bump plus a migration.** It also adds a design fact the report did not
have — the listed price buys *one* slot, so filling both costs 2×. A cost model that stores one
price per (weapon, round) must record whether it is per-slot or per-weapon.

**A4 — Dual-family weapons: `AmmoType` names one family, the other is invisible, and there are seven
rows of them — not two.** An earlier draft named only LeMat and Drilling and mis-stated the signal.

Enumerated across all 147 pages, **exactly 7** carry a slash-separated `Loaded`/`Extra`, and all 7 are
dual-family:

| Weapon | `Ammo Type` | `Loaded` | `Extra` | app `ammoClass` | families in its ammo section |
|---|---|---|---|---|---|
| [Drilling](https://huntshowdown.wiki.gg/wiki/Weapons/Drilling) (+ Hatchet, Shorty) | Medium | `2 / 1` | `20 / 5` | **`shotgun`** | Medium + Shell |
| [LeMat](https://huntshowdown.wiki.gg/wiki/Weapons/LeMat) (+ Carbine, Carbine Marksman) | Compact | `9 / 1` | `18 / 3` | `compact` | Compact + Shell |
| [Haymaker](https://huntshowdown.wiki.gg/wiki/Weapons/Haymaker) | Long | `9 / 1` | `9 / 3` | `long` | Long + Shell |

All 7 mix a core-ammo family with the Shell family in their `== Ammo Types ==` section, and all 7 say
"combination firearm" or "additional shotgun barrel" in their own description. **A single `ammoClass`
cannot represent any of them — confirmed, at 7 rows rather than 2.**

**The app is also inconsistent about which family it keeps.** LeMat and Haymaker are typed to their
*primary* family (`compact`, `long`); the three Drilling rows are typed **`shotgun`** — the *secondary*
one — so the app offers the Drilling all five shell rounds (two of which, Dragon Breath and Starshell,
it cannot take) while hiding its Medium rounds entirely.

**Correction to the signal.** The earlier draft called the slash "the structural signal that a weapon
has two barrels." It is not — it marks **two ammo families**. Two multi-barrel weapons carry no slash
because both barrels feed one family:

| Weapon | description | `Loaded` | `Extra` |
|---|---|---|---|
| Nitro Express | double-barrel rifle, both barrels Nitro | `2` | `6` |
| Rival 78 (+ Mace, Shorty, Trauma) | double-barrel shotgun, both barrels shells | `2` | `12` |

Of 12 pages whose description says combination/double-barrel, only those 7 carry a slash. So the slash
is **sufficient but not necessary** for multi-barrel, and **exactly diagnostic** for dual-*family* —
which is the property `ammoClass` actually needs.

**A5 — Prices are NOT uniform within a class. The shared-pool model is invalid on its own terms.**
This is the question SPEC-0007's design asked outright and noted nobody had checked. The answer is
**no**, and — per A3 — the variation is *not* reducible to slot count, so a per-weapon price is
unavoidable.

Two pairs, each holding the ammo class, the round, **and** the reserve shape constant, so neither is
confounded by the per-slot convention:

| Ammo Type · round | weapon | reserve | price |
|---|---|---|---|
| Compact · High Velocity | [Bornheim No. 3](https://huntshowdown.wiki.gg/wiki/Weapons/Bornheim_No._3) | `15` (single) | **60** |
| Compact · High Velocity | [Marathon](https://huntshowdown.wiki.gg/wiki/Weapons/Marathon) | `24` (single) | **50** |
| Long · FMJ | [1890 Cavalry](https://huntshowdown.wiki.gg/wiki/Weapons/1890_Cavalry) | `18 (9 per slot)` | **60** |
| Long · FMJ | [Martini-Henry](https://huntshowdown.wiki.gg/wiki/Weapons/Martini-Henry) | `20 (10 per slot)` | **30** |

*(An earlier draft cited Centennial as a Compact example and Pax-vs-Springfield for Medium Poison.
Both were wrong: Centennial's `Ammo Type` is **Medium**, and the Pax/Springfield pair differs in
reserve shape, so it cannot separate per-weapon variation from the per-slot convention. The two pairs
above are the clean cases, re-read from raw wikitext.)*

**The full picture, across every (Ammo Type, round) group priced in Hunt Dollars:**

| | |
|---|---|
| groups total | **46** |
| uniform price across every weapon | **33** |
| price **varies** | **13** |

Of the 13 varying groups, **12 are an exact 2:1 pair** (30/60, 35/70, 25/50, 5/10, 10/20, 65/130).
The lone exception is `Compact · High Velocity` at **50/60** — Bornheim vs Marathon above — which no
multiplier explains.

**Where the 2:1 comes from — and why it still does not let you derive a price.** Twelve of the thirteen
pairs are the per-slot convention seen *within a family*: the single-reserve sibling pays double (A3,
Martini-Henry/Ironside and Romero 77/Alamo, six round-pairs, exact). That is systematic. What it does
**not** give you is the base figure: 1890 Cavalry and Martini-Henry are both Long and both per-slot, yet
pay 60 and 30 for FMJ — each half of its *own* price, not of a shared class price. And the same weapon
sits on opposite sides of the split for different rounds (1890 Cavalry: FMJ 60, High Velocity 35).

So there is no class price and no cross-family rule. **Price must be stored per (weapon, round)**, with
the per-slot flag alongside it — exactly the `availableAmmo` shape ADR-0005 deferred. That settles the
*storage* half of open question 3 in §5 by elimination; what remains open there is only how a two-slot
total is recorded, which is a wire-format choice rather than a wiki fact.

**A6 — `AMMO.special: []` is wrong for three weapons, and `catalog.js`'s stated reason is false.**
See §3.1 — this is a contradiction, not a confirmation. Summary of all nine `special` weapons plus
Bomb Lance, read 2026-08-12:

Re-derived from raw wikitext across **all 16** weapons the app types `special` or `none`, with the
currency template checked per round (Hunt Dollars vs Blood Bonds vs Scarce):

| Weapon | `Extra` | Wiki `== Ammo Types ==` | Hunt Dollars? |
|---|---|---|---|
| Bomb Launcher | `6 (3 per slot)` | Dragon Breath Charge 10 · Harpoon 5 · Steel Ball 5 · Waxed Frag 50 | **Yes — 4 rounds** |
| Bomb Lance (`ammoClass: "none"`) | `6 (3 per slot)` | the same four rounds, same prices | **Yes — 4 rounds** |
| Chu Ko Nu | `10` | Explosive Bolt (Scarce) · **Incendiary Bolt 25** | **Yes — 1 round** |
| Dolch 96 (+ Bullseye, Claw, Precision) | `10` | Dumdum (Scarce) | No — but ADR-0013 says cost 0, not absent |
| Nitro Express | `6` | Explosive (Scarce) · Shredder (Scarce) | No — same ADR-0013 point |
| Flame Rifle | `` | *(none; `Ammo Type=Oil`)* | Correctly empty |
| Shredder | `6` | *(none)* | Correctly empty |
| 6 melee (Cavalry Saber, Combat Axe, Railroad Hammer, Baseball Bat, Machete, Katana) | `` | *(none)* | Correctly `none` |

**Nine rounds priced in Hunt Dollars**, none in Blood Bonds — so the currency is not an escape hatch
for `catalog.js`'s claim. Two refinements the earlier draft missed:

- **Both bomb weapons are `(3 per slot)`**, so 10 / 5 / 5 / 50 are **per-slot** prices (A3). Filling
  both slots costs 20 / 10 / 10 / 100. Any fix that adds these rounds must carry the per-slot flag or
  it will under-price them by half.
- **`ammoClass: "none"` is right 6 times out of 7.** The six melee weapons genuinely have no ammo
  section; **Bomb Lance is the sole outlier**, and it is the one weapon in the whole catalog that both
  has four purchasable rounds and is modelled as having none.

**The Chu Ko Nu contradiction `catalog.js` flags is now resolved by the wiki, in the repo's
favour.** `/wiki/Ammo` states: "Only used in the {{Weapon|Hand Crossbow}} and {{Weapon|Chu Ko Nu}},
**but they do not share compatible ammo types despite sharing a name and description.**" So
refusing to hand it the `hxbow` pool was correct. The conclusion "therefore it gets nothing" was
not — it has its own two rounds.

**The headline number for A.** Diffing all 140 non-melee catalog weapons against their own pages
(name-normalised so `Frag Arrows` ≡ `Frag Arrow`, `Chaos Compact Bolt` ≡ `Chaos Bolt`):

| | |
|---|---|
| (weapon, round) pairs the app **offers** | 587 |
| pairs the wiki actually **lists** | 491 |
| **phantom** — app offers it, the weapon cannot take it | **243** |
| **missing** — the weapon takes it, the app cannot express it | **147** |
| weapons with at least one discrepancy | **137 of 140** |

Worked example, [`/wiki/Weapons/Conversion`](https://huntshowdown.wiki.gg/wiki/Weapons/Conversion)
(catalog tuple `["caldwell-conversion-pistol", "Conversion", 1, 55, "medium", "Pistols"]`, so its
pool is `AMMO.medium`): the app offers FMJ 22, Spitzer 60, Dumdum 28, Incendiary 24, Poison 21. The
wiki lists exactly two rounds — Dumdum (Scarce) and FMJ at **50**. So **three phantom rounds**
(Spitzer, Incendiary, Poison), and the one round both agree on is priced **22 against 50** — a 2.3×
under-charge.

- **Tier:** 1, unchanged. The report's ranking is right and the evidence is stronger than it knew.
- **Scope:** **reduced** on compatibility (A2 is a wikitext-section scrape, not a hand-authored
  table — though not the one-call category lookup it first appeared to be);
  **increased** on cost modelling (A3's per-slot pricing is a dimension the report did not model);
  **increased** on roster (9 `special` weapons + Bomb Lance, not 6).
- **Depends on:** nothing. Gates F1.

---

### C — Weapon action type and trait conditions · Tier 1

**C1 — There is no action-type field, and no action-type category.** Across all 147 pages,
`{{Infobox Weapon}}` uses **24 distinct field names**, every one a stat, a display flag, or a piece
of metadata — and none naming an action:

`Ammo Type, Cycle Time, Damage, Drop Range, Extra, Heavy Melee Damage, Heavy Stamina Consumption,
Loaded, Melee Damage, Muzzle Velocity, Price, Rarity, Rate of Fire, Reload Speed, Size, Spread,
Stamina Consumption, Sway, Title, Total, Update, Vertical Recoil, image, nodollarsicon`

Only **18** of those appear on every page; the rest are partial (`Rarity` 145, `Extra` 144,
`Stamina Consumption` 139, `Heavy Stamina Consumption` 15, `nodollarsicon` 4, `Total` 3). The
category probe returns only ammo categories and `Category:Weapons/Size N` — **no
`Category:Lever Action`**.

Action type appears **only in Description prose**, and only on **130 of 147** pages. The 17 silent
ones: all seven melee weapons, the five Sparks-family pages, both Maynard Sniper pages, Flame Rifle,
Shredder, Bomb Lance and Bomb Launcher.

**C2 — Trait conditions are prose, in two shapes, and only one is machine-readable.** The four pages
the checklist names, read 2026-08-12 (C4 widens this to all 17 conditional traits):

| Trait | How the condition is stated | Extractable? |
|---|---|---|
| [Bulletgrubber](https://huntshowdown.wiki.gg/wiki/Traits/Bulletgrubber) | `== Information ==` lists nine `{{Weapon\|…}}` links "and their variants", plus a negative: "Doesn't work with Derringers" | **Yes**, via template links |
| [Bolt Thrower](https://huntshowdown.wiki.gg/wiki/Traits/Bolt_Thrower) | "Reduced reload time for `{{Weapon\|Crossbow}}`, `{{Weapon\|Bomb Launcher}}`, and `{{Weapon\|Bomb Lance}}`" | **Yes** |
| [Levering](https://huntshowdown.wiki.gg/wiki/Traits/Levering) | "when using **lever-action weapons**" — a class, no links | **No** |
| [Fanning](https://huntshowdown.wiki.gg/wiki/Traits/Fanning) | "one-handed or two-handed **single-action pistols**" — a class, no links | **No** |

**C3 — The wiki DOES document an action-type taxonomy — as prose, on exactly one page.**
*(An earlier draft of this document claimed the validation feature was "unreachable from wiki data
alone". That was wrong — it had read the weapon pages and the trait pages, but not the `/wiki/Weapons`
index.)*

[`/wiki/Weapons`](https://huntshowdown.wiki.gg/wiki/Weapons) has a dedicated `=== Action Type ===`
section naming **eight** action types with definitions *and their trait interactions*:

| Action type | Traits the wiki attaches to it |
|---|---|
| Bolt Action | Iron Eye; "some" Bulletgrubber |
| Lever Action | Iron Eye; **"especially benefits from Levering"** |
| Pump Action | Iron Eye (little use on shotguns); "some" Bulletgrubber |
| Single-Shot | Fast Fingers (rifles). **"Single-Shot weapons can split their ammo pool between two ammo types, such as regular and custom, or two types of custom ammo."** |
| Double-Barrel | — |
| Semi-Automatic and Automatic | — ("far more expensive than any other kind") |
| Single-Action | **Fanning** |
| Double-Action | **"Cannot benefit from the Fanning trait"** |

And it explains the absence C1 found, in its own words: these categories "**aren't represented by
official designations and it's not possible to filter for them, however their used gets tracked and
players are able to unlock matching elements for their Player Profile**". So the game *does* track
action types internally but exposes no designation or filter — a much better warrant for hand-authoring
`actionType` than "the scraper can't parse it", and a caution that this taxonomy is the wiki's
reconstruction of an internal one rather than a published field.

Two independent checks that this is the only place it exists: the literal string "Action Type" appears
on **exactly one page** wiki-wide (`insource` search), and of the wiki's **199** categories none
encodes an action type (the only near-matches, `Bolt` and `Bolt Ammo`, are ammo categories).

**C4 — But "transcribe the map" does not work, and I claimed it did. The Action Type section is not a
conditional-trait map.** *(Correcting C3 above, which said "no hand-authoring needed".)*

Scanning all 58 trait descriptions in `itemStats.json`, **17 name a weapon class or kind**. The Action
Type section speaks to only about five of them, and the conditions run on **four different axes**:

| Condition axis | Traits | Can an `actionType` field express it? |
|---|---|---|
| Action type | Levering, Fanning, Iron Eye, Fast Fingers | **Yes** |
| Specific weapon / family | Bolt Thrower (Crossbows, Bomb Launchers, Bomb Lances), Hundred Hands (Hunting Bow), **Bulletgrubber** | No — needs a weapon list |
| Attachment | Steady Aim, Scopesmith ("scope or Aperture sights") | No — but variant *names* now encode it, post-`192aac5` |
| Item kind | Assailant, Berserker, Silent Killer, Surefoot, Pitcher, Dauntless, Blade Seer, Blast Sense, Ambidextrous | No — melee / throwables / consumables / matched pairs |

**Bulletgrubber is the decisive counterexample, and the Action Type section gets it wrong.** The
section says only that "some" Bolt Action and "some" Pump Action weapons benefit. But
[its own page](https://huntshowdown.wiki.gg/wiki/Traits/Bulletgrubber) enumerates nine weapons "and
their variants", and by those weapons' own descriptions they span **four** action types:

- pump-action — Marathon, Specter 1882
- bolt-action — Berthier 1892, Lebel 1886, Mosin-Nagant, Mosin Obrez
- **lever-action** — Terminus ("Winfield made, lever-action repeating shotgun")
- **semi-automatic** — Bornheim No. 3, Dolch 96

Lever and semi-auto are not mentioned in the section's Bulletgrubber note at all. **A rule
transcribed from the Action Type section would be wrong for three of the nine.** Bulletgrubber is an
explicit per-weapon list with a negative exception ("Doesn't work with Derringers") — not a class.

**Also worth noting: for the traits the section *does* cover, the trait's own description is the
better source.** Iron Eye's description already names all three action types itself ("bolt-action,
lever-action, and pump-action Weapons"); Fanning's already says "single-action pistols". The Action
Type section's genuinely unique contributions are exactly two: the **Double-Action negative** (Fanning
does not apply) and the **Single-Shot ammo-split rule**.

**Revised shape of the ADR — this is the real finding for C.** Validation does not need an
`actionType` field; it needs a small **vocabulary of condition kinds** — action type, weapon list,
attachment, item kind — because no single field covers more than a quarter of the 17. That is a
larger design question than "scrape or hand-author a column", and it is what the ADR should settle.
SPEC-0007 REQ "Fields the Scraper Must Not Derive" still governs the action-type axis; the other
three axes are new territory.

**On A3's mechanism — a partial corroboration, not a rule.** "Single-Shot weapons can split their ammo
pool between two ammo types" explains *why* two slots exist, and Update 2.6 corroborates it with a bug
report about "the **second ammo slot**" matching "the amount of Custom Ammo in the **first slot**" on
the Bomb Launcher. But it is not a reliable predicate: of the **32** weapons carrying
`"(N per slot)"`, 28 are Single-Shot by the wiki's own definition (which explicitly includes
"crossbows and bomb launchers"), while **the four Berthier 1892 rows are bolt-action carbines and
still split**. So `"(N per slot)"` in the `Extra` field remains the authoritative per-weapon signal;
the action-type prose explains the mechanic but must not be used to derive which weapons have it.

- **Tier:** 1, unchanged.
- **Scope:** **grew, and changed axis.** Not one hand-authored `actionType` column: 17 of 58 traits
  are weapon-conditional across **four** condition axes, and action type covers only about five of
  them (C4). The ADR's real job is choosing a condition vocabulary. `/wiki/Weapons` contributes two
  facts worth having — the Double-Action/Fanning negative and the Single-Shot ammo-split rule — but
  its Bulletgrubber note is incomplete and must not be transcribed.
- **Depends on:** nothing. Independent of A and B, as the report said.

---

### E — Acquisition class as a displayed attribute, and Burn traits as single-use · Tier 2

**E1 — Burn traits ARE consumed and removed. The app asserts something false.** Confirmed verbatim
at [`/wiki/Traits`](https://huntshowdown.wiki.gg/wiki/Traits):

> "**Burn Traits** are Traits that give an effect once before being **burned up and disappearing
> from a Hunter's loadout**. Most Burn Traits are also Scarce, with the exception of Necromancer."

**E2 — They cost points and hold a slot while held, so they are not a separate entity — but they
are not permanent either.** Same page: "Scarce and Burn Traits can also be removed from a Hunter in
the game menu, but no {{Upgrade Points}} will be paid back."
[Necromancer](https://huntshowdown.wiki.gg/wiki/Traits/Necromancer) carries `Cost=4` and
`Stack Limit=1`; the other four carry no `Cost` (they are also Scarce → 0 under ADR-0013). So
"Burn is a flag on a trait, not a third entity" is a defensible answer — the thing the app gets
wrong is only **permanence**, and that is one boolean, not a new loadout concept. **Scope reduced.**

**Rarity is a reliable structured field; stacking is not.** The report assumed neither was, and the
two need separating:

| Field | Coverage | Verdict |
|---|---|---|
| `Type` | **58 of 58** traits — `{{Trait_Type\|Burn,Scarce}}`, `{{Trait_Type\|Regular}}`, … | **Scrapeable.** This is what E should build rarity on. |
| `Category` | 58 of 58 (`Supportive`, `Offensive`, …) | Scrapeable, but it is the wiki's taxonomy, not `TRAIT_GROUPS` — see ADR/#162. |
| `Stack Limit` | **2 of 58** (Death Cheat, Necromancer) | **Not scrapeable.** Do not rely on it. |

`Stack Limit` fails three ways at once: it is absent on most traits; where present it is sometimes the
**empty string** (`Final Gasp`, `Shadow Crush` both carry `|Stack Limit=` with no value); and it is
contradicted by prose — [Remedy](https://huntshowdown.wiki.gg/wiki/Traits/Remedy) has **no** `Stack
Limit` field, yet its update history states it "can no longer be stacked up to three times, instead
being locked to a **single instance**". So single-instance-ness is real game state recorded only in
patch-note prose. If E wants to model it, that is a hand-authored fact, not a scraped one.

Verified per-trait, all nine zero-cost rows and Necromancer: every Scarce trait has **no `Cost` field**
on the wiki and **0 UP** in the app, and Necromancer is the lone `Burn`-without-`Scarce` trait, with
`Cost=4` matching its catalog row. That is the 49 Regular + 8 Scarce + 1 Burn split `catalog.js`
records, confirmed against the pages.

**E3 — Three spur colours over four types, plus a Sealed modifier.** `/wiki/Traits`: "These Trait
Spurs can either be **white** (indicating a Regular Trait), **red** (Burn Trait) or **blue**
(Scarce Trait)." Types are four — Regular, Burn, Scarce, **Event** — and Event traits have no spur,
being event-mechanic only. There is no fourth colour, but there is a fourth *asset*:
`World Item Sealed Trait Spur.png`, for red/blue spurs that "can only be used in exchange for
Pledge Marks". So the display vocabulary is **3 colours × an optional sealed state**.

**E4 — Shadow Crush was NOT replaced by Shadow Leap. They are different traits.** See §3.3. The
`catalog.js` revisit trigger has not fired, but it was drawn around a reading the pages do not
support.

**New, not in the report: a sixth Burn trait.** `Category:Traits/Burn` has **6** members —
Death Cheat, **Final Gasp**, Necromancer, Rampage, Relentless, Remedy — against the dataset's 5.
[`/wiki/Traits/Final_Gasp`](https://huntshowdown.wiki.gg/wiki/Traits/Final_Gasp) is
`Type={{Trait_Type|Event,Burn}}`, appears in one event (Tide of Desolation), and states no Upgrade
Point cost. **It is correctly excluded** under the `TRAITS` boundary's documented rule
(Event-only + no stated cost). Worth stating in the ADR so the next reader does not file it as a gap.

- **Tier:** 2, unchanged.
- **Scope:** **reduced.** Rarity is a structured scraped field, and Burn is a boolean on a trait
  rather than a third entity.
- **Depends on:** nothing.

---

### I — Cap categories, and the Tarot Card boundary · Tier 3 → **Tier 2, and reframed**

Both the report's premise and `catalog.js`'s rebuttal are wrong, and what replaced them is more
serious than either.

**I1 — The Tarot Card cap IS stated, and it is one of four named cap categories.** *(An earlier draft
of this document said the opposite. It had only read `/wiki/Consumables`, where no cap appears; the
rule is in the patch notes.)*

[`/wiki/Update/2.8`](https://huntshowdown.wiki.gg/wiki/Update/2.8) §"Inventory Slot Rework":

> "Consumables are restricted to **4 instances of the same type (Throwables, Placeables, Shots and
> [[Tarot Card]]s)**"

So `catalog.js`'s "Tarot Cards … have their own 4-per-loadout cap category" and the report's premise
are **both correct and both sourced**. `/wiki/Consumables` §"Tarot Cards" adds only that cards occupy
ordinary consumable cells — looted "so long as you have a **free Consumable slot** for them" — which
is consistent: they share the same eight cells and carry their own quantity cap.

**And the cap question is bigger than Tarot Cards.** The same sentence makes *every* consumable
type — Throwables, Placeables, Shots — capped at 4 per type, which is not what the app enforces
(§3.4). The `/wiki/Consumables` "4-slot inventory" line that an earlier pass built on is stale pre-2.8
text; ADR-0009's eight freely-mixed cells is confirmed correct by the same patch notes.

So recommendation I's real content is **not** "admit 14 rows". It is: **the rules engine needs a
per-type cap it currently refuses to have**, and Tarot Cards are one of four types that need it.

**I2 — Tarot Cards state the literal word `Scarce`.** Confirmed:
`/wiki/Consumables/The_Fool` has `Price=Scarce {{Scarce}}` and `nodollarsicon=true`. Under ADR-0013
they enter at cost 0, exactly as `catalog.js` predicts. Also useful: "All Tarot Cards can be sold
for 150 {{Hunt Dollars}} each" — a *sale* value, not a purchase price, and not something
`totalCost()` models.

**Count: the repo's fourteen is right — do not "correct" it to thirteen.** `Category:Tarot Cards`
returns 13, but the fourteenth (**The Moon**) is a live page missing its category tag. The discovery
crawl that produced the repo's list walks `Category:Consumables`, so it caught what the narrower
category drops. **I should admit 14 rows, not 13.** See §3.5.

- **Tier:** **1, raised from 3.** Not because of Tarot Cards — because Update 2.8 makes the app's
  consumable cap wrong for *every* consumable type, in the app's central arithmetic (§3.4).
- **Scope:** **inverted.** The Tarot admission is **14** rows at cost 0. Whether it needs a new cap
  mechanism turns entirely on the 8-vs-4 question: with a 4-slot consumable inventory the per-item
  cap suffices and `catalog.js` is right; with 8 shared cells it does not (§3.2). The real decision
  is therefore **whether tools and consumables share 8 cells or split 4 + 4** — an ADR-0009 question,
  not a Tarot one, and it should be split out under its own heading. A prior audit's "4 Placeables
  total" claim is most likely this same question in different words (§3.2).
- **Depends on:** an in-game observation the wiki cannot settle.

---

### G — Incremental wiki refresh ~~over the MediaWiki API~~ · Tier 3 → **pull forward**

> **SUPERSEDED (2026-08-12) by ADR-0016**, which decides this over **allowed HTML** rather than the
> API. The title's "over the MediaWiki API" is the part that is wrong; the recommendation to write it
> early is the part that survived.

The report argues G should move up because A and B multiply the crawl. **That argument survives** and
is the reason ADR-0016 exists. What does not survive is the assumption that the transport would be
cheap: `robots.txt` disallows the API, so detection costs 498 HTML fetches rather than 10 API
requests, and the saving moves from *fetching less* to *committing less*.

- **Tier:** 3, but sequence it ahead of A's implementation. **Unchanged** — and strengthened, because
  the expensive transport makes landing it before the payload grows matter more, not less.
- **Scope:** ~~**reduced** — the watermark already works; this is plumbing and cadence, not
  research.~~ **Larger than stated.** The watermark does already work (256 of 256 verified), but with
  the API off the table the design question is real: which signals are allowed, what may be
  scheduled, and what stays human-invoked. ADR-0016 answers those in two tiers.
- **Depends on:** nothing. Cheaper the earlier it lands.

---

### D — What the app does with the scraped stat block · Tier 2

Untouched by the wiki reads; the report's analysis stands on data it already had. Two number
corrections: the dataset is **256 items / 34 fields**, not 167 / 32, and the field inventory now
includes `EffectDuration` (15), `Quantity` (13), `FuseTimer` (9), `DamageperTick` (3),
`ControlRange` (3), `ThrowStaminaConsumption` (3). Absence is still the common case —
`Damage` covers 171 of 256, `EffectRadius` 20.

**Two new inputs from the wiki reads, and the second is substantial.**

1. `/wiki/Ammo` has **no per-variant stats at all** (A1 — seven digit runs on the whole page, two of
   them effect values). So a stat tier can never describe an ammo *type* in the abstract; the ammo
   select stays text-or-icon.
2. **There is a second stat tier the dataset does not carry, and it is bigger than it sounds.** Every
   one of the 139 weapon pages with an ammo section states how each round moves that weapon's stats,
   via `{{StatChange|field|from|to}}` — **1,268 deltas** across `Muzzle Velocity` (310), `Drop Range`
   (276), `Damage` (208), `Extra Ammo` (198), `Vertical Recoil` (164) and `Spread` (101). These are
   keyed on **(weapon, round)**, not on the weapon alone, so they do not fit `itemStats.json`'s current
   per-item shape at all.

That second point sharpens D's central question. The report frames it as "which of the 34 committed
fields to show". The real question is larger: **the wiki describes stats at two granularities** — a
base value per weapon, and a delta per (weapon, round) — and a planner that shows `Damage: 104` without
noting that the equipped round moves it is arguably *more* misleading than showing nothing. That is
exactly the "different obligation to be right" the report identifies, and it argues for deciding A's
schema before D's display, since the delta tier has nowhere to live until (weapon, round) is modelled.

**Verified, and it is starker than "the app renders one field": the module exports six things and the
app consumes one.** Tracing every non-test importer of `client/src/data/itemStats.js`:

| Export | Non-test consumers |
|---|---|
| `descriptionFor` | `Picker.jsx`, `TraitsPanel.jsx` |
| `statsFor` · `dualWieldFor` · `statFieldFor` · `ITEM_STATS` · `STATS_GENERATED` | **none** |

*(`catalog.js` mentions `statFieldFor` at line 798, but that is a governing comment describing how a
figure in the comment was derived — `catalog.js` has no `import` statements at all, so it cannot call
it.)*

**The sharpest example of D's thesis is `dualWield`.** #178 (`32a0ba5`, merged the same day as this
review) exists specifically to lift dual-wieldability *out* of the description blob into its own
queryable boolean — its stated rationale is that "a scraper that captures the description string
satisfies §3.0 while leaving dual-wieldability locked inside a blob of text." The field is now
populated (**`true` for 25 of 256 items**), the accessor `dualWieldFor` is written and tested, and
**nothing in the app calls it.** A whole PR's worth of value, scraped and committed and not collected
— which is exactly the gap D names, now with a dated instance rather than a general claim.

- **Tier:** 2, unchanged. Still the cheapest useful win.
- **Depends on:** nothing for the *display* decision, and `dualWield` is a same-day starting point —
  the data and accessor already exist, so the only missing piece is a render site. But the
  **(weapon, round) delta tier depends on A**, because it has nowhere to live until a weapon's rounds
  are modelled individually.

---

### F — Iconography for entities with no catalog row · Tier 2 → **narrowed to ammo only**

**F1 — Every ammo variant has its own icon, and coverage is complete.** `list=allimages&aiprefix=Ammo`
returns **102** files; two (`Ammo_Collage.png`, `Ammo_Choke_Bomb.png`) are not variant icons, leaving
**100** — `Ammo_Compact_Dumdum.png`, `Ammo_Shell_Flechette.png`, `Ammo_Compact_Bolt_Chaos.png`, and
so on. The sharper test: `/wiki/Ammo` references **44** distinct `{{Ammo_Icon|…}}` names, and **all
44 resolve to an existing file — zero missing.** The surplus beyond 44 covers per-weapon rounds not
listed on the index page.

`client/public/images/ammo/` still does not exist (0 files). Ammo remains the only thing the app
prices that has never had a picture, and — unlike the situation ADR-0002 faced — the art is already
complete on the wiki, so this is a scrape rather than a sourcing problem.

**F2 — Already solved, and not by this recommendation.** All 92 variant subpages carry a distinct
`image=` value (`Weapon Berthier 1892 Deadeye.png`), and `192aac5` shipped all of them.

**Verified through the app's own path derivation, not by counting files.** Running
`client/src/utils/slugify.js` over every catalog row and checking `/images/{category}/{slug}.{ext}`
against what is committed:

| Category | Rows | Files | Resolve |
|---|---|---|---|
| weapons | 147 | 147 | **147** |
| tools | 21 | 21 | **21** |
| consumables | 30 | 30 | **30** |
| traits | 58 | 58 | **58** |

A perfect bijection in both directions — every row finds art, and **zero committed weapon files are
claimed by no row**. So the SVG fallback tier never fires for any modelled item today, which is what
makes the fallback's real audience unreleased content (§F above). The report's worry that variants would multiply the image payload is
answered — it did, by +161% (924 KB → 2409 KB against a 5.44 MB tree), and that cost is recorded
in the commit against ADR-0002.

**Correction to the report's SVG-fallback premise — it describes a structure `main` does not have.**
The report says "the per-item SVG override maps in `catalog.js` are **empty by design**" and that
there are "exactly five glyphs per category". On `main`:

- **There are no per-item override maps, empty or otherwise.** `toolThumb`, `traitThumb` and
  `consThumb` (`catalog.js:905-915`) are one-line group dispatches — `TOOL_THUMBS[tool[3]] ||
  TOOL_THUMBS.Utility`. There is no two-tier lookup to fill in.
- **Glyph counts are 7 / 5 / 5, not five each.** `TOOL_THUMBS` gained `Decoys` and `Sidearms` when
  `a794e86` split the Utility bucket (#166), and `catalog.test.js` now asserts one *distinct* icon
  per declared group. So the tool tier is already per-group-refined.
- The report's "all sixteen Medical traits draw the same cross" **is** correct — `TRAIT_GROUPS`
  Medical holds exactly 16 rows.

**And `catalog.js`'s own header comment is stale in the same way** — see §3.7. That matters here
because the report's recommendation is built on the header's description rather than the code.

- **Tier:** 2, unchanged.
- **Scope:** **substantially reduced** — F2 is done, so this is "give ammo an image tier". The
  per-item-SVG half of the question does not exist as scoped: adding per-item icons means
  *introducing* a second tier, not populating an empty one. The Tarot/Event/world-item bullets fold
  into I and E.
- **Depends on:** **A** (ammo needs rows before it can have art). Unchanged.

---

### H — The in-game hunter as a modeled entity · Tier 3 → **demote; its payoff does not exist**

The report's H rests on a `[VERIFY]` that turns out to be false. See §3.6.

**H1 — Hunter pages carry none of the five fields the report expects.** Two pages, two different
templates, same field vocabulary:

| Page | Template | Fields |
|---|---|---|
| [Bad Hand](https://huntshowdown.wiki.gg/wiki/Hunters/Bad_Hand) | `{{Infobox Hunter Variant}}` | 12, all of them per-variant `_title` / `_caption` / `_Source` / `_Pacts` pairs plus `Name`, `Rarity`, `images` |
| [The Beast Hunter](https://huntshowdown.wiki.gg/wiki/Hunters/The_Beast_Hunter) | `{{Infobox Hunter}}` | 9: `Title`, `image`, `caption`, `Name`, `Rarity`, `Source`, `Update`, `Pacts`, `Event Boost` |

**Neither page mentions Hunt Dollars, Blood Bonds, Recruit, Tier, Rank or Health Chunk even once** —
so no recruitment cost, no rank or tier, no starting loadout, no starting traits, no health-chunk
configuration. *(An earlier draft asserted Beast Hunter was "the same shape" without checking; it is,
and it uses the non-variant template.)* Nor is there a table to mine: the `== List of all Hunters ==`
section is **23,515 characters containing zero `wikitable`s** — galleries only, so there is no
per-hunter cost or tier column anywhere. **ADR-0007's scope was correct.**

**The starting kit is random, so it is not data.** [`/wiki/Hunters`](https://huntshowdown.wiki.gg/wiki/Hunters)
§"Free Hunters": four free hunters after each mission, with "a **random** name and come with
relatively cheap Weapons, a melee tool and a First Aid Kit as well as a **random** Consumable and
**one random Trait**." There is no per-hunter starting loadout to diff against. **H's stated payoff
— "a planner that knows a recruit's starting kit can price the delta" — cannot be built**, because
no such kit exists per hunter. The generator spec could inform ADR-0010's archetypes; that is a
smaller and different feature.

**H2 — Recruitment is a flat 100 Hunt Dollars, but a per-hunter Blood Bonds price does exist — and the
repo already ships it.** `/wiki/Hunters`: "he can spend **100 {{Hunt Dollars}}** to recruit a Common or
Legendary hunter." Blood Bonds sit at a different layer — *unlocking* a Legendary hunter's appearance
in the store, and roster slots at 150 BB each. So the report's worry that recruitment cost is sometimes
Blood Bonds conflates **recruiting** with **unlocking**, and `totalCost()` can stay one number for
recruitment.

**The correction to my own earlier framing:** I wrote that `hunters.json` carries "the only per-hunter
facts the wiki states" as if that excluded price. It does not — **60 of the 242 rows carry a Blood
Bonds figure inside `source`**, as unparsed display text, across nine price points:

| 300 | 400 | 500 | 600 | 700 | 800 | 900 | 1000 | 1500 |
|---|---|---|---|---|---|---|---|---|
| 4 | 3 | 6 | 6 | 5 | 12 | 10 | 12 | 2 |

e.g. `{"id":"bloody-red-hood", "source":"900 Blood Bonds", "acquisition":"blood-bonds"}`. So a
per-hunter acquisition price is **already scraped and committed**, just not lifted into a numeric
field — the same shape as `dualWield` before #178, and the same shape as the description blob that #178
was opened to fix. If H wants to price hunters at all, the figure is there for 60 of them and the work
is parsing, not scraping. That also means ADR-0013's "does `totalCost` stay one number" question is
live for hunters in a way the report located in the wrong place: not in recruitment, but in unlocking.

**What is genuinely there, and is more interesting than the roster:** health chunks are a
**player-configurable, Upgrade-Point-costing** budget. `/wiki/Hunters` §"Health & Death": 150 HP
split into 50 or 25 HP chunks, "The player can distribute them freely, only the lowest 50 HP can not
be altered"; and §"Hunter XP & Level": Upgrade Points "can be used to purchase Traits **and restore
lost Health Chunks** — a small Health Chunk costs 1 {{Upgrade Points}}, a big costs 2." So health
chunks compete with traits for the same UP budget the app models as traits-only. That is a real
arithmetic gap, and it is the strongest remaining reason to write H.

**Bonus — the wiki confirms the app's loadout rules verbatim.** `/wiki/Hunters` §Equipment: "Each
Hunter can carry **two weapons**, up to eight Tools and/or Consumables and up to **15 Traits**.
While **each Tool has to be a different one**, the Hunter **can carry multiple items of the same
Consumable**." That independently validates `TRAIT_MAX = 15`, the two weapon slots, and
`consCount()`'s per-item rule (against the retired per-type rule) — and it is the same sentence
that conflicts with the Consumables page on 8 vs 4 (§3.4).

- **Tier:** **demote below D, E and F.** Its headline feature is unbuildable.
- **Scope:** **inverted.** Not "model a recruit's starting kit" (no data) but "model health chunks
  as a second claim on the Upgrade Point budget."
- **Depends on:** nothing. Overlaps ADR-0012's UP-budget reasoning.

---

### B — Weapon variants as first-class catalog entities · Tier 1 → **do not write as scoped**

**B1 — The Conversion page's "12" is one weapon plus a cosmetic skins tabber. Zero functional
variants live on it.**
[`/wiki/Weapons/Conversion`](https://huntshowdown.wiki.gg/wiki/Weapons/Conversion), read 2026-08-12:

- **1** `{{Infobox Weapon}}` — Price 55, Size 1, `Ammo Type=Compact`. The only functional stat block.
- **10** `{{Infobox Weapon Skin}}` under an `== Skins ==` tabber — Spite, The Pearl, Faultless, Ash,
  Ember, Honor's Gift, Argent Widow, Onyx Iron, Mass Fortitude, The Counterpart — priced in **Blood
  Bonds** or sourced from DLC/events. None carries a `Size`, a `Price` in Hunt Dollars, or any stat.
- **12** tabber tabs, which is where `variantCount: 12` comes from: `Base Weapon`, the ten skins, and
  `Not This Time`, a tab with no infobox at all.

So the page's "12" is a **tab count**, not twelve stat blocks — see B2. Its one functional variant,
`Conversion/Chain Pistol`, is a **separate page**, declared at the top by `{{Weapon_Variant_List}}`.

**B2 — It generalises perfectly. Across all 147 pages: 147 `{{Infobox Weapon}}` and 567
`{{Infobox Weapon Skin}}`. Not one page carries more than a single base infobox.**

**The functional-variant gap is zero — but the report's 302 is not simply "302 skins", and an earlier
draft of this document got that reconciliation wrong.**

The report's 360 came from summing `variantCount` in `itemStats.json`. That field is
`result.infoboxCount` (`scrape-stats.mjs:510`), which is `extractInfoboxes(html).length` — a count of
`<div class="…druid-infobox…">` nodes in the **rendered HTML** (`scrape-stats.mjs:186`). It therefore
counts *every* infobox the page renders, including ones transcluded by `{{Consumable|…}}`,
`{{Trait|…}}` and `{{Weapon|…}}` cross-references, not just weapon and skin infoboxes. Today across
the same 147 pages: **`variantCount` sums to 802**, while `{{Infobox Weapon}}` + `{{Infobox Weapon
Skin}}` is **714**. So ~88 of those nodes are neither a weapon nor a skin.

Attempting to reproduce the report's figure on its own 58 pages (the 55 family pages plus the three
variants the catalog already carried) gives **58 base + 271 skins = 329**, not 360. The residue is
the non-weapon infoboxes above. **So "302 more stat blocks" was never a count of stat blocks at all
— it counted infobox-shaped DOM nodes**, which is why it could not be spent as-is, exactly as the
report suspected but for a different reason than it gave.

**What is solid is the base-infobox count, and it settles the question:** every one of the 147 pages
carries exactly **one** functional weapon stat block. And the two 147s are not merely equal counts —
resolving each catalog row through its `itemStats.wikiUrl` against `Category:Weapons` gives a
**perfect one-to-one correspondence**: every row maps to a category page, every category page is
claimed by a row, **nothing missing in either direction**. The functional-variant gap is **zero**.
The real gap was 89 separate pages, and `192aac5` imported all 89.

**B3 — Variants must be rows, which is what the import did.** All 92 variant subpages state their
own `Size` and `Price`; **92 of 92 differ in price** from their parent and **32 of 92 differ in
size** — Centennial 4 → Shorty 2, LeMat 1 → Carbine 3, Maynard Sniper 4 → Silencer 5. Since
`capUsed()` reads position 2, a variant modelled as a label would corrupt the size budget. The
report's central schema question is answered, and answered the way `main` already implemented it.

**B4 — Enumerable, and ADR-0005's path rule is confirmed.** `Category:Weapons` returns all 147 titles
with a clean segment distribution: **55 two-segment** family/base pages + **92 three-segment** variants,
**maximum three segments, zero four-segment paths.** The five multi-word leaves —
`Centennial/Shorty Silencer`, `Conversion/Chain Pistol`, `LeMat/Carbine Marksman`,
`Officer/Carbine Deadeye`, `Sparks/Pistol Silencer` — collapse compound names into one segment exactly
as ADR-0005 records. **No seed list needed.**

*(One small drift in ADR-0005: of the four compound examples it names, three exist and
**`Uppercut/Precision_Deadeye` does not.** The category carries only `Uppercut/Deadeye` and
`Uppercut/Precision`, and the catalog matches it with `uppercut-deadeye` and `uppercut-precision`. The
rule the example illustrates is still right; the example has gone stale.)*

**B5 — Yes, and it is unambiguous: the template name.** `{{Infobox Weapon}}` vs
`{{Infobox Weapon Skin}}`. A scraper can split variant from skin with no heuristics — which is why
`192aac5`'s discover run "found zero cosmetic skins among the 89 unmatched pages" and dropped its
classify-skins deliverable.

- **Tier:** n/a — **do not write this ADR as the report scopes it.** Its rows are imported, its
  schema question is settled by evidence, and its variant/skin question has a structural answer.
- **What survives, and deserves its own smaller ADR or just issue #248:** the picker at 147 rows.
  That is the real cost ADR-0005 was pointing at, and `192aac5` says so explicitly.
- **Depends on:** nothing. It no longer gates anything.

---

## 2. Recommended order

Revised from the report's `A, B, C`:

Revised from the report's `A, B, C`. **The largest change is that I moves from last-tier to
co-first**, because Update 2.8 turns it from a Tarot scope question into a live rules-engine defect.

1. **A** — ammo model. Unchanged as first, and now backed by 243 phantom offers and 147 missing ones.
2. **I (the cap half)** — the consumable cap is **per type**, and the app enforces per item (§3.4).
   No schema or wire-format change, but it reverses a normative `MUST NOT` in an accepted spec, so it
   needs the ADR. The Tarot rows are bookkeeping that follows from it; the 8-vs-4 question is **closed**
   (8, ADR-0009 confirmed).
3. **G** — refresh, *before* A's scrape lands, while the payload is 256 items and not 500.
   *(Decided as **ADR-0016**, over allowed HTML rather than the API — see the amendment at the top.
   The "land it early" argument is unchanged and matters more, not less, now that the transport is
   expensive.)*
4. **C** — trait conditions. Reshaped and **larger** than the report scoped it: four condition axes,
   not one action-type field (C4).
5. **E** — rarity + Burn permanence. Cheaper than the report thought.
6. **D** — stat block. Still the cheapest win *for display*; the (weapon, round) delta tier waits on A.
7. **F** — ammo art only; gated on A.
8. **H** — health chunks as a UP claim. Demoted; its recruit-delta premise is gone.
9. ~~**B**~~ — implemented by `192aac5`. Residue is the picker (#248).

**If only one gets written: still A.** Every argument the report made for it survived verification, and
four new ones appeared — Bomb Lance has four purchasable rounds while typed `"none"`; **`AMMO` violates
the already-accepted ADR-0013 in both directions**, charging $22–$90 for five rounds the game gives away
(§3.8); dual-family weapons are 7 rows, not 2 (A4); and 137 of 140 weapons are mispriced or misoffered
today.

**If only one gets *fixed*: the consumable cap** — but not because it is small. An earlier draft of this
document called it "a handful of lines in `consCount`". Measured, it is not:

- **3 code sites** — `calc.js:36` (`consCount`), `loadoutSlice.js:48` (the reducer), `Picker.jsx:91`
  (the picker's disabled state, which SPEC-0005 requires to share the reducer's predicate).
- **3 test files with explicitly contrary assertions** — `calc.test.js:67` constructs "Dynamite Bundle
  (Throwable)" as a *legal* case, `loadoutSlice.test.js:31` asserts "4 Dynamite Sticks fill their own
  budget", and `catalog.test.js:229-235` exists specifically to pin "what the cap is **NOT** (per type)".
- **5 spec documents**, including — and this is the expensive part — a **normative reversal**.
  `equipment-catalog-dataset/spec.md:150` states that `CONS[i][3]` "is descriptive … and **MUST NOT be
  re-introduced as a cap key**", plus SHALL-level scenarios in that spec and in
  `equipment-slot-arrangement/spec.md` asserting a Dynamite Bundle and a Stamina Shot are accepted after
  four of a sibling.

So the honest framing is the opposite of "smallest diff": **an accepted spec's `MUST NOT` has to be
reversed, and four SHALL scenarios inverted.** That is exactly why it belongs in an ADR rather than a
patch — the repo deliberately closed this door across #190 and #207, and reopening it needs a recorded
decision, not a bug fix. What makes it *first* is that it is wrong in the app's central arithmetic right
now and needs no schema or wire-format change, not that it is cheap.

---

## 3. Contradictions with accepted ADRs, specs, or `catalog.js` — flagged, not fixed

### Disposition (added 2026-08-12, after the eight ADRs landed)

This section was written to flag rather than fix, and the flagging stands as originally written below.
Each item has since been decided. Recorded here rather than by editing the findings, so the original
reading and its disposition are both legible.

| Item | Disposition |
|---|---|
| 3.1 | **Split.** Populating `AMMO.special` is not wire-format gated — the pool is empty, so any write is an append. Re-typing Bomb Lance off `ammoClass: "none"` **is** gated and belongs to ADR-0014. The false comment is correctable now. |
| 3.2 | **Closed by ADR-0015** (accepted 2026-08-12). Not a Tarot special case, exactly as this finding argued — the per-item cap it relied on is retired, so the `CONS` boundary's "no new modelling" argument goes with it. |
| 3.3 | **Correction, no ADR.** The Shadow Crush ↔ Shadow Leap replacement claim is false and the hold-back's revisit trigger as worded can never fire. The general ground survives; the concrete case and the trigger both need rewriting. |
| 3.4 | **Closed by ADR-0015**, accepted after the Arsenal check confirmed the per-type cap. See that ADR's Amendment (2026-08-12). |
| 3.5 | No action — not a contradiction; the repo was right. |
| 3.6 | No action — the premise was false and H was demoted accordingly. |
| 3.7 | **Correction, no ADR.** The header describes a two-tier SVG lookup the code does not implement. ADR-0020 independently decided the fallback stays group-level, so the comment should be corrected to describe the code, not the code changed to match the comment. |
| 3.8 | **Not gated — fixable now, ahead of ADR-0014.** Repricing is an in-place value change; it moves no index. This finding's own claim that "either fix reorders or reprices a pool, so both sit behind the `FORMAT_VERSION` gate" is **wrong for the repricing half** — see the correction below. **The count is eight rows, not five — confirmed 2026-08-12, see § 3.10.** |
| 3.9 | **ADR-0014.** Moving misfiled rounds between pools is insert/remove/reorder, which is genuinely gated. |

**Correction to 3.8's closing paragraph.** It states that both the omission fix and the repricing fix
"sit behind the `FORMAT_VERSION` gate". The gate comment at `catalog.js:32-45` scopes itself to
"inserting, removing, or reordering a variant inside a pool", because those move positions and a saved
selection persists as a bare index. Changing a row's price in place moves nothing: after
`["Dumdum", 22]` → `["Dumdum", 0]`, a loadout that stored index 2 still means Dumdum, and only the cost
line changes — which is the intended effect. So the repricings need no bump and no migration, and
should not wait on ADR-0014. This matters because 3.8 is a live violation of an **accepted** decision
(ADR-0013) that renders a $90 charge for a round the game gives away.

ADR-0014 reached the same conclusion independently — "repricing the five Scarce rows to 0 moves no
index and so needs **no** `FORMAT_VERSION` bump at all under SPEC-0007's positional gate" — but it
records that under a *rejected* option ("Keep the shared pools and correct the data in place"). That
option was correctly rejected as a **substitute** for the per-weapon model, on grounds that do not
apply to shipping the reprice **ahead** of it: a data fix cannot express availability or a second slot,
but the reprice spends no migration, so it forecloses nothing.

**And the row count is wrong — it is eight rows, not five.** 3.8's table lists `compact` Dumdum 22,
`medium` Dumdum 28, `slong` Spitzer 90, `xbow` Explosive Bolt 40 and `bow` Frag Arrow 45. Counted
against `catalog.js` on `main` at `c141367`, Update 2.8's "Dum Dum Ammo, Explosive Ammo, and Spitzer
Ammo is now Scarce for **all weapons**" also catches three rows the table omits:

| Omitted row | App price |
|---|---|
| `AMMO.long` Dumdum | **34** |
| `AMMO.medium` Spitzer | **60** |
| `AMMO.long` Spitzer | **75** |

Dumdum appears in three pools and Spitzer in three; the table caught two of the first and one of the
second. This needs confirming per-round against the weapon pages before the ticket is written — but if
it holds, a ticket scoped to "the five Scarce rows" would leave the same bug live in three more places,
including the largest single overcharge after `slong` Spitzer.

### 3.1 `catalog.js` AMMO comment: "none of their custom rounds can be bought with Hunt Dollars"

`client/src/data/catalog.js:55-63` justifies `special: []` on that claim. Checking the currency
template on every round of all 16 `special`/`none` weapons: **nine rounds are priced in Hunt Dollars
and none in Blood Bonds** — Bomb Launcher (Dragon Breath Charge 10, Harpoon 5, Steel Ball 5, Waxed
Frag 50), Bomb Lance (the same four), and Chu Ko Nu (Incendiary Bolt 25). **Bomb Lance** is typed
`ammoClass: "none"` — melee — so the app offers it no ammo control at all, and both bomb weapons price
those rounds **per slot** (`Extra = 6 (3 per slot)`), so a naive fix would under-charge them by half.

Compounding it: for Dolch 96 and Nitro Express the rounds *are* Scarce, and **ADR-0013 retired
unpurchasability as grounds for exclusion**, admitting Scarce items at cost 0. The comment's own
text anticipates this tension; the wiki now shows the factual half is also wrong.

**This also contradicts an audit, not just the comment.**
`docs/audits/equipment-catalog-wiki-audit.md` §D.1.1 concludes that the `AMMO.special` exclusion —
"Dolch and Nitro custom ammo has been Scarce and unpurchasable since 2.8" — is "**consistent with
everything** [the audit] found". That held for the two weapons it named; it does not hold for the
four added later by #233, three of which (Bomb Launcher, Chu Ko Nu, Bomb Lance) do sell rounds for
Hunt Dollars. The audit predates those rows, so this is drift rather than an error in the audit —
but the "consistent with everything" line should not be cited as current support.

**Partly already recorded:** `docs/audits/weapon-catalog-wiki-audit.md:96` already flags the Bomb
Lance as "grouped `Melee` in-app while the wiki treats it as a special/large-slot weapon", and as a
variant modelled as a base weapon. What is new here is the *ammo* consequence — `ammoClass: "none"`
means the app cannot express any of its four purchasable rounds — and that its own page is the
evidence for A3.

### 3.2 `catalog.js` CONS boundary vs `calc.js`: the Tarot cap claim does not hold

`0d32096` added: "the per-item consumable cap (#155, SPEC-0008) means their own 4-per-loadout cap
category needs **no new modelling** — what is capped is the specific item, so a fourth Tarot Card is
bounded by the same rule as a fourth Frag Bomb."

**The claim fails, and Update 2.8 says why.** `slotMax()` returns `8 - blocked` and `consCount()`
counts per specific index, so **eight Tarot Cards would pass both checks** — 4 of one card plus 4 of
another, all under the per-item cap, eight cells available. Update 2.8 caps Tarot Cards at **4 per
type**, so the app permits double the legal number. A fourth Tarot Card is *not* "bounded by the same
rule as a fourth Frag Bomb": the real rule bounds the fourth *card of any kind*.

This is one instance of the general defect in §3.4 — the app enforces per-item where the game enforces
per-type — so it should be fixed there, once, rather than as a Tarot special case.

**A prior audit had this right, and the app moved away from it.**
`docs/audits/equipment-catalog-wiki-audit.md` §B.3.4 says the app "allows 4 Medical Packs *plus* 4
Ammo Boxes where **the game allows 4 Placeables total**", and §B.3.3 reasons that "the game's cap
categories are *mechanical* (how the item is used), not thematic". **Update 2.8 confirms both
statements.** The audit predates #190's switch to per-item counting, which means the repo had a
correct finding on record and then superseded it — see §3.4 for the paper trail. The audit's
`Category:Throwable_Consumables` arithmetic, which it carefully labelled "suggestive rather than
probative", was pointing at a real rule.

### 3.3 `catalog.js` TRAITS boundary: Shadow Crush was not silently replaced

`client/src/data/catalog.js` grounds the 17-trait hold-back in: "`Traits/Shadow Crush` appears to
have been replaced by `Traits/Shadow Leap` with neither page saying so." The pages describe **two
different traits**:

| | Shadow Crush | Shadow Leap |
|---|---|---|
| `Type` | `Event` | `Scarce` |
| `Category` | Offensive | **Movement** |
| Effect | "damage any Monster or Target once. (25m)" | "channel a Monster within range to jump to its location and kill it instantly. Excludes Targets. (50m)" |
| History | one event (Post Malone's Murder Circus) | Event → regular game as Scarce in 2.0; retuned in **2.8.1** |

Different type, category, effect, range and target set. There is no evidence of a replacement
relationship. **The boundary's general ground survives** — Shadow Crush is an Event trait with no
liveness signal, which is exactly the untrustworthiness the hold-back is really about — but the
concrete case it was "drawn around" is a misreading, and the revisit trigger as worded ("when Shadow
Crush is resolved either way") may never fire because there is nothing to resolve.

### 3.4 RESOLVED — ADR-0009 is right about 8 shared cells, **but the consumable cap is per TYPE and the app made it per ITEM**

An earlier draft of this document called the 8-vs-4 question unanswerable from the wiki and referred
it to an in-game check. **That was wrong: it is settled in the Update 2.8 patch notes**, which the
earlier pass had not read. `/wiki/Consumables`'s "4-slot inventory" sentence is simply *stale* —
pre-2.8 text, corroborated by Update 2.6's bug reports referring to "Consumable slots 1 and 4".

[`/wiki/Update/2.8`](https://huntshowdown.wiki.gg/wiki/Update/2.8) §"Inventory Slot Rework", read
2026-08-12, states the current model in four bullets:

> * "Weapons are assigned a size from **1 to 5**, as opposed to the previous (small, medium, large range)."
> * "The player's default **weapon capacity is 5** and can be extended to **6** with {{Trait|Quartermaster}}."
> * "**Tools and consumables are no longer restricted by type. Players can freely equip any tool or consumable to any slot, in any combination.**"
> * "**Consumables are restricted to 4 instances of the same type (Throwables, Placeables, Shots and [[Tarot Card]]s)**"

**Bullets 1–3 vindicate the app exactly.** Weapon sizes 1–5, `capMax` of 5 rising to 6 with
Quartermaster, and freely-mixed tool/consumable cells are `WEAPONS[i][2]`, `calc.js:capMax` and
ADR-0009's eight-cell grid, confirmed almost word for word. **Nothing to fix, and §5's in-game check
is no longer needed for this.**

**Bullet 4 contradicts the app.** The cap is **4 per type**, where the four types are exactly
Throwables, Placeables, Shots and Tarot Cards. `CONS[i][3]` already holds three of those four
(`Throwable` 18, `Shot` 9, `Placeable` 3 rows) — and `consCount()` deliberately stopped reading it:

```js
// calc.js:33-38 — "The 4-consumable cap is per specific consumable, not per type: four Dynamite
// Sticks plus a Dynamite Bundle is a legal build."
export function consCount(loadout, consIndex) {
  return loadout.equip.filter((e) => e.t === "C" && e.i === consIndex).length;
}
```

Per Update 2.8, **four Dynamite Sticks plus a Dynamite Bundle is not a legal build** — both are
`Throwable`, and the fourth Stick exhausts the Throwables budget. The app under-constrains: with 8
cells it will accept 8 Throwables (4 Sticks + 4 Bundles) where the game permits 4.

This is not a stray line — it is a documented, multi-issue migration in the wrong direction:

| Artifact | What it says |
|---|---|
| `calc.js:33-38` | "the cap is per specific consumable, **not** per type" |
| `loadoutSlice.js:48` | `if (t === "C" && consCount(state, i) >= 4) return;` |
| `catalog.test.js:229-235` | pins "what the cap is **NOT** (per type)"; records that #190 "replaced the per-type cap with per-item `consCount`" and that #190's own "Done means" asked for "a 5th Placeable is rejected", **declined as reintroducing the retired rule** |
| SPEC-0006 | corrected by #207 to state the cap per item, "`type` as descriptive rather than a rules input" |
| SPEC-0008 spec.md:157 | "**counted per specific consumable rather than per consumable type**" |
| ~~SPEC-0005 spec.md:229-237~~ **SPEC-0006** — `equipment-slot-arrangement/spec.md:232` | scenarios asserting a Stamina Shot is still accepted after four Vitality Shots. **Correction (2026-08-12):** this row named the wrong spec. SPEC-0005 is Desktop Distribution and says nothing about consumable caps; the scenario is SPEC-0006's. Marked rather than patched, per this document's convention. |

**#190's original acceptance criterion was correct and was overridden.** Update 2.8 says a fifth
Placeable *is* rejected. Nothing in 2.8.0.1, 2.8.0.2, 2.8.0.3 or 2.8.1 — the latest — revises bullet
4, so this is the live rule.

**A third piece of evidence, and it points the same way: the app's `type` field was authored against
2.8's cap taxonomy, not against the Consumables page's.** The wiki carries two competing consumable
taxonomies, and they are not the same list:

| Source | Categories |
|---|---|
| `/wiki/Consumables` §"Consumable Types" | **10** — Throwable, Placeable, Rending, Healing, Noise, Explosive, Fire, Poison, Vision, Light. **No "Shots".** Described as "shared with Tools". |
| `Update/2.8` | **4** — Throwables, Placeables, **Shots**, Tarot Cards. The cap categories, and the new arsenal filters, which 2.8 says "have (for now) **replaced** some of the previous more granular filters". |

`CONS[i][3]` holds exactly **`Shot`, `Throwable`, `Placeable`** — three of 2.8's four, with the fourth
(Tarot Cards) excluded from `CONS` by the scope decision. It does **not** hold Rending, Healing, Noise,
Vision or Light. So `type` was written against the cap taxonomy and is correctly populated for it;
`CONS_GROUPS` (`Shots, Explosives, Fire, Gas, Utility`) is a separate app-side UI bucket, which the
repo already documents as distinct. **The app has the right field, correctly shaped, and stopped
reading it.** It also means `/wiki/Consumables` is stale in a second way — it still documents the
category set 2.8 replaced, alongside the "4-slot inventory" line it replaced.

**One honest caveat.** "4 instances of the same type" could in principle be read as "4 of the same
*item*", with the parenthetical merely naming the categories consumables belong to. Two things make
the per-category reading the natural one: the parenthetical glosses "type" with exactly four category
names, and the *previous* bullet retires type as a constraint on **placement** ("no longer restricted
by type… any slot"), which is only worth saying if type still constrains **quantity**. The same notes
also add "category filters for Throwables, Placeables, Shots and Tarot Cards" to the arsenal UI, and
`CONS[i][3]` independently matches that four-category list.

Two limits worth stating plainly. First, **the rule appears on exactly one page**: `"4 instances"`,
`"instances of the same type"` and even the word `"Placeables"` each return a single wiki-wide search
hit, `Update/2.8`. It is not restated on any evergreen page, and `/wiki/Consumables` — the page a reader
would check — still documents the pre-2.8 model. Second, this
is a patch-note reading rather than an in-game observation, so it should be confirmed in the Arsenal
before the tests are rewritten — but the burden of proof has flipped: the repo's per-item rule is now
the claim without a source.

### 3.5 NOT a contradiction — the repo's fourteen Tarot Cards are right, and the wiki's category is incomplete

*This entry initially read as a repo defect. It is the opposite, and the correction matters because
it is the evidence against A2's category shortcut.*

`Category:Tarot Cards` returns **13** members. `catalog.test.js:433` names **14**. The fourteenth is
**The Moon** — and [`/wiki/Consumables/The_Moon`](https://huntshowdown.wiki.gg/wiki/Consumables/The_Moon)
**exists** (rev 13663, last edited 2026-03-19) but carries only `Category:Consumables` and
`Category:Pages with DRUID infoboxes`. It is **missing `Category:Tarot Cards`**, which every other
card has — its last edit predates the others by months, so it looks like a page created before the
category existed and never backfilled.

So `catalog.js`'s "14 Tarot Cards" and `catalog.test.js`'s list are **correct**, and correct for a
recorded reason: the `CONS` boundary says the fourteen came "from a discovery crawl", which walks
`Category:Consumables` (54 pages) rather than `Category:Tarot Cards`. The broader crawl caught what
the narrower category misses. **No change is needed to the test or the comment.**

**Why this belongs in a contradictions section anyway:** it is a live counter-example to the idea
that wiki category membership is authoritative, which is what A2 would have rested on. One
hand-applied tag was simply never added, and nothing on the page or in the category signals the
omission. §A2 is corrected accordingly.

### 3.6 The report's H1 premise is false

`recommended-adrs-from-wiki-review.md` states: "The `/wiki/Hunters` page carries considerably more:
recruitment cost, rank/tier, a starting loadout, starting traits, and the health-chunk
configuration. `[VERIFY]` field-by-field." Verified: **none of the five is a per-hunter field.**
Recruitment is a flat 100 HD stated once; the starting kit is explicitly random; health chunks are a
global mechanic. The `[VERIFY]` marker did its job.

### 3.7 `catalog.js`'s image-model header describes a two-tier SVG lookup the code does not implement

`client/src/data/catalog.js:16-21`:

> "Each dispatch function checks a **per-item override map first**, then falls back to the item's
> group icon — the per-item maps are empty today (no per-item SVGs are authored yet) but **the
> two-tier lookup is structured** so per-item icons can be dropped in later without touching any
> call site."

`catalog.js:905-915` has no per-item map and no first tier:

```js
export function toolThumb(tool)  { return TOOL_THUMBS[tool[3]]  || TOOL_THUMBS.Utility; }
export function traitThumb(trait){ return TRAIT_THUMBS[trait[3]] || TRAIT_THUMBS.Utility; }
export function consThumb(cons)  { return CONS_THUMBS[cons[4]]  || CONS_THUMBS.Utility; }
```

The comment's *promise* — that per-item icons can be added without touching call sites — happens to
remain true, since a caller passes the whole tuple. But "the maps are empty" implies populating a
map, and the actual work is adding a lookup that isn't there. The report inherited the comment's
framing, which is why its F recommendation is mis-scoped (§F).

### 3.8 `AMMO` prices five Scarce rounds at 22–90 Hunt Dollars, which ADR-0013 says must be 0

*Not in the report, and the mirror image of §3.1.* `/wiki/Ammo`'s Update History states it outright:

> Update 2.2 - "Added Custom Ammo Scarcity {{Scarce}} to the game - First affected was Dum Dum Ammo
> for certain weapons"
> Update 2.8 - "**Dum Dum Ammo, Explosive Ammo, and Spitzer Ammo is now Scarce {{Scarce}} for all
> weapons**"

Checking every pool row the app prices above zero against every weapon that lists it: **five rows are
Scarce on the wiki for every weapon that takes them, and the app charges for all five.**

| Pool row | app price | wiki |
|---|---|---|
| `AMMO.compact` Dumdum | **22** | Scarce on all 10 weapons that list it |
| `AMMO.medium` Dumdum | **28** | Scarce on all 25 |
| `AMMO.slong` Spitzer | **90** | Scarce on all 17 |
| `AMMO.xbow` Explosive Bolt | **40** | Scarce on both |
| `AMMO.bow` Frag Arrow | **45** | Scarce on the one |

**ADR-0013 admits a Scarce item at cost 0.** So these are wrong by the project's own accepted decision,
and visibly so: a long Spitzer renders as a **$90** line the game gives away. Against a $130 Sparks
that is a 69% overcharge on the build — the report's own "ammo is the second-largest line in
`totalCost`" argument, running in the opposite direction.

**Checked adversarially — I looked for a weapon that prices these rounds, and there is none.** Across all
147 pages: Dumdum is Scarce on **42** pages and priced in Hunt Dollars on **0**; Spitzer Scarce on 17,
priced on 0; Explosive Bolt Scarce on 3, priced on 0; Frag Arrows Scarce on 1, priced on 0. Within each
affected pool, **zero** weapons state a price for the round the app charges for. The one page anywhere
that prices a nominally-Scarce round is `Mako 1895/Claw` (Explosive Ammo, 100) — a stale page its own
siblings contradict (§A2), and "Explosive Ammo" is in no app pool, so it does not defend any of the five.

**The repo already holds the fact and applied it too narrowly.** `catalog.js:59` reads "The Dolch's and
Nitro's ammo (Dumdum / Explosive / Shredder) has been Scarce since Update 2.8" — correct, but used only
to justify emptying `AMMO.special`. The same update made those rounds Scarce **for all weapons**, and
the compact / medium / slong pools that also carry Dumdum and Spitzer were not revisited.

So ADR-0013 is violated inside `AMMO` in **both** directions at once: Scarce rounds **omitted** where
they should be cost-0 rows (§3.1), and Scarce rounds **charged for** where they should be zero (here).
Both are fixed by the same decision, which is one more reason A is the ADR to write first — and note
that either fix reorders or reprices a pool, so both sit behind the `FORMAT_VERSION` gate.

### 3.9 `AMMO` pool contents: two rounds are filed under the wrong weapon

Beyond pricing, three of the app's four bolt/arrow pools contain rounds their weapon does not take:

| Pool | App | Wiki (weapon page, 2026-08-12) |
|---|---|---|
| `xbow` (Crossbow) | Explosive Bolt 40 · Shot Bolt 30 · **Poison Bolt 25** | Explosive Bolt **(Scarce)** · Shot Bolt **40** · **Steel Bolt 40** |
| `hxbow` (Hand Crossbow) | Chaos Bolt 20 · **Concertina Bolt 35** · Choke Bolt 25 | Chaos **10** · Choke **10** · **Dragon Breath 40** · **Poison 25** |
| `bow` (Hunting Bow) | Frag Arrow 45 · Concertina Arrow 35 · Poison Arrow 25 | Concertina **30** · Frag **(Scarce)** · Poison 25 |

`Poison Bolt` belongs to the Hand Crossbow; `Concertina Bolt` belongs to the Hunting Bow. Because a
saved selection is a bare index, **correcting these is exactly the `FORMAT_VERSION`-gated edit the
wire-format comment describes** — which is an argument for doing it inside A rather than as a
drive-by fix.

Also relevant to A's schema: the wiki gives Crossbow, Hand Crossbow, Hunting Bow, Bomb Lance and
Bomb Launcher all the same `Ammo Type=Special`. The app's four-way `xbow`/`hxbow`/`bow`/`special`
split is purely app-side, confirming ADR-0005's "no wiki equivalent" note — and confirming the wiki
`AmmoType` field cannot drive `ammoClass`.

---

### 3.10 Confirmation of § 3.8 and § 3.1 per round (2026-08-12)

The three extra rows § 3.8's disposition predicted are **confirmed**, and the confirmation turned up a
ninth Scarce round the app does not carry at all. Method: the 147-page corpus cached by this
document's own verification pass, parsed offline — the `== Ammo Types ==` section only, so Update
History mentions are excluded. Every `{{Ammo|…}}` row was classified as Scarce, priced in Hunt
Dollars, or neither. **No new fetches**, so this is a re-derivation from the same evidence the
original five rows came from, not an independent second source.

| Round | Pages listing it | Scarce | Priced | App rows charging for it |
|---|---|---|---|---|
| Dumdum Ammo | 42 | **42** | **0** | `compact` 22, `medium` 28, **`long` 34** |
| Spitzer Ammo | 17 | **17** | **0** | **`medium` 60**, **`long` 75**, `slong` 90 |
| Explosive Bolt | 3 | **3** | **0** | `xbow` 40 |
| Frag Arrows | 1 | **1** | **0** | `bow` 45 |
| Shredder Ammo | 1 | **1** | **0** | *none — see below* |

Dumdum is priced on **zero** of the 42 pages that list it, so all three pool rows carrying it are
unjustified, not the two § 3.8 tabulated. Spitzer is priced on **zero** of 17, so all three of its rows
are too. **Eight rows, confirmed per round.** The Dumdum and Spitzer totals reproduce § 3.8's own
adversarial paragraph exactly (42 / 0 and 17 / 0) — that paragraph was right and its table under-listed
against it, which is an internal inconsistency in this document rather than a new fact.

**A ninth Scarce round exists that no pool carries.** `Shredder Ammo` is Scarce on the one page that
lists it and priced nowhere. Under ADR-0013 it is a cost-0 row that belongs in `AMMO.special`, which is
empty — so § 3.1 and § 3.8 meet here: the same update that makes five rows overcharged makes this one
missing.

**§ 3.1's nine Hunt-Dollar rounds are confirmed exactly**: Dragon Breath Charge 10 (2 pages), Harpoon 5
(2), Steel Ball Ammo 5 (2), Waxed Frag Charge 50 (2), Incendiary Bolt 25 (1) — nine rows across Bomb
Launcher, Bomb Lance and Chu Ko Nu, none in Blood Bonds.

**§ 3.9 is confirmed and understates the price drift.** Beyond the two misfiled rounds it names, the
bolt and arrow pools disagree with the wiki on price in four more places, and omit two rounds:

| Pool | App | Wiki | Delta |
|---|---|---|---|
| `xbow` Shot Bolt | 30 | **40** | under by 10 |
| `xbow` Steel Bolt | *absent* | **40** | missing |
| `hxbow` Chaos Bolt | 20 | **10** | over by 10 |
| `hxbow` Choke Bolt | 25 | **10** | over by 15 |
| `hxbow` Dragon Breath Compact Bolt | *absent* | **40** | missing |
| `bow` Concertina Arrow | 35 | **30** | over by 5 |

**Two notes for ADR-0014's scraper.** Hand Crossbow rounds are named `<X> Compact Bolt` on the wiki
(`Chaos Compact Bolt`, `Choke Compact Bolt`, `Poison Compact Bolt`, `Dragon Breath Compact Bolt`) while
the app calls them `<X> Bolt` — the stable-id scheme has to reconcile that. And ammo rows take optional
template parameters: `{{Ammo|Explosive Bolt|category=Explosive Ammo}}`, `{{Ammo|Shot Bolt|nocategory=true}}`.
A name pattern that requires `}}` immediately after the round name silently drops **every bolt row** —
that mistake was made and caught while producing this table. No current repo code is affected, because
nothing parses this section today; `scrape-stats.mjs` reads rendered `druid-infobox` HTML instead.

---

## 4. What the MediaWiki API experiment showed — input to G

> **SUPERSEDED (2026-08-12) by ADR-0016.** The recommendation in this section is withdrawn:
> `robots.txt` disallows `/api.php`, `/rest.php` and `/*?action=`, so none of the access below is
> available to this project under ADR-0002. See the amendment at the top. **The measurements are kept
> deliberately** — ADR-0016 quotes them to record the option as measured and declined — and the
> watermark, rate-limit and reliability findings are unaffected.

~~**It is cheaper and more capable than ADR-0005 assumed. G's research is largely done.**~~ It is
cheaper, and it is disallowed.

**Change detection works today, and the whole dataset was checked — not a sample.** Taking every
item's committed `sourceRevision` from `itemStats.json` and asking
`action=query&prop=revisions&rvprop=ids|timestamp&titles=<50 titles>` in batches:

- All **256** items carry a `wikiUrl` and a `sourceRevision`, and every one was resolved against the
  live API: **256 matched, 0 changed, 0 unresolved.** So the committed dataset is genuinely not stale
  as of 2026-08-12, and the watermark ADR-0005 "left behind and unused" is correct and usable as-is.
  *(An earlier draft of this document asserted this from a 50-item sample. It now covers all 256.)*
- **6 requests for the full check**, versus 256 HTML page fetches. At the repo's own 1500 ms delay
  that is **~9 seconds instead of ~6.5 minutes** — a ~43× reduction, and it *grows* with the payload,
  which is precisely the argument for landing G before A's scrape.
- **The 50-title limit is confirmed by the API itself**, not assumed: asking for 60 returns
  `{"code":"toomanyvalues","info":"Too many values supplied for parameter \"titles\". The limit is
  50.","limit":50,"lowlimit":50,"highlimit":500}`. Two operational consequences for G — batch at 50,
  and note that over-batching **errors rather than truncating**, so a `slice` bug fails loudly here
  rather than silently under-reporting staleness. (Contrast the rate limiter, which fails *silently*
  with a 200 — see the Method note.)

**Other capabilities confirmed:**

| Need | Endpoint | Result |
|---|---|---|
| Enumerate a category | `list=categorymembers&cmlimit=500` | 147 weapons, 85 traits, 13 Tarot Cards — all in one call each, but the Tarot count is short by one (§3.5), so a category is a starting set and not a census |
| Infobox fields, cleanly | `action=parse&prop=wikitext` | Raw templates — far easier to parse than rendered HTML, and no DRUID markup |
| Per-weapon ammo compatibility | `prop=categories` | `Category:FMJ Ammo` etc. per weapon — but agrees with the page's own section on only **138/147**, and fails on exactly the bolt/charge weapons. A cross-check, not a source (§A2) |
| Asset inventory | `list=allimages&aiprefix=Ammo` | 102 ammo icons (§F1) |
| Wiki version | `meta=siteinfo` | MediaWiki **1.43.6**, PHP 8.1.33 |

**Two cautions G must record:**

1. **Rate limiting returns HTTP 200 with an error body.** `{"error":{"code":"ratelimited","info":
   "You've exceeded your rate limit. Please make sure you are setting a custom user agent with the
   username of your wiki account…"}}`. A refresh job that checks status codes will record empty
   pages as successes — the exact failure that cost 136 pages here. The scrape's existing range
   assertions would catch it; a revision-only watermark check has no such assertion and needs one.
2. ~~**The API is not covered by the existing robots.txt gate.** `scrape-stats.mjs` checks
   `isAllowedByRobots` against `/wiki/` paths. An `api.php` client is a different path and G should
   say explicitly whether the same courtesy checks apply (they should) and whether the wiki's
   preference for a registered bot account is worth taking up.~~

   **Corrected 2026-08-12 — this is the sentence that got it wrong.** It asks whether the gate
   *covers* the API. The question it should have asked is whether `robots.txt` *allows* it, and the
   answer is no: `Disallow: /api.php`, `/rest.php`, `/*?action=`, `/wiki/Special:`. Running the gate
   against `/api.php` returns `false` today — the machinery was already correct and was simply never
   pointed at the new access mode. See the amendment at the top and ADR-0016. The one live idea in the
   original bullet is the registered bot account: ADR-0016 records it as that decision's revisit
   trigger, since the wiki's own rate-limit response invites it.

---

## 5. What closed, and what stayed open

**Closed — 21 of 22 checklist items.**

| | Question | Answer |
|---|---|---|
| A1 | Ammo prose or stats? | **Prose.** `catalog.js` confirmed. Seven digit runs in the whole body, **two** of them effect values, **zero** stat fields. |
| A2 | Compatibility structured? | **Yes** — the `== Ammo Types ==` section (139/147 = every ammo-bearing weapon), with per-weapon prices **and 1,268 `{{StatChange}}` deltas**. A scrape. Categories agree on only 138/147 and must not be the primary source. |
| A3 | Slots independent? | **Yes**, and prices are quoted **per slot**. Wire format needs two. |
| A4 | Dual-ammo presentation? | `AmmoType` names one family; slash-separated `Loaded`/`Extra` marks **two ammo families** (not two barrels) — **7 rows**, and the app types Drilling to the *secondary* family. |
| A5 | Uniform pricing? | **No** — 13 of 46 (class, round) groups vary. 12 are exact 2:1 pairs, but one weapon can sit on both sides for different rounds, so price is per **(weapon, round)**: no class, slot-count or per-weapon rule derives it. |
| A6 | `special` rounds unpurchasable? | **No** — **9 rounds in Hunt Dollars** (Bomb Launcher 4, Bomb Lance 4, Chu Ko Nu 1), and the bomb prices are **per slot**. Chu Ko Nu contradiction resolved in the repo's favour. |
| B1 | Conversion: variants vs skins? | **1 weapon + 10 skin infoboxes** across 12 tabber tabs. Zero functional variants on the page. |
| B2 | Generalises? | **Yes** — 147 base / 567 skins; no page has 2 base infoboxes. |
| B3 | Variant size/price own? | **Yes**; 92/92 price differs, **32/92 size differs**. Must be rows. |
| B4 | Compound variants enumerable? | **Yes** — 55 base + 92 variants, max 3 segments, **zero** 4-segment paths. ADR-0005's rule confirmed; one of its four examples has gone stale. |
| B5 | Machine-readable skin signal? | **Yes** — the template name. |
| C1 | Action type structured? | **No field, no category.** 24 field names, none an action; prose only, on 130/147. |
| C2 | Trait conditions structured? | **No.** Two prose shapes; only weapon-linked ones extractable. |
| E1 | Burn consumed on use? | **Yes** — "burned up and disappearing from a Hunter's loadout". |
| E2 | Burn costs UP / holds a slot? | **Both yes.** Necromancer `Cost=4`; removal refunds nothing. `Type` is scrapeable (58/58); **`Stack Limit` is not** (2/58, sometimes empty, contradicted by Remedy's prose). |
| E3 | Spur colours canonical? | **Yes** — white/red/blue over 4 types, plus a Sealed modifier. Exactly **4** spur assets exist; no fourth colour. |
| E4 | Shadow Crush resolved? | **No — and it was never a replacement.** Different trait. |
| F1 | Ammo icons exist? | **Yes** — 100 variant icons, and all **44** names referenced by `/wiki/Ammo` resolve. |
| F2 | Variant images distinct? | **Yes**, and already shipped. Verified through the app's own `slugify`: 147/147 weapons resolve, **zero orphan files**. |
| H1 | Hunter page fields? | **None of the five**, on either template, and the hunter list has **zero wikitables**. Starting kit is random. |
| H2 | Blood Bonds recruitment? | **No** — recruitment is flat 100 HD; BB buys *unlocks* and roster slots. But **60 of 242 rows already carry a BB price** in `source` as text. |
| I1 | Tarot cap stated? | **Yes** — Update 2.8 names Tarot Cards as one of four cap types, at **4 per type**. |
| I2 | Tarot price literal `Scarce`? | **Yes.** Cost 0 under ADR-0013. |
| — | 8 shared cells or 4+4? | **8, freely mixed** — Update 2.8. ADR-0009 confirmed; `/wiki/Consumables` is stale twice over (the "4-slot inventory" line **and** its 10-category list, both pre-2.8). |
| — | Does `AMMO` obey ADR-0013? | **No, in both directions** — Scarce rounds omitted from `special` (§3.1) and five Scarce rounds priced 22–90 (§3.8). |
| — | Does anything consume the stat block? | **One export of six** — only `descriptionFor`. `dualWieldFor` (25 items, #178) has **no consumer** (D). |
| — | Is the committed dataset stale? | **No** — all **256** revids match live, verified in 6 requests (G). |
| — | Action type documented anywhere? | **Yes, as prose on exactly one page** — `/wiki/Weapons` §Action Type, 8 types. No category, no per-weapon tag (C3). |
| — | Is that a usable conditional-trait map? | **No** — covers ~5 of 17 conditional traits, and its Bulletgrubber note omits two of the four action types that trait's own page implies (C4). |

**Stayed open — 3, and the biggest one from the earlier draft closed.**

1. **CLOSED, not open — 8 shared cells, confirmed by Update 2.8.** An earlier draft listed this as
   the top open question needing the game. It is answered in the patch notes: "Players can freely
   equip any tool or consumable to any slot, in any combination." ADR-0009 is right; the
   `/wiki/Consumables` "4-slot inventory" line is stale pre-2.8 text. **The replacement question is
   narrower and sharper: confirm in the Arsenal that the 4-per-type consumable cap of §3.4 behaves as
   the patch notes describe** (try 4 Dynamite Sticks, then a Dynamite Bundle). That is a single
   observation, and it gates rewriting `consCount`, SPEC-0006, SPEC-0008 and their tests.
2. **Whether `AMMO.special`'s Scarce rounds should enter at cost 0** under ADR-0013. Purely an
   internal consistency decision for A; no further wiki evidence would help.
3. **Whether a two-slot weapon's ammo total is stored or derived.** The per-slot *price* must be
   stored per (weapon, round) — A5 shows it is not uniform and not a function of slot count. What is
   still open is the narrower question of whether filling both slots is recorded as `2 × price` or as
   two independent selections each carrying their own price (the latter is what A3's "two types of
   custom ammo" implies). SPEC-0007 REQ "Budget-Affecting Attributes Are Stored, Never Inferred"
   leans toward storing each selection; A should rule.

---

## 6. Deliberately not re-derived

Per the prompt's "Do not redo": the tiering rationale, the dependency graph, the "six of nine are
already-written deferrals" analysis, image coverage for modelled items, the `itemStats.json` field
inventory, and anything about image licensing (ADR-0002). Where a wiki read *contradicted* one of
those, it is in §3. Nothing here touches ADR-0002's sourcing premise.
