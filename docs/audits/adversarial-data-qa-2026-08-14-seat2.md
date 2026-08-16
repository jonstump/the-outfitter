# Adversarial Data QA Panel — Seat 2 filing

**Seat 2 — The catalog against the scrape.** Charge: provenance. Which numbers are pinned to a
source, and which only look like they are.

**Date:** 2026-08-14 · **Round:** 1 (independent) · **Repo state:** `7a7e772`

---

## Method and its limits

### Wiki reachability — checked, not assumed

| Probe | Result |
|---|---|
| `curl -sS -o /dev/null -w '%{http_code}\n' --max-time 20 https://huntshowdown.wiki.gg/wiki/Nagant_M1895` | `curl: (56) CONNECT tunnel failed, response 403` |
| `curl -sS -o /dev/null -w '%{http_code}\n' --max-time 20 https://huntshowdown.wiki.gg/` | `curl: (56) CONNECT tunnel failed, response 403` |

**huntshowdown.wiki.gg was NOT reachable.** I am in the blocked case. No page was fetched and no
infobox was parsed live. Every wiki value quoted below is quoted from the **committed scrape**,
`client/src/data/itemStats.json`, with the item id and that record's `sourceRevision`.

### What that makes my findings worth

My oracle is the scrape, not the wiki. Concretely:

- I **can** find disagreements *between the app's own two artifacts* — `catalog.js` against
  `itemStats.json`. Those are CONFIRMED, because both files are in front of me.
- I **cannot** find a value where the catalog and the scrape agree and both are stale. That whole
  class is invisible from here and is a blind spot of this filing.
- I **cannot** resolve which side of a disagreement is right by looking at the game. Where I claim a
  direction, the ground is ADR-0005 ("the wiki is authoritative for `size` and `cost`") plus the
  repo's own precedent, never recall.

**Honesty rule compliance.** I state no game number from memory. Every number below is either a
file+line citation or a quoted field from a named `itemStats.json` record at a named revision. Where
I could not evidence something, it is marked `SUSPECTED` or `[UNVERIFIED]` and says so.

The scrape is a better oracle than either prior audit in `docs/audits/` had. Both were written with
the wiki blocked and *before* `itemStats.json` existed — `weapon-catalog-wiki-audit.md` describes
`catalog.js` as 334 lines with 39 weapons, and its own method section says "no page was fetched and
no infobox was parsed directly," so every stat in it is `[VERIFY]`. I read both method sections first,
as instructed, and I treat neither as a source of numbers.

### Baseline

`npm test` **as written does not run in this container**, for two environment reasons, neither of
which is a repo defect:

1. `package.json` pins `"engines": {"node": "^20"}`; the container has `v22.22.2`, so `npm install`
   refuses with `notsup`. Installed with `--engine-strict=false`.
2. `npm run test -w client` reports `sh: 1: vitest: not found` — the hoisted binary lives at
   `node_modules/.bin/vitest` and is not on the workspace script's PATH here.

Run directly, the baseline is **green**:

| Suite | Command | Result |
|---|---|---|
| client | `vitest run` (from `client/`, root `.bin` on PATH) | 33 files, **759 passed** |
| server | `npm run test` (from `server/`) | 7 files, **161 passed, 1 skipped** |
| scrape | `node --test scripts/*.test.mjs` (from repo root) | **321 passed, 0 failed** |

Every finding below is filed against a **green** suite. That is the point: none of them is a test
failure, and none of them would ever become one.

### Reproduction

Findings are reproduced with `node --input-type=module` one-liners against `catalog.js` (a plain ES
module with no dependencies) and `itemStats.json`. Each finding carries its command. Nothing was
modified: my only write is this file. I did not run any `scripts/scrape-*.mjs`.

### The headline structural result, stated up front

**My charge's first bullet — "which catalog rows have no `itemStats` record at all" — has an empty
answer.** Coverage is exact:

```
node --input-type=module -e '
import fs from "node:fs";
const mod = await import("/home/user/the-outfitter/client/src/data/catalog.js");
const I = JSON.parse(fs.readFileSync("client/src/data/itemStats.json","utf8")).items;
const all = [...mod.WEAPONS, ...mod.TOOLS, ...mod.CONS, ...mod.TRAITS].map(r => r[0]);
console.log("catalog rows:", all.length, "records:", Object.keys(I).length);
console.log("rows with no record:", all.filter(id => !(id in I)));
console.log("records with no row:", Object.keys(I).filter(id => !all.includes(id)));'
```
```
catalog rows: 256 records: 256
rows with no record: []
records with no row: []
```

147 weapons + 21 tools + 30 consumables + 58 traits = 256, and 256 records, zero orphans in either
direction. So the artifact my seat was asked to produce is not a list of unpinned *rows*. **It is a
list of unpinned *columns*, and it is the table in the negative-result section.** Every row is
covered; roughly half of every row's data is still unpinned, and that is where the findings are.

---

## Findings

Nine findings: **1 × P1, 2 × P2, 6 × P3.**

---

### F1 — `Conversion` and `Conversion Chain Pistol` are priced out of the wrong ammo pool

