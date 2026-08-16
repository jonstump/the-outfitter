# Adversarial Data QA — Seat 5 filing

**Charge:** Presentation, prose, and ADR conformance against the data.
**Date:** 2026-08-14 · **Tree:** `7a7e772` · **Round:** 1 (independent)

---

## Method and its limits

### Was the wiki reachable? No.

```
$ curl -sS -o /dev/null -w '%{http_code}\n' https://huntshowdown.wiki.gg/wiki/Nagant_M1895
curl: (56) CONNECT tunnel failed, response 403
```

The `/api.php` endpoint answers identically. **I was in the blocked case**, so my oracle is the
committed scrape (`client/src/data/itemStats.json`, `sourceRevision` 10076–16390) plus the repo's own
ADRs and specs. That is enough to find disagreements *between* the app's artifacts, and between an
artifact and a rule written about it. It is **not** enough to find a value where the catalog and the
scrape agree and both are stale. Every finding below rests on a file+line or a JSON record, never on
recall. Where a figure comes from an ADR's own live-wiki measurement (ADR-0014's 243/587 ammo pairs) I
mark it as cited-not-verified, because I could not re-measure it.

### Baseline

`npm test` is **not** clean at the workspace root, but the failure is not the app's:

- **client: 33 files / 759 tests, all passing.**
- **server: 43 failures**, every one a `SyntaxError: Unexpected non-whitespace character after JSON at
  position 329` from `db.read()` against `server/data/db.test.json`.

That file is **gitignored** (`.gitignore:4`) and is the shared fixture
`OUTFITTER_DB_FILE=./data/db.test.json` that every `npm test` invocation truncates and rewrites. Five
panel seats running `npm test` concurrently against one path is sufficient to produce exactly this
corruption. **I am recording it as a panel artifact, not a repo defect**, and the next seat to touch it
should delete the file and re-run rather than file a bug. No finding below depends on the server suite.

### What I did

- Read all 22 ADRs and all 8 specs; extracted every falsifiable numeric or structural claim and tested
  it against `catalog.js` + `itemStats.json` with throwaway ES-module scripts.
- Ran 22 probes over all 256 committed description strings (mojibake, U+FFFD, HTML entities, NBSP,
  `[[ ]]`, `{{ }}`, `'''`, tags, `[1]` citations, hatnote prefixes, whitespace, truncation smells,
  repeated sentences, control characters, non-ASCII inventory).
- Traced every consumer of `itemStats.js` and of the four thumb-dispatch functions.
- Read `catalog.js` and `calc.js` end to end, treating each explanatory comment as a claim to falsify.

### Limits a reader must hold

- **`scrape-stats.mjs --discover` was not run** (running scrapers is forbidden), so *items missing from
  the catalog entirely* are invisible to me, as Part II already records.
- I did not audit image files on disk, the hunter roster, wire-format round-tripping, or the
  arithmetic in `randomize.js` — Seats 4, 1 and 3 own those. Where I brushed them I have put the
  observation in Handoffs rather than investigating.
- **Severity calibration depends on a fact I verified late and that cuts against several of my own
  findings:** `descriptionFor` has exactly two consumers, `Picker.jsx:136` and `TraitsPanel.jsx:33`,
  and **both are traits-only**. So **198 of the 256 committed descriptions — every weapon, tool and
  consumable — are never rendered anywhere in the app today.** Prose defects on those 198 are latent,
  not player-facing, and I have graded them P3 accordingly rather than inflating them.

---

## Findings

### F1 — The ammo select asserts a per-weapon compatibility, and a price, that the app does not model
**P1 · CONFIRMED (mechanism) / SUSPECTED (magnitude) · `client/src/components/WeaponsPanel/WeaponSlot.jsx:30,37-38,57,78-81`**

`WeaponSlot` builds its round list as `AMMO[def[4]]` — the whole class pool — and renders each entry as
`<option>{v[0]} (+${v[1]})</option>`, then adds the selection to the weapon's own price line:

```js
const variants = AMMO[def[4]] || [];          // :30
const ammoCost = variant ? variant[1] : 0;    // :38
<div className="weapon-cost">${def[3] + ammoCost}</div>   // :57
```

So for every weapon the app makes two affirmative claims: *this weapon accepts this named round*, and
*equipping it costs this many dollars*. The meta line at `:48-49` repeats the round by name.

