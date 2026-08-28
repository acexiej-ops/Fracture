/**
 * bossUniques.js — the one-time trophy weapon each Anomaly (boss) drops the
 * first time it's actually beaten.
 *
 * Each entry is just a weapon-slot gear item wired to an existing base
 * *behavior* (see game/weaponBases.js) rather than a new one — the same
 * approach the 7 hand-authored rigs in recipes.js already use, so nothing
 * about how a rig plugs into a run has to change. `mintBossUniqueItem`
 * builds a throwaway recipe-shaped object and hands it straight to
 * `craftItem`, reusing its base-stat rolling, its affix rolling, its uid —
 * the only things special about a boss unique are that it's guaranteed
 * (see enemies.js's bossDefeated), always Legendary, and carries its own
 * `art` rather than resolving one through a Forge recipe nobody can craft.
 */

import { craftItem } from './gear.js';

export const BOSS_UNIQUES = {
  // The Maw: melee wall, alternates a ground slam with a charge. Its trophy
  // is the same kind of hit, permanently yours.
  behemoth: {
    id: 'boss_behemoth',
    name: "Maw's Toll",
    weaponId: 'slam',
    art: 'maws_toll_rig',
    blurb: 'A trophy torn from The Maw. Slams harder, and further.',
    base: [
      { stat: 'damage', type: 'inc', min: 0.10, max: 0.24, weapon: 'slam' },
      { stat: 'knockback', type: 'inc', min: 0.10, max: 0.22, weapon: 'slam' },
    ],
  },
  // The Choir: holds range, volleys, calls in help. Its trophy is a placed
  // structure that keeps doing exactly that on its own.
  warden: {
    id: 'boss_warden',
    name: 'Choirbell',
    weaponId: 'turret',
    art: 'choirbell_rig',
    blurb: 'Still rings with whatever The Choir used to call.',
    base: [
      { stat: 'damage', type: 'inc', min: 0.09, max: 0.22, weapon: 'turret' },
      { stat: 'duration', type: 'inc', min: 0.08, max: 0.20, weapon: 'turret' },
    ],
  },
  // The Brood: an aura plus a swarm of its own. Its trophy is the last of
  // that swarm, now following you instead.
  swarmQueen: {
    id: 'boss_swarmQueen',
    name: 'Broodling',
    weaponId: 'companion',
    art: 'broodling_rig',
    blurb: 'The last of The Brood, and the most loyal.',
    base: [
      { stat: 'damage', type: 'inc', min: 0.09, max: 0.22, weapon: 'companion' },
      { stat: 'cooldown', type: 'inc', min: -0.16, max: -0.06, weapon: 'companion' },
    ],
  },
  // The Harbinger: the roster's dedicated ranged threat, never misses at
  // distance. Its trophy sights down the same line.
  harbinger: {
    id: 'boss_harbinger',
    name: 'Omen Beam',
    weaponId: 'rail',
    art: 'omen_beam_rig',
    blurb: 'Sights down the same line The Harbinger never missed.',
    base: [
      { stat: 'damage', type: 'inc', min: 0.10, max: 0.24, weapon: 'rail' },
      { stat: 'pierce', type: 'flat', min: 0, max: 2, weapon: 'rail' },
    ],
  },
};

/**
 * Mint a boss's unique weapon item. Always Legendary — a guaranteed,
 * one-time reward should read as a real trophy, not a coin flip. Returns
 * null for an unknown boss id rather than throwing, matching every other
 * lookup-by-id function in the meta layer.
 */
export function mintBossUniqueItem(bossId, rng) {
  const def = BOSS_UNIQUES[bossId];
  if (def === undefined) return null;

  const fakeRecipe = {
    id: def.id, name: def.name, slot: 'weapon', weaponId: def.weaponId, base: def.base,
  };
  const item = craftItem(fakeRecipe, 'legendary', rng);
  item.art = def.art;
  item.isBossUnique = true;
  return item;
}
