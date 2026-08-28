/**
 * recipes.js — what can be crafted, what it costs, and when it becomes available.
 *
 * Progression here is deliberately not a currency treadmill. A recipe unlocks
 * when you *see* a material for the first time, or when you actually reach a
 * milestone in a run — so the crafting menu grows as a record of what you've
 * managed, and an exotic recipe is something you earn access to rather than
 * something you save up for.
 */

/**
 * Crafting at a higher rarity costs a multiple of the base recipe cost, plus a
 * toll in better materials. That toll is what makes rare and exotic materials
 * meaningful rather than just another number going up.
 */
/**
 * What each rarity costs, as a multiplier on the recipe plus a flat toll.
 *
 * The flat `extra` matters more than the multiplier as you climb, and that is
 * the point: it is the *whole* cost of pushing a cheap recipe up a tier.
 * Without it, exoticising the cheapest armour would cost less than a common
 * roll of the most expensive one, which makes the cheap recipe strictly
 * correct and deletes the choice. The toll keeps every top-tier craft
 * something you earn across runs, because seven affix lines are worth far more
 * than whatever base stat the frame happens to roll.
 *
 * Cost climbs faster than power on purpose (x14 cost for roughly x2 stats at
 * the top), so the ladder stays a chase rather than a treadmill you outpace.
 */
export const RARITY_COST = {
  common:    { multiplier: 1,  extra: {} },
  uncommon:  { multiplier: 3,  extra: { slag: 15 } },
  rare:      { multiplier: 5,  extra: { alloy: 8 } },
  epic:      { multiplier: 9,  extra: { alloy: 18, ichor: 6 } },
  // Cost multipliers swapped along with Exotic/Legendary's power levels in
  // gear.js, for the same reason: cost has to track what a tier actually
  // rolls now, not what its name used to mean.
  exotic:    { multiplier: 16, extra: { ichor: 16, core: 4 } },
  mythic:    { multiplier: 24, extra: { ichor: 32, core: 9 } },
  legendary: { multiplier: 34, extra: { core: 16, ichor: 50 } },
  // Ancient's toll is the steepest by a wide margin on purpose — it is not
  // meant to be craftable back-to-back the way even a Legendary can be with
  // enough material farming.
  ancient:   { multiplier: 55, extra: { core: 30, ichor: 90 } },
};

