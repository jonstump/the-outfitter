// Game data ported from the original Loadout Builder prototype.
// Weapon tuple shape: [id, name, size, cost, ammoClass, group]
// Tool tuple shape: [id, name, cost, group]
// Consumable tuple shape: [id, name, cost, category, group]
// Trait tuple shape: [id, name, up, group]
//
// `id` is a stable, slug-style identifier, unique within its category and never
// reused after removal. The wire format (loadoutCodec.js), localStorage, saved
// loadout records, and share URLs all reference items by `id` rather than by
// array position, so reordering/inserting/removing entries here never silently
// remaps an existing saved loadout to a different item.
//
// Governing: ADR-0002 (Source Weapon/Equipment Images from huntshowdown.wiki.gg via a One-Time, Self-Hosted Scrape)
// Implements: SPEC-0001 REQ "Image Coverage Across All Catalog Categories, with Fallback"
//
// Image resolution model: scraped photos are primary, the SVG icons below (THUMBS/TOOL_THUMBS/
// TRAIT_THUMBS/CONS_THUMBS + their *Thumb() dispatch functions) are the fallback safety net for
// any item that hasn't been scraped yet (or ever, e.g. brand-new DLC). Each dispatch function
// checks a per-item override map first, then falls back to the item's group icon — the per-item
// maps are empty today (no per-item SVGs are authored yet) but the two-tier lookup is structured
// so per-item icons can be dropped in later without touching any call site.
//
// The scraped-image side of the lookup (see slugify() and the <img onError> chain in
// client/src/components/ItemThumb/ItemThumb.jsx) does not use a hardcoded IMAGES manifest keyed
// by item name (the literal mechanism design.md sketches). Instead it derives the expected
// `/images/{category}/{slug}.{ext}` URL from the item's name and tries known extensions via
// <img onError>, falling back to the SVG icon only once every extension has failed. This avoids
// needing to hand-maintain (or regenerate) a manifest of which items have been scraped — the
// scrape script (issue #7) can add/replace image files under client/public/images/ without any
// catalog.js change being required to pick them up.

// WIRE-FORMAT GATE — read before editing any pool below.
//
// A saved ammo selection persists as a BARE INDEX into AMMO[ammoClass] (loadoutCodec.js writes it,
// calc.js reads it back). So inserting, removing, or reordering a variant inside a pool silently
// re-points every saved selection in that class: a loadout that stored "index 2" keeps storing 2
// and starts meaning a different round. Nothing errors, and the cost line just changes.
//
// Any such edit therefore needs a FORMAT_VERSION bump and a saved-selection migration, on the same
// terms already required for changing a weapon's `ammoClass`. Appending to the END of a pool is the
// one safe edit, because it cannot move an existing index.
//
// This table is also NEVER written by a scrape (SPEC-0007 REQ "Fields the Scraper Must Not Derive"):
// the wiki has no per-pool source page — /wiki/Ammo is prose, and prices are stated per weapon
// inside each weapon's own progression table, not per class.
export const AMMO = {
  compact: [["FMJ", 15], ["High Velocity", 13], ["Dumdum", 22], ["Incendiary", 18], ["Poison", 16]],
  medium: [["FMJ", 22], ["Spitzer", 60], ["Dumdum", 28], ["Incendiary", 24], ["Poison", 21]],
  long: [["FMJ", 30], ["Spitzer", 75], ["Dumdum", 34], ["Incendiary", 28]],
  slong: [["FMJ", 35], ["Spitzer", 90], ["Incendiary", 32]],
  shotgun: [["Slug", 28], ["Flechette", 26], ["Penny Shot", 22], ["Dragon Breath", 30], ["Starshell", 18]],
  xbow: [["Explosive Bolt", 40], ["Shot Bolt", 30], ["Poison Bolt", 25]],
  hxbow: [["Chaos Bolt", 20], ["Concertina Bolt", 35], ["Choke Bolt", 25]],
  bow: [["Frag Arrow", 45], ["Concertina Arrow", 35], ["Poison Arrow", 25]],
  // "Special" pool, empty by fact rather than by omission. Six weapons draw from it as of #233 —
  // Dolch 96, Nitro Express, Bomb Launcher, Chu Ko Nu, Flame Rifle and Shredder — and none of their
  // custom rounds can be bought with Hunt Dollars, so there is nothing purchasable to list.
  //
  // The Dolch's and Nitro's ammo (Dumdum / Explosive / Shredder) has been Scarce since Update 2.8.
  // The four added by #233 are the same shape: each page states an ammo type the game does not sell
  // per-variant. Chu Ko Nu is the one worth flagging — its infobox says "Special" while its prose
  // says "fires Compact Bolts", and the infobox is what this pool follows, because offering it the
  // `xbow` pool's three bolts would price rounds the wiki does not list for it.
  special: [],
  none: [],
};

export const AMMO_LABEL = {
  compact: "Compact ammo",
  medium: "Medium ammo",
  long: "Long ammo",
  slong: "Special Long ammo",
  shotgun: "Shotgun",
  xbow: "Crossbow",
  hxbow: "Hand crossbow",
  bow: "Bow",
  special: "Special ammo",
  none: "Melee",
};

