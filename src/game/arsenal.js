/**
 * arsenal.js — the 30 base weapons, plus the evolved forms.
 *
 * WHY THIS IS A BINDING LAYER AND NOT 30 NEW fire() FUNCTIONS
 * -----------------------------------------------------------
 * The engine already has 22 tested delivery behaviours (weaponBases.js) — a
 * bolt, a cone, an orbit, a mine, a companion, a chaining arc, and so on. Each
 * of the 30 weapons below is a *presentation and tuning* layer over one of
 * those: its own art, its own name, its own numbers, its own category. What it
 * is emphatically NOT is a second implementation of "fire a projectile".
 *
 * That is the difference between an arsenal that works the moment you plug it
 * in and 30 data stubs that need a month of engine work behind them. It also
 * means a balance fix to the orbit behaviour fixes Orbiting Blades and Fire
 * Shield at once, instead of drifting apart in two places.
 *
 * Each entry:
 *   id         stable key, used by the inventory and the evolution map
 *   name       display name
 *   category   for UI grouping
 *   behavior   which engine base delivers it (see weaponBases.js)
 *   art        which matrix set draws it (see pixelArt/weaponArt.js)
 *   mods       engine modifiers baked in — this is how Poison Dart differs
 *              from Shadow Dagger without either needing custom code
 *   stats      per-weapon overrides on the behaviour's own numbers
 *   scaling    what each of the 8 levels adds
 */

import { buildWeapon } from './weaponGen.js';
import { WEAPON_ART, EVOLVED_ART, registerAllWeaponArt } from './pixelArt/weaponArt.js';
import { registerAllPassiveArt } from './pixelArt/passiveArt.js';

export const CATEGORY = {
  PROJECTILE: 'Projectile',
  AOE: 'Area of Effect',
  ORBITAL: 'Orbital & Close Range',
  SUMMON: 'Companion & Summon',
  MELEE: 'Melee',
  TACTICAL: 'Tactical & Experimental',
};

/** Standard per-level growth. Overridden per weapon where the fantasy needs it. */
const DEFAULT_SCALING = { damage: 0.14, cooldown: -0.04 };