ADR-0014 (accepted, 2026-08-12) measured that claim against the wiki and recorded it as wrong at scale:
the app offers **587** (weapon, round) pairs where the wiki lists **491**, of which **243 are rounds the
weapon cannot take** and **147 are rounds it can take but the app cannot express**; **137 of 140
weapons are wrong in at least one direction** (`docs/adrs/ADR-0014-*.md`, Context). Prices are also
per-(weapon, round) — ADR-0014 records 13 of 46 (ammo class, round) groups varying across weapons, with
1890 Cavalry and Martini-Henry both Long, both two-slot, charging 60 and 30 for FMJ.

**Player-facing consequence.** A player picks a round the game will not let them equip, and budgets a
dollar figure that is wrong in both directions. The cost line is the app's core output.

**Confidence split, deliberately.** I confirm the *mechanism* from the code above: the pool is offered
whole, with prices, to every weapon in the class. I **cannot** confirm 243/587/137 — those come from
ADR-0014's live-wiki pass on 2026-08-12 and the wiki is blocked to me. If a challenger wants to strike
the magnitude, they are right to; the mechanism stands on `WeaponSlot.jsx` alone.

**Not a "missing feature" restatement.** ADR-0014 being unbuilt is a roadmap fact and I do not file it.
What I file is that the UI does not stay silent about the rule it cannot enforce — it states the
opposite of it, with a number attached. My charge asked me to check exactly this.

**Fix direction.** Until ADR-0014 lands, the honest interim is to stop implying per-weapon
compatibility: label the control as a class-wide price list rather than this weapon's options, or
disclose next to it that compatibility is not modelled. Do not add a hand-authored compatibility table
— that is ADR-0014's job and SPEC-0007 forbids inferring it.

---

### F2 — Eight Scarce traits are presented as costing zero, on three surfaces, today
**P2 · CONFIRMED · `client/src/components/Picker/Picker.jsx:142`, `client/src/components/TraitsPanel/TraitsPanel.jsx:36`, `client/src/components/Picker/Picker.jsx:65`**