// Stable IDs for existing weapons, derived from the item name (see the buildSlug helper at the
// bottom of this file). IDs are preserved across reorders — the symbolic id below (QM) is
// resolved against these IDs, not against array positions.
//
// MACHINE-MAINTAINED COLUMNS (SPEC-0007 REQ "Catalog Write-Through Is Bounded, Reviewable, and
// Opt-In"). `size` and `cost` here — and `cost` in TOOLS and CONS, `up` in TRAITS — are reconciled
// from client/src/data/itemStats.json by `scrape-stats.mjs --write-catalog`. The wiki is
// authoritative for them per ADR-0005, so a hand-edit to one of those numbers is reverted by the
// next write-through run without anyone noticing. Correct the wiki, or re-run the scrape.
//
// Everything else in these tuples IS hand-authored and is never written by a scrape: `id`, the
// display `name` (it feeds slugify() and therefore the on-disk image path), `ammoClass` (a saved
// ammo selection is a bare index into that pool), and `group`. The AMMO table below is likewise
// never scraped — see the note beside it.
//
// The two are pinned against each other by itemStats.test.js, which fails if any machine-maintained
// column drifts from the dataset. Rows the dataset does not cover are skipped, not failed.
export const WEAPONS = [
  ["nagant-m1895", "Nagant M1895", 1, 24, "compact", "Pistols"],
  // Governing: issue #355. Wiki confirms AmmoType: Compact for both Conversion variants.
  ["caldwell-conversion-pistol", "Conversion", 1, 55, "compact", "Pistols"],
  ["scottfield-model-3", "Scottfield", 1, 77, "medium", "Pistols"],
  ["bornheim-no-3", "Bornheim No. 3", 1, 146, "compact", "Pistols"],
  ["caldwell-pax", "Pax", 1, 80, "medium", "Pistols"],
  ["hand-crossbow", "Hand Crossbow", 1, 30, "hxbow", "Bows"],
  ["cavalry-saber", "Cavalry Saber", 1, 50, "none", "Melee"],
  ["combat-axe", "Combat Axe", 2, 40, "none", "Melee"],
  ["railroad-hammer", "Railroad Hammer", 2, 45, "none", "Melee"],
  ["lemat-mark-ii", "LeMat", 1, 83, "compact", "Pistols"],
  ["sparks-pistol", "Sparks Pistol", 1, 155, "long", "Pistols"],
  ["caldwell-conversion-uppercut", "Uppercut", 2, 310, "long", "Pistols"],
  ["nagant-officer-carbine", "Officer Carbine", 3, 183, "compact", "Rifles"],
  ["hunting-bow", "Hunting Bow", 3, 57, "bow", "Bows"],
  ["dolch-96", "Dolch 96", 2, 690, "special", "Pistols"],
  ["springfield-1866", "Springfield 1866", 4, 38, "medium", "Rifles"],
  ["winfield-m1873", "Ranger 73", 4, 75, "compact", "Rifles"],
  ["romero-77", "Romero 77", 4, 66, "shotgun", "Shotguns"],
  ["crossbow", "Crossbow", 4, 50, "xbow", "Bows"],
  // Compact, not medium: this entry and "Winfield M1873C" above are the same weapon under its
  // post- and pre-1896 names, and they disagreed on ammo class. The wiki describes the Frontier
  // 73C as a lightened Ranger 73 (a Compact rifle), so "medium" was wrong and was pricing this
  // weapon's ammo out of the wrong AMMO pool. See docs/audits/weapon-catalog-wiki-audit.md.
  //
  // Known one-time cost of this correction (PR #116 review): a weapon's selected ammo is
  // persisted as a bare INDEX into AMMO[ammoClass] (loadoutCodec.js `w.a`, read back by
  // calc.js's `AMMO[WEAPONS[w.i][4]][w.a][1]`), not as an ammo id. AMMO.medium and AMMO.compact
  // are both length 5, so no bounds check trips — an already-saved loadout with this weapon and
  // an ammo variant selected silently re-resolves to the same index in the other pool. Index 1
  // is the worst case: Spitzer ($60) becomes High Velocity ($13). Accepted rather than migrated,
  // because it needs a FORMAT_VERSION bump to fix properly and the affected set is loadouts that
  // both use this weapon and picked a non-default ammo. Changing ANY weapon's ammoClass has this
  // shape — see ADR-0005's amendment, since the scraper is allowed to write ammoClass through.
  ["frontier-73c", "Frontier 73C", 3, 41, "compact", "Rifles"],
  ["bomb-lance", "Bomb Lance", 3, 199, "none", "Melee"],
  ["caldwell-rival-78", "Rival 78", 4, 170, "shotgun", "Shotguns"],
  ["vetterli-71-karabiner", "Vetterli 71", 3, 105, "medium", "Rifles"],
  ["specter-1882", "Specter 1882", 4, 188, "shotgun", "Shotguns"],
  ["slate", "Slate", 4, 313, "shotgun", "Shotguns"],
  ["sparks-lrr", "Sparks", 4, 130, "long", "Rifles"],
  ["martini-henry-ic1", "Martini-Henry", 4, 122, "long", "Rifles"],
  ["winfield-1876-centennial", "Centennial", 4, 157, "medium", "Rifles"],
  ["berthier-1892", "Berthier 1892", 3, 380, "slong", "Rifles"],
  ["drilling", "Drilling", 4, 510, "shotgun", "Shotguns"],
  ["krag-m1894", "Krag", 4, 450, "slong", "Rifles"],
  ["mosin-nagant-m1891", "Mosin-Nagant", 4, 620, "slong", "Rifles"],
  ["lebel-1886", "Lebel 1886", 4, 397, "slong", "Rifles"],
  ["crown-king-auto-5", "Auto-5", 5, 600, "shotgun", "Shotguns"],
  ["mosin-nagant-avtomat", "Mosin-Nagant Avtomat", 5, 1250, "slong", "Rifles"],
  ["nitro-express", "Nitro Express", 5, 1015, "special", "Rifles"],
  // Update 2.8 additions — appended (never inserted) so legacy index-based
  // encodings keep resolving to the same items they did before (issue #35/#36).
  ["haymaker", "Haymaker", 2, 279, "long", "Pistols"],
  ["1890-cavalry", "1890 Cavalry", 3, 56, "long", "Rifles"],

  // ---------------------------------------------------------------------------
  // Appended 2026-08-12 (#233), never inserted — same reason as the Update 2.8 block above.
  //
  // `Category:Weapons` listed 20 base pages the catalog did not model. These are 19 of them; the
  // Katana is the twentieth and follows immediately below, moved out of TOOLS by #156 — moving an
  // existing row between arrays changes what a saved `{t:"T", i:n}` resolves to, so it needed a
  // decoder migration rather than an addition.
  //
  // `size` and `cost` are read from each page, never guessed: `capUsed` reads position 2 for the
  // size budget, so a wrong size corrupts loadout arithmetic exactly the way a wrong price does.
  // `ammoClass` and `group` are hand-authored per this file's header — the wiki states an ammo TYPE
  // ("Medium", "Shells", "Special Long"), not one of our pool keys, and states no group at all.
  //
  // Group came from each page's own description where it names the class outright — "repeating
  // rifle", "semi-automatic shotgun", "double-action revolver", "Repeating Crossbow". Two did not:
  // the Bomb Launcher ("compact launcher fires spring-loaded projectiles") and the Shredder
  // ("Experimental weapon that shoots sawblades") are neither pistol, rifle, shotgun, melee, nor
  // bow. Both are filed as Rifles because they are shouldered long guns, which is the least wrong
  // of five options rather than a good one. A sixth WEAPON_GROUPS entry is the alternative and would
  // touch the picker's group filter.

  // Purchasable.
  ["1865-carbine", "1865 Carbine", 3, 70, "medium", "Rifles"],
  ["auto-4-shorty", "Auto-4 Shorty", 3, 300, "shotgun", "Shotguns"],
  ["baseball-bat", "Baseball Bat", 1, 40, "none", "Melee"],
  ["bomb-launcher", "Bomb Launcher", 2, 110, "special", "Rifles"],
  ["chu-ko-nu", "Chu Ko Nu", 2, 75, "special", "Bows"],
  ["infantry-73l", "Infantry 73L", 4, 78, "compact", "Rifles"],
  ["machete", "Machete", 1, 30, "none", "Melee"],
  ["mako-1895", "Mako 1895", 4, 360, "long", "Rifles"],
  ["marathon", "Marathon", 4, 68, "compact", "Rifles"],
  ["maynard-sniper", "Maynard Sniper", 4, 139, "medium", "Rifles"],
  ["mosin-obrez", "Mosin Obrez", 2, 290, "slong", "Rifles"],
  ["new-army", "New Army", 1, 90, "compact", "Pistols"],
  ["officer", "Officer", 1, 96, "compact", "Pistols"],
  ["terminus", "Terminus", 4, 168, "shotgun", "Shotguns"],
  ["vandal-73c", "Vandal 73C", 2, 35, "compact", "Rifles"],

  // Scarce. Cost 0 per ADR-0013 — obtainable only from a match, sellable but never buyable, so they
  // have no purchase value. Each page states `Price: "Scarce"`, which the strict parser refuses and
  // records as `purchasable: false`; the 0 here is authored by a human applying that decision, and
  // `itemStats.test.js` asserts the pairing in both directions.
  ["flame-rifle", "Flame Rifle", 2, 0, "special", "Rifles"],
  ["homestead-78", "Homestead 78", 4, 0, "shotgun", "Shotguns"],
  ["shredder", "Shredder", 4, 0, "special", "Rifles"],
  ["wildland", "Wildland", 4, 0, "medium", "Rifles"],

  // ---------------------------------------------------------------------------
  // Moved out of TOOLS 2026-08-12 (#156) — the twentieth base page from the block above, arriving as
  // a move rather than an addition. The wiki files it at /wiki/Weapons/Katana as a two-handed melee
  // weapon — "Two-handed, single-edged sword" — and modelling it as a Tool was a live budget error in
  // both directions: it cost none of capMax()'s weapon size while consuming one of the eight
  // equipment cells it should never touch.
  //
  // Size 2, and the wiki's history is chronological rather than contradictory: Update 1.16 reduced it
  // "from Medium Slot to Small Slot", then Update 2.8 changed it "from Small to 2". The infobox and
  // Category:Weapons/Size 2 both agree with the later change, so 2 is current. #156 flagged this as
  // an inconsistency the scraper would have to resolve; it is simply a sequence.
  //
  // Appended, so no existing weapon index moves. The saved-loadout migration this needs lives in
  // loadoutCodec.js — see PROMOTED_TO_WEAPON, which covers both the current format's ["T","katana"]
  // and LEGACY_TOOL_IDS[6].
  ["katana", "Katana", 2, 115, "none", "Melee"],

  // ---------------------------------------------------------------------------
  // Appended 2026-08-12 (#254), never inserted — same reason as every block above.
  //
  // The 89 weapon VARIANTS `Category:Weapons` lists as subpages (`Weapons/{Family}/{Variant}`):
  // Dolch 96 Claw, Centennial Shorty, Springfield 1866 Bayonet, and so on. Each is a separately
  // purchasable weapon with its own price and its own slot size, so each is an ordinary row. The
  // catalog already carried three of them — `sparks-pistol`, `nagant-officer-carbine` and
  // `mosin-nagant-avtomat` — and this is that same shape 89 more times.
  //
  // No `variantOf` field, and no family/parent relationship is modelled. SPEC-0007's non-goals and
  // ADR-0005 both said a variant needed one before it could be imported; it does not. Nothing in the
  // app relates one weapon to another, and the picker lists weapons. The real cost the ADR was
  // pointing at is picker LENGTH — see the WEAPON_GROUPS note below.
  //
  // `size` and `cost` are each variant's OWN scraped values, never the parent's: a Shorty is
  // smaller and cheaper than the gun it is cut down from, and `capUsed` reads position 2 for the
  // size budget. Range-asserted on the way in — size within 1..5, cost > 0.
  //
  // `ammoClass` is INHERITED from the parent row, and that is evidenced rather than assumed: all 89
  // variants' wiki `AmmoType` equals their parent's, checked against itemStats.json before these
  // rows were written. It is not read off the wiki directly because `AmmoType` is not one of our
  // pool keys and does not map onto them 1:1 — the wiki's "Special" covers `hxbow`, `bow`, `xbow`,
  // `special` AND `none` across existing rows, and "Medium" covers both `medium` and `shotgun`
  // (the Drilling). A direct mapping would produce a well-formed wrong value on exactly the rows
  // whose ammo is unusual.
  //
  // `group` is hand-assigned from the variant's TRUE parent — the longest matching path prefix, not
  // the base family. The distinction is load-bearing and got this wrong on the first pass: the true
  // parent of `Sparks/Pistol_Silencer` is `Sparks/Pistol` (a pistol), NOT `Sparks` (the LRR rifle),
  // and taking the family would have filed a pistol under Rifles. Four rows were wrong that way.
  //
  // Three variants change weapon class outright, so no parent states the answer and each is assigned
  // by hand: `sparks-pistol` (a pistol cut from a rifle) and `nagant-officer-carbine` (a carbine on a
  // revolver) both predate this block, and `lemat-carbine` is the same case — a shouldered long gun
  // built on a LeMat revolver, size 3, filed as Rifles on the Officer Carbine's precedent.
  // `lemat-carbine-marksman` then inherits Rifles from it through the prefix rule.
  //
  // SPEC-0007 REQ "Fields the Scraper Must Not Derive" forbids a scrape supplying `group`, and the
  // weapon infobox has no class field to supply it from — checked, not assumed. A human applying
  // "a variant is filed where its true parent is" is not a derivation, and all 35 variant families
  // have a parent row in this file, so no group was invented.
  //
  // Every row also needs a `WIKI_TITLE_OVERRIDES.weapons` entry in scripts/lib/wiki.mjs:
  // `resolveWikiPath` builds `Weapons/{DisplayName}`, and these pages live two segments deep.
  //
  // These land with their images already committed (`scripts/scrape-images.mjs`, ADR-0002), so no row
  // falls back to ItemThumb's SVG icon and weapon image coverage is 147/147. ADR-0002 records asset
  // weight as its own explicit downside, so the cost is stated rather than left to be discovered:
  // this block takes client/public/images/weapons from 58 files / 924 KB to 147 / 2409 KB (+161%),
  // against a whole image tree of 5.44 MB.
  //
  // WEAPON_GROUPS now buckets 147 weapons into five, and Rifles holds 80 of them. That is #248, and
  // this block is what makes it load-bearing rather than cosmetic.

  ["1865-carbine-aperture", "1865 Carbine Aperture", 3, 74, "medium", "Rifles"],
  ["1865-carbine-silencer", "1865 Carbine Silencer", 3, 80, "medium", "Rifles"],
  ["berthier-1892-deadeye", "Berthier 1892 Deadeye", 3, 397, "slong", "Rifles"],
  ["berthier-1892-marksman", "Berthier 1892 Marksman", 3, 413, "slong", "Rifles"],
  ["berthier-1892-riposte", "Berthier 1892 Riposte", 3, 390, "slong", "Rifles"],
  ["bornheim-no-3-extended", "Bornheim No. 3 Extended", 1, 203, "compact", "Pistols"],
  ["bornheim-no-3-match", "Bornheim No. 3 Match", 2, 180, "compact", "Pistols"],
  ["bornheim-no-3-silencer", "Bornheim No. 3 Silencer", 1, 174, "compact", "Pistols"],
  ["centennial-pointman", "Centennial Pointman", 2, 114, "medium", "Rifles"],
  ["centennial-shorty", "Centennial Shorty", 2, 103, "medium", "Rifles"],
  ["centennial-shorty-silencer", "Centennial Shorty Silencer", 2, 137, "medium", "Rifles"],
  ["centennial-sniper", "Centennial Sniper", 4, 181, "medium", "Rifles"],
  ["centennial-trauma", "Centennial Trauma", 4, 167, "medium", "Rifles"],
  ["conversion-chain-pistol", "Conversion Chain Pistol", 1, 84, "compact", "Pistols"],
  ["crossbow-deadeye", "Crossbow Deadeye", 4, 53, "xbow", "Bows"],
  ["dolch-96-bullseye", "Dolch 96 Bullseye", 2, 725, "special", "Pistols"],
  ["dolch-96-claw", "Dolch 96 Claw", 2, 700, "special", "Pistols"],
  ["dolch-96-precision", "Dolch 96 Precision", 3, 730, "special", "Pistols"],
  ["drilling-hatchet", "Drilling Hatchet", 2, 340, "shotgun", "Shotguns"],
  ["drilling-shorty", "Drilling Shorty", 2, 330, "shotgun", "Shotguns"],
  ["frontier-73c-marksman", "Frontier 73C Marksman", 3, 45, "compact", "Rifles"],
  ["frontier-73c-silencer", "Frontier 73C Silencer", 3, 55, "compact", "Rifles"],
  ["infantry-73l-bayonet", "Infantry 73L Bayonet", 4, 88, "compact", "Rifles"],
  ["infantry-73l-sniper", "Infantry 73L Sniper", 4, 90, "compact", "Rifles"],
  ["krag-bayonet", "Krag Bayonet", 4, 460, "slong", "Rifles"],
  ["krag-silencer", "Krag Silencer", 4, 517, "slong", "Rifles"],
  ["krag-sniper", "Krag Sniper", 4, 517, "slong", "Rifles"],
  ["lebel-1886-aperture", "Lebel 1886 Aperture", 4, 417, "slong", "Rifles"],
  ["lebel-1886-marksman", "Lebel 1886 Marksman", 4, 437, "slong", "Rifles"],
  ["lebel-1886-talon", "Lebel 1886 Talon", 4, 407, "slong", "Rifles"],
  ["lemat-carbine", "LeMat Carbine", 3, 115, "compact", "Rifles"],
  ["lemat-carbine-marksman", "LeMat Carbine Marksman", 3, 127, "compact", "Rifles"],
  ["mako-1895-aperture", "Mako 1895 Aperture", 4, 378, "long", "Rifles"],
  ["mako-1895-claw", "Mako 1895 Claw", 4, 370, "long", "Rifles"],
  ["marathon-swift", "Marathon Swift", 4, 95, "compact", "Rifles"],
  ["martini-henry-deadeye", "Martini-Henry Deadeye", 4, 128, "long", "Rifles"],
  ["martini-henry-ironside", "Martini-Henry Ironside", 4, 159, "long", "Rifles"],
  ["martini-henry-marksman", "Martini-Henry Marksman", 4, 134, "long", "Rifles"],
  ["martini-henry-riposte", "Martini-Henry Riposte", 4, 132, "long", "Rifles"],
  ["maynard-sniper-silencer", "Maynard Sniper Silencer", 5, 159, "medium", "Rifles"],
  ["mosin-obrez-extended", "Mosin Obrez Extended", 2, 350, "slong", "Rifles"],
  ["mosin-obrez-mace", "Mosin Obrez Mace", 2, 300, "slong", "Rifles"],
  ["mosin-obrez-match", "Mosin Obrez Match", 3, 345, "slong", "Rifles"],
  ["mosin-obrez-sharpeye", "Mosin Obrez Sharpeye", 3, 362, "slong", "Rifles"],
  ["mosin-nagant-bayonet", "Mosin-Nagant Bayonet", 4, 630, "slong", "Rifles"],
  ["mosin-nagant-sniper", "Mosin-Nagant Sniper", 4, 713, "slong", "Rifles"],
  ["nagant-m1895-deadeye", "Nagant M1895 Deadeye", 2, 30, "compact", "Pistols"],
  ["nagant-m1895-precision", "Nagant M1895 Precision", 2, 29, "compact", "Pistols"],
  ["nagant-m1895-silencer", "Nagant M1895 Silencer", 1, 27, "compact", "Pistols"],
  ["new-army-swift", "New Army Swift", 1, 108, "compact", "Pistols"],
  ["officer-brawler", "Officer Brawler", 1, 106, "compact", "Pistols"],
  ["officer-carbine-deadeye", "Officer Carbine Deadeye", 3, 192, "compact", "Rifles"],
  ["pax-claw", "Pax Claw", 1, 90, "medium", "Pistols"],
  ["pax-trueshot", "Pax Trueshot", 1, 141, "medium", "Pistols"],
  ["ranger-73-aperture", "Ranger 73 Aperture", 4, 79, "compact", "Rifles"],
  ["ranger-73-swift", "Ranger 73 Swift", 4, 128, "compact", "Rifles"],
  ["ranger-73-talon", "Ranger 73 Talon", 4, 85, "compact", "Rifles"],
  ["rival-78-mace", "Rival 78 Mace", 2, 155, "shotgun", "Shotguns"],
  ["rival-78-shorty", "Rival 78 Shorty", 2, 145, "shotgun", "Shotguns"],
  ["rival-78-trauma", "Rival 78 Trauma", 4, 180, "shotgun", "Shotguns"],
  ["romero-77-alamo", "Romero 77 Alamo", 4, 98, "shotgun", "Shotguns"],
  ["romero-77-hatchet", "Romero 77 Hatchet", 2, 56, "shotgun", "Shotguns"],
  ["romero-77-shorty", "Romero 77 Shorty", 2, 46, "shotgun", "Shotguns"],
  ["romero-77-talon", "Romero 77 Talon", 4, 76, "shotgun", "Shotguns"],
  ["scottfield-brawler", "Scottfield Brawler", 1, 87, "medium", "Pistols"],
  ["scottfield-precision", "Scottfield Precision", 2, 85, "medium", "Pistols"],
  ["scottfield-spitfire", "Scottfield Spitfire", 1, 108, "medium", "Pistols"],
  ["scottfield-swift", "Scottfield Swift", 1, 95, "medium", "Pistols"],
  ["slate-riposte", "Slate Riposte", 4, 323, "shotgun", "Shotguns"],
  ["sparks-pistol-silencer", "Sparks Pistol Silencer", 1, 178, "long", "Pistols"],
  ["sparks-silencer", "Sparks Silencer", 4, 150, "long", "Rifles"],
  ["sparks-sniper", "Sparks Sniper", 4, 150, "long", "Rifles"],
  ["specter-1882-bayonet", "Specter 1882 Bayonet", 4, 198, "shotgun", "Shotguns"],
  ["specter-1882-shorty", "Specter 1882 Shorty", 2, 164, "shotgun", "Shotguns"],
  ["springfield-1866-bayonet", "Springfield 1866 Bayonet", 4, 48, "medium", "Rifles"],
  ["springfield-1866-bullseye", "Springfield 1866 Bullseye", 2, 35, "medium", "Rifles"],
  ["springfield-1866-marksman", "Springfield 1866 Marksman", 4, 42, "medium", "Rifles"],
  ["springfield-1866-shorty", "Springfield 1866 Shorty", 2, 33, "medium", "Rifles"],
  ["springfield-1866-striker", "Springfield 1866 Striker", 2, 43, "medium", "Rifles"],
  ["terminus-shorty", "Terminus Shorty", 2, 148, "shotgun", "Shotguns"],
  ["uppercut-deadeye", "Uppercut Deadeye", 3, 337, "long", "Pistols"],
  ["uppercut-precision", "Uppercut Precision", 3, 321, "long", "Pistols"],
  ["vandal-73c-bullseye", "Vandal 73C Bullseye", 2, 37, "compact", "Rifles"],
  ["vandal-73c-striker", "Vandal 73C Striker", 2, 45, "compact", "Rifles"],
  ["vetterli-71-bayonet", "Vetterli 71 Bayonet", 3, 115, "medium", "Rifles"],
  ["vetterli-71-cyclone", "Vetterli 71 Cyclone", 4, 280, "medium", "Rifles"],
  ["vetterli-71-deadeye", "Vetterli 71 Deadeye", 3, 110, "medium", "Rifles"],
  ["vetterli-71-marksman", "Vetterli 71 Marksman", 3, 116, "medium", "Rifles"],
  ["vetterli-71-silencer", "Vetterli 71 Silencer", 3, 150, "medium", "Rifles"],
];