/** Rigs: equipping one means walking into the Fracture already holding it. */
const WEAPON_RECIPES = [
  {
    id: 'r_splinter', name: 'Splinter Rig', slot: 'weapon', art: 'splinter_rig', weaponId: 'splinter',
    blurb: 'Tunes the rig every Driftwalker starts with.',
    cost: { slag: 12 },
    base: [{ stat: 'damage', type: 'inc', min: 0.10, max: 0.25, weapon: 'splinter' },
           { stat: 'cooldown', type: 'inc', min: -0.18, max: -0.06, weapon: 'splinter' }],
  },
  {
    id: 'r_scattergun', name: 'Scattergun Rig', slot: 'weapon', art: 'scattergun_rig', weaponId: 'scattergun',
    blurb: 'Walk in holding the Scattergun.',
    cost: { slag: 22, filament: 8 },
    unlock: { milestone: { totalKills: 200 } },
    base: [{ stat: 'damage', type: 'inc', min: 0.08, max: 0.22, weapon: 'scattergun' },
           { stat: 'count', type: 'flat', min: 0, max: 2, weapon: 'scattergun' }],
  },
  {
    id: 'r_orbit', name: 'Warden Rig', slot: 'weapon', art: 'orbit_rig', weaponId: 'orbit',
    blurb: 'Walk in holding the Warden Blades.',
    cost: { slag: 20, filament: 14 },
    unlock: { milestone: { totalKills: 400 } },
    base: [{ stat: 'damage', type: 'inc', min: 0.08, max: 0.22, weapon: 'orbit' },
           { stat: 'radius', type: 'inc', min: 0.05, max: 0.20, weapon: 'orbit' }],
  },
  {
    id: 'r_seeker', name: 'Seeker Rig', slot: 'weapon', art: 'lash_rig', weaponId: 'seeker',
    blurb: 'Walk in holding the Seeker.',
    cost: { filament: 24, alloy: 2 },
    unlock: { materials: ['alloy'] },
    base: [{ stat: 'damage', type: 'inc', min: 0.08, max: 0.22, weapon: 'seeker' },
           { stat: 'count', type: 'flat', min: 0, max: 1, weapon: 'seeker' }],
  },
  {
    id: 'r_lance', name: 'Lance Rig', slot: 'weapon', art: 'pike_rig', weaponId: 'lance',
    blurb: 'Walk in holding the Lance.',
    cost: { slag: 26, ichor: 3 },
    unlock: { materials: ['ichor'] },
    base: [{ stat: 'damage', type: 'inc', min: 0.10, max: 0.26, weapon: 'lance' },
           { stat: 'width', type: 'inc', min: 0.08, max: 0.25, weapon: 'lance' }],
  },
  {
    id: 'r_quake', name: 'Quake Rig', slot: 'weapon', art: 'quake_rig', weaponId: 'quake',
    blurb: 'Walk in holding Quake.',
    cost: { slag: 30, alloy: 4 },
    unlock: { milestone: { bestWave: 8 } },
    base: [{ stat: 'damage', type: 'inc', min: 0.08, max: 0.22, weapon: 'quake' },
           { stat: 'radius', type: 'inc', min: 0.06, max: 0.18, weapon: 'quake' }],
  },
  {
    id: 'r_ember', name: 'Ember Rig', slot: 'weapon', art: 'ember_rig', weaponId: 'ember',
    blurb: 'Walk in holding the Ember Trail.',
    cost: { filament: 20, ichor: 4 },
    unlock: { milestone: { bestWave: 10 } },
    base: [{ stat: 'dps', type: 'inc', min: 0.10, max: 0.28, weapon: 'ember' },
           { stat: 'radius', type: 'inc', min: 0.05, max: 0.18, weapon: 'ember' }],
  },
];

/** Suit: health, mostly a lot of it — the slot with nothing to distract from that. */
const SUIT_RECIPES = [
  {
    id: 'r_scrap_vest', name: 'Scrap Vest', slot: 'suit', art: 'scrap_vest',
    blurb: 'Bolted together from whatever the Warped left behind.',
    cost: { slag: 10 },
    base: [{ stat: 'maxHp', type: 'flat', min: 15, max: 28 }],
  },
  {
    id: 'r_plated_vest', name: 'Plated Vest', slot: 'suit', art: 'plated_vest',
    blurb: 'Heavier, and it shows. Ichor soaks in slower.',
    cost: { slag: 24, alloy: 3 },
    unlock: { materials: ['alloy'] },
    base: [{ stat: 'maxHp', type: 'flat', min: 28, max: 46 },
           { stat: 'regen', type: 'flat', min: 0.2, max: 0.6 }],
  },
  {
    id: 'r_bulwark_plate', name: 'Bulwark Plate', slot: 'suit', art: 'bulwark_plate',
    blurb: 'So much plate that moving becomes a decision rather than a reflex.',
    cost: { slag: 60, alloy: 14 },
    unlock: { milestone: { bestWave: 10 } },
    base: [{ stat: 'maxHp', type: 'flat', min: 55, max: 90 }],
  },
];

/** Belt: health, plus whatever stands between you and the next hit. */
const BELT_RECIPES = [
  {
    // No baked-in thorns — belt items can already roll the Barbed affix
    // (see gear.js's AFFIXES, `thorns` is slots:['belt']), which is where
    // the "returns some of what hits it" damage-absorption theme actually
    // comes from, the same way every other affix-driven effect in this
    // game works rather than being hardcoded per recipe.
    id: 'r_resonant_shell', name: 'Resonant Shell', slot: 'belt', art: 'resonant_shell',
    blurb: 'Cut from an Anomaly. Whatever touches you pays for it.',
    cost: { alloy: 6, ichor: 4, core: 1 },
    unlock: { materials: ['core'] },
    base: [{ stat: 'maxHp', type: 'flat', min: 40, max: 64 }],
  },
  {
    id: 'r_ashen_carapace', name: 'Ashen Carapace', slot: 'belt', art: 'ashen_carapace',
    blurb: 'Fused in a zone that never cooled. Returns some of what hits it.',
    cost: { slag: 70, ichor: 10, core: 1 },
    unlock: { milestone: { totalKills: 2500 } },
    base: [{ stat: 'maxHp', type: 'flat', min: 34, max: 58 }],
  },
];