export const WEAPONS_30 = [

  // === PROJECTILE TYPES (1-8) =============================================

  {
    id: 'fire_wand', name: 'Fire Wand', category: CATEGORY.PROJECTILE,
    behavior: 'splinter', art: 'fire_wand', mods: ['burn'],
    blurb: 'Fires a bolt that burns on impact, dealing damage over time.',
    stats: { damage: 13, cooldown: 0.5, projectileSpeed: 620 },
    scaling: { damage: 0.16, cooldown: -0.045 },
  },
  {
    id: 'shadow_dagger', name: 'Shadow Dagger', category: CATEGORY.PROJECTILE,
    behavior: 'splinter', art: 'shadow_dagger', mods: ['pierce', 'rapid'],
    blurb: 'Fast, frequent throws that pierce through 2 enemies.',
    stats: { damage: 8, cooldown: 0.3, projectileSpeed: 780 },
    scaling: { damage: 0.12, cooldown: -0.05 },
  },
  {
    id: 'cross_boomerang', name: 'Cross Boomerang', category: CATEGORY.PROJECTILE,
    behavior: 'boomerang', art: 'cross_boomerang', mods: [],
    blurb: 'Flies out and returns, hitting enemies on both the outbound and return trip.',
    stats: { damage: 16, cooldown: 1.0 },
    scaling: { damage: 0.15, cooldown: -0.04 },
  },
  {
    id: 'heroic_bow', name: 'Heroic Bow', category: CATEGORY.PROJECTILE,
    behavior: 'rail', art: 'heroic_bow', mods: [],
    blurb: 'A slow, heavy shot that pierces through every enemy in its path.',
    stats: { damage: 24, cooldown: 1.2, projectileSpeed: 1400 },
    scaling: { damage: 0.18, cooldown: -0.04 },
  },
  {
    id: 'bone_tosser', name: 'Bone Tosser', category: CATEGORY.PROJECTILE,
    behavior: 'boomerang', art: 'bone_tosser', mods: ['multishot'],
    blurb: 'Throws a spread of bones that arc back toward you.',
    stats: { damage: 11, cooldown: 1.15 },
    scaling: { damage: 0.13, cooldown: -0.04 },
  },
  {
    id: 'magic_missile', name: 'Magic Missile', category: CATEGORY.PROJECTILE,
    behavior: 'seeker', art: 'magic_missile', mods: [],
    blurb: 'Homing shots that steer toward the nearest enemy.',
    stats: { damage: 12, cooldown: 0.75 },
    scaling: { damage: 0.14, cooldown: -0.04 },
  },
  {
    id: 'poison_dart', name: 'Poison Dart', category: CATEGORY.PROJECTILE,
    behavior: 'splinter', art: 'poison_dart', mods: ['venom'],
    blurb: 'Low direct damage, but poisons on hit for damage over time.',
    stats: { damage: 6, cooldown: 0.62, projectileSpeed: 700 },
    scaling: { damage: 0.11, cooldown: -0.04 },
  },
  {
    id: 'laser_pistol', name: 'Laser Pistol', category: CATEGORY.PROJECTILE,
    behavior: 'rail', art: 'laser_pistol', mods: ['rapid'],
    blurb: 'Very fast, low-damage shots fired in rapid bursts.',
    stats: { damage: 15, cooldown: 0.66, projectileSpeed: 1800 },
    scaling: { damage: 0.13, cooldown: -0.05 },
  },

  // === AREA OF EFFECT (9-16) ==============================================

  {
    id: 'holy_aura', name: 'Holy Aura', category: CATEGORY.AOE,
    behavior: 'aura', art: 'holy_aura', mods: [],
    blurb: 'A burning ring around you that damages anything standing in it.',
    stats: { damage: 8, cooldown: 0.45, radius: 122 },
    scaling: { damage: 0.13, radius: 0.06 },
  },
  {
    id: 'santa_water', name: 'Santa Water', category: CATEGORY.AOE,
    behavior: 'rupture', art: 'santa_water', mods: [],
    blurb: 'A thrown flask that shatters into a burning patch of ground.',
    stats: { damage: 14, cooldown: 2.0, radius: 78, duration: 3.6 },
    scaling: { damage: 0.15, duration: 0.08 },
  },
  {
    id: 'sonic_wave', name: 'Sonic Wave', category: CATEGORY.AOE,
    behavior: 'quake', art: 'sonic_wave', mods: ['force'],
    blurb: 'Expanding shockwave rings that knock enemies back.',
    stats: { damage: 17, cooldown: 1.5 },
    scaling: { damage: 0.14, cooldown: -0.045 },
  },
  {
    id: 'gravity_bomb', name: 'Gravity Bomb', category: CATEGORY.AOE,
    behavior: 'nova', art: 'gravity_bomb', mods: ['force'],
    blurb: 'A heavy explosion that pulls nearby enemies toward its center before it detonates.',
    stats: { damage: 36, cooldown: 1.9, radius: 110 },
    scaling: { damage: 0.17, radius: 0.05 },
  },
  {
    id: 'earthquake_stomp', name: 'Earthquake Stomp', category: CATEGORY.AOE,
    behavior: 'quake', art: 'earthquake_stomp', mods: ['broad'],
    blurb: 'A wide ring of ground damage that spreads outward from you.',
    stats: { damage: 21, cooldown: 2.1 },
    scaling: { damage: 0.16, cooldown: -0.04 },
  },
  {
    id: 'acid_spray', name: 'Acid Spray', category: CATEGORY.AOE,
    behavior: 'scattergun', art: 'acid_spray', mods: ['venom'],
    blurb: 'A short-range spray of acid — heavy damage up close, useless at range.',
    stats: { damage: 7, cooldown: 0.9 },
    scaling: { damage: 0.12, cooldown: -0.04 },
  },
  {
    id: 'blizzard_scroll', name: 'Blizzard Scroll', category: CATEGORY.AOE,
    behavior: 'rupture', art: 'blizzard_scroll', mods: ['frost'],
    blurb: 'Drops a frost field that slows every enemy standing in it.',
    stats: { damage: 10, cooldown: 2.3, radius: 92, duration: 3.0 },
    scaling: { damage: 0.13, radius: 0.06 },
  },
  {
    id: 'mine_layer', name: 'Mine Layer', category: CATEGORY.AOE,
    behavior: 'mine', art: 'mine_layer', mods: [],
    blurb: 'Drops timed mines behind you that explode after a short delay.',
    stats: { damage: 44, cooldown: 2.4, radius: 80 },
    scaling: { damage: 0.16, cooldown: -0.05 },
  },

  // === ORBITALS & CLOSE RANGE (17-22) =====================================

  {
    id: 'orbiting_blades', name: 'Orbiting Blades', category: CATEGORY.ORBITAL,
    behavior: 'orbit', art: 'orbiting_blades', mods: [],
    blurb: 'Blades orbit around you, damaging anything they pass through.',
    stats: { damage: 12 },
    scaling: { damage: 0.15, count: 0.25 },
  },
  {
    id: 'garlic_shield', name: 'Garlic Shield', category: CATEGORY.ORBITAL,
    behavior: 'aura', art: 'garlic_shield', mods: ['force'],
    blurb: 'An always-on damage aura in close range around you.',
    stats: { damage: 6, cooldown: 0.38, radius: 96 },
    scaling: { damage: 0.12, radius: 0.07 },
  },
  {
    // Category is MELEE, not ORBITAL, even though this entry used to sit
    // among the orbit/aura weapons in this file: the old rotating-wedge Whip
    // was replaced (see weaponMelee.js) with an aimed, directional lash that
    // behaves nothing like an orbital/aura weapon, but the category tag was
    // never updated to follow. Left at ORBITAL, it showed up filed under
    // "Orbital & Close Range" in the Stash's type filter and any UI grouping
    // by category, next to weapons that are automatic and need no aim at
    // all — which is exactly what made it read as broken to a player picking
    // it expecting orbital-style behavior.
    id: 'whip', name: 'Whip', category: CATEGORY.MELEE,
    behavior: 'lash', art: 'whip', mods: [],
    blurb: 'A long-range forward crack that hits everything in its arc.',
    stats: { damage: 20, cooldown: 0.55 },
    scaling: { damage: 0.15, cooldown: -0.045 },
  },
  {
    id: 'plasma_ring', name: 'Plasma Ring', category: CATEGORY.ORBITAL,
    behavior: 'aura', art: 'plasma_ring', mods: ['chain'],
    blurb: 'A close ring that chains lightning to enemies near whatever it hits.',
    stats: { damage: 9, cooldown: 0.5, radius: 108 },
    scaling: { damage: 0.14, radius: 0.05 },
  },
  {
    id: 'fire_shield', name: 'Fire Shield', category: CATEGORY.ORBITAL,
    behavior: 'orbit', art: 'fire_shield', mods: ['burn'],
    blurb: 'Three fireballs orbit close around you, burning on contact.',
    stats: { damage: 10 },
    scaling: { damage: 0.14, count: 0.2 },
  },
  {
    id: 'spike_armor', name: 'Spike Armor', category: CATEGORY.ORBITAL,
    behavior: 'aura', art: 'spike_armor', mods: ['shred'],
    blurb: 'Spikes around you damage and strip armor from anything that touches you.',
    stats: { damage: 11, cooldown: 0.6, radius: 74 },
    scaling: { damage: 0.15, radius: 0.04 },
  },

  // === COMPANIONS & SUMMONS (23-26) =======================================

  {
    id: 'drone_helper', name: 'Drone Helper', category: CATEGORY.SUMMON,
    behavior: 'companion', art: 'drone_helper', mods: [],
    blurb: 'A drone companion that follows you and fires at nearby enemies on its own.',
    stats: { damage: 8, cooldown: 8.5, duration: 14 },
    scaling: { damage: 0.15, duration: 0.1 },
  },
  {
    id: 'ghost_familiar', name: 'Ghost Familiar', category: CATEGORY.SUMMON,
    behavior: 'companion', art: 'ghost_familiar', mods: ['pierce'],
    blurb: 'A floating companion that fires piercing shots at nearby enemies.',
    stats: { damage: 7, cooldown: 9.5, duration: 16 },
    scaling: { damage: 0.14, duration: 0.1 },
  },
  {
    id: 'haunting_skull', name: 'Haunting Skull', category: CATEGORY.SUMMON,
    behavior: 'companion', art: 'haunting_skull', mods: ['homing'],
    blurb: 'A homing companion that locks onto and chases a single enemy.',
    stats: { damage: 9, cooldown: 10, duration: 13 },
    scaling: { damage: 0.16, duration: 0.08 },
  },
  {
    id: 'attack_bud', name: 'Attack Bud', category: CATEGORY.SUMMON,
    behavior: 'turret', art: 'attack_bud', mods: [],
    blurb: 'Plants a stationary turret that automatically fires at enemies in range.',
    stats: { damage: 10, cooldown: 4.0, duration: 9 },
    scaling: { damage: 0.15, duration: 0.1 },
  },


  // === MELEE (31-36) =======================================================
  //
  // Added because the roster was almost entirely ranged, which made every
  // build play at the same distance. Melee is the answer to that: it trades
  // all reach for damage density, so a melee build has to solve the crowd by
  // moving *through* it rather than away from it.

  {
    id: 'rift_cleaver', name: 'Rift Cleaver', category: CATEGORY.MELEE,
    behavior: 'swing', art: 'rift_cleaver', mods: [],
    blurb: 'A slow, heavy melee swing that hits everything in a wide arc in front of you.',
    stats: { damage: 32, cooldown: 0.62, range: 132, arc: 1.9 },
    scaling: { damage: 0.17, range: 0.04 },
  },
  {
    id: 'warden_pike', name: 'Warden Pike', category: CATEGORY.MELEE,
    behavior: 'thrust', art: 'warden_pike', mods: ['pierce'],
    blurb: 'A long, narrow thrust that pierces through everything in a line.',
    stats: { damage: 40, cooldown: 0.74, range: 215, arc: 0.42 },
    scaling: { damage: 0.17, range: 0.05 },
  },
  {
    id: 'breaker_maul', name: 'Breaker Maul', category: CATEGORY.MELEE,
    behavior: 'slam', art: 'breaker_maul', mods: ['force'],
    blurb: 'A melee slam that damages and knocks back everything in range.',
    stats: { damage: 48, cooldown: 1.3, range: 142 },
    scaling: { damage: 0.18, range: 0.05 },
  },
  {
    id: 'ichor_lash', name: 'Ichor Lash', category: CATEGORY.MELEE,
    behavior: 'lash', art: 'ichor_lash', mods: ['venom'],
    blurb: 'A long-range melee whip that poisons enemies on hit.',
    stats: { damage: 24, cooldown: 0.5, range: 240 },
    scaling: { damage: 0.15, range: 0.05 },
  },
  {
    id: 'twin_fangs', name: 'Twin Fangs', category: CATEGORY.MELEE,
    behavior: 'swing', art: 'twin_fangs', mods: ['rapid', 'leech'],
    blurb: 'Fast dual-blade swings that heal you for a portion of the damage dealt.',
    stats: { damage: 15, cooldown: 0.3, range: 104, arc: 1.5 },
    scaling: { damage: 0.14, cooldown: -0.05 },
  },
  {
    id: 'gravedigger', name: 'Gravedigger', category: CATEGORY.MELEE,
    behavior: 'slam', art: 'gravedigger', mods: ['bloom'],
    blurb: 'A slow, wide melee swing — anything it kills explodes.',
    stats: { damage: 42, cooldown: 1.45, range: 150 },
    scaling: { damage: 0.18, range: 0.04 },
  },

  // === TACTICAL & EXPERIMENTAL (27-30) ====================================

  {
    id: 'chrono_pocket', name: 'Chrono Pocket', category: CATEGORY.TACTICAL,
    behavior: 'aura', art: 'chrono_pocket', mods: ['frost'],
    blurb: 'A field around you that slows and damages every enemy standing in it.',
    stats: { damage: 5, cooldown: 0.55, radius: 130 },
    scaling: { damage: 0.11, radius: 0.08 },
  },
  {
    id: 'electric_fence', name: 'Electric Fence', category: CATEGORY.TACTICAL,
    behavior: 'turret', art: 'electric_fence', mods: ['chain'],
    blurb: 'Places nodes that arc lightning between each other and anything between them.',
    stats: { damage: 8, cooldown: 4.4, duration: 10 },
    scaling: { damage: 0.15, duration: 0.09 },
  },
  {
    id: 'coin_gun', name: 'Coin Gun', category: CATEGORY.TACTICAL,
    behavior: 'scattergun', art: 'coin_gun', mods: ['keen'],
    blurb: 'Fires coins with a much higher critical hit chance than normal.',
    stats: { damage: 8, cooldown: 0.95 },
    scaling: { damage: 0.14, cooldown: -0.04 },
  },
  {
    id: 'void_rift', name: 'Void Rift', category: CATEGORY.TACTICAL,
    behavior: 'rupture', art: 'void_rift', mods: ['lingering'],
    blurb: 'Opens a damaging field that lingers and keeps pulling enemies toward its center.',
    stats: { damage: 16, cooldown: 2.4, radius: 88, duration: 4.2 },
    scaling: { damage: 0.16, duration: 0.09 },
  },

  // Not one of the numbered thirty — registered because the evolution map you
  // specified pairs it with Duplicator to make Thunder Loop. Flagged here
  // rather than silently dropped or silently folded into Electric Fence.
  {
    id: 'chain_bolt', name: 'Chain Bolt', category: CATEGORY.TACTICAL,
    behavior: 'lattice', art: 'chain_bolt', mods: [],
    blurb: 'A bolt that chains between enemies, jumping to a new target on each hit.',
    stats: { damage: 15, cooldown: 1.1 },
    scaling: { damage: 0.15, jumps: 0.2 },
    extra: true,
  },
];