export const WEAPON_GROUPS = ["Pistols", "Rifles", "Shotguns", "Melee", "Bows"];

export const TOOLS = [
  ["first-aid-kit", "First Aid Kit", 30, "Medical"],
  ["knife", "Knife", 40, "Melee"],
  ["heavy-knife", "Heavy Knife", 20, "Melee"],
  ["dusters", "Dusters", 30, "Melee"],
  ["throwing-knives", "Throwing Knives", 30, "Throwing"],
  ["throwing-axes", "Throwing Axes", 50, "Throwing"],
  ["flare-pistol", "Flare Pistol", 36, "Utility"],
  ["fusees", "Fusees", 10, "Utility"],
  ["spyglass", "Spyglass", 8, "Utility"],
  ["decoys", "Decoys", 6, "Decoys"],
  ["blank-fire-decoys", "Blank Fire Decoys", 45, "Decoys"],
  ["decoy-fuses", "Decoy Fuses", 30, "Decoys"],
  ["alert-trip-mine", "Alert Trip Mines", 30, "Traps"],
  ["concertina-trip-mine", "Concertina Trip Mines", 90, "Traps"],
  ["poison-trip-mine", "Poison Trip Mines", 30, "Traps"],
  ["quad-derringer", "Quad Derringer", 30, "Sidearms"],
  // Update 2.8 additions — appended (never inserted) so legacy index-based
  // encodings keep resolving to the same items they did before (issue #35/#38).
  // Choke Beetle / Stalker Beetle moved to CONS below; loadoutCodec.js's legacy
  // decoder explicitly drops their old tool-slot positions (18/19) rather than
  // letting them silently resolve to these new entries.
  ["throwing-spear", "Throwing Spear", 80, "Throwing"],
  ["knuckle-knife", "Knuckle Knife", 50, "Melee"],
  ["choke-bombs", "Choke Bombs", 25, "Utility"],
  ["derringer-pennyshot", "Derringer Pennyshot", 63, "Sidearms"],
  ["bear-traps", "Bear Traps", 70, "Traps"],
];