/** Boots: health, and how fast you move around the Fracture. */
const BOOTS_RECIPES = [
  {
    id: 'r_drift_weave', name: 'Drift Weave', slot: 'boots', art: 'drift_weave',
    blurb: 'Barely there. What it does give you is speed.',
    cost: { filament: 40, alloy: 6 },
    unlock: { milestone: { bestTime: 180 } },
    base: [{ stat: 'moveSpeed', type: 'inc', min: 0.06, max: 0.14 },
           { stat: 'maxHp', type: 'flat', min: 8, max: 18 }],
  },
  {
    id: 'r_warding_charm', name: 'Warding Charm', slot: 'boots', art: 'hunters_charm',
    blurb: 'Earned by drifting long enough to need it.',
    cost: { slag: 30, alloy: 4 },
    unlock: { milestone: { bestTime: 300 } },
    base: [{ stat: 'moveSpeed', type: 'inc', min: 0.05, max: 0.12 },
           { stat: 'maxHp', type: 'flat', min: 10, max: 22 }],
  },
];

/** Necklace: attack power, and whatever your passives are quietly doing. */
const NECKLACE_RECIPES = [
  {
    id: 'r_lodestone', name: 'Lodestone', slot: 'necklace', art: 'lucky_bolt',
    blurb: 'Drags loose Ichor-light toward you.',
    cost: { slag: 8, filament: 6 },
    base: [{ stat: 'pickupRadius', type: 'inc', min: 0.20, max: 0.45 }],
  },
  {
    id: 'r_ichor_vial', name: 'Ichor Vial', slot: 'necklace', art: 'ichor_lens',
    blurb: 'Raw Fracture-leak, decanted. Unpleasant, effective.',
    cost: { filament: 16, ichor: 3 },
    unlock: { materials: ['ichor'] },
    base: [{ stat: 'damage', type: 'inc', min: 0.06, max: 0.15 }],
  },
  {
    id: 't_vine_knot', name: 'Vine Knot', slot: 'necklace', art: 'vine_knot',
    blurb: 'Still growing. Whatever it is drinking, there is plenty of it.',
    cost: { filament: 28, ichor: 4 },
    unlock: { milestone: { runs: 8 } },
    base: [{ stat: 'duration', type: 'inc', min: 0.10, max: 0.24 }],
  },
  {
    id: 't_frost_sigil', name: 'Frost Sigil', slot: 'necklace', art: 'frost_sigil',
    blurb: 'Cold enough that the Warped slow down near it.',
    cost: { filament: 36, alloy: 8 },
    unlock: { milestone: { bestWave: 7 } },
    base: [{ stat: 'area', type: 'inc', min: 0.08, max: 0.20 }],
  },
  {
    id: 't_ember_seal', name: 'Ember Seal', slot: 'necklace', art: 'ember_seal',
    blurb: 'Warm to hold. Warmer for everything else.',
    cost: { slag: 40, ichor: 8 },
    unlock: { milestone: { totalKills: 900 } },
    base: [{ stat: 'damage', type: 'inc', min: 0.07, max: 0.17 }],
  },
];

