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
  // "Special" pool (Dolch 96 / Nitro Express). Both weapons' custom ammo (Dumdum /
  // Explosive / Shredder) has been Scarce since Update 2.8 and can't be bought with
  // Hunt Dollars, so no purchasable variants are listed here.
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
  ["caldwell-conversion-pistol", "Caldwell Conversion Pistol", 1, 55, "medium", "Pistols"],
  ["scottfield-model-3", "Scottfield Model 3", 1, 77, "medium", "Pistols"],
  ["bornheim-no-3", "Bornheim No. 3", 1, 146, "compact", "Pistols"],
  ["caldwell-pax", "Caldwell Pax", 1, 80, "medium", "Pistols"],
  ["hand-crossbow", "Hand Crossbow", 1, 30, "hxbow", "Bows"],
  ["cavalry-saber", "Cavalry Saber", 1, 50, "none", "Melee"],
  ["combat-axe", "Combat Axe", 2, 40, "none", "Melee"],
  ["railroad-hammer", "Railroad Hammer", 2, 45, "none", "Melee"],
  ["lemat-mark-ii", "LeMat Mark II", 1, 83, "compact", "Pistols"],
  ["sparks-pistol", "Sparks Pistol", 1, 155, "long", "Pistols"],
  ["caldwell-conversion-uppercut", "Caldwell Conversion Uppercut", 2, 310, "long", "Pistols"],
  ["nagant-officer-carbine", "Nagant Officer Carbine", 3, 183, "compact", "Rifles"],
  ["hunting-bow", "Hunting Bow", 3, 57, "bow", "Bows"],
  ["dolch-96", "Dolch 96", 2, 690, "special", "Pistols"],
  ["springfield-1866", "Springfield 1866", 4, 38, "medium", "Rifles"],
  ["winfield-m1873c", "Winfield M1873C", 3, 44, "compact", "Rifles"],
  ["winfield-m1873", "Winfield M1873", 4, 75, "compact", "Rifles"],
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
  ["caldwell-rival-78", "Caldwell Rival 78", 4, 170, "shotgun", "Shotguns"],
  ["vetterli-71-karabiner", "Vetterli 71 Karabiner", 3, 105, "medium", "Rifles"],
  ["specter-1882", "Specter 1882", 4, 188, "shotgun", "Shotguns"],
  ["slate", "Slate", 4, 313, "shotgun", "Shotguns"],
  ["sparks-lrr", "Sparks LRR", 4, 130, "long", "Rifles"],
  ["martini-henry-ic1", "Martini-Henry IC1", 4, 122, "long", "Rifles"],
  ["winfield-1876-centennial", "Winfield 1876 Centennial", 4, 157, "medium", "Rifles"],
  ["berthier-1892", "Berthier 1892", 3, 380, "slong", "Rifles"],
  ["drilling", "Drilling", 4, 510, "shotgun", "Shotguns"],
  ["krag-m1894", "Krag M1894", 4, 450, "slong", "Rifles"],
  ["mosin-nagant-m1891", "Mosin-Nagant M1891", 4, 620, "slong", "Rifles"],
  ["lebel-1886", "Lebel 1886", 4, 397, "slong", "Rifles"],
  ["crown-king-auto-5", "Crown & King Auto-5", 5, 600, "shotgun", "Shotguns"],
  ["mosin-nagant-avtomat", "Mosin-Nagant Avtomat", 5, 1250, "slong", "Rifles"],
  ["nitro-express", "Nitro Express", 5, 1015, "special", "Rifles"],
  // Update 2.8 additions — appended (never inserted) so legacy index-based
  // encodings keep resolving to the same items they did before (issue #35/#36).
  ["haymaker", "Haymaker", 2, 279, "long", "Pistols"],
  ["1890-cavalry", "1890 Cavalry", 3, 56, "long", "Rifles"],
  // Moved out of TOOLS 2026-08-12 (#156). The wiki files it at /wiki/Weapons/Katana as a
  // two-handed melee weapon — "Two-handed, single-edged sword" — and modelling it as a Tool was a
  // live budget error in both directions: it cost none of capMax()'s weapon size while consuming one
  // of the eight equipment cells it should never touch.
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
  ["decoys", "Decoys", 6, "Utility"],
  ["blank-fire-decoys", "Blank Fire Decoys", 45, "Utility"],
  ["decoy-fuses", "Decoy Fuses", 30, "Utility"],
  ["alert-trip-mine", "Alert Trip Mine", 30, "Traps"],
  ["concertina-trip-mine", "Concertina Trip Mine", 90, "Traps"],
  ["poison-trip-mine", "Poison Trip Mine", 30, "Traps"],
  ["quad-derringer", "Quad Derringer", 30, "Utility"],
  // Update 2.8 additions — appended (never inserted) so legacy index-based
  // encodings keep resolving to the same items they did before (issue #35/#38).
  // Choke Beetle / Stalker Beetle moved to CONS below; loadoutCodec.js's legacy
  // decoder explicitly drops their old tool-slot positions (18/19) rather than
  // letting them silently resolve to these new entries.
  ["throwing-spear", "Throwing Spear", 80, "Throwing"],
  ["knuckle-knife", "Knuckle Knife", 50, "Melee"],
  ["choke-bombs", "Choke Bombs", 25, "Utility"],
  ["derringer-pennyshot", "Derringer Pennyshot", 63, "Utility"],
  ["bear-traps", "Bear Traps", 70, "Traps"],
];