/** The evolved forms. Same shape, plus the base they replace. */
export const EVOLVED_WEAPONS = [
  {
    id: 'hellfire_meteor', name: 'Hellfire Meteor', category: CATEGORY.PROJECTILE,
    behavior: 'seeder', art: 'hellfire_meteor', mods: ['burn', 'explosive'],
    blurb: 'A planted meteor that detonates in a massive burning explosion.',
    stats: { damage: 78, cooldown: 1.5, radius: 130, fuse: 0.6 },
    scaling: { damage: 0.18, radius: 0.06 },
    evolved: true,
  },
  {
    id: 'vortex_shields', name: 'Vortex Shields', category: CATEGORY.ORBITAL,
    behavior: 'orbit', art: 'vortex_shields', mods: ['broad', 'force'],
    blurb: 'Six blades orbit you in an unbroken ring, blocking and damaging everything nearby.',
    stats: { damage: 30, count: 6 },
    scaling: { damage: 0.18, count: 0.3 },
    evolved: true,
  },
  {
    id: 'thunder_loop', name: 'Thunder Loop', category: CATEGORY.TACTICAL,
    behavior: 'lattice', art: 'thunder_loop', mods: ['echo', 'chain'],
    blurb: 'Chains lightning between enemies, striking each target twice.',
    stats: { damage: 34, cooldown: 0.85, jumps: 7 },
    scaling: { damage: 0.18, jumps: 0.35 },
    evolved: true,
  },
  {
    // Same fix as its base weapon (Whip, above): 'lash' is an aimed
    // directional crack, not an orbit, so this belongs under MELEE.
    id: 'bloody_tear', name: 'Bloody Tear', category: CATEGORY.MELEE,
    behavior: 'lash', art: 'bloody_tear', mods: ['keen', 'leech'],
    blurb: 'A blindingly fast whip-crack with a greatly increased critical hit chance.',
    stats: { damage: 46, cooldown: 0.42 },
    scaling: { damage: 0.18, cooldown: -0.05 },
    evolved: true,
  },
  {
    id: 'soul_eater', name: 'Soul Eater', category: CATEGORY.ORBITAL,
    behavior: 'aura', art: 'soul_eater', mods: ['leech', 'broad'],
    blurb: 'A wide damaging vortex around you that heals you for a portion of the damage dealt.',
    stats: { damage: 20, cooldown: 0.32, radius: 168 },
    scaling: { damage: 0.18, radius: 0.08 },
    evolved: true,
  },
];