- **Severity:** P1 — wrong answer, silently
- **Verdict:** **CONFIRMED** (as a disagreement between the app's own artifacts)
- **Items:** `caldwell-conversion-pistol`, `conversion-chain-pistol`
- **Files:** `client/src/data/catalog.js:100`, `client/src/data/catalog.js:285`

**Evidence.** The catalog files both rows as `ammoClass: "medium"`. The committed scrape records
their wiki infobox `AmmoType` as **`"Compact"`**:

```
node --input-type=module -e '
import fs from "node:fs";
const mod = await import("/home/user/the-outfitter/client/src/data/catalog.js");
const I = JSON.parse(fs.readFileSync("client/src/data/itemStats.json","utf8")).items;
for (const w of mod.WEAPONS) {
  const at = I[w[0]]?.fields?.AmmoType ?? null;
  if (w[4] === "medium" && at === "Compact")
    console.log(w[0], "| catalog:", w[4], "| wiki AmmoType:", at, "| rev", I[w[0]].sourceRevision, "|", I[w[0]].wikiUrl);
}'
```
```
caldwell-conversion-pistol | catalog: medium | wiki AmmoType: Compact | rev 16153 | https://huntshowdown.wiki.gg/wiki/Weapons/Conversion
conversion-chain-pistol    | catalog: medium | wiki AmmoType: Compact | rev 16154 | https://huntshowdown.wiki.gg/wiki/Weapons/Conversion/Chain_Pistol
```

**These are the only two rows in the catalog that break the mapping.** The full cross-tabulation of
`ammoClass` against scraped `AmmoType` across all 147 weapons:

| catalog `ammoClass` | wiki `AmmoType` |
|---|---|
| `compact` | `"Compact"` ×32 |
| `medium` | `"Medium"` ×32, **`"Compact"` ×2** |
| `long` | `"Long"` ×18 |
| `slong` | `"Special Long"` ×21 |
| `shotgun` | `"Shells"` ×19, `"Medium"` ×3 |
| `special` | `"Special"` ×8, `"Oil"` ×1 |
| `xbow` / `hxbow` / `bow` | `"Special"` ×2 / ×1 / ×1 |
| `none` | `null` ×6, `"Special"` ×1 |

`Compact → compact` and `Medium → medium` are otherwise clean 1:1 over 64 rows. The `shotgun`/`Medium`
trio is the **Drilling** family, which `catalog.js:239-242` documents by name as the known
`"Medium"`-covers-two-pools case. The `special`/`none` fan-out is documented at `catalog.js:236-242`
as the reason `ammoClass` is not machine-derived. **Nothing documents the Conversion.**

**Why this is not a documented exception.** `catalog.js:236-242` states the inheritance rule for the
#254 variants: "all 89 variants' wiki `AmmoType` equals their parent's, checked against
`itemStats.json` before these rows were written." I re-ran that check — it holds, 0 differences over
all 92 three-segment variant paths. So `conversion-chain-pistol` is not a second, independent error:
it faithfully inherited `medium` from a parent row that was already wrong, which is exactly the
failure mode inheritance-from-a-hand-authored-column has.

**Why the catalog is the side that is wrong.** Not my judgement — the repo's:

- ADR-0005 makes the wiki authoritative, and `catalog.js:85-89` restates it: "The wiki is
  authoritative for them per ADR-0005."
- This *exact* defect has already been found and fixed once in this file, on a different row.
  `docs/audits/weapon-catalog-wiki-audit.md` §3.3 (`### 3.3 — frontier-73c / "Frontier 73C" — ammo
  class contradiction`) records `ammoClass: medium → compact`, **Confidence: HIGH**, "This is a live
  bug: the app currently offers Medium ammo variants for a Compact-ammo weapon, so its ammo pricing
  is wrong in the budget math today." The correction is memorialised at `catalog.js:118-131`. The
  Conversion is the same sentence with a different weapon.
- The prior audit never checked it. `weapon-catalog-wiki-audit.md:218-222` lists **Conversion** among
  "Families whose variants were not enumerated — search did not surface their subpages… Treat as
  `[VERIFY AGAINST LIVE WIKI]`." So this row was explicitly left unverified, not cleared.

**Player-facing consequence.** `calc.js:157` and the `AMMO[WEAPONS[w.i][4]][w.a][1]` read charge the
`medium` pool for a weapon the scrape types `Compact`. Per-index, comparing `catalog.js:47` against
`catalog.js:48`:

| saved index | app charges (medium) | compact pool at same index | delta |
|---|---|---|---|
| 0 | FMJ $22 | FMJ $15 | **+$7** |
| 1 | Spitzer $60 | High Velocity $13 | **+$47** |
| 2 | Dumdum $28 | Dumdum $22 | +$6 |
| 3 | Incendiary $24 | Incendiary $18 | +$6 |
| 4 | Poison $21 | Poison $16 | +$5 |

Two separate wrong answers reach the player: the **cost line is overstated** on every Conversion
loadout with ammo selected, and `WeaponSlot.jsx:30` **offers "Spitzer"** — a round that does not
appear in the pool the scrape's `AmmoType` points at. The picker also mis-files both weapons under
the `Medium` ammo filter (`Picker.jsx:30`), so a player filtering for Compact sidearms never sees
them.

**Fix direction — and a hazard that must not be skipped.** Do **not** hand-edit this to `compact` in
isolation. `catalog.js:32-45` and `catalog.js:122-131` both state the wire-format consequence, and it
bites here in precisely the documented worst case: a saved ammo selection is a **bare index** into
`AMMO[ammoClass]`; `AMMO.medium` and `AMMO.compact` are **both length 5**, so no bounds check trips
and every already-saved Conversion loadout silently re-resolves. Index 1 is the named worst case —
Spitzer ($60) becomes High Velocity ($13). The Frontier 73C correction accepted that cost rather than
migrating; doing it a second time compounds it. The right shape is: confirm `AmmoType` against a live
fetch, then land the class change **with** a `FORMAT_VERSION` bump and a saved-selection migration,
per the gate `catalog.js:39-41` already states. Overlaps Seat 1's charge — flagging the coupling, not
adjudicating it.

---

### F2 — Nine weapons vanish from the picker whenever any ammo filter is active

- **Severity:** P2 — wrong presentation (an item the player owns becomes unreachable)
- **Verdict:** **CONFIRMED**
- **File:** `client/src/components/Picker/Picker.jsx:28-35`

**Evidence.** `AMMO_FILTERS` declares six buckets over nine of the ten `ammoClass` keys. `special` is
in `AMMO_LABEL` (`catalog.js:77`, `"Special ammo"`) and is used for the picker's `meta` line
(`Picker.jsx:60`), but it is in **no filter bucket** — `Other` covers `["none","bow","xbow","hxbow"]`
only. `Picker.jsx:51` applies `aOK(x.w[4])` unconditionally on the Weapons tab, so any active filter
excludes every `special` row.

```
node --input-type=module -e '
const mod = await import("/home/user/the-outfitter/client/src/data/catalog.js");
const F={Compact:["compact"],Medium:["medium"],Long:["long"],"Special Long":["slong"],Shotgun:["shotgun"],Other:["none","bow","xbow","hxbow"]};
const covered=new Set(Object.values(F).flat());
console.log("uncovered classes:", [...new Set(mod.WEAPONS.map(w=>w[4]))].filter(c=>!covered.has(c)));
mod.WEAPONS.filter(w=>!covered.has(w[4])).forEach(w=>console.log(" ", w[0], "| $"+w[3], "|", w[5]));'
```
```
uncovered classes: [ 'special' ]
  dolch-96           | $690  | Pistols
  nitro-express      | $1015 | Rifles
  bomb-launcher      | $110  | Rifles
  chu-ko-nu          | $75   | Bows
  flame-rifle        | $0    | Rifles
  shredder           | $0    | Rifles
  dolch-96-bullseye  | $725  | Pistols
  dolch-96-claw      | $700  | Pistols
  dolch-96-precision | $730  | Pistols
```

**Player-facing consequence.** With any of the six ammo chips selected, nine weapons — including the
whole Dolch 96 family and the $1015 Nitro Express — are absent from the picker with no indication
they were filtered out. The player concludes the app does not carry them. Clearing the filter is the
only recovery, and nothing signals that. This got worse silently: #254 tripled the `special` roster
from 3 to 6 to 9 without touching `AMMO_FILTERS`.

**Fix direction.** Either add `special` to the existing `Other` bucket, or give it its own chip using
the `AMMO_LABEL.special` string that already exists. Whichever is chosen, the durable repair is a
test asserting `new Set(WEAPONS.map(w => w[4]))` is a subset of `new Set(Object.values(AMMO_FILTERS).flat())`,
so the next new `ammoClass` fails loudly instead of hiding rows. Borders Seat 5's presentation charge;
filed here because the `special` pool is named in my charge and the mechanism is an `ammoClass` value
with no consumer bucket.

---

### F3 — `dark-dynamite-satchel` may be in the wrong consumable cap category

- **Severity:** P2 as filed; **rises to P1 if confirmed** (it would mis-apply the ADR-0015 cap)
- **Verdict:** **SUSPECTED** — circumstantial evidence, and the wiki category that would settle it is
  not in the committed data
- **Item:** `dark-dynamite-satchel`
- **Files:** `client/src/data/catalog.js:507`, `client/src/data/catalog.test.js:89`

**Evidence.** Two independent signals, and both are the signals #155 used when it re-typed Ammo Box,
Tool Box and Medical Pack from `Throwable`/`Shot` to `Placeable` (`catalog.js:543-547`).

*Signal 1 — it is the only Throwable in the file with no `ThrowRange`.* 18 of the 30 consumables are
typed `Throwable`; 17 carry a `ThrowRange` field; this one does not:

```
node --input-type=module -e '
import fs from "node:fs";
const mod = await import("/home/user/the-outfitter/client/src/data/catalog.js");
const I = JSON.parse(fs.readFileSync("client/src/data/itemStats.json","utf8")).items;
const t = mod.CONS.filter(c => c[3] === "Throwable");
console.log("Throwable rows:", t.length,
  "| without ThrowRange:", t.filter(c => I[c[0]].fields?.ThrowRange === undefined).map(c => c[0]));
console.log("Placeable rows without ThrowRange:",
  mod.CONS.filter(c => c[3] === "Placeable" && I[c[0]].fields?.ThrowRange === undefined).map(c => c[0]));'
```
```
Throwable rows: 18 | without ThrowRange: [ 'dark-dynamite-satchel' ]
Placeable rows without ThrowRange: [ 'medical-pack', 'ammo-box', 'tool-box' ]
```

*Signal 2 — its scraped prose reads as a placeable, in the same words Medical Pack's does.*
`itemStats.json`, `dark-dynamite-satchel`, rev **16070**,
`https://huntshowdown.wiki.gg/wiki/Consumables/Dark_Dynamite_Satchel`:

> "A **deployable** bundle of dynamite sticks that are detonated remotely via Dark Sight. **Can be
> attached to walls and floors.**"

Compare `medical-pack`, rev 15196, which #155 moved *to* `Placeable`:

> "A portable medical kit that heals 100 health. **Deployable** in active health emergencies."

**Why nothing catches it.** `catalog.test.js:89` pins the row as
`["dark-dynamite-satchel", "Dark Dynamite Satchel", 100, "Throwable", "Explosives"]` — a hand-transcribed
literal (see F9). `catalog.test.js:255` only checks the value is *some* member of
`CONS_CAP_CATEGORIES`, which `Throwable` is. And there is no scraped counterpart to compare against
at all (F5). So this value is pinned against itself, three ways, and against no source.

**Player-facing consequence, if confirmed.** `calc.js:82-87` resolves the cap category from
`CONS[i][3]` through `CONS_CAP_CATEGORIES`, four per category (ADR-0015). If the satchel is really
`Placeable`, the app's cap arithmetic diverges from the game's in both directions — it counts
satchels against the Throwable budget, so a loadout mixing satchels with bombs is refused earlier
than the game refuses it, while a satchels-plus-placeables loadout the game permits reads as
over-cap. The player is told a legal loadout is impossible.

**Why SUSPECTED and not CONFIRMED.** The decisive evidence is the page's wiki *category* membership
(`Category:Placeable_Consumables`), and the scrape does not persist any category axis for
consumables — see F5. Absence of a `ThrowRange` field is strong but is an argument from absence, and
`FuseTimer: "1"` is present, which a purely-placed item need not carry. I will not assert a category
I cannot read.

**Fix direction.** Resolve against the live page's category block, not against the prose. If it is
`Category:Placeable_Consumables`, re-type the row. The durable repair is the one F5 asks for: teach
`scrape-stats.mjs` to persist the consumable cap-category axis the way it already persists
`acquisitionClasses` for traits, and pin `CONS[i][3]` against it in `itemStats.test.js` — that would
have caught this without anyone needing to notice a missing field.

---

### F4 — The `AMMO` price table has no provenance at all: 31 budget-affecting numbers, unpinned

- **Severity:** P3 — unverifiable / rot risk (but the highest-leverage P3 in this filing)
- **Verdict:** **CONFIRMED** (that it is unpinned; no specific value is claimed wrong)
- **File:** `client/src/data/catalog.js:46-66`

**Evidence.**

```
node --input-type=module -e '
const mod = await import("/home/user/the-outfitter/client/src/data/catalog.js");
let n=0,min=1e9,max=0;
for (const v of Object.values(mod.AMMO)) for (const [,p] of v) { n++; min=Math.min(min,p); max=Math.max(max,p); }
console.log(n, "pairs across", Object.values(mod.AMMO).filter(v=>v.length).length, "non-empty pools; $"+min+"-$"+max);'
```
```
31 pairs across 8 non-empty pools; $13-$90
```

Each of those 31 entries is a `[roundName, price]` pair. **None has an `itemStats.json` record, no
test asserts any of them, and `catalog.js:43-45` states outright that the scraper can never write
them**: "This table is also NEVER written by a scrape (SPEC-0007 REQ 'Fields the Scraper Must Not
Derive'): the wiki has no per-pool source page." Grepping the client for `AMMO` outside tests reaches
only consumers (`Picker.jsx`, `WeaponSlot.jsx`, `calc.js`, `randomize.js`) — nothing that validates it.

Contrast the pinned columns: weapon `size` is compared 147/147 against the scrape, weapon `cost`
143/147, tool cost 21/21, consumable cost 30/30, trait UP 50/58 (§ negative result). The `AMMO` table
is the one budget input with **zero** coverage.

**Player-facing consequence.** Ammo enters `totalCost` directly (`calc.js` reads
`AMMO[WEAPONS[w.i][4]][w.a][1]`). Two weapons at the dearest round is **$180** of a loadout's price
resting on numbers with no recorded verification date and no mechanism that could ever notice they
went stale. F1 is what it looks like when the *pointer into* this table is wrong; a wrong price
inside it would be strictly less visible, because no round name would change.

**This is not a new observation, and that is part of the finding.** `weapon-catalog-wiki-audit.md`
§3.7 raised it: *"entirely hand-authored, with no recorded verification date… this table has no
provenance at all and feeds the budget math directly. Status: verify all."* It remains open. I add
two things the audit did not have: the exact current shape (31 pairs / 8 non-empty pools — the audit
counted "ten pools," including the two deliberately empty ones), and the confirmation from the
committed scrape that no path to pinning it exists today.

**Fix direction.** The route already exists on paper. `weapon-catalog-wiki-audit.md:227-233` records
that per-weapon ammo unlock rows *do* live on each weapon's family page ("Caldwell Pax High Velocity
Ammo (8th unlock)") and recommends scraping them into a per-weapon `availableAmmo` list while leaving
`ammoClass` alone. That is ADR-0014's territory (accepted, unbuilt). Short of building it, the
minimum honest step is a dated, cited comment beside the table stating when each price was last read
and from where — the `TRAITS` block at `catalog.js:647-653` already models exactly that discipline,
and `AMMO` is the table that most needs it.

---

### F5 — Consumable `type` — the cap key — has no scraped counterpart anywhere

- **Severity:** P3 — unverifiable / rot risk
- **Verdict:** **CONFIRMED**
- **Files:** `client/src/data/catalog.js:476-515` (the `type` column), `client/src/data/catalog.js:552`

**Evidence.** Across all 30 consumable records, the infobox fields the scrape persists are:

```
Price 30 · Update 30 · Unlock 30 · MeleeDamage 30 · HeavyMeleeDamage 30
ThrowRange 17 · Damage 16 · EffectRadius 16 · EffectDuration 11 · FuseTimer 8
ControlRange 3 · DamageperTick 2
```

There is **no** `Category` field, no `Type` field, and `acquisitionClasses` is `[]` for all 30 (and
for all 147 weapons and all 21 tools — it is populated only for the 58 traits). So no committed
artifact records what cap category the wiki assigns a consumable.

That the trait axis *is* captured is not an oversight I am reporting: SPEC-0007 REQ "Acquisition
Class Is Captured…" (`docs/openspec/specs/equipment-catalog-dataset/spec.md:251-257`) requires the set
for *traits* and only `purchasable` for consumables, and both are satisfied. The finding is the
consequence: **`CONS[i][3]` is a rules input with no source of truth in the repo.**

**Player-facing consequence.** ADR-0015 makes `type` the cap key: `calc.js:82-87` resolves it through
`CONS_CAP_CATEGORIES` and caps four per category. A wrong `type` therefore changes which loadouts the
app accepts, with no possible test failure — F3 is a live candidate for exactly this. `catalog.js:543-547`
asserts "all three are `Category:Placeable_Consumables` on the wiki" and `catalog.test.js:241` restates
it, but **that claim is not reproducible from committed data** — the same limitation `catalog.js:769-779`
candidly records for the trait functional axis ("THE REPO CANNOT CHECK THE CLAIM… `scrape-stats.mjs`
parses whole-page categories but persists only `acquisitionClasses`"). The consumable cap category is
in the identical position and is *not* flagged as such anywhere.

**Fix direction.** The scraper already parses whole-page categories and already filters them to one
axis for traits. Persisting a second filtered axis for consumables — the cap categories — costs no new
crawl and would let `itemStats.test.js` pin `CONS[i][3]` the way it pins cost. Until then, the honest
step is a comment at `CONS_CAP_CATEGORIES` recording that `type` is hand-authored and uncheckable,
matching the candour of the `TRAIT_GROUPS` note.

---

### F6 — `itemStats.test.js` documents its own skip with a row that no longer exists

- **Severity:** P3 — comment gone false, in the file that governs the pinning
- **Verdict:** **CONFIRMED**
- **File:** `client/src/data/itemStats.test.js:41-43`, `:399-406`

**Evidence.** The comment governing the pinning test reads:

> "Items with no record are skipped rather than failed… Today that skip covers exactly one id,
> `winfield-m1873c`, a `KNOWN_CATALOG_DUPLICATES` entry with no wiki page of its own."

Every clause is now false:

```
node --input-type=module -e '
import fs from "node:fs";
const mod = await import("/home/user/the-outfitter/client/src/data/catalog.js");
const w = await import("/home/user/the-outfitter/scripts/lib/wiki.mjs");
const I = JSON.parse(fs.readFileSync("client/src/data/itemStats.json","utf8")).items;
console.log("in catalog:", [...mod.WEAPONS,...mod.TOOLS,...mod.CONS,...mod.TRAITS].some(r=>r[0]==="winfield-m1873c"));
console.log("in itemStats:", "winfield-m1873c" in I);
console.log("KNOWN_CATALOG_DUPLICATES:", JSON.stringify(w.KNOWN_CATALOG_DUPLICATES));'
```
```
in catalog: false
in itemStats: false
KNOWN_CATALOG_DUPLICATES: {}
```

The id was retired by #243 (`loadoutCodec.test.js:548-565` covers the alias), and
`KNOWN_CATALOG_DUPLICATES` is empty. What the skip *actually* covers today is **12 rows for an
entirely different reason** — not "no record," but "the pinned field parses to null":

| case | compared | skipped | which |
|---|---|---|---|
| weapon cost | 143/147 | 4 | `flame-rifle`, `homestead-78`, `shredder`, `wildland` — `fields.Price` is the literal `"Scarce"` |
| weapon size | 147/147 | 0 | — |
| tool cost | 21/21 | 0 | — |
| consumable cost | 30/30 | 0 | — |
| trait UP | 50/58 | 8 | `berserker`, `catalyst`, `death-cheat`, `rampage`, `relentless`, `remedy`, `shadow`, `shadow-leap` — no `Cost` row on the page |

**All 12 are separately covered by the ADR-0013 zero-cost invariant** (verified item-by-item in the
negative result), so the *coverage* is sound. The comment is not.

Two related staleness items in the same file, folded in here rather than filed separately:

- `:150` — "9 of the **32** traits carry a second paragraph". The nine named ids are exactly right
  (verified), but `TRAITS.length` is **58** since #157. The share is 9/58, not 9/32.
- `:406` — `expect(covered.length).toBeGreaterThan(WEAPONS.length - 3)`. That slack was sized around
  `winfield-m1873c`. Coverage is now 147/147, so the guard permits **two** weapons to silently lose
  their scrape record without failing.

**Player-facing consequence.** None directly. The consequence is to the next reviewer: this comment
is the file's own account of what is and is not pinned, it is the first thing anyone auditing
coverage will read, and it will send them looking for a row that does not exist while the twelve rows
that *are* skipped go unmentioned. That is the exact rot this panel exists to catch.

**Fix direction.** Rewrite the comment to describe the parse-null skip, name the two evidenced-Scarce
mechanisms (`fields.Price === "Scarce"` for weapons, absent `Cost` row for traits), and point at the
ADR-0013 block that covers them. Tighten `:406` to `toBe(WEAPONS.length)` now that coverage is total,
so a lost record fails. Correct "32" to "58" at `:150`.

---

### F7 — `catalog.js`'s `special`-pool comment names six weapons; there are nine

- **Severity:** P3 — comment gone false
- **Verdict:** **CONFIRMED**
- **File:** `client/src/data/catalog.js:55-64`

**Evidence.** The comment beside `special: []` reads: *"Six weapons draw from it as of #233 — Dolch
96, Nitro Express, Bomb Launcher, Chu Ko Nu, Flame Rifle and Shredder."*

```
node --input-type=module -e '
const mod = await import("/home/user/the-outfitter/client/src/data/catalog.js");
console.log(mod.WEAPONS.filter(w => w[4] === "special").map(w => w[0]));'
```
```
[ 'dolch-96', 'nitro-express', 'bomb-launcher', 'chu-ko-nu', 'flame-rifle',
  'shredder', 'dolch-96-bullseye', 'dolch-96-claw', 'dolch-96-precision' ]
```

#254 added three Dolch variants (`catalog.js:287-289`) without updating the comment. The comment's
*substantive* claim still holds — none of the nine has a purchasable round, so the pool is still
empty by fact — but its enumeration is 6 of 9.

**Player-facing consequence.** None directly; the pool is empty either way. It matters because this
comment is the stated justification for an empty pool, and a reader checking that justification
against the data finds it does not match. It is also the comment that would have flagged F2: three
rows joined a class whose downstream consumers nobody re-checked.

**Fix direction.** Restate the membership as derived rather than enumerated, or pin it — a one-line
assertion that every `special`-class weapon's record has `purchasable !== true` or no purchasable
round would keep the justification true by construction instead of by transcription.

---

### F8 — Three consumable/tool pages are a stale corner, ~3,900 revisions behind the rest

- **Severity:** P3 — rot risk
- **Verdict:** **CONFIRMED** (the revision gap); **SUSPECTED** that any value is actually wrong
- **Items:** `decoys`, `chaos-bomb`, `flash-bomb`

**Evidence.** `sourceRevision` is the wiki page's `wgCurRevisionId` at scrape time
(`scripts/scrape-stats.mjs:453-455`) — a wiki-global monotonic counter, so it orders pages by how
recently each was *edited*. Every one of the 256 records was ingested in the same hour
(`ingestedAt` is `2026-08-12T22` for all 256), so the spread below is entirely about page currency,
not scrape currency.

```
node --input-type=module -e '
import fs from "node:fs";
const I = JSON.parse(fs.readFileSync("client/src/data/itemStats.json","utf8")).items;
Object.entries(I).map(([id,r])=>[id,+r.sourceRevision]).sort((a,b)=>a[1]-b[1]).slice(0,6)
  .forEach(([id,rev]) => console.log(String(rev).padStart(6), id));'
```
```
 10076 decoys
 10096 chaos-bomb
 10105 flash-bomb
 13984 blank-fire-decoys      <- next oldest, +3879
 14698 fusees
 14704 spyglass
```

Per-category medians for context: weapons 15976, tools 16044, consumables 15286, traits 15641; file
max 16390. These three sit **~3,900 revisions below the next-oldest page** and ~5,500 below the file
median. Their catalog costs (`decoys` $6 at `catalog.js:375`, `chaos-bomb` $15 at `:489`,
`flash-bomb` $25 at `:496`) are pinned to those revisions and to nothing more recent.

**Player-facing consequence.** None demonstrated. This is a *risk* ranking, filed because my charge
asks whether some corner of the dataset is far older than the rest, and it is. If a balance patch has
touched any of these three prices and the wiki editors have not yet updated the page, the pinning
test would agree with a stale page and stay green — the one failure mode the pinning explicitly
cannot detect. I am **not** claiming any of the three values is wrong; I have no source that could
tell me.

**Fix direction.** Nothing to change in the data. If a re-scrape is scheduled, these three are the
rows whose pages most warrant a human glance, and they are a natural first target for ADR-0016's
incremental refresh — a revision-delta check would surface exactly this ranking automatically.

---

### F9 — `catalog.test.js`'s "verified against huntshowdown.wiki.gg" block pins literals, not a source

- **Severity:** P3 — a pin that only looks like one
- **Verdict:** **CONFIRMED**
- **File:** `client/src/data/catalog.test.js:31-107`

**Evidence.** The `describe` is titled *"data accuracy (verified against huntshowdown.wiki.gg, Update
2.8.1)"*. Its assertions are whole-tuple literals with no URL, no revision, and no read through
`statFieldFor` — e.g. `:59`:

```js
expect(entry(WEAPONS, "1890 Cavalry")).toEqual(["1890-cavalry", "1890 Cavalry", 3, 56, "long", "Rifles"]);
```

and `:89`:

```js
"Dark Dynamite Satchel": ["dark-dynamite-satchel", "Dark Dynamite Satchel", 100, "Throwable", "Explosives"],
```

For the columns that are *also* pinned to `itemStats.json` (`size`, `cost`, `up`) this is harmless
redundancy — a divergence fails one suite or the other. But these literals are the **only** thing
asserting the two hand-authored, uncheckable columns: `ammoClass` (`:64-66`) and consumable `type`
(`:83-101`). Against those, a literal transcribed by a human in #36/#37 can detect an accidental edit
and can *never* detect drift from the wiki. Its title says otherwise.

This is not a style objection. It is the mechanism by which F3 is frozen: `dark-dynamite-satchel`'s
`Throwable` is asserted in three places (this literal, `catalog.test.js:255`'s membership check, and
nothing else), all of which are the value compared against itself.

Elsewhere this repo does this well and is worth citing as the model: `catalog.test.js:419-492`
("the `TRAIT_GROUPS` taxonomy rationale") explicitly re-derives its claims from `statFieldFor` off the
generated dataset, with a header saying so — "every wiki value measured below is read through
`statFieldFor` off the generated `itemStats.json`". The block at `:31` predates that discipline.

**Player-facing consequence.** None directly. The harm is to the panel's own question: a reader
counting what is "verified against the wiki" will count this block, and it is not.

**Fix direction.** Retitle to what it is — a regression pin on values corrected by #36/#37/#40 — or
re-express the assertions it *can* source through `statFieldFor` and leave only the genuinely
hand-authored columns as literals, with a comment saying they are unsourced. Do not delete it; as a
change-detector it is useful. Only its name overclaims.

---

## Negative result — what I checked and found clean

Filed deliberately, so the next reviewer knows what not to redo. Each line is a command I ran, not an
impression.

### Structural provenance — clean, and stronger than I expected

| Check | Result |
|---|---|
| Catalog rows with **no** `itemStats` record | **0 of 256** |
| `itemStats` records with **no** catalog row (stale coverage / renamed-id symptom) | **0 of 256** |
| Duplicate catalog ids, within or across categories | **0** |
| Two catalog rows sharing one `wikiUrl` (would mean one row's numbers came off the wrong page) | **0** |
| Duplicate `infoboxTitle` across records | **0** |
| Records missing `infoboxTitle` | **0** |
| `selectedBy` other than `canonical-title` (a page selected by fallback) | **0 of 256** |
| `wikiUrl` not on `https://huntshowdown.wiki.gg/wiki/` | **0** |
| `sourceRevision` absent or non-numeric | **0** |
| `ingestedAt` absent | **0** |

### Re-scrape reproducibility — clean

For all **256** rows, `resolveWikiPath(category, id, name)` computed from *today's* catalog display
names equals the path recorded in that row's `wikiUrl`. **0 mismatches.** A re-scrape today would
read every item from the same page its committed numbers came from — no display-name edit has
silently re-pointed a row. (`WIKI_TITLE_OVERRIDES.weapons` holds 92 entries; tools, consumables and
traits hold none; `KNOWN_CATALOG_DUPLICATES` is empty.)

### The Katana-class defect — zero instances

Every catalog array agrees with the wiki namespace its rows are filed under: WEAPONS 147/147 under
`/wiki/Weapons/`, TOOLS 21/21 under `/wiki/Tools/`, CONS 30/30 under `/wiki/Consumables/`, TRAITS
58/58 under `/wiki/Traits/`. No cross-namespace override exists to mask one. The `throwing-spear` is
the row that looks like a candidate — its prose opens "Two-handed melee weapon" — but the wiki files
it at `/wiki/Tools/Throwing_Spear`, so the namespace and the catalog agree and it is correctly a Tool.

### Hand-authored columns vs. the scrape

| Column | Verdict |
|---|---|
| `name` (all 256 rows) | **Clean.** 0 mismatches against `record.name`, and 0 between `record.name` and `record.infoboxTitle`. Since `name` feeds `slugify()` and therefore the image path, this is load-bearing beyond display. |
| `ammoClass` | **2 disagreements** — F1. The other 145 map cleanly, including all documented multi-pool cases. |
| `group` (all categories) | **No source exists.** `catalog.js:754-824` and SPEC-0007 REQ "Fields the Scraper Must Not Derive" both establish the wiki has no field that could supply it; the trait functional axis is 4-valued against the app's 5. Correctly hand-assigned; not checkable, and the repo says so. |
| consumable `type` | **No source exists** — F5, and one live candidate defect, F3. |
| Weapon variant inheritance | **Clean.** Over all 92 three-segment variant paths, `ammoClass` differs from the true parent's in **0** cases and wiki `AmmoType` differs in **0** cases, which independently re-verifies the claim at `catalog.js:236-242`. The 6 rows whose `group` differs from their longest-path-prefix parent are exactly the six the file documents by name as class-changing (`sparks-pistol`, `sparks-pistol-silencer`, `nagant-officer-carbine`, `officer-carbine-deadeye`, `lemat-carbine`, `lemat-carbine-marksman`). |

### ADR-0013 (zero cost is evidenced), re-derived item by item

All **12** cost-0 rows, and the evidence each rests on, read from the records rather than from the
test:

| id | evidence | rev |
|---|---|---|
| `flame-rifle` | `purchasable: false`, `priceStated: "Scarce"` | 15222 |
| `homestead-78` | `purchasable: false`, `priceStated: "Scarce"` | 15736 |
| `shredder` | `purchasable: false`, `priceStated: "Scarce"` | 15144 |
| `wildland` | `purchasable: false`, `priceStated: "Scarce"` | 15176 |
| `berserker`, `catalyst`, `shadow`, `shadow-leap` | `acquisitionClasses: ["Scarce"]` | 15616 / 15637 / 15663 / 15772 |
| `death-cheat`, `rampage`, `relentless`, `remedy` | `acquisitionClasses: ["Scarce","Burn"]` | 15641 / 15656 / 15658 / 15659 |

The reverse direction is clean too: **0** rows with `cost > 0` carry `purchasable: false`,
`purchasable: null`, or a `Scarce` acquisition class. No row passes on stale evidence — every one of
the twelve was read in the same 2026-08-12 scrape as the rest of the file, and the two mechanisms are
distinct per category exactly as `itemStats.test.js:241-247` describes. Additionally: `priceStated`
equals `fields.Price ?? fields.Cost` for all 256 records, and no `Price`/`Cost`/`Size` field anywhere
contains a comma or a decimal point, so the strict parser has no near-miss cases.

### Infobox vs. prose disagreements

**Chu Ko Nu is still exactly as the repo documents it** and is still the only one. Its record (rev
15216) has `fields.AmmoType: "Special"` while its description reads "Repeating Crossbow that fires
**Compact Bolts**". `catalog.js:60-63` names this disagreement and states the catalog follows the
infobox. Confirmed unchanged.

I scanned all 147 weapon descriptions for ammo-class words against their infobox `AmmoType`. Every
other apparent hit is a false positive on inspection — the Nagant family's "**Medium** damage",
and "Bolts"/"Arrows" as ordinary prose for crossbows and bows. **No second undocumented
infobox/prose disagreement on the ammo axis exists.** Trait infobox `Type` agrees with the
category-derived `acquisitionClasses` for **58/58** traits. No description anywhere states a money
amount that could contradict a pinned price.

### Generated-file integrity

`_generated` carries `by: "scripts/scrape-stats.mjs"` and the do-not-hand-edit warning. All 256
records carry `sourceRevision` and `ingestedAt`. `acquisition`'s raw comma-joined form
(`"Burn , Scarce"`, 4 traits) has a space before the comma — but SPEC-0007:251 requires that raw form
be stored *and* forbids membership-testing against it, `acquisitionClasses` carries the parsed set
correctly, and grepping the client shows **no non-test consumer** of `acquisition`, `acquisitionClasses`,
`purchasable`, `priceStated`, `variantCount` or `sourceRevision`. Not player-facing; not a finding.

### Verified test-comment claims that are still TRUE

Checked as claims to falsify; these survive: Serpent's description is exactly 209 characters
(`itemStats.test.js:184`); the Flame Rifle is exactly 296 and is the file-wide longest, above the
240 trait-tip budget (`:200-202`); the nine multi-paragraph traits are exactly the nine named ids
(`:150`); `Throwing` tools all contain "can be retrieved and reused" including the spear
(`catalog.test.js:395`); the `Sidearms` and `Decoys` group rationales hold against the scraped prose.

---

## Handoffs — noticed outside my charge, NOT investigated

1. **Seat 1 (wire format).** F1's fix cannot be a bare edit: `AMMO.medium` and `AMMO.compact` are
   both length 5, so re-classing the Conversion re-points every saved selection with no bounds check
   tripping — index 1 flips Spitzer ($60) → High Velocity ($13). `catalog.js:122-131` records that
   this cost was *accepted* rather than migrated for `frontier-73c`. Doing it twice compounds it.
2. **Seat 3 (rules).** `randomize.js:58` guards with `AMMO[...].length` before drawing, so the empty
   `special`/`none` pools are handled there — but it draws a uniform index over the live pool, which
   is the same bare-index surface. Not checked further.
3. **Seat 3 (caps).** No consumable row has an undeclared `type` today — all 30 are in
   `CONS_CAP_CATEGORIES`, so `UNDECLARED_CATEGORY` is unreachable from the data. That answers the
   "is any row's type actually undeclared today?" question with *no*; whether the fold-into-one-budget
   path behaves is Seat 3's.
4. **Seat 5 (prose).** `choke-bombs`' scraped description contains what looks like an upstream typo
   ("preventing new fires **form** being lit") and an unspaced en-dash ("while active–as well as").
   Both are faithful to the source as far as I can tell; whether they should be surfaced is Seat 5's.
5. **Seat 5 (ADR conformance).** `sourceRevision` and `ingestedAt` are never surfaced in any UI —
   the player sees no provenance for any number. Design fact, not a defect I can adjudicate.
6. **The panel's declared blind spot — a partial way in.** No seat owns "items missing from the
   catalog entirely," and no seat can run `--discover`. But the committed scrape carries
   `variantCount` (= `result.infoboxCount`, `scrape-stats.mjs:510`), the number of variant infoboxes
   on each page. Comparing that per family against the catalog's row count for the same family is an
   **offline, committed-data** partial oracle for missing variants. I did not run it — it is outside
   my charge and it belongs to whoever the chair assigns the blind spot to — but it exists, and the
   report should not record the blind spot as total without noting it.

---

## Closing note on this seat's coverage

I worked the charge to exhaustion: a final full pass over `catalog.js`, `itemStats.json`,
`itemStats.js`, `itemStats.test.js` and `catalog.test.js` turned up nothing not already above. The
one thing I could not do is the thing the environment forbids — read the wiki. Every finding here is
an internal disagreement, a missing pin, or a claim that has gone false. **None of them is a claim
about the game**, and any seat that reads one as such has misread it.