// SEVEN buckets since #166, which split a `Utility` holding 9 of 22 tools — the picker's catch-all
// rather than a category. The distribution is now Melee 4, Traps 4, Utility 4, Decoys 3, Throwing 3,
// Sidearms 2, Medical 1: largest bucket 4 of 21, where it was 9.
//
// The two new names are cut on what the tools DO, read from their own wiki descriptions rather than
// from the shape of the leftovers:
//
//   Decoys    Decoys, Blank Fire Decoys, Decoy Fuses — all three are named Decoy and all three
//             distract by sound ("the noise can be effectively used to distract", "imitates the
//             sound of a gunshot"). The most self-evident group in the file.
//   Sidearms  Quad Derringer, Derringer Pennyshot — each description opens "A small, light pistol",
//             which is a different thing from every other tool here.
//
// WHY NOT MORE. #166 also suggested a light/vision split and moving Choke Bombs to `Throwing`. Both
// were declined, and the reason is the same one #166 itself uses to reject the wiki's scheme: its 11
// tool subcategories "average under two members each across 21 live tools — a worse picker, not a
// better one." Cutting Flare Pistol + Fusees + Spyglass into one or two more buckets pushes this file
// toward that same failure, and 7 groups over 21 rows is already 3 per group.
//
// Choke Bombs stays out of `Throwing` deliberately. That group means retrievable projectile weapons —
// every member's description ends "Can be retrieved and reused" — and a gas device that extinguishes
// flames is thrown without being that. Diluting a group with a clear rule to relocate one item costs
// more than the item gains.
//
// So `Utility` survives as a genuine remainder of 4 rather than a catch-all of 9: Flare Pistol and
// Fusees (light, and both ignite flammables), Spyglass (vision), Choke Bombs (gas). Loose, but each
// is there for a reason a reader can check.
//
// `Medical` at 1 is deliberate and not an oversight of this split. First Aid Kit is the only healing
// tool in the game, and the group is load-bearing beyond the picker — `FIRST_AID_KIT` is exported
// symbolically and the randomizer always includes it (SPEC-0008). Merging it into `Utility` to even
// out counts would hide the one tool every loadout carries.
//
// No rules impact, on the same terms the TRAIT_GROUPS note records: `group` feeds picker section
// headers and icon dispatch only. It is never persisted — a saved loadout stores tool ids — so
// regrouping cannot invalidate a saved loadout or a share link.
export const TOOL_GROUPS = ["Decoys", "Medical", "Melee", "Sidearms", "Throwing", "Traps", "Utility"];

