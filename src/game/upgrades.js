/**
 * upgrades.js — the upgrade tree.
 *
 * Phase 1 offered three upgrades drawn at random from a flat list, which meant
 * every run converged on "the same numbers, in a different order". Phase 2 makes
 * the pool a directed graph: a node can require other nodes, or require that you
 * own a particular weapon. You can't take Vortex without first taking more
 * blades, and you can't take either without owning Warden Blades at all.
 *
 * The effect on play is the point. Committing a level-up to a weapon opens that
 * weapon's branch and closes nothing else, so builds *diverge* — by level 15 two
 * runs have genuinely different tools rather than different multipliers.
 *
 * A node is data:
 *   mods            modifiers for the player's global stats
 *   weaponMods      modifiers for one specific weapon's own stats
 *   grantWeapon     adds a weapon to the arsenal
 *   onTake          arbitrary effect (healing, setting a synergy flag)
 *   requires        ids that must already be taken
 *   requiresWeapon  weapon that must already be owned
 *   minLevel        earliest level this may be offered
 *   hint            synergy text surfaced on the card
 */

import { rng } from '../core/rng.js';
import { healPlayer } from './player.js';
import { addWeapon, getWeapon, hasWeapon } from './weapons.js';
import { WEAPONS, ACQUIRABLE } from './weaponDefs.js';
import { PLAYER } from './config.js';

const CHOICE_COUNT = 3;

// ---------------------------------------------------------------------------
// Global upgrades — always available, lift the whole arsenal
// ---------------------------------------------------------------------------

const GLOBAL = [
  {
    id: 'g_damage', name: 'Honed Edge', desc: '+15% damage with all weapons',
    tag: 'offence', weight: 100,
    mods: [{ stat: 'damage', type: 'inc', value: 0.15 }],
  },
  {
    id: 'g_haste', name: 'Overclock', desc: '+12% attack speed with all weapons',
    tag: 'offence', weight: 95,
    mods: [{ stat: 'attackSpeed', type: 'inc', value: 0.12 }],
  },
  {
    id: 'g_area', name: 'Wide Cast', desc: '+15% area of effect',
    tag: 'offence', weight: 70,
    mods: [{ stat: 'area', type: 'inc', value: 0.15 }],
    hint: 'Blasts, blades, beams and burning ground all grow.',
  },
  {
    id: 'g_duration', name: 'Lingering', desc: '+25% effect duration',
    tag: 'utility', weight: 55, maxStacks: 4,
    mods: [{ stat: 'duration', type: 'inc', value: 0.25 }],
  },
  {
    id: 'g_multishot', name: 'Split Round', desc: '+1 projectile from every weapon',
    tag: 'offence', weight: 46, maxStacks: 2, minLevel: 6,
    mods: [{ stat: 'projectileCount', type: 'flat', value: 1 }],
    hint: 'Applies to every weapon you own, now and later.',
  },
  {
    id: 'g_pierce', name: 'Armour Piercing', desc: 'All shots pass through +1 enemy',
    tag: 'offence', weight: 55, maxStacks: 3,
    mods: [{ stat: 'pierce', type: 'flat', value: 1 }],
  },
  {
    id: 'g_crit', name: 'Weak Point', desc: '+8% critical strike chance',
    tag: 'offence', weight: 70, maxStacks: 6,
    mods: [{ stat: 'critChance', type: 'flat', value: 0.08 }],
  },
  {
    id: 'g_critdmg', name: 'Fracture Point', desc: '+45% critical damage',
    tag: 'offence', weight: 60, maxStacks: 4,
    requires: ['g_crit'],
    mods: [{ stat: 'critMult', type: 'flat', value: 0.45 }],
  },
  {
    id: 'g_move', name: 'Light Step', desc: '+10% movement speed',
    tag: 'mobility', weight: 85, maxStacks: 6,
    mods: [{ stat: 'moveSpeed', type: 'inc', value: 0.10 }],
  },
  {
    id: 'g_hp', name: 'Reinforced Frame', desc: '+25 max health, and heal 25',
    tag: 'defence', weight: 85,
    mods: [{ stat: 'maxHp', type: 'flat', value: 25 }],
    onTake: (state) => healPlayer(state, 25),
  },
  {
    id: 'g_regen', name: 'Knit', desc: '+0.6 health per second',
    tag: 'defence', weight: 55, maxStacks: 5,
    mods: [{ stat: 'regen', type: 'flat', value: 0.6 }],
  },
  {
    id: 'g_knock', name: 'Concussive', desc: '+50% knockback',
    tag: 'utility', weight: 35, maxStacks: 3,
    mods: [{ stat: 'knockback', type: 'inc', value: 0.5 }],
  },
  {
    id: 'g_pickup', name: 'Magnetise', desc: '+35% XP pickup radius',
    tag: 'utility', weight: 55, maxStacks: 4,
    mods: [{ stat: 'pickupRadius', type: 'inc', value: 0.35 }],
  },
  {
    id: 'g_heal', name: 'Field Repair', desc: 'Restore 45% of max health',
    tag: 'defence', weight: 30,
    mods: [],
    onTake: (state) => healPlayer(state, state.maxHp * 0.45),
    available: (state) => state.player.hp < state.maxHp * 0.92,
  },
];