Zero-cost rows, enumerated exactly (12, matching ADR-0018's count):

| rows | ids | `acquisitionClasses` |
|---|---|---|
| 8 traits | berserker, catalyst, death-cheat, rampage, relentless, remedy, shadow, shadow-leap | `Scarce`, 4 of them `Scarce+Burn` |
| 4 weapons | flame-rifle, homestead-78, shredder, wildland | **`[]`** (see F3) |

Three live renderings assert a price:

- `Picker.jsx:142` — `badge: x.t[2] + (x.t[2] === 1 ? " pt" : " pts")` → the picker row for Berserker
  shows **"0 pts"**.
- `TraitsPanel.jsx:36` — ``label = `${name}, ${up} upgrade point${up === 1 ? "" : "s"}. Activate to
  remove.` `` → a screen reader is told **"Berserker, 0 upgrade points"**.
- `Picker.jsx:65` — `costStr: "$" + x.w[3]` → the Flame Rifle row shows **"$0"**.

`PickerRow.jsx:28-31` renders `row.badge` and `row.costStr` unconditionally, and the row is a `<button>`
with no `aria-label`, so its accessible name is composed from that text — the zero reaches assistive
technology on the picker as well as in the traits panel.

ADR-0018 (accepted 2026-08-12) names this precisely: *"the label makes a positive claim that the trait
is free"* and *"'0 upgrade points' is ruled out as a rendering of 'cannot be bought'"*. It calls it *"the
current false claim"* and *"the only part of this that is unambiguously a bug"*. The decision is
accepted; no part of it is implemented — nothing in `client/src` reads `acquisitionClasses`,
`statsFor`, or `ITEM_STATS`.

**Player-facing consequence.** Zero means two different things in this dataset — "free" and "cannot be
bought" — and the UI renders both identically. A player planning a budget reads eight traits and four
weapons as free additions when they are items they must already own.

**Fix direction.** ADR-0018's chosen option (spur colour **plus a text channel**). The text channel is
the load-bearing half; the colour is optional. Note F3 before implementing — the ADR's stated data
source does not cover a third of the affected rows.

---

### F3 — ADR-0018's confirmation criterion cannot be met from the field it names
**P3 · CONFIRMED · `docs/adrs/ADR-0018-*.md` (Decision Drivers; Confirmation #1) vs `client/src/data/itemStats.json`**

ADR-0018 asserts `itemStats.json` *"carries `acquisitionClasses` **per item** — 49 Regular, 8 Scarce, 5
Burn"* and sets as Confirmation #1: *"**Every zero-cost catalog row renders a rarity**."*

Measured over the committed dataset:

```
items with a non-empty acquisitionClasses: 58 of 256
trait breakdown: Regular 49 · Scarce 4 · Burn+Scarce 4 · Burn 1   (= 8 Scarce, 5 Burn, 58 total)
flame-rifle / homestead-78 / shredder / wildland:
    acquisitionClasses = []   acquisition = null   priceStated = "Scarce"   fields.Price = "Scarce"
```

The counts the ADR quotes are exactly the **trait** counts, and 49+8+5 nets to 58 — the trait roster —
which the ADR reads as "per item". SPEC-0007 settles it: *"Every scraped **trait** record SHALL carry the
set of acquisition classes"* (`equipment-catalog-dataset/spec.md:251`). The field is trait-scoped by
specification, not by accident.

Consequently **4 of the 12 zero-cost rows have no rarity to render**, and an implementation that
follows ADR-0018 literally would leave the Flame Rifle, Homestead 78, Shredder and Wildland showing a
bare "$0" — the exact defect ADR-0018 exists to remove, for a third of the affected rows.

The rarity for those four *is* recoverable, just not from the named field: `priceStated` and
`fields.Price` both hold the literal string `"Scarce"`. That is also how they satisfy SPEC-0007's
zero-cost test today, which passes on its **second** branch — *"or a stated price this project's strict
parser refuses"* (`spec.md:332`) — not on acquisition class. So the invariant is genuinely evidenced;
only ADR-0018's rendering plan has the hole.

**Fix direction.** Amend ADR-0018 to source rarity for non-trait rows from `priceStated` /
`fields.Price`, or extend the scrape to record `acquisitionClasses` for weapons from their own category
membership (which would need a SPEC-0007 amendment, since the requirement is written trait-only). Do
not let the implementation quietly cover 8 of 12 rows and call Confirmation #1 met.

---

### F4 — `catalog.js`'s image-model header describes a two-tier lookup the code does not have
**P3 · CONFIRMED · `client/src/data/catalog.js:16-21`, `:892-897`, vs `:881-890`, `:928-938`**

The header states:

> Each dispatch function **checks a per-item override map first**, then falls back to the item's group
> icon — the per-item maps are **empty today** … but **the two-tier lookup is structured** so per-item
> icons can be dropped in later without touching any call site.

All four dispatch functions are single-tier group lookups with no per-item map in existence:

```js
export function toolThumb(tool)   { return TOOL_THUMBS[tool[3]]  || TOOL_THUMBS.Utility;  }  // :928
export function traitThumb(trait) { return TRAIT_THUMBS[trait[3]]|| TRAIT_THUMBS.Utility; }  // :932
export function consThumb(cons)   { return CONS_THUMBS[cons[4]]  || CONS_THUMBS.Utility;  }  // :936
export function weaponThumb(w)    { /* :881-890 — dispatches on ammoClass then size */ }
```

A second false claim sits in the same file at `:894`: *"One simple line-art path silhouette per group
(**5 groups per category**)"*. `TOOL_THUMBS` has **seven** (Decoys, Sidearms, Medical, Melee, Throwing,
Traps, Utility) — contradicted twelve lines later by the file's own `:899-902` note recording the #166
split that added Decoys and Sidearms.

ADR-0020 found this on 2026-08-12, stated it plainly (*"the next reader deserves to know the map is
absent rather than empty"*), and **deliberately did not fix it** — *"The comment is `catalog.js`'s to
fix."* It is still unfixed. This is a comment that has already misled one piece of downstream analysis
(ADR-0020 records that the source report's recommendation F was built on it).

**Fix direction.** Correct the header to describe the single-tier group dispatch that exists, and fix
"5 groups per category" to per-category counts (weapons 7, tools 7, traits 5, consumables 5). If the
two-tier lookup is still wanted, that is a code change, not a comment.

---

### F5 — `catalog.js` contradicts itself, and the scraper, about whether `ammoClass` is machine-written
**P3 · CONFIRMED · `client/src/data/catalog.js:91-94` vs `:130-131` vs `scripts/scrape-stats.mjs:1387-1399`**

Three statements, in two files, about one field:

| where | says |
|---|---|
| `catalog.js:91-94` | *"Everything else in these tuples IS hand-authored and is **never written by a scrape**: `id`, the display `name` …, `ammoClass` …, and `group`."* |
| `catalog.js:130-131` | *"Changing ANY weapon's ammoClass has this shape — see ADR-0005's amendment, since **the scraper is allowed to write ammoClass through**."* |
| `scrape-stats.mjs` `GATED_CATALOG_FIELDS.ammoClass` | *"…so changing a weapon's class silently re-points every saved selection on it. **Needs a FORMAT_VERSION bump and a saved-selection migration first.**"* |

The implementation is unambiguous — `CATALOG_FIELD_MAP` (`scrape-stats.mjs:1374-1381`) writes only
weapons `Price`→cost and `Size`→size, tools/consumables `Price`→cost, traits `Cost`→up. `ammoClass` sits
in `GATED_CATALOG_FIELDS`, a **third** tier distinct from `NEVER_DERIVED` (`group`, `type`, `AMMO`):
gated pending a migration, not permanently forbidden.

So **`catalog.js:130-131` is the false one** — the scraper is precisely *not* allowed to write
`ammoClass` today. And `:91-94` is imprecise in the other direction, collapsing "gated pending a
migration" into "never written", which is the distinction SPEC-0007 line 89 preserves when it lists
*"cost, ammo class, UP value, size"* as fields where the scraped value is authoritative.

**Player-facing consequence.** None directly — this is rot risk, and a sharp one: `ammoClass` is the
field whose change silently re-points every saved ammo selection (the wire-format hazard this file's own
gate at `:32-45` exists to prevent). A maintainer who believes `:130-131` would conclude a scrape run
could legitimately change it, which is exactly the belief the gate is trying to prevent.

**Fix direction.** State the three tiers once, in `catalog.js`'s header, matching
`GATED_CATALOG_FIELDS` / `NEVER_DERIVED`: written now (cost, size, up); gated pending a
`FORMAT_VERSION` bump (`ammoClass`, `name`); never derived (`group`, `type`, `AMMO`). Strike the
parenthetical at `:130-131`.

---

### F6 — The Frontier 73C note claims two rows are the same weapon; the scrape says they are not
**P3 · CONFIRMED · `client/src/data/catalog.js:118-121`**

> *"Compact, not medium: this entry and **"Winfield M1873C" above** are the same weapon under its post-
> and pre-1896 names…"*

No catalog row is named `Winfield M1873C`. The row above is `["winfield-m1873", "Ranger 73", 4, 75,
"compact", "Rifles"]` (`:115`). The committed scrape shows two distinct weapons on two distinct pages:

| id | name | wiki page | rev | Size | Price |
|---|---|---|---|---|---|
| `winfield-m1873` | Ranger 73 | `/wiki/Weapons/Ranger_73` | 15379 | 4 | 75 |
| `frontier-73c` | Frontier 73C | `/wiki/Weapons/Frontier_73C` | 16291 | 3 | 41 |

Frontier 73C's own scraped prose settles it: *"A **lightened Ranger 73**, this trades convenience for a
slightly reduced capacity."* — a derived variant, not the same gun renamed. (`vandal-73c` continues the
chain: *"A shortened Frontier 73C"*.)

The comment's **conclusion** is fine and independently corroborated — `frontier-73c` is `compact`, and
the scrape agrees (`AmmoType: "Compact"`). Only the reasoning recorded for it is false.

**Player-facing consequence.** None today. The risk is a future maintainer reading this as a
duplicate-row report and "deduplicating" two legitimately distinct weapons — which would be a wire-format
event, since removing a row shifts nothing but changes what ids resolve.

**Fix direction.** Rewrite the note to say what the scrape supports: Frontier 73C is a lightened Ranger
73, it is Compact, and the ammo class was corrected from `medium`. Keep the wire-format cost paragraph
at `:123-131` (its arithmetic is correct — `AMMO.medium` and `AMMO.compact` are both length 5, and index
1 really is Spitzer $60 → High Velocity $13, verified against `:47-48`), but see F5 for its last clause.

---

### F7 — The Event-trait hold-back rests on a premise ADR-0018 disproved, and half its revisit trigger cannot fire
**P3 · CONFIRMED · `client/src/data/catalog.js:625-630`, `:639-641`**

`catalog.js` justifies holding back 17 Event traits with:

> *"`Traits/Shadow Crush` **appears to have been replaced by** `Traits/Shadow Leap` with neither page
> saying so"*

and sets the trigger:

> *"REVISIT WHEN: a page-level liveness signal exists … — **or when Shadow Crush is resolved either
> way, since it is the concrete case this boundary was drawn around.**"*

ADR-0018 (accepted 2026-08-12) read both pages and refuted it: *"**Shadow Crush and Shadow Leap are two
different traits, so there is nothing to resolve.**"* — different `Type` (Event vs Scarce), `Category`
(Offensive vs Movement), effect, range and target set. It concludes: *"What needs correcting is the
**trigger**: half of it can never fire"*, and explicitly declines to amend `catalog.js`.

Confirmed against the data: `shadow-crush` is absent from both `TRAITS` and `itemStats.json`;
`shadow-leap` is present with `acquisitionClasses: ["Scarce"]` and `fields.Category: "Movement"`,
matching ADR-0018's reading.

**Player-facing consequence.** None directly. The consequence is governance: the hold-back's stated
ground is false, and a revisit condition that can never fire means 17 traits stay out by inertia rather
than by decision. ADR-0018 is careful that the *hold-back itself still stands* on its other ground (the
Event index cannot be trusted); only this clause is dead.

**Fix direction.** Strike the second clause of the REVISIT trigger and the "appears to have been
replaced" sentence, leaving the page-level liveness signal as the sole condition — which is what
ADR-0018 recorded should happen.

---

### F8 — Marathon Swift carries its base weapon's description, which contradicts its own committed stats
**P3 (latent; P2 the day a weapon-description surface ships) · SUSPECTED · `itemStats.json` ids `marathon`, `marathon-swift`**

Both rows carry the byte-identical string:

> *"Caldwell made, pump-action rifle. Good cycle rate and high capacity, but **has a wasteful reload**."*

This is the **only** such pair in the file. Grouping all 147 weapons by wiki base page gives 35
multi-row families (92 variant subpages, 55 base pages); **34 of 35 give every member distinct prose**,
and the pattern is base sentence + a trailing clause naming the modification:

```
romero-77          "…tight bullet spread."
romero-77-alamo    "…tight bullet spread. Modified with an added magazine and loader."
romero-77-shorty   "…tight bullet spread. Shortened stock and barrel."
```

Every other `Swift` variant carries the expected clause; Marathon Swift does not:

```
new-army-swift      RS=5.6  "… Uses a speed-loader for faster reloading. Can be dual wielded."
ranger-73-swift     RS=8.4  "… Uses a speed-loader for faster reloading."
scottfield-swift    RS=4.3  "… Uses a speed-loader for faster reloading. Can be dual wielded."
marathon-swift      RS=10   "… but has a wasteful reload."          ← base prose, no variant clause
marathon (base)     RS=19.2 "… but has a wasteful reload."
```

The retained clause contradicts the row's own committed field: `ReloadSpeed` 19.2 → **10**, and the
variant costs 95 against the base's 68. The one sentence describing the difference is the one that is
missing, and the sentence that survives describes the opposite.

**Why SUSPECTED.** Two causes fit and I cannot separate them with the wiki blocked: the scrape's
description extraction fell back to the base page's lead, or `/wiki/Weapons/Marathon/Swift` genuinely
repeats the base text. `sourceRevision` differs (16303 vs 16305) and `selectedBy` is `canonical-title`
on both, so the record was built from its own page — which tilts toward the wiki repeating it, but does
not settle it.

**Why P3 and not P2.** No weapon description is rendered anywhere today (see Method). The moment
ADR-0019 Phase 1 ships a stat/description surface, this becomes a paying player being told the 95-dollar
variant reloads wastefully, identically to the 68-dollar base.

**Fix direction.** Re-run `scrape-stats.mjs --only weapons` when the wiki is reachable and diff this
record; if the page really does repeat the base prose, that is a wiki fix, and the app should carry a
note rather than a hand-edit (the file is generated). Consider a scrape-time assertion that a variant
subpage's description differs from its base's, reported rather than fatal — 34 of 35 families already
satisfy it, so the signal would be cheap and near-silent.

---

### F9 — Five scraped values carry a space before a comma, and the guard that catches this is description-only
**P3 (latent) · CONFIRMED · `itemStats.json`; `scripts/scrape-stats.mjs:1016-1023`; `client/src/data/itemStats.test.js:161-166`**

`itemStats.test.js` pins the whole dataset against exactly this artifact — but only on one field:

```js
const offenders = Object.keys(ITEM_STATS).filter((k) => /\s[,;:.!?]/.test(ITEM_STATS[k].description ?? ""));
expect(offenders).toEqual([]);
```

Applying that same regex to the other string-bearing fields finds five offenders:

```
acquisition:              death-cheat, rampage, relentless, remedy   = "Burn , Scarce"
fields.Type:              death-cheat, rampage, relentless, remedy   = "Burn , Scarce"
fields.ConditionalEffect: frontiersman                               = "Solo , Catalyst"
```

The scraper does this deliberately, and documents why (`:1016-1023`):

> *"`textContent` replaces every tag with a space, which is **right for infobox values** … Applied here
> rather than in `textContent` because that helper is shared with the field parse, and loosening it
> there would rewrite stat values to fix a prose artifact."*

**The stated rationale holds for scalar fields and fails for list-valued ones.** `Type` and
`ConditionalEffect` are comma-separated multi-value fields rendered as separate linked elements, so the
tag→space rule that protects `<a>Compact</a><img>` is what produces `"Burn , Scarce"`. The comment is
not stale; its reasoning simply does not cover the case the data contains.

**Honest weakening of my own finding.** SPEC-0007 *already documents this exact string*
(`spec.md:251`: *"The infobox `Type` field states multiple classes as one comma-joined string
(`"Burn , Scarce"`)"*) and routes around it by reading category membership instead — which is why
`acquisitionClasses` is a clean array and why nothing is wrong today. `ConditionalEffect`'s
`"Solo , Catalyst"` is **not** documented anywhere. So this is a live data defect with a documented
workaround for four of the five instances.

**Why it still matters.** ADR-0018 renders rarity through *"a text channel"*, and `acquisition` is the
scalar that carries it. ADR-0019 specifies `statFieldFor` returns *"the wiki's own strings"*
**uncoerced** — so any Phase 1 stat block displaying `Type` or `ConditionalEffect` renders
`"Burn , Scarce"` verbatim. Latent today (zero consumers); visible the day either ships.

**Fix direction.** Normalise list separators for multi-valued infobox fields at scrape time —
narrower than loosening `textContent`, which the comment rightly refuses. Then extend
`itemStats.test.js`'s existing regex from `description` to `acquisition` and all `fields` values, so
the guard covers the surface it was written for. Render rarity from the `acquisitionClasses` **array**,
never from the `acquisition` scalar.

---

### F10 — A test comment's denominator is stale by 26 rows
**P3 · CONFIRMED · `client/src/data/itemStats.test.js:150-153`**

> *"**9 of the 32 traits** carry a second paragraph — beastface, conduit, frontiersman, kiteskin,
> magpie, necromancer, pain-sense, serpent, vigilant."*

The nine named ids are **exactly right** — verified, the multi-paragraph set is precisely those nine, and
they are also the only nine multi-paragraph records in the entire 256-item file. The denominator is not:
`TRAITS.length` is **58**. "More than a quarter of them", the comment's stated stake, is really 16%.

`catalog.js:604-606` records where 32 came from — it is the pre-#157 trait count — so this comment
predates the roster nearly doubling and was not updated with it.

**Fix direction.** One-word correction to 58. Low value on its own; filed because it is the same class
as F4–F7 and because the panel asked for comment claims to be checked rather than assumed.

---

### F11 — SPEC-0001 mandates non-empty `alt`; the trait cell passes `alt=""`
**P3 · CONFIRMED (divergence) · `docs/openspec/specs/equipment-iconography/spec.md` § Image Alternative Text vs `client/src/components/TraitsPanel/TraitsPanel.jsx:44`**

SPEC-0001 states, under MANDATORY WCAG 2.1 AA requirements:

> *"item images **MUST** carry appropriate `alt` text identifying the item by name (e.g.,
> `alt="Nagant M1895"`), rather than empty/decorative `alt=""`"*

`TraitsPanel.jsx:44` is the one call site that opts out:

```jsx
<ItemThumb category="traits" name={name} alt="" svgPath={traitThumb(trait)} className="trait-cell-thumb" />
```

**I believe the code is right and the spec is wrong here**, and I am filing it that way rather than as a
defect. The trait cell is a `<button>` whose `aria-label` (`:36`) already carries the trait name, so a
non-empty `alt` would announce the name twice — `ItemThumb.jsx:69-71` documents exactly this policy.
The spec's own *Icon-Only Controls* paragraph anticipates the situation and reaches the opposite
conclusion from its *Image Alternative Text* paragraph; the two are in tension with each other, not just
with the code.

**Fix direction.** Amend SPEC-0001 to permit `alt=""` where the containing control's accessible name
already identifies the item, and state the trait cell as the case. Do not "fix" the code to satisfy the
spec — that would make the announcement worse.

---

### F12 — The "Trait cap" control does not cap traits
**P3 · CONFIRMED · `client/src/components/ActionsPanel/ActionsPanel.jsx:85`, `:99` vs `client/src/utils/calc.js:19`**

The visible label is `Trait cap {ui.upBudgetOn ? "ON" : "OFF"}` (`:85`); the control it toggles bounds
`upBudget`, i.e. **upgrade points**. The same input's accessible name is `aria-label="Trait point cap"`
(`:99`) — correct, and different from the visible text.

Meanwhile the app has an actual trait cap: `TRAIT_MAX = 15` (`calc.js:19`), which ADR-0012 makes
**unconditional** and explicitly *not* gated on `ui.upBudgetOn` (`calc.js:10-13`).

**Player-facing consequence.** Small but real: a user who turns "Trait cap OFF" may reasonably conclude
no limit on traits applies, when fifteen still does; and a user who turns it ON may expect it to bound
the *number* of traits. The header already names the quantity correctly ("Trait points",
`Header.jsx:38`), so the app is inconsistent with itself.

**Fix direction.** Make the visible label match the accessible one — "Trait point cap" — freeing "trait
cap" to mean ADR-0012's fifteen.

---

## Negative result — what I checked and found clean

Filed deliberately, so the next reviewer does not redo it.

**Prose (256 description strings, 22 probes, all clean):** no mojibake (`Ã`/`â€`/`Â`/Cyrillic), no
U+FFFD, no HTML entities, no non-breaking spaces, no `[[wiki links]]`, no `{{templates}}`, no `'''`
markup, no HTML tags, no `[1]` citation markers, no `[edit]`, no "Main article"/"For the" hatnotes, no
leading or trailing whitespace, no double spaces, no tabs, no control characters, no curly quotes, no
internally repeated sentences, none equal to the item's own name, none starting lowercase, none ending
in a comma or dangling conjunction. The only non-ASCII character in the entire corpus is an en-dash,
used 3 times, legitimately. `description` is non-empty for all 256. Three strings lack terminal
punctuation (`fire-bomb`, `quartermaster`, `spyglass`) — consistent with terse wiki phrasing, not
truncation, and I do not file it.

**The description test's own assertions, re-derived independently:** the multi-paragraph set is exactly
the nine named ids (F10 corrects only the denominator); no description matches
`/^see also/i`; no description matches `/\s[,;:.!?]/`; no `\n\s*\n`. Trait descriptions max at 209
(`serpent`) against `TIP_BUDGET` 240; the file maximum is 296 (`flame-rifle`) against `FILE_CEILING`
320. Both ceilings hold with slack, and the test's reasoning about them is accurate.

**`dualWield` vs prose — clean in both directions.** All 25 `true` records say so in their description;
all 231 `false` records do not. This is #178's named trap and it is not sprung.

**ADR-0019's field census is exact.** All 34 distinct infobox field names, and **every one** of the 34
per-field coverage counts the ADR publishes (`Price`/`Update`/`MeleeDamage`/`HeavyMeleeDamage` 198,
`Damage` 171, `Size`/`DropRange`/`Spread`/`MuzzleVelocity` 147, … `StackLimit`/`Total` 2) reproduce
against the committed file with zero mismatches, as does `dualWield` true = 25 of 256. Unusually
well-kept documentation.

**ADR-0018's rarity census is exact.** 49 Regular · 8 Scarce · 5 Burn over 58 traits, with the
`Burn+Scarce` overlap of 4 (Death Cheat, Rampage, Relentless, Remedy) and Necromancer as the sole
Burn-only trait at `up = 4`. Twelve zero-cost catalog rows, as stated.

**ADR-0013 / SPEC-0007 zero-cost invariant holds in both directions.** No row with `purchasable: false`
has a non-zero cost; no row with cost 0 has `purchasable: true`. All 12 zero rows are evidenced —
8 traits by `Scarce` in `acquisitionClasses`, 4 weapons by a `priceStated` of `"Scarce"` that the strict
parser refuses.

**ADR-0022's data preconditions are clean.** No duplicate display name in `WEAPONS`, `TOOLS`, `CONS` or
`TRAITS`. No weapon name contains `" and "`, so `{a} and {b}` is unambiguous. Across all 147×146 ordered
weapon pairs, **zero** derived names are produced by more than one distinct id-pair — the pure-function
collision ADR-0022 worries about is between *loadouts*, and it is handled by the
`(owner, listId, name)` key rather than by the name. Degenerate cases behave as specified
(`loadoutSlice.js:50-55`: one weapon → its own name, none → `""`, never a dangling "and").

**`calc.js`'s single-source claim for `TRAIT_MAX` holds.** `loadoutSlice.js:3`, `randomize.js:2` and
`loadoutCodec.js:2` all import it; no file repeats the literal 15; all three decoder paths
(`loadoutCodec.js:146`, `:383`, `:431`) route through `boundedTraits`.

**Taxonomy declarations are complete.** Every `group` value in all four categories is a member of its
declared list (`WEAPON_GROUPS`, `TOOL_GROUPS`, `TRAIT_GROUPS`, `CONS_GROUPS`) — zero undeclared rows.
Every `CONS` row's `type` is a member of `CONS_CAP_CATEGORIES` — **zero undeclared types**, so
ADR-0015's `UNDECLARED_CATEGORY` shared-budget fallback is not being exercised by live data.
*(Seat 3 owns this question; recording my independent result so the panel can tell corroboration from
echo.)*

**`catalog.js`'s remaining statistical claims all verify.** Tool group distribution (Melee 4, Traps 4,
Utility 4, Decoys 3, Throwing 3, Sidearms 2, Medical 1 = 21). Trait group distribution (Combat 15,
Medical 16, Mobility 5, Stealth 8, Utility 14 = 58). The wiki functional-category distribution
(Supportive 30, Offensive 12, Defensive 10, Movement 6). The `Solo`/`Catalyst` examples (Beastface and
Vigilant Supportive+Catalyst; Necromancer and Conduit Supportive+Solo). The Medical-precedent four
(Bulwark, Hornskin, Bloodless, Mithridatist all in `Medical`, so the count really would drop to 12).
The ammo-index worst case at `:128` (`AMMO.medium` and `AMMO.compact` both length 5; index 1 is
Spitzer $60 vs High Velocity $13). The 58 = 49 Regular + 8 Scarce + 1 Burn decomposition at `:592-593`.

**ADR-0014 and ADR-0017 are confirmed unbuilt.** `AMMO` is still ten shared `[name, cost]` pools
addressed by a single `ammoClass` string; there is no per-weapon ammo row, no ammo id, no second ammo
slot. No trait carries a condition vocabulary, no weapon carries an `actionType`, and nothing in the UI
surfaces `ConditionalEffect`. **ADR-0017's non-implementation is silent** — the app makes no claim about
trait applicability anywhere, which is the correct posture for an unbuilt advisory feature. ADR-0014's
non-implementation is **not** silent, which is F1.

**The accepted-but-unbuilt ledger**, recorded so the chair has it in one place: ADR-0014 (ammo rows),
ADR-0017 (trait conditions), ADR-0018 (rarity/burn disclosure — F2/F3), ADR-0019 Phase 1 (stat block;
`dualWieldFor`, `statFieldFor`, `statsFor`, `ITEM_STATS` and `STATS_GENERATED` still have **zero**
non-test consumers, exactly as the ADR documented four days ago), ADR-0021 (health-chunk disclosure —
the string "health chunk" appears nowhere in `client/src`). ADR-0022 **is** built (`savedId`,
`nameIsDerived`, `derivedName` all present and governed-commented).

---

## Handoffs — noticed outside my charge, not investigated

1. **Seat 1 / wire format.** `loadoutSlice.js:205-233` documents a deliberate divergence from ADR-0022:
   the ADR says a loadout *"decoded from a share URL … derives freely"*, and the code deliberately does
   **not** re-derive when the payload carries a name, calling that ADR line *"an oversight rather than
   an intent"*. The code's reasoning looks sound to me (deriving over a decoded `n` would overwrite a
   typed name on every reload), but the ADR was never amended, so ADR and code disagree in writing.
   Worth one line in whichever filing owns the codec.