/** Gloves: baseline attack stats, and where a critical strike comes from. */
const GLOVES_RECIPES = [
  {
    id: 'r_core_shard', name: 'Core Shard', slot: 'gloves', art: 'core_shard',
    blurb: 'A sliver of an Anomaly that was still awake.',
    cost: { ichor: 5, core: 1 },
    unlock: { materials: ['core'] },
    base: [{ stat: 'critChance', type: 'flat', min: 0.05, max: 0.11 },
           { stat: 'critMult', type: 'flat', min: 0.10, max: 0.30 }],
  },
  {
    id: 't_static_coil', name: 'Static Coil', slot: 'gloves', art: 'static_coil',
    blurb: 'Holds a charge it was never asked to hold.',
    cost: { filament: 34, alloy: 5 },
    unlock: { materials: ['alloy'] },
    base: [{ stat: 'attackSpeed', type: 'inc', min: 0.05, max: 0.13 }],
  },
  {
    id: 't_void_anchor', name: 'Void Anchor', slot: 'gloves', art: 'void_anchor',
    blurb: 'Heavy in a way that has nothing to do with mass.',
    cost: { ichor: 20, core: 2 },
    unlock: { milestone: { bestWave: 14 } },
    base: [{ stat: 'critChance', type: 'flat', min: 0.04, max: 0.10 },
           { stat: 'critMult', type: 'flat', min: 0.15, max: 0.40 }],
  },
];

export const RECIPES = [
  ...WEAPON_RECIPES, ...NECKLACE_RECIPES, ...GLOVES_RECIPES,
  ...SUIT_RECIPES, ...BELT_RECIPES, ...BOOTS_RECIPES,
];
export const RECIPE_BY_ID = new Map(RECIPES.map((r) => [r.id, r]));

// ---------------------------------------------------------------------------
// Unlocks and costs
// ---------------------------------------------------------------------------

/**
 * A recipe with no `unlock` is available from the start. Otherwise it opens
 * either when a material has ever been seen, or when a milestone is met.
 *
 * Note "ever seen", not "currently held" — spending your only Alloy must never
 * re-lock a recipe you had already earned.
 */
export function isRecipeUnlocked(recipe, profile) {
  const u = recipe.unlock;
  if (u === undefined) return true;

  if (u.materials !== undefined) {
    for (const id of u.materials) {
      if (!profile.seenMaterials.includes(id)) return false;
    }
  }

  if (u.milestone !== undefined) {
    const m = profile.milestones;
    if (u.milestone.bestWave !== undefined && m.bestWave < u.milestone.bestWave) return false;
    if (u.milestone.bestTime !== undefined && m.bestTime < u.milestone.bestTime) return false;
    if (u.milestone.totalKills !== undefined && m.totalKills < u.milestone.totalKills) return false;
  }

  return true;
}

/** Plain-language description of what still stands between you and a recipe. */
export function unlockHint(recipe, profile) {
  const u = recipe.unlock;
  if (u === undefined) return null;

  const parts = [];
  if (u.materials !== undefined) {
    for (const id of u.materials) {
      if (!profile.seenMaterials.includes(id)) parts.push('find ' + id);
    }
  }
  if (u.milestone !== undefined) {
    const m = profile.milestones;
    if (u.milestone.bestWave !== undefined && m.bestWave < u.milestone.bestWave) {
      parts.push('reach wave ' + u.milestone.bestWave + ' (best ' + m.bestWave + ')');
    }
    if (u.milestone.bestTime !== undefined && m.bestTime < u.milestone.bestTime) {
      parts.push('survive ' + Math.round(u.milestone.bestTime / 60) + ' minutes');
    }
    if (u.milestone.totalKills !== undefined && m.totalKills < u.milestone.totalKills) {
      parts.push(u.milestone.totalKills + ' total kills (' + m.totalKills + ')');
    }
  }
  return parts.length > 0 ? parts.join(', ') : null;
}

/** Full material cost of crafting a recipe at a given rarity. */
export function costFor(recipe, rarity) {
  const rule = RARITY_COST[rarity];
  const out = {};
  for (const id in recipe.cost) {
    out[id] = Math.ceil(recipe.cost[id] * rule.multiplier);
  }
  for (const id in rule.extra) {
    out[id] = (out[id] ?? 0) + rule.extra[id];
  }
  return out;
}

export function canAfford(cost, materials) {
  for (const id in cost) {
    if ((materials[id] ?? 0) < cost[id]) return false;
  }
  return true;
}

/** What's still missing, for the "can't afford" tooltip. */
export function missingFor(cost, materials) {
  const out = {};
  for (const id in cost) {
    const short = cost[id] - (materials[id] ?? 0);
    if (short > 0) out[id] = short;
  }
  return out;
}
