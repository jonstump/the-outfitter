// Game data ported from the original Loadout Builder prototype.
// Weapon tuple shape: [name, size, cost, ammoClass, group]
// Tool tuple shape: [name, cost, group]
// Consumable tuple shape: [name, cost, category, group]
// Trait tuple shape: [name, up, group]

export const AMMO = {
  compact: [["FMJ", 15], ["High Velocity", 13], ["Dumdum", 22], ["Incendiary", 18], ["Poison", 16]],
  medium: [["FMJ", 22], ["Spitzer", 60], ["Dumdum", 28], ["Incendiary", 24], ["Poison", 21]],
  long: [["FMJ", 30], ["Spitzer", 75], ["Dumdum", 34], ["Incendiary", 28]],
  slong: [["FMJ", 35], ["Spitzer", 90], ["Incendiary", 32]],
  shotgun: [["Slug", 28], ["Flechette", 26], ["Penny Shot", 22], ["Dragon Breath", 30], ["Starshell", 18]],
  xbow: [["Explosive Bolt", 40], ["Shot Bolt", 30], ["Poison Bolt", 25]],
  hxbow: [["Chaos Bolt", 20], ["Concertina Bolt", 35], ["Choke Bolt", 25]],
  bow: [["Frag Arrow", 45], ["Concertina Arrow", 35], ["Poison Arrow", 25]],
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
  none: "Melee",
};

export const WEAPONS = [
  ["Nagant M1895", 1, 30, "compact", "Pistols"], ["Caldwell Conversion Pistol", 1, 34, "medium", "Pistols"], ["Scottfield Model 3", 1, 68, "medium", "Pistols"],
  ["Bornheim No. 3", 1, 99, "compact", "Pistols"], ["Caldwell Pax", 1, 100, "medium", "Pistols"], ["Hand Crossbow", 1, 40, "hxbow", "Bows"],
  ["Cavalry Saber", 2, 28, "none", "Melee"], ["Combat Axe", 2, 30, "none", "Melee"], ["Railroad Hammer", 2, 45, "none", "Melee"],
  ["LeMat Mark II", 2, 120, "compact", "Pistols"], ["Sparks Pistol", 2, 100, "long", "Pistols"], ["Caldwell Conversion Uppercut", 2, 275, "long", "Pistols"],
  ["Nagant Officer Carbine", 2, 109, "compact", "Rifles"], ["Hunting Bow", 2, 90, "bow", "Bows"], ["Dolch 96", 2, 400, "compact", "Pistols"],
  ["Springfield 1866", 3, 33, "medium", "Rifles"], ["Winfield M1873C", 3, 44, "compact", "Rifles"], ["Winfield M1873", 3, 63, "compact", "Rifles"],
  ["Romero 77", 3, 60, "shotgun", "Shotguns"], ["Crossbow", 3, 60, "xbow", "Bows"], ["Frontier 73C", 3, 72, "medium", "Rifles"],
  ["Bomb Lance", 3, 75, "none", "Melee"], ["Caldwell Rival 78", 3, 125, "shotgun", "Shotguns"], ["Vetterli 71 Karabiner", 3, 152, "medium", "Rifles"],
  ["Specter 1882", 3, 168, "shotgun", "Shotguns"], ["Slate", 3, 190, "shotgun", "Shotguns"],
  ["Sparks LRR", 4, 130, "long", "Rifles"], ["Martini-Henry IC1", 4, 155, "long", "Rifles"], ["Winfield 1876 Centennial", 4, 188, "medium", "Rifles"],
  ["Berthier 1892", 4, 245, "slong", "Rifles"], ["Drilling", 4, 275, "shotgun", "Shotguns"], ["Krag M1894", 4, 452, "slong", "Rifles"],
  ["Mosin-Nagant M1891", 4, 490, "slong", "Rifles"], ["Lebel 1886", 4, 510, "slong", "Rifles"], ["Crown & King Auto-5", 4, 600, "shotgun", "Shotguns"],
  ["Mosin-Nagant Avtomat", 5, 1000, "slong", "Rifles"], ["Nitro Express", 5, 1470, "long", "Rifles"],
];

export const WEAPON_GROUPS = ["Pistols", "Rifles", "Shotguns", "Melee", "Bows"];