// ---------------------------------------------------------------------------
// Weapon acquisition — one node per weapon, generated from the definitions
// ---------------------------------------------------------------------------

const WEAPON_NODES = ACQUIRABLE.map((id) => ({
  id: 'w_' + id,
  name: WEAPONS[id].name,
  desc: WEAPONS[id].blurb,
  tag: 'weapon',
  isWeapon: true,
  weight: 120,
  maxStacks: 1,
  grantWeapon: id,
  available: (state) =>
    !hasWeapon(state, id) && state.weapons.length < PLAYER.maxWeapons,
}));

// ---------------------------------------------------------------------------
// Weapon branches — each requires owning its weapon, and deepens from there
// ---------------------------------------------------------------------------

/** Small helper so a branch node reads as one line of intent. */
const wmod = (weapon, stat, type, value) => ({ weapon, stat, type, value });

const BRANCHES = [
  // --- Splinter (the starter, so this branch is open from the first level) ---
  {
    id: 'spl_rapid', name: 'Rapid Cycling', desc: 'Splinter fires 30% faster',
    tag: 'splinter', weight: 70, maxStacks: 3, requiresWeapon: 'splinter',
    weaponMods: [wmod('splinter', 'cooldown', 'inc', -0.30)],
  },
  {
    id: 'spl_split', name: 'Fork', desc: 'Splinter fires +2 bolts',
    tag: 'splinter', weight: 55, maxStacks: 2, requiresWeapon: 'splinter',
    requires: ['spl_rapid'],
    weaponMods: [wmod('splinter', 'count', 'flat', 2)],
  },
  {
    id: 'spl_heavy', name: 'Dense Slugs', desc: 'Splinter: +50% damage, +2 pierce',
    tag: 'splinter', weight: 55, maxStacks: 2, requiresWeapon: 'splinter',
    requires: ['spl_rapid'],
    weaponMods: [
      wmod('splinter', 'damage', 'inc', 0.5),
      wmod('splinter', 'pierce', 'flat', 2),
    ],
  },

  // --- Scattergun: commit to being dangerously close ---
  {
    id: 'sc_choke', name: 'Choke Bore', desc: 'Scattergun: half the spread, +45% damage',
    tag: 'scattergun', weight: 80, maxStacks: 2, requiresWeapon: 'scattergun',
    weaponMods: [
      wmod('scattergun', 'spread', 'inc', -0.5),
      wmod('scattergun', 'damage', 'inc', 0.45),
    ],
  },
  {
    id: 'sc_double', name: 'Double Barrel', desc: 'Scattergun fires +6 pellets',
    tag: 'scattergun', weight: 70, maxStacks: 2, requiresWeapon: 'scattergun',
    requires: ['sc_choke'],
    weaponMods: [wmod('scattergun', 'count', 'flat', 6)],
    hint: 'More pellets means more crit rolls, and more chances to detonate.',
  },
  {
    id: 'sc_slugs', name: 'Long Shot', desc: 'Scattergun: +70% range and pellet life, +2 pierce',
    tag: 'scattergun', weight: 55, maxStacks: 1, requiresWeapon: 'scattergun',
    requires: ['sc_choke'],
    weaponMods: [
      wmod('scattergun', 'range', 'inc', 0.7),
      wmod('scattergun', 'life', 'inc', 0.7),
      wmod('scattergun', 'pierce', 'flat', 2),
    ],
  },

  // --- Lance: reward lining enemies up ---
  {
    id: 'ln_overcharge', name: 'Overcharge',
    desc: 'Lance deals +20% more for each enemy already pierced',
    tag: 'lance', weight: 80, maxStacks: 3, requiresWeapon: 'lance',
    weaponMods: [wmod('lance', 'rampPerHit', 'flat', 0.20)],
    hint: 'Anything that clumps the crowd multiplies this.',
  },
  {
    id: 'ln_prism', name: 'Prism', desc: 'Lance fires +1 beam in a fan',
    tag: 'lance', weight: 60, maxStacks: 2, requiresWeapon: 'lance',
    requires: ['ln_overcharge'],
    weaponMods: [wmod('lance', 'count', 'flat', 1)],
  },
  {
    id: 'ln_focus', name: 'Capacitor', desc: 'Lance: -35% cooldown, +30% width',
    tag: 'lance', weight: 60, maxStacks: 2, requiresWeapon: 'lance',
    weaponMods: [
      wmod('lance', 'cooldown', 'inc', -0.35),
      wmod('lance', 'width', 'inc', 0.30),
    ],
  },

  // --- Warden Blades: reward being inside the crowd ---
  {
    id: 'or_more', name: 'Whirl', desc: '+2 orbiting blades',
    tag: 'orbit', weight: 80, maxStacks: 3, requiresWeapon: 'orbit',
    weaponMods: [wmod('orbit', 'count', 'flat', 2)],
  },
  {
    id: 'or_vortex', name: 'Vortex', desc: 'Blades drag enemies toward you',
    tag: 'orbit', weight: 70, maxStacks: 2, requiresWeapon: 'orbit',
    requires: ['or_more'],
    weaponMods: [wmod('orbit', 'pull', 'flat', 620)],
    hint: 'Holds the crowd inside your blades instead of letting it scatter.',
  },
  {
    id: 'or_wide', name: 'Long Reach', desc: 'Blades: +40% orbit radius and size, +25% spin',
    tag: 'orbit', weight: 60, maxStacks: 2, requiresWeapon: 'orbit',
    weaponMods: [
      wmod('orbit', 'radius', 'inc', 0.4),
      wmod('orbit', 'bladeSize', 'inc', 0.4),
      wmod('orbit', 'spinRate', 'inc', 0.25),
    ],
  },
  {
    id: 'or_serrated', name: 'Serrated', desc: 'Blades: +55% damage, hit each enemy 40% more often',
    tag: 'orbit', weight: 60, maxStacks: 2, requiresWeapon: 'orbit',
    weaponMods: [
      wmod('orbit', 'damage', 'inc', 0.55),
      wmod('orbit', 'rehit', 'inc', -0.4),
    ],
  },

  // --- Quake: the weapon that works while you flee ---
  {
    id: 'qk_heavy', name: 'Deep Impact', desc: 'Quake: +60% damage, +50% knockback',
    tag: 'quake', weight: 70, maxStacks: 2, requiresWeapon: 'quake',
    weaponMods: [
      wmod('quake', 'damage', 'inc', 0.6),
      wmod('quake', 'knockback', 'inc', 0.5),
    ],
  },
  {
    id: 'qk_aftershock', name: 'Aftershock', desc: 'Quake: -35% cooldown, +25% radius',
    tag: 'quake', weight: 70, maxStacks: 1, requiresWeapon: 'quake',
    weaponMods: [
      wmod('quake', 'cooldown', 'inc', -0.35),
      wmod('quake', 'radius', 'inc', 0.25),
    ],
  },
  {
    id: 'qk_fissure', name: 'Fissure', desc: 'Quake cracks the ground, leaving 3 burning rifts',
    tag: 'quake', weight: 65, maxStacks: 2, requiresWeapon: 'quake',
    requires: ['qk_heavy'],
    weaponMods: [
      wmod('quake', 'leavesFissure', 'flat', 3),
      wmod('quake', 'fissureDps', 'flat', 16),
    ],
    hint: 'Rifts only pay off if enemies stay in them. Slow or pull them first.',
  },

  // --- Seeker: the weapon that makes your other weapons better ---
  {
    id: 'sk_mark', name: 'Target Lock', desc: 'Seeker impacts Mark everything nearby: marked enemies take +35% from all sources',
    tag: 'seeker', weight: 80, maxStacks: 1, requiresWeapon: 'seeker',
    weaponMods: [
      wmod('seeker', 'marks', 'flat', 3.5),
      wmod('seeker', 'markRadius', 'flat', 85),
    ],
    hint: 'The more attacks per second you have, the more this is worth.',
  },
  {
    id: 'sk_swarm', name: 'Swarm', desc: 'Seeker fires +3 shards',
    tag: 'seeker', weight: 70, maxStacks: 2, requiresWeapon: 'seeker',
    requires: ['sk_mark'],
    weaponMods: [wmod('seeker', 'count', 'flat', 3)],
  },
  {
    id: 'sk_agile', name: 'Predictive', desc: 'Seekers: +90% turn rate, +45% speed, +35% damage',
    tag: 'seeker', weight: 60, maxStacks: 2, requiresWeapon: 'seeker',
    weaponMods: [
      wmod('seeker', 'turnRate', 'inc', 0.9),
      wmod('seeker', 'projectileSpeed', 'inc', 0.45),
      wmod('seeker', 'damage', 'inc', 0.35),
    ],
  },

  // --- Ember: the weapon that rewards never standing still ---
  {
    id: 'em_intense', name: 'White Heat', desc: 'Ember: +65% burn damage',
    tag: 'ember', weight: 75, maxStacks: 3, requiresWeapon: 'ember',
    weaponMods: [wmod('ember', 'dps', 'inc', 0.65)],
  },
  {
    id: 'em_wide', name: 'Spreading Blaze', desc: 'Ember: +45% radius, +40% duration, +1 patch',
    tag: 'ember', weight: 65, maxStacks: 2, requiresWeapon: 'ember',
    weaponMods: [
      wmod('ember', 'radius', 'inc', 0.45),
      wmod('ember', 'zoneLife', 'inc', 0.4),
      wmod('ember', 'count', 'flat', 1),
    ],
  },
  {
    id: 'em_wildfire', name: 'Wildfire',
    desc: 'Enemies that die while burning leave a fire pool behind',
    tag: 'ember', weight: 60, maxStacks: 2, requiresWeapon: 'ember',
    requires: ['em_intense'],
    onTake: (state) => { state.flags.wildfire += 5; },
    hint: 'Fire begets fire. In a dense crowd this sustains itself.',
  },
];

