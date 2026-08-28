/**
 * chests.js — what a chest contains, at every tier.
 *
 * Deliberately separate from the in-run chest *entities* (`src/game/chests.js`
 * spawns and animates them in the arena) and from the end-of-run chest (rolled
 * from `src/ui/gameover.js`'s "Open" button). Both call into this file for the
 * actual reward roll, so a common chest means the same thing everywhere it
 * shows up — dropped by an enemy, found in the open, or handed out for a good
 * run.
 *
 * A chest never touches combat or build stats directly: it can only hand out
 * things the existing systems already know how to spend — materials the forge
 * eats, Scrip the reforge action eats, and gear rolled through the exact same
 * `craftItem` a Hub forge uses. It's a reward layer sitting on top of systems
 * that already exist, not a new axis of power.
 */

import { MATERIALS_ORDERED } from './materials.js';
import { RARITY_ORDER, craftItem } from './gear.js';
import { RECIPES, isRecipeUnlocked } from './recipes.js';

export const CHEST_TIERS = {
  common: {
    id: 'common', name: 'Chest', color: '#9fb3c8', weight: 100,
    materialRolls: [1, 2], materialAmount: [4, 10],
    scrip: [4, 12],
    // Gear from the everyday chest is meant to be a small bonus, not a
    // reliable source of it — most opens hand out materials/Scrip only.
    gearChance: 0.10, gearRarity: ['common', 'common', 'common', 'common', 'uncommon', 'uncommon', 'rare'],
  },
  rare: {
    id: 'rare', name: 'Rare Chest', color: '#ffb703', weight: 30,
    materialRolls: [2, 3], materialAmount: [8, 16],
    scrip: [15, 30],
    // 'legendary' here used to mean the 5-affix tier, before Exotic and
    // Legendary swapped power levels — remapped to 'exotic' so this chest's
    // actual odds don't silently jump to handing out the new top-of-ladder
    // tier just because the name it always used got more powerful.
    gearChance: 0.30, gearRarity: ['common', 'uncommon', 'uncommon', 'rare', 'rare', 'epic'],
  },
  exotic: {
    id: 'exotic', name: 'Exotic Chest', color: '#ff5ec4', weight: 7,
    materialRolls: [3, 4], materialAmount: [14, 26],
    scrip: [35, 65],
    // Same remap, plus one genuinely new addition: a rare shot at an
    // Ancient from the best chest in the game, now that the tier exists.
    // No longer a guaranteed drop — even the best chest in the game can
    // come up materials-only, so a run's excitement isn't front-loaded into
    // "did I find an exotic chest yet" alone.
    gearChance: 0.65, gearRarity: ['epic', 'epic', 'epic', 'exotic', 'exotic', 'exotic', 'mythic', 'legendary', 'ancient'],
  },
};

export const CHEST_TIER_ORDER = ['common', 'rare', 'exotic'];

/**
 * Pick a tier when a chest spawns. `bonus` nudges the weighting — later waves
 * and better-performing runs skew slightly toward the good stuff, same shape
 * as everything else in the game that rewards surviving longer.
 */
export function rollChestTier(rng, bonus = 0) {
  const weights = CHEST_TIER_ORDER.map((id) => {
    const t = CHEST_TIERS[id];
    // Only rare and exotic get the bonus — common is the floor, not something
    // that needs boosting.
    return id === 'common' ? t.weight : t.weight * (1 + bonus);
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rng.next() * total;
  for (let i = 0; i < CHEST_TIER_ORDER.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return CHEST_TIER_ORDER[i];
  }
  return 'common';
}

/**
 * Roll a chest's contents.
 * @returns {{ materials: Object<string, number>, currency: number, gear: object|null }}
 */
export function rollChestContents(tierId, rng, profile) {
  const tier = CHEST_TIERS[tierId] ?? CHEST_TIERS.common;

  const materials = {};
  const rollCount = Math.round(rng.range(tier.materialRolls[0], tier.materialRolls[1] + 1));
  // Weighted toward the chest's own tier of material, so an exotic chest
  // reliably contains exotic-tier material rather than just a lot of Slag.
  const pool = weightedMaterialPool(tierId);
  for (let i = 0; i < rollCount; i++) {
    const mat = pool[Math.floor(rng.next() * pool.length)];
    const amount = Math.round(rng.range(tier.materialAmount[0], tier.materialAmount[1] + 1));
    materials[mat.id] = (materials[mat.id] ?? 0) + amount;
  }

  const currency = Math.round(rng.range(tier.scrip[0], tier.scrip[1] + 1));

  let gear = null;
  if (rng.next() < tier.gearChance) {
    gear = rollChestGear(tier, rng, profile);
  }

  return { materials, currency, gear };
}

/**
 * Materials, weighted so a chest's own tier dominates its own drops without
 * making lower tiers impossible — a rare chest is mostly Alloy/Ichor with a
 * little Slag/Filament mixed in, not exclusively one or the other.
 */
function weightedMaterialPool(tierId) {
  const rank = { common: 0, rare: 1, exotic: 2 }[tierId] ?? 0;
  const pool = [];
  for (const m of MATERIALS_ORDERED) {
    const matRank = { common: 0, rare: 1, exotic: 2 }[m.tier];
    // Distance from the chest's own tier determines how many entries a
    // material gets in the pool — closer tiers appear more often.
    const copies = matRank === rank ? 4 : matRank === rank - 1 || matRank === rank + 1 ? 2 : 1;
    for (let i = 0; i < copies; i++) pool.push(m);
  }
  return pool;
}

/**
 * Roll a gear item from a recipe the player has already unlocked. Chests
 * reward what you've earned access to — a found item skips the material cost,
 * not the progression gate recipes are behind.
 */
function rollChestGear(tier, rng, profile) {
  const unlocked = RECIPES.filter((r) => isRecipeUnlocked(r, profile));
  if (unlocked.length === 0) return null;

  const recipe = unlocked[Math.floor(rng.next() * unlocked.length)];
  const rarity = tier.gearRarity[Math.floor(rng.next() * tier.gearRarity.length)];
  return craftItem(recipe, rarity, rng);
}

/** Which of a run's stats should bias the end-of-run chest toward a better tier. */
export function performanceBonus(wave, kills) {
  return Math.min(1.6, wave * 0.045 + kills * 0.0006);
}