export const TOOLS = [
  ["First Aid Kit", 30, "Medical"], ["Knife", 30, "Melee"], ["Heavy Knife", 15, "Melee"], ["Dusters", 15, "Melee"],
  ["Throwing Knives", 30, "Throwing"], ["Throwing Axes", 45, "Throwing"], ["Katana", 100, "Melee"],
  ["Flare Pistol", 35, "Utility"], ["Fusees", 20, "Utility"], ["Electric Lamp", 20, "Utility"], ["Spyglass", 10, "Utility"],
  ["Decoys", 10, "Utility"], ["Blank Fire Decoys", 60, "Utility"], ["Decoy Fuses", 30, "Utility"],
  ["Alert Trip Mine", 45, "Traps"], ["Concertina Trip Mine", 55, "Traps"], ["Poison Trip Mine", 55, "Traps"],
  ["Quad Derringer", 40, "Utility"], ["Choke Beetle", 40, "Traps"], ["Stalker Beetle", 25, "Utility"],
];

export const TOOL_GROUPS = ["Medical", "Melee", "Throwing", "Traps", "Utility"];

export const CONS = [
  ["Vitality Shot", 60, "Shot", "Shots"], ["Regeneration Shot", 185, "Shot", "Shots"], ["Stamina Shot", 15, "Shot", "Shots"], ["Antidote Shot", 25, "Shot", "Shots"],
  ["Dynamite Stick", 40, "Throwable", "Explosives"], ["Dynamite Bundle", 90, "Throwable", "Explosives"], ["Big Dynamite Bundle", 150, "Throwable", "Explosives"],
  ["Frag Bomb", 100, "Throwable", "Explosives"], ["Sticky Bomb", 80, "Throwable", "Explosives"],
  ["Fire Bomb", 40, "Throwable", "Fire"], ["Liquid Fire Bomb", 75, "Throwable", "Fire"],
  ["Hive Bomb", 90, "Throwable", "Gas"], ["Chaos Bomb", 25, "Throwable", "Utility"], ["Choke Bomb", 25, "Throwable", "Gas"],
  ["Flash Bomb", 40, "Throwable", "Utility"], ["Concertina Bomb", 60, "Throwable", "Utility"],
];

export const CONS_GROUPS = ["Shots", "Explosives", "Fire", "Gas", "Utility"];

export const TRAITS = [
  ["Quartermaster", 8, "Utility"], ["Fanning", 7, "Combat"], ["Levering", 4, "Combat"], ["Doctor", 7, "Medical"], ["Physician", 3, "Medical"],
  ["Packmule", 2, "Utility"], ["Frontiersman", 2, "Utility"], ["Greyhound", 5, "Mobility"], ["Kiteskin", 1, "Mobility"], ["Lightfoot", 3, "Stealth"],
  ["Pitcher", 3, "Combat"], ["Bulletgrubber", 2, "Combat"], ["Iron Repeater", 2, "Combat"], ["Bolt Thrower", 5, "Combat"],
  ["Serpent", 3, "Utility"], ["Ghoul", 5, "Medical"], ["Determination", 4, "Medical"], ["Resilience", 5, "Medical"], ["Salveskin", 4, "Medical"],
  ["Necromancer", 5, "Medical"], ["Beastface", 3, "Stealth"], ["Hundred Hands", 3, "Combat"], ["Steady Aim", 2, "Combat"],
  ["Silent Killer", 2, "Stealth"], ["Vulture", 1, "Utility"], ["Whispersmith", 2, "Stealth"], ["Poison Sense", 1, "Stealth"],
  ["Conduit", 2, "Utility"], ["Magpie", 1, "Utility"], ["Ambidextrous", 2, "Combat"], ["Dauntless", 4, "Combat"], ["Vigilant", 1, "Utility"],
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
  const cls = w[3];
  if (cls === "none") return THUMBS.melee;
  if (cls === "bow") return THUMBS.bow;
  if (cls === "xbow" || cls === "hxbow") return THUMBS.xbow;
  if (cls === "shotgun") return THUMBS.shotgun;
  if (w[1] <= 2) return THUMBS.pistol;
  if (w[1] === 3) return THUMBS.carbine;
  return THUMBS.rifle;
}

export const QM = TRAITS.findIndex((t) => t[0] === "Quartermaster");