// ---------------------------------------------------------------------------
// Cross-cutting synergies — these change what the game does, not just a number
// ---------------------------------------------------------------------------

const SYNERGY = [
  {
    id: 'sy_volatile', name: 'Volatile Remains',
    desc: 'Slain enemies detonate, damaging everything nearby',
    tag: 'synergy', weight: 75, maxStacks: 1, minLevel: 5,
    onTake: (state) => {
      state.flags.explodeDamage += 5;
      state.flags.explodeHpScale += 0.035;
    },
    hint: 'One death can cascade into the next. Clump them first.',
  },
  {
    id: 'sy_bigger_blast', name: 'Unstable Core',
    desc: 'Detonations: +30% radius, +60% damage',
    tag: 'synergy', weight: 65, maxStacks: 1,
    requires: ['sy_volatile'],
    onTake: (state) => {
      state.flags.explodeDamage += 3;
      state.flags.explodeHpScale += 0.025;
      state.flags.explodeRadius *= 1.3;
    },
    hint: 'Wide enough that one detonation reliably starts the next.',
  },
  {
    id: 'sy_arc', name: 'Arc Lightning',
    desc: 'Critical hits arc to a nearby enemy',
    tag: 'synergy', weight: 65, maxStacks: 3, requires: ['g_crit'],
    onTake: (state) => { state.flags.arcDamage += 22; },
    hint: 'Weapons that fire many small hits roll far more crits.',
  },
];