// ROSTER BOUNDARY — why this table is 44 rows against the wiki's 54.
//
// The accounting, from a discovery crawl (`node scripts/scrape-stats.mjs --discover`), which resolves
// the 10-page difference exactly:
//
//   10  removed items     — Proof Vapours, Wormseed Shots, Reliquaries. Pages still exist; the
//                           items do not.
//    0  actually missing  — the consumable roster is COMPLETE. (#163)
//
// TAROT CARDS ARE IN, as of #37. The fourteen are live pages each stating a price of the literal word
// "Scarce", found in-world at Bileweaver compounds, Postal Supply, Clockmaker's Supply and Sealed
// Hoards. They are ordinary rows costing 0 under ADR-0013, exactly like the twelve Scarce rows that
// preceded them — four weapons (Flame Rifle, Homestead 78, Shredder, Wildland) and eight traits
// (Berserker, Catalyst, Death Cheat, Rampage, Relentless, Remedy, Shadow, Shadow Leap).
//
// This boundary outlived THREE rationales before it fell, which is why the history stays written down
// rather than re-derived — each reason looked sufficient until it wasn't:
//
//   1. "A limited-time event item rather than a permanent roster addition" (077e747). That framing
//      carried its own revisit trigger and Update 2.8.1 fired it — Tarot Cards are permanent.
//   2. "Unpurchasable with Hunt Dollars", correct until ADR-0013 (2026-08-12) made unpurchasability
//      a cost of zero rather than a ground for exclusion. SPEC-0007 marks that reversal rather than
//      rewriting it, for the same reason this comment does.
//   3. A bare scope choice, once the first two expired — which is the weakest of the three, because
//      it rested on nothing but itself. What ended it: a loadout built here could not be the loadout
//      a player fields, since Tarot Cards occupy equipment cells this table could not fill. That was
//      recorded as an accepted consequence and it was the wrong trade for a builder whose whole job
//      is expressing what the player can take. #37 reversed it; the desktop distribution gate
//      (SPEC-0005) named it as a blocker.
//
// The cap needs no new modelling, but NOT for the reason an earlier draft of this comment gave. It
// claimed the cap is per specific item, so a fourth Tarot Card would be bounded like a fourth Frag
// Bomb. ADR-0015 reversed that — the cap is per TYPE. The conclusion survives for the opposite
// reason: `CONS_CAP_CATEGORIES` below already declares "Tarot Cards", deliberately and with no rows,
// which is precisely what SPEC-0006 REQ "Capacity Rules Are Stated Once and Preserved" requires — a
// declared category with no rows is capped by the same mechanism the moment rows are admitted. (That
// earlier draft also cited SPEC-0008, Loadout Randomization; the cap lives in SPEC-0006.)
//
// `catalog.test.js` names the fourteen and asserts each pairs its cost of 0 with the scrape's own
// Scarce evidence, in both directions — the same assertion `itemStats.test.js` applies to the twelve
// rows above. A card carried at 0 with no evidence fails.
export const CONS = [
  ["vitality-shot", "Vitality Shot", 85, "Shot", "Shots"],
  ["regeneration-shot", "Regeneration Shot", 105, "Shot", "Shots"],
  ["stamina-shot", "Stamina Shot", 100, "Shot", "Shots"],
  ["antidote-shot", "Antidote Shot", 55, "Shot", "Shots"],
  ["dynamite-stick", "Dynamite Stick", 18, "Throwable", "Explosives"],
  ["dynamite-bundle", "Dynamite Bundle", 75, "Throwable", "Explosives"],
  ["big-dynamite-bundle", "Big Dynamite Bundle", 110, "Throwable", "Explosives"],
  ["frag-bomb", "Frag Bomb", 103, "Throwable", "Explosives"],
  ["sticky-bomb", "Sticky Bomb", 64, "Throwable", "Explosives"],
  ["fire-bomb", "Fire Bomb", 30, "Throwable", "Fire"],
  ["liquid-fire-bomb", "Liquid Fire Bomb", 35, "Throwable", "Fire"],
  ["hive-bomb", "Hive Bomb", 40, "Throwable", "Gas"],
  ["chaos-bomb", "Chaos Bomb", 15, "Throwable", "Utility"],
  // "Choke Bomb" was removed here (issue #67): it duplicated the "Choke Bombs" TOOLS
  // entry, had no wiki page or image of its own, and let a player fill a consumable slot
  // with something the game only offers as a tool. Removing a row from the middle of an
  // array is safe now that loadoutCodec.js pins the legacy order in its own table
  // (issue #68) instead of reading these arrays positionally. The `choke-bomb` id is
  // retired and must never be reused.
  ["flash-bomb", "Flash Bomb", 25, "Throwable", "Utility"],
  ["concertina-bomb", "Concertina Bomb", 38, "Throwable", "Utility"],
  // Update 2.8 additions — appended (never inserted) so legacy index-based
  // encodings keep resolving to the same items they did before (issue #35/#37/#38).
  ["vitality-shot-weak", "Vitality Shot (Weak)", 20, "Shot", "Shots"],
  ["regeneration-shot-weak", "Regeneration Shot (Weak)", 40, "Shot", "Shots"],
  ["stamina-shot-weak", "Stamina Shot (Weak)", 60, "Shot", "Shots"],
  ["antidote-shot-weak", "Antidote Shot (Weak)", 30, "Shot", "Shots"],
  ["recovery-shot", "Recovery Shot", 140, "Shot", "Shots"],
  ["medical-pack", "Medical Pack", 35, "Placeable", "Shots"],
  ["waxed-dynamite-stick", "Waxed Dynamite Stick", 24, "Throwable", "Explosives"],
  ["dark-dynamite-satchel", "Dark Dynamite Satchel", 100, "Throwable", "Explosives"],
  ["hellfire-bomb", "Hellfire Bomb", 70, "Throwable", "Explosives"],
  ["poison-bomb", "Poison Bomb", 25, "Throwable", "Gas"],
  ["ammo-box", "Ammo Box", 65, "Placeable", "Utility"],
  ["tool-box", "Tool Box", 70, "Placeable", "Utility"],
  ["choke-beetle", "Choke Beetle", 22, "Throwable", "Gas"],
  ["stalker-beetle", "Stalker Beetle", 45, "Throwable", "Utility"],
  ["fire-beetle", "Fire Beetle", 57, "Throwable", "Fire"],
  // The fourteen Tarot Cards (#37), appended for the same reason the Update 2.8 block above is:
  // legacy index-based encodings resolve positionally, so a row may be added at the end and never
  // inserted. Cost 0 under ADR-0013 — each page states its price as the literal word "Scarce", which
  // the strict parser refuses and records as `purchasable: false`, and that record is the evidence
  // `itemStats.test.js` demands for every hand-authored zero.
  ["the-chariot", "The Chariot", 0, "Tarot Cards", "Tarot Cards"],
  ["the-devil", "The Devil", 0, "Tarot Cards", "Tarot Cards"],
  ["the-empress", "The Empress", 0, "Tarot Cards", "Tarot Cards"],
  ["the-fool", "The Fool", 0, "Tarot Cards", "Tarot Cards"],
  ["the-garden", "The Garden", 0, "Tarot Cards", "Tarot Cards"],
  ["the-hanged-man", "The Hanged Man", 0, "Tarot Cards", "Tarot Cards"],
  ["the-high-priestess", "The High Priestess", 0, "Tarot Cards", "Tarot Cards"],
  ["the-judgement", "The Judgement", 0, "Tarot Cards", "Tarot Cards"],
  ["the-magician", "The Magician", 0, "Tarot Cards", "Tarot Cards"],
  ["the-moon", "The Moon", 0, "Tarot Cards", "Tarot Cards"],
  ["the-pathfinder", "The Pathfinder", 0, "Tarot Cards", "Tarot Cards"],
  ["the-sun", "The Sun", 0, "Tarot Cards", "Tarot Cards"],
  ["the-tower", "The Tower", 0, "Tarot Cards", "Tarot Cards"],
  ["the-world", "The World", 0, "Tarot Cards", "Tarot Cards"],
];

export const CONS_GROUPS = ["Shots", "Explosives", "Fire", "Gas", "Utility", "Tarot Cards"];

/**
 * THE declared cap-category list — the vocabulary `CONS[i][3]` (`type`) draws from, and the one
 * the four-per-category cap is read from (ADR-0015, SPEC-0006 REQ "Capacity Rules Are Stated Once
 * and Preserved": "The cap SHALL be read from a declared list of cap categories rather than
 * inferred from the `type` values present in `CONS`"). `calc.js` imports it; nothing re-declares
 * it. It is NOT the UI bucket — that is `group` (`CONS[i][4]`) and `CONS_GROUPS` above.
 *
 * There used to be two lists claiming this job and neither was consulted: this one asserted "This
 * IS the declared cap-category list" while excluding Tarot Cards, and `calc.js` declared a second
 * four-entry `CONS_CAP_CATEGORIES` that it then never read, under a comment claiming THIS list
 * already named Tarot Cards. The cap meanwhile inferred the category from whatever `type` a row
 * happened to carry — exactly the inference the requirement forbids. One list, imported, ends it.
 *
 * `Tarot Cards` is listed though it has NO rows in `CONS` yet (see the roster boundary above), and
 * that is the entire point of declaring rather than inferring: SPEC-0006 requires an empty category
 * to be capped by the same mechanism "the moment rows are admitted, with no new modelling". The
 * previous arrangement excluded it *in order to* cap it, which is backwards — a category absent
 * from the list the cap reads is a category the cap cannot see.
 *
 * `Shot` is retained and is knowingly not a wiki category: the wiki has no `Shot Consumables`, and
 * Vitality Shot is filed only under `Healing Consumables`. So this set mixes three of the game's cap
 * categories with one of our own naming. Recorded rather than silently corrected, because collapsing
 * `Shot` would change ten rows for no behavioural gain.
 *
 * `Placeable` added 2026-08-12 (#155). Ammo Box, Tool Box and Medical Pack were filed as `Throwable`
 * and `Shot`; all three are `Category:Placeable_Consumables` on the wiki. Medical Pack is the
 * instructive one — the wiki files it under BOTH `Placeable Consumables` (a cap category) and
 * `Healing Consumables` (an effect category), and the app had taken the effect one.
 *
 * A row typed outside this list is a DATA ERROR (`catalog.test.js` pins every row to it). It is not
 * thereby uncapped: `calc.js` folds every undeclared type into one shared budget, because SPEC-0006
 * requires such a row to be "treated as a data error rather than silently escaping the cap".
 */
