# Weapon Catalog vs. huntshowdown.wiki.gg — Reconciliation Audit

**Date:** 2026-08-10
**Scope:** `client/src/data/catalog.js` → `WEAPONS` (39 entries)
**Source of truth:** `https://huntshowdown.wiki.gg/`
**Purpose:** Seed spec for the `scripts/scrape-stats.mjs` pipeline described in
[ADR-0005](../adrs/ADR-0005-scrape-item-stats-into-generated-data-file.md).

---

## Method and its limits — read this first

This audit was assembled from three sources, in descending order of reliability:

1. **The repo itself.** `scripts/scrape-images.mjs` already carries a
   `WIKI_TITLE_OVERRIDES` map that its own header documents as *"Verified against the
   wiki's own sitemap (sitemap-huntshowdown_en-NS_0)"*. Every rename in List 1 that
   appears in that map is therefore already sitemap-confirmed inside this codebase.
2. **Wiki-derived search results.** Page titles, URL slugs, and variant names below were
   returned by search against `huntshowdown.wiki.gg` and are quoted from wiki content.
3. **Domain knowledge**, used only to interpret 1 and 2 — never as a standalone source.

**Direct HTTP access to `huntshowdown.wiki.gg` was blocked by this environment's egress
proxy** (`connect_rejected: gateway answered 403 to CONNECT`). No page was fetched and no
infobox was parsed directly. Consequently:

- Every **page path** below is either sitemap-verified in-repo or appeared verbatim as a
  wiki URL in search results. These are high-confidence.
- Every **numeric stat** below is marked `[VERIFY]` unless it was quoted from wiki content,
  and even then it is at most MEDIUM confidence. **Do not write any number from this
  document into `catalog.js` by hand.** Let the scraper fetch it.

The correct resolution for every `[VERIFY]` marker is to run the scraper, not to research
further by hand — which is exactly the toil ADR-0005 exists to absorb.

---

## Files found under `client/src/data/`

> Note: the task brief said `/src/data`; this repo's client is nested, so the real path is
> `client/src/data/`. There is no top-level `src/`. `server/data/` exists but contains only
> a `.gitkeep`.

| File | Contents |
|------|----------|
| `client/src/data/catalog.js` | **The entire game dataset.** Hand-authored ES module, 334 lines. Exports `AMMO` (ammo-class → purchasable variant price pairs), `AMMO_LABEL`, `WEAPONS` (39 tuples), `WEAPON_GROUPS`, `TOOLS` (22), `TOOL_GROUPS`, `CONS` (31), `CONS_GROUPS`, `TRAITS` (32), `TRAIT_GROUPS`, plus SVG fallback-icon maps (`THUMBS`, `TOOL_THUMBS`, `TRAIT_THUMBS`, `CONS_THUMBS`, `HUNTER_THUMBS`) and their dispatch functions, and the symbolic ids `QM` / `FIRST_AID_KIT`. |
| `client/src/data/catalog.test.js` | Vitest suite asserting catalog invariants — id uniqueness/stability, tuple shape, group membership, thumb dispatch coverage. |
| `client/src/data/hunterThumb.test.js` | Vitest suite for `hunterThumb()` determinism. |

### Weapon record shape

```js
// [id, name, size, cost, ammoClass, group]
["nagant-m1895", "Nagant M1895", 1, 30, "compact", "Pistols"]
```

- `id` — stable slug. Per ADR-0005 and the `catalog.js` header, **ids are the wire format**
  for `loadoutCodec.js`, localStorage, saved loadouts and share URLs. A scrape may never
  rewrite one. A renamed weapon keeps its old id and gains a new display name.
