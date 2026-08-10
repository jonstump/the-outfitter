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
export const WEAPONS = [
  ["nagant-m1895", "Nagant M1895", 1, 30, "compact", "Pistols"],
  ["caldwell-conversion-pistol", "Caldwell Conversion Pistol", 1, 34, "medium", "Pistols"],
  ["scottfield-model-3", "Scottfield Model 3", 1, 68, "medium", "Pistols"],
  ["bornheim-no-3", "Bornheim No. 3", 1, 99, "compact", "Pistols"],
  ["caldwell-pax", "Caldwell Pax", 1, 100, "medium", "Pistols"],
  ["hand-crossbow", "Hand Crossbow", 1, 40, "hxbow", "Bows"],
  ["cavalry-saber", "Cavalry Saber", 2, 28, "none", "Melee"],
  ["combat-axe", "Combat Axe", 2, 30, "none", "Melee"],
  ["railroad-hammer", "Railroad Hammer", 2, 45, "none", "Melee"],
  ["lemat-mark-ii", "LeMat Mark II", 2, 120, "compact", "Pistols"],
  ["sparks-pistol", "Sparks Pistol", 2, 100, "long", "Pistols"],
  ["caldwell-conversion-uppercut", "Caldwell Conversion Uppercut", 2, 275, "long", "Pistols"],
  ["nagant-officer-carbine", "Nagant Officer Carbine", 2, 109, "compact", "Rifles"],
  ["hunting-bow", "Hunting Bow", 2, 90, "bow", "Bows"],
  ["dolch-96", "Dolch 96", 2, 690, "special", "Pistols"],
  ["springfield-1866", "Springfield 1866", 3, 33, "medium", "Rifles"],
  ["winfield-m1873c", "Winfield M1873C", 3, 44, "compact", "Rifles"],
  ["winfield-m1873", "Winfield M1873", 3, 63, "compact", "Rifles"],
  ["romero-77", "Romero 77", 3, 60, "shotgun", "Shotguns"],
  ["crossbow", "Crossbow", 3, 60, "xbow", "Bows"],
  ["frontier-73c", "Frontier 73C", 3, 72, "medium", "Rifles"],
  ["bomb-lance", "Bomb Lance", 3, 75, "none", "Melee"],
  ["caldwell-rival-78", "Caldwell Rival 78", 3, 125, "shotgun", "Shotguns"],
  ["vetterli-71-karabiner", "Vetterli 71 Karabiner", 3, 152, "medium", "Rifles"],
  ["specter-1882", "Specter 1882", 3, 168, "shotgun", "Shotguns"],
  ["slate", "Slate", 3, 190, "shotgun", "Shotguns"],
  ["sparks-lrr", "Sparks LRR", 4, 130, "long", "Rifles"],
  ["martini-henry-ic1", "Martini-Henry IC1", 4, 155, "long", "Rifles"],
  ["winfield-1876-centennial", "Winfield 1876 Centennial", 4, 188, "medium", "Rifles"],
  ["berthier-1892", "Berthier 1892", 4, 245, "slong", "Rifles"],
  ["drilling", "Drilling", 4, 275, "shotgun", "Shotguns"],
  ["krag-m1894", "Krag M1894", 4, 452, "slong", "Rifles"],
  ["mosin-nagant-m1891", "Mosin-Nagant M1891", 4, 490, "slong", "Rifles"],
  ["lebel-1886", "Lebel 1886", 4, 510, "slong", "Rifles"],
  ["crown-king-auto-5", "Crown & King Auto-5", 4, 600, "shotgun", "Shotguns"],
  ["mosin-nagant-avtomat", "Mosin-Nagant Avtomat", 5, 1000, "slong", "Rifles"],
  ["nitro-express", "Nitro Express", 5, 1015, "special", "Rifles"],
  // Update 2.8 additions — appended (never inserted) so legacy index-based
  // encodings keep resolving to the same items they did before (issue #35/#36).
  ["haymaker", "Haymaker", 2, 279, "long", "Pistols"],
  ["1890-cavalry", "1890 Cavalry", 3, 56, "long", "Rifles"],
];

export const WEAPON_GROUPS = ["Pistols", "Rifles", "Shotguns", "Melee", "Bows"];