export const CONS_CAP_CATEGORIES = ["Shot", "Throwable", "Placeable", "Tarot Cards"];

/**
 * The cap categories that actually have rows today — a strict subset of `CONS_CAP_CATEGORIES`,
 * enforced as such by `catalog.test.js`.
 *
 * This exists ONLY because a badge palette needs an entry per category a player can see on screen,
 * and only a category with rows can be seen. Keeping it separate is what lets the cap vocabulary
 * name `Tarot Cards` without forcing a speculative colour choice for a category the roster
 * deliberately excludes. Do not use it for a rules decision — the cap reads
 * `CONS_CAP_CATEGORIES`, and using this subset instead is how Tarot Cards would slip the cap on
 * the day rows are admitted.
 */
// Every cap category that HAS rows must appear here, or its badge falls back to Throwable's colour
// and reads as a category it is not. "Tarot Cards" joined on 2026-08-15 when #37 admitted the
// fourteen — the palette test anticipated exactly this and permits the lists reaching equal length.
export const CONS_TYPES = ["Shot", "Throwable", "Placeable", "Tarot Cards"];

/**
 * Badge colour per consumable type, in one place because there were two copies of the switch.
 *
 * `EquipmentSlot` and `PickerRow` both coloured their category badge with an inline
 * `type === "Shot" ? olive : rust`. Two copies of a two-branch conditional survived a third value
 * being added only by rendering `Placeable` identically to `Throwable` — a distinction the user could
 * not see, which is the same class of defect as a fallback keyed off the wrong field.
 *
 * Steel blue for `Placeable` is measured, not chosen by eye: 5.86:1 against `--panel` (#1a1510),
 * above all three existing badge colours (tools 3.83:1, Shot 4.85:1, Throwable 4.00:1). These are
 * text colours, and #93 tracks bringing this palette up to the WCAG AA baseline — a new value should
 * not be the one that makes that job harder.
 */
export const CONS_TYPE_COLOR = {
  Shot: "#7a8a5c",
  Throwable: "#a5674a",
  Placeable: "#7f96a3",
  // Muted violet — distinct from the olive/rust/slate above at badge size, and the one hue in the
  // equipment palette not already spoken for (#37).
  "Tarot Cards": "#7d6a93",
};

/** The tool badge colour, alongside the consumable ones so the equipment palette reads as one set. */
export const TOOL_COLOR = "#8a6f42";

// ROSTER BOUNDARY — why this table is 58 rows against the 75 live traits we can evidence.
//
// Read the 58 carefully: it is NOT the wiki's `Category:Traits/Regular`, which also reports 58.
// Those are two different 58s and the coincidence is a trap. This table is 49 Regular + 8 Scarce
// + 1 Burn (Necromancer); the Regular index is 58 Regular pages, of which some are tombstones and
// one — Necromancer — is not in it at all. Hitting 58 here does not mean that index is covered.
// #157 was opened on the reading that it would ("32 of 58, so 26 missing"), and ADR-0013's coverage
// run found that denominator wrong in both directions.
//
// The de-duplicated union of the Regular, Scarce and Event indexes is 84 pages (ADR-0013, roster
// corrected 2026-08-12; six traits are listed by two indexes, so the de-duplication is load-bearing).
// That union resolves as:
//
//   10  tombstones        — pages that outlive the item. `Traits/All Ears` is listed by BOTH the
//                           Scarce and Event indexes and states its own removal in 2.7.0.3.
//   31  already carried   — plus Necromancer, which is Burn-only and therefore in none of the three
//                           indexes: that is the 32 this table held before #157, and it is why the
//                           union's "already carried" count reads one short of the table.
//   26  added by #157     — 18 Regular at their stated 1–6 points, 8 Scarce at zero (ADR-0013).
//   17  HELD BACK         —  1  Signee, the only Event trait stating a cost (6 points)
//                           11  Event-only traits, none of which states a cost at all
//                            5  Scarce traits also listed by the Event index (Blademancer, Bruiser,
//                               Communion, Corpse Seer, Gunrunner)
//
// The ground for holding those 17 is DATA CONFIDENCE, not availability and not purchasability.
// Both of the framings that suggest themselves here are wrong, and each is wrong for a recorded
// reason:
//
//   - NOT "event content is not currently live". SPEC-0007 REQ "Acquisition Class Is Captured So
//     Roster Membership Is Checkable" forbids stating a boundary in terms of an event's duration,
//     because a limited-time item can become permanent while its data stays unreliable. Update
//     2.8.1 already fired that trigger once, on Tarot Cards. See the CONS boundary above.
//   - NOT "these cannot be purchased". ADR-0013 retired unpurchasability as grounds for exclusion
//     outright: a Scarce item a player owns can be fielded, so it belongs here at zero cost. That
//     is why 8 Scarce traits are IN this table. Reusing that ground would contradict the row above.
//
// What actually disqualifies them: the Event index cannot be trusted to describe the live roster.
// `Traits/Shadow Crush` appears to have been replaced by `Traits/Shadow Leap` with neither page
// saying so — and a silent replacement is exactly what the tombstone classifier (#164) cannot
// detect, because it reads pages for stated removals. All Ears is the same shape caught only
// because its page happens to state its removal outright. So the classifier's silence over an
// Event page is not evidence the trait is real.
//
// The 11 Event-only traits state no cost anywhere, so adding them would also mean inventing budget
// data that SPEC-0007 REQ "Budget-Affecting Attributes Are Stored, Never Inferred" forbids. Signee
// is excluded despite stating 6 points, because a trustworthy cost on an untrustworthy roster entry
// is still an untrustworthy row. The useful consequence of drawing the line here rather than around
// cost: every row below is either priced-Regular or zero-cost-Scarce, so "Event with no stated
// cost" does not exist in this data at all, and the cost-0 invariant test has no ambiguous case.
//
// REVISIT WHEN: a page-level liveness signal exists for Event traits that does not depend on a page
// stating its own removal — or when Shadow Crush is resolved either way, since it is the concrete
// case this boundary was drawn around. New rows go on the end (see the note above the additions).
//
// Governing: ADR-0013 (Model Scarce Items as Selectable at Zero Cost), SPEC-0007 REQ "Acquisition
// Class Is Captured So Roster Membership Is Checkable", REQ "Budget-Affecting Attributes Are Stored,
// Never Inferred". Refs #157, #164, #231.