- `size` — 1–5 slot cost (already on Update 2.8's reworked scale).
- `cost` — Hunt Dollars.
- `ammoClass` — key into the shared `AMMO` pool (`compact`, `medium`, `long`, `slong`,
  `shotgun`, `xbow`, `hxbow`, `bow`, `special`, `none`).
- `group` — UI bucket, one of `Pistols | Rifles | Shotguns | Melee | Bows`. This is an
  app-side taxonomy with **no wiki equivalent** — the wiki organizes by ammo type and slot
  size. The scraper must not try to derive `group`.

### Relationships that matter to the scraper

- **There are no variants in the app.** The catalog models one entry per *base* weapon.
  Three entries are secretly variants (`sparks-pistol`, `nagant-officer-carbine`,
  `mosin-nagant-avtomat`) and are already mapped to wiki *subpages*. There is no `variantOf`
  field, no parent/child relation, and no weapon-family concept anywhere in the data model.
  **Adding List 2 wholesale requires a schema change, not just rows.**
- **Ammo is modeled coarsely**, exactly as ADR-0005 anticipated: a weapon points at an
  `ammoClass` and inherits that class's shared variant price list. Per-weapon ammo
  divergence (scarce custom ammo, weapon-specific bolts, per-weapon unlock trees) is not
  representable today.
- **No stat fields exist at all** — no damage, velocity, range, rate of fire, reload, ammo
  pool, or melee damage. This is the gap ADR-0005's `itemStats.json` is meant to fill.

---

## List 1: Weapons That No Longer Exist

**Headline: nothing in the catalog was deleted from Hunt.** No app weapon has been removed
from the game. What has happened is (a) one true duplicate row, and (b) a large batch of
stale pre-`1896` display names left over from Update 2.0's brand-wide rename.

### 1A — Genuinely invalid entries

| App id / name | File | Reason | Last patch valid | Wiki page path | Notes |
|---|---|---|---|---|---|
| `winfield-m1873c` / "Winfield M1873C" | `client/src/data/catalog.js:81` | **Duplicate row.** Same weapon as `frontier-73c`, which is already in the catalog under its current name. | Update 1.15 (pre-`1896`) | `/wiki/Weapons/Frontier_73C` | `scrape-images.mjs` already maps this name to `null` and lists it in `KNOWN_CATALOG_DUPLICATES`; it is why no `winfield-m1873c.png` exists. **Delete the row.** Confirm `loadoutCodec.js` handles the id disappearing the same way it handles the retired Choke/Stalker Beetle tool slots. |
| `winfield-m1873` / "Winfield M1873" | `client/src/data/catalog.js:82` | **Renamed to "Ranger 73".** The catalog has no `ranger-73` row, so this weapon currently has no valid entry. | Update 1.15 (pre-`1896`) | `/wiki/Weapons/Ranger_73` | ⚠️ `scrape-images.mjs` maps this to `null` with the comment *"the post-rename entry 'Ranger 73' covers this weapon"* — **that comment is wrong; no such entry exists.** The image scraper is therefore silently skipping a live weapon. Per ADR-0005, fix by keeping id `winfield-m1873` and setting name → `Ranger 73`; do **not** mint a new id. |
| `bomb-lance` / "Bomb Lance" | `client/src/data/catalog.js:86` | **Reworked, not removed.** Update 2.1 promoted the **Bomb Launcher** to family base and demoted the Bomb Lance to an unlock within that family. | Still live | `/wiki/Weapons/Bomb_Lance` | The page still exists, so the row stays valid. But the app is now modelling a variant as if it were a base weapon, and is missing the family base (`/wiki/Weapons/Bomb_Launcher`, List 2). Also grouped `Melee` in-app while the wiki treats it as a special/large-slot weapon. |

### 1B — Renamed in Update 2.0 (`1896`); id keeps, display name is stale

All fourteen are the same failure: the catalog carries the pre-`1896` branded name, the wiki
moved to the short post-rename title. All of these paths are **sitemap-verified in-repo** via
`scripts/scrape-images.mjs` `WIKI_TITLE_OVERRIDES`. Last patch where the old name was valid:
**Update 1.15**, superseded by **Update 2.0**.

| App id / name | Current wiki title | Wiki page path |
|---|---|---|
| `caldwell-conversion-pistol` / "Caldwell Conversion Pistol" | Conversion | `/wiki/Weapons/Conversion` |
| `caldwell-conversion-uppercut` / "Caldwell Conversion Uppercut" | Uppercut | `/wiki/Weapons/Uppercut` |
| `caldwell-pax` / "Caldwell Pax" | Pax | `/wiki/Weapons/Pax` |
| `caldwell-rival-78` / "Caldwell Rival 78" | Rival 78 | `/wiki/Weapons/Rival_78` |
| `crown-king-auto-5` / "Crown & King Auto-5" | Auto-5 | `/wiki/Weapons/Auto-5` |
| `krag-m1894` / "Krag M1894" | Krag | `/wiki/Weapons/Krag` |
| `lemat-mark-ii` / "LeMat Mark II" | LeMat | `/wiki/Weapons/LeMat` |
| `martini-henry-ic1` / "Martini-Henry IC1" | Martini-Henry | `/wiki/Weapons/Martini-Henry` |
| `mosin-nagant-m1891` / "Mosin-Nagant M1891" | Mosin-Nagant | `/wiki/Weapons/Mosin-Nagant` |
| `nagant-officer-carbine` / "Nagant Officer Carbine" | Officer Carbine | `/wiki/Weapons/Officer/Carbine` |
| `scottfield-model-3` / "Scottfield Model 3" | Scottfield | `/wiki/Weapons/Scottfield` |
| `sparks-lrr` / "Sparks LRR" | Sparks | `/wiki/Weapons/Sparks` |
| `vetterli-71-karabiner` / "Vetterli 71 Karabiner" | Vetterli 71 | `/wiki/Weapons/Vetterli_71` |
| `winfield-1876-centennial` / "Winfield 1876 Centennial" | Centennial | `/wiki/Weapons/Centennial` |

**Scraper note for all of 1B:** these are *not* MediaWiki redirects the crawler can follow —
the app's names are not wiki page titles at all, so a naive `Weapons/{name}` resolution 404s.
The override table is mandatory, not an optimization. Two further wrinkles:

- `sparks-pistol` and `mosin-nagant-avtomat` resolve to **subpages** of a renamed parent
  (`/wiki/Weapons/Sparks/Pistol`, `/wiki/Weapons/Mosin-Nagant/Avtomat`) — a flat display name
  can never express these.
- `nagant-officer-carbine` resolves under a family base (`Officer`) that the catalog does not
  contain at all.
- `/wiki/Weapons/Winfield_M1873` and `/wiki/Weapons/Winfield_M1873C` should be probed once so
  the pipeline records whether they 404 or redirect; if they redirect, wire the redirect map
  and drop the special-casing.

---

## List 2: Weapons Missing From the App That Should Exist

**Scale check: the wiki's `Category:Weapons` reports 146 pages. The app has 39 rows, two of
which are invalid. The app is tracking roughly a quarter of the arsenal.**

The single most important instruction in this document: **do not seed the crawler from the
table below.** Seed it from `/wiki/Category:Weapons` (paginated, 146 members) and diff against
the catalog. The table is a verified starting subset for prioritization, not a complete
inventory — it is assembled from search results, and the ~30 pages it does not name are
precisely the ones a hand-written list would miss.

### 2A — Missing base weapons

| Weapon name | Wiki page path | Category | Variant of | Why missing | Key stats to scrape |
|---|---|---|---|---|---|
| Ranger 73 | `/wiki/Weapons/Ranger_73` | Size 3, Compact, Rifle | N/A | Renamed from Winfield M1873 — see List 1A | damage, muzzle velocity, effective range, rate of fire, cycle time, ammo pool, reload speed, spread, sway, recoil, melee/heavy melee, cost, size |
| Vandal 73C | `/wiki/Weapons/Vandal_73C` | Compact rifle `[VERIFY size]` | N/A (own family base — "shortened Frontier 73C") | Never tracked | as above |
| Terminus | `/wiki/Weapons/Terminus` | Shotgun `[VERIFY size]` | N/A | Never tracked | + pellet count, pellet spread, shell capacity |
| Homestead 78 | `/wiki/Weapons/Homestead_78` `[VERIFY path]` | Shotgun | N/A `[VERIFY — may be Rival 78 family]` | Never tracked | + pellet count, pellet spread |
| Marathon | `/wiki/Weapons/Marathon` | Compact pump-action rifle. Wiki quotes cost **68**, size **4** `[VERIFY size — 4 looks high for a Compact rifle]`, added Update 1.16 | N/A | Never tracked | damage 113, drop range 140, RoF 31, cycle 1, spread 15, sway 77, vertical recoil 7, reload 19.2, muzzle velocity 430, ammo 15+1 / 24 reserve — **all `[VERIFY]`, quoted from a search snippet** |
| New Army | `/wiki/Weapons/New_Army` | Compact double-action revolver | N/A | Never tracked | full pistol stat block |
| Officer | `/wiki/Weapons/Officer` | Compact revolver | N/A — **family base of the app's `nagant-officer-carbine`** | Never tracked; app has only the Carbine subpage | full pistol stat block |
| 1865 Carbine | `/wiki/Weapons/1865_Carbine` | Specter Arms repeating rifle | N/A | Never tracked | full rifle stat block |
| Maynard Sniper | `/wiki/Weapons/Maynard_Sniper` `[VERIFY — may be /wiki/Weapons/Maynard/Sniper with a Maynard base]` | Medium ammo scoped rifle, added Update 2.1 | `[VERIFY]` | Added after the catalog was last extended | + scope zoom, two-stage reload timing |
| Bomb Launcher | `/wiki/Weapons/Bomb_Launcher` | Special, large slot | N/A — **family base; Bomb Lance became its unlock in Update 2.1** | Reclassification not tracked | projectile damage, blast radius, ammo pool, reload |
| Mosin Obrez | `/wiki/Weapons/Mosin_Obrez` | Special Long. Wiki quotes cost **290**, size **2** `[VERIFY]` | N/A — **top-level family page, NOT a Mosin-Nagant subpage** | Never tracked | full rifle stat block |
| Machete | `/wiki/Weapons/Machete` | Melee, small slot | N/A | Never tracked | light/heavy melee damage, stamina cost per heavy (wiki: 5 heavies), range, swing speed |
| Katana | `/wiki/Weapons/Katana` | Melee, 2 slots | N/A | **Present in app as a TOOL, not a weapon** (`TOOLS`, cost 100). `scrape-images.mjs` already cross-maps it to the Weapons namespace. | light/heavy melee damage, sheathed first-strike bonus, stamina |
| Chu Ko Nu | `/wiki/Weapons/Chu_Ko_Nu` `[VERIFY path]` | Hand-crossbow family, special ammo | `[VERIFY — sibling or variant of Hand Crossbow]` | Never tracked | bolt damage, velocity, magazine, reload, retrievable-bolt flag |
| Talon | `[VERIFY — ambiguous]` | Melee `[VERIFY]` | `[VERIFY]` | Never tracked | **Do not add without resolving.** "Talon" is both a standalone melee weapon and a variant suffix on at least four families (Romero 77, Ranger 73, Lebel 1886). Resolve the bare `Talon` page before creating any row. |

**Explicitly excluded — do not add to the catalog:**

| Weapon | Wiki page path | Why excluded |
|---|---|---|
| Maxim | `/wiki/Weapons/Maxim` `[VERIFY path]` | Update 2.8 **world weapon**, found only at the Road to Hell Stronghold. Cannot be bought, extracted, or carried in a loadout, and slows the hunter 25%. It has no cost and no slot size, so it cannot participate in budget math. The scraper should recognize world weapons and skip them — expect more of these. |

### 2B — Missing variants

**Every variant in the game is missing**, except the three the catalog accidentally models as
base weapons. Variants are separate wiki pages under `/wiki/Weapons/{Family}/{Variant}` and
carry their own cost, size, and full stat block.

All paths below appeared as wiki URLs in search results unless marked `[VERIFY]`. "Category"
is the family's; per-variant size/cost must come from the scrape. Key stats to scrape are the
same full block as the base weapon in every case, **plus** the variant's differentiator
(scope zoom for Marksman/Deadeye/Sniper/Sharpeye; silenced audio range for Silencer; melee and
heavy-melee damage for Bayonet/Talon/Riposte/Hatchet/Mace/Striker/Claw; reload speed for
Swift/Alamo; capacity for Extended/Drum; rate of fire for Spitfire/Cyclone).

| Family (base) | Missing variant pages |
|---|---|
| 1865 Carbine | `/wiki/Weapons/1865_Carbine/Aperture`, `/Silencer` |
| Berthier 1892 | `/wiki/Weapons/Berthier_1892/Deadeye`, `/Marksman`, `/Riposte` |
| Bornheim No. 3 | `/wiki/Weapons/Bornheim_No._3/Extended` (wiki cost **203** `[VERIFY]`), `/Match` (**180** `[VERIFY]`), `/Silencer` |
| Centennial | `/wiki/Weapons/Centennial/Pointman`, `/Shorty`, `/Shorty_Silencer` |
| Crossbow | `/wiki/Weapons/Crossbow/Deadeye` |
| Dolch 96 | `/wiki/Weapons/Dolch_96/Precision`, `/Claw` |
| Frontier 73C | `/wiki/Weapons/Frontier_73C/Marksman`, `/Silencer` |
| Krag | `/wiki/Weapons/Krag/Bayonet`, `/Silencer`, `/Sniper` (wiki cost **517**, size **4** `[VERIFY]`) |
| Lebel 1886 | `/wiki/Weapons/Lebel_1886/Aperture`, `/Marksman`, `/Talon` |
| LeMat | `/wiki/Weapons/LeMat/Carbine`, `/Carbine_Marksman` `[VERIFY slug]`, `/Uppermat` `[VERIFY]` |
| Marathon | `/wiki/Weapons/Marathon/Swift` |
| Martini-Henry | `/wiki/Weapons/Martini-Henry/Deadeye`, `/Marksman` `[VERIFY]`, `/Riposte` `[VERIFY]` |
| Mosin Obrez | `/wiki/Weapons/Mosin_Obrez/Extended` (wiki cost **350**, size **2** `[VERIFY]`), `/Mace`, `/Match`, `/Sharpeye` |
| Mosin-Nagant | `/wiki/Weapons/Mosin-Nagant/Bayonet`, `/Sniper` — (`/Avtomat` already in catalog) |
| Nagant M1895 | `/wiki/Weapons/Nagant_M1895/Deadeye`, `/Precision`, `/Silencer` |
| New Army | `/wiki/Weapons/New_Army/Swift` |
| Officer | `/wiki/Weapons/Officer/Carbine_Deadeye` — (`/Carbine` already in catalog) |
| Pax | `/wiki/Weapons/Pax/Trueshot` `[VERIFY slug]` |
| Ranger 73 | `/wiki/Weapons/Ranger_73/Aperture`, `/Swift`, `/Talon` |
| Rival 78 | `/wiki/Weapons/Rival_78/Trauma` `[VERIFY slug]`, `/Handcannon` `[VERIFY slug]` |
| Romero 77 | `/wiki/Weapons/Romero_77/Alamo`, `/Handcannon`, `/Hatchet`, `/Shorty`, `/Talon` |
| Scottfield | `/wiki/Weapons/Scottfield/Brawler`, `/Precision`, `/Spitfire`, `/Swift` |
| Sparks | `/wiki/Weapons/Sparks/Silencer`, `/Sniper`, `/Pistol_Silencer` — (`/Pistol` already in catalog) |
| Specter 1882 | `/wiki/Weapons/Specter_1882/Shorty` `[VERIFY — a Bayonet variant may also exist]` |
| Springfield 1866 | `/wiki/Weapons/Springfield_1866/Bayonet`, `/Bullseye`, `/Compact`, `/Compact_Striker` `[VERIFY slug]`, `/Marksman`, `/Shorty`, `/Striker` |
| Uppercut | `/wiki/Weapons/Uppercut/Precision`, `/Deadeye`, `/Precision_Deadeye` `[VERIFY slug]` |
| Vandal 73C | `/wiki/Weapons/Vandal_73C/Striker` |
| Vetterli 71 | `/wiki/Weapons/Vetterli_71/Bayonet`, `/Cyclone`, `/Deadeye`, `/Marksman`, `/Silencer` |

**Families whose variants were not enumerated** — search did not surface their subpages, and
absence of evidence is not evidence of absence. Treat as `[VERIFY AGAINST LIVE WIKI]` and
resolve from `Category:Weapons`: **Auto-5, Drilling, Slate, Terminus, Homestead 78, Nitro
Express, Haymaker, 1890 Cavalry, Conversion, Hunting Bow, Hand Crossbow, Bomb Launcher /
Bomb Lance, Cavalry Saber, Combat Axe, Railroad Hammer, Machete, Katana, Maynard.**

### 2C — Ammo-type unlocks are NOT pages

Search surfaced strings like *"Caldwell Pax High Velocity Ammo (8th unlock)"*, *"Scottfield
Model 3 Dumdum Ammo"*, and *"Winfield M1876 Centennial Dumdum Ammo"*. These are **weapon-tree
unlock rows on the family page**, not standalone wiki pages, and they must not become catalog
rows — the app already models ammo as a shared per-class pool (`AMMO`).

They are, however, exactly the per-weapon ammo-compatibility data ADR-0005 flagged as *"may
not cleanly replace the existing `ammoClass` → `AMMO` pool model."* Scrape them into
`itemStats.json` as a per-weapon `availableAmmo` list; leave `ammoClass` alone for now.

---

## List 3: Weapons Present in the App with Incorrect or Outdated Data

**Structural caveat:** the catalog stores only `name`, `size`, `cost`, `ammoClass`, `group`.
Four of those five are comparable to the wiki (`group` is app-only). So this list can only
flag name/size/cost/ammo errors — *every* weapon is additionally missing its entire stat
block, which is List 3's largest finding and is stated once here rather than repeated 39 times.

### 3.0 — Applies to all 39 weapons

| Stat | App Value | Expected Wiki Value | Status |
|---|---|---|---|
| damage, muzzle velocity, effective/drop range, rate of fire, cycle time, spread, sway, vertical recoil, reload speed, ammo pool (loaded + reserve), melee damage, heavy melee damage, description | *(absent)* | present in every weapon infobox | **new field missing** |

**Confidence: HIGH.** This is the entire premise of ADR-0005; no verification needed.

### 3.1 — `bornheim-no-3` / "Bornheim No. 3"

- **File:** `client/src/data/catalog.js:68`
- **Wiki:** `/wiki/Weapons/Bornheim_No._3`

| Stat | App Value | Expected Wiki Value | Status |
|---|---|---|---|
| cost | `99` | `146` | changed |
| name | Bornheim No. 3 | Bornheim No. 3 | ok |
| size | `1` | `1` `[VERIFY]` | ok |
| ammoClass | `compact` | Compact | ok |

**Patch:** unknown; `[VERIFY]` — plausibly the Update 2.8 inventory/economy rework.
**Confidence: MEDIUM-HIGH.** The `146` figure was quoted from wiki content (alongside
Extended `203` / Match `180`, a self-consistent family ladder), but was not read from the
infobox directly.

### 3.2 — `mosin-nagant-m1891` / "Mosin-Nagant M1891"

- **File:** `client/src/data/catalog.js:97`
- **Wiki:** `/wiki/Weapons/Mosin-Nagant`

| Stat | App Value | Expected Wiki Value | Status |
|---|---|---|---|
| cost | `490` | `620` | changed |
| name | Mosin-Nagant M1891 | Mosin-Nagant | changed (see List 1B) |
| size | `4` | `4` | ok |
| ammoClass | `slong` | Special Long | ok |

**Patch:** unknown; `[VERIFY]`. **Confidence: MEDIUM-HIGH** on cost (quoted from wiki
content), **HIGH** on the rename (sitemap-verified in-repo).

### 3.3 — `frontier-73c` / "Frontier 73C" — ammo class contradiction

- **File:** `client/src/data/catalog.js:85`
- **Wiki:** `/wiki/Weapons/Frontier_73C`

| Stat | App Value | Expected Wiki Value | Status |
|---|---|---|---|
| ammoClass | `medium` | `compact` | changed |
| cost | `72` | `[VERIFY]` | verify |
| size | `3` | `[VERIFY]` | verify |

**This one is provable from the catalog alone.** `winfield-m1873c` (line 81) and
`frontier-73c` (line 85) are the same weapon under two names — and the catalog gives them
*different ammo classes*, `compact` and `medium` respectively. The wiki describes the
Frontier 73C as "a lightened Ranger 73", and the Ranger 73 is a Compact rifle, so `compact`
is correct and the `frontier-73c` row is wrong.

**Confidence: HIGH.** This is a live bug: the app currently offers Medium ammo variants for a
Compact-ammo weapon, so its ammo pricing is wrong in the budget math today.

### 3.4 — All 14 stale display names

Every row in **List 1B** is simultaneously a List 3 `name` discrepancy. Per ADR-0005, the fix
is a name-only write-through — id preserved.

**Confidence: HIGH** (sitemap-verified in `scripts/scrape-images.mjs`).

### 3.5 — `sparks-pistol` / "Sparks Pistol"

- **File:** `client/src/data/catalog.js:75`
- **Wiki:** `/wiki/Weapons/Sparks/Pistol`

| Stat | App Value | Expected Wiki Value | Status |
|---|---|---|---|
| size | `2` | `1` `[VERIFY]` | verify |
| cost | `100` | `[VERIFY]` | verify |

The Update 2.8 slot doc puts "pistols" at 1 slot and reserves 2 slots for "sawn-off rifles
and shotguns, pistols equipped with stocks, most dual-wielded pistol pairs, large pistols such
as the Uppercut and Dolch 96". The Sparks Pistol is a sawn-off rifle, which argues for 2 —
but it is also explicitly dual-wieldable, and the wiki does not make clear whether the listed
size is per-pistol or per-pair. **Confidence: LOW.** Flagged so the scraper resolves it, not
because it is likely wrong.

### 3.6 — Whole-table cost/size staleness after Update 2.8

| Stat | App Value | Expected Wiki Value | Status |
|---|---|---|---|
| `cost` (all 39) | as authored | `[VERIFY]` | verify |
| `size` (all 39) | as authored | `[VERIFY]` | verify |

Update 2.8 was an inventory and slot-size rework significant enough that *"weapons equipped on
existing hunters that would no longer fit due to the slot size changes will be unequipped."*
Two of the three costs spot-checked here (Bornheim, Mosin-Nagant) are already wrong, so the
prior should be that the cost column is broadly stale rather than mostly fine.

Countervailing evidence that the table is *not* wholesale garbage: `1890 Cavalry` is confirmed
by the wiki as "Size 3, single-shot Long ammo", which matches `["1890-cavalry", …, 3, 56,
"long", …]` exactly on size and ammo class; and the `size` column already uses 2.8's 1–5 scale.

**Confidence: MEDIUM** that a meaningful fraction of the cost column is stale; **LOW** on any
individual unverified row. This is the highest-value target for the first scrape run.

### 3.7 — `AMMO` variant price table

- **File:** `client/src/data/catalog.js:32-46`

Ten pools of `[variantName, price]` pairs, entirely hand-authored, with no recorded
verification date — unlike `TRAITS`, which carries an explicit "re-verified through Update
2.8.1" comment. The header comment asserting that Dolch 96 / Nitro Express custom ammo "has
been Scarce since Update 2.8 and can't be bought with Hunt Dollars" (hence `special: []`)
should be re-confirmed against 2.8.1 as well.

**Status: verify all.** **Confidence: LOW-MEDIUM** — no specific error identified, but this
table has no provenance at all and feeds the budget math directly.

### 3.8 — Not errors (checked, correct)

Recording these so a later pass does not re-investigate: `1890-cavalry` (size 3 / long ✓),
`haymaker` (LeMat-derived long-ammo pistol ✓), `hand-crossbow` (size 1 — the wiki confirms it
moved from medium to small slot ✓), `mosin-nagant-avtomat` and `nitro-express` (both present,
correctly on the 1–5 scale at size 5). Update 2.8's two headline catalog additions — Special
Long ammo and the 1890 Cavalry — are both already present. **The app is current on patch
*content*; it is stale on names, costs, and variants.**

---

## Scrape Targets Summary

Deduplicated, alphabetically sorted (case-insensitive), every unique wiki page path named in
Lists 1–3. **131 paths.** Seed the queue with the two index pages first — they supersede this
list and will surface the ~30 pages hand-enumeration missed.

**Index pages (crawl first):**

```
/wiki/Category:Weapons
/wiki/Weapons
```

**Weapon pages:**

```
/wiki/Weapons/1865_Carbine
/wiki/Weapons/1865_Carbine/Aperture
/wiki/Weapons/1865_Carbine/Silencer
/wiki/Weapons/1890_Cavalry
/wiki/Weapons/Auto-5
/wiki/Weapons/Berthier_1892
/wiki/Weapons/Berthier_1892/Deadeye
/wiki/Weapons/Berthier_1892/Marksman
/wiki/Weapons/Berthier_1892/Riposte
/wiki/Weapons/Bomb_Lance
/wiki/Weapons/Bomb_Launcher
/wiki/Weapons/Bornheim_No._3
/wiki/Weapons/Bornheim_No._3/Extended
/wiki/Weapons/Bornheim_No._3/Match
/wiki/Weapons/Bornheim_No._3/Silencer
/wiki/Weapons/Cavalry_Saber
/wiki/Weapons/Centennial
/wiki/Weapons/Centennial/Pointman
/wiki/Weapons/Centennial/Shorty
/wiki/Weapons/Centennial/Shorty_Silencer
/wiki/Weapons/Chu_Ko_Nu
/wiki/Weapons/Combat_Axe
/wiki/Weapons/Conversion
/wiki/Weapons/Crossbow
/wiki/Weapons/Crossbow/Deadeye
/wiki/Weapons/Dolch_96
/wiki/Weapons/Dolch_96/Claw
/wiki/Weapons/Dolch_96/Precision
/wiki/Weapons/Drilling
/wiki/Weapons/Frontier_73C
/wiki/Weapons/Frontier_73C/Marksman
/wiki/Weapons/Frontier_73C/Silencer
/wiki/Weapons/Hand_Crossbow
/wiki/Weapons/Haymaker
/wiki/Weapons/Homestead_78
/wiki/Weapons/Hunting_Bow
/wiki/Weapons/Katana
/wiki/Weapons/Krag
/wiki/Weapons/Krag/Bayonet
/wiki/Weapons/Krag/Silencer
/wiki/Weapons/Krag/Sniper
/wiki/Weapons/Lebel_1886
/wiki/Weapons/Lebel_1886/Aperture
/wiki/Weapons/Lebel_1886/Marksman
/wiki/Weapons/Lebel_1886/Talon
/wiki/Weapons/LeMat
/wiki/Weapons/LeMat/Carbine
/wiki/Weapons/LeMat/Carbine_Marksman
/wiki/Weapons/LeMat/Uppermat
/wiki/Weapons/Machete
/wiki/Weapons/Marathon
/wiki/Weapons/Marathon/Swift
/wiki/Weapons/Martini-Henry
/wiki/Weapons/Martini-Henry/Deadeye
/wiki/Weapons/Martini-Henry/Marksman
/wiki/Weapons/Martini-Henry/Riposte
/wiki/Weapons/Maxim
/wiki/Weapons/Maynard_Sniper
/wiki/Weapons/Mosin-Nagant
/wiki/Weapons/Mosin-Nagant/Avtomat
/wiki/Weapons/Mosin-Nagant/Bayonet
/wiki/Weapons/Mosin-Nagant/Sniper
/wiki/Weapons/Mosin_Obrez
/wiki/Weapons/Mosin_Obrez/Extended
/wiki/Weapons/Mosin_Obrez/Mace
/wiki/Weapons/Mosin_Obrez/Match
/wiki/Weapons/Mosin_Obrez/Sharpeye
/wiki/Weapons/Nagant_M1895
/wiki/Weapons/Nagant_M1895/Deadeye
/wiki/Weapons/Nagant_M1895/Precision
/wiki/Weapons/Nagant_M1895/Silencer
/wiki/Weapons/New_Army
/wiki/Weapons/New_Army/Swift
/wiki/Weapons/Nitro_Express
/wiki/Weapons/Officer
/wiki/Weapons/Officer/Carbine
/wiki/Weapons/Officer/Carbine_Deadeye
/wiki/Weapons/Pax
/wiki/Weapons/Pax/Trueshot
/wiki/Weapons/Railroad_Hammer
/wiki/Weapons/Ranger_73
/wiki/Weapons/Ranger_73/Aperture
/wiki/Weapons/Ranger_73/Swift
/wiki/Weapons/Ranger_73/Talon
/wiki/Weapons/Rival_78
/wiki/Weapons/Rival_78/Handcannon
/wiki/Weapons/Rival_78/Trauma
/wiki/Weapons/Romero_77
/wiki/Weapons/Romero_77/Alamo
/wiki/Weapons/Romero_77/Handcannon
/wiki/Weapons/Romero_77/Hatchet
/wiki/Weapons/Romero_77/Shorty
/wiki/Weapons/Romero_77/Talon
/wiki/Weapons/Scottfield
/wiki/Weapons/Scottfield/Brawler
/wiki/Weapons/Scottfield/Precision
/wiki/Weapons/Scottfield/Spitfire
/wiki/Weapons/Scottfield/Swift
/wiki/Weapons/Slate
/wiki/Weapons/Sparks
/wiki/Weapons/Sparks/Pistol
/wiki/Weapons/Sparks/Pistol_Silencer
/wiki/Weapons/Sparks/Silencer
/wiki/Weapons/Sparks/Sniper
/wiki/Weapons/Specter_1882
/wiki/Weapons/Specter_1882/Shorty
/wiki/Weapons/Springfield_1866
/wiki/Weapons/Springfield_1866/Bayonet
/wiki/Weapons/Springfield_1866/Bullseye
/wiki/Weapons/Springfield_1866/Compact
/wiki/Weapons/Springfield_1866/Compact_Striker
/wiki/Weapons/Springfield_1866/Marksman
/wiki/Weapons/Springfield_1866/Shorty
/wiki/Weapons/Springfield_1866/Striker
/wiki/Weapons/Terminus
/wiki/Weapons/Uppercut
/wiki/Weapons/Uppercut/Deadeye
/wiki/Weapons/Uppercut/Precision
/wiki/Weapons/Uppercut/Precision_Deadeye
/wiki/Weapons/Vandal_73C
/wiki/Weapons/Vandal_73C/Striker
/wiki/Weapons/Vetterli_71
/wiki/Weapons/Vetterli_71/Bayonet
/wiki/Weapons/Vetterli_71/Cyclone
/wiki/Weapons/Vetterli_71/Deadeye
/wiki/Weapons/Vetterli_71/Marksman
/wiki/Weapons/Vetterli_71/Silencer
/wiki/Weapons/Winfield_M1873
/wiki/Weapons/Winfield_M1873C
```

**Ancillary pages worth crawling** (not weapon pages; useful for cross-checks and for the
revision-diff baseline ADR-0005 wants):

```
/wiki/Ammo
/wiki/Category:Compact_Ammo          (35 members)
/wiki/Category:Long_Ammo
/wiki/Category:Medium_Ammo           (35 members)
/wiki/Category:Special_Long_Ammo
/wiki/Category:Weapons/Large_Slot
/wiki/Category:Weapons/Medium_Slot
/wiki/Category:Weapons/Small_Slot
/wiki/Update/2.8
/wiki/Update/2.8.1
/wiki/Updates
```

---

## Structural concerns for the scraper

These are the things that will break a naive crawler.

**1. Everything is namespaced.** Pages are `/wiki/Weapons/{Title}`, never `/wiki/{Title}`.
`scripts/scrape-images.mjs` already gets this right (`WIKI_CATEGORY`); `scrape-stats.mjs`
must inherit it from the shared `scripts/lib/wiki.mjs` rather than reimplementing it. ADR-0005
makes this non-negotiable: a second `slugify()` is a listed failure mode.

**2. Variants are subpages, and depth is not uniform.** `/wiki/Weapons/{Family}/{Variant}` is
the rule, but compound variants collapse into a single path segment with an underscore —
`Sparks/Pistol_Silencer`, `Centennial/Shorty_Silencer`, `Officer/Carbine_Deadeye`,
`Uppercut/Precision_Deadeye`. There is no `Sparks/Pistol/Silencer`. A parser that splits on
`/` to derive `variantOf` will mis-parent these; parent should be segment 2, always.

**3. Some "variants" are top-level families.** `Mosin_Obrez` is `/wiki/Weapons/Mosin_Obrez`
with its own children (`Extended`, `Mace`, `Match`, `Sharpeye`) — *not*
`/wiki/Weapons/Mosin-Nagant/Obrez`, despite being a Mosin. Likewise `Vandal_73C` and
`Frontier_73C` are peers of `Ranger_73`, not its children. **Family structure cannot be
inferred from URL shape or from the weapon's name.** Read it from the page's weapon-tree
section or accept a hand-maintained parent map.

**4. Hyphen vs. underscore is inconsistent.** `Mosin-Nagant` (hyphen, it's the name) but
`Mosin_Obrez` (underscore, it's a space). `Martini-Henry` hyphen. `Bornheim_No._3` contains a
literal period. `Auto-5` hyphen. URL-encoding by naive `replace(/\s+/g, "_")` is right, but
the *titles* must come from the category listing, never be reconstructed from a display name.

**5. The catalog's names are not wiki titles.** Fourteen of 39 rows need the override map
(List 1B). This is a permanent requirement, not a migration artifact — ADR-0005 forbids
re-slugging ids, so the catalog will carry pre-`1896` ids like `caldwell-pax` forever while
the wiki says `Pax`. Keep `WIKI_TITLE_OVERRIDES` keyed by **id**, not display name, or the
first name write-through will break every override in the table.

**6. Weapon-tree unlocks are page sections, not pages.** Ammo unlocks ("Pax High Velocity
Ammo", "Centennial Dumdum Ammo") and unlock-order numbering ("7th unlock in the LeMat Mark II
family") live in a tree table on the family page. Do not mistake them for variant pages, and
do not create catalog rows from them.

**7. Not every weapon page is a buyable item.** The Maxim is a world weapon with no cost and
no slot size. ADR-0005's range assertions (`cost > 0`, `size ∈ 1..5`) would reject it as a
parse failure — but it is not a failure, it is a category. Classify and skip explicitly, or
the run summary fills with false errors after every event patch.

**8. Stats live in the infobox, prose does not.** Numeric stats are infobox fields; the
description, historical background, and recommended-traits sections are body prose further
down the page. Two different extractors. Recommended traits are wiki-editorial, not game data
— do not persist them as if they were.

**9. The sitemap lags.** `scrape-images.mjs` already warns that the sitemap trails live edits
by months. For a *new* weapon (the highest-value case) the sitemap is the least reliable
source. Prefer `Category:Weapons` for discovery and reserve the sitemap for bulk path
verification, exactly as the existing header describes.

**10. Two catalog rows resolve to one wiki page — and one page has no row.** The
`winfield-m1873c` / `frontier-73c` duplicate (List 1A) means an id→path map is not injective
today. Resolve the duplicate *before* the first stats run, or `itemStats.json` will carry two
keys with identical scraped content and the ADR-0005 confirmation check ("every key resolves
to a real item") will pass while the data is quietly wrong.

**11. Cross-category items exist.** The Katana is a Tool in the catalog and a Weapon on the
wiki. `WIKI_TITLE_OVERRIDES` already encodes this by storing paths that include the category
segment. Preserve that property — it is the only reason the Katana resolves at all.

**12. Adding List 2 needs a schema change first.** The tuple `[id, name, size, cost,
ammoClass, group]` has nowhere to record `variantOf`, and `group` has no wiki source. Landing
~100 variants as flat rows would triple the picker's length with no way to collapse families.
Sequence the work: schema → parent map → bulk import. Not import-first.

---

## Recommended sequencing

1. **Fix the two provable bugs now, by hand, no scrape needed** — delete `winfield-m1873c`
   (duplicate), and correct `frontier-73c`'s `ammoClass` to `compact`. The second is a live
   budget-math error. Also correct the wrong comment in
   `scripts/scrape-images.mjs` `KNOWN_CATALOG_DUPLICATES` about "Ranger 73".
2. **Extract `scripts/lib/wiki.mjs`** — ADR-0005 states this is a prerequisite, not a
   follow-up.
3. **Crawl `Category:Weapons` and diff against the catalog.** Publish the delta. This
   supersedes List 2 with a complete, machine-generated inventory.
4. **Run `scrape-stats.mjs` in additive mode** (no `--write-catalog`) to seed
   `itemStats.json` with provenance, and review the proposed cost/name diffs as a `git diff`
   before applying — the guardrail ADR-0005 specifies precisely because a wrong cost is
   invisible in the UI.
5. **Then** design the variant schema and import List 2.