export const UPGRADES = [...GLOBAL, ...WEAPON_NODES, ...BRANCHES, ...SYNERGY];

const BY_ID = new Map(UPGRADES.map((u) => [u.id, u]));

// ---------------------------------------------------------------------------
// Eligibility and rolling
// ---------------------------------------------------------------------------

export function timesTaken(state, id) {
  return state.takenUpgrades.get(id) ?? 0;
}

/** Every gate a node has to clear before it can be offered. */
function isEligible(state, u) {
  if (u.maxStacks !== undefined && timesTaken(state, u.id) >= u.maxStacks) return false;
  if (u.minLevel !== undefined && state.level < u.minLevel) return false;
  if (u.requiresWeapon !== undefined && !hasWeapon(state, u.requiresWeapon)) return false;

  // Prerequisites: every listed node must already have been taken at least once.
  if (u.requires !== undefined) {
    for (const req of u.requires) {
      if (timesTaken(state, req) === 0) return false;
    }
  }

  if (u.available !== undefined && !u.available(state)) return false;
  return true;
}

/**
 * Offer weight, adjusted for what the run needs right now.
 *
 * A flat weight makes the first few level-ups feel identical every run, because
 * the generic stat nodes always outnumber everything else. Biasing hard toward
 * new weapons while the arsenal is small is what actually forces two runs apart
 * — once you own three weapons the bias disappears and the tree takes over.
 */