export const TOOL_GROUPS = ["Medical", "Melee", "Throwing", "Traps", "Utility"];

// ROSTER BOUNDARY — why this table is 30 rows against the wiki's 54.
//
// The catalog carries what a player can BUY WITH HUNT DOLLARS, because that is what a dollar-cost
// planner can price. Everything excluded is excluded on that ground and no other. A discovery crawl
// (`node scripts/scrape-stats.mjs --discover`) resolves the 24-page difference exactly:
//
//   14  Tarot Cards       — live pages, but each states its price as the literal word "Scarce".
//                           Found in-world at Bileweaver compounds, Postal Supply, Clockmaker's
//                           Supply and Sealed Hoards; they have no Hunt Dollar price to plan with.
//   10  removed items     — Proof Vapours, Wormseed Shots, Reliquaries. Pages still exist; the
//                           items do not.
//    0  actually missing  — the purchasable consumable roster is COMPLETE.
//
// Note the reason is purchasability, NOT "limited-time event item". That earlier framing (077e747)
// carried its own revisit trigger and Update 2.8.1 fired it: Tarot Cards are permanent now. They
// stay out anyway, because permanence was never the criterion. This is the same judgment already
// recorded for AMMO.special, where Dolch and Nitro custom ammo is excluded for being Scarce.
//
// The accepted limit: Tarot Cards occupy equipment slots and have their own 4-per-loadout cap
// category, so a loadout built here can never be quite the loadout a player fields. That is a
// stated limit of a dollar-cost planner rather than a defect to fix.
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
];

export const CONS_GROUPS = ["Shots", "Explosives", "Fire", "Gas", "Utility"];

/**
 * The `type` field's value set (`CONS[i][3]`), which is NOT the UI bucket — that is `group`
 * (`CONS[i][4]`) and `CONS_GROUPS` above.
 *
 * `Placeable` added 2026-08-12 (#155). Ammo Box, Tool Box and Medical Pack were filed as `Throwable`
 * and `Shot`; all three are `Category:Placeable_Consumables` on the wiki. Medical Pack is the
 * instructive one — the wiki files it under BOTH `Placeable Consumables` (a cap category) and
 * `Healing Consumables` (an effect category), and the app had taken the effect one.
 *
 * Read what this field is and is not, because the issue that reported the misfiling described it as a
 * rules input and it no longer is. `calc.js` once had a `catCount()` that capped four *per type*;
 * #190 replaced it with per-item `consCount`, and SPEC-0008 now specifies that outright — "counted
 * per specific consumable rather than per consumable type". So a wrong value here cannot
 * over-constrain or under-constrain a loadout any more. Its consumers are all display: the badge
 * colours below, the badge label itself, and the picker's meta line. The fix is for accuracy, and
 * `catalog.test.js` pins the cap as per-item so the retired rule is not reintroduced on the strength
 * of that stale description.
 *
 * `Shot` is retained and is knowingly not a wiki category: the wiki has no `Shot Consumables`, and
 * Vitality Shot is filed only under `Healing Consumables`. So this set mixes two of the game's cap
 * categories with one of our own naming. Recorded rather than silently corrected, because collapsing
 * `Shot` would change ten rows for no behavioural gain while this field drives only colour.
 */
export const CONS_TYPES = ["Shot", "Throwable", "Placeable"];

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
  ["mithridatist", "Mithridatist", 3, "Medical"],
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