export const TOOLS = [
  ["first-aid-kit", "First Aid Kit", 30, "Medical"],
  ["knife", "Knife", 30, "Melee"],
  ["heavy-knife", "Heavy Knife", 15, "Melee"],
  ["dusters", "Dusters", 15, "Melee"],
  ["throwing-knives", "Throwing Knives", 30, "Throwing"],
  ["throwing-axes", "Throwing Axes", 45, "Throwing"],
  ["katana", "Katana", 100, "Melee"],
  ["flare-pistol", "Flare Pistol", 35, "Utility"],
  ["fusees", "Fusees", 20, "Utility"],
  ["spyglass", "Spyglass", 10, "Utility"],
  ["decoys", "Decoys", 10, "Utility"],
  ["blank-fire-decoys", "Blank Fire Decoys", 60, "Utility"],
  ["decoy-fuses", "Decoy Fuses", 30, "Utility"],
  ["alert-trip-mine", "Alert Trip Mine", 45, "Traps"],
  ["concertina-trip-mine", "Concertina Trip Mine", 55, "Traps"],
  ["poison-trip-mine", "Poison Trip Mine", 55, "Traps"],
  ["quad-derringer", "Quad Derringer", 40, "Utility"],
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

export const CONS = [
  ["vitality-shot", "Vitality Shot", 60, "Shot", "Shots"],
  ["regeneration-shot", "Regeneration Shot", 185, "Shot", "Shots"],
  ["stamina-shot", "Stamina Shot", 15, "Shot", "Shots"],
  ["antidote-shot", "Antidote Shot", 25, "Shot", "Shots"],
  ["dynamite-stick", "Dynamite Stick", 40, "Throwable", "Explosives"],
  ["dynamite-bundle", "Dynamite Bundle", 90, "Throwable", "Explosives"],
  ["big-dynamite-bundle", "Big Dynamite Bundle", 150, "Throwable", "Explosives"],
  ["frag-bomb", "Frag Bomb", 100, "Throwable", "Explosives"],
  ["sticky-bomb", "Sticky Bomb", 80, "Throwable", "Explosives"],
  ["fire-bomb", "Fire Bomb", 40, "Throwable", "Fire"],
  ["liquid-fire-bomb", "Liquid Fire Bomb", 75, "Throwable", "Fire"],
  ["hive-bomb", "Hive Bomb", 90, "Throwable", "Gas"],
  ["chaos-bomb", "Chaos Bomb", 25, "Throwable", "Utility"],
  ["choke-bomb", "Choke Bomb", 25, "Throwable", "Gas"],
  ["flash-bomb", "Flash Bomb", 40, "Throwable", "Utility"],
  ["concertina-bomb", "Concertina Bomb", 60, "Throwable", "Utility"],
  // Update 2.8 additions — appended (never inserted) so legacy index-based
  // encodings keep resolving to the same items they did before (issue #35/#37/#38).
  ["vitality-shot-weak", "Vitality Shot (Weak)", 20, "Shot", "Shots"],
  ["regeneration-shot-weak", "Regeneration Shot (Weak)", 40, "Shot", "Shots"],
  ["stamina-shot-weak", "Stamina Shot (Weak)", 60, "Shot", "Shots"],
  ["antidote-shot-weak", "Antidote Shot (Weak)", 30, "Shot", "Shots"],
  ["recovery-shot", "Recovery Shot", 140, "Shot", "Shots"],
  ["medical-pack", "Medical Pack", 35, "Shot", "Shots"],
  ["waxed-dynamite-stick", "Waxed Dynamite Stick", 24, "Throwable", "Explosives"],
  ["dark-dynamite-satchel", "Dark Dynamite Satchel", 100, "Throwable", "Explosives"],
  ["hellfire-bomb", "Hellfire Bomb", 70, "Throwable", "Explosives"],
  ["poison-bomb", "Poison Bomb", 25, "Throwable", "Gas"],
  ["ammo-box", "Ammo Box", 65, "Throwable", "Utility"],
  ["tool-box", "Tool Box", 70, "Throwable", "Utility"],
  ["choke-beetle", "Choke Beetle", 22, "Throwable", "Gas"],
  ["stalker-beetle", "Stalker Beetle", 45, "Throwable", "Utility"],
  ["fire-beetle", "Fire Beetle", 57, "Throwable", "Fire"],
];

export const CONS_GROUPS = ["Shots", "Explosives", "Fire", "Gas", "Utility"];

// UP costs re-verified against huntshowdown.wiki.gg (current through Update 2.8.1).
// Update 2.8 changed exactly three costs (Quartermaster 6->8, Frontiersman 5->6,
// Hundred Hands 2->3); the rest of the old table was stale from the 1.x/2.0 era.
// "Iron Repeater" was removed from the game (merged into Iron Eye, 3 UP, Update 1.15)
// and "Poison Sense" was renamed to "Pain Sense" (3 UP, Update 2.1). Entries are
// edited in place, never reordered, so legacy index-based encodings keep
// resolving to the same traits they did before.
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
];

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