function offerWeight(state, u) {
  let w = u.weight;

  if (u.isWeapon === true) {
    // Bias toward new weapons early so runs diverge fast, then fall away hard
    // so the back half of a run is spent deepening a build rather than
    // collecting one of everything.
    const owned = state.weapons.length;
    if (owned <= 1) w *= 2.2;
    else if (owned === 2) w *= 1.2;
    else w *= 0.45;
  }

  // Nudge branch nodes for weapons the player actually invested in, so a
  // committed build keeps getting relevant cards instead of drowning in generics.
  if (u.requiresWeapon !== undefined && u.requiresWeapon !== 'splinter') {
    w *= 1.25;
  }

  return w;
}

/** Roll the cards for one level-up. */
export function rollUpgradeChoices(state) {
  const pool = UPGRADES.filter((u) => isEligible(state, u));

  if (pool.length === 0) {
    // Everything is capped — a very long run. Offer a plain damage bump rather
    // than showing an empty screen.
    return [{
      id: 'g_overflow', name: 'Surge', desc: '+10% damage (nothing left to learn)',
      tag: 'offence', mods: [{ stat: 'damage', type: 'inc', value: 0.10 }],
    }];
  }

  return rng.weightedSample(
    pool,
    (u) => offerWeight(state, u),
    Math.min(CHOICE_COUNT, pool.length),
  );
}

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

export function applyUpgrade(state, upgrade) {
  const def = BY_ID.get(upgrade.id) ?? upgrade;

  // Enforced here as well as at roll time. Normal play can't reach this, but
  // the cap belongs to the node, so the function that applies one should honour
  // it — a future caller (crafted affixes, a restored save) shouldn't be able to
  // quietly blow past a designed limit.
  if (def.maxStacks !== undefined && timesTaken(state, def.id) >= def.maxStacks) {
    console.warn('[fracture] refusing to apply ' + def.id + ' beyond its cap of ' + def.maxStacks);
    return false;
  }

  if (def.grantWeapon !== undefined) {
    addWeapon(state, def.grantWeapon);
  }

  if (def.mods !== undefined) {
    for (const mod of def.mods) state.stats.add({ ...mod, source: def.id });
    state.stats.recompute();
  }

  if (def.weaponMods !== undefined) {
    for (const m of def.weaponMods) {
      const weapon = getWeapon(state, m.weapon);
      // Can't happen through normal play — the node requires the weapon — but
      // skipping beats throwing if it ever does.
      if (weapon === null) continue;
      weapon.stats.add({ stat: m.stat, type: m.type, value: m.value, source: def.id });
      weapon.stats.recompute();
      weapon.rank++;
    }
  }

  if (def.onTake !== undefined) def.onTake(state);

  state.takenUpgrades.set(def.id, timesTaken(state, def.id) + 1);

  // A max-HP increase shouldn't leave the bar looking like you lost health.
  state.player.hp = Math.min(state.player.hp, state.maxHp);

  return true;
}

/** Nodes unlocked *by* taking this one — used to preview a branch on the card. */
export function unlockedBy(id) {
  return UPGRADES.filter((u) => u.requires !== undefined && u.requires.includes(id));
}