2. **Seat 2 / provenance.** `sourceRevision` spans 10076–16390 across the 256 records. I did not test
   for clustering or a stale corner; the spread is wide enough to be worth Seat 2's dedicated pass.
   Separately: catalog rows total 147+21+30+58 = **256**, matching the record count exactly, which is
   suggestive of full coverage with no orphans — but I did not verify it id-by-id and it is Seat 2's
   charge, not a result I am claiming.

3. **Seat 3 / arithmetic.** `upTotal` (`calc.js:139`) uses `TRAIT_UP.get(id) || 0`, so a trait id not in
   `TRAITS` contributes 0 points **silently** rather than surfacing as a decode error. Also
   `slotMax` (`:117`) computes `8 - loadout.blocked.length` without de-duplicating or range-checking
   `blocked`, so a repeated or out-of-range index would understate capacity. Both are Seat 3's to judge.

4. **Seat 4 / images.** ADR-0020 publishes a full image bijection (weapons 147/147, tools 21/21,
   consumables 30/30, traits 58/58, zero orphans) as of 2026-08-12. I did not re-measure it; if Seat 4's
   pass disagrees with those numbers, the disagreement is itself a finding about ADR-0020.

5. **Panel hygiene, for the chair.** `server/data/db.test.json` is a single gitignored fixture shared by
   every `npm test` run and is not isolated per-process. Concurrent seats corrupt it (see Method). This
   is a real repo weakness for parallel work even though it is not a data defect — worth one line in the
   consolidated report so the next panel does not lose an hour to it.

6. **Unassigned by design, restated so silence does not imply coverage.** Nothing in this filing can see
   an item that is **missing from the catalog entirely**; `--discover` was not run, and I could not run
   it. Every coverage-shaped negative result above is coverage *of the catalog as it stands*.