// UP costs re-verified against huntshowdown.wiki.gg (current through Update 2.8.1). This paragraph
// is about COSTS ONLY and has never claimed roster completeness — the boundary block above is what
// states coverage. Conflating the two is what #157 was filed about.
// Update 2.8 changed exactly three costs (Quartermaster 6->8, Frontiersman 5->6,
// Hundred Hands 2->3); the rest of the old table was stale from the 1.x/2.0 era.
// "Iron Repeater" was removed from the game (merged into Iron Eye, 3 UP, Update 1.15)
// and "Poison Sense" was renamed to "Pain Sense" (3 UP, Update 2.1).
//
// This paragraph used to end "entries are edited in place, never reordered, so legacy index-based
// encodings keep resolving to the same traits they did before." That stopped being the reason in
// #68: legacy encodings now resolve through the frozen LEGACY_TRAIT_IDS table in loadoutCodec.js,
// not through this array's live order. Corrected rather than deleted because it is the same stale
// belief the note above the #157 additions corrects — see there for what is actually load-bearing.
export const TRAITS = [
  ["quartermaster", "Quartermaster", 8, "Utility"],
  ["fanning", "Fanning", 8, "Combat"],
  ["levering", "Levering", 7, "Combat"],
  ["doctor", "Doctor", 9, "Medical"],
  ["physician", "Physician", 5, "Medical"],
  ["packmule", "Packmule", 4, "Utility"],
  ["frontiersman", "Frontiersman", 6, "Utility"],
  ["greyhound", "Greyhound", 2, "Mobility"],
  ["kiteskin", "Kiteskin", 1, "Mobility"],
  ["lightfoot", "Lightfoot", 5, "Stealth"],
  ["pitcher", "Pitcher", 4, "Combat"],
  ["bulletgrubber", "Bulletgrubber", 4, "Combat"],
  ["iron-eye", "Iron Eye", 3, "Combat"],
  ["bolt-thrower", "Bolt Thrower", 3, "Combat"],
  ["serpent", "Serpent", 4, "Utility"],
  ["ghoul", "Ghoul", 3, "Medical"],
  ["determination", "Determination", 1, "Medical"],
  ["resilience", "Resilience", 3, "Medical"],
  ["salveskin", "Salveskin", 2, "Medical"],
  ["necromancer", "Necromancer", 4, "Medical"],
  ["beastface", "Beastface", 4, "Stealth"],
  ["hundred-hands", "Hundred Hands", 3, "Combat"],
  ["steady-aim", "Steady Aim", 2, "Combat"],
  ["silent-killer", "Silent Killer", 3, "Stealth"],
  ["vulture", "Vulture", 2, "Utility"],
  ["whispersmith", "Whispersmith", 1, "Stealth"],
  ["pain-sense", "Pain Sense", 3, "Stealth"],
  ["conduit", "Conduit", 5, "Utility"],
  ["magpie", "Magpie", 1, "Utility"],
  ["ambidextrous", "Ambidextrous", 3, "Combat"],
  ["dauntless", "Dauntless", 1, "Combat"],
  ["vigilant", "Vigilant", 1, "Utility"],
  // ---------------------------------------------------------------------------
  // Appended 2026-08-12 (#157), and appended rather than merged in alphabetically for reviewability
  // — the diff shows 26 new rows instead of 26 insertions scattered through an existing table.
  //
  // NOT for wire-format safety, which is worth stating because the opposite is the intuitive guess
  // and it is wrong here: a trait pick persists as a stable id, not as a position. `toData` writes
  // `tr: loadout.traits` and those are ids (`thunks.js` stores `trait[0]`); `fromV1` resolves them
  // through `TRAIT_BY_ID`; and pre-versioning records go through the frozen `LEGACY_TRAIT_IDS`
  // table rather than through this array. Inserting or reordering rows here is therefore free, as
  // `loadoutCodec.js` says in as many words and as the CONS boundary above already records for its
  // own table (#68). What is NOT free is changing or reusing an `id` — that is the value saved
  // loadouts and share links actually carry.
  //
  // Costs are the wiki's own, read by `node scripts/scrape-stats.mjs --discover --only=traits` after
  // #231 taught discovery to crawl all three rarity indexes. `group` is hand-assigned, per SPEC-0007
  // REQ "Fields the Scraper Must Not Derive" — the wiki's functional axis is
  // Offensive/Defensive/Movement/Supportive and has no bucket matching `Stealth` or `Medical`, so no
  // mechanical mapping exists. Calibrated against rows already here: `salveskin` (fire mitigation)
  // and `determination` (stamina) are Medical, so mitigation and stamina are Medical; `pain-sense`
  // (senses Hunters) is Stealth while `vigilant` (highlights traps) is Utility, which is what splits
  // Blast Sense from Blade Seer and Witness; `beastface` (animals ignore you) is Stealth, which is
  // why Shadow is.

  // Regular traits, purchasable, costs as stated on the wiki.
  ["adrenaline", "Adrenaline", 1, "Medical"],
  ["assailant", "Assailant", 1, "Combat"],
  ["blade-seer", "Blade Seer", 1, "Utility"],
  ["blast-sense", "Blast Sense", 2, "Stealth"],
  ["bloodless", "Bloodless", 3, "Medical"],
  ["bulwark", "Bulwark", 2, "Medical"],
  ["decoy-supply", "Decoy Supply", 1, "Utility"],
  ["fast-fingers", "Fast Fingers", 4, "Combat"],
  ["gator-legs", "Gator Legs", 3, "Mobility"],
  ["hornskin", "Hornskin", 3, "Medical"],
  ["martialist", "Martialist", 2, "Combat"],
  ["mithridatist", "Mithridatist", 2, "Medical"],
  ["poacher", "Poacher", 1, "Stealth"],
  ["poltergeist", "Poltergeist", 2, "Utility"],
  ["scopesmith", "Scopesmith", 2, "Combat"],
  ["surefoot", "Surefoot", 6, "Mobility"],
  ["vigor", "Vigor", 3, "Medical"],
  ["witness", "Witness", 4, "Utility"],

  // Scarce traits. Cost 0 per ADR-0013: they come only from a match, so they can be sold but never
  // bought, and they have no purchase value. The zero is authored here by a human applying that
  // decision — the scrape records `priceStated: null` and `acquisitionClasses: ["Scarce", ...]` and
  // never writes a cost, because mapping "Scarce" to a number is a game rule.
  //
  // Each of these is asserted against the scrape in both directions by `itemStats.test.js`: a cost of
  // 0 here requires Scarce evidence there, and Scarce evidence there requires a 0 here. That check is
  // the whole reason a hand-authored 0 — which looks exactly like a price nobody supplied — is safe.
  ["berserker", "Berserker", 0, "Combat"],
  ["catalyst", "Catalyst", 0, "Utility"],
  ["death-cheat", "Death Cheat", 0, "Utility"],
  ["rampage", "Rampage", 0, "Medical"],
  ["relentless", "Relentless", 0, "Medical"],
  ["remedy", "Remedy", 0, "Medical"],
  ["shadow", "Shadow", 0, "Stealth"],
  ["shadow-leap", "Shadow Leap", 0, "Mobility"],
];

// WHY NOT THE WIKI'S OWN SCHEME (#162, closing #42; audit §D.2).
//
// The wiki does classify traits functionally, so the question #42 asked — is that an in-game grouping
// the app should mirror? — is a fair one. The answer is no, and measuring it is more useful than
// asserting it. Three reasons, in order of how much they decide:
//
//   1. IT HAS FOUR VALUES AND WE NEED FIVE. The infobox `Category` field holds exactly one of
//      Offensive / Defensive / Movement / Supportive. There is no Stealth bucket and no Medical
//      bucket, which are two of the five distinctions this UI is built on. Adopting the scheme does
//      not re-sort the roster; it deletes two sections and leaves their contents homeless.
//   2. ADOPTING IT WOULD BE FAR MORE LOPSIDED, NOT LESS. Measured across all 58 rows:
//         Supportive 30 (52%) · Offensive 12 (21%) · Defensive 10 (17%) · Movement 6 (10%)
//      A bucket holding over half the roster is a worse affordance than anything below — the app's
//      largest is Medical at 16 (28%). `Supportive` is the wiki's catch-all, and it absorbs traits as
//      unrelated as Relentless, Decoy Supply, Poltergeist, Witness and Necromancer.
//   3. IT IS MULTI-VALUED, THOUGH NOT IN THE WAY #162 ASSUMED. Across the 43 of 58 traits (74%)
//      whose page categories were probed while writing this, none was both Offensive and Defensive
//      — so on that sample the primary function reads as single-valued. That NARROWS audit §D.2's
//      HIGH-confidence "multi-valued" verdict rather than overturning it, and the qualifier is load-
//      bearing because THE REPO CANNOT CHECK THE CLAIM: `scrape-stats.mjs` parses whole-page
//      categories but persists only `acquisitionClasses`, filtered to the acquisition axis, so
//      itemStats.json carries no functional category SET at all. The one committed piece of evidence
//      is the infobox `Category` string, which is single-valued by construction and therefore
//      structurally incapable of falsifying the claim — a test written against it could only ever
//      pass. The probe is not reproducible from committed data; persisting the full category sets is
//      what would make it so, and that is its own change.
//      The multi-valuedness that IS checkable, and is checked: `Solo` and `Catalyst` sit on the same
//      functional axis (SPEC-0007 names all six there) but arrive in a separate infobox field, so
//      Beastface and Vigilant are Supportive AND Catalyst, while Necromancer and Conduit are
//      Supportive AND Solo. A `group` field renders one section header per item and cannot hold two.
//
// The SECOND wiki scheme — Regular / Burn / Scarce / Event — is about acquisition rather than
// function, and #162 noted it was "genuinely missing". It is not missing any more: the scrape records
// it per item as `acquisitionClasses` in itemStats.json (#230), where it decides what a row COSTS
// rather than which section it renders under. NOT whether the row exists at all: ADR-0013 retired
// unpurchasability as grounds for exclusion, and SPEC-0007 REQ "Acquisition Class Is Captured So
// Roster Membership Is Checkable" strikes that framing in its 2026-08-12 amendment, replacing
// "whether it belongs in the catalog at all" with "what it costs". Which is why the 8 Scarce traits
// thirty lines up are IN this table, at zero — the same correction the boundary block above makes at
// length. That is the right home for it, and it is genuinely multi-valued — Relentless is Scarce AND
// Burn.
//
// So these five names are a UI affordance this project authors, which is exactly what SPEC-0007 REQ
// "Fields the Scraper Must Not Derive" already concludes: "None is a single-valued UI category. A new
// row's `group` SHALL be hand-assigned."
//
// Five buckets, RECONSIDERED AND KEPT at 58 rows (#157, closing the carve-out #42 left here).
// The question was whether ~12-per-bucket wants splitting once the roster nearly doubled. It does
// not: the distribution is Combat 15, Medical 16, Mobility 5, Stealth 8, Utility 14 — a 3.2x spread
// that is uneven but not unusable, and the two crowded buckets are crowded because the game really
// does concentrate traits there, not because the buckets are miscut. Splitting to even them out
// would invent distinctions the wiki does not make, which is the same objection SPEC-0007 REQ
// "Fields the Scraper Must Not Derive" raises against deriving `group` at all — these names are a
// UI affordance this project authors, and the cost of a bad cut is paid by every future hand
// assignment having a less obvious home.
//
// Medical at 16 is the one to watch, and it is worth naming why rather than just noting the count:
// a third of it arrived in #157 under the `salveskin` precedent (mitigation and stamina read as
// Medical). If that precedent is wrong, Bulwark, Hornskin, Bloodless and Mithridatist are the rows
// that move, and Medical drops to 12 — which would resolve the imbalance without any split at all.
// So the bucket count is not the thing under strain here; one classification precedent is.
//
// REVISIT WHEN: a bucket passes ~20 rows, or the picker's grid (#227) stops fitting a group on one
// screen. Renaming or splitting a group is UI-only: `group` is never persisted — a saved loadout
// stores trait ids (`loadoutCodec.js` `toData`) — so regrouping cannot invalidate one.
//
// Governing: ADR-0005 (Scrape Item Stats into a Generated, Committed Data File — every wiki number
// argued above is read through `statFieldFor` off the generated itemStats.json, and reason 3's limits
// are that file's shape), ADR-0013 (Model Scarce Items as Selectable at Zero Cost), SPEC-0007 REQ
// "Fields the Scraper Must Not Derive", REQ "Acquisition Class Is Captured So Roster Membership Is
// Checkable". Refs #42, #157, #162, #230.
export const TRAIT_GROUPS = ["Combat", "Medical", "Mobility", "Stealth", "Utility"];