export const ALL_WEAPONS = [...WEAPONS_30, ...EVOLVED_WEAPONS];
export const WEAPON_BY_ID = new Map(ALL_WEAPONS.map((w) => [w.id, w]));

/** The thirty proper, for UI that should not list evolutions or Chain Bolt. */
export const BASE_THIRTY = WEAPONS_30.filter((w) => w.extra !== true);

// ---------------------------------------------------------------------------
// Engine binding
// ---------------------------------------------------------------------------

/**
 * Resolve one arsenal entry into a live engine weapon definition.
 *
 * The engine's `buildWeapon(behaviour, mods)` already handles composition,
 * stat folding and sprite minting; this layers the weapon's own numbers, name
 * and art on top of what comes back. Levels are applied as a multiplier on the
 * *resolved* def, so a level-8 Fire Wand and a level-1 Fire Wand are the same
 * definition with different numbers rather than two definitions.
 */
export function resolveWeapon(id, level = 1) {
  const entry = WEAPON_BY_ID.get(id);
  if (entry === undefined) return null;

  const def = buildWeapon(entry.behavior, entry.mods ?? []);
  if (def === null) return null;

  const scaling = { ...DEFAULT_SCALING, ...(entry.scaling ?? {}) };
  const steps = Math.max(0, level - 1);

  // Start from the engine def's numbers, apply this weapon's overrides, then
  // apply level scaling. Order matters: an override is the weapon's identity,
  // scaling is how far along it is.
  const base = { ...def.base, ...(entry.stats ?? {}) };
  for (const [stat, per] of Object.entries(scaling)) {
    if (base[stat] === undefined) continue;
    // Negative scaling (cooldown) shrinks multiplicatively and is floored, so
    // a maxed weapon speeds up a lot without ever reaching a zero cooldown —
    // which would be an infinite loop, not a fast weapon.
    if (per < 0) base[stat] = Math.max(base[stat] * 0.25, base[stat] * (1 + per * steps));
    else base[stat] = base[stat] * (1 + per * steps);
  }

  return {
    ...def,
    id: 'arsenal:' + id,
    arsenalId: id,
    name: entry.name,
    blurb: entry.blurb,
    category: entry.category,
    level,
    base,
    art: entry.art,
    evolved: entry.evolved === true,
  };
}

/** Register every weapon's (and every passive's) pixel art. Call once at boot. */
let artReady = false;
export function registerArsenalArt() {
  if (artReady) return;
  artReady = true;
  registerAllPassiveArt();
  return registerAllWeaponArt();
}

/** Sanity check used by tests: every entry has art and a real behaviour. */
export function auditArsenal() {
  const problems = [];
  for (const w of ALL_WEAPONS) {
    const art = WEAPON_ART[w.art] ?? EVOLVED_ART[w.art];
    if (art === undefined) problems.push({ id: w.id, issue: 'missing art: ' + w.art });
    if (resolveWeapon(w.id) === null) problems.push({ id: w.id, issue: 'behaviour did not resolve: ' + w.behavior });
  }
  return problems;
}