const THUMBS = {
  pistol: "M10 12h44v7H30l-5 14H13l5-14h-8z",
  carbine: "M2 17h44v5H26l-3 8h-8l2-8H2zM46 14l30 4v10l-30-3z",
  rifle: "M2 17h56v5H34l-3 8h-8l2-8H2zM58 14l34 4v10l-34-3z",
  shotgun: "M2 15h54v3H2zM2 20h54v3H2zM56 13l34 5v10l-34-4z",
  melee: "M14 30L70 8l4 5-54 21zM66 4l14 10-8 10-12-9z",
  bow: "M22 4c36 5 36 27 0 32l-2-3c30-4 30-22 0-26zM21 5l2 30h-3z",
  xbow: "M14 18h64v5H36l-3 9h-9l3-9H14zM72 4h5v32h-5z",
};

// Governing: ADR-0001 (schematic SVG icons as the fallback tier), ADR-0006 (hunter
// portraits illustrate loadout lists), SPEC-0003 REQ "Hunter Dataset Consumption Contract"
//
// Schematic hunter silhouettes, on the same 0 0 96 40 viewBox as every other fallback here.
// These stand in when a list references a real hunter whose portrait asset is absent —
// mirroring SPEC-0001's item rule exactly: the item exists, the photo does not, so draw the
// schematic rather than nothing.
//
// A list with NO hunter keeps its list-name monogram instead. The two states are different:
// "hunter chosen, art missing" has an identity to depict, while "no hunter" does not, and
// drawing a figure there would imply an identity the list never claimed. The design handoff
// originally merged both cases; see docs/design/hunter-loadout-lists/handoff.md.
const HUNTER_THUMBS = [
  // Broad-brim hat, coat, shoulders squared.
  "M48 4c-7 0-12 4-12 9H22v4h52v-4H60c0-5-5-9-12-9zM34 21h28l6 19H28z",
  // Bowler hat, high collar, narrow frame.
  "M40 3h16v6h6v4H34V9h6zM36 15h24l5 25H31z",
  // Bare head, long hair, heavy shoulders.
  "M48 2c-8 0-13 6-13 13 0 4 2 7 4 9H30l-6 16h48l-6-16h-9c2-2 4-5 4-9 0-7-5-13-13-13z",
  // Hooded figure.
  "M48 3c-11 0-19 8-19 18l-5 19h48l-5-19c0-10-8-18-19-18zm0 8a10 10 0 0 1 10 10H38a10 10 0 0 1 10-10z",
  // Cap with brim, scarfed neck.
  "M38 5h20v5h10v3H30v-3h8zM36 16h24l4 8H32zM32 26h32l4 14H28z",
  // Feathered hat, sloped shoulders.
  "M48 2l14 5-4 4h10v4H28v-4h10l-4-4zM34 17h28l7 23H27z",
];

/**
 * Pick a silhouette for a hunter.
 *
 * Deterministic on `hunterId`, so a hunter always renders the same figure across reloads,
 * sessions and browsers — a silhouette that shuffled would read as a loading glitch.
 * Returns null when there is no hunter, which is the caller's signal to draw the list-name
 * monogram instead.
 */
export function hunterThumb(hunterId) {
  if (!hunterId) return null;
  let hash = 0;
  for (let i = 0; i < hunterId.length; i++) {
    hash = (hash * 31 + hunterId.charCodeAt(i)) >>> 0;
  }
  return HUNTER_THUMBS[hash % HUNTER_THUMBS.length];
}

export function weaponThumb(w) {
  const cls = w[4];
  if (cls === "none") return THUMBS.melee;
  if (cls === "bow") return THUMBS.bow;
  if (cls === "xbow" || cls === "hxbow") return THUMBS.xbow;
  if (cls === "shotgun") return THUMBS.shotgun;
  if (w[2] <= 2) return THUMBS.pistol;
  if (w[2] === 3) return THUMBS.carbine;
  return THUMBS.rifle;
}

// Tools/Traits/Consumables SVG fallback layer (mirrors THUMBS/weaponThumb above). These didn't
// exist before this change — Tools, Traits, and Consumables previously rendered no imagery at
// all. One simple line-art path silhouette per group (5 groups per category), dispatched by the
// item's `group` field. Kept intentionally schematic/simple, consistent with the weapon THUMBS
// visual language — this is now a fallback tier behind scraped photos, not primary art (see
// docs/openspec/specs/equipment-iconography/design.md).
const TOOL_THUMBS = {
  // A thrown noise-maker with sound trailing off it, and a compact break-action derringer. Both drawn
  // in the same 96x40 space as their siblings and centred on x=48, so a group filter's icons keep one
  // optical weight. Added with #166's split — catalog.test.js asserts one DISTINCT icon per declared
  // group, so a new group without a path here fails rather than silently inheriting Utility's.
  Decoys: "M48 12a8 8 0 1 1 0 16 8 8 0 0 1 0-16zM24 18h10v4H24zM27 26h7v4h-7zM62 18h10v4H62zM62 26h7v4h-7z",
  Sidearms: "M32 14h32v6H50l-3 12H36l3-12h-7z",
  Medical: "M41 4h14v9h17v14H55v9H41v-9H24V13h17z",
  Melee: "M6 30L66 6l5 8L11 38zM70 2h14v10H70z",
  Throwing: "M10 34L34 6l6 4-24 28zM50 34L74 6l6 4-24 28z",
  Traps: "M48 6l6 10h12l-9 8 4 12-13-7-13 7 4-12-9-8h12z",
  Utility: "M48 4l14 14-14 14-14-14zM40 32h16v6H40z",
};

const TRAIT_THUMBS = {
  Combat: "M8 6l58 28-4 6L4 12zM8 34l58-28 4 6L12 40z",
  Medical: "M41 4h14v9h17v14H55v9H41v-9H24V13h17z",
  Mobility: "M10 20l30-16v10h46v12H40v10z",
  Stealth: "M48 4L20 36h56zM40 26h16v4H40z",
  Utility: "M48 4l14 14-14 14-14-14zM40 32h16v6H40z",
};

const CONS_THUMBS = {
  Shots: "M42 4h12v6h6v26H36V10h6z",
  Explosives: "M44 6l14 14-14 14-14-14zM44 6l6-6 4 4-6 6z",
  Fire: "M46 4l8 12-6 4 10 6-14 14-14-10 8-4-8-10 10-2z",
  Gas: "M20 24l10-8 10 8-10 8zM40 20l10-8 10 8-10 8zM60 24l10-8 10 8-10 8z",
  Utility: "M30 4h4v32h-4zM34 6h26l-8 7 8 7H34z",
  // A card standing on its short edge with a star at centre — the group is the fourteen Tarot
  // Cards (#37), and the silhouette has to read as a CARD rather than a bomb or a bottle at the
  // picker's tile size. `consThumb` falls back to Utility for an unrecognised group, so a group
  // without an entry here renders as a wrench and is indistinguishable from Utility (#37 review).
  "Tarot Cards": "M32 4h24v40H32zM44 14l3 7 7 1-5 5 1 7-6-4-6 4 1-7-5-5 7-1z",
};

export function toolThumb(tool) {
  return TOOL_THUMBS[tool[3]] || TOOL_THUMBS.Utility;
}

export function traitThumb(trait) {
  return TRAIT_THUMBS[trait[3]] || TRAIT_THUMBS.Utility;
}

export function consThumb(cons) {
  return CONS_THUMBS[cons[4]] || CONS_THUMBS.Utility;
}

// Symbolic item IDs used by logic elsewhere in the app. Resolved by stable id (not array
// position) so catalog reorders/inserts never move the goalposts.
export const QM = "quartermaster";
export const FIRST_AID_KIT = "first-aid-kit";
